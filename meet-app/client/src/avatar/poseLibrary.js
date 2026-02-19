const poseCache = new Map();

const DEFAULT_SKELETON = {
  head: { x: 0, y: -65 },
  neck: { x: 0, y: -40 },
  shoulderLeft: { x: -28, y: -30 },
  shoulderRight: { x: 28, y: -30 },
  elbowLeft: { x: -50, y: -10 },
  elbowRight: { x: 50, y: -10 },
  wristLeft: { x: -60, y: 20 },
  wristRight: { x: 60, y: 20 },
  hip: { x: 0, y: 10 }
};

function deterministicOffset(id, factor) {
  return Math.sin((id + 1) * factor) * 16;
}

function clonePose(pose) {
  const next = {};
  Object.keys(pose).forEach((joint) => {
    next[joint] = { ...pose[joint] };
  });
  return next;
}

function getLandmark(landmarks, index) {
  if (!landmarks) {
    return null;
  }

  if (Array.isArray(landmarks)) {
    return landmarks[index] || null;
  }

  if (typeof landmarks === 'object') {
    return landmarks[index] || landmarks[String(index)] || null;
  }

  return null;
}

function toCanvasPoint(landmark) {
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
    return null;
  }

  return {
    x: (landmark.x - 0.5) * 240,
    y: (landmark.y - 0.5) * 330
  };
}

function midpoint(a, b) {
  if (!a && !b) {
    return null;
  }
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }

  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

export function buildPoseFromId(poseId) {
  if (poseCache.has(poseId)) {
    return poseCache.get(poseId);
  }

  const pose = {
    ...DEFAULT_SKELETON,
    elbowLeft: {
      x: DEFAULT_SKELETON.elbowLeft.x + deterministicOffset(poseId, 0.75),
      y: DEFAULT_SKELETON.elbowLeft.y + deterministicOffset(poseId, 0.4)
    },
    elbowRight: {
      x: DEFAULT_SKELETON.elbowRight.x - deterministicOffset(poseId, 0.62),
      y: DEFAULT_SKELETON.elbowRight.y + deterministicOffset(poseId, 0.45)
    },
    wristLeft: {
      x: DEFAULT_SKELETON.wristLeft.x + deterministicOffset(poseId, 0.9),
      y: DEFAULT_SKELETON.wristLeft.y + deterministicOffset(poseId, 0.35)
    },
    wristRight: {
      x: DEFAULT_SKELETON.wristRight.x - deterministicOffset(poseId, 0.8),
      y: DEFAULT_SKELETON.wristRight.y + deterministicOffset(poseId, 0.5)
    }
  };

  poseCache.set(poseId, pose);
  return pose;
}

export function buildPoseFromLandmarkFrame(frame, fallbackPose = DEFAULT_SKELETON) {
  const safeFallback = clonePose(fallbackPose || DEFAULT_SKELETON);

  const poseLandmarks = frame?.pose_landmarks || null;
  const faceLandmarks = frame?.face_landmarks || null;

  const leftShoulder = toCanvasPoint(getLandmark(poseLandmarks, 11));
  const rightShoulder = toCanvasPoint(getLandmark(poseLandmarks, 12));
  const leftElbow = toCanvasPoint(getLandmark(poseLandmarks, 13));
  const rightElbow = toCanvasPoint(getLandmark(poseLandmarks, 14));
  const leftWrist = toCanvasPoint(getLandmark(poseLandmarks, 15));
  const rightWrist = toCanvasPoint(getLandmark(poseLandmarks, 16));
  const leftHip = toCanvasPoint(getLandmark(poseLandmarks, 23));
  const rightHip = toCanvasPoint(getLandmark(poseLandmarks, 24));

  const nose =
    toCanvasPoint(getLandmark(poseLandmarks, 0)) ||
    toCanvasPoint(getLandmark(faceLandmarks, 1));

  const neck = midpoint(leftShoulder, rightShoulder);
  const hip = midpoint(leftHip, rightHip);

  return {
    head: nose || safeFallback.head,
    neck:
      neck ||
      (nose
        ? {
            x: nose.x,
            y: nose.y + 24
          }
        : safeFallback.neck),
    shoulderLeft: leftShoulder || safeFallback.shoulderLeft,
    shoulderRight: rightShoulder || safeFallback.shoulderRight,
    elbowLeft: leftElbow || safeFallback.elbowLeft,
    elbowRight: rightElbow || safeFallback.elbowRight,
    wristLeft: leftWrist || safeFallback.wristLeft,
    wristRight: rightWrist || safeFallback.wristRight,
    hip:
      hip ||
      (neck
        ? {
            x: neck.x,
            y: neck.y + 44
          }
        : safeFallback.hip)
  };
}

export function preloadCommonPoseData() {
  for (let id = 0; id < 120; id += 1) {
    buildPoseFromId(id);
  }
}
