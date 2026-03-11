/**
 * MediaPipe landmark → GLB bone mapping for Shouko model.
 * Bone names match the `blender` column in shoko.csv.
 *
 * Landmark sources per frame (sparse-object with string keys):
 *   pose_landmarks       – indices 0,11,12,13,14,15,16,23,24
 *   left_hand_landmarks  – indices 0–20
 *   right_hand_landmarks – indices 0–20
 *   face_landmarks       – ~120 face-mesh contour points
 *
 * Bone hierarchy (relevant chain):
 *   UpperBody → UpperBody2 → Neck → Head
 *   Shoulder_L → Arm_L → ArmTwist_L → Elbow_L → HandTwist_L → Wrist_L → fingers
 *   Shoulder_R → Arm_R → ArmTwist_R → Elbow_R → HandTwist_R → Wrist_R → fingers
 */

// ─── Upper-body segments (source: pose_landmarks) ───────────────────────────
// MediaPipe pose indices used:
//  0 nose  11 L-shoulder  12 R-shoulder  13 L-elbow  14 R-elbow
// 15 L-wrist  16 R-wrist  23 L-hip  24 R-hip
// 'MID_SHOULDER' = virtual midpoint of 11+12 (computed at runtime)
// 'MID_HIP'      = virtual midpoint of 23+24 (computed at runtime)

