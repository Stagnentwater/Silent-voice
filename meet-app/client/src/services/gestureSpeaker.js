/**
 * Wraps SpeechSynthesis — speaks a word/phrase out loud once.
 * Deduplicates: same word won't fire again within DEBOUNCE_MS.
 */
const DEBOUNCE_MS = 2000;

let lastSpoken = '';
let lastSpokenAt = 0;
let preferredVoice = null;

function loadVoice() {
  if (preferredVoice) return;
  const voices = window.speechSynthesis?.getVoices?.() || [];
  preferredVoice =
    voices.find((v) => v.lang === 'en-US' && v.localService) ||
    voices.find((v) => v.lang.startsWith('en')) ||
    voices[0] ||
    null;
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = loadVoice;
  loadVoice();
}

export function speakWord(word) {
  if (!word || typeof window === 'undefined') return;
  if (!window.speechSynthesis) return;

  const now = Date.now();
  const normalized = String(word).trim().toLowerCase();
  if (normalized === lastSpoken && now - lastSpokenAt < DEBOUNCE_MS) return;

  lastSpoken = normalized;
  lastSpokenAt = now;

  window.speechSynthesis.cancel();
  loadVoice();

  const utt = new SpeechSynthesisUtterance(word);
  utt.lang = 'en-US';
  utt.rate = 0.95;
  utt.pitch = 1;
  if (preferredVoice) utt.voice = preferredVoice;

  window.speechSynthesis.speak(utt);
}

export function cancelSpeech() {
  window.speechSynthesis?.cancel?.();
}
