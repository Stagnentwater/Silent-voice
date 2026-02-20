import { API_BASE_URL } from '../config/network.js';

async function request(path, payload, options = {}) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

export async function registerUser({ username, password }) {
  return request('/api/auth/register', { username, password });
}

export async function loginUser({ username, password }) {
  return request('/api/auth/login', { username, password });
}

export async function createRoom({ token }) {
  return request('/api/rooms/create', {}, { token });
}

export async function joinRoom({ token, roomCode }) {
  return request('/api/rooms/join', { roomCode }, { token });
}
