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
  [0, 11],
  [0, 12],
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

const TARGET_FRAME_MS = 50;
const LANDMARK_BG = '#000000';
const LANDMARK_GREEN = '#39ff6b';
const LANDMARK_GREEN_SOFT = '#2de35f';

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

  source.forEach((point) => {
    const mapped = mapToCanvasPoint(point, width, height);
    if (!mapped) {
      return;
    }

    ctx.beginPath();
    ctx.arc(mapped.x, mapped.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawLandmarkConnections(ctx, landmarks, connections, width, height, color, lineWidth) {
  if (!landmarks || !Array.isArray(connections) || !connections.length) {
    return;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';

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
}

export class PoseRenderer2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sequence = [];
    this.sequenceStart = 0;
    this.frameHandle = null;
    this.running = false;
    this.currentPose = buildPoseFromId(0);

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

    this.sequence = source.map((entry, index) => {
      const pose = hasLandmarkFrames
        ? buildPoseFromLandmarkFrame(entry, this.currentPose)
        : buildPoseFromId(entry);

      const explicitTiming = Number(sequencePayload?.timings?.[index]);
      const frameBasedTiming = Number(entry?.frame);

      return {
        pose,
        rawFrame: hasLandmarkFrames ? entry : null,
        timing: Number.isFinite(explicitTiming)
          ? explicitTiming
          : Number.isFinite(frameBasedTiming)
            ? frameBasedTiming * TARGET_FRAME_MS
            : index * TARGET_FRAME_MS
      };
    });

    this.sequenceStart = performance.now();
  }

  getInterpolatedPose(now) {
    if (this.sequence.length < 2) {
      return {
        pose: this.sequence[0]?.pose || this.currentPose,
        rawFrame: this.sequence[0]?.rawFrame || null
      };
    }

    const elapsed = now - this.sequenceStart;
    let left = this.sequence[0];
    let right = this.sequence[this.sequence.length - 1];

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
      LANDMARK_GREEN,
      2.2
    );
    drawLandmarkPoints(ctx, rawFrame.pose_landmarks, width, height, 2.2, LANDMARK_GREEN);

    drawLandmarkConnections(
      ctx,
      rawFrame.left_hand_landmarks,
      HAND_CONNECTIONS,
      width,
      height,
      LANDMARK_GREEN,
      1.8
    );
    drawLandmarkPoints(ctx, rawFrame.left_hand_landmarks, width, height, 1.9, LANDMARK_GREEN_SOFT);

    drawLandmarkConnections(
      ctx,
      rawFrame.right_hand_landmarks,
      HAND_CONNECTIONS,
      width,
      height,
      LANDMARK_GREEN,
      1.8
    );
    drawLandmarkPoints(ctx, rawFrame.right_hand_landmarks, width, height, 1.9, LANDMARK_GREEN_SOFT);

    drawLandmarkConnections(
      ctx,
      rawFrame.face_landmarks,
      FACE_CONNECTIONS,
      width,
      height,
      LANDMARK_GREEN,
      0.9
    );

    drawLandmarkPoints(ctx, rawFrame.face_landmarks, width, height, 1.05, LANDMARK_GREEN_SOFT);
  }

  renderFrame = (now) => {
    if (!this.running) {
      return;
    }

    const state = this.getInterpolatedPose(now);
    this.currentPose = state.pose;
    this.drawPose(state.rawFrame);
    this.frameHandle = requestAnimationFrame(this.renderFrame);
  };

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
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
