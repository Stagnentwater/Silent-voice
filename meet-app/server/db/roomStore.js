const rooms = new Map();
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateRoomCode() {
  let code = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    const randomIndex = Math.floor(Math.random() * ROOM_CODE_CHARS.length);
    code += ROOM_CODE_CHARS[randomIndex];
  }
  return code;
}

function generateUniqueRoomCode() {
  let attempts = 0;
  while (attempts < 10000) {
    const code = generateRoomCode();
    if (!rooms.has(code)) {
      return code;
    }
    attempts += 1;
  }
  throw new Error("Failed to generate unique room code");
}

function ensureParticipant(room, userId, username) {
  const exists = room.participants.some((participant) => participant.userId === userId);
  if (!exists) {
    room.participants.push({
      userId,
      username,
    });
  }
}

function createRoom({ hostId, hostUsername }) {
  const roomCode = generateUniqueRoomCode();
  const room = {
    roomCode,
    hostId,
    participants: [],
    speakerId: null,
  };

  ensureParticipant(room, hostId, hostUsername);
  rooms.set(roomCode, room);
  return room;
}

function getRoom(roomCode) {
  return rooms.get(roomCode) || null;
}

function joinRoom({ roomCode, userId, username }) {
  const room = getRoom(roomCode);
  if (!room) {
    return null;
  }
  ensureParticipant(room, userId, username);
  return room;
}

function normalizeRoomCode(value) {
  return String(value || "").trim().toUpperCase();
}

module.exports = {
  createRoom,
  getRoom,
  joinRoom,
  normalizeRoomCode,
};
