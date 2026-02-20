import {
  HAND_CONNECTIONS,
  POSE_CONNECTIONS,
  FACEMESH_TESSELATION,
} from '@mediapipe/holistic';
import { drawConnectors } from '@mediapipe/drawing_utils';
import { getYoutubeTranscript } from './lib/youtubeCaptions';

let transcript;
const BATCH_SIZE = 2;
const FETCH_AHEAD_TIME = 10;
const PLAYBACK_FPS = 20;
const FINGERSPELL_FPS = 30;
const CONTAINER_RETRY_INTERVAL_MS = 500;
const MAX_CONTAINER_RETRIES = 20;
const PRELOAD_POLL_MS = 250;
const SEGMENT_POLL_MS = 120;
const MAX_FETCH_RETRIES = 3;
const MAX_SEGMENT_WAIT_MS = 2500;
const STARTUP_BUFFER_MS = 15000;
const STARTUP_BUFFER_POLL_MS = 80;
const AGGRESSIVE_PREFETCH_POLL_MS = 300;
const AGGRESSIVE_BATCH_SIZE = 6;
const AGGRESSIVE_BATCH_SIZE_PAUSED = 12;
const CONTINUOUS_FETCH_POLL_MS = 120;
const PLAYER_BIND_POLL_MS = 500;
let avatar, avatarContainer, currentSegment, word, fetchProgress;
let queueProcessing = false;
let activeAnimationRafId = null;
let activeAnimationRunId = 0;
let activeSegmentId = null;
let resumeAnimationFn = null;
let isPlayerPaused = false;
let continuousFetchTimer = null;
const poseCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHTMLEntities(str) {
  const output = str
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  return output;
}

function fetchTranscript() {
  const videoId = new URL(window.location.href).searchParams.get('v');
  return getYoutubeTranscript(videoId, 'en');
}

function addContainer() {
  if (avatarContainer && document.contains(avatarContainer)) {
    return true;
  }

  const targetElement =
    document.getElementById('secondary-inner') ||
    document.getElementById('secondary') ||
    document.querySelector('ytd-watch-flexy #columns');

  if (!targetElement) {
    return false;
  }

  avatarContainer = document.createElement('div');
  avatarContainer.id = 'avatar-container';
  avatarContainer.style.position = 'relative';
  avatar = document.createElement('canvas');
  avatar.id = 'avatar';
  avatar.style.position = 'relative';
  avatar.style.zIndex = '1';
  avatarContainer.appendChild(avatar);

  word = document.createElement('p');
  word.id = 'word';
  avatarContainer.appendChild(word);

  fetchProgress = document.createElement('p');
  fetchProgress.id = 'fetch-progress';
  fetchProgress.innerText = 'Fetched: 0 / 0 transcripts';
  avatarContainer.appendChild(fetchProgress);

  targetElement.insertBefore(avatarContainer, targetElement.firstChild);
  return true;
}

function updateFetchProgress() {
  if (!fetchProgress) return;
  if (!transcript || !transcript.length) {
    fetchProgress.innerText = 'Fetched: 0 / 0 transcripts';
    return;
  }

  const total = transcript.length;
  const fetched = transcript.filter((segment) => segment.poses !== undefined).length;
  const skipped = transcript.filter((segment) => segment.skipped).length;
  fetchProgress.innerText =
    skipped > 0
      ? `Fetched: ${fetched} / ${total} transcripts (skipped: ${skipped})`
      : `Fetched: ${fetched} / ${total} transcripts`;
}

function ensureContainerWithRetry() {
  if (addContainer()) return;

  let attempts = 0;
  const retryTimer = setInterval(() => {
    attempts += 1;
    if (addContainer() || attempts >= MAX_CONTAINER_RETRIES) {
      clearInterval(retryTimer);
    }
  }, CONTAINER_RETRY_INTERVAL_MS);
}

function getCurrentTime() {
  const player = document.querySelector('video');
  if (player) {
    return player.currentTime;
  }
  return 0;
}

