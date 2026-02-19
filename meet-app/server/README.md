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
