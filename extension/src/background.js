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
