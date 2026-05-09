import { defineConfig } from 'vite';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

function normalizeTarget(value, fallback) {
  return String(value || fallback).trim().replace(/\/+$/, '');
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const localApiTarget = normalizeTarget(env.VITE_LOCAL_API_BASE_URL, 'http://127.0.0.1:3001');
  const localPoseTarget = normalizeTarget(env.VITE_LOCAL_POSE_SERVER_URL, 'http://127.0.0.1:5000');
  const localSignalingTarget = normalizeTarget(env.VITE_LOCAL_SIGNALING_URL, 'ws://127.0.0.1:8080');

  return {
    plugins: [react(), basicSsl()],
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': {
          target: localApiTarget,
          changeOrigin: true,
          secure: false
        },
        '/pose': {
          target: localPoseTarget,
          changeOrigin: true,
          secure: false
        },
        '/ws': {
          target: localSignalingTarget,
          ws: true,
          changeOrigin: true
        }
      }
    }
  };
});
