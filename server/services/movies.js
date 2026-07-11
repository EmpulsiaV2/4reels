/**
 * Movie service — TMDB API (free key required, stored in .env)
 * Streams via player.FilmU.net using numeric TMDB IDs
 */
const axios     = require('axios');
const NodeCache = require('node-cache');

const cache  = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const TBASE  = 'https://api.themoviedb.org/3';
const IMGB   = 'https://image.tmdb.org/t/p';

const http = axios.create({
  baseURL: TBASE,
  timeout: 10000,
  headers: { 'Accept': 'application/json' },
});

// Inject API key on every request
http.interceptors.request.use(cfg => {
  cfg.params = { api_key: process.env.TMDB_API_KEY, language: 'en-US', ...cfg.params };
  return cfg;
});

const img = {
  poster:   (p, s='w342')  => p ? `${IMGB}/${s}${p}` : null,
  posterLg: (p)            => p ? `${IMGB}/w500${p}` : null,
  backdrop: (b, s='w1280') => b ? `${IMGB}/${s}${b}` : null,
  profile:  (p)            => p ? `${IMGB}/w185${p}` : null,
};

async function cached(key, fn, ttl=300) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const val = await fn();
  cache.set(key, val, ttl);
  return val;
}

function norm(m) {
  const rating = m.vote_average ? Number(m.vote_average).toFixed(1) : 'N/A';
  return {
    id:          m.id,
    tmdbId:      m.id,
    imdbId:      m.imdb_id || null,
    title:       m.title || m.name || 'Unknown',
    year:        (m.release_date || m.first_air_date || '').slice(0,4),
    rating,
    votes:       m.vote_count || 0,
    poster:      img.poster(m.poster_path),
    posterLarge: img.posterLg(m.poster_path),
    backdrop:    img.backdrop(m.backdrop_path),
    backdropSm:  img.backdrop(m.backdrop_path, 'w780'),
    overview:    m.overview || '',
    genres:      (m.genres || []).map(g => g.name).concat(
                   (m.genre_ids || []).map(id => GENRE_MAP[id]).filter(Boolean)
                 ).filter((v,i,a) => a.indexOf(v)===i),
    runtime:     m.runtime || null,
    tagline:     m.tagline || '',
    language:    m.original_language || 'en',
    mediaType:   m.media_type || 'movie',
    certification: '',
    cast:        [],
    director:    '',
    trailerKey:  null,
    similar:     [],
  };
}

const GENRE_MAP = {
  28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',
  99:'Documentary',18:'Drama',10751:'Family',14:'Fantasy',36:'History',
  27:'Horror',10402:'Music',9648:'Mystery',10749:'Romance',878:'Sci-Fi',
  53:'Thriller',10752:'War',37:'Western',
};

async function tmdbGet(path, params={}, ttl=300) {
  const key = `${path}:${JSON.stringify(params)}`;
  return cached(key, async () => {
    const { data } = await http.get(path, { params });
    return data;
  }, ttl);
}

function paged(data) {
  return {
    page:         data.page,
    totalPages:   Math.min(data.total_pages || 1, 500),
    totalResults: data.total_results || 0,
    results:      (data.results || []).filter(m => m.poster_path).map(norm),
  };
}

// ── Public API ────────────────────────────────────────────
async function trending(page=1) {
  return paged(await tmdbGet('/trending/movie/week', { page }));
}
async function popular(page=1) {
  return paged(await tmdbGet('/movie/popular', { page }));
}
async function popularTV(page=1) {
  return paged(await tmdbGet('/tv/popular', { page }));
}
async function topRated(page=1) {
  return paged(await tmdbGet('/movie/top_rated', { page }));
}
async function topRatedTV(page=1) {
  return paged(await tmdbGet('/tv/top_rated', { page }));
}
async function nowPlaying(page=1) {
  return paged(await tmdbGet('/movie/now_playing', { page }));
}
async function upcoming(page=1) {
  return paged(await tmdbGet('/movie/upcoming', { page }));
}
async function byGenre(genreId, page=1) {
  return paged(await tmdbGet('/discover/movie', {
    with_genres: genreId, sort_by: 'popularity.desc',
    page, 'vote_count.gte': 50,
  }));
}

async function discover({
  page = 1,
  genre = '',
  sort = 'popular',
  rating = '',
  type = 'movies'
} = {}) {

  const isTV = type === 'series';

  const params = {
    page,
    sort_by: sort === 'popular'
      ? 'popularity.desc'
      : sort === 'rating'
      ? 'vote_average.desc'
      : 'popularity.desc',
    'vote_count.gte': 50,
  };

  if (genre) {
    params.with_genres = genre;
  }

  if (rating) {
    params['vote_average.gte'] = rating;
  }

  const endpoint = isTV
    ? '/discover/tv'
    : '/discover/movie';

  return paged(await tmdbGet(endpoint, params));
}

