/**
 * useSignToSpeech — React hook that:
 *  1. Loads MediaPipe Hands from CDN once
 *  2. Runs hand landmark detection on the local camera stream
 *  3. Classifies ASL letters via gestureClassifier
 *  4. Accumulates letters → words, then calls speakWord() + onWord()
 *
 * Usage:
 *   const sts = useSignToSpeech({ localStream, active: isCurrentSpeaker, onWord });
 *   <button onClick={sts.start}>Start Sign-to-Speech</button>
 *   <button onClick={sts.stop}>Stop</button>
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { classifyHandShape, classifySequence } from '../services/gestureClassifier.js';
import { speakWord, cancelSpeech } from '../services/gestureSpeaker.js';

const MEDIAPIPE_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
const FRAME_INTERVAL_MS  = 80;   // ~12 fps — low enough to not overload
const LETTER_HOLD_FRAMES = 8;    // frames same letter must persist to be confirmed
const WORD_GAP_MS        = 1800; // pause duration to flush accumulated word
const MAX_WORD_LETTERS   = 12;   // prevent runaway word accumulation

/** Dynamically load the MediaPipe Hands CDN script once. */
function loadMediaPipeScript() {
  return new Promise((resolve, reject) => {
    if (window._mpHandsLoaded) { resolve(); return; }
    if (window._mpHandsLoading) {
      const poll = setInterval(() => {
        if (window._mpHandsLoaded) { clearInterval(poll); resolve(); }
        if (window._mpHandsError)  { clearInterval(poll); reject(new Error('MediaPipe load failed')); }
      }, 100);
      return;
    }
    window._mpHandsLoading = true;
    const s = document.createElement('script');
    s.src = MEDIAPIPE_CDN;
    s.onload  = () => { window._mpHandsLoaded = true; resolve(); };
    s.onerror = () => { window._mpHandsError  = true; reject(new Error('Failed to load MediaPipe Hands')); };
    document.head.appendChild(s);
  });
}

