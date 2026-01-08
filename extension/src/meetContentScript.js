import {
  HAND_CONNECTIONS,
  POSE_CONNECTIONS,
  FACEMESH_TESSELATION,
} from '@mediapipe/holistic';
import { drawConnectors } from '@mediapipe/drawing_utils';

const OVERLAY_ID = 'sv-meet-overlay';

let enabled = false;
let overlay;
let canvas;
let ctx;
let statusEl;
let lastCaptionText = '';
let lastCaptionAt = 0;

let captionsRegion = null;
let captionsObserver = null;
let discoveryObserver = null;
let pendingCaptionTimer = null;

let frames = [];
let frameIdx = 0;
let animHandle = null;
let activePort = null;

let inFlight = false;
let clearOnFirstChunk = false;
let receivedAnyChunk = false;

let wordQueue = [];
let lastTokensNorm = [];

function clamp01(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function drawLandmarks(landmark) {
  if (!ctx || !canvas || !landmark) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

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

function animate() {
  if (!frames.length) return;
  const f = frames[frameIdx % frames.length];
  frameIdx += 1;
  drawLandmarks(f);
  animHandle = requestAnimationFrame(animate);
}

function ensureOverlay() {
  if (overlay) return;

  overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:rgba(0,0,0,0.8);color:#fff;padding:10px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:8px;min-width:340px;max-width:420px;';
  overlay.addEventListener('click', (e) => e.stopPropagation());

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;gap:10px;';

  const title = document.createElement('div');
  title.textContent = 'Silent-voice (Meet)';
  title.style.cssText = 'font:600 12px system-ui,sans-serif;';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText =
    'background:transparent;border:none;color:#fff;cursor:pointer;font-size:14px;line-height:1;';
  closeBtn.addEventListener('click', () => setEnabled(false));

  header.appendChild(title);
  header.appendChild(closeBtn);

  statusEl = document.createElement('div');
  statusEl.style.cssText = 'font:12px system-ui,sans-serif;opacity:.85;';
  statusEl.textContent =
    'Turn on Meet captions, then click the subtitles area once.';

  canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 240;
  canvas.style.cssText = 'background:#111;border-radius:8px;';
  ctx = canvas.getContext('2d');

  overlay.appendChild(header);
  overlay.appendChild(statusEl);
  overlay.appendChild(canvas);

  document.documentElement.appendChild(overlay);
}

function destroyOverlay() {
  if (animHandle) cancelAnimationFrame(animHandle);
  animHandle = null;

  if (pendingCaptionTimer) {
    clearTimeout(pendingCaptionTimer);
    pendingCaptionTimer = null;
  }

  if (captionsObserver) {
    try {
      captionsObserver.disconnect();
    } catch (e) {
      // no-op
    }
  }
  captionsObserver = null;
  captionsRegion = null;

  if (discoveryObserver) {
    try {
      discoveryObserver.disconnect();
    } catch (e) {
      // no-op
    }
  }
  discoveryObserver = null;

  frames = [];
  frameIdx = 0;
  inFlight = false;
  clearOnFirstChunk = false;
  receivedAnyChunk = false;
  wordQueue = [];
  lastTokensNorm = [];

  if (activePort) {
    try {
      activePort.disconnect();
    } catch (e) {
      // no-op
    }
  }
  activePort = null;

  overlay?.remove();
  overlay = null;
  canvas = null;
  ctx = null;
  statusEl = null;
}

function normalizeCaptionText(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function tokenizeCaption(text) {
  const m = (text || '').match(/[A-Za-z0-9']+/g);
  return m ? m : [];
}

function normalizeToken(token) {
  return (token || '').toLowerCase();
}

function startsWithTokens(a, b) {
  if (b.length > a.length) return false;
  for (let i = 0; i < b.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function startNextWord() {
  if (!enabled) return;
  if (inFlight) return;
  if (!wordQueue.length) return;
  const next = wordQueue.shift();
  if (!next) return;
  requestPoses(next);
}

function enqueueWords(words) {
  if (!words || !words.length) return;
  const CAP = 50;
  for (const w of words) {
    if (!w) continue;
    wordQueue.push(w);
    if (wordQueue.length > CAP) {
      wordQueue = wordQueue.slice(-Math.floor(CAP / 2));
    }
  }
  startNextWord();
}

function processCaptionIncremental(captionText) {
  const cleaned = normalizeCaptionText(captionText);
  if (!looksLikeCaptionText(cleaned)) return;

  const tokensOrig = tokenizeCaption(cleaned);
  const tokensNorm = tokensOrig.map(normalizeToken);
  if (!tokensNorm.length) return;

  let newTokensOrig = [];
  if (startsWithTokens(tokensNorm, lastTokensNorm)) {
    newTokensOrig = tokensOrig.slice(lastTokensNorm.length);
  } else {
    newTokensOrig = tokensOrig;
  }

  lastTokensNorm = tokensNorm;

  if (newTokensOrig.length) {
    enqueueWords(newTokensOrig);
  }
}

function looksLikeCaptionText(text) {
  if (!text) return false;
  if (text.length < 1) return false;
  if (text.length > 240) return false;

  // avoid sending obvious UI labels
  const lower = text.toLowerCase();
  if (lower === 'close' || lower === 'turn on captions' || lower === 'captions') return false;

  // require at least one letter/number
  return /[a-z0-9]/i.test(text);
}

function isLikelyCaptionNode(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;

  const ariaLive = el.getAttribute('aria-live');
  if (ariaLive && ariaLive !== 'off') return true;

  const role = el.getAttribute('role');
  if (role && ['log', 'status', 'alert'].includes(role)) return true;

  const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
  if (ariaLabel.includes('caption') || ariaLabel.includes('subtitles')) return true;

  return false;
}

function findMeetCaptionsRegion() {
  // Based on the provided DOM: <div role="region" aria-label="Captions"> ... </div>
  const direct = document.querySelector('[role="region"][aria-label="Captions"]');
  if (direct) return direct;

  // Fallbacks: Meet experiments sometimes change roles/labels.
  const candidates = Array.from(
    document.querySelectorAll('[role="region"],[aria-label],[aria-live]')
  );
  for (const el of candidates) {
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    if (aria.includes('captions') || aria.includes('subtitles')) return el;
    const ariaLive = (el.getAttribute('aria-live') || '').toLowerCase();
    if (ariaLive && ariaLive !== 'off') {
      // This can be noisy; only accept if it has multiple lines of text.
      const t = normalizeCaptionText(el.innerText || el.textContent || '');
      if (t.split(' ').length >= 3) return el;
    }
  }
  return null;
}

function extractLatestCaptionFromRegion(regionEl) {
  if (!regionEl) return '';
  const raw = (regionEl.innerText || regionEl.textContent || '').trim();
  if (!raw) return '';

  const lines = raw
    .split(/\r?\n/)
    .map((l) => normalizeCaptionText(l))
    .filter((l) => looksLikeCaptionText(l));

  if (!lines.length) return '';
  // Prefer the most recent line.
  return lines[lines.length - 1];
}

function scheduleCaptionSend(reason) {
  if (!enabled) return;
  if (!captionsRegion) return;

  if (pendingCaptionTimer) clearTimeout(pendingCaptionTimer);
  pendingCaptionTimer = setTimeout(() => {
    pendingCaptionTimer = null;
    const extracted = extractLatestCaptionFromRegion(captionsRegion);
    const now = Date.now();

    if (!extracted) {
      if (statusEl) {
        statusEl.textContent =
          'Captions detected, but no text yet. Wait for someone to speak.';
      }
      return;
    }

    // Dedupe: Meet often updates the same line repeatedly.
    if (extracted === lastCaptionText && now - lastCaptionAt < 1500) return;
    lastCaptionText = extracted;
    lastCaptionAt = now;

    if (statusEl) {
      statusEl.textContent = `Captions (${reason || 'update'}): "${extracted}"`;
    }
    // Only render newly-added words so we don't repeat the full growing caption.
    processCaptionIncremental(extracted);
  }, 250);
}

function attachCaptionsObserver(regionEl) {
  captionsRegion = regionEl;
  if (statusEl) {
    statusEl.textContent =
      'Captions detected. Translating live captions as they appear.';
  }

  if (captionsObserver) {
    try {
      captionsObserver.disconnect();
    } catch (e) {
      // no-op
    }
  }

  captionsObserver = new MutationObserver(() => {
    scheduleCaptionSend('live');
  });
  captionsObserver.observe(captionsRegion, {
    subtree: true,
    childList: true,
    characterData: true,
  });

  // Send an initial caption if already visible.
  scheduleCaptionSend('initial');
}

function ensureCaptionsDiscovery() {
  if (!enabled) return;

  const existing = findMeetCaptionsRegion();
  if (existing) {
    attachCaptionsObserver(existing);
    return;
  }

  if (statusEl) {
    statusEl.textContent =
      'Turn on Meet captions. When they appear, the overlay will start translating.';
  }

  if (discoveryObserver) return;
  discoveryObserver = new MutationObserver(() => {
    const region = findMeetCaptionsRegion();
    if (region) {
      try {
        discoveryObserver.disconnect();
      } catch (e) {
        // no-op
      }
      discoveryObserver = null;
      attachCaptionsObserver(region);
    }
  });
  discoveryObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
  });
}

function requestPoses(words) {
  ensureOverlay();

  const text = normalizeCaptionText(words);
  if (!looksLikeCaptionText(text)) return;

  inFlight = true;
  clearOnFirstChunk = true;
  receivedAnyChunk = false;
  if (statusEl) statusEl.textContent = `Translating: \"${text}\"`;

  const port = chrome.runtime.connect({ name: 'sv-port' });
  activePort = port;

  port.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'POSE_CHUNK' && Array.isArray(msg.frames)) {
      if (clearOnFirstChunk) {
        // Avoid flashing to an empty canvas while waiting for the backend.
        frames = [];
        frameIdx = 0;
        clearOnFirstChunk = false;
        if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      receivedAnyChunk = true;
      frames.push(...msg.frames);
      if (!animHandle) animHandle = requestAnimationFrame(animate);
    } else if (msg.type === 'POSE_DONE') {
      // Mark request complete; if a newer caption arrived while we were working, fetch it now.
      inFlight = false;
      try {
        port.disconnect();
      } catch (e) {
        // no-op
      }
      if (activePort === port) activePort = null;

      if (!receivedAnyChunk && statusEl) {
        statusEl.textContent = 'No frames returned.';
      }

      startNextWord();
    } else if (msg.type === 'POSE_ERROR') {
      if (statusEl) statusEl.textContent = `Error: ${msg.message}`;
      console.warn('[silent-voice][meet] pose error:', msg.message);

      inFlight = false;
      try {
        port.disconnect();
      } catch (e) {
        // no-op
      }
      if (activePort === port) activePort = null;

      startNextWord();
    }
  });

  port.postMessage({ type: 'FETCH_POSE', words: text });
}

function setEnabled(next) {
  enabled = !!next;
  if (enabled) {
    ensureOverlay();
    ensureCaptionsDiscovery();
  } else {
    destroyOverlay();
  }
}

document.addEventListener(
  'click',
  (e) => {
    if (!enabled) return;

    // First-click helper: if captions are already visible, lock onto the captions region.
    // This avoids relying on obfuscated classnames and makes the feature easier to start.
    if (!captionsRegion) {
      ensureCaptionsDiscovery();
      const region = findMeetCaptionsRegion();
      if (region) attachCaptionsObserver(region);
    }
  },
  true
);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'SV_TOGGLE_MEET_PANEL') {
    setEnabled(!!msg.enable);
    sendResponse?.({ ok: true });
    return;
  }
});

// In case the manifest loads this script automatically on Meet,
// stay disabled until the user clicks the popup button.
