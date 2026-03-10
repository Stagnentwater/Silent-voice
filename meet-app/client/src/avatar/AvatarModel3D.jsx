import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import {
  BODY_SEGMENTS,
  LEFT_HAND_SEGMENTS,
  RIGHT_HAND_SEGMENTS,
  FACE_BONE_NAMES,
  FACE_LM,
  resolveBoneName,
} from './poseToBonesMap.js';

const GLB_PATH = '/shoko.glb';
const TARGET_FRAME_MS = 200; // ~5 fps, 2× slower signing speed

// ─── Coordinate conversion ───────────────────────────────────────────────────
// MediaPipe: x-right, y-down, z-toward-camera (all 0-1 normalised)
// Three.js:  x-right, y-up,   z-toward-viewer
function mpToV3(lm) {
  return new THREE.Vector3(
    (lm.x - 0.5) * 2,
    -(lm.y - 0.5) * 2,
    -(lm.z ?? 0) * 2
  );
}

// ─── Landmark interpolation ──────────────────────────────────────────────────
/** Accepts both dense Array and sparse-object landmark sets. */
function isLmSet(lm) { return lm != null && typeof lm === 'object'; }

function lerpPt(a, b, t) {
  if (!a || !b) return a || b || null;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t,
  };
}

/**
 * Lerp two landmark sets — handles both dense Array and the sparse-object
 * format { "0": pt, "11": pt, ... } that poseApi/poseChannel produce.
 */
function lerpArr(a, b, t) {
  if (!a || !b) return a || b || null;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.map((lA, i) => lerpPt(lA, b[i], t) ?? lA);
  }
  // Sparse object — iterate keys of `a`, look up same key in `b`
  const out = {};
  Object.keys(a).forEach((k) => {
    const r = lerpPt(a[k], b ? b[k] : null, t);
    if (r) out[k] = r;
  });
  return out;
}

function lerpFrame(a, b, t) {
  return {
    pose_landmarks:        lerpArr(a.pose_landmarks,        b.pose_landmarks,        t),
    left_hand_landmarks:   lerpArr(a.left_hand_landmarks,   b.left_hand_landmarks,   t),
    right_hand_landmarks:  lerpArr(a.right_hand_landmarks,  b.right_hand_landmarks,  t),
    face_landmarks:        lerpArr(a.face_landmarks,        b.face_landmarks,        t),
  };
}

function getFrameAtTime(packet, elapsedMs) {
  const frames = packet.poseFrames;
  if (!frames || !frames.length) return null;
  if (frames.length === 1) return frames[0];

  const rawTimings = packet.timings;
  let timings;
  if (Array.isArray(rawTimings) && rawTimings.length === frames.length) {
    const last    = rawTimings[rawTimings.length - 1];
    const desired = frames.length * TARGET_FRAME_MS;
    const scale   = last > 0 ? desired / last : 1;
    timings = rawTimings.map((t) => t * scale);
  } else {
    timings = frames.map((_, i) => i * TARGET_FRAME_MS);
  }

  if (elapsedMs <= timings[0]) return frames[0];
  if (elapsedMs >= timings[timings.length - 1]) return frames[frames.length - 1];

  for (let i = 0; i < timings.length - 1; i++) {
    if (elapsedMs >= timings[i] && elapsedMs < timings[i + 1]) {
      const t = (elapsedMs - timings[i]) / (timings[i + 1] - timings[i]);
      return lerpFrame(frames[i], frames[i + 1], t);
    }
  }
  return frames[frames.length - 1];
}

