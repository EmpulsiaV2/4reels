const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../db');

const router   = express.Router();
const SECRET   = () => process.env.JWT_SECRET || '4reels-jwt-secret-change-me';
const SALT     = 10;

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role, username: user.username }, SECRET(), { expiresIn: '30d' });
}
function safe(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}
const wrap = fn => (req, res, next) => fn(req, res, next).catch(err => {
  console.error('[auth]', err.message);
  res.status(500).json({ error: 'Server error: ' + err.message });
});

// ── Register ──────────────────────────────────────────
router.post('/register', wrap(async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });
  if (username.length < 3 || username.length > 20)
    return res.status(400).json({ error: 'Username must be 3–20 characters.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!/^[a-zA-Z0-9_]+$/.test(username))
    return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores.' });

  if (await db.getUserByUsername(username))
    return res.status(409).json({ error: 'Username already taken.' });
  if (email && await db.getUserByEmail(email))
    return res.status(409).json({ error: 'Email already in use.' });

  const passwordHash = await bcrypt.hash(password, SALT);
  const user = await db.createUser({
    username, email: email || '',
    passwordHash,
    role: 'member',
    displayName: username,
    avatarColor: '#2d303d',
    badge: '',
    banned: false,
  });
  res.json({ token: sign(user), user: safe(user) });
}));

router.get('/continue', requireAuth, wrap(async(req,res)=>{

 const movies = await db.getContinueWatching(req.user.id);

 res.json(movies);

}));


router.delete('/continue/:id', requireAuth, wrap(async(req,res)=>{

 await db.deleteContinueWatching(
   req.user.id,
   req.params.id
 );

 res.json({ok:true});

}));


// ── Login ─────────────────────────────────────────────
router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });

  const user = await db.getUserByUsername(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
  if (user.banned) return res.status(403).json({ error: 'This account has been banned.' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

  res.json({ token: sign(user), user: safe(user) });
}));

// ── Me (get current user) ─────────────────────────────
router.get('/me', requireAuth, wrap(async (req, res) => {
  const user = await db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json(safe(user));
}));

// ── Update profile ────────────────────────────────────
router.patch('/me', requireAuth, wrap(async (req, res) => {
  const { displayName, avatarColor, bio, avatarBase64 } = req.body || {};
  const patch = {};
  if (displayName  !== undefined) patch.displayName  = String(displayName).slice(0, 30);
  if (avatarColor  !== undefined) patch.avatarColor  = String(avatarColor).slice(0, 100);
  if (bio          !== undefined) patch.bio          = String(bio).slice(0, 120);
  if (avatarBase64 !== undefined) {
    if (avatarBase64.length > 3 * 1024 * 1024)
      return res.status(400).json({ error: 'Image too large (max 2MB).' });
    patch.avatarBase64 = avatarBase64;
  }
  console.log('[AUTH UPDATE]', req.user.id, patch);

  const updated = await db.updateUser(req.user.id, patch);

  console.log('[AUTH UPDATED]', updated);
  res.json(safe(updated));
}));

// ── Change password ───────────────────────────────────
router.post('/me/password', requireAuth, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (!current || !next) return res.status(400).json({ error: 'Both fields required.' });
  if (next.length < 6) return res.status(400).json({ error: 'New password must be ≥6 chars.' });
  const user = await db.getUserById(req.user.id);
  const ok   = await bcrypt.compare(current, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password incorrect.' });
  const passwordHash = await bcrypt.hash(next, SALT);
  await db.updateUser(req.user.id, { passwordHash });
  res.json({ ok: true });
}));

// ── ADMIN: list all users ─────────────────────────────
router.get('/admin/users', requireAuth, requireAdmin, wrap(async (req, res) => {
  const users = await db.getUsers();
  res.json(users.map(safe));
}));

// ── ADMIN: update user role/badge/ban ─────────────────
router.patch('/admin/users/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const { role, badge, banned, displayName } = req.body || {};
  const target = await db.getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (String(req.params.id) === String(req.user.id) && role && role !== 'admin')
    return res.status(400).json({ error: 'Cannot remove your own admin role.' });

  const patch = {};
  if (role  !== undefined) patch.role  = role;
  if (badge !== undefined) patch.badge = String(badge).slice(0, 40);
  if (banned!== undefined) patch.banned= !!banned;
  if (displayName !== undefined) patch.displayName = String(displayName).slice(0, 30);

  const updated = await db.updateUser(req.params.id, patch);
  res.json(safe(updated));
}));

// ── ADMIN: delete user ────────────────────────────────
router.delete('/admin/users/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  if (String(req.params.id) === String(req.user.id))
    return res.status(400).json({ error: 'Cannot delete yourself.' });
  await db.deleteUser(req.params.id);
  res.json({ ok: true });
}));

// ── Middleware ────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    req.user = jwt.verify(token, SECRET());
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token.' }); }
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  next();
}

router.get('/admin/online', requireAuth, requireAdmin, wrap(async(req,res)=>{
  const users = await db.getOnlineUsers();
  res.json(users);
}));

// ── Continue Watching ────────────────────────────────

router.post('/continue', requireAuth, wrap(async (req,res)=>{

  await db.saveContinueWatching(
    req.user.id,
    req.body
  );

  res.json({ok:true});

}));


router.get('/continue', requireAuth, wrap(async(req,res)=>{

  const movies = await db.getContinueWatching(
    req.user.id
  );

  res.json(movies);

}));

router.get('/list', requireAuth, wrap(async(req,res)=>{
  const list = await db.getMyList(req.user.id);
  res.json(list);
}));


router.post('/list', requireAuth, wrap(async(req,res)=>{
  await db.saveMyList(
    req.user.id,
    req.body
  );

  res.json({ok:true});
}));


router.delete('/list/:id', requireAuth, wrap(async(req,res)=>{
  await db.deleteMyList(
    req.user.id,
    req.params.id
  );

  res.json({ok:true});
}));


router.delete('/list', requireAuth, wrap(async(req,res)=>{
  await db.clearMyList(req.user.id);

  res.json({ok:true});
}));

router.delete('/continue/:id', requireAuth, wrap(async(req,res)=>{

  await db.deleteContinueWatching(
    req.user.id,
    req.params.id
  );

  res.json({ok:true});

}));

router.delete('/continue', requireAuth, wrap(async (req,res)=>{
  await db.clearContinueWatching(req.user.id);
  res.json({ok:true});
}));

router.get('/watch-history', requireAuth, wrap(async(req,res)=>{
  const data = await db.getWatchHistory(req.user.id);
  res.json(data);
}));

router.post('/watch-history', requireAuth, wrap(async(req,res)=>{
  await db.saveWatch(req.user.id, req.body);
  res.json({ok:true});
}));

router.delete('/watch-history/:id', requireAuth, wrap(async(req,res)=>{
  await db.deleteWatch(req.user.id, req.params.id);
  res.json({ok:true});
}));

router.delete('/watch-history', requireAuth, wrap(async(req,res)=>{
  await db.clearWatch(req.user.id);
  res.json({ok:true});
}));


module.exports = router;
module.exports.requireAuth  = requireAuth;
module.exports.requireAdmin = requireAdmin;
