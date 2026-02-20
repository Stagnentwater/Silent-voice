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

const GLB_PATH = '/connor_rk900_-_detroit_become_human.glb';
const TARGET_FRAME_MS = 100; // ~10 fps, matches PoseRenderer2D

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
function lerpArr(a, b, t) {
  if (!a || !b || a.length !== b.length) return a || b || null;
  return a.map((lA, i) => {
    const lB = b[i];
    if (!lA || !lB) return lA || lB;
    return {
      x: lA.x + (lB.x - lA.x) * t,
      y: lA.y + (lB.y - lA.y) * t,
      z: (lA.z ?? 0) + ((lB.z ?? 0) - (lA.z ?? 0)) * t,
    };
  });
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

// ─── Bone rotation helpers ───────────────────────────────────────────────────
const _up   = new THREE.Vector3(0, 1, 0);
const _dir  = new THREE.Vector3();
const _q    = new THREE.Quaternion();
const _pInv = new THREE.Quaternion();
const _m4   = new THREE.Matrix4();

/** Local-space quaternion that rotates bone +Y toward (lm[to] - lm[from]). */
function segmentQuat(lmArray, fromIdx, toIdx, bone) {
  const lmF = lmArray[fromIdx];
  const lmT = lmArray[toIdx];
  if (!lmF || !lmT) return null;

  const vF = mpToV3(lmF);
  const vT = mpToV3(lmT);
  _dir.subVectors(vT, vF);
  if (_dir.lengthSq() < 1e-8) return null;
  _dir.normalize();

  _q.setFromUnitVectors(_up, _dir);

  if (bone.parent) {
    bone.parent.updateWorldMatrix(true, false);
    _m4.extractRotation(bone.parent.matrixWorld);
    _pInv.setFromRotationMatrix(_m4).invert();
    _q.premultiply(_pInv);
  }
  return _q.clone();
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

  const upDir    = vTop.clone().sub(vBot).normalize();           // chin → forehead = +Y
  const rightDir = vRgt.clone().sub(vLft).normalize();           // left → right   = +X
  const fwdDir   = upDir.clone().cross(rightDir).normalize();    // +Z

  const m = new THREE.Matrix4();
  m.makeBasis(rightDir, upDir, fwdDir);
  const worldQ = new THREE.Quaternion().setFromRotationMatrix(m);

  if (headBone.parent) {
    headBone.parent.updateWorldMatrix(true, false);
    _m4.extractRotation(headBone.parent.matrixWorld);
    _pInv.setFromRotationMatrix(_m4).invert();
    worldQ.premultiply(_pInv);
  }
  return worldQ;
}

/**
 * Compute jaw rotation from mouth openness.
 * Jaw opens by rotating around local +X axis.
 */
function faceJawQuat(faceLm, jawRestQuat) {
  const fi      = FACE_LM;
  const upper   = faceLm[fi.UPPER_LIP];
  const lower   = faceLm[fi.LOWER_LIP];
  const fHead   = faceLm[fi.FOREHEAD_TOP];
  const fChin   = faceLm[fi.CHIN_BOTTOM];
  if (!upper || !lower || !fHead || !fChin) return jawRestQuat.clone();

  const mouthGap   = Math.abs(lower.y - upper.y);
  const faceHeight = Math.abs(fChin.y - fHead.y);
  const openRatio  = faceHeight > 0.01 ? mouthGap / faceHeight : 0;

  // Map ratio to at most ~35 degrees
  const angle = Math.min(openRatio * Math.PI * 2.2, Math.PI / 5.2);
  const deltaQ = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0), angle
  );
  return jawRestQuat.clone().multiply(deltaQ);
}