/** Return the current word string based on elapsed playback time. */
function getWordAtTime(packet, elapsedMs) {
  const words = (packet.text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';

  const timings = packet.timings;
  const totalMs = Array.isArray(timings) && timings.length
    ? timings[timings.length - 1]
    : words.length * TARGET_FRAME_MS * 5;

  if (totalMs <= 0 || elapsedMs >= totalMs) return words[words.length - 1];

  const idx = Math.min(
    Math.floor((elapsedMs / totalMs) * words.length),
    words.length - 1
  );
  return words[idx] || '';
}

// ─── Pre-allocated temporaries ───────────────────────────────────────────────
const _dir  = new THREE.Vector3();
const _m4   = new THREE.Matrix4();
const _pInv = new THREE.Quaternion(); // ← FIX: was missing, caused ReferenceError in faceHeadQuat

// ─── Bone rotation helpers ───────────────────────────────────────────────────

/**
 * Compute the local-space quaternion that drives `bone` so its segment
 * (lm[from] → lm[to]) aligns with the corresponding landmark direction.
 *
 * Uses the bone's REST world direction (captured at load time) as the
 * reference axis — NOT the generic +Y — so T-pose bones that point
 * sideways (arms) or downward (legs) stay correct.
 *
 * entry = { bone, restQuat, restWorldDir, parentRestWorldQuat }
 */
function segmentQuat(lmArray, fromIdx, toIdx, entry) {
  const lmF = lmArray[fromIdx];
  const lmT = lmArray[toIdx];
  if (!lmF || !lmT) {
    console.warn(`[segmentQuat] missing landmark: from=${fromIdx}(${!!lmF}) to=${toIdx}(${!!lmT})`);
    return null;
  }

  _dir.subVectors(mpToV3(lmT), mpToV3(lmF));
  if (_dir.lengthSq() < 1e-8) return null;
  _dir.normalize();

  // World-space delta: rotate bone's rest direction → target direction
  const worldDelta = new THREE.Quaternion().setFromUnitVectors(
    entry.restWorldDir,
    _dir
  );

  // Convert world delta to local space:
  //   localQ = inv(parentRestWorldQ) * worldDelta * restWorldQ
  const parentInv = entry.parentRestWorldQuat.clone().invert();
  return parentInv.multiply(worldDelta).multiply(entry.restWorldQuat);
}

/**
 * Compute head bone rotation from face-mesh landmarks.
 * Builds an orthonormal frame:  Y=forehead→chin (up),  X=left→right,  Z=cross(X,Y)
 * then converts to the bone's local space.
 */
function faceHeadQuat(faceLm, headBone) {
  const fi  = FACE_LM;
  const top = faceLm[fi.FOREHEAD_TOP];
  const bot = faceLm[fi.CHIN_BOTTOM];
  const lft = faceLm[fi.FACE_LEFT];
  const rgt = faceLm[fi.FACE_RIGHT];
  if (!top || !bot || !lft || !rgt) return null;

  const vTop = mpToV3(top);
  const vBot = mpToV3(bot);
  const vLft = mpToV3(lft);
  const vRgt = mpToV3(rgt);

  const upDir    = vTop.clone().sub(vBot).normalize();        // chin → forehead = +Y
  const rightDir = vRgt.clone().sub(vLft).normalize();        // left → right   = +X
  const fwdDir   = upDir.clone().cross(rightDir).normalize(); // +Z

  const m = new THREE.Matrix4();
  m.makeBasis(rightDir, upDir, fwdDir);
  const worldQ = new THREE.Quaternion().setFromRotationMatrix(m);

  if (headBone.parent) {
    headBone.parent.updateWorldMatrix(true, false);
    _m4.extractRotation(headBone.parent.matrixWorld);
    _pInv.setFromRotationMatrix(_m4).invert(); // ← now uses the declared _pInv
    worldQ.premultiply(_pInv);
  }
  return worldQ;
}

/**
 * Compute mouth-open ratio from face landmarks (0–1).
 */
function faceMouthOpen(faceLm) {
  const fi    = FACE_LM;
  const upper = faceLm[fi.UPPER_LIP];
  const lower = faceLm[fi.LOWER_LIP];
  const fHead = faceLm[fi.FOREHEAD_TOP];
  const fChin = faceLm[fi.CHIN_BOTTOM];
  if (!upper || !lower || !fHead || !fChin) return 0;

  const mouthGap   = Math.abs(lower.y - upper.y);
  const faceHeight = Math.abs(fChin.y - fHead.y);
  return faceHeight > 0.01 ? Math.min(mouthGap / faceHeight * 3.0, 1.0) : 0;
}

/**
 * Compute eye-blink ratio from face landmarks (0–1).
 * Uses vertical distance between upper and lower eyelid relative to face height.
 */
function faceBlinkRatio(faceLm) {
  const fi    = FACE_LM;
  const fHead = faceLm[fi.FOREHEAD_TOP];
  const fChin = faceLm[fi.CHIN_BOTTOM];
  // Upper/Lower eyelid landmarks (MediaPipe face mesh)
  const upperLidL = faceLm[159];
  const lowerLidL = faceLm[145];
  const upperLidR = faceLm[386];
  const lowerLidR = faceLm[374];
  if (!fHead || !fChin || !upperLidL || !lowerLidL || !upperLidR || !lowerLidR) return 0;

  const faceH = Math.abs(fChin.y - fHead.y);
  if (faceH < 0.01) return 0;
  const openL = Math.abs(lowerLidL.y - upperLidL.y) / faceH;
  const openR = Math.abs(lowerLidR.y - upperLidR.y) / faceH;
  const avgOpen = (openL + openR) / 2;
  // When eye opening < threshold, map to blink (1 = fully closed)
  return Math.max(0, Math.min(1.0 - avgOpen * 12.0, 1.0));
}

// ─── Component ───────────────────────────────────────────────────────────────
export function AvatarModel3D({ posePacket, onWordChange }) {
  const { scene } = useGLTF(GLB_PATH);

  // All segment bones: { boneName: { bone, restQuat } }
  const segmentBonesRef = useRef({});
  // Face bones
  const faceBoneRef = useRef({ head: null, jaw: null });
  // Morph target meshes: array of { mesh, dict } for driving face morphs
  const morphMeshesRef = useRef([]);
  // Current morph state for smooth interpolation
  const morphStateRef = useRef({ mouthOpen: 0, blink: 0 });

  // Sequence tracking
  const packetRef   = useRef(null); // { packet, startMs }
  const lastWordRef = useRef('');   // last word emitted to avoid redundant calls

  // Diagnostics: only log once per packet
  const diagDoneRef = useRef(false);

  // ── Discover bones on load ─────────────────────────────────────────────
  useEffect(() => {
    const allBones = {};
    scene.traverse((obj) => {
      if (obj.isBone || obj.type === 'Bone') allBones[obj.name] = obj;
      if (obj.isSkinnedMesh && obj.skeleton) {
        obj.skeleton.bones.forEach((b) => { allBones[b.name] = b; });
      }
    });

    console.log('[AvatarModel3D] all GLB bones:', Object.keys(allBones).sort());

    // ── Helper: build a full bone entry with rest-pose world data ────────
    function makeBoneEntry(bone) {
      bone.updateWorldMatrix(true, false);

      // World quaternion of this bone in rest pose
      const restWorldQuat = new THREE.Quaternion().setFromRotationMatrix(
        _m4.extractRotation(bone.matrixWorld)
      );

      // World quaternion of parent in rest pose
      let parentRestWorldQuat = new THREE.Quaternion(); // identity
      if (bone.parent) {
        bone.parent.updateWorldMatrix(true, false);
        parentRestWorldQuat.setFromRotationMatrix(
          _m4.extractRotation(bone.parent.matrixWorld)
        );
      }

      // Direction the bone points in world space in rest pose (+Y in local)
      const restWorldDir = new THREE.Vector3(0, 1, 0).applyQuaternion(restWorldQuat);

      return {
        bone,
        restQuat: bone.quaternion.clone(),
        restWorldQuat,
        parentRestWorldQuat,
        restWorldDir,
      };
    }

    const segBones = {};
    const allSegments = [
      ...BODY_SEGMENTS,
      ...LEFT_HAND_SEGMENTS,
      ...RIGHT_HAND_SEGMENTS,
    ];
    allSegments.forEach(({ boneName }) => {
      const bone = resolveBoneName(boneName, allBones);
      if (bone) {
        segBones[boneName] = makeBoneEntry(bone);
      } else {
        console.warn(`[AvatarModel3D] bone NOT found in GLB: "${boneName}"`);
      }
    });
    segmentBonesRef.current = segBones;
    console.log('[AvatarModel3D] resolved segment bones:', Object.keys(segBones));

    const headBoneObj = resolveBoneName(FACE_BONE_NAMES.head, allBones);
    const jawBoneObj  = FACE_BONE_NAMES.jaw ? resolveBoneName(FACE_BONE_NAMES.jaw, allBones) : null;
    faceBoneRef.current = {
      head: headBoneObj ? makeBoneEntry(headBoneObj) : null,
      jaw:  jawBoneObj  ? makeBoneEntry(jawBoneObj)  : null,
    };
    console.log('[AvatarModel3D] head bone:', headBoneObj?.name ?? 'NOT FOUND');
    console.log('[AvatarModel3D] jaw bone:', jawBoneObj?.name ?? 'none');

    // ── Discover morph target meshes ──────────────────────────────────
    const morphMeshes = [];
    scene.traverse((obj) => {
      if (obj.isMesh && obj.morphTargetDictionary && obj.morphTargetInfluences) {
        morphMeshes.push({ mesh: obj, dict: obj.morphTargetDictionary });
      }
    });
    morphMeshesRef.current = morphMeshes;
    if (morphMeshes.length) {
      console.log('[AvatarModel3D] morph meshes found:', morphMeshes.length,
        '| sample morphs:', Object.keys(morphMeshes[0].dict).slice(0, 15));
    }
  }, [scene]);

  // ── Track current packet + record start time ───────────────────────────
  useEffect(() => {
    if (posePacket) {
      packetRef.current = { packet: posePacket, startMs: null };
      lastWordRef.current = '';
      diagDoneRef.current = false; // reset so we log the new packet shape
    }
  }, [posePacket]);

  // ── Per-frame bone driving ─────────────────────────────────────────────
  useFrame(({ clock }) => {
    const entry     = packetRef.current;
    const segBones  = segmentBonesRef.current;
    const faceBones = faceBoneRef.current;
    const nowMs     = clock.getElapsedTime() * 1000;

    if (!entry) {
      // Drift to rest
      Object.values(segBones).forEach(({ bone, restQuat }) => {
        bone.quaternion.slerp(restQuat, 0.04);
      });
      if (faceBones.head) faceBones.head.bone.quaternion.slerp(faceBones.head.restQuat, 0.04);
      if (faceBones.jaw)  faceBones.jaw.bone.quaternion.slerp(faceBones.jaw.restQuat,  0.04);
      return;
    }

    // Record sequence start on first frame after new packet
    if (entry.startMs === null) {
      entry.startMs = nowMs;
    }

    // ── One-time packet diagnostics ──────────────────────────────────────
    if (!diagDoneRef.current) {
      diagDoneRef.current = true;
      const p = entry.packet;
      console.log('[AvatarModel3D] packet keys:', Object.keys(p));
      console.log('[AvatarModel3D] poseFrames count:', p.poseFrames?.length ?? 'MISSING — check backend shape');
      const firstFrame = p.poseFrames?.[0];
      if (firstFrame) {
        const poseLmKeys = Object.keys(firstFrame.pose_landmarks ?? {});
        console.log('[AvatarModel3D] pose_landmarks present:', poseLmKeys.length > 0, '| sample keys:', poseLmKeys.slice(0, 8));
        console.log('[AvatarModel3D] left_hand_landmarks present:', !!firstFrame.left_hand_landmarks);
        console.log('[AvatarModel3D] face_landmarks present:', !!firstFrame.face_landmarks);
      } else {
        console.warn('[AvatarModel3D] no first frame found — poseFrames may be empty or misnamed');
      }
    }

    const elapsed = nowMs - entry.startMs;
    const frame = getFrameAtTime(entry.packet, elapsed);
    if (!frame) return;

    // ── Emit current word as animation progresses ──────────────────────
    if (onWordChange) {
      const word = getWordAtTime(entry.packet, elapsed);
      if (word !== lastWordRef.current) {
        lastWordRef.current = word;
        onWordChange(word);
      }
    }

    const poseLm  = frame.pose_landmarks;
    const leftLm  = frame.left_hand_landmarks;
    const rightLm = frame.right_hand_landmarks;
    const faceLm  = frame.face_landmarks;

    // ── Reusable segment driver ─────────────────────────────────────────
    function driveSegments(lmArray, segments, alpha) {
      segments.forEach(({ boneName, from, to }) => {
        const e = segBones[boneName];
        if (!e) return;
        const q = segmentQuat(lmArray, from, to, e);
        e.bone.quaternion.slerp(q ?? e.restQuat, q ? alpha : 0.06);
      });
    }

    function driftToRest(segments) {
      segments.forEach(({ boneName }) => {
        const e = segBones[boneName];
        if (e) e.bone.quaternion.slerp(e.restQuat, 0.06);
      });
    }

    // ── Body / upper limbs ──────────────────────────────────────────────
    if (isLmSet(poseLm)) {
      driveSegments(poseLm, BODY_SEGMENTS, 0.25);
    } else {
      driftToRest(BODY_SEGMENTS);
    }

    // ── Left fingers ────────────────────────────────────────────────────
    if (isLmSet(leftLm)) {
      driveSegments(leftLm, LEFT_HAND_SEGMENTS, 0.5);
    } else {
      driftToRest(LEFT_HAND_SEGMENTS);
    }

    // ── Right fingers ───────────────────────────────────────────────────
    if (isLmSet(rightLm)) {
      driveSegments(rightLm, RIGHT_HAND_SEGMENTS, 0.5);
    } else {
      driftToRest(RIGHT_HAND_SEGMENTS);
    }

    // ── Head rotation from face mesh ────────────────────────────────────
    if (isLmSet(faceLm)) {
      if (faceBones.head) {
        const e = faceBones.head;
        const q = faceHeadQuat(faceLm, e.bone);
        e.bone.quaternion.slerp(q ?? e.restQuat, q ? 0.3 : 0.06);
      }
    } else {
      if (faceBones.head) faceBones.head.bone.quaternion.slerp(faceBones.head.restQuat, 0.06);
    }

    // ── Morph targets: mouth & blink ─────────────────────────────────
    const mState = morphStateRef.current;
    const morphMeshes = morphMeshesRef.current;
    if (morphMeshes.length > 0) {
      // Compute target morph values from face landmarks
      const targetMouth = isLmSet(faceLm) ? faceMouthOpen(faceLm) : 0;
      const targetBlink = isLmSet(faceLm) ? faceBlinkRatio(faceLm) : 0;

      // Smooth interpolation
      mState.mouthOpen += (targetMouth - mState.mouthOpen) * 0.35;
      mState.blink     += (targetBlink - mState.blink)     * 0.4;

      // Apply to all morph meshes
      // Mouth: try Japanese name first, then English
      const MOUTH_NAMES = ['\u3042', 'a'];      // あ or a
      const BLINK_NAMES = ['\u307E\u3070\u305F\u304D', 'blink']; // まばたき or blink

      for (const { mesh, dict } of morphMeshes) {
        // Mouth opening
        for (const name of MOUTH_NAMES) {
          const idx = dict[name];
          if (idx !== undefined) {
            mesh.morphTargetInfluences[idx] = mState.mouthOpen;
            break;
          }
        }
        // Eye blink
        for (const name of BLINK_NAMES) {
          const idx = dict[name];
          if (idx !== undefined) {
            mesh.morphTargetInfluences[idx] = mState.blink;
            break;
          }
        }
      }
    }
  });

  return (
    <primitive
      object={scene}
      scale={0.1}
      position={[0, -1.35, 0]}
    />
  );
}

useGLTF.preload(GLB_PATH);