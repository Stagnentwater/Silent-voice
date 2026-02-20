const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || process.env.SIGNALING_PORT || 8080);
const HOST = process.env.SIGNALING_HOST || '0.0.0.0';
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      hostId: '',
      speakerId: null,
      clients: new Map()
    });
  }
  return rooms.get(roomId);
}

function toParticipant(client) {
  return {
    peerId: client.peerId,
    userId: client.userId,
    username: client.username,
    isHost: client.isHost
  };
}

function broadcastRoom(room, payload) {
  room.clients.forEach((client) => {
    send(client.ws, payload);
  });
}

function send(ws, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function removePeer(roomId, peerId) {
  if (!roomId || !peerId || !rooms.has(roomId)) {
    return;
  }

  const room = rooms.get(roomId);
  const removedClient = room.clients.get(peerId);
  room.clients.delete(peerId);

  broadcastRoom(room, {
    type: 'peer-left',
    peerId,
    userId: removedClient?.userId || null
  });

  if (removedClient && room.speakerId === removedClient.userId) {
    room.speakerId = null;
    broadcastRoom(room, {
      type: 'SPEAKER_CHANGED',
      speakerId: null
    });
  }

  if (room.clients.size === 0) {
    rooms.delete(roomId);
  }
}

function isHostClient(room, peerId) {
  const client = room.clients.get(peerId);
  if (!client) {
    return false;
  }
  return client.isHost || String(client.userId || '') === String(room.hostId || '');
}

function roomHasUser(room, userId) {
  let exists = false;
  room.clients.forEach((client) => {
    if (client.userId === userId) {
      exists = true;
    }
  });
  return exists;
}

function normalizeRoomId(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeUserId(value, fallback) {
  const normalized = String(value || '').trim();
  if (normalized) {
    return normalized;
  }
  return fallback;
}

function normalizeUsername(value, fallback) {
  const normalized = String(value || '').trim();
  if (normalized) {
    return normalized;
  }
  return fallback;
}

function normalizeHostId(value, fallback) {
  const normalized = String(value || '').trim();
  if (normalized) {
    return normalized;
  }
  return fallback;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  let currentRoomId = '';
  let currentPeerId = '';
  const remoteAddress = req?.socket?.remoteAddress || 'unknown';
  const requestPath = req?.url || '/';

  console.log(`[ws] connection from=${remoteAddress} path=${requestPath}`);

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === 'join-room') {
      const roomId = normalizeRoomId(message.roomId);
      if (!roomId) {
        send(ws, { type: 'error', message: 'roomId is required' });
        return;
      }

      currentRoomId = roomId;
      currentPeerId = String(message.peerId || crypto.randomUUID());

      const userId = normalizeUserId(message.userId, currentPeerId);
      const username = normalizeUsername(message.username, `User-${userId.slice(0, 6)}`);
      const requestedHostId = normalizeHostId(message.hostId, '');

      const room = getRoom(roomId);
      if (!room.hostId) {
        room.hostId = requestedHostId || userId;
      } else if (requestedHostId && room.clients.size === 0) {
        room.hostId = requestedHostId;
      }

      const isHost = String(userId) === String(room.hostId || '');

      room.clients.forEach((existingClient) => {
        existingClient.isHost = String(existingClient.userId || '') === String(room.hostId || '');
      });

      const existingParticipants = Array.from(room.clients.values()).map(toParticipant);
      const existingPeerIds = existingParticipants.map((participant) => participant.peerId);

      room.clients.set(currentPeerId, {
        ws,
        peerId: currentPeerId,
        userId,
        username,
        isHost
      });

      console.log(
        `[ws] joined room=${roomId} peer=${currentPeerId} user=${userId} participants=${room.clients.size}`
      );

      send(ws, {
        type: 'joined-room',
        roomId,
        peerId: currentPeerId,
        peers: existingPeerIds,
        participants: existingParticipants,
        hostId: room.hostId,
        speakerId: room.speakerId
      });

      // Notify existing peers about the new participant (skip self)
      room.clients.forEach((client) => {
        if (client.peerId === currentPeerId) return;
        send(client.ws, {
          type: 'peer-joined',
          participant: {
            peerId: currentPeerId,
            userId,
            username,
            isHost
          }
        });
      });

      return;
    }

    if (message.type === 'leave-room') {
      removePeer(currentRoomId, currentPeerId);
      currentRoomId = '';
      currentPeerId = '';
      return;
    }

    if (message.type === 'set-speaker') {
      const roomId = normalizeRoomId(message.roomId || currentRoomId);
      if (!roomId || !rooms.has(roomId)) {
        return;
      }

      const room = rooms.get(roomId);
      const requesterUserId = normalizeUserId(message.requesterUserId, '');
      const requesterClient = room.clients.get(currentPeerId);

      if (!room.hostId && requesterClient?.userId) {
        room.hostId = requesterClient.userId;
        requesterClient.isHost = true;
      }

      const isRequesterHost =
        requesterUserId && String(requesterUserId) === String(room.hostId || '');

      if (!isRequesterHost && !isHostClient(room, currentPeerId)) {
        send(ws, { type: 'error', message: 'Only host can assign speaker' });
        return;
      }

      const nextSpeakerId = String(message.speakerId || '').trim() || null;
      if (nextSpeakerId && !roomHasUser(room, nextSpeakerId)) {
        send(ws, { type: 'error', message: 'Speaker user is not in room' });
        return;
      }

      room.speakerId = nextSpeakerId;
      broadcastRoom(room, {
        type: 'SPEAKER_CHANGED',
        speakerId: room.speakerId
      });
      return;
    }

    if (message.type === 'signal') {
      const roomId = normalizeRoomId(message.roomId || currentRoomId);
      const targetPeerId = String(message.targetPeerId || '');
      if (!roomId || !targetPeerId || !rooms.has(roomId)) {
        return;
      }

      const room = rooms.get(roomId);
      const targetClient = room.clients.get(targetPeerId);
      if (!targetClient) {
        return;
      }

      send(targetClient.ws, {
        type: 'signal',
        fromPeerId: String(message.fromPeerId || currentPeerId),
        signal: message.signal
      });
      return;
    }

    if (message.type === 'pose-packet') {
      const roomId = normalizeRoomId(message.roomId || currentRoomId);
      if (!roomId || !rooms.has(roomId) || !message.packet) {
        return;
      }

      const room = rooms.get(roomId);
      room.clients.forEach((client) => {
        if (client.peerId === currentPeerId) {
          return;
        }

        send(client.ws, {
          type: 'POSE_PACKET',
          fromPeerId: currentPeerId,
          packet: message.packet
        });
      });
    }
  });

  ws.on('close', () => {
    console.log(`[ws] disconnected peer=${currentPeerId || 'unknown'} room=${currentRoomId || 'none'}`);
    removePeer(currentRoomId, currentPeerId);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Signaling server listening on ws://${HOST}:${PORT}`);
});