function drawLandmarks(landmark, ctx) {
  if (landmark.pose_landmarks) {
    landmark.pose_landmarks.forEach((point) => {
      point.visibility = 1;
    });

    drawConnectors(ctx, landmark.pose_landmarks, POSE_CONNECTIONS, {
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

function getSegmentId(segment) {
  return segment.id || `${segment.offset}-${segment.duration}-${segment.text}`;
}

function getCacheKey(segment) {
  return (segment.text || '').trim().toLowerCase();
}

function getSegmentAtTime(time) {
  if (!transcript) return null;
  return (
    transcript.find(
      (segment) => segment.offset <= time && segment.offset + segment.duration >= time
    ) || null
  );
}

function stopActiveAnimation() {
  activeAnimationRunId += 1;
  if (activeAnimationRafId !== null) {
    cancelAnimationFrame(activeAnimationRafId);
    activeAnimationRafId = null;
  }
  activeSegmentId = null;
  resumeAnimationFn = null;
}

function syncPlaybackToCurrentTimestamp() {
  if (!transcript) return;

  const currentTime = getCurrentTime();
  const segment = getSegmentAtTime(currentTime);

  if (!segment) {
    currentSegment = null;
    stopActiveAnimation();
    if (word) word.innerText = '';
    return;
  }

  currentSegment = segment;

  if (!segment.poses && !segment.loading && !segment.skipped) {
    processQueue(currentTime);
    if (word) word.innerText = 'Loading sign poses...';
    return;
  }

  if (segment.poses) {
    playAnimation(segment);
  }
}

function fetchSegmentPoses(segment) {
  if (segment.skipped) {
    segment.loading = false;
    return Promise.resolve(segment);
  }

  const words = segment.text;
  const cacheKey = getCacheKey(segment);
  const cached = poseCache.get(cacheKey);

  if (cached && Array.isArray(cached) && cached.length) {
    segment.poses = cached;
    segment.poseResponseReceivedAtMs = performance.now();
    segment.loading = false;
    segment.failedCount = 0;
    return Promise.resolve(segment);
  }

  if (!segment.firstFetchAt) {
    segment.firstFetchAt = Date.now();
  }

  segment.loading = true;

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'FETCH_POSE', words }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        const err = chrome.runtime.lastError?.message || res?.error || 'fetch failed';
        console.debug('[sign-engine][background] /pose error', err, { text: segment.text });
        segment.loading = false;
        segment.failedCount = (segment.failedCount || 0) + 1;
        const waitedMs = Date.now() - (segment.firstFetchAt || Date.now());
        const shouldSkip =
          segment.failedCount >= MAX_FETCH_RETRIES || waitedMs >= MAX_SEGMENT_WAIT_MS;

        if (shouldSkip) {
          segment.skipped = true;
          segment.nextRetryAt = 0;
          return resolve(segment);
        }

        const backoffMs = Math.min(1500, 300 * segment.failedCount);
        segment.nextRetryAt = Date.now() + backoffMs;
        return resolve(segment);
      }

      segment.poses = res.data;
      segment.poseResponseReceivedAtMs = performance.now();
      segment.loading = false;
      segment.failedCount = 0;
      segment.firstFetchAt = 0;
      segment.skipped = false;
      segment.nextRetryAt = 0;

      if (Array.isArray(res.data) && res.data.length) {
        poseCache.set(cacheKey, res.data);
      }

      resolve(segment);
    });
  });
}

function getFetchCandidates(currentTime, options = {}) {
  if (!transcript) return [];

  const aggressive = !!options.aggressive;

  const now = Date.now();
  const preloadUntil = currentTime + FETCH_AHEAD_TIME;

  const candidates = transcript.filter((segment) => {
    if (segment.poses || segment.loading || segment.skipped) return false;
    if ((segment.failedCount || 0) > MAX_FETCH_RETRIES) return false;
    if (segment.nextRetryAt && segment.nextRetryAt > now) return false;

    if (aggressive) {
      return true;
    }

    const segmentEnd = segment.offset + segment.duration;
    const inCurrentWindow = segment.offset <= currentTime && segmentEnd >= currentTime;
    const isNearFuture = segment.offset <= preloadUntil && segmentEnd >= currentTime - 1;
    return inCurrentWindow || isNearFuture;
  });

  candidates.sort((a, b) => {
    const aInWindow = a.offset <= currentTime && a.offset + a.duration >= currentTime;
    const bInWindow = b.offset <= currentTime && b.offset + b.duration >= currentTime;

    if (aInWindow !== bInWindow) {
      return aInWindow ? -1 : 1;
    }

    const aDistance =
      a.offset >= currentTime
        ? a.offset - currentTime
        : currentTime - (a.offset + a.duration) + 100;
    const bDistance =
      b.offset >= currentTime
        ? b.offset - currentTime
        : currentTime - (b.offset + b.duration) + 100;
    return aDistance - bDistance;
  });

  return candidates;
}

function hasPendingSegments() {
  if (!transcript) return false;
  const now = Date.now();
  return transcript.some((segment) => {
    if (segment.poses || segment.loading || segment.skipped) return false;
    if (segment.nextRetryAt && segment.nextRetryAt > now) return false;
    return true;
  });
}

