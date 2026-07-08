/**
 * TMDB Service — uses the TMDB v3 API.
 * A free API key is required. Get one free at:
 * https://www.themoviedb.org/settings/api (takes ~60 seconds)
 */
const axios     = require('axios');
const NodeCache = require('node-cache');

const cache      = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const TMDB_BASE  = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

function getKey() {
  return process.env.TMDB_API_KEY || '';
}

const tmdb = axios.create({
  baseURL: TMDB_BASE,
  timeout: 10000,
});

// intercept every request to inject the current key
tmdb.interceptors.request.use(cfg => {
  cfg.params = { api_key: getKey(), language: 'en-US', ...cfg.params };
  return cfg;
});

const img = {
  poster:   (p, s='w342')  => p ? `${IMAGE_BASE}/${s}${p}` : null,
  backdrop: (b, s='w1280') => b ? `${IMAGE_BASE}/${s}${b}` : null,
  profile:  (p, s='w185')  => p ? `${IMAGE_BASE}/${s}${p}` : null,
};

function norm(m) {
  return {
    id:         m.id,
    tmdb:       String(m.id),
    title:      m.title || m.name || 'Unknown',
    overview:   m.overview || '',
    poster:     img.poster(m.poster_path),
    posterLg:   img.poster(m.poster_path, 'w500'),
    backdrop:   img.backdrop(m.backdrop_path),
    backdropSm: img.backdrop(m.backdrop_path, 'w780'),
    rating:     m.vote_average ? m.vote_average.toFixed(1) : 'N/A',
    votes:      m.vote_count  || 0,
    year:       (m.release_date || m.first_air_date || '').slice(0, 4),
    releaseDate:m.release_date || m.first_air_date || '',
    genreIds:   m.genre_ids || [],
    genres:     (m.genres  || []).map(g => g.name),
    popularity: m.popularity || 0,
    runtime:    m.runtime  || null,
    tagline:    m.tagline  || '',
    status:     m.status   || '',
    budget:     m.budget   || 0,
    revenue:    m.revenue  || 0,
    language:   m.original_language || 'en',
    mediaType:  m.media_type || 'movie',
  };
}

async function get(path, params = {}, ttl = 300) {
  const key = `${path}:${JSON.stringify(params)}`;
  const hit  = cache.get(key);
  if (hit) return hit;
  const { data } = await tmdb.get(path, { params });
  cache.set(key, data, ttl);
  return data;
}

function paged(data) {
  return {
    page:         data.page,
    totalPages:   Math.min(data.total_pages, 500),
    totalResults: data.total_results,
    results:      (data.results || []).map(norm),
  };
}

module.exports = {
  img,
  hasKey: () => !!getKey() && getKey() !== 'your_tmdb_api_key_here',

  trending:   (w='week', p=1) => get(`/trending/movie/${w}`, { page:p }).then(paged),
  popular:    (p=1)           => get('/movie/popular',       { page:p }).then(paged),
  topRated:   (p=1)           => get('/movie/top_rated',     { page:p }).then(paged),
  nowPlaying: (p=1)           => get('/movie/now_playing',   { page:p }).then(paged),
  upcoming:   (p=1)           => get('/movie/upcoming',      { page:p }).then(paged),
  genres:     ()              => get('/genre/movie/list',    {}, 86400).then(d => d.genres),

  byGenre: (id, p=1, sort='popularity.desc') =>
    get('/discover/movie', { with_genres:id, sort_by:sort, page:p, 'vote_count.gte':50 }).then(paged),

  discover: (params={}) =>
    get('/discover/movie', { sort_by:'popularity.desc', include_adult:false, 'vote_count.gte':10, ...params }).then(paged),

  search: (q, p=1) =>
    get('/search/movie', { query:q, page:p, include_adult:false }, 60).then(paged),

  details: async (id) => {
    const data = await get(`/movie/${id}`, { append_to_response:'credits,videos,similar,recommendations,release_dates' }, 3600);
    const m    = norm(data);
    m.genres       = (data.genres||[]).map(g => g.name);
    m.director     = (data.credits?.crew||[]).filter(c=>c.job==='Director').map(c=>c.name).join(', ');
    m.writers      = (data.credits?.crew||[]).filter(c=>['Writer','Screenplay','Story'].includes(c.job)).map(c=>c.name).slice(0,3).join(', ');
    m.cast         = (data.credits?.cast||[]).slice(0,12).map(c=>({ id:c.id, name:c.name, character:c.character, profile:img.profile(c.profile_path) }));
    m.trailerKey   = (data.videos?.results||[]).find(v=>v.type==='Trailer'&&v.site==='YouTube')?.key||null;
    m.similar      = [...(data.recommendations?.results||[]),...(data.similar?.results||[])].slice(0,12).map(norm);
    const cert     = (data.release_dates?.results||[]).find(r=>r.iso_3166_1==='US')?.release_dates?.find(r=>r.certification)?.certification;
    m.certification= cert||'';
    m.posterLarge  = img.poster(data.poster_path,'w500');
    return m;
  },

  home: async () => {
    const [trending, popular, topRated, nowPlaying, genres] = await Promise.all([
      module.exports.trending(),
      module.exports.popular(),
      module.exports.topRated(),
      module.exports.nowPlaying(),
      module.exports.genres(),
    ]);
    return {
      trending:   trending.results.slice(0,20),
      popular:    popular.results.slice(0,20),
      topRated:   topRated.results.slice(0,20),
      nowPlaying: nowPlaying.results.slice(0,20),
      genres,
      featured:   trending.results[0] || popular.results[0],
    };
  },
};
