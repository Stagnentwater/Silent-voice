document.addEventListener('DOMContentLoaded', () => {
  const ytBadge = document.getElementById('yt-badge');
  const ytHow = document.getElementById('yt-how');
  const meetBadge = document.getElementById('meet-badge');
  const meetHow = document.getElementById('meet-how');
  const meetBtn = document.getElementById('meet-insert-btn');

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
});