function startContinuousFetchLoop() {
  if (continuousFetchTimer) {
    clearInterval(continuousFetchTimer);
  }

  continuousFetchTimer = setInterval(() => {
    if (!transcript || !hasPendingSegments()) return;

    const player = document.querySelector('video');
    const paused = !!player && player.paused && !player.ended;
    const time = getCurrentTime();

    processQueue(time, {
      aggressive: true,
      batchSize: paused ? AGGRESSIVE_BATCH_SIZE_PAUSED : AGGRESSIVE_BATCH_SIZE,
    });
  }, CONTINUOUS_FETCH_POLL_MS);
}

function processQueue(currentTime = getCurrentTime(), options = {}) {
  if (!transcript || queueProcessing) return Promise.resolve(false);

  const aggressive = !!options.aggressive;
  const batchSize = options.batchSize || BATCH_SIZE;

  const candidates = getFetchCandidates(currentTime, { aggressive }).slice(0, batchSize);
  if (!candidates.length) return Promise.resolve(false);

  queueProcessing = true;
  return Promise.all(candidates.map((segment) => fetchSegmentPoses(segment)))
    .then(() => true)
    .finally(() => {
      queueProcessing = false;
      updateFetchProgress();
    });
}

async function startupBufferAndPrefetch() {
  if (!transcript || !transcript.length) return;

  const player = document.querySelector('video');
  const shouldResume = !!player && !player.paused && !player.ended;

  if (player && shouldResume) {
    player.pause();
  }

  if (word) {
    word.innerText = 'pause the video for 15 sec to calibrate the subs to the poses';
  }

  const bufferStart = Date.now();
  while (Date.now() - bufferStart < STARTUP_BUFFER_MS) {
    const currentTime = getCurrentTime();
    await processQueue(currentTime, {
      aggressive: true,
      batchSize: AGGRESSIVE_BATCH_SIZE,
    });

    if (!hasPendingSegments()) {
      break;
    }

    await sleep(STARTUP_BUFFER_POLL_MS);
  }

  if (word) {
    word.innerText = '';
  }

  if (player && shouldResume) {
    player.play().catch(() => {
      // Playback may be blocked by browser policy; ignore.
    });
  }
}

function playAnimation(segment) {
  /* Play the animation of the avatar */
  const poses = segment.poses;

  if (!poses) {
    currentSegment = null;
    return;
  }
  if (!avatar) {
    currentSegment = null;
    return;
  }
  const ctx = avatar.getContext('2d');
  if (!ctx) {
    currentSegment = null;
    return;
  }

  const segmentId = getSegmentId(segment);
  if (activeSegmentId === segmentId) {
    return;
  }

  stopActiveAnimation();
  activeSegmentId = segmentId;
  const runId = activeAnimationRunId;

  const isFingerspelling = poses.some(
    (pose) => typeof pose?.word === 'string' && pose.word.startsWith('fs-')
  );
  const targetFps = isFingerspelling ? FINGERSPELL_FPS : PLAYBACK_FPS;
  const frameDurationMs = 1000 / targetFps;

  let frameIndex = 0;
  let firstFrameLogged = false;
  let lastFrameAt = 0;
  let lastRenderedFrame = -1;

  function drawFrame(now) {
    const landmark = poses[frameIndex];
    if (!landmark) return;

    if (word) word.innerText = '';
    ctx.clearRect(0, 0, avatar.width, avatar.height);
    drawLandmarks(landmark, ctx);

    const poseWord =
      typeof landmark.word === 'string' && landmark.word.trim().length
        ? landmark.word
        : segment.text || '';

    if (word) {
      word.innerText = poseWord || '';
    }

    if (!firstFrameLogged && segment.poseResponseReceivedAtMs) {
      firstFrameLogged = true;
      const firstMotionDelayMs = performance.now() - segment.poseResponseReceivedAtMs;
      console.info(
        '[sv][perf] first-motion delay (response->first-frame):',
        `${firstMotionDelayMs.toFixed(1)}ms`,
        { text: segment.text, frames: poses.length }
      );
    }

    lastFrameAt = now;
    lastRenderedFrame = frameIndex;
  }

  function animate(now) {
    if (runId !== activeAnimationRunId) {
      return;
    }

    if (isPlayerPaused) {
      if (lastRenderedFrame !== frameIndex) {
        drawFrame(now);
      }
      // Do not schedule another frame while paused.
      return;
    }

    if (frameIndex >= poses.length) {
      currentSegment = null;
      if (runId === activeAnimationRunId) {
        activeAnimationRafId = null;
        activeSegmentId = null;
      }
      return;
    }

    const player = document.querySelector('video');
    const isPaused = isPlayerPaused || (!!player && player.paused && !player.ended);

    if (isPaused) {
      if (lastRenderedFrame !== frameIndex) {
        drawFrame(now);
      }
      // Freeze the frame while paused; restart when playback resumes.
      isPlayerPaused = true;
      if (activeAnimationRafId) {
        cancelAnimationFrame(activeAnimationRafId);
      }
      activeAnimationRafId = null;
      resumeAnimationFn = () => {
        if (runId === activeAnimationRunId && !activeAnimationRafId && !isPlayerPaused) {
          activeAnimationRafId = requestAnimationFrame(animate);
        }
      };
      return;
    }

    if (lastFrameAt && now - lastFrameAt < frameDurationMs) {
      activeAnimationRafId = requestAnimationFrame(animate);
      return;
    }

    drawFrame(now);
    frameIndex++;
    activeAnimationRafId = requestAnimationFrame(animate);
  }

  activeAnimationRafId = requestAnimationFrame(animate);
}

