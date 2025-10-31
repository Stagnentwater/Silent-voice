(function () {
  if (window.__sign_engine_probe) return;
  window.__sign_engine_probe = true;
  try {
    console.info('[sign-engine] page-probe loaded');
  } catch {}

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
        } catch {}
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
    } catch {}
    return false;
  }

  // Try immediately; if not available yet, retry for a short time while YT initializes
  if (!extractAndPost()) {
    let attempts = 0;
    const maxAttempts = 40; // ~20s
    const iv = setInterval(() => {
      attempts++;
      if (extractAndPost() || attempts >= maxAttempts) clearInterval(iv);
    }, 500);
  }

  // Also react to YouTube SPA navigation/player update events
  ['yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated'].forEach(
    (ev) => {
      window.addEventListener(ev, () => setTimeout(extractAndPost, 0), {
        passive: true,
      });
    }
  );

  // Handle fetch requests from the content script in the page context
  window.addEventListener('message', async (e) => {
    try {
      const data = e && e.data;
      if (!data) return;
      if (data.type === 'SIGNENGINE_FETCH' && data.url && data.id) {
        const id = data.id;
        try {
          const init =
            data.init && typeof data.init === 'object' ? data.init : {};
          // Ensure we include credentials like cookies
          init.credentials = 'include';
          const res = await fetch(data.url, init);
          const ok = !!res && res.ok;
          const status = res ? res.status : 0;
          const statusText = res ? res.statusText : '';
          const text = ok ? await res.text() : '';
          window.postMessage(
            {
              type: 'SIGNENGINE_FETCH_RESULT',
              id,
              ok,
              status,
              statusText,
              text,
            },
            '*'
          );
        } catch (err) {
          window.postMessage(
            {
              type: 'SIGNENGINE_FETCH_RESULT',
              id,
              ok: false,
              status: 0,
              statusText: String(err),
              text: '',
            },
            '*'
          );
        }
        return;
      }

      if (data.type === 'SIGNENGINE_GET_INNERTUBE_KEY' && data.id) {
        const id = data.id;
        try {
          let key = null;
          try {
            if (window.ytcfg && typeof window.ytcfg.get === 'function') {
              key = window.ytcfg.get('INNERTUBE_API_KEY');
            }
          } catch {}
          if (!key) {
            try {
              key =
                window.ytcfg &&
                window.ytcfg.data &&
                window.ytcfg.data.INNERTUBE_API_KEY;
            } catch {}
          }
          window.postMessage(
            { type: 'SIGNENGINE_INNERTUBE_KEY', id, key: key || '' },
            '*'
          );
        } catch (err) {
          window.postMessage(
            { type: 'SIGNENGINE_INNERTUBE_KEY', id, key: '' },
            '*'
          );
        }
        return;
      }
    } catch {}
  });
})();
// Runs in the page context (loaded via <script src=chrome-extension://...>).
(function () {
  if (window.__sign_engine_probe) return;
  window.__sign_engine_probe = true;
  try {
    console.info('[sign-engine] page-probe loaded');
  } catch {}

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
        } catch {}
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
    } catch {}
    return false;
  }

  // Try immediately, retry while the player initializes
  if (!extractAndPost()) {
    let attempts = 0;
    const maxAttempts = 40; // ~20s
    const iv = setInterval(() => {
      attempts++;
      if (extractAndPost() || attempts >= maxAttempts) clearInterval(iv);
    }, 500);
  }

  // Also respond to YT SPA navigation events
  ['yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated'].forEach(
    (ev) => {
      window.addEventListener(ev, () => setTimeout(extractAndPost, 0), {
        passive: true,
      });
    }
  );
})();
