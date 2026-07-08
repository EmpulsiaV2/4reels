/**
 * Party system — in-memory rooms + WebSocket sync
 *
 * Architecture:
 *  - Rooms live in RAM (Map). If server restarts, parties end — this is fine.
 *  - DB stores only: party_code, host_id, created_at (for invite links + history).
 *  - All real-time state (members, playback position, current movie) is in-memory only.
 *  - Host broadcasts commands; server relays to all other members in the room.
 *  - Each message includes server_ts so clients can correct for latency drift.
 */

const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');
const db     = require('./db');

// ── In-memory party store ─────────────────────────────
//  rooms: Map<code, Room>
//  Room = {
//    code, hostId, hostUsername,
//    movie: { tmdbId, title, poster } | null,
//    state: { playing, position, updatedAt } (position in seconds),
//    members: Map<userId, { ws, username, displayName, avatarColor }>
//  }
const rooms = new Map();

function makeCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // 6-char e.g. "A1B2C3"
}

function getRoom(code) { return rooms.get(code); }

function broadcast(room, msg, excludeUserId = null) {
  const payload = JSON.stringify({ ...msg, server_ts: Date.now() });
  for (const [uid, member] of room.members) {
    if (uid === excludeUserId) continue;
    if (member.ws.readyState === WebSocket.OPEN) {
      member.ws.send(payload);
    }
  }
}

function broadcastAll(room, msg) { broadcast(room, msg, null); }

function roomSnapshot(room) {
  return {
    code:    room.code,
    hostId:  room.hostId,
    hostUsername: room.hostUsername,
    movie:   room.movie,
    state:   room.state,
    members: [...room.members.values()].map(m => ({
      userId:      m.userId,
      username:    m.username,
      displayName: m.displayName,
      avatarColor: m.avatarColor,
      isHost:      m.userId === room.hostId,
    })),
  };
}

// ── DB helpers ────────────────────────────────────────
async function ensurePartySchema() {
  const { Pool } = require('pg');
  // Re-use the pool from db.js by calling a raw query via db internals
  // Actually we'll just do it inline here via a fresh pool check
  try {
    const pool = db._pool || null;
    if (!pool) return; // db not connected yet, skip
    await pool.query(`
      CREATE TABLE IF NOT EXISTS parties (
        code        TEXT PRIMARY KEY,
        host_id     TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT now()
      );
    `);
  } catch {}
}

// We expose a simple DB save: record that a party was created (for auditing only)
async function savePartyToDB(code, hostId) {
  try {
    const pool = require('./db')._pool;
    if (!pool) return;
    await pool.query(
      'INSERT INTO parties (code, host_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [code, String(hostId)]
    );
  } catch {}
}

