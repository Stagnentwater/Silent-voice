// https://github.com/kevinjosethomas/sign-engine/blob/main/extension/src/background.js
// Background service worker: performs network requests to local server on behalf of the content script
// Returns { ok: true, data } or { ok: false, error }

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'FETCH_POSE') return;

  const words = message.words || '';
  const url = message.url || 'http://127.0.0.1:5000/pose'; // use http by default to avoid cert issues

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      sendResponse({ ok: true, data });
    })
    .catch((err) => {
      console.error('[sign-engine][background] fetch error', err);
      sendResponse({ ok: false, error: String(err) });
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
        hint.textContent = 'Rendering locally from your Silent-voice server';
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

      function animateFrames(frames) {
        const canvas = document.getElementById('sv-canvas');
        const wordEl = document.getElementById('sv-word');
        if (!canvas || !wordEl) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let i = 0;
        const fps = 30; // best-effort playback
        function tick() {
          if (i >= frames.length) return;
          const f = frames[i];
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          wordEl.textContent = f.word || wordEl.textContent;
          drawPoints(ctx, f.pose_landmarks, '#22c55e');
          drawPoints(ctx, f.face_landmarks, '#22d3ee');
          drawPoints(ctx, f.right_hand_landmarks, '#facc15');
          drawPoints(ctx, f.left_hand_landmarks, '#f472b6');
          i += 1;
          setTimeout(() => requestAnimationFrame(tick), 1000 / fps);
        }
        requestAnimationFrame(tick);
      }

      const overlay = ensureOverlay();
      const canvas = overlay.querySelector('#sv-canvas');
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const loading = 'Loading…';
      overlay.querySelector('#sv-word').textContent = loading;

      // Fetch poses via background to avoid CORS/mixed-content issues
      chrome.runtime.sendMessage({ type: 'FETCH_POSE', words: text }, (res) => {
        if (!res || !res.ok) {
          const err = document.createElement('div');
          err.textContent = 'Could not reach local server at http://127.0.0.1:5000. Is it running?';
          err.style.color = '#fca5a5';
          err.style.fontSize = '12px';
          overlay.appendChild(err);
          return;
        }
        const frames = res.data || [];
        animateFrames(frames);
      });
    }
  });
});

// Stream poses over a Port to avoid message size limits and mixed content from pages
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sv-port') return;
  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== 'FETCH_POSE') return;
    try {
      const resp = await fetch('http://127.0.0.1:5000/pose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: msg.words || '' }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const CHUNK = 200;
      for (let i = 0; i < data.length; i += CHUNK) {
        port.postMessage({ type: 'POSE_CHUNK', frames: data.slice(i, i + CHUNK) });
      }
      port.postMessage({ type: 'POSE_DONE' });
    } catch (e) {
      port.postMessage({ type: 'POSE_ERROR', message: String(e) });
    }
  });
});