export function useSignToSpeech({ localStream, active = false, onWord }) {
  const [listening, setListening]       = useState(false);
  const [currentLetter, setCurrentLetter] = useState(null);
  const [currentWord, setCurrentWord]   = useState('');
  const [error, setError]               = useState(null);

  const handsRef        = useRef(null);
  const videoRef        = useRef(null);
  const rafRef          = useRef(null);
  const lastFrameRef    = useRef(0);
  const frameBufferRef  = useRef([]);   // rolling array of raw classified labels
  const holdLabelRef    = useRef(null); // label currently being held
  const holdCountRef    = useRef(0);    // consecutive frames with same label
  const letterQueueRef  = useRef([]);   // confirmed letters for current word
  const lastLetterAt    = useRef(0);    // timestamp of last confirmed letter
  const onWordRef       = useRef(onWord);
  onWordRef.current     = onWord;

  // ─── flush letters → word ─────────────────────────────────────────────────
  const flushWord = useCallback(() => {
    const letters = letterQueueRef.current;
    if (letters.length === 0) return;
    const word = letters.join('').toLowerCase();
    letterQueueRef.current = [];
    setCurrentWord('');
    speakWord(word);
    onWordRef.current?.(word);
  }, []);

  // ─── per-frame onResults from MediaPipe ───────────────────────────────────
  const handleResults = useCallback((results) => {
    const lmList = results?.multiHandLandmarks?.[0] || null;
    const label  = lmList ? classifyHandShape(lmList) : null;

    // update rolling buffer (max 30 frames)
    frameBufferRef.current.push(label);
    if (frameBufferRef.current.length > 30) frameBufferRef.current.shift();

    const stableLabel = classifySequence(frameBufferRef.current);

    // letter-hold tracking
    if (stableLabel && stableLabel === holdLabelRef.current) {
      holdCountRef.current += 1;
    } else {
      holdLabelRef.current = stableLabel;
      holdCountRef.current = stableLabel ? 1 : 0;
    }

    setCurrentLetter(stableLabel);

    // confirm letter after holding for LETTER_HOLD_FRAMES
    if (holdCountRef.current === LETTER_HOLD_FRAMES && stableLabel) {
      // single-character letter vs whole-word gestures
      const isWord = stableLabel.length > 1; // e.g. 'HELLO'
      if (isWord) {
        flushWord(); // flush any pending letters first
        speakWord(stableLabel);
        onWordRef.current?.(stableLabel.toLowerCase());
      } else {
        letterQueueRef.current.push(stableLabel);
        setCurrentWord(letterQueueRef.current.join(''));
        lastLetterAt.current = Date.now();
        if (letterQueueRef.current.length >= MAX_WORD_LETTERS) flushWord();
      }
      holdCountRef.current = 0; // reset so same letter doesn't re-fire
    }

    // word-gap timeout
    if (
      letterQueueRef.current.length > 0 &&
      Date.now() - lastLetterAt.current > WORD_GAP_MS
    ) {
      flushWord();
    }
  }, [flushWord]);

  // ─── animation loop ───────────────────────────────────────────────────────
  const runLoop = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(runLoop);
      return;
    }

    const now = performance.now();
    if (now - lastFrameRef.current >= FRAME_INTERVAL_MS) {
      lastFrameRef.current = now;
      handsRef.current?.send({ image: video }).catch(() => {});
    }

    rafRef.current = requestAnimationFrame(runLoop);
  }, []);

  // ─── start ────────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (listening) return;
    setError(null);

    try {
      await loadMediaPipeScript();

      // init MediaPipe Hands (singleton)
      if (!handsRef.current) {
        const Hands = window.Hands;
        if (!Hands) throw new Error('window.Hands not found after CDN load');

        const hands = new Hands({
          locateFile: (f) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
        });
        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 0,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
        hands.onResults(handleResults);
        await hands.initialize();
        handsRef.current = hands;
      }

      // create hidden video element fed from localStream
      if (!videoRef.current) {
        const vid = document.createElement('video');
        vid.setAttribute('playsinline', '');
        vid.muted = true;
        vid.style.cssText =
          'position:fixed;top:-9999px;left:-9999px;width:320px;height:240px;';
        document.body.appendChild(vid);
        videoRef.current = vid;
      }

      const video = videoRef.current;
      if (localStream) {
        video.srcObject = localStream;
        await video.play();
      } else {
        // fallback: request camera directly
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        await video.play();
        video._ownStream = stream;
      }

      // reset state
      frameBufferRef.current = [];
      letterQueueRef.current = [];
      holdLabelRef.current   = null;
      holdCountRef.current   = 0;
      lastLetterAt.current   = 0;
      setCurrentWord('');
      setCurrentLetter(null);

      setListening(true);
      runLoop();
    } catch (err) {
      console.error('[useSignToSpeech] start error:', err);
      setError(err.message || 'Failed to start sign-to-speech');
    }
  }, [listening, localStream, handleResults, runLoop]);

  // ─── stop ─────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    flushWord(); // speak any pending letters
    cancelSpeech();

    if (videoRef.current) {
      videoRef.current.pause();
      if (videoRef.current._ownStream) {
        videoRef.current._ownStream.getTracks().forEach((t) => t.stop());
      }
      videoRef.current.srcObject = null;
      videoRef.current.remove?.();
      videoRef.current = null;
    }

    frameBufferRef.current = [];
    letterQueueRef.current = [];
    holdLabelRef.current   = null;
    holdCountRef.current   = 0;

    setListening(false);
    setCurrentLetter(null);
    setCurrentWord('');
  }, [flushWord]);

  // stop if active becomes false while listening
  useEffect(() => {
    if (!active && listening) stop();
  }, [active, listening, stop]);

  // cleanup on unmount
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return { listening, currentLetter, currentWord, error, start, stop };
}
