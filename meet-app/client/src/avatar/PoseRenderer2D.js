import { buildPoseFromId, buildPoseFromLandmarkFrame } from './poseLibrary.js';

function pathToConnections(path, closed = false) {
  const connections = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    connections.push([path[index], path[index + 1]]);
  }
  if (closed && path.length > 2) {
    connections.push([path[path.length - 1], path[0]]);
  }
  return connections;
}

const POSE_CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24]
];

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

const FACE_CONNECTIONS = [
  ...pathToConnections([
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
    400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
    54, 103, 67, 109
  ], true),
  ...pathToConnections([
    33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246
  ], true),
  ...pathToConnections([
    263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466
  ], true),
  ...pathToConnections([
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14,
    87, 178, 88, 95, 185, 40, 39, 37, 0, 267, 269, 270, 409, 415, 310, 311, 312,
    13, 82, 81, 80, 191
  ], true),
  ...pathToConnections([
    78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82,
    81, 80, 191
  ], true),
  ...pathToConnections([168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 327], false)
];

const TARGET_FRAME_MS = 200; // ~5fps (2× slower)
const LANDMARK_BG = '#000000';
const LANDMARK_STROKE = '#00ff55';
const LANDMARK_STROKE_SOFT = '#66ff99';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function interpolatePose(a, b, t) {
  const pose = {};
  Object.keys(a).forEach((joint) => {
    pose[joint] = {
      x: lerp(a[joint].x, b[joint].x, t),
      y: lerp(a[joint].y, b[joint].y, t)
    };
  });
  return pose;
}

function getLandmarkAt(landmarks, index) {
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

function mapToCanvasPoint(point, width, height) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }

  return {
    x: point.x * width,
    y: point.y * height
  };
}

