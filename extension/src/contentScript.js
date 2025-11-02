import {
  HAND_CONNECTIONS,
  POSE_CONNECTIONS,
  FACEMESH_TESSELATION,
} from '@mediapipe/holistic';
import { drawConnectors } from '@mediapipe/drawing_utils';
import { getYoutubeTranscript } from './lib/youtubeCaptions';

let transcript;
const queue = [];
const BATCH_SIZE = 2;
const FETCH_AHEAD_TIME = 10;
let avatar, avatarContainer, currentSegment, word;

function decodeHTMLEntities(str) {
  const output = str
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  return output;
}

function fetchTranscript() {
  const videoId = new URL(window.location.href).searchParams.get('v');
  return getYoutubeTranscript(videoId, 'en');
}

function addContainer() {
  avatarContainer = document.createElement('div');
  avatarContainer.id = 'avatar-container';
  avatar = document.createElement('canvas');
  avatar.id = 'avatar';
  avatarContainer.appendChild(avatar);
  word = document.createElement('p');
  word.id = 'word';
  avatarContainer.appendChild(word);

  const targetElement = document.getElementById('secondary-inner');
  if (targetElement) {
    targetElement.insertBefore(avatarContainer, targetElement.firstChild);
  }
}

function getCurrentTime() {
  const player = document.querySelector('video');
  if (player) {
    return player.currentTime;
  }
  return 0;
}

function drawLandmarks(landmark, ctx) {
  if (landmark.pose_landmarks) {
    landmark.pose_landmarks.forEach((point) => {
      point.visibility = 1;
    });

    const filteredPoseLandmarks = landmark.pose_landmarks.filter(
      (point, index) => ![17, 18, 19, 20, 21, 22].includes(index)
    );

    const filteredPoseConnections = POSE_CONNECTIONS.filter(
      (connection) =>
        ![17, 18, 19, 20, 21, 22].includes(connection[0]) &&
        ![17, 18, 19, 20, 21, 22].includes(connection[1])
    );

    drawConnectors(ctx, filteredPoseLandmarks, filteredPoseConnections, {
      color: '#00FF00',
      lineWidth: 2,
    });
  }

  if (landmark.face_landmarks) {
    landmark.face_landmarks.forEach((point) => {
      point.visibility = 1;
    });

    drawConnectors(ctx, landmark.face_landmarks, FACEMESH_TESSELATION, {
      color: '#00FF00',
      lineWidth: 0.5,
    });
  }

  if (landmark.right_hand_landmarks) {
    landmark.right_hand_landmarks.forEach((point) => {
      point.visibility = 1;
    });

    drawConnectors(ctx, landmark.right_hand_landmarks, HAND_CONNECTIONS, {
      color: '#00FF00',
      lineWidth: 2,
    });
  }

  if (landmark.left_hand_landmarks) {
    landmark.left_hand_landmarks.forEach((point) => {
      point.visibility = 1;
    });

    drawConnectors(ctx, landmark.left_hand_landmarks, HAND_CONNECTIONS, {
      color: '#00FF00',
      lineWidth: 2,
    });
  }
}

function processQueue() {
  if (queue.length === 0) return;

  const batch = queue.splice(0, BATCH_SIZE);
  const promises = batch.map((segment) => {
    const words = segment.text;
    segment.loading = true;

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'FETCH_POSE', words }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) {
          const err = chrome.runtime.lastError?.message || res?.error || 'fetch failed';
          console.debug('[sign-engine][background] /pose error', err);
          segment.loading = false;
          return resolve(segment);
        }
        segment.poses = res.data;
        segment.loading = false;
        resolve(segment);
      });
    });
  });

  Promise.all(promises).then((updatedBatch) => {
    updatedBatch.forEach((segment) => {
      const index = transcript.findIndex((s) => s === segment);
      transcript[index] = segment;
    });
  });
}