async function search(q, page=1) {
  const data = await tmdbGet('/search/movie', { query: q, page, include_adult: false }, 60);
  return paged(data);
}
async function details(id) {
  return cached(`detail:${id}`, async () => {
    const data = await http.get(`/movie/${id}`, {
      params: { append_to_response: 'credits,videos,similar,recommendations,release_dates,images' },
    });
    const m    = norm(data.data);
    m.imdbId   = data.data.imdb_id || null;
    m.genres   = (data.data.genres || []).map(g => g.name);
    m.tagline  = data.data.tagline || '';
    m.runtime  = data.data.runtime || null;

    // Director + writers
    const crew   = data.data.credits?.crew || [];
    m.director   = crew.filter(c => c.job === 'Director').map(c => c.name).join(', ');
    m.writers    = crew.filter(c => ['Screenplay','Writer','Story'].includes(c.job))
                       .map(c => c.name).slice(0,3).join(', ');

    // Full cast with profile images
    m.cast = (data.data.credits?.cast || []).slice(0, 20).map(c => ({
      id:        c.id,
      name:      c.name,
      character: c.character,
      profile:   img.profile(c.profile_path),
    }));

    // Trailer
    const vids    = data.data.videos?.results || [];
    const trailer = vids.find(v => v.type==='Trailer' && v.site==='YouTube') || vids.find(v => v.site==='YouTube');
    m.trailerKey  = trailer?.key || null;

    // Similar movies
    const simResults = [
      ...(data.data.recommendations?.results || []),
      ...(data.data.similar?.results || []),
    ].filter(s => s.poster_path).slice(0, 16);
    m.similar = simResults.map(norm);

    // US certification
    const usRelease = (data.data.release_dates?.results || []).find(r => r.iso_3166_1 === 'US');
    m.certification = usRelease?.release_dates?.find(r => r.certification)?.certification || '';

    // Best backdrop
    const backdrops = data.data.images?.backdrops || [];
    if (backdrops.length) m.backdrop = img.backdrop(backdrops[0].file_path);

    return m;
  }, 3600);
}
async function genres() {
  const data = await tmdbGet('/genre/movie/list', {}, 86400);
  return (data.genres || []).map(g => ({
    id:   g.id,
    name: g.name,
    icon: GENRE_ICONS[g.id] || '🎬',
  }));
}
const GENRE_ICONS = {
  28:'💥',12:'🗺️',16:'✨',35:'😂',80:'🔫',99:'🎥',18:'🎭',
  10751:'👨‍👩‍👧',14:'🧙',36:'📜',27:'👻',10402:'🎵',9648:'🔍',
  10749:'❤️',878:'🚀',53:'😰',10752:'⚔️',37:'🤠',
};

async function home() {
  const [trendR, popR, topR, nowR, genreR] = await Promise.allSettled([
    trending(1), popular(1), topRated(1), nowPlaying(1), genres(),
  ]);
  const pick  = r => r.status==='fulfilled' ? r.value : { results:[] };
  const pickG = r => r.status==='fulfilled' ? r.value : [];

  const trendMovies = pick(trendR).results;
  const featured    = trendMovies[0] || null;

  // Genre rows
  const topGenreIds = [28, 878, 27, 35, 80, 53];
  const genreRowRes = await Promise.allSettled(topGenreIds.map(id => byGenre(id, 1)));
  const allGenres   = pickG(genreR);

  const genreRows = topGenreIds.map((id, i) => {
    const g = allGenres.find(g => g.id === id) || { id, name: GENRE_MAP[id]||'', icon: GENRE_ICONS[id]||'🎬' };
    return {
      genreId: id,
      genre:   String(id),
      name:    g.name,
      icon:    g.icon,
      results: genreRowRes[i].status==='fulfilled' ? genreRowRes[i].value.results.slice(0,20) : [],
    };
  }).filter(r => r.results.length > 0);

  return {
    featured,
    trending:   trendMovies.slice(0,20),
    popular:    pick(popR).results.slice(0,20),
    topRated:   pick(topR).results.slice(0,20),
    nowPlaying: pick(nowR).results.slice(0,20),
    genreRows,
    genres: allGenres,
  };
}

module.exports = {
  trending,
  popular,
  popularTV,
  topRated,
  topRatedTV,
  nowPlaying,
  upcoming,
  byGenre,
  discover,
  search,
  details,
  genres,
  home,
};