// https://github.com/kevinjosethomas/sign-engine/blob/main/extension/src/background.js
// Background service worker: performs network requests to local server on behalf of the content script
// Returns { ok: true, data } or { ok: false, error }

const LOCAL_POSE_URL = 'http://127.0.0.1:5000/pose';
const PROD_POSE_EXCEPTION_URL = 'http://127.0.0.1:5000/pose';
const DEFAULT_POSE_URL = LOCAL_POSE_URL;
const DEFAULT_POSE_FALLBACK_URL = 'https://executive-parliament-forecasts-diagram.trycloudflare.com/pose';
const RUNTIME_MODE_LOCAL = 'local';
const RUNTIME_MODE_PROD = 'prod';

function inferRuntimeModeFromUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return RUNTIME_MODE_LOCAL;

  try {
    const parsed = new URL(raw);
    if (['localhost', '127.0.0.1'].includes(parsed.hostname)) {
      return RUNTIME_MODE_LOCAL;
    }
    return RUNTIME_MODE_PROD;
  } catch {
    return RUNTIME_MODE_LOCAL;
  }
}

function getDefaultPoseUrlForRuntime(runtimeMode) {
  if (runtimeMode === RUNTIME_MODE_PROD) {
    // Production exception: keep pose endpoint local until deployed.
    return PROD_POSE_EXCEPTION_URL;
  }
  return LOCAL_POSE_URL;
}

function normalizePoseUrl(url, fallbackUrl = DEFAULT_POSE_URL) {
  const fallback = String(fallbackUrl || DEFAULT_POSE_URL).trim();
  const u = (url || '').trim();
  const base = u || fallback;
  // Allow passing a base URL like https://my-api.vercel.app
  if (!/\/pose\b/i.test(base)) {
    return base.replace(/\/+$/, '') + '/pose';
  }
  return base;
}

function getPoseUrl(callback, runtimeDefaultUrl = DEFAULT_POSE_URL) {
  try {
    chrome.storage.sync.get({ poseApiUrl: '' }, (items) => {
      callback(normalizePoseUrl(items.poseApiUrl, runtimeDefaultUrl));
    });
  } catch (e) {
    callback(normalizePoseUrl(runtimeDefaultUrl));
  }
}

function buildPoseUrlCandidates(primaryUrl, runtimeDefaultUrl = DEFAULT_POSE_URL) {
  const normalizedRuntimeDefault = normalizePoseUrl(runtimeDefaultUrl, runtimeDefaultUrl);
  const normalizedPrimary = normalizePoseUrl(primaryUrl, runtimeDefaultUrl);
  const normalizedFallback = normalizePoseUrl(DEFAULT_POSE_FALLBACK_URL);
  return [normalizedRuntimeDefault, normalizedPrimary, normalizedFallback].filter((value, index, all) => {
    return Boolean(value) && all.indexOf(value) === index;
  });
}

function fetchPose(words, url) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words }),
  }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

async function fetchPoseWithFallback(words, primaryUrl, runtimeDefaultUrl = DEFAULT_POSE_URL) {
  const candidates = buildPoseUrlCandidates(primaryUrl, runtimeDefaultUrl);
  let lastError = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidateUrl = candidates[index];
    try {
      const data = await fetchPose(words, candidateUrl);
      return { data, url: candidateUrl };
    } catch (error) {
      lastError = error;
      const hasNext = index < candidates.length - 1;
      if (hasNext) {
        console.warn('[sign-engine][background] primary pose url failed, retrying fallback', {
          failedUrl: candidateUrl,
          nextUrl: candidates[index + 1],
          message: String(error)
        });
      }
    }
  }

  throw lastError || new Error('pose fetch failed');
}

function isFingerspellFrame(frame) {
  return typeof frame?.word === 'string' && frame.word.startsWith('fs-');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'FETCH_POSE') return;

  const words = message.words || '';
  const runtimeMode = inferRuntimeModeFromUrl(sender?.url);
  const runtimeDefaultUrl = getDefaultPoseUrlForRuntime(runtimeMode);

  getPoseUrl((poseUrl) => {
    const url = normalizePoseUrl(message.url || poseUrl, runtimeDefaultUrl);
    fetchPoseWithFallback(words, url, runtimeDefaultUrl)
      .then(({ data, url: usedUrl }) => sendResponse({ ok: true, data, url: usedUrl }))
      .catch((err) => {
        console.error('[sign-engine][background] fetch error', err);
        sendResponse({ ok: false, error: String(err), url });
      });
  }, runtimeDefaultUrl);

  // Return true to indicate we will call sendResponse asynchronously
  return true;
});
// (Meet/MiroTalk/offscreen features removed; focus on YouTube + selective text)

