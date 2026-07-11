require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const helmet      = require('helmet');
const morgan      = require('morgan');
const http        = require('http');
const path        = require('path');
const fs          = require('fs');
const axios       = require('axios');
const db          = require('./server/db');
const { attachPartyWS } = require('./server/party');

const app    = express();
const server = http.createServer(app); // use http.Server so WS can share it
const PORT   = process.env.PORT || 3000;

// Seed admin + DB schema on startup
db.seedAdmin().catch(err => {
  console.error('[DB] Startup error:', err.message);
  console.error('[DB] Check DATABASE_URL in .env');
});

// ── Security middleware ──────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc:       ["'self'", "https://fonts.gstatic.com"],
      imgSrc:        ["'self'", "data:", "https:", "http:"],
      frameSrc:      ["*"],
      connectSrc:    ["'self'", "https:", "http:", "ws:", "wss:"],
      mediaSrc:      ["*"],
      workerSrc:     ["'self'", "blob:"],
    },
  },
  crossOriginEmbedderPolicy:  false,
  crossOriginOpenerPolicy:    false,
  crossOriginResourcePolicy:  { policy: "cross-origin" },
  referrerPolicy:             { policy: "no-referrer" },
}));

app.use(cors());
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '4mb' }));

// ── Ad-block middleware ──────────────────────────────
const AD_HOSTS = ['doubleclick.net','googlesyndication.com','adservice.google.com','pagead2.googlesyndication.com','adnxs.com','popads.net','popcash.net','propellerads.com','exoclick.com'];
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  if (AD_HOSTS.some(h => host.includes(h))) return res.status(204).end();
  res.removeHeader('X-Frame-Options');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'fullscreen=*, autoplay=*, picture-in-picture=*, encrypted-media=*, payment=(), usb=()');
  next();
});

// ── Static files ──────────────────────────────────────

// ── Auth routes ───────────────────────────────────────
const authRoutes  = require('./server/routes/auth');
const partyRoutes = require('./server/routes/party');
app.use('/api/auth',  authRoutes);
app.use('/api/party', partyRoutes);

// ── Health ────────────────────────────────────────────
app.get('/api/health', (req, res) =>
  res.json({
    ok:         true,
    hasKey:     !!process.env.TMDB_API_KEY,
    hasDb:      !!process.env.DATABASE_URL,
    uptime:     process.uptime(),
    discordUrl: process.env.DISCORD_URL || null,
  })
);

// ── TMDB key setup ────────────────────────────────────
app.post('/api/setup/key', async (req, res) => {
  const { key } = req.body || {};
  if (!key || key.length < 20) return res.status(400).json({ error: 'Invalid key.' });
  try {
    await axios.get('https://api.themoviedb.org/3/movie/popular', { params: { api_key: key }, timeout: 8000 });
  } catch(e) {
    const s = e.response?.status;
    if (s === 401) return res.status(401).json({ error: 'Invalid TMDB key.' });
    return res.status(500).json({ error: 'Could not reach TMDB.' });
  }
  try {
    const envPath = path.join(__dirname, '.env');
    let content = ''; try { content = fs.readFileSync(envPath, 'utf8'); } catch {}
    content = content.includes('TMDB_API_KEY=')
      ? content.replace(/^TMDB_API_KEY=.*/m, `TMDB_API_KEY=${key}`)
      : content.trim() + `\nTMDB_API_KEY=${key}\n`;
    fs.writeFileSync(envPath, content);
    process.env.TMDB_API_KEY = key;
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: 'Could not save: ' + e.message });
  }
});

// ── Movie API routes ──────────────────────────────────
const apiRoutes = require('./server/routes/api');
app.use('/api', (req, res, next) => {
  if (!process.env.TMDB_API_KEY) return res.status(503).json({ error: 'TMDB key not configured. Visit /setup' });
  next();
}, apiRoutes);

app.get('/logo.png', (req, res) => {

  const custom = path.join(__dirname, 'public', '4reels.png');

  if (fs.existsSync(custom)) return res.sendFile(custom);

  res.sendFile(path.join(__dirname, 'public', '4reels-logo.svg'));

});

app.use(express.static(path.join(__dirname, 'public')));

// ── Static page routes ────────────────────────────────
const STATIC = { '/dmca':'/dmca.html', '/privacy':'/privacy.html', '/terms':'/terms.html', '/contact':'/contact.html', '/setup':'/setup.html' };
Object.entries(STATIC).forEach(([route, file]) =>
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, 'public', file)))
);

// ── SPA fallback ──────────────────────────────────────
app.get('*', (req, res) => {
  if (!process.env.TMDB_API_KEY && !req.path.startsWith('/api')) return res.redirect('/setup');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── WebSocket party server (shares http.Server port) ─
attachPartyWS(server);

// ── Start ─────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🎬  4reels  →  http://localhost:${PORT}`);
  console.log(`   TMDB:    ${process.env.TMDB_API_KEY ? '✓' : '✗  run /setup'}`);
  console.log(`   DB:      ${process.env.DATABASE_URL ? '✓ Neon Postgres' : '✗  set DATABASE_URL'}`);
  console.log(`   Discord: ${process.env.DISCORD_URL || '(not set)'}\n`);
});
