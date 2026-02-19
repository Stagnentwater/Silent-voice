# SignMeet — Phase 1 (MVP)

This folder contains **Phase 1 only**:
- Real-time room-based meetings
- WebRTC media (audio/video) peer-to-peer mesh
- WebSocket signaling server only (no media relay)
- Web Speech API streaming STT
- Speaker-only pose backend queries
- WebRTC DataChannel (`pose-channel`) pose broadcast
- Client-side 2D canvas avatar rendering

## Folder Structure

```
meet-app/
├── client/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── avatar/
│   │   ├── webrtc/
│   │   └── App.jsx
│   ├── .env.example
│   └── package.json
└── signaling-server/
    ├── index.js
    ├── mock-pose-server.js
    ├── .env.example
    └── package.json
```

## Architecture (Phase 1)

- **Signaling**: `meet-app/signaling-server` via WebSocket (`join-room`, `signal`, `leave-room`)
- **Media**: browser-to-browser WebRTC only
- **Pose flow**:
  1. Speaker runs STT continuously
  2. Interim transcript updates immediately in UI
  3. Finalized words are sent to pose backend (`POST /pose`)
  4. Speaker broadcasts pose payload over DataChannel `pose-channel`
  5. All participants render avatar locally
- **Constraint preserved**: only speaker queries pose backend

## Environment Variables

### Client (`meet-app/client/.env`)

- `VITE_SIGNALING_URL` (default `ws://localhost:8080`)
- `VITE_POSE_SERVER_URL` (default `http://localhost:5000`)
- `VITE_ICE_SERVERS` JSON array (default Google STUN)

Example:

```env
VITE_SIGNALING_URL=ws://localhost:8080
VITE_POSE_SERVER_URL=http://localhost:5000
VITE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
```

### Signaling Server (`meet-app/signaling-server/.env`)

- `SIGNALING_PORT` (default `8080`)
- `POSE_MOCK_PORT` (default `8787`, for mock server)

## Setup

### 1) Start signaling server

```bash
cd meet-app/signaling-server
npm install
npm run start
```

### 2) Start client

```bash
cd meet-app/client
npm install
npm run dev
```

### 3) Optional: start mock pose server (if backend unavailable)

```bash
cd meet-app/signaling-server
npm run mock-pose
```

If using mock server, set:

```env
VITE_POSE_SERVER_URL=http://localhost:8787
```

## Testing Instructions (Phase 1)

### A. Room creation / join test

1. Open app in two browser tabs/windows.
2. In both, use room ID `demo-room`.
3. Click **Join Room** in each tab.
4. Verify local and remote video appear.

### B. DataChannel pose broadcast test

1. In one tab (speaker), click **Start Speech**.
2. Speak a few words (e.g., `hello world`).
3. Verify interim transcript updates immediately.
4. Verify both tabs animate avatar based on received poses.
5. Verify only speaker tab issues backend `/pose` calls.

### C. Cleanup / memory leak sanity check

1. Join and leave room repeatedly (5–10 cycles).
2. Verify camera/mic indicator turns off after leaving.
3. Verify no stale remote tiles remain.
4. Rejoin and confirm media/data channel still works.

## Notes

- Web Speech API support is browser-dependent (best on Chromium-based browsers).
- This phase intentionally uses JSON pose packets over DataChannel; binary payloads are reserved for Phase 3.
- 3D avatar rendering and grammar transformation are **not implemented in Phase 1** by design.
