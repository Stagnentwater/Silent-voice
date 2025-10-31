import {
  HAND_CONNECTIONS,
  POSE_CONNECTIONS,
  FACEMESH_TESSELATION,
} from '@mediapipe/holistic';
import { drawConnectors } from '@mediapipe/drawing_utils';
import { getYoutubeTranscript } from './lib/youtubeCaptions';

let transcript;
const queue = [];
const BATCH_SIZE = 2;
const FETCH_AHEAD_TIME = 10;
let avatar, avatarContainer, currentSegment, word;

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
  avatarContainer = document.createElement('div');
  avatarContainer.id = 'avatar-container';
  avatar = document.createElement('canvas');
  avatar.id = 'avatar';
  avatarContainer.appendChild(avatar);
  word = document.createElement('p');
  word.id = 'word';
  avatarContainer.appendChild(word);

  const targetElement = document.getElementById('secondary-inner');
  if (targetElement) {
    targetElement.insertBefore(avatarContainer, targetElement.firstChild);
  }
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

    const filteredPoseLandmarks = landmark.pose_landmarks.filter(
      (point, index) => ![17, 18, 19, 20, 21, 22].includes(index)
    );

    const filteredPoseConnections = POSE_CONNECTIONS.filter(
      (connection) =>
        ![17, 18, 19, 20, 21, 22].includes(connection[0]) &&
        ![17, 18, 19, 20, 21, 22].includes(connection[1])
    );

    drawConnectors(ctx, filteredPoseLandmarks, filteredPoseConnections, {
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

function processQueue() {
  if (queue.length === 0) return;

  const batch = queue.splice(0, BATCH_SIZE);
  const promises = batch.map((segment) => {
    const words = segment.text;
    segment.loading = true;

    return fetch('http://127.0.0.1:5000/pose', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        words,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`POSE request failed: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        segment.poses = data;
        segment.loading = false;
        return segment;
      })
      .catch((err) => {
        console.debug('[sign-engine] /pose error', err?.message || err);
        segment.loading = false;
        return segment; // proceed without poses
      });
  });

  Promise.all(promises).then((updatedBatch) => {
    updatedBatch.forEach((segment) => {
      const index = transcript.findIndex((s) => s === segment);
      transcript[index] = segment;
    });
  });
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

  const duration = segment.duration;
  const frames = poses.length;
  const fps = frames / duration;

  let frameIndex = 0;

  function animate() {
    if (frameIndex >= poses.length) {
      return;
    }

    const landmark = poses[frameIndex];

    word.innerText = landmark.word;
    ctx.clearRect(0, 0, avatar.width, avatar.height);
    drawLandmarks(landmark, ctx);

    frameIndex++;
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

function initializeExtension() {
  if (avatar || avatarContainer) {
    avatar.remove();
    avatarContainer.remove();
  }

  fetchTranscript().then((data) => {
    transcript = data.map((x) => ({
      ...x,
      text: decodeHTMLEntities(x.text),
    }));
    console.log(transcript);
    queue.push(...transcript);
    processQueue();
  });

  setInterval(() => {
    if (!transcript) return;

    const time = getCurrentTime();
    const nextSegment = transcript.find(
      (segment) =>
        !segment.poses &&
        !segment.loading &&
        segment.offset < time + FETCH_AHEAD_TIME
    );

    if (nextSegment && queue.length > 0) {
      processQueue();
    }
  }, 500);

  setInterval(() => {
    const currentTime = getCurrentTime();

    if (!transcript) return;
    if (
      currentSegment &&
      currentSegment.offset < currentTime &&
      currentSegment.offset + currentSegment.duration > currentTime
    )
      return;

    currentSegment = transcript.find(
      (segment) =>
        segment.offset <= currentTime &&
        segment.offset + segment.duration >= currentTime
    );

    if (currentSegment) {
      playAnimation(currentSegment);
    }
  }, [200]);

  setTimeout(() => {
    const targetElement = document.getElementById('secondary-inner');
    if (targetElement) {
      addContainer();
    }
  }, 1500);
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

document.addEventListener(
  'DOMContentLoaded',
  () => {
    const videoElement = document.querySelector('video');
    if (videoElement) {
      videoElement.pause();
    }
  },
  [200]
);

initializeExtension();
observeUrlChanges();
