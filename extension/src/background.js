// https://github.com/kevinjosethomas/sign-engine/blob/main/extension/src/background.js
// Background service worker: performs network requests to local server on behalf of the content script
// Returns { ok: true, data } or { ok: false, error }

const DEFAULT_POSE_URL = 'http://127.0.0.1:5000/pose';

function normalizePoseUrl(url) {
  const u = (url || '').trim();
  if (!u) return DEFAULT_POSE_URL;
  // Allow passing a base URL like https://my-api.vercel.app
  if (!/\/pose\b/i.test(u)) {
    return u.replace(/\/+$/, '') + '/pose';
  }
  return u;
}

function getPoseUrl(callback) {
  try {
    chrome.storage.sync.get({ poseApiUrl: '' }, (items) => {
      callback(normalizePoseUrl(items.poseApiUrl));
    });
  } catch (e) {
    callback(DEFAULT_POSE_URL);
  }
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'FETCH_POSE') return;

  const words = message.words || '';

  getPoseUrl((poseUrl) => {
    const url = normalizePoseUrl(message.url || poseUrl);
    fetchPose(words, url)
      .then((data) => sendResponse({ ok: true, data, url }))
      .catch((err) => {
        console.error('[sign-engine][background] fetch error', err);
        sendResponse({ ok: false, error: String(err), url });
      });
  });

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

      function drawPoints(ctx, points, color = '#00FF7F') {
        if (!Array.isArray(points)) return;
        ctx.fillStyle = color;
        for (const p of points) {
          const x = Math.max(0, Math.min(1, p.x || 0)) * ctx.canvas.width;
          const y = Math.max(0, Math.min(1, p.y || 0)) * ctx.canvas.height;
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
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
        const fps = 30; // best-effort playback

        function tick() {
          if (i < frames.length) {
            const f = frames[i];
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            wordEl.textContent = f.word || wordEl.textContent;
            drawPoints(ctx, f.pose_landmarks, '#22c55e');
            drawPoints(ctx, f.face_landmarks, '#22d3ee');
            drawPoints(ctx, f.right_hand_landmarks, '#facc15');
            drawPoints(ctx, f.left_hand_landmarks, '#f472b6');
            i += 1;
          }
          if (!done || i < frames.length) {
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
      getPoseUrl(async (poseUrl) => {
        const url = normalizePoseUrl(msg.url || poseUrl);
        try {
          port.postMessage({ type: 'POSE_META', url });
        } catch (e) {
          // ignore
        }

        const data = await fetchPose(msg.words || '', url);
        const CHUNK = 200;
        for (let i = 0; i < data.length; i += CHUNK) {
          port.postMessage({ type: 'POSE_CHUNK', frames: data.slice(i, i + CHUNK) });
        }
        port.postMessage({ type: 'POSE_DONE' });
      });
    } catch (e) {
      port.postMessage({ type: 'POSE_ERROR', message: String(e) });
    }
  });
});