// ─── Component ───────────────────────────────────────────────────────────────
export function AvatarModel3D({ posePacket }) {
  const { scene } = useGLTF(GLB_PATH);

  // All segment bones: { boneName: { bone, restQuat } }
  const segmentBonesRef = useRef({});
  // Face bones
  const faceBoneRef = useRef({ head: null, jaw: null });

  // Sequence tracking
  const packetRef   = useRef(null); // { packet, startMs }

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

    const segBones = {};
    const allSegments = [
      ...BODY_SEGMENTS,
      ...LEFT_HAND_SEGMENTS,
      ...RIGHT_HAND_SEGMENTS,
    ];
    allSegments.forEach(({ boneName }) => {
      const bone = resolveBoneName(boneName, allBones);
      if (bone) {
        segBones[boneName] = { bone, restQuat: bone.quaternion.clone() };
      } else {
        console.warn(`[AvatarModel3D] not found: "${boneName}"`);
      }
    });
    segmentBonesRef.current = segBones;

    const headBone = resolveBoneName(FACE_BONE_NAMES.head, allBones);
    const jawBone  = resolveBoneName(FACE_BONE_NAMES.jaw,  allBones);
    faceBoneRef.current = {
      head: headBone ? { bone: headBone, restQuat: headBone.quaternion.clone() } : null,
      jaw:  jawBone  ? { bone: jawBone,  restQuat: jawBone.quaternion.clone()  } : null,
    };
  }, [scene]);

  // ── Track current packet + record start time ───────────────────────────
  useEffect(() => {
    if (posePacket) {
      packetRef.current = { packet: posePacket, startMs: null };
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
    if (entry.startMs === null) entry.startMs = nowMs;

    const frame = getFrameAtTime(entry.packet, nowMs - entry.startMs);
    if (!frame) return;

    const poseLm  = frame.pose_landmarks;
    const leftLm  = frame.left_hand_landmarks;
    const rightLm = frame.right_hand_landmarks;
    const faceLm  = frame.face_landmarks;

    // ── Body / limbs ────────────────────────────────────────────────────
    if (Array.isArray(poseLm)) {
      BODY_SEGMENTS.forEach(({ boneName, from, to }) => {
        const entry2 = segBones[boneName];
        if (!entry2) return;
        const { bone, restQuat } = entry2;
        const q = segmentQuat(poseLm, from, to, bone);
        bone.quaternion.slerp(q ?? restQuat, q ? 0.35 : 0.06);
      });
    }

    // ── Left fingers ────────────────────────────────────────────────────
    if (Array.isArray(leftLm) && leftLm.length >= 21) {
      LEFT_HAND_SEGMENTS.forEach(({ boneName, from, to }) => {
        const entry2 = segBones[boneName];
        if (!entry2) return;
        const { bone, restQuat } = entry2;
        const q = segmentQuat(leftLm, from, to, bone);
        bone.quaternion.slerp(q ?? restQuat, q ? 0.5 : 0.06);
      });
    } else {
      // No hand data — drift fingers to rest
      LEFT_HAND_SEGMENTS.forEach(({ boneName }) => {
        const entry2 = segBones[boneName];
        if (entry2) entry2.bone.quaternion.slerp(entry2.restQuat, 0.06);
      });
    }

    // ── Right fingers ───────────────────────────────────────────────────
    if (Array.isArray(rightLm) && rightLm.length >= 21) {
      RIGHT_HAND_SEGMENTS.forEach(({ boneName, from, to }) => {
        const entry2 = segBones[boneName];
        if (!entry2) return;
        const { bone, restQuat } = entry2;
        const q = segmentQuat(rightLm, from, to, bone);
        bone.quaternion.slerp(q ?? restQuat, q ? 0.5 : 0.06);
      });
    } else {
      RIGHT_HAND_SEGMENTS.forEach(({ boneName }) => {
        const entry2 = segBones[boneName];
        if (entry2) entry2.bone.quaternion.slerp(entry2.restQuat, 0.06);
      });
    }

    // ── Head rotation from face mesh ────────────────────────────────────
    if (Array.isArray(faceLm) && faceLm.length >= 468) {
      if (faceBones.head) {
        const { bone, restQuat } = faceBones.head;
        const q = faceHeadQuat(faceLm, bone);
        bone.quaternion.slerp(q ?? restQuat, q ? 0.3 : 0.06);
      }

      // ── Jaw (mouth open/close) ─────────────────────────────────────
      if (faceBones.jaw) {
        const { bone } = faceBones.jaw;
        const q = faceJawQuat(faceLm, faceBones.jaw.restQuat);
        bone.quaternion.slerp(q, 0.4);
      }
    } else {
      // No face data — restore head/jaw to rest
      if (faceBones.head) faceBones.head.bone.quaternion.slerp(faceBones.head.restQuat, 0.06);
      if (faceBones.jaw)  faceBones.jaw.bone.quaternion.slerp(faceBones.jaw.restQuat,  0.06);
    }
  });

  return (
    <primitive
      object={scene}
      scale={1.6}
      position={[0, -1.5, 0]}
    />
  );
}

useGLTF.preload(GLB_PATH);