// ── WebSocket handler ─────────────────────────────────
function attachPartyWS(server) {
  const wss = new WebSocketServer({ server, path: '/ws/party' });

  wss.on('connection', (ws, req) => {
    let userId   = null;
    let roomCode = null;
    let pingInterval = null;

    // Keep-alive ping every 25s
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 25000);

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {

        // ── Join or create a party ─────────────────────
        case 'join': {
          const { code, user } = msg;
          if (!user?.id || !code) return;

          userId   = String(user.id);
          roomCode = code.toUpperCase();

          const room = rooms.get(roomCode);
          if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: 'Party not found. Check the code and try again.' }));
            return;
          }

          // Kick old WS if user reconnects
          const existing = room.members.get(userId);
          if (existing?.ws?.readyState === WebSocket.OPEN) {
            existing.ws.close(4000, 'Replaced by new connection');
          }

          room.members.set(userId, {
            userId,
            ws,
            username:    user.username    || 'Guest',
            displayName: user.displayName || user.username || 'Guest',
            avatarColor: user.avatarColor || '#ff5d4e',
          });

          // Send current room state to joiner
          ws.send(JSON.stringify({ type: 'room_state', room: roomSnapshot(room), server_ts: Date.now() }));

          // Notify others
          broadcast(room, {
            type:    'member_joined',
            userId,
            username:    user.username,
            displayName: user.displayName || user.username,
            avatarColor: user.avatarColor,
            memberCount: room.members.size,
          }, userId);

          break;
        }

        // ── Create a party (host) ──────────────────────
        case 'create': {
          const { user } = msg;
          if (!user?.id) return;

          userId = String(user.id);

          // Remove user from any existing room they were in
          leaveAllRooms(userId);

          const code = makeCode();
          const room = {
            code,
            hostId:       userId,
            hostUsername: user.username || 'Host',
            movie:        null,
            state:        { playing: false, position: 0, updatedAt: Date.now() },
            members:      new Map(),
          };
          room.members.set(userId, {
            userId,
            ws,
            username:    user.username    || 'Host',
            displayName: user.displayName || user.username || 'Host',
            avatarColor: user.avatarColor || '#ff5d4e',
          });
          rooms.set(code, room);
          roomCode = code;

          savePartyToDB(code, userId).catch(() => {});

          ws.send(JSON.stringify({ type: 'created', room: roomSnapshot(room), server_ts: Date.now() }));
          break;
        }

        // ── Host: set current movie ────────────────────
        case 'set_movie': {
          if (!validateHost(ws, userId, roomCode)) return;
          const room = rooms.get(roomCode);
          room.movie = msg.movie; // { tmdbId, title, poster }
          room.state = { playing: false, position: 0, updatedAt: Date.now() };
          broadcastAll(room, { type: 'movie_changed', movie: room.movie, state: room.state });
          break;
        }

        // ── Host: play ────────────────────────────────
        case 'play': {
          if (!validateHost(ws, userId, roomCode)) return;
          const room = rooms.get(roomCode);
          room.state.playing   = true;
          room.state.position  = msg.position ?? room.state.position;
          room.state.updatedAt = Date.now();
          broadcastAll(room, { type: 'play', position: room.state.position });
          break;
        }

        // ── Host: pause ───────────────────────────────
        case 'pause': {
          if (!validateHost(ws, userId, roomCode)) return;
          const room = rooms.get(roomCode);
          room.state.playing   = false;
          room.state.position  = msg.position ?? room.state.position;
          room.state.updatedAt = Date.now();
          broadcastAll(room, { type: 'pause', position: room.state.position });
          break;
        }

        // ── Host: seek ────────────────────────────────
        case 'seek': {
          if (!validateHost(ws, userId, roomCode)) return;
          const room = rooms.get(roomCode);
          room.state.position  = msg.position;
          room.state.updatedAt = Date.now();
          broadcastAll(room, { type: 'seek', position: msg.position, playing: room.state.playing });
          break;
        }

        // ── Member: sync request (asks host for current state) ──
        case 'sync_request': {
          const room = rooms.get(roomCode);
          if (!room) return;
          // Calculate drift: if playing, add elapsed time since last update
          let pos = room.state.position;
          if (room.state.playing) {
            pos += (Date.now() - room.state.updatedAt) / 1000;
          }
          ws.send(JSON.stringify({
            type:     'sync',
            position: pos,
            playing:  room.state.playing,
            movie:    room.movie,
            server_ts: Date.now(),
          }));
          break;
        }

        // ── Chat message ──────────────────────────────
        case 'chat': {
          const room = rooms.get(roomCode);
          if (!room || !userId) return;
          const member = room.members.get(userId);
          if (!member) return;
          const text = String(msg.text || '').slice(0, 200).trim();
          if (!text) return;
          broadcastAll(room, {
            type:        'chat',
            userId,
            displayName: member.displayName,
            avatarColor: member.avatarColor,
            text,
          });
          break;
        }

        // ── Leave ─────────────────────────────────────
        case 'leave': {
          handleLeave(ws, userId, roomCode);
          userId = null; roomCode = null;
          break;
        }
      }
    });

    ws.on('close', () => {
      clearInterval(pingInterval);
      handleLeave(ws, userId, roomCode);
    });

    ws.on('error', err => {
      console.error('[Party WS]', err.message);
    });
  });

  // Clean up empty rooms every 5 minutes
  setInterval(() => {
    for (const [code, room] of rooms) {
      if (room.members.size === 0) rooms.delete(code);
    }
  }, 5 * 60 * 1000);

  console.log('[Party] WebSocket server ready at /ws/party');
  return wss;
}

// ── Helpers ───────────────────────────────────────────
function validateHost(ws, userId, roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !userId) return false;
  if (room.hostId !== userId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Only the host can do that.' }));
    return false;
  }
  return true;
}

function handleLeave(ws, userId, roomCode) {
  if (!userId || !roomCode) return;
  const room = rooms.get(roomCode);
  if (!room) return;

  room.members.delete(userId);

  if (room.members.size === 0) {
    rooms.delete(roomCode);
    return;
  }

  // If host left, transfer to next member
  if (room.hostId === userId) {
    const [newHostId, newHost] = room.members.entries().next().value;
    room.hostId       = newHostId;
    room.hostUsername = newHost.displayName || newHost.username;
    broadcastAll(room, {
      type:            'host_changed',
      newHostId,
      newHostUsername: room.hostUsername,
      memberCount:     room.members.size,
    });
  } else {
    broadcast(room, { type: 'member_left', userId, memberCount: room.members.size }, null);
  }
}

function leaveAllRooms(userId) {
  for (const [code, room] of rooms) {
    if (room.members.has(userId)) {
      handleLeave(null, userId, code);
    }
  }
}

// Expose for REST endpoint to look up rooms
module.exports = { attachPartyWS, getRoom, rooms, ensurePartySchema };
