const DEFAULT_TIMEOUT_MS = 7000;
const TARGET_FRAME_MS = 50;

const REQUIRED_POSE_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24];
const HAND_INDICES = Array.from({ length: 21 }, (_, index) => index);
const FACE_CONTOUR_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109,
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
  263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466,
  70, 63, 105, 66, 107, 55, 65, 52, 53, 46,
  336, 296, 334, 293, 300, 285, 295, 282, 283, 276,
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317,
  14, 87, 178, 88, 95, 185, 40, 39, 37, 0, 267, 269, 270, 409, 415, 310, 311,
  312, 13, 82, 81, 80, 191,
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13,
  82, 81, 80, 191,
  168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 327
];

function compactLandmarksByIndices(landmarks, indices) {
  if (!Array.isArray(landmarks)) {
    return null;
  }

  const compact = {};
  indices.forEach((index) => {
    const point = landmarks[index];
    if (!point) {
      return;
    }
    compact[index] = {
      x: Number(point.x),
      y: Number(point.y),
      z: Number(point.z ?? 0),
      visibility: Number(point.visibility ?? 0)
    };
  });

  return Object.keys(compact).length ? compact : null;
}

function buildFaceIndices(landmarks) {
  const total = Array.isArray(landmarks) ? landmarks.length : 0;
  if (!total) {
    return [];
  }

  return FACE_CONTOUR_INDICES.filter((index, position, all) => {
    return index >= 0 && index < total && all.indexOf(index) === position;
  });
}

function compactPoseLandmarks(landmarks) {
  return compactLandmarksByIndices(landmarks, REQUIRED_POSE_INDICES);
}

function compactHandLandmarks(landmarks) {
  return compactLandmarksByIndices(landmarks, HAND_INDICES);
}

function compactFaceLandmarks(landmarks) {
  const faceIndices = buildFaceIndices(landmarks);
  return compactLandmarksByIndices(landmarks, faceIndices);
}

function compactFrame(frame) {
  return {
    frame: Number(frame?.frame ?? 0),
    pose_landmarks: compactPoseLandmarks(frame?.pose_landmarks),
    face_landmarks: compactFaceLandmarks(frame?.face_landmarks),
    left_hand_landmarks: compactHandLandmarks(frame?.left_hand_landmarks),
    right_hand_landmarks: compactHandLandmarks(frame?.right_hand_landmarks)
  };
}

function withTimeout(signal, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId)
  };
}

export function createPoseClient(baseUrl) {
  const normalizedBase = (baseUrl || '').replace(/\/$/, '');

  return {
    async fetchPose(text, signal) {
      if (!text || !text.trim()) return null; 
      const { signal: timeoutSignal, clear } = withTimeout(signal, DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetch(`${normalizedBase}/pose`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, words: text }),
          signal: timeoutSignal
        });

        if (!response.ok) {
          throw new Error(`Pose server returned ${response.status}`);
        }

        const payload = await response.json();

        if (Array.isArray(payload.poseIds) && Array.isArray(payload.timings)) {
          return payload;
        }

        if (Array.isArray(payload)) {
          const poseFrames = payload.map((frame) => compactFrame(frame));
          const timings = payload.map((frame, index) => {
            const value = Number(frame?.frame);
            return Number.isFinite(value) ? value * TARGET_FRAME_MS : index * TARGET_FRAME_MS;
          });

          return { poseFrames, timings };
        }

        throw new Error('Invalid pose payload shape');
      } finally {
        clear();
      }
    }
  };
}
