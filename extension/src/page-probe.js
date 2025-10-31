(function () {
  if (window.__sign_engine_probe) return;
  window.__sign_engine_probe = true;

  function extractAndPost() {
    try {
      let pr = window.ytInitialPlayerResponse;
      if (
        !pr &&
        window.ytplayer &&
        window.ytplayer.config &&
        window.ytplayer.config.args &&
        window.ytplayer.config.args.player_response
      ) {
        try {
          pr = JSON.parse(window.ytplayer.config.args.player_response);
        } catch (_) {}
      }

      const tracks =
        pr &&
        pr.captions &&
        pr.captions.playerCaptionsTracklistRenderer &&
        pr.captions.playerCaptionsTracklistRenderer.captionTracks;

      if (Array.isArray(tracks) && tracks.length) {
        window.postMessage(
          { type: 'YT_CAPTION_TRACKS', captionTracks: tracks },
          '*'
        );
        return true;
      }
    } catch (_) {}
    return false;
  }

  // Try now and then retry for SPA navigations
  if (!extractAndPost()) {
    let attempts = 0;
    const maxAttempts = 30; // ~15s
    const iv = setInterval(() => {
      attempts++;
      if (extractAndPost() || attempts >= maxAttempts) clearInterval(iv);
    }, 500);
  }

  // Nudge on YT’s navigation events
  ['yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated'].forEach(
    (ev) => {
      window.addEventListener(ev, () => setTimeout(extractAndPost, 0), {
        passive: true,
      });
    }
  );
})();
