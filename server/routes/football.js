const express  = require('express');
const football = require('../services/football');

const router = express.Router();

const wrap = fn => (req, res, next) =>
  fn(req, res, next).catch(err => {
    console.error('[Football API]', err.message);
    res.status(500).json({ error: err.message });
  });

router.get('/matches/live',    wrap(async (req, res) => res.json(await football.getLive())));
router.get('/matches/popular', wrap(async (req, res) => res.json(await football.getPopular())));
router.get('/matches/all',     wrap(async (req, res) => res.json(await football.getAllMatches())));
router.get('/search',          wrap(async (req, res) => {
  const { q } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: 'q required' });
  res.json(await football.searchMatches(q.trim()));
}));
router.get('/team/:slug',      wrap(async (req, res) => {
  res.json(await football.getTeamMatches(req.params.slug));
}));
router.get('/streams/:id',     wrap(async (req, res) => {
  const streams = await football.getStreams(req.params.id);
  const urls    = football.buildEmbedUrls(req.params.id, streams);
  res.json({ streams, embedUrls: urls });
}));

module.exports = router;
