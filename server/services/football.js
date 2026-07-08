/**
 * Football service — streamed.su public API
 * Correct endpoints verified from their public documentation
 */
const axios     = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 60, checkperiod: 30 });

const http = axios.create({
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
    'Accept':     'application/json, */*',
    'Referer':    'https://streamed.su/',
    'Origin':     'https://streamed.su',
  },
});

const BASE = 'https://streamed.su/api';

async function cached(key, fn, ttl=60) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const val = await fn();
  cache.set(key, val, ttl);
  return val;
}

function normMatch(m) {
  return {
    id:        m.id   || '',
    title:     m.title|| `${m.teams?.home?.name||'?'} vs ${m.teams?.away?.name||'?'}`,
    home:      m.teams?.home?.name || '',
    away:      m.teams?.away?.name || '',
    homeBadge: m.teams?.home?.badge ? `https://streamed.su${m.teams.home.badge}` : '',
    awayBadge: m.teams?.away?.badge ? `https://streamed.su${m.teams.away.badge}` : '',
    league:    m.category || '',
    isLive:    !!m.popular,
    date:      m.date || null,
    sources:   m.sources || [],
  };
}

async function get(path) {
  const { data } = await http.get(BASE + path);
  return Array.isArray(data) ? data : (data.matches || data.results || data.data || []);
}

async function getLive()    { return cached('live',    () => get('/matches/live'),    30); }
async function getPopular() { return cached('popular', () => get('/matches/popular'), 30); }
async function getAll()     { return cached('all',     () => get('/matches/all'),     60); }

async function searchMatches(q) {
  const all   = await getAll();
  const lower = q.toLowerCase();
  return all.filter(m =>
    normMatch(m).home.toLowerCase().includes(lower)   ||
    normMatch(m).away.toLowerCase().includes(lower)   ||
    normMatch(m).title.toLowerCase().includes(lower)  ||
    normMatch(m).league.toLowerCase().includes(lower)
  );
}

async function getStreams(matchId) {
  return cached(`streams:${matchId}`, async () => {
    try {
      const { data } = await http.get(`${BASE}/stream/football/${matchId}`);
      return Array.isArray(data) ? data : (data.streams || data.sources || []);
    } catch { return []; }
  }, 30);
}

function buildEmbedUrls(matchId, sources) {
  const seen = new Set();
  const urls = [];
  const add  = (name, url) => { if (!seen.has(url)) { seen.add(url); urls.push({ name, url }); } };

  (sources || []).forEach((src, i) => {
    add(`${src.source||'Stream'} ${i+1}${src.hd?' HD':''}`,
        `https://embedme.top/embed/${src.source||'alpha'}/${matchId}/${src.id||(i+1)}`);
  });

  add('Alpha 1',   `https://embedme.top/embed/alpha/${matchId}/1`);
  add('Alpha 2',   `https://embedme.top/embed/alpha/${matchId}/2`);
  add('Bravo',     `https://embedme.top/embed/bravo/${matchId}/1`);
  add('Charlie',   `https://embedme.top/embed/charlie/${matchId}/1`);

  return urls;
}

module.exports = {
  getLive:        async () => (await getLive()).map(normMatch),
  getPopular:     async () => (await getPopular()).map(normMatch),
  getAll:         async () => (await getAll()).map(normMatch),
  searchMatches:  async (q) => (await searchMatches(q)).map(normMatch),
  getStreams,
  buildEmbedUrls,
};
