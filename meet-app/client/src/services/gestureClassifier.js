/**
 * Heuristic ASL (American Sign Language) hand-shape classifier.
 * Works on a single MediaPipe Hands landmark result (21 points, index 0-20).
 *
 * Landmarks layout:
 *   0  WRIST
 *   1-4   THUMB  (CMC, MCP, IP, TIP)
 *   5-8   INDEX  (MCP, PIP, DIP, TIP)
 *   9-12  MIDDLE (MCP, PIP, DIP, TIP)
 *  13-16  RING   (MCP, PIP, DIP, TIP)
 *  17-20  PINKY  (MCP, PIP, DIP, TIP)
 */

// Euclidean 2-D distance between two landmarks
function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Returns an object with boolean extension flags for each digit.
 * "Extended" means the finger tip is notably further from the wrist than the PIP joint.
 */
function fingerExtensions(lm) {
  const wrist = lm[0];

  // Thumb: compare TIP vs IP distance from wrist, and horizontal project
  const thumbExtended =
    dist(lm[4], wrist) > dist(lm[2], wrist) * 1.1;

  // For the 4 fingers, compare TIP distance to wrist vs PIP distance
  const indexExtended  = dist(lm[8],  wrist) > dist(lm[6],  wrist) * 1.05;
  const middleExtended = dist(lm[12], wrist) > dist(lm[10], wrist) * 1.05;
  const ringExtended   = dist(lm[16], wrist) > dist(lm[14], wrist) * 1.05;
  const pinkyExtended  = dist(lm[20], wrist) > dist(lm[18], wrist) * 1.05;

  // Curl: tip is BELOW (in y) the MCP joint (hand facing camera, y grows down)
  const indexCurled  = lm[8].y  > lm[5].y;
  const middleCurled = lm[12].y > lm[9].y;

  // Spread: Are index & middle finger tips noticeably apart?
  const imSpread = dist(lm[8], lm[12]) > dist(lm[5], lm[9]) * 0.8;
  const mvSpread = dist(lm[12], lm[16]) > dist(lm[9], lm[13]) * 0.8;

  // Touching: are thumb tip and another fingertip close?
  const thumbIndexTouch  = dist(lm[4], lm[8])  < dist(lm[3], lm[5]) * 0.6;
  const thumbMiddleTouch = dist(lm[4], lm[12]) < dist(lm[3], lm[9]) * 0.6;

  return {
    thumbExtended,
    indexExtended,
    middleExtended,
    ringExtended,
    pinkyExtended,
    indexCurled,
    middleCurled,
    imSpread,
    mvSpread,
    thumbIndexTouch,
    thumbMiddleTouch,
  };
}

/**
 * Classify a single-frame hand shape into an ASL letter or word token.
 * Returns a string label or null if unclassified.
 *
 * @param {Array} landmarks - Array of 21 {x,y,z} landmarks from MediaPipe
 */
export function classifyHandShape(landmarks) {
  if (!landmarks || landmarks.length < 21) return null;

  const lm = landmarks;
  const f = fingerExtensions(lm);

  const {
    thumbExtended, indexExtended, middleExtended, ringExtended, pinkyExtended,
    indexCurled, middleCurled,
    imSpread, mvSpread,
    thumbIndexTouch, thumbMiddleTouch,
  } = f;

  const allFingersClosed = !indexExtended && !middleExtended && !ringExtended && !pinkyExtended;
  const allFingersOpen   = indexExtended && middleExtended && ringExtended && pinkyExtended;

  // --- Letter rules ---

  // A: fist with thumb resting on side (thumb NOT extended, all fingers closed)
  if (allFingersClosed && !thumbExtended) return 'A';

  // B: all 4 fingers up, thumb tucked in, fingers together
  if (allFingersOpen && !imSpread && !thumbExtended) return 'B';

  // C: curved hand — rough C shape, no full extension, fingers gently curled
  if (!allFingersClosed && !allFingersOpen && !thumbIndexTouch && !indexExtended && !pinkyExtended) return 'C';

  // D: index up, middle/ring/pinky closed, thumb touching middle
  if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended && thumbMiddleTouch) return 'D';

  // E: all fingers curled forward (tips near palm)
  if (indexCurled && middleCurled && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) return 'E';

  // F: index + thumb touch, other 3 up
  if (thumbIndexTouch && middleExtended && ringExtended && pinkyExtended) return 'F';

  // I: pinky only extended
  if (!indexExtended && !middleExtended && !ringExtended && pinkyExtended && !thumbExtended) return 'I';

  // L: index + thumb extended (L-shape), others curled
  if (thumbExtended && indexExtended && !middleExtended && !ringExtended && !pinkyExtended) return 'L';

  // O: round shape — thumb and index form circle (both partially)
  if (thumbIndexTouch && !middleExtended && !ringExtended && !pinkyExtended) return 'O';

  // U: index + middle up together (not spread)
  if (indexExtended && middleExtended && !imSpread && !ringExtended && !pinkyExtended && !thumbExtended) return 'U';

  // V: index + middle up and spread
  if (indexExtended && middleExtended && imSpread && !ringExtended && !pinkyExtended) return 'V';

  // W: index + middle + ring up
  if (indexExtended && middleExtended && ringExtended && !pinkyExtended && mvSpread) return 'W';

  // X: index hooked/curled, others closed
  if (indexCurled && !middleExtended && !ringExtended && !pinkyExtended) return 'X';

  // Y: thumb + pinky extended, others closed
  if (thumbExtended && !indexExtended && !middleExtended && !ringExtended && pinkyExtended) return 'Y';

  // HELLO gesture: all fingers open and spread wide
  if (allFingersOpen && imSpread && mvSpread && thumbExtended) return 'HELLO';

  return null;
}

/**
 * Given a circular frame buffer of shape labels (strings or null),
 * vote over the last windowSize frames and return the most common label
 * if it achieves at least minVotes.
 *
 * @param {Array<string|null>} frameBuffer
 * @param {number} windowSize
 * @param {number} minVotes
 */
export function classifySequence(frameBuffer, windowSize = 12, minVotes = 5) {
  if (!frameBuffer || frameBuffer.length === 0) return null;

  const window = frameBuffer.slice(-windowSize);
  const counts = {};
  for (const label of window) {
    if (!label) continue;
    counts[label] = (counts[label] || 0) + 1;
  }

  let best = null;
  let bestCount = 0;
  for (const [label, count] of Object.entries(counts)) {
    if (count > bestCount) {
      bestCount = count;
      best = label;
    }
  }

  return bestCount >= minVotes ? best : null;
}
