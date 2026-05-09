# SignMeet API Server

Stage 1 implementation: authentication backend using Express + local JSON persistence.

## Features in this stage

- `POST /api/auth/register`
  - Creates a new user in local JSON store
  - Prevents duplicate usernames
  - Stores bcrypt password hash
- `POST /api/auth/login`
  - Validates credentials from local JSON store
  - Returns JWT token and user payload
- `GET /health`
  - Basic health check

## Phase 3 room endpoints

- `POST /api/rooms/create`
  - Requires `Authorization: Bearer <jwt>`
  - Creates room with 6-character alphanumeric code
  - Host is auto-added to participants
- `POST /api/rooms/join`
  - Requires `Authorization: Bearer <jwt>`
  - Body: `{ "roomCode": "AB12CD" }`
  - Validates active room and adds participant

Rooms are stored in-memory and reset when the server restarts.

## Environment variables

Create `.env` from `.env.example`.

- `PORT` — API port (default `3001`)
- `JWT_SECRET` — signing secret for JWT tokens (required)
- `JWT_EXPIRES_IN` — token lifetime (default `1d`)

## Client Routing Matrix (caller reference)

Client routing is controlled from `meet-app/client` via `VITE_APP_MODE`.

- Local mode (`VITE_APP_MODE=local`)
  - `VITE_LOCAL_API_BASE_URL=http://localhost:3001`
  - `VITE_LOCAL_SIGNALING_URL=ws://localhost:8080`
  - `VITE_LOCAL_POSE_SERVER_URL=http://localhost:5000`
- Production mode (`VITE_APP_MODE=prod`)
  - `VITE_PROD_API_BASE_URL=https://silent-voice-o571.vercel.app`
  - `VITE_PROD_SIGNALING_URL=wss://silent-voicee.onrender.com`
  - Production exception: `VITE_PROD_POSE_SERVER_URL=http://127.0.0.1:5000`

Override precedence in client config:

1. Global override keys: `VITE_API_BASE_URL`, `VITE_SIGNALING_URL`, `VITE_POSE_SERVER_URL`, `VITE_POSE_SERVER_FALLBACK_URL`
2. Mode-specific keys (`VITE_LOCAL_*` or `VITE_PROD_*`)
3. Hardcoded defaults in `meet-app/client/src/config/network.js`

## Run

```bash
cd meet-app/server
npm install
npm run dev
```

## Data persistence

Users are stored in:

- `meet-app/server/db/users.json`

Schema per user:

```json
{
  "id": "uuid",
  "username": "lowercased_username",
  "password_hash": "bcrypt_hash"
}
```