// Context menu for selected text -> Show in Sign Language
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'showInSignLanguage',
        title: 'Show in Sign Language',
        contexts: ['selection'],
      });
    });
  } catch (e) {
    // no-op
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  if (info.menuItemId !== 'showInSignLanguage') return;

  const selectedText = (info.selectionText || '').trim();
  if (!selectedText) return;

  // Inject a small renderer into the page to display the avatar and animate frames.
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'ISOLATED',
    args: [selectedText],
    func: (text) => {
      const OVERLAY_ID = 'sv-sign-overlay';

      function ensureOverlay() {
        let overlay = document.getElementById(OVERLAY_ID);
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        Object.assign(overlay.style, {
          position: 'fixed',
          right: '16px',
          bottom: '16px',
          width: '380px',
          height: '320px',
          background: 'rgba(0,0,0,0.8)',
          color: '#fff',
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          zIndex: 2147483647,
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          backdropFilter: 'blur(2px)'
        });

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';

        const title = document.createElement('div');
        title.textContent = 'Sign Language Preview';
        title.style.fontWeight = '600';
        title.style.fontSize = '14px';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        Object.assign(closeBtn.style, {
          background: 'transparent',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          fontSize: '16px'
        });
        closeBtn.addEventListener('click', () => overlay.remove());

        header.appendChild(title);
        header.appendChild(closeBtn);
        overlay.appendChild(header);

        const wordEl = document.createElement('div');
        wordEl.id = 'sv-word';
        wordEl.style.fontSize = '12px';
        wordEl.style.opacity = '0.9';
        wordEl.textContent = text;
        overlay.appendChild(wordEl);

        const canvas = document.createElement('canvas');
        canvas.id = 'sv-canvas';
        canvas.width = 360;
        canvas.height = 240;
        canvas.style.background = '#111';
        canvas.style.borderRadius = '8px';
        overlay.appendChild(canvas);

        const hint = document.createElement('div');
        hint.textContent = 'Rendering from your configured pose server';
        hint.style.fontSize = '11px';
        hint.style.opacity = '0.6';
        overlay.appendChild(hint);

        document.body.appendChild(overlay);
        return overlay;
      }

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
        [23, 24],
      ];

      const HAND_CONNECTIONS = [
        [0, 1], [1, 2], [2, 3], [3, 4],
        [0, 5], [5, 6], [6, 7], [7, 8],
        [5, 9], [9, 10], [10, 11], [11, 12],
        [9, 13], [13, 14], [14, 15], [15, 16],
        [13, 17], [17, 18], [18, 19], [19, 20],
        [0, 17],
      ];

      const FACE_CONNECTIONS = [
        ...pathToConnections([
          10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
          378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
          162, 21, 54, 103, 67, 109,
        ], true),
        ...pathToConnections([33, 7, 163, 144, 145, 153, 154, 155, 133], true),
        ...pathToConnections([263, 249, 390, 373, 374, 380, 381, 382, 362], true),
        ...pathToConnections([
          61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317,
          14, 87, 178, 88, 95, 185, 40, 39, 37, 0, 267, 269, 270, 409, 415, 310, 311,
          312, 13, 82, 81, 80, 191,
        ], true),
      ];

      function getPointAt(points, index) {
        if (!points) return null;
        if (Array.isArray(points)) return points[index] || null;
        if (typeof points === 'object') return points[index] || points[String(index)] || null;
        return null;
      }

      function mapPointToCanvas(ctx, point) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        return {
          x: Math.max(0, Math.min(1, point.x)) * ctx.canvas.width,
          y: Math.max(0, Math.min(1, point.y)) * ctx.canvas.height,
        };
      }

      function drawConnections(ctx, points, connections, color = '#00FF7F', lineWidth = 1) {
        if (!points || !Array.isArray(connections) || !connections.length) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        for (const [start, end] of connections) {
          const a = mapPointToCanvas(ctx, getPointAt(points, start));
          const b = mapPointToCanvas(ctx, getPointAt(points, end));
          if (!a || !b) continue;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      function drawPoints(ctx, points, color = '#00FF7F') {
        if (!points) return;
        const source = Array.isArray(points) ? points : Object.values(points);
        ctx.fillStyle = color;
        for (const p of source) {
          const mapped = mapPointToCanvas(ctx, p);
          if (!mapped) continue;
          ctx.beginPath();
          ctx.arc(mapped.x, mapped.y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      function streamAndAnimate() {
        const canvas = document.getElementById('sv-canvas');
        const wordEl = document.getElementById('sv-word');
        if (!canvas || !wordEl) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Use a Port so large payloads don't break runtime message limits.
        const port = chrome.runtime.connect({ name: 'sv-port' });
        const frames = [];
        let done = false;
        let started = false;
        let i = 0;
        const defaultFps = 20;
        const fingerspellFps = 30;
        let responseReceivedAtMs = 0;
        let firstFrameLogged = false;

        function tick() {
          if (i < frames.length) {
            const f = frames[i];
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            wordEl.textContent = f.word || wordEl.textContent;
            drawConnections(ctx, f.pose_landmarks, POSE_CONNECTIONS, '#16a34a', 2);
            drawConnections(ctx, f.face_landmarks, FACE_CONNECTIONS, '#06b6d4', 0.8);
            drawConnections(ctx, f.right_hand_landmarks, HAND_CONNECTIONS, '#eab308', 2);
            drawConnections(ctx, f.left_hand_landmarks, HAND_CONNECTIONS, '#ec4899', 2);

            drawPoints(ctx, f.pose_landmarks, '#22c55e');
            drawPoints(ctx, f.face_landmarks, '#22d3ee');
            drawPoints(ctx, f.right_hand_landmarks, '#facc15');
            drawPoints(ctx, f.left_hand_landmarks, '#f472b6');
            if (!firstFrameLogged && responseReceivedAtMs > 0) {
              firstFrameLogged = true;
              const firstMotionDelayMs = performance.now() - responseReceivedAtMs;
              console.info(
                '[sv][perf][context] first-motion delay (response->first-frame):',
                `${firstMotionDelayMs.toFixed(1)}ms`,
                { bufferedFrames: frames.length }
              );
            }
            i += 1;
          }
          if (!done || i < frames.length) {
            const nextFrame = frames[i] || null;
            const fps = isFingerspellFrame(nextFrame) ? fingerspellFps : defaultFps;
            setTimeout(() => requestAnimationFrame(tick), 1000 / fps);
          }
        }

        port.onMessage.addListener((msg) => {
          if (!msg) return;
          if (msg.type === 'POSE_META' && msg.url) {
            // Could show url in UI if needed.
            return;
          }
          if (msg.type === 'POSE_CHUNK' && Array.isArray(msg.frames)) {
            if (!responseReceivedAtMs) {
              responseReceivedAtMs = performance.now();
            }
            frames.push(...msg.frames);
            if (!started) {
              started = true;
              requestAnimationFrame(tick);
            }
            return;
          }
          if (msg.type === 'POSE_DONE') {
            done = true;
            if (!started && frames.length === 0) {
              wordEl.textContent = 'No frames returned.';
            }
            return;
          }
          if (msg.type === 'POSE_ERROR') {
            done = true;
            const err = document.createElement('div');
            err.textContent = msg.message || 'Failed to fetch poses.';
            err.style.color = '#fca5a5';
            err.style.fontSize = '12px';
            overlay.appendChild(err);
            try { port.disconnect(); } catch (e) {}
          }
        });

        port.postMessage({ type: 'FETCH_POSE', words: text });
      }

      const overlay = ensureOverlay();
      const canvas = overlay.querySelector('#sv-canvas');
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const loading = 'Loading…';
      overlay.querySelector('#sv-word').textContent = loading;

      // Stream poses via background to avoid message size limits.
      streamAndAnimate();
    }
  });
});

