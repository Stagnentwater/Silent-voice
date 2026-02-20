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
const isDev = Boolean(import.meta.env.DEV);
const origin =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : `${networkContext.httpProtocol}://${networkContext.hostname}:5173`;
const wsOrigin = origin.replace(/^http/, 'ws');

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (isDev ? '' : `${networkContext.httpProtocol}://${networkContext.hostname}:3001`);

export const SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL ||
  (isDev ? `${wsOrigin}/ws` : `${networkContext.wsProtocol}://${networkContext.hostname}:8080`);

export const POSE_SERVER_URL =
  import.meta.env.VITE_POSE_SERVER_URL ||
  (isDev ? '' : `${networkContext.httpProtocol}://${networkContext.hostname}:5000`);
