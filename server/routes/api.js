const express   = require('express');
const rateLimit = require('express-rate-limit');
const movies    = require('../services/movies');

const router = express.Router();

const limiter = rateLimit({ windowMs:60_000, max:200, standardHeaders:true, legacyHeaders:false });
router.use(limiter);

const wrap = fn => (req, res, next) =>
  fn(req, res, next).catch(err => {
    console.error(`[API] ${req.path}:`, err.message);
    res.status(500).json({ error: err.message });
  });

router.get('/home',              wrap(async (req,res) => res.json(await movies.home())));
router.get('/trending',          wrap(async (req,res) => res.json(await movies.trending(+(req.query.page||1)))));
router.get('/movies/popular',    wrap(async (req,res) => res.json(await movies.popular(+(req.query.page||1)))));
router.get('/movies/top-rated',  wrap(async (req,res) => res.json(await movies.topRated(+(req.query.page||1)))));
router.get('/movies/now-playing',wrap(async (req,res) => res.json(await movies.nowPlaying(+(req.query.page||1)))));
router.get('/movies/upcoming',   wrap(async (req,res) => res.json(await movies.upcoming(+(req.query.page||1)))));
router.get('/movies/genre/:id',  wrap(async (req,res) => res.json(await movies.byGenre(+req.params.id, +(req.query.page||1)))));
router.get('/genres',            wrap(async (req,res) => res.json({ genres: await movies.genres() })));
router.get('/search',            wrap(async (req,res) => {
  const { q, page=1 } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: 'q required' });
  res.json(await movies.search(q.trim(), +page));
}));
router.get('/movies/:id',        wrap(async (req,res) => res.json(await movies.details(req.params.id))));
router.get('/health',            (req,res) => res.json({ ok:true, uptime:process.uptime(), hasKey:!!process.env.TMDB_API_KEY }));

// DMCA / Contact webhook
const axios   = require('axios');
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

router.post('/dmca', wrap(async (req,res) => {
  const { name, email, url, description, signature } = req.body||{};
  if (!name||!email||!description||!signature)
    return res.status(400).json({ error:'All fields required.' });
  if (!WEBHOOK) return res.status(503).json({ error:'DMCA not configured.' });
  await axios.post(WEBHOOK, {
    username:'4reels DMCA Bot',
    embeds:[{ title:'🚨 DMCA Notice', color:0xff4757, timestamp:new Date().toISOString(),
      fields:[
        { name:'👤 Name',    value:String(name).slice(0,200),        inline:true },
        { name:'📧 Email',   value:String(email).slice(0,200),       inline:true },
        { name:'🔗 URL',     value:String(url||'N/A').slice(0,500),  inline:false },
        { name:'📝 Desc',    value:String(description).slice(0,1000),inline:false },
        { name:'✍️ Sig',    value:String(signature).slice(0,200),   inline:true },
      ],
      footer:{ text:'4reels.xyz' }
    }]
  });
  res.json({ ok:true });
}));

router.post('/contact', wrap(async (req,res) => {
  const { name, email, subject, message } = req.body||{};
  if (!name||!email||!message) return res.status(400).json({ error:'Required fields missing.' });
  if (!WEBHOOK) return res.status(503).json({ error:'Contact not configured.' });
  await axios.post(WEBHOOK, {
    username:'4reels Contact',
    embeds:[{ title:'📬 Contact Form', color:0x2d6fff, timestamp:new Date().toISOString(),
      fields:[
        { name:'Name',    value:String(name).slice(0,200),          inline:true },
        { name:'Email',   value:String(email).slice(0,200),         inline:true },
        { name:'Subject', value:String(subject||'—').slice(0,200),  inline:false },
        { name:'Message', value:String(message).slice(0,1000),      inline:false },
      ],
      footer:{ text:'4reels.xyz' }
    }]
  });
  res.json({ ok:true });
}));

module.exports = router;
