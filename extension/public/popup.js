document.addEventListener('DOMContentLoaded', () => {
  const ytBadge = document.getElementById('yt-badge');
  const ytHow = document.getElementById('yt-how');
  const meetBadge = document.getElementById('meet-badge');
  const meetHow = document.getElementById('meet-how');
  const meetBtn = document.getElementById('meet-insert-btn');

  const poseUrlInput = document.getElementById('pose-api-url');
  const poseSaveBtn = document.getElementById('pose-save-btn');
  const poseUseLocalBtn = document.getElementById('pose-use-local-btn');
  const poseTestBtn = document.getElementById('pose-test-btn');
  const poseStatus = document.getElementById('pose-status');

  const CANONICAL_LOCAL_POSE_BASE = 'http://127.0.0.1:5000';
  const DEFAULT_POSE_URL = `${CANONICAL_LOCAL_POSE_BASE}/pose`;

  function normalizePoseUrl(url) {
    const u = (url || '').trim();
    if (!u) return DEFAULT_POSE_URL;
    if (!/\/pose\b/i.test(u)) return u.replace(/\/+$/, '') + '/pose';
    return u;
  }

  function setStatus(text, kind) {
    if (!poseStatus) return;
    poseStatus.textContent = text || '';
    poseStatus.style.color = kind === 'error' ? '#b91c1c' : kind === 'ok' ? '#166534' : '#475569';
  }

  function loadPoseUrl() {
    if (!poseUrlInput) return;
    try {
      chrome.storage.sync.get({ poseApiUrl: '' }, (items) => {
        const url = normalizePoseUrl(items.poseApiUrl);
        // Show as base URL when possible
        poseUrlInput.value = url.replace(/\/pose\b.*/i, '');
        setStatus(`Using: ${url} (prod exception keeps pose on localhost)`, 'muted');
      });
    } catch (e) {
      poseUrlInput.value = CANONICAL_LOCAL_POSE_BASE;
      setStatus('Using local default.', 'muted');
    }
  }

  function savePoseUrl(raw) {
    const url = normalizePoseUrl(raw);
    try {
      chrome.storage.sync.set({ poseApiUrl: url }, () => {
        setStatus(`Saved: ${url}`, 'ok');
      });
    } catch (e) {
      setStatus(`Failed to save: ${e}`, 'error');
    }
  }

  function setBadge(badge, active) {
    if (!badge) return;
    badge.textContent = active ? 'Active' : 'Inactive';
    badge.classList.toggle('active', !!active);
    badge.classList.toggle('inactive', !active);
  }

  function ensureMeetScript(tabId, cb) {
    try {
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['meetContentScript.js'] },
        () => cb && cb()
      );
    } catch (e) {
      cb && cb();
    }
  }

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const tab = (tabs && tabs[0]) || null;
    const url = tab && tab.url ? new URL(tab.url) : null;

    // YouTube status
    const onWatch = url && url.hostname.includes('youtube.com') && url.pathname.startsWith('/watch');
    setBadge(ytBadge, !!onWatch);
    if (ytHow) ytHow.textContent = onWatch ? 'Status: Active on this page.' : 'Open a YouTube video to activate.';

    // Meet status
    const onMeet = url && /(^|\.)meet\.google\.com$/.test(url.hostname);
    setBadge(meetBadge, !!onMeet);
    if (meetHow) meetHow.textContent = onMeet ? 'Click to insert the canvas overlay on this Meet page.' : 'Open a meet.google.com tab to use Meet mode.';

    if (meetBtn) {
      meetBtn.disabled = !onMeet;
      meetBtn.addEventListener('click', () => {
        if (!tab?.id) return;
        chrome.tabs.sendMessage(tab.id, { type: 'SV_TOGGLE_MEET_PANEL', enable: true }, () => {
          if (chrome.runtime.lastError) {
            ensureMeetScript(tab.id, () => {
              setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, { type: 'SV_TOGGLE_MEET_PANEL', enable: true });
              }, 100);
            });
          }
        });
      });
    }
  });

  // Pose server settings
  loadPoseUrl();

  if (poseUseLocalBtn) {
    poseUseLocalBtn.addEventListener('click', () => {
      if (poseUrlInput) poseUrlInput.value = CANONICAL_LOCAL_POSE_BASE;
      savePoseUrl(CANONICAL_LOCAL_POSE_BASE);
    });
  }

  if (poseSaveBtn) {
    poseSaveBtn.addEventListener('click', () => {
      savePoseUrl(poseUrlInput ? poseUrlInput.value : '');
    });
  }

  if (poseTestBtn) {
    poseTestBtn.addEventListener('click', () => {
      const url = normalizePoseUrl(poseUrlInput ? poseUrlInput.value : '');
      setStatus(`Testing: ${url}`, 'muted');
      chrome.runtime.sendMessage({ type: 'FETCH_POSE', words: 'hello', url }, (res) => {
        if (!res || !res.ok) {
          setStatus(`Test failed: ${res?.error || chrome.runtime.lastError?.message || 'unknown error'}`, 'error');
          return;
        }
        const frames = Array.isArray(res.data) ? res.data.length : 0;
        const usedUrl = res.url || url;
        setStatus(`OK (${frames} frames) via ${usedUrl}`, 'ok');
      });
    });
  }
});
