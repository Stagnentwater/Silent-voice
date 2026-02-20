/**
 * MediaPipe landmark → GLB bone mapping.
 * Bone names are the EXACT strings from the connor_rk900 GLB skeleton.
 *
 * Landmark sources per frame:
 *   pose_landmarks       – 33 body points  (index = integer key in sparse obj)
 *   left_hand_landmarks  – 21 hand points
 *   right_hand_landmarks – 21 hand points
 *   face_landmarks       – 468 face-mesh points
 */

// ─── Body / spine / limb segments (source: pose_landmarks, 33 pts) ───────────
// MediaPipe pose indices:
//  0 nose   11 L-shoulder  12 R-shoulder  13 L-elbow   14 R-elbow
// 15 L-wrist 16 R-wrist   17 L-pinky     18 R-pinky   19 L-index  20 R-index
// 23 L-hip  24 R-hip      25 L-knee      26 R-knee
// 27 L-ankle 28 R-ankle   31 L-foot      32 R-foot

export const BODY_SEGMENTS = [
  // Torso
  { boneName: 'mixamorigHips_01',      from: 23, to: 24 }, // L-hip → R-hip
  { boneName: 'mixamorigSpine_02',     from: 23, to: 12 }, // L-hip → R-shoulder
  { boneName: 'mixamorigSpine1_03',    from: 23, to: 12 }, // duplicate drive for mid-spine
  { boneName: 'mixamorigSpine2_04',    from: 11, to: 12 }, // L-shoulder → R-shoulder
  { boneName: 'mixamorigNeck_05',      from: 12, to: 0  }, // R-shoulder → nose

  // Left arm
  { boneName: 'mixamorigLeftShoulder_08',  from: 11, to: 13 },
  { boneName: 'mixamorigLeftArm_09',       from: 11, to: 13 },
  { boneName: 'mixamorigLeftForeArm_010',  from: 13, to: 15 },
  { boneName: 'mixamorigLeftHand_011',     from: 15, to: 19 }, // wrist → index knuckle

  // Right arm
  { boneName: 'mixamorigRightShoulder_032', from: 12, to: 14 },
  { boneName: 'mixamorigRightArm_033',      from: 12, to: 14 },
  { boneName: 'mixamorigRightForeArm_034',  from: 14, to: 16 },
  { boneName: 'mixamorigRightHand_035',     from: 16, to: 20 }, // wrist → index knuckle

  // Left leg
  { boneName: 'mixamorigLeftUpLeg_055',  from: 23, to: 25 },
  { boneName: 'mixamorigLeftLeg_056',    from: 25, to: 27 },
  { boneName: 'mixamorigLeftFoot_057',   from: 27, to: 31 },

  // Right leg
  { boneName: 'mixamorigRightUpLeg_060', from: 24, to: 26 },
  { boneName: 'mixamorigRightLeg_061',   from: 26, to: 28 },
  { boneName: 'mixamorigRightFoot_062',  from: 28, to: 32 },
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
  { boneName: 'mixamorigLeftHandThumb1_012',  from: 1,  to: 2  },
  { boneName: 'mixamorigLeftHandThumb2_013',  from: 2,  to: 3  },
  { boneName: 'mixamorigLeftHandThumb3_014',  from: 3,  to: 4  },

  { boneName: 'mixamorigLeftHandIndex1_016',  from: 5,  to: 6  },
  { boneName: 'mixamorigLeftHandIndex2_017',  from: 6,  to: 7  },
  { boneName: 'mixamorigLeftHandIndex3_018',  from: 7,  to: 8  },

  { boneName: 'mixamorigLeftHandMiddle1_020', from: 9,  to: 10 },
  { boneName: 'mixamorigLeftHandMiddle2_021', from: 10, to: 11 },
  { boneName: 'mixamorigLeftHandMiddle3_022', from: 11, to: 12 },

  { boneName: 'mixamorigLeftHandRing1_024',   from: 13, to: 14 },
  { boneName: 'mixamorigLeftHandRing2_025',   from: 14, to: 15 },
  { boneName: 'mixamorigLeftHandRing3_026',   from: 15, to: 16 },

  { boneName: 'mixamorigLeftHandPinky1_028',  from: 17, to: 18 },
  { boneName: 'mixamorigLeftHandPinky2_029',  from: 18, to: 19 },
  { boneName: 'mixamorigLeftHandPinky3_030',  from: 19, to: 20 },
];

// ─── Right hand finger segments (source: right_hand_landmarks, 21 pts) ────────

export const RIGHT_HAND_SEGMENTS = [
  { boneName: 'mixamorigRightHandThumb1_036',  from: 1,  to: 2  },
  { boneName: 'mixamorigRightHandThumb2_037',  from: 2,  to: 3  },
  { boneName: 'mixamorigRightHandThumb3_038',  from: 3,  to: 4  },

  { boneName: 'mixamorigRightHandIndex1_040',  from: 5,  to: 6  },
  { boneName: 'mixamorigRightHandIndex2_041',  from: 6,  to: 7  },
  { boneName: 'mixamorigRightHandIndex3_042',  from: 7,  to: 8  },

  { boneName: 'mixamorigRightHandMiddle1_044', from: 9,  to: 10 },
  { boneName: 'mixamorigRightHandMiddle2_045', from: 10, to: 11 },
  { boneName: 'mixamorigRightHandMiddle3_00',  from: 11, to: 12 }, // note: _00 suffix in this model

  { boneName: 'mixamorigRightHandRing1_047',   from: 13, to: 14 },
  { boneName: 'mixamorigRightHandRing2_048',   from: 14, to: 15 },
  { boneName: 'mixamorigRightHandRing3_049',   from: 15, to: 16 },

  { boneName: 'mixamorigRightHandPinky1_051',  from: 17, to: 18 },
  { boneName: 'mixamorigRightHandPinky2_052',  from: 18, to: 19 },
  { boneName: 'mixamorigRightHandPinky3_053',  from: 19, to: 20 },
];

// ─── Face-driven bones ────────────────────────────────────────────────────────
// This model has no Jaw bone — only head rotation is applied.

export const FACE_BONE_NAMES = {
  head: 'mixamorigHead_06',
  jaw:  null,                // no jaw bone in this rig
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
// Bone names above are already exact; this still handles any edge-cases.
export function resolveBoneName(canonical, boneMap) {
  if (!canonical) return null;
  // Direct exact lookup first (works for all hardcoded names above)
  if (boneMap[canonical]) return boneMap[canonical];
  // Fallback variants for generic/canonical names
  const try_ = (n) => boneMap[n] || null;
  return (
    try_(`mixamorig:${canonical}`) ||
    try_(`mixamorig_${canonical}`) ||
    try_(canonical.toLowerCase()) ||
    // Prefix scan: find any bone whose name starts with mixamorig + canonical (case-insensitive)
    Object.keys(boneMap).find((k) =>
      k.toLowerCase().startsWith(`mixamorig${canonical.toLowerCase()}`)
    ) && boneMap[Object.keys(boneMap).find((k) =>
      k.toLowerCase().startsWith(`mixamorig${canonical.toLowerCase()}`)
    )] ||
    null
  );
}
