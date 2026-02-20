/**
 * Comprehensive MediaPipe landmark → GLB bone mapping.
 *
 * Landmark sources per frame:
 *   pose_landmarks       – 33 body points
 *   left_hand_landmarks  – 21 left-hand points
 *   right_hand_landmarks – 21 right-hand points
 *   face_landmarks       – 468 face-mesh points
 *
 * Each segment = { boneName, from, to }
 * The bone is rotated so its local +Y axis points from lm[from] → lm[to].
 *
 * BONE NAME NOTE:
 *   Standard humanoid bone names are listed here.  Many GLBs prefix them with
 *   "mixamorig:" (Mixamo) or use snake_case / camelCase variants.
 *   resolveBoneName() tries common variants automatically.
 *   Run the app in 3D mode and check the browser console — it will print
 *   every bone name in the GLB so you can verify or fix the names below.
 */

// ─── Body / spine / limb segments (source: pose_landmarks, 33 pts) ───────────
// MediaPipe pose indices:
//  0 nose   11 L-shoulder  12 R-shoulder  13 L-elbow   14 R-elbow
// 15 L-wrist 16 R-wrist   17 L-pinky     18 R-pinky
// 23 L-hip  24 R-hip      25 L-knee      26 R-knee
// 27 L-ankle 28 R-ankle   31 L-foot      32 R-foot

export const BODY_SEGMENTS = [
  // Torso
  { boneName: 'Hips',  from: 23, to: 24 },  // L-hip → R-hip (pelvis baseline)
  { boneName: 'Spine', from: 23, to: 11 },  // L-hip → L-shoulder (lateral spine)

  // Neck base (from pose)
  { boneName: 'Neck', from: 12, to: 0 },    // R-shoulder → nose (upward neck direction)

  // Left arm
  { boneName: 'LeftArm',     from: 11, to: 13 },
  { boneName: 'LeftForeArm', from: 13, to: 15 },
  { boneName: 'LeftHand',    from: 15, to: 17 }, // wrist → pinky (wrist orientation)

  // Right arm
  { boneName: 'RightArm',     from: 12, to: 14 },
  { boneName: 'RightForeArm', from: 14, to: 16 },
  { boneName: 'RightHand',    from: 16, to: 18 },

  // Left leg
  { boneName: 'LeftUpLeg', from: 23, to: 25 },
  { boneName: 'LeftLeg',   from: 25, to: 27 },
  { boneName: 'LeftFoot',  from: 27, to: 31 },

  // Right leg
  { boneName: 'RightUpLeg', from: 24, to: 26 },
  { boneName: 'RightLeg',   from: 26, to: 28 },
  { boneName: 'RightFoot',  from: 28, to: 32 },
];

// ─── Left hand finger segments (source: left_hand_landmarks, 21 pts) ─────────
// 0 Wrist
// 1 ThumbCMC  2 ThumbMCP  3 ThumbIP  4 ThumbTip
// 5 IndexMCP  6 IndexPIP  7 IndexDIP  8 IndexTip
// 9 MiddleMCP 10 MiddlePIP 11 MiddleDIP 12 MiddleTip
// 13 RingMCP  14 RingPIP  15 RingDIP  16 RingTip
// 17 PinkyMCP 18 PinkyPIP 19 PinkyDIP 20 PinkyTip

export const LEFT_HAND_SEGMENTS = [
  { boneName: 'LeftHandThumb1',  from: 1,  to: 2  },
  { boneName: 'LeftHandThumb2',  from: 2,  to: 3  },
  { boneName: 'LeftHandThumb3',  from: 3,  to: 4  },

  { boneName: 'LeftHandIndex1',  from: 5,  to: 6  },
  { boneName: 'LeftHandIndex2',  from: 6,  to: 7  },
  { boneName: 'LeftHandIndex3',  from: 7,  to: 8  },

  { boneName: 'LeftHandMiddle1', from: 9,  to: 10 },
  { boneName: 'LeftHandMiddle2', from: 10, to: 11 },
  { boneName: 'LeftHandMiddle3', from: 11, to: 12 },

  { boneName: 'LeftHandRing1',   from: 13, to: 14 },
  { boneName: 'LeftHandRing2',   from: 14, to: 15 },
  { boneName: 'LeftHandRing3',   from: 15, to: 16 },

  { boneName: 'LeftHandPinky1',  from: 17, to: 18 },
  { boneName: 'LeftHandPinky2',  from: 18, to: 19 },
  { boneName: 'LeftHandPinky3',  from: 19, to: 20 },
];

// ─── Right hand finger segments (source: right_hand_landmarks, 21 pts) ────────

export const RIGHT_HAND_SEGMENTS = [
  { boneName: 'RightHandThumb1',  from: 1,  to: 2  },
  { boneName: 'RightHandThumb2',  from: 2,  to: 3  },
  { boneName: 'RightHandThumb3',  from: 3,  to: 4  },

  { boneName: 'RightHandIndex1',  from: 5,  to: 6  },
  { boneName: 'RightHandIndex2',  from: 6,  to: 7  },
  { boneName: 'RightHandIndex3',  from: 7,  to: 8  },

  { boneName: 'RightHandMiddle1', from: 9,  to: 10 },
  { boneName: 'RightHandMiddle2', from: 10, to: 11 },
  { boneName: 'RightHandMiddle3', from: 11, to: 12 },

  { boneName: 'RightHandRing1',   from: 13, to: 14 },
  { boneName: 'RightHandRing2',   from: 14, to: 15 },
  { boneName: 'RightHandRing3',   from: 15, to: 16 },

  { boneName: 'RightHandPinky1',  from: 17, to: 18 },
  { boneName: 'RightHandPinky2',  from: 18, to: 19 },
  { boneName: 'RightHandPinky3',  from: 19, to: 20 },
];

// ─── Face-driven bones ────────────────────────────────────────────────────────
// Computed with custom geometry in AvatarModel3D (not a simple two-point vector).

export const FACE_BONE_NAMES = {
  head: 'Head',
  jaw:  'Jaw',
};

// Key face-mesh landmark indices
export const FACE_LM = {
  FOREHEAD_TOP:    10,
  CHIN_BOTTOM:    152,
  FACE_LEFT:      234,   // left cheek oval
  FACE_RIGHT:     454,   // right cheek oval
  NOSE_TIP:         4,
  LEFT_EYE_OUTER:  33,
  RIGHT_EYE_OUTER: 263,
  UPPER_LIP:       13,
  LOWER_LIP:       14,
};

// ─── Bone name resolver ───────────────────────────────────────────────────────
/**
 * Try several naming conventions used by different exporters / rigs:
 *  - Exact match (standard humanoid)
 *  - mixamorig:BoneName  (Adobe Mixamo)
 *  - mixamorig_BoneName
 *  - lowercased
 *  - snake_case
 */
export function resolveBoneName(canonical, boneMap) {
  const try_ = (n) => boneMap[n] || null;
  return (
    try_(canonical) ||
    try_(`mixamorig:${canonical}`) ||
    try_(`mixamorig_${canonical}`) ||
    try_(canonical.toLowerCase()) ||
    try_(canonical.replace(/([A-Z])/g, '_$1').replace(/^_/, '').toLowerCase()) ||
    null
  );
}
