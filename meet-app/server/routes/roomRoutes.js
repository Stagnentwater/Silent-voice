const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const { createRoomHandler, joinRoomHandler } = require("../controllers/roomController");

const router = express.Router();

router.post("/create", requireAuth, createRoomHandler);
router.post("/join", requireAuth, joinRoomHandler);

module.exports = router;