function playAnimation(segment) {
  /* Play the animation of the avatar */
  const poses = segment.poses;

  if (!poses) {
    currentSegment = null;
    return;
  }
  if (!avatar) {
    currentSegment = null;
    return;
  }
  const ctx = avatar.getContext('2d');
  if (!ctx) {
    currentSegment = null;
    return;
  }

  const duration = segment.duration;
  const frames = poses.length;
  const fps = frames / duration;

  let frameIndex = 0;

  function animate() {
    if (frameIndex >= poses.length) {
      return;
    }

    const landmark = poses[frameIndex];

    word.innerText = landmark.word;
    ctx.clearRect(0, 0, avatar.width, avatar.height);
    drawLandmarks(landmark, ctx);

    frameIndex++;
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

function initializeExtension() {
  if (avatar || avatarContainer) {
    avatar.remove();
    avatarContainer.remove();
  }

  fetchTranscript().then((data) => {
    transcript = data.map((x) => ({
      ...x,
      text: decodeHTMLEntities(x.text),
    }));
    console.log(transcript);
    queue.push(...transcript);
    processQueue();
  });

  setInterval(() => {
    if (!transcript) return;

    const time = getCurrentTime();
    const nextSegment = transcript.find(
      (segment) =>
        !segment.poses &&
        !segment.loading &&
        segment.offset < time + FETCH_AHEAD_TIME
    );

    if (nextSegment && queue.length > 0) {
      processQueue();
    }
  }, 500);

  setInterval(() => {
    const currentTime = getCurrentTime();

    if (!transcript) return;
    if (
      currentSegment &&
      currentSegment.offset < currentTime &&
      currentSegment.offset + currentSegment.duration > currentTime
    )
      return;

    currentSegment = transcript.find(
      (segment) =>
        segment.offset <= currentTime &&
        segment.offset + segment.duration >= currentTime
    );

    if (currentSegment) {
      playAnimation(currentSegment);
    }
  }, [200]);

  setTimeout(() => {
    const targetElement = document.getElementById('secondary-inner');
    if (targetElement) {
      addContainer();
    }
  }, 1500);
}

function observeUrlChanges() {
  let lastUrl = location.href;
  new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      location.reload();
    }
  }).observe(document, { subtree: true, childList: true });
}

document.addEventListener(
  'DOMContentLoaded',
  () => {
    const videoElement = document.querySelector('video');
    if (videoElement) {
      videoElement.pause();
    }
  },
  [200]
);

initializeExtension();
observeUrlChanges();

(() => {
  // Lightweight overlay + loader that doesn’t interfere with existing logic
  let overlay, canvas, ctx, loader, animHandle;
  let frames = [];
  let idx = 0;

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#000c;color:#fff;padding:8px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.4);display:flex;flex-direction:column;gap:6px;";
    const header = document.createElement("div");
    header.textContent = "Sign Preview";
    header.style.cssText = "font:600 12px system-ui,sans-serif";
    loader = document.createElement("div");
    loader.textContent = "Loading...";
    loader.style.cssText = "font:12px system-ui,sans-serif;opacity:.8";
    canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 240;
    canvas.style.cssText = "background:#111;border-radius:4px;";
    ctx = canvas.getContext("2d");
    const btn = document.createElement("button");
    btn.textContent = "Close";
    btn.style.cssText = "align-self:flex-end;font-size:11px;padding:2px 6px;cursor:pointer;";
    btn.onclick = destroyOverlay;
    overlay.append(header, loader, canvas, btn);
    document.documentElement.appendChild(overlay);
  }

  function destroyOverlay() {
    if (animHandle) cancelAnimationFrame(animHandle);
    animHandle = null; frames = []; idx = 0;
    overlay?.remove(); overlay = null; canvas = null; ctx = null; loader = null;
  }

  function drawFrame(f) {
    if (!ctx || !f) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const draw = (pts, color) => {
      if (!pts) return;
      ctx.fillStyle = color;
      for (const p of pts) {
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw(f.left_hand_landmarks, "#2dd4bf");
    draw(f.right_hand_landmarks, "#60a5fa");
    draw(f.pose_landmarks, "#a78bfa");
    draw(f.face_landmarks, "#fca5a5");
  }

  function animate() {
    if (!frames.length) return;
    drawFrame(frames[idx % frames.length]);
    idx++;
    animHandle = requestAnimationFrame(animate);
  }

  function requestPoses(words) {
    const port = chrome.runtime.connect({ name: "sv-port" });
    frames = []; idx = 0;
    if (loader) loader.style.display = "";

    port.onMessage.addListener((msg) => {
      if (msg?.type === "POSE_START") {
        if (loader) loader.textContent = "Loading...";
      } else if (msg?.type === "POSE_CHUNK" && Array.isArray(msg.frames)) {
        if (loader) loader.style.display = "none";
        frames.push(...msg.frames);
        if (!animHandle) animHandle = requestAnimationFrame(animate);
      } else if (msg?.type === "POSE_DONE") {
        // no-op
      } else if (msg?.type === "POSE_ERROR") {
        if (loader) loader.textContent = `Error: ${msg.message}`;
        console.warn("[silent-voice] pose error:", msg.message);
      }
    });

    port.postMessage({ type: "FETCH_POSE", words });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "SV_SHOW_TEXT" && msg.text) {
      ensureOverlay();
      requestPoses(msg.text);
    }
  });
})();
