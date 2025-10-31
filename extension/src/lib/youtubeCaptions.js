// Browser-only Innertube captions utility for YouTube
// No Node-only dependencies; uses window.fetch and DOMParser.

function extractApiKeyFromHtml(html) {
  const match = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  return match ? match[1] : null;
}

async function getInnertubeApiKey(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(url, { credentials: 'omit' });
  const html = await res.text();
  const key = extractApiKeyFromHtml(html);
  if (!key) throw new Error('INNERTUBE_API_KEY not found.');
  return key;
}

async function getPlayerResponse(videoId, apiKey) {
  const endpoint = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`;
  const body = {
    context: {
      client: { clientName: 'ANDROID', clientVersion: '20.10.38' },
    },
    videoId,
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // No need for auth; rely on host permissions in the manifest
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Innertube player request failed: ${res.status}`);
  }
  return res.json();
}

function pickCaptionTrack(playerResponse, language = 'en') {
  const tracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || !tracks.length) throw new Error('No caption tracks found.');

  const byLang = tracks.find((t) => t.languageCode === language);
  return byLang || tracks[0];
}

function cleanBaseUrl(url) {
  // Remove &fmt=... suffix if present
  return url.replace(/&fmt=\w+$/, '');
}

function parseTranscriptXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const nodes = Array.from(doc.getElementsByTagName('text'));

  return nodes.map((node) => {
    const start = parseFloat(node.getAttribute('start') || '0');
    const dur = parseFloat(node.getAttribute('dur') || '0');
    // textContent decodes HTML entities
    const text = (node.textContent || '').trim();

    return {
      text,
      offset: start,
      duration: dur,
    };
  });
}

export async function getYoutubeTranscript(videoId, language = 'en') {
  if (!videoId) throw new Error('videoId is required.');

  const apiKey = await getInnertubeApiKey(videoId);
  const playerData = await getPlayerResponse(videoId, apiKey);
  const track = pickCaptionTrack(playerData, language);
  const baseUrl = cleanBaseUrl(track.baseUrl);

  const res = await fetch(baseUrl);
  if (!res.ok) throw new Error(`Captions fetch failed: ${res.status}`);
  const xml = await res.text();

  return parseTranscriptXml(xml);
}