function drawLandmarkPoints(ctx, landmarks, width, height, radius, color) {
  if (!landmarks) {
    return;
  }

  const source = Array.isArray(landmarks) ? landmarks : Object.values(landmarks);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = radius * 2;

  source.forEach((point) => {
    const mapped = mapToCanvasPoint(point, width, height);
    if (!mapped) {
      return;
    }

    ctx.beginPath();
    ctx.arc(mapped.x, mapped.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

function drawLandmarkConnections(ctx, landmarks, connections, width, height, color, lineWidth) {
  if (!landmarks || !Array.isArray(connections) || !connections.length) {
    return;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = lineWidth * 3;

  connections.forEach(([start, end]) => {
    const a = mapToCanvasPoint(getLandmarkAt(landmarks, start), width, height);
    const b = mapToCanvasPoint(getLandmarkAt(landmarks, end), width, height);
    if (!a || !b) {
      return;
    }

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

export class PoseRenderer2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sequence = [];
    this.sequenceStart = 0;
    this.frameHandle = null;
    this.running = false;
    this.lastRenderAt = 0;
    this.currentPose = buildPoseFromId(0);
    this.pendingRenderLog = false;
    this.sequenceMeta = null;

    this.resizeCanvas();
  }

  resizeCanvas() {
    const { canvas } = this;
    const pixelRatio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 420;
    const height = canvas.clientHeight || 300;
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  queuePoseSequence(sequencePayload) {
    const hasLandmarkFrames = Array.isArray(sequencePayload?.poseFrames);
    const hasPoseIds = Array.isArray(sequencePayload?.poseIds);

    if (!hasLandmarkFrames && !hasPoseIds) {
      return;
    }

    const source = hasLandmarkFrames ? sequencePayload.poseFrames : sequencePayload.poseIds;

    const timingsArray = Array.isArray(sequencePayload?.timings)
      ? sequencePayload.timings.map((t) => Number(t))
      : null;

    const explicitTimingsValid = Boolean(
      timingsArray &&
      timingsArray.length === source.length &&
      timingsArray.every((t, idx) => Number.isFinite(t) && (idx === 0 || t > timingsArray[idx - 1]))
    );

    let normalizedTimings = null;

    if (explicitTimingsValid) {
      const lastIndex = timingsArray.length - 1;
      const originalDuration = timingsArray[lastIndex];
      const desiredDuration = source.length * TARGET_FRAME_MS;
      const scale = originalDuration > 0 ? desiredDuration / originalDuration : 1;
      normalizedTimings = timingsArray.map((t) => t * scale);
    }

    this.sequence = source.map((entry, index) => {
      const pose = hasLandmarkFrames
        ? buildPoseFromLandmarkFrame(entry, this.currentPose)
        : buildPoseFromId(entry);

      const timing = normalizedTimings
        ? normalizedTimings[index]
        : index * TARGET_FRAME_MS;

      return {
        pose,
        rawFrame: hasLandmarkFrames ? entry : null,
        timing
      };
    });

    this.pendingRenderLog = true;
    this.sequenceMeta = {
      text: sequencePayload?.text || '',
      speakerId: sequencePayload?.speakerId || '',
      frames: source.length
    };

    this.sequenceStart = performance.now();
  }

  getInterpolatedPose(now) {
    if (this.sequence.length === 0) {
      return { pose: this.currentPose, rawFrame: null };
    }

    if (this.sequence.length === 1) {
      return { pose: this.sequence[0].pose, rawFrame: this.sequence[0].rawFrame || null };
    }

    const elapsed = now - this.sequenceStart;
    const first = this.sequence[0];
    const last = this.sequence[this.sequence.length - 1];

    if (elapsed <= first.timing) {
      return { pose: first.pose, rawFrame: first.rawFrame || null };
    }

    if (elapsed >= last.timing) {
      return { pose: last.pose, rawFrame: last.rawFrame || null };
    }

    let left = first;
    let right = last;

    for (let i = 0; i < this.sequence.length - 1; i += 1) {
      const current = this.sequence[i];
      const next = this.sequence[i + 1];
      if (elapsed >= current.timing && elapsed <= next.timing) {
        left = current;
        right = next;
        break;
      }
    }

    const duration = Math.max(1, right.timing - left.timing);
    const t = Math.max(0, Math.min(1, (elapsed - left.timing) / duration));
    return {
      pose: interpolatePose(left.pose, right.pose, t),
      rawFrame: left.rawFrame || right.rawFrame || null
    };
  }

  drawPose(rawFrame) {
    const { ctx } = this;
    const width = this.canvas.clientWidth || 420;
    const height = this.canvas.clientHeight || 300;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = LANDMARK_BG;
    ctx.fillRect(0, 0, width, height);

    if (!rawFrame) {
      return;
    }

    drawLandmarkConnections(
      ctx,
      rawFrame.pose_landmarks,
      POSE_CONNECTIONS,
      width,
      height,
      LANDMARK_STROKE,
      3.4
    );
    drawLandmarkPoints(ctx, rawFrame.pose_landmarks, width, height, 1.8, LANDMARK_STROKE_SOFT);

    drawLandmarkConnections(
      ctx,
      rawFrame.left_hand_landmarks,
      HAND_CONNECTIONS,
      width,
      height,
      LANDMARK_STROKE,
      2.4
    );
    drawLandmarkPoints(ctx, rawFrame.left_hand_landmarks, width, height, 1.4, LANDMARK_STROKE_SOFT);

    drawLandmarkConnections(
      ctx,
      rawFrame.right_hand_landmarks,
      HAND_CONNECTIONS,
      width,
      height,
      LANDMARK_STROKE,
      2.4
    );
    drawLandmarkPoints(ctx, rawFrame.right_hand_landmarks, width, height, 1.4, LANDMARK_STROKE_SOFT);

    drawLandmarkPoints(ctx, rawFrame.face_landmarks, width, height, 1.2, LANDMARK_STROKE_SOFT);
  }

  renderFrame = (now) => {
    if (!this.running) {
      return;
    }

    if (this.lastRenderAt && now - this.lastRenderAt < TARGET_FRAME_MS) {
      this.frameHandle = requestAnimationFrame(this.renderFrame);
      return;
    }

    this.lastRenderAt = now;

    const state = this.getInterpolatedPose(now);
    this.currentPose = state.pose;
    this.drawPose(state.rawFrame);

    if (this.pendingRenderLog) {
      console.log('[AvatarCanvas] rendered pose frame on canvas', {
        text: this.sequenceMeta?.text || '',
        speakerId: this.sequenceMeta?.speakerId || '',
        frames: this.sequenceMeta?.frames || 0,
        hasRawFrame: Boolean(state.rawFrame)
      });
      this.pendingRenderLog = false;
    }

    this.frameHandle = requestAnimationFrame(this.renderFrame);
  };

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.lastRenderAt = 0;
    this.frameHandle = requestAnimationFrame(this.renderFrame);
  }

  stop() {
    this.running = false;
    if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }
}