export const BODY_SEGMENTS = [
  // Torso
  { boneName: 'UpperBody',  from: 'MID_HIP',      to: 'MID_SHOULDER' },
  { boneName: 'UpperBody2', from: 'MID_HIP',      to: 'MID_SHOULDER' },

  // Neck  (shoulder midpoint → nose)
  { boneName: 'Neck', from: 'MID_SHOULDER', to: 0 },

  // Shoulders (midpoint → shoulder joint)
  { boneName: 'Shoulder_L', from: 'MID_SHOULDER', to: 11 },
  { boneName: 'Shoulder_R', from: 'MID_SHOULDER', to: 12 },

  // Upper arms
  { boneName: 'Arm_L',   from: 11, to: 13 },
  { boneName: 'Arm_R',   from: 12, to: 14 },

  // Forearms
  { boneName: 'Elbow_L', from: 13, to: 15 },
  { boneName: 'Elbow_R', from: 14, to: 16 },

  // Wrists (pose wrist → hand landmark 9 = middle-finger MCP)
  // Resolved specially: uses left/right_hand_landmarks for the 'to' end.
  { boneName: 'Wrist_L', from: 15, to: 'HAND_MID_L' },
  { boneName: 'Wrist_R', from: 16, to: 'HAND_MID_R' },
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

export const FACE_BONE_NAMES = {
  head: 'Head',
  jaw:  null,   // no jaw bone — face driven by morph targets
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

// ─── Facial Morph Target Plan (NOT YET IMPLEMENTED) ──────────────────────────
// Available morph targets in shoko.glb (from shoko.csv MORPH rows):
//
// MOUTH VISEMES (vowel shapes):
//   'あ' / 'a'  — mouth open (driven by lip separation ratio)
//   'い' / 'i'  — wide mouth
//   'う' / 'u'  — pursed lips
//   'え' / 'e'  — half-open
//   'お' / 'o'  — round mouth
//   'upperlip', 'lowerlip', 'smooch', 'smile', 'mouth_worrie'
//   '口横広げ' / 'Wide' — horizontal stretch
//   '∧' / 'No' — closed/clenched
//
// EYE BLINK:
//   'まばたき' / 'blink'          — both eyes close
//   'ウィンク２' / 'Blink_R'       — right eye close
//   'ｳｨﾝｸ２右' / 'Blink_L'        — left eye close
//   'ウィンク' / 'Wink_R'          — right eye wink (with expression)
//   'ウィンク右' / 'Wink_L'        — left eye wink
//   'eye_blink upper'              — upper lid only
//   'eyeclose R', 'eyeclose L'     — per-eye close
//
// EYEBROWS:
//   'eyebrow up L', 'eyebrow up R'     — raise
//   'eyebrow down L', 'eyebrow down R' — lower
//
// EXPRESSIONS:
//   '怒り' / 'anger'    — angry brows
//   '困る' / 'sadness'  — sad brows
//   'にこり' / 'cheerful' — happy eyes
//   '真面目' / 'serious'  — neutral/serious
//   'びっくり' / 'surprise' — wide eyes
//   '敵意' / 'Angry'      — hostile
//   'じと目' / 'doubt'    — suspicious squint
//   '笑い' / 'smile'      — smile (eyes)
//   '悲しむ' / 'Wail'     — crying
//   'にっこり' / 'Smiley'  — happy smile
//
// IMPLEMENTATION APPROACH (for future):
//   1. Mouth: compute lip-separation ratio from face landmarks 13/14
//      → drive 'あ' (open) and '口横広げ' (wide) morphs
//   2. Blink: compute eyelid gap from landmarks 159/145 (L) and 386/374 (R)
//      → drive 'まばたき' for both-eye blink, or per-eye Blink_L/R
//   3. Eyebrows: landmarks 70/300 height relative to eye center
//      → drive 'eyebrow up/down L/R' morphs
//   4. Smile: detect mouth corner lift from landmarks 61/291
//      → drive 'にっこり' or 'smile' morph
// ─────────────────────────────────────────────────────────────────────────────

// ─── Japanese ↔ English bone name variants (from shoko.csv) ─────────────────
// Used as fallback when the GLB uses Japanese names instead of English.
const BONE_ALIASES = {
  UpperBody:       ['上半身'],
  UpperBody2:      ['上半身2'],
  Neck:            ['首'],
  Head:            ['頭'],
  Shoulder_L:      ['左肩'],
  Arm_L:           ['左腕'],
  Elbow_L:         ['左ひじ'],
  Wrist_L:         ['左手首'],
  Shoulder_R:      ['右肩'],
  Arm_R:           ['右腕'],
  Elbow_R:         ['右ひじ'],
  Wrist_R:         ['右手首'],
  Thumb0_L:        ['左親指０'],
  Thumb1_L:        ['左親指１'],
  Thumb2_L:        ['左親指２'],
  IndexFinger1_L:  ['左人指１'],
  IndexFinger2_L:  ['左人指２'],
  IndexFinger3_L:  ['左人指３'],
  MiddleFinger1_L: ['左中指１'],
  MiddleFinger2_L: ['左中指２'],
  MiddleFinger3_L: ['左中指３'],
  RingFinger1_L:   ['左薬指１'],
  RingFinger2_L:   ['左薬指２'],
  RingFinger3_L:   ['左薬指３'],
  LittleFinger1_L: ['左小指１'],
  LittleFinger2_L: ['左小指２'],
  LittleFinger3_L: ['左小指３'],
  Thumb0_R:        ['右親指０'],
  Thumb1_R:        ['右親指１'],
  Thumb2_R:        ['右親指２'],
  IndexFinger1_R:  ['右人指１'],
  IndexFinger2_R:  ['右人指２'],
  IndexFinger3_R:  ['右人指３'],
  MiddleFinger1_R: ['右中指１'],
  MiddleFinger2_R: ['右中指２'],
  MiddleFinger3_R: ['右中指３'],
  RingFinger1_R:   ['右薬指１'],
  RingFinger2_R:   ['右薬指２'],
  RingFinger3_R:   ['右薬指３'],
  LittleFinger1_R: ['右小指１'],
  LittleFinger2_R: ['右小指２'],
  LittleFinger3_R: ['右小指３'],
};

// ─── Bone name resolver ───────────────────────────────────────────────────────
export function resolveBoneName(canonical, boneMap) {
  if (!canonical) return null;
  // 1. Exact match
  if (boneMap[canonical]) return boneMap[canonical];
  // 2. Case-insensitive match
  const lc = canonical.toLowerCase();
  const ciKey = Object.keys(boneMap).find((k) => k.toLowerCase() === lc);
  if (ciKey) return boneMap[ciKey];
  // 3. Japanese alias fallback
  const aliases = BONE_ALIASES[canonical];
  if (aliases) {
    for (const alias of aliases) {
      if (boneMap[alias]) return boneMap[alias];
    }
  }
  // 4. Strip common Blender GLB prefixes (e.g. "Armature_Arm_L" → "Arm_L")
  const suffixKey = Object.keys(boneMap).find((k) => {
    const kl = k.toLowerCase();
    return kl.endsWith(lc) && (kl.length === lc.length || kl[kl.length - lc.length - 1] === '_');
  });
  return suffixKey ? boneMap[suffixKey] : null;
}