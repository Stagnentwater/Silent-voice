export const POSE_CHANNEL_NAME = 'pose-channel';
const MAX_POSE_FRAMES_PER_PACKET = 18;

function roundPoint(point) {
  if (!point) {
    return null;
  }
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x: Number(x.toFixed(4)),
    y: Number(y.toFixed(4)),
    z: Number(Number(point.z ?? 0).toFixed(4)),
    visibility: Number(Number(point.visibility ?? 0).toFixed(3))
  };
}

function compactLandmarkMap(landmarks) {
  if (!landmarks || typeof landmarks !== 'object') {
    return null;
  }

  const compact = {};
  Object.keys(landmarks).forEach((key) => {
    const point = roundPoint(landmarks[key]);
    if (point) {
      compact[key] = point;
    }
  });

  return Object.keys(compact).length ? compact : null;
}

function downsamplePoseFrames(poseFrames, timings) {
  if (!Array.isArray(poseFrames) || poseFrames.length <= MAX_POSE_FRAMES_PER_PACKET) {
    return {
      poseFrames,
      timings
    };
  }

  const step = Math.ceil(poseFrames.length / MAX_POSE_FRAMES_PER_PACKET);
  const sampledFrames = [];
  const sampledTimings = [];

  for (let index = 0; index < poseFrames.length; index += step) {
    sampledFrames.push(poseFrames[index]);
    sampledTimings.push(timings?.[index] ?? index * 100);
  }

  const lastIndex = poseFrames.length - 1;
  if (sampledFrames[sampledFrames.length - 1] !== poseFrames[lastIndex]) {
    sampledFrames.push(poseFrames[lastIndex]);
    sampledTimings.push(timings?.[lastIndex] ?? lastIndex * 100);
  }

  return {
    poseFrames: sampledFrames,
    timings: sampledTimings
  };
}

function compactPoseFrames(frames) {
  if (!Array.isArray(frames)) {
    return undefined;
  }

  return frames.map((frame, index) => ({
    frame: Number(frame?.frame ?? index),
    pose_landmarks: compactLandmarkMap(frame?.pose_landmarks),
    left_hand_landmarks: compactLandmarkMap(frame?.left_hand_landmarks),
    right_hand_landmarks: compactLandmarkMap(frame?.right_hand_landmarks),
    face_landmarks: compactLandmarkMap(frame?.face_landmarks)
  }));
}

export function createPosePacket({ text, poseIds, poseFrames, timings, speakerId }) {
  const compactFrames = compactPoseFrames(poseFrames);
  const sampled = downsamplePoseFrames(compactFrames, timings);

  return {
    type: 'pose-sequence',
    text,
    poseIds,
    poseFrames: sampled.poseFrames,
    timings: sampled.timings,
    speakerId,
    timestamp: Date.now()
  };
}

export function encodePosePacket(packet) {
  return JSON.stringify(packet);
}

export function decodePosePacket(raw) {
  if (typeof raw !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.type !== 'pose-sequence') {
      return null;
    }

    const hasPoseIds = Array.isArray(parsed.poseIds);
    const hasPoseFrames = Array.isArray(parsed.poseFrames);

    if (!hasPoseIds && !hasPoseFrames) {
      return null;
    }

    if (!Array.isArray(parsed.timings)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
