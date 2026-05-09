const appMode = String(import.meta.env.VITE_APP_MODE || 'local').toLowerCase();
const isProdMode = appMode === 'prod';

const endpointByMode = {
  local: {
    apiBase: import.meta.env.VITE_LOCAL_API_BASE_URL || 'http://localhost:3001',
    signaling: import.meta.env.VITE_LOCAL_SIGNALING_URL || 'ws://localhost:8080',
    poseServer: import.meta.env.VITE_LOCAL_POSE_SERVER_URL || 'http://localhost:5000',
    poseFallback:
      import.meta.env.VITE_LOCAL_POSE_SERVER_FALLBACK_URL ||
      'https://executive-parliament-forecasts-diagram.trycloudflare.com'
  },
  prod: {
    apiBase: import.meta.env.VITE_PROD_API_BASE_URL || 'https://silent-voice-o571.vercel.app',
    signaling: import.meta.env.VITE_PROD_SIGNALING_URL || 'wss://silent-voicee.onrender.com',
    // Production exception: pose service is intentionally local until it is deployed.
    poseServer: import.meta.env.VITE_PROD_POSE_SERVER_URL || 'http://127.0.0.1:5000',
    poseFallback:
      import.meta.env.VITE_PROD_POSE_SERVER_FALLBACK_URL ||
      'https://executive-parliament-forecasts-diagram.trycloudflare.com'
  }
};

const selectedEndpoints = isProdMode ? endpointByMode.prod : endpointByMode.local;

function trimTrailingSlashes(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function resolveEndpoint(globalOverrideKey, modeField) {
  return trimTrailingSlashes(import.meta.env[globalOverrideKey] || selectedEndpoints[modeField]);
}

function assertHttpUrl(name, value, options = {}) {
  const allowLocalhost = Boolean(options.allowLocalhost);

  if (!value) {
    throw new Error(`[network] Missing required URL for ${name}.`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[network] ${name} must be a valid absolute URL with protocol. Received: ${value}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`[network] ${name} must start with http:// or https://. Received: ${value}`);
  }

  if (!allowLocalhost && ['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error(`[network] ${name} cannot point to localhost in prod mode. Received: ${value}`);
  }
}

function assertWsUrl(name, value) {
  if (!value) {
    throw new Error(`[network] Missing required URL for ${name}.`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[network] ${name} must be a valid absolute URL with protocol. Received: ${value}`);
  }

  if (!['ws:', 'wss:'].includes(parsed.protocol)) {
    throw new Error(`[network] ${name} must start with ws:// or wss://. Received: ${value}`);
  }

  if (['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error(`[network] ${name} cannot point to localhost in prod mode. Received: ${value}`);
  }
}

export const API_BASE_URL = resolveEndpoint('VITE_API_BASE_URL', 'apiBase');
export const SIGNALING_URL = resolveEndpoint('VITE_SIGNALING_URL', 'signaling');
export const POSE_SERVER_URL = resolveEndpoint('VITE_POSE_SERVER_URL', 'poseServer');
export const POSE_SERVER_FALLBACK_URL = resolveEndpoint(
  'VITE_POSE_SERVER_FALLBACK_URL',
  'poseFallback'
);

if (isProdMode) {
  assertHttpUrl('API_BASE_URL', API_BASE_URL);
  assertWsUrl('SIGNALING_URL', SIGNALING_URL);
  assertHttpUrl('POSE_SERVER_URL', POSE_SERVER_URL, { allowLocalhost: true });
  assertHttpUrl('POSE_SERVER_FALLBACK_URL', POSE_SERVER_FALLBACK_URL, { allowLocalhost: true });
}

export const APP_MODE = appMode;
