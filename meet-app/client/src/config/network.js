function getBrowserNetworkContext() {
  if (typeof window === 'undefined') {
    return {
      hostname: 'localhost',
      httpProtocol: 'http',
      wsProtocol: 'ws'
    };
  }

  const isHttps = window.location.protocol === 'https:';

  return {
    hostname: window.location.hostname || 'localhost',
    httpProtocol: isHttps ? 'https' : 'http',
    wsProtocol: isHttps ? 'wss' : 'ws'
  };
}

const networkContext = getBrowserNetworkContext();
const appMode = String(import.meta.env.VITE_APP_MODE || 'local').toLowerCase();
const isProdMode = appMode === 'prod';

const localApiFallback = 'http://localhost:5000';
const localSignalingFallback = 'ws://localhost:8080';
const localPoseFallback = 'http://localhost:5000';
const localPosePublicFallback = 'https://executive-parliament-forecasts-diagram.trycloudflare.com';

const prodApiFallback = 'https://silent-voice-o571.vercel.app';
const prodSignalingFallback = 'wss://silent-voicee.onrender.com';
const prodPoseFallback = 'https://your-pose-service-domain';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (isProdMode
    ? (import.meta.env.VITE_PROD_API_BASE_URL || prodApiFallback)
    : (import.meta.env.VITE_LOCAL_API_BASE_URL || localApiFallback));

export const SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL ||
  (isProdMode
    ? (import.meta.env.VITE_PROD_SIGNALING_URL || prodSignalingFallback)
    : (import.meta.env.VITE_LOCAL_SIGNALING_URL || localSignalingFallback));

export const POSE_SERVER_URL =
  import.meta.env.VITE_POSE_SERVER_URL ||
  (isProdMode
    ? (import.meta.env.VITE_PROD_POSE_SERVER_URL || prodPoseFallback)
    : (import.meta.env.VITE_LOCAL_POSE_SERVER_URL || localPoseFallback));

export const POSE_SERVER_FALLBACK_URL =
  import.meta.env.VITE_POSE_SERVER_FALLBACK_URL ||
  (isProdMode
    ? (import.meta.env.VITE_PROD_POSE_SERVER_FALLBACK_URL || localPosePublicFallback)
    : (import.meta.env.VITE_LOCAL_POSE_SERVER_FALLBACK_URL || localPosePublicFallback));

if (isProdMode && (!API_BASE_URL || !SIGNALING_URL || !POSE_SERVER_URL)) {
  throw new Error('[network] VITE_APP_MODE=prod but one or more production URLs are missing.');
}

export const APP_MODE = appMode;
