/**
 * MediaPipe landmark → GLB bone mapping.
 * Bone names are the EXACT strings from the Shouko GLB skeleton (MMD/PMX export).
 *
 * Landmark sources per frame:
 *   pose_landmarks       – 33 body points  (index = integer key in sparse obj)
 *   left_hand_landmarks  – 21 hand points
 *   right_hand_landmarks – 21 hand points
 *   face_landmarks       – 468 face-mesh points
 */

// ─── Upper-body segments only (source: pose_landmarks, 33 pts) ──────────────
// We only have pose data for upper body, so lower body stays in rest pose.
// MediaPipe pose indices used:
//  0 nose  11 L-shoulder  12 R-shoulder  13 L-elbow   14 R-elbow
// 15 L-wrist  16 R-wrist

export const BODY_SEGMENTS = [
  // Left arm
  { boneName: 'Arm_L',   from: 11, to: 13 },
  { boneName: 'Elbow_L', from: 13, to: 15 },

  // Right arm
  { boneName: 'Arm_R',   from: 12, to: 14 },
  { boneName: 'Elbow_R', from: 14, to: 16 },

  // Neck
  { boneName: 'Neck', from: 12, to: 0 },
];

// ─── Left hand finger segments (source: left_hand_landmarks, 21 pts) ─────────
// 0 Wrist
// 1 ThumbCMC  2 ThumbMCP  3 ThumbIP   4 ThumbTip
// 5 IndexMCP  6 IndexPIP  7 IndexDIP  8 IndexTip
// 9 MiddleMCP 10 MiddlePIP 11 MiddleDIP 12 MiddleTip
// 13 RingMCP  14 RingPIP  15 RingDIP  16 RingTip
// 17 PinkyMCP 18 PinkyPIP 19 PinkyDIP 20 PinkyTip
// (Bone4 = tip leaf = no rotation needed)

export const LEFT_HAND_SEGMENTS = [
  { boneName: 'Thumb0_L',        from: 1,  to: 2  },
  { boneName: 'Thumb1_L',        from: 2,  to: 3  },
  { boneName: 'Thumb2_L',        from: 3,  to: 4  },

  { boneName: 'IndexFinger1_L',  from: 5,  to: 6  },
  { boneName: 'IndexFinger2_L',  from: 6,  to: 7  },
  { boneName: 'IndexFinger3_L',  from: 7,  to: 8  },

  { boneName: 'MiddleFinger1_L', from: 9,  to: 10 },
  { boneName: 'MiddleFinger2_L', from: 10, to: 11 },
  { boneName: 'MiddleFinger3_L', from: 11, to: 12 },

  { boneName: 'RingFinger1_L',   from: 13, to: 14 },
  { boneName: 'RingFinger2_L',   from: 14, to: 15 },
  { boneName: 'RingFinger3_L',   from: 15, to: 16 },

  { boneName: 'LittleFinger1_L', from: 17, to: 18 },
  { boneName: 'LittleFinger2_L', from: 18, to: 19 },
  { boneName: 'LittleFinger3_L', from: 19, to: 20 },
];

// ─── Right hand finger segments (source: right_hand_landmarks, 21 pts) ────────

export const RIGHT_HAND_SEGMENTS = [
  { boneName: 'Thumb0_R',        from: 1,  to: 2  },
  { boneName: 'Thumb1_R',        from: 2,  to: 3  },
  { boneName: 'Thumb2_R',        from: 3,  to: 4  },

  { boneName: 'IndexFinger1_R',  from: 5,  to: 6  },
  { boneName: 'IndexFinger2_R',  from: 6,  to: 7  },
  { boneName: 'IndexFinger3_R',  from: 7,  to: 8  },

  { boneName: 'MiddleFinger1_R', from: 9,  to: 10 },
  { boneName: 'MiddleFinger2_R', from: 10, to: 11 },
  { boneName: 'MiddleFinger3_R', from: 11, to: 12 },

  { boneName: 'RingFinger1_R',   from: 13, to: 14 },
  { boneName: 'RingFinger2_R',   from: 14, to: 15 },
  { boneName: 'RingFinger3_R',   from: 15, to: 16 },

  { boneName: 'LittleFinger1_R', from: 17, to: 18 },
  { boneName: 'LittleFinger2_R', from: 18, to: 19 },
  { boneName: 'LittleFinger3_R', from: 19, to: 20 },
];

// ─── Face-driven bones ────────────────────────────────────────────────────────
// Shouko has no jaw bone — mouth opening is driven by morph targets instead.

export const FACE_BONE_NAMES = {
  head: 'Head',
  jaw:  null,   // mouth driven via morph targets (あ/a, い/i, う/u, え/e, お/o)
};

// Key face-mesh landmark indices used for head orientation
export const FACE_LM = {
  FOREHEAD_TOP:    10,
  CHIN_BOTTOM:    152,
  FACE_LEFT:      234,
  FACE_RIGHT:     454,
  NOSE_TIP:         4,
  LEFT_EYE_OUTER:  33,
  RIGHT_EYE_OUTER: 263,
  UPPER_LIP:       13,
  LOWER_LIP:       14,
};

// ─── Bone name resolver ───────────────────────────────────────────────────────
// Shouko bone names are clean (no prefixes). Direct lookup with case-insensitive fallback.
export function resolveBoneName(canonical, boneMap) {
  if (!canonical) return null;
  // 1. Exact match
  if (boneMap[canonical]) return boneMap[canonical];
  // 2. Case-insensitive match
  const lc = canonical.toLowerCase();
  const ciKey = Object.keys(boneMap).find((k) => k.toLowerCase() === lc);
  if (ciKey) return boneMap[ciKey];
  // 3. Strip common Blender GLB prefixes (e.g. "Armature_Arm_L" → "Arm_L")
  const suffixKey = Object.keys(boneMap).find((k) => {
    const kl = k.toLowerCase();
    return kl.endsWith(lc) && (kl.length === lc.length || kl[kl.length - lc.length - 1] === '_');
  });
  return suffixKey ? boneMap[suffixKey] : null;
}