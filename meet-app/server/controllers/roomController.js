const {
  createRoom,
  joinRoom,
  getRoom,
  normalizeRoomCode,
} = require("../db/roomStore");

function toRoomResponse(room) {
  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    participants: room.participants,
    speakerId: room.speakerId,
  };
}

async function createRoomHandler(req, res, next) {
  try {
    const hostId = req.auth.userId;
    const hostUsername = req.auth.username;

    const room = createRoom({
      hostId,
      hostUsername,
    });

    return res.status(201).json(toRoomResponse(room));
  } catch (error) {
    return next(error);
  }
}

async function joinRoomHandler(req, res, next) {
  try {
    const roomCode = normalizeRoomCode(req.body.roomCode);
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
      return res.status(400).json({ error: "Room code must be 6 alphanumeric characters" });
    }

    const room = getRoom(roomCode);
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const updatedRoom = joinRoom({
      roomCode,
      userId: req.auth.userId,
      username: req.auth.username,
    });

    return res.status(200).json(toRoomResponse(updatedRoom));
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createRoomHandler,
  joinRoomHandler,
};
