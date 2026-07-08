/**
 * Party REST endpoints (non-realtime)
 * Realtime is handled by WebSockets in server/party.js
 */
const express   = require('express');
const { rooms } = require('../party');
const { requireAuth } = require('./auth');

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// Check if a party code exists (before the user connects via WS)
router.get('/exists/:code', wrap(async (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'Party not found.' });
  res.json({
    code:        room.code,
    hostUsername: room.hostUsername,
    memberCount: room.members.size,
    hasMovie:    !!room.movie,
    movie:       room.movie,
  });
}));

module.exports = router;