function bindPlayerEvents() {
  const player = document.querySelector('video');
  if (!player || player.__svPlaybackBound) return;

  player.__svPlaybackBound = true;

  const resume = () => {
    isPlayerPaused = false;
    stopActiveAnimation();
    syncPlaybackToCurrentTimestamp();
  };

  const pause = () => {
    isPlayerPaused = true;
    if (activeAnimationRafId) {
      cancelAnimationFrame(activeAnimationRafId);
      activeAnimationRafId = null;
    }
  };

  player.addEventListener('play', resume);
  player.addEventListener('playing', resume);
  player.addEventListener('seeked', resume);
  player.addEventListener('pause', pause);
}

function startPlayerBindingLoop() {
  setInterval(() => {
    bindPlayerEvents();
  }, PLAYER_BIND_POLL_MS);
}

function initializeExtension() {
  if (avatar || avatarContainer) {
    avatar?.remove();
    avatarContainer?.remove();
  }

  fetchTranscript()
    .then((data) => {
      transcript = data.map((x, index) => ({
        id: `seg-${index}`,
        ...x,
        text: decodeHTMLEntities(x.text),
        loading: false,
        failedCount: 0,
        firstFetchAt: 0,
        skipped: false,
        nextRetryAt: 0,
      }));
      updateFetchProgress();
      processQueue(getCurrentTime(), {
        aggressive: true,
        batchSize: AGGRESSIVE_BATCH_SIZE,
      });
      startContinuousFetchLoop();
      startupBufferAndPrefetch();
    })
    .catch((err) => {
      console.error('[sign-engine][youtube] transcript fetch failed', err);
      if (word) word.innerText = 'Transcript unavailable.';
      if (fetchProgress) fetchProgress.innerText = 'Fetched: 0 / 0 transcripts';
    });

  setInterval(() => {
    if (!transcript) return;

    const time = getCurrentTime();
    processQueue(time);
  }, PRELOAD_POLL_MS);

  setInterval(() => {
    if (!transcript) return;

    const player = document.querySelector('video');
    const paused = !!player && player.paused && !player.ended;
    const time = getCurrentTime();
    processQueue(time, {
      aggressive: true,
      batchSize: paused ? AGGRESSIVE_BATCH_SIZE_PAUSED : AGGRESSIVE_BATCH_SIZE,
    });
  }, AGGRESSIVE_PREFETCH_POLL_MS);

  setInterval(() => {
    const currentTime = getCurrentTime();

    if (!transcript) return;

    // If the player is paused, keep the current frame frozen and skip any playback triggers.
    if (isPlayerPaused) return;

    const nextCurrentSegment = getSegmentAtTime(currentTime);

    if (!nextCurrentSegment) {
      currentSegment = null;
      stopActiveAnimation();
      if (word) word.innerText = '';
      return;
    }

    if (currentSegment !== nextCurrentSegment) {
      currentSegment = nextCurrentSegment;
      if (word) {
        if (currentSegment.skipped) {
          word.innerText = '';
        } else {
          if (!currentSegment.poses) {
            word.innerText = 'Loading sign poses...';
          }
        }
      }
    }

    if (!currentSegment.poses && !currentSegment.loading && !currentSegment.skipped) {
      processQueue(currentTime);
    }

    if (currentSegment.poses) {
      const player = document.querySelector('video');
      const paused = !!player && player.paused && !player.ended;
      if (paused) {
        const segId = getSegmentId(currentSegment);
        if (activeSegmentId === segId) {
          return;
        }
        return;
      }
      playAnimation(currentSegment);
    }
  }, SEGMENT_POLL_MS);

  ensureContainerWithRetry();
  bindPlayerEvents();
  startPlayerBindingLoop();
}

function observeUrlChanges() {
  let lastUrl = location.href;
  new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      location.reload();
    }
  }).observe(document, { subtree: true, childList: true });
}

initializeExtension();
observeUrlChanges();
