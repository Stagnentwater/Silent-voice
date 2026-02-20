import { useCallback, useEffect, useRef, useState } from 'react';

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;
const POSE_CHUNK_WORDS = 5;
const PAUSE_FLUSH_MS = 700;

function normalizeChunk(text) {
  return String(text || '').trim();
}

function tokenizeWords(text) {
  return normalizeChunk(text)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

export function useSpeechToPose({ poseClient, onPoseReady, speakerId }) {
  const [supported] = useState(Boolean(SpeechRecognition));
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [lastError, setLastError] = useState('');

  const recognitionRef = useRef(null);
  const shouldRunRef = useRef(false);
  const spokenHistoryRef = useRef([]);
  const bufferedWordsRef = useRef([]);
  const pendingChunksRef = useRef([]);
  const processingRef = useRef(false);
  const flushTimerRef = useRef(null);

  const drainPoseQueue = useCallback(async () => {
    if (processingRef.current) {
      return;
    }

    processingRef.current = true;
    try {
      while (pendingChunksRef.current.length > 0) {
        const chunkWords = pendingChunksRef.current.shift();
        const chunkText = normalizeChunk((chunkWords || []).join(' '));
        if (!chunkText) {
          continue;
        }

        let response = null;

        try {
          console.log('[SpeechToPose] sending chunk to pose server', {
            text: chunkText,
            speakerId,
            queuedRemaining: pendingChunksRef.current.length
          });

          response = await poseClient.fetchPose(chunkText);
          console.log('[SpeechToPose] received pose response', {
            text: chunkText,
            speakerId,
            hasResponse: Boolean(response),
            poseIdsCount: Array.isArray(response?.poseIds) ? response.poseIds.length : 0,
            poseFramesCount: Array.isArray(response?.poseFrames) ? response.poseFrames.length : 0,
            timingsCount: Array.isArray(response?.timings) ? response.timings.length : 0
          });

          if (!response) {
            continue;
          }

        } catch (error) {
          if (error?.name === 'AbortError') {
            return; // ignore aborts triggered by stop/timeout
          }

          console.error('[SpeechToPose] fetchPose failed', error);
          const message = error?.message === 'Pose request timed out'
            ? 'Pose request timed out; please try again.'
            : (error?.message || 'Pose lookup failed');
          setLastError(message);
          continue;
        }

        try {
          onPoseReady({
            text: chunkText,
            poseIds: response.poseIds,
            poseFrames: response.poseFrames,
            timings: response.timings,
            speakerId
          });

          console.log('[SpeechToPose] onPoseReady completed', {
            text: chunkText,
            speakerId
          });
        } catch (error) {
          console.error('[SpeechToPose] onPoseReady/render failed', error);
          setLastError(error?.message || 'Render pipeline failed');
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [onPoseReady, poseClient, speakerId]);

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushBufferedWords = useCallback(() => {
    if (bufferedWordsRef.current.length === 0) {
      return;
    }

    const remainder = bufferedWordsRef.current.splice(0, bufferedWordsRef.current.length);
    if (remainder.length > 0) {
      pendingChunksRef.current.push(remainder);
      drainPoseQueue();
    }
  }, [drainPoseQueue]);

  const schedulePauseFlush = useCallback(() => {
    clearFlushTimer();
    flushTimerRef.current = setTimeout(() => {
      flushBufferedWords();
    }, PAUSE_FLUSH_MS);
  }, [clearFlushTimer, flushBufferedWords]);

  const enqueueWordsWithoutRepetition = useCallback((words) => {
    if (!Array.isArray(words) || words.length === 0) {
      return;
    }

    const previous = spokenHistoryRef.current;
    const maxOverlap = Math.min(previous.length, words.length);

    let overlap = 0;
    for (let size = maxOverlap; size > 0; size -= 1) {
      const previousTail = previous.slice(previous.length - size);
      const currentHead = words.slice(0, size);
      const isMatch = previousTail.every((word, index) => word === currentHead[index]);
      if (isMatch) {
        overlap = size;
        break;
      }
    }

    const newWords = words.slice(overlap);
    if (!newWords.length) {
      return;
    }

    bufferedWordsRef.current.push(...newWords);

    while (bufferedWordsRef.current.length >= POSE_CHUNK_WORDS) {
      const nextChunk = bufferedWordsRef.current.splice(0, POSE_CHUNK_WORDS);
      pendingChunksRef.current.push(nextChunk);
    }

    if (bufferedWordsRef.current.length > 0) {
      schedulePauseFlush();
    } else {
      clearFlushTimer();
    }

    spokenHistoryRef.current = [...previous, ...newWords].slice(-120);
  }, [clearFlushTimer, schedulePauseFlush]);

  const processChunk = useCallback((chunkText) => {
    const words = tokenizeWords(chunkText);
    if (!words.length) {
      return;
    }

    enqueueWordsWithoutRepetition(words);

    drainPoseQueue();
  }, [drainPoseQueue, enqueueWordsWithoutRepetition]);

  const stop = useCallback(() => {
    shouldRunRef.current = false;
    clearFlushTimer();
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    spokenHistoryRef.current = [];
    bufferedWordsRef.current = [];
    pendingChunksRef.current = [];
    processingRef.current = false;
    setListening(false);
    setInterimText('');
  }, [clearFlushTimer]);

  const start = useCallback(() => {
    if (!SpeechRecognition || recognitionRef.current) {
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    shouldRunRef.current = true;
    setLastError('');

    recognition.onresult = async (event) => {
      let interim = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript || '';

        if (result.isFinal) {
          processChunk(transcript);
        } else {
          interim += transcript;
        }
      }

      setInterimText(interim.trim());
    };

    recognition.onerror = (event) => {
      setLastError(event.error || 'Speech recognition error');
    };

    recognition.onend = () => {
      if (shouldRunRef.current) {
        recognition.start();
      } else {
        setListening(false);
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  }, [processChunk]);

  useEffect(() => stop, [stop]);

  return {
    supported,
    listening,
    interimText,
    lastError,
    start,
    stop
  };
}