// Stream poses over a Port to avoid message size limits and mixed content from pages
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sv-port') return;
  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== 'FETCH_POSE') return;
    try {
      const runtimeMode = inferRuntimeModeFromUrl(port?.sender?.url);
      const runtimeDefaultUrl = getDefaultPoseUrlForRuntime(runtimeMode);

      getPoseUrl(async (poseUrl) => {
        const url = normalizePoseUrl(msg.url || poseUrl, runtimeDefaultUrl);
        try {
          port.postMessage({ type: 'POSE_META', url });
        } catch (e) {
          // ignore
        }

        const { data, url: usedUrl } = await fetchPoseWithFallback(
          msg.words || '',
          url,
          runtimeDefaultUrl
        );
        if (usedUrl !== url) {
          try {
            port.postMessage({ type: 'POSE_META', url: usedUrl });
          } catch (e) {
            // ignore
          }
        }
        const CHUNK = 200;
        for (let i = 0; i < data.length; i += CHUNK) {
          port.postMessage({ type: 'POSE_CHUNK', frames: data.slice(i, i + CHUNK) });
        }
        port.postMessage({ type: 'POSE_DONE' });
      }, runtimeDefaultUrl);
    } catch (e) {
      port.postMessage({ type: 'POSE_ERROR', message: String(e) });
    }
  });
});
