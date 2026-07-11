/* ══════════════════════════════════════════════════════
   4REELS — SPA router + all page logic
   ══════════════════════════════════════════════════════ */
'use strict';

/* ── tiny helpers ─────────────────────────────────────── */
const $ = id => document.getElementById(id);
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ══════════════════════════════════════════════════════
   API
   ══════════════════════════════════════════════════════ */
const API = (() => {
  const cache = new Map();
  async function get(path) {
    if (cache.has(path)) return cache.get(path);
    
    try {
      const r = await fetch('/api' + path);
      if (!r.ok) {
        console.warn(`API ${path} failed:`, r.status);
        return { results: [] }; // fallback
      }
      const d = await r.json();
      cache.set(path, d);
      setTimeout(() => cache.delete(path), 3 * 60 * 1000);
      return d;
    } catch (e) {
      console.error('API error for', path, e);
      return { results: [] }; // prevent crash
    }
  }
  return {
    trending:    (p=1) => get(`/trending?page=${p}`),
    popular:     (p=1) => get(`/movies/popular?page=${p}`),
    topRated:    (p=1) => get(`/movies/top-rated?page=${p}`),
    nowPlaying:  (p=1) => get(`/movies/now-playing?page=${p}`),
    popularTV:   (p=1) => get(`/tv/popular?page=${p}`),
    topRatedTV:  (p=1) => get(`/tv/top-rated?page=${p}`),
    search:      (q,p=1) => get(`/search?q=${encodeURIComponent(q)}&page=${p}`),
    details:     id => get(`/movie/${id}`),
    byGenre:     (g,p=1,type) => get(`/genre/${g}?page=${p}${type?'&type='+type:''}`),
    genres:      () => get('/genres'),
    genresTV:    () => get('/genres/tv'),
    discover:    (p,g,s,r,type) => get(`/discover?page=${p}&genre=${g||''}&sort=${s||'popular'}&rating=${r||''}${type?'&type='+type:''}`),
  };
})();

/* ══════════════════════════════════════════════════════
   AUTH
   ══════════════════════════════════════════════════════ */
const Auth = (() => {
  let user = null;
  try { user = JSON.parse(localStorage.getItem('4reels_user') || 'null'); } catch {}

  function save(u) { user = u; if (u) localStorage.setItem('4reels_user', JSON.stringify(u)); else localStorage.removeItem('4reels_user'); }
  function get()   { return user; }
  function token() { try { return JSON.parse(localStorage.getItem('4reels_user')||'null')?.token || null; } catch { return null; } }

  async function req(path, body) {
    const r = await fetch('/api/auth' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Error');
    return d;
  }

  async function authReq(path, method='GET', body) {
    const opts = { method, headers: { 'Authorization': 'Bearer ' + token() } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await fetch('/api/auth' + path, opts);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Error');
    return d;
  }

  async function login(username, password) {
    const d = await req('/login', { username, password });
    save(d.user ? { ...d.user, token: d.token } : null);
    updateSidebar(); return d;
  }

  async function register(username, email, password) {
    const d = await req('/register', { username, email, password });
    save(d.user ? { ...d.user, token: d.token } : null);
    updateSidebar(); return d;
  }

  function logout() { save(null); updateSidebar(); }

  function updateSidebar() {
    const u = get();
    const initEl = $('nav-avatar-initials');
    const av     = $('nav-avatar');
    if (!initEl) return;
    if (u) {
      const initials = (u.displayName || u.username || '?').slice(0, 2).toUpperCase();
      initEl.textContent = initials;
      if (u.avatarBase64) {
        let img = av.querySelector('img');
        if (!img) { img = document.createElement('img'); av.appendChild(img); }
        img.src = u.avatarBase64;
      }
      const bigInit = $('profile-avatar-initials-big');
      if (bigInit) bigInit.textContent = initials;
    } else {
      initEl.textContent = '?';
    }
  }

  function openModal(tab='login') {
    let ov = $('auth-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'auth-overlay';
      ov.className = 'auth-overlay';
      ov.innerHTML = `
        <div class="auth-modal">
          <button class="auth-close" id="auth-close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
          <div class="auth-modal-logo">
            <img src="/4reels.png" alt="4Reels" onerror="this.style.display='none'"/>
          </div>
          <div class="auth-tabs">
            <button class="auth-tab active" id="auth-tab-login">Sign In</button>
            <button class="auth-tab" id="auth-tab-register">Register</button>
          </div>
          <div id="auth-err" class="auth-error"></div>
          <div id="auth-login-form">
            <div class="auth-field"><label>Username</label><input id="auth-l-user" type="text" placeholder="your username" autocomplete="username"/></div>
            <div class="auth-field"><label>Password</label><input id="auth-l-pass" type="password" placeholder="••••••••" autocomplete="current-password"/></div>
            <button class="auth-submit" id="auth-login-btn">Sign In</button>
          </div>
          <div id="auth-reg-form" style="display:none">
            <div class="auth-field"><label>Username</label><input id="auth-r-user" type="text" placeholder="choose a username" autocomplete="username"/></div>
            <div class="auth-field"><label>Email</label><input id="auth-r-email" type="email" placeholder="your@email.com" autocomplete="email"/></div>
            <div class="auth-field"><label>Password</label><input id="auth-r-pass" type="password" placeholder="••••••••" autocomplete="new-password"/></div>
            <button class="auth-submit" id="auth-reg-btn">Create Account</button>
          </div>
        </div>`;
      document.body.appendChild(ov);

      ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
      $('auth-close').addEventListener('click', closeModal);

      const showErr = msg => {
        const el = $('auth-err'); el.textContent = msg; el.classList.add('show');
      };
      const hideErr = () => { const el=$('auth-err'); el.textContent=''; el.classList.remove('show'); };

      // Tabs
      $('auth-tab-login').addEventListener('click', () => {
        $('auth-login-form').style.display = '';
        $('auth-reg-form').style.display   = 'none';
        $('auth-tab-login').classList.add('active');
        $('auth-tab-register').classList.remove('active');
        hideErr();
      });
      $('auth-tab-register').addEventListener('click', () => {
        $('auth-login-form').style.display = 'none';
        $('auth-reg-form').style.display   = '';
        $('auth-tab-register').classList.add('active');
        $('auth-tab-login').classList.remove('active');
        hideErr();
      });

      // Login
      $('auth-login-btn').addEventListener('click', async () => {
        hideErr();
        const btn = $('auth-login-btn');
        btn.disabled = true; btn.textContent = 'Signing in…';
        try {
          await login($('auth-l-user').value.trim(), $('auth-l-pass').value);
          closeModal(); toast('Welcome back! 👋', 'success');
        } catch (e) { showErr(e.message); }
        finally { btn.disabled = false; btn.textContent = 'Sign In'; }
      });
      [$('auth-l-user'), $('auth-l-pass')].forEach(el =>
        el?.addEventListener('keydown', e => { if (e.key === 'Enter') $('auth-login-btn').click(); })
      );

      // Register
      $('auth-reg-btn').addEventListener('click', async () => {
        hideErr();
        const btn = $('auth-reg-btn');
        btn.disabled = true; btn.textContent = 'Creating…';
        try {
          await register($('auth-r-user').value.trim(), $('auth-r-email').value.trim(), $('auth-r-pass').value);
          closeModal(); toast('Account created! 🎉', 'success');
        } catch (e) { showErr(e.message); }
        finally { btn.disabled = false; btn.textContent = 'Create Account'; }
      });
    }

    if (tab === 'register') $('auth-tab-register').click();
    ov.classList.add('open');
    document.body.classList.add('noscroll');
  }

  function closeModal() {
    const ov = $('auth-overlay');
    if (ov) { ov.classList.remove('open'); document.body.classList.remove('noscroll'); }
  }

  return { get, token, authReq, login, register, logout, updateSidebar, openModal, closeModal };
})();

/* ══════════════════════════════════════════════════════
   TOAST
   ══════════════════════════════════════════════════════ */
function toast(msg, type) {
  const w = $('toast-wrap'); if (!w) return;
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  w.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transition = 'opacity .22s';
    setTimeout(() => el.remove(), 250);
  }, 3000);
}

/* ══════════════════════════════════════════════════════
   LOCAL STORAGE helpers
   ══════════════════════════════════════════════════════ */
const LS = {
  get:    k     => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set:    (k,v) => localStorage.setItem(k, JSON.stringify(v)),
  remove: k     => localStorage.removeItem(k),
};

/* continue watching */
function cwGet()          { return LS.get('4reels_cw') || []; }
function cwAdd(movie)     {
  const prefs = LS.get('4reels_prefs') || {};
  if (prefs.trackHistory === false) return;
  let cw = cwGet().filter(m => m.tmdbId !== movie.tmdbId);
  cw.unshift({ tmdbId: movie.tmdbId, title: movie.title, poster: movie.poster, year: movie.year, rating: movie.rating ? Number(movie.rating).toFixed(1) : null, progress: movie.progress || 15 });
  if (cw.length > 20) cw = cw.slice(0, 20);
  LS.set('4reels_cw', cw);
}
function cwRemove(id)     { LS.set('4reels_cw', cwGet().filter(m => m.tmdbId !== id)); }
function cwClear()        { LS.remove('4reels_cw'); }

/* my list */
function listGet()        { return LS.get('4reels_list') || []; }
function listToggle(movie){
  let list = listGet();
  const has = list.some(m => m.tmdbId === movie.tmdbId);
  if (has) list = list.filter(m => m.tmdbId !== movie.tmdbId);
  else list.unshift({ tmdbId: movie.tmdbId, title: movie.title, poster: movie.poster, year: movie.year, rating: movie.rating });
  LS.set('4reels_list', list);
  return !has;
}
function listHas(id)      { return listGet().some(m => m.tmdbId === id); }

/* prefs */
function prefsGet()       { return LS.get('4reels_prefs') || {}; }
function prefsSave(p)     { LS.set('4reels_prefs', { ...prefsGet(), ...p }); }

/* ══════════════════════════════════════════════════════
   ROUTER
   ══════════════════════════════════════════════════════ */
const router = (() => {
  let _current = null;

  const routes = [
    { re: /^\/$|^\/home$/,                       fn: showHome      },
    { re: /^\/movies$/,                           fn: () => showGrid('movies') },
    { re: /^\/series$/,                           fn: () => showGrid('series') },
    { re: /^\/sparks$/,                           fn: showSparks    },
    { re: /^\/genres$/,                           fn: showGenres    },
    { re: /^\/genre\/([^/]+)$/,                   fn: (m) => showGenrePage(m[1]) },
    { re: /^\/my-list$/,                          fn: showMyList    },
    { re: /^\/continue-watching$/,                fn: showContinueWatching },
    { re: /^\/search\?q=(.+)$/,                  fn: (m) => showSearch(decodeURIComponent(m[1])) },
    { re: /^\/movie\/(\d+)$/,                     fn: (m) => showMovieDetail(m[1]) },
    { re: /^\/movie\/(\d+)\/watch$/,              fn: (m) => showWatch(m[1]) },
    { re: /^\/profile$/,                          fn: showProfile   },
  ];

  function handle(path) {
    _current = path;
    for (const { re, fn } of routes) {
      const m = path.match(re);
      if (m) { fn(m); return; }
    }
    showHome();
  }

  function go(path) {
    history.pushState({}, '', path);
    handle(path);
  }

  window.addEventListener('popstate', () => handle(location.pathname + location.search));

  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-route], a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('#') || href.startsWith('mailto')) return;
    if (a.target === '_blank') return;
    e.preventDefault();
    go(href);
  });

  return { go, handle };
})();

window.router = router;

/* ══════════════════════════════════════════════════════
   VIEW MANAGEMENT
   ══════════════════════════════════════════════════════ */
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  const v = $(id);
  if (v) v.style.display = '';
  // sync active sidebar icon
  const path = location.pathname;
  document.querySelectorAll('.sb-icon[data-route]').forEach(el => {
    el.classList.remove('active');
    const r = el.dataset.route;
    if (
      (r === 'home'        && (path === '/' || path === '/home')) ||
      (r === 'movies'      && path.startsWith('/movies')) ||
      (r === 'series'      && path.startsWith('/series')) ||
      (r === 'genres'      && path.startsWith('/genre')) ||
      (r === 'my-list'     && path === '/my-list') ||
      (r === 'watch-party' && path.startsWith('/watch-party')) ||
      (r === 'profile'     && path === '/profile')
    ) el.classList.add('active');
  });
  window.scrollTo(0, 0);
}

/* ══════════════════════════════════════════════════════
   CARD HTML
   ══════════════════════════════════════════════════════ */
function cardHTML(m) {
  const prefs = prefsGet();
  return `<div class="mc" data-id="${esc(m.tmdbId||m.id)}" data-type="${esc(m.mediaType||'movie')}">
    <div class="mc-poster">
      ${m.poster
        ? `<img src="${esc(m.poster)}" alt="${esc(m.title)}" loading="lazy" onerror="this.parentNode.innerHTML='<div class=mc-fb>🎬</div>'">`
        : `<div class="mc-fb">🎬</div>`}
      <div class="mc-ov">
        <div class="mc-play"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
      </div>
    </div>
    <div class="mc-info">
      <div class="mc-title">${esc(m.title)}</div>
      <div class="mc-foot">
        <span class="mc-year">${esc(m.year||'')}</span>
        ${prefs.showRatings !== false && m.rating
          ? `<span class="mc-rat">★ ${typeof m.rating?.toFixed==='function'?m.rating.toFixed(1):m.rating}</span>`
          : ''}
      </div>
    </div>
  </div>`;
}

function cwCardHTML(m) {
  return `<div class="cw-card" data-id="${esc(m.tmdbId)}">
    <div class="cw-poster">
      ${m.poster
        ? `<img src="${esc(m.poster)}" alt="${esc(m.title)}" loading="lazy">`
        : `<div class="cw-poster-fb">🎬</div>`}
      <div class="cw-overlay"><div class="cw-play"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div></div>
      <button class="cw-remove" data-id="${esc(m.tmdbId)}" title="Remove">✕</button>
    </div>
    <div class="cw-info">
      <div class="cw-title">${esc(m.title)}</div>
      <div class="cw-meta">
        <span class="cw-year">${esc(m.year||'')}</span>
        <span class="cw-rat">★ ${m.rating ? Number(m.rating).toFixed(1) : '—'}</span>
      </div>
    </div>
    <div class="cw-progress"><div class="cw-progress-bar" style="width:${m.progress||20}%"></div></div>
  </div>`;
}

function wireCards(container) {
  container?.querySelectorAll('.mc').forEach(el => {
    el.addEventListener('click', () => {
      const type = el.dataset.type || 'movie';
      router.go(`/movie/${el.dataset.id}`);
    });
  });
  container?.querySelectorAll('.cw-card').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.cw-remove')) return;
      router.go(`/movie/${el.dataset.id}/watch`);
    });
  });
  container?.querySelectorAll('.cw-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      cwRemove(btn.dataset.id);
      btn.closest('.cw-card')?.remove();
    });
  });
}

/* ══════════════════════════════════════════════════════
   HOME
   ══════════════════════════════════════════════════════ */
async function showHome() {
  showView('view-home');
  document.title = 'Free HD Streaming';
  
  // Small delay to ensure DOM is ready
  await sleep(50);
  
  await initHero();
  await initHomeRows();
  initSafeBanner();
}

async function initHero() {
  try {
    const data = await API.trending(1);
    const movies = (data.results || []).slice(0, 8);
    if (!movies.length) return;

    let cur = 0;
    const slidesEl = $('hero-slides');
    const contentEl = $('hero-content');
    const dotsEl   = $('fs-dots') || $('hero-dots');

    if (!slidesEl || !contentEl) return;

    // Build slides
    slidesEl.innerHTML = movies.map((m, i) => `
      <div class="fs-slide${i===0?' active':''}"
        style="background-image:url('${esc(m.backdrop||m.poster||'')}')">
      </div>`).join('');

    // Dots
    if (dotsEl) {
      dotsEl.innerHTML = movies.map((_, i) =>
        `<button class="hero-dot-btn${i===0?' active':''}" data-i="${i}"></button>`
      ).join('');
      dotsEl.querySelectorAll('.hero-dot-btn').forEach(b =>
        b.addEventListener('click', () => goSlide(+b.dataset.i))
      );
    }

    // Filmstrip
    let filmEl = document.querySelector('.filmstrip');
    if (!filmEl) {
      filmEl = document.createElement('div');
      filmEl.className = 'filmstrip';
      const strip = $('hero');
      if (strip) strip.appendChild(filmEl);
    }
    filmEl.innerHTML = `
      <button class="filmstrip-arrow" id="fs-prev2">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <div class="filmstrip-items" id="filmstrip-items">
        ${movies.map((m,i) => `
          <div class="filmstrip-item${i===0?' active':''}" data-i="${i}">
            <img src="${esc(m.poster||m.backdrop||'')}" alt="${esc(m.title)}" loading="lazy"/>
          </div>`).join('')}
      </div>
      <button class="filmstrip-arrow" id="fs-next2">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
      </button>`;

    filmEl.querySelectorAll('.filmstrip-item').forEach(el =>
      el.addEventListener('click', () => goSlide(+el.dataset.i))
    );
    $('fs-prev2')?.addEventListener('click', () => goSlide(cur === 0 ? movies.length-1 : cur-1));
    $('fs-next2')?.addEventListener('click', () => goSlide((cur+1) % movies.length));

    // Arrow buttons
    $('hero-prev')?.addEventListener('click', () => goSlide(cur === 0 ? movies.length-1 : cur-1));
    $('hero-next')?.addEventListener('click', () => goSlide((cur+1) % movies.length));

    function goSlide(i) {
      cur = i;
      slidesEl.querySelectorAll('.fs-slide').forEach((s,j) => s.classList.toggle('active', j===i));
      dotsEl?.querySelectorAll('.hero-dot-btn').forEach((b,j) => b.classList.toggle('active', j===i));
      filmEl.querySelectorAll('.filmstrip-item').forEach((el,j) => el.classList.toggle('active', j===i));
      renderHeroContent(movies[i]);
    }

    renderHeroContent(movies[0]);

    // Auto-advance every 7s
    let autoTimer = setInterval(() => goSlide((cur+1) % movies.length), 7000);
    slidesEl.addEventListener('mouseenter', () => clearInterval(autoTimer));
    slidesEl.addEventListener('mouseleave', () => { autoTimer = setInterval(() => goSlide((cur+1) % movies.length), 7000); });

  } catch (e) { console.error('Hero error', e); }
}

function renderHeroContent(m) {
  const el = $('hero-content'); if (!el) return;
  const inList = listHas(m.tmdbId);
  el.innerHTML = `
    <div class="fs-eyebrow"><span class="fs-eyebrow-dot"></span>Now Streaming</div>
    <div class="fs-title">${esc(m.title)}</div>
    <div class="fs-meta">
      ${m.rating ? `<span class="fs-rating">★ ${m.rating.toFixed?.(1)||m.rating}</span><span class="fs-sep"></span>` : ''}
      ${m.year   ? `<span>${esc(m.year)}</span><span class="fs-sep"></span>` : ''}
      ${m.runtime? `<span>${m.runtime}</span>` : ''}
    </div>
    ${m.overview ? `<p class="fs-desc">${esc(m.overview.slice(0,160))}…</p>` : ''}
    <div class="fs-btns">
      <button class="btn-play-circle" id="hero-play-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <div class="fs-watch-label" style="cursor:pointer" id="hero-watch-label">
        <span class="fs-watch-title">Watch Now</span>
        <span class="fs-watch-sub">Movie</span>
      </div>
      <button class="fs-action-btn" id="hero-info-btn" title="More Info">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </button>
      <button class="fs-action-btn" id="hero-list-btn" title="${inList?'Remove from list':'Add to list'}" style="${inList?'border-color:rgba(255,255,255,.3);color:#fff':''}">
        ${inList
          ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`}
      </button>
    </div>`;

  $('hero-play-btn')?.addEventListener('click', () => router.go(`/movie/${m.tmdbId}/watch`));
  $('hero-watch-label')?.addEventListener('click', () => router.go(`/movie/${m.tmdbId}/watch`));
  $('hero-info-btn')?.addEventListener('click', () => router.go(`/movie/${m.tmdbId}`));
  $('hero-list-btn')?.addEventListener('click', () => {
    const added = listToggle(m);
    toast(added ? 'Added to My List' : 'Removed from My List', 'success');
    renderHeroContent(m);
  });
}

async function initHomeRows() {
  const wrap = $('home-rows'); if (!wrap) return;
  wrap.innerHTML = '';

  const addRow = (title, href, movies) => {
    if (!movies?.length) return;
    const sec = document.createElement('div');
    sec.className = 'row-sec';
    sec.innerHTML = `
      <div class="row-hdr">
        <div class="row-ttl">${title}</div>
        <a href="${href}" class="row-all">View all <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></a>
      </div>
      <div class="movie-row">${movies.map(cardHTML).join('')}</div>`;
    wrap.appendChild(sec);
    wireCards(sec);
  };

  // Continue watching
  const cw = cwGet();
  if (cw.length) {
    const sec = document.createElement('div');
    sec.className = 'row-sec';
    sec.innerHTML = `
      <div class="row-hdr">
        <div><div class="row-ttl">Continue <span>Watching</span></div><div class="row-sub">${cw.length} in progress</div></div>
        <button id="cw-clear-btn" class="row-all">Clear all</button>
      </div>
      <div class="movie-row">${cw.map(cwCardHTML).join('')}</div>`;
    wrap.appendChild(sec);
    wireCards(sec);
    $('cw-clear-btn')?.addEventListener('click', () => { cwClear(); sec.remove(); });
  }

  try {
    const [trending, topRated, popularTV] = await Promise.all([
      API.trending(1), API.topRated(1), API.popularTV(1),
    ]);
    addRow('Trending <span>Now</span>', '/movies', trending.results?.slice(0,14));
    addRow('Top Rated <span>Movies</span>', '/movies', topRated.results?.slice(0,14));
    addRow('Popular <span>TV Shows</span>', '/series', popularTV.results?.slice(0,14));
  } catch (e) { console.error('Home rows error', e); }
}

function initSafeBanner() {
  const prefs = prefsGet();
  const banner = $('safe-banner');
  if (!banner) return;
  if (prefs.hideSafeBanner) { banner.style.display = 'none'; return; }
  $('safe-close')?.addEventListener('click', () => {
    banner.style.display = 'none';
    prefsSave({ hideSafeBanner: true });
  });
}

/* ══════════════════════════════════════════════════════
   GRID (movies / series)
   ══════════════════════════════════════════════════════ */
async function showGrid(type) {
  showView('view-grid');
  document.title = type === 'series' ? '4Reels — Series' : '4Reels — Movies';
  $('grid-title').textContent = type === 'series' ? 'Series' : 'Movies';
  $('grid-sub').textContent   = '';
  $('grid-back').style.display = 'none';
  $('grid-filters').style.display = '';
  
  await loadGrid(type, 1);
  initGridFilters(type);
}

async function loadGrid(type, page) {
  const grid = $('grid-movies'); 
  if (!grid) return;

  // Show skeleton
  grid.innerHTML = Array(12).fill(`
    <div class="mc">
      <div class="mc-poster skel" style="aspect-ratio:2/3"></div>
      <div class="mc-info">
        <div class="skel" style="height:12px;margin-bottom:6px;border-radius:3px"></div>
        <div class="skel" style="height:10px;width:60%;border-radius:3px"></div>
      </div>
    </div>
  `).join('');

  try {
    const sort   = $('sort-sel')?.value   || 'popular';
    const genre  = $('genre-sel')?.value  || '';
    const rating = $('rating-sel')?.value || '';
    
    const data = await API.discover(page, genre, sort, rating, type);
    
    if (data.results && data.results.length > 0) {
      grid.innerHTML = (data.results || []).map(cardHTML).join('');
    } else {
      grid.innerHTML = `<div style="padding:60px 20px;text-align:center;color:rgba(255,255,255,.3);grid-column:1/-1">
        No results found.
      </div>`;
    }
    
    wireCards(grid);
    buildPagination(data.page || 1, data.totalPages || 1, p => loadGrid(type, p));
  } catch (e) {
    console.error('Grid load error:', e);
    grid.innerHTML = `<div style="padding:60px;text-align:center;color:rgba(255,255,255,.3);grid-column:1/-1">
      Could not load content. Please try again later.
    </div>`;
  }
}


function initGridFilters(type) {
  const sorts   = [['popular','Most Popular'],['top-rated','Top Rated'],['trending','Trending']];
  const sortSel = $('sort-sel');
  if (sortSel) { sortSel.innerHTML = sorts.map(([v,l]) => `<option value="${v}">${l}</option>`).join(''); }

  const genreSel = $('genre-sel');
  if (genreSel) {
    const genreApi = type === 'series' ? API.genresTV : API.genres;
    genreApi().then(d => {
      genreSel.innerHTML = '<option value="">All Genres</option>' +
        (d.genres||[]).map(g => `<option value="${g.id}">${g.name}</option>`).join('');
    }).catch(() => {});
  }

  [$('sort-sel'), $('genre-sel'), $('rating-sel')].forEach(el =>
    el?.addEventListener('change', () => loadGrid(type, 1))
  );
}

/* ══════════════════════════════════════════════════════
   GENRES
   ══════════════════════════════════════════════════════ */
const GENRE_META = {
  28:{icon:'💥',color:'#b34'},35:{icon:'😂',color:'#473'},878:{icon:'🚀',color:'#345'},
  27:{icon:'👻',color:'#434'},10749:{icon:'💕',color:'#845'},12:{icon:'🗺️',color:'#453'},
  80:{icon:'🔫',color:'#333'},18:{icon:'🎭',color:'#555'},16:{icon:'✏️',color:'#457'},
  99:{icon:'📽️',color:'#345'},9648:{icon:'🔍',color:'#554'},10752:{icon:'⚔️',color:'#433'},
  37:{icon:'🤠',color:'#543'},53:{icon:'😱',color:'#334'},14:{icon:'🧙',color:'#436'},
};

async function showGenres() {
  showView('view-genres');
  document.title = '4Reels — Genres';
  const grid = $('genres-grid'); if (!grid) return;
  try {
    const [movies, tv] = await Promise.all([API.genres(), API.genresTV()]);
    const all = [...(movies.genres||[])];
    (tv.genres||[]).forEach(g => { if (!all.find(m => m.id === g.id)) all.push(g); });
    grid.innerHTML = all.map(g => {
      const meta = GENRE_META[g.id] || { icon: '🎬', color: '#333' };
      return `<div class="genre-card" data-id="${g.id}" data-name="${esc(g.name)}">
        <div class="genre-bg" style="background:rgba(255,255,255,.03)"></div>
        <div class="genre-ov"><span class="genre-icon">${meta.icon}</span><span class="genre-name">${esc(g.name)}</span></div>
      </div>`;
    }).join('');
    grid.querySelectorAll('.genre-card').forEach(el =>
      el.addEventListener('click', () => router.go(`/genre/${el.dataset.id}`))
    );
  } catch { grid.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,.3)">Could not load genres.</div>'; }
}

async function showGenrePage(genreId) {
  showView('view-grid');
  $('grid-title').innerHTML = 'Genre <span>Movies</span>';
  $('grid-sub').textContent = '';
  $('grid-back').style.display = '';
  $('grid-filters').style.display = 'none';
  $('grid-back').onclick = () => router.go('/genres');
  try {
    const data = await API.byGenre(genreId, 1);
    if (data.genre) $('grid-title').innerHTML = `${esc(data.genre)} <span>Movies</span>`;
    const grid = $('grid-movies');
    grid.innerHTML = (data.results||[]).map(cardHTML).join('');
    wireCards(grid);
    buildPagination(data.page, data.totalPages, p => {
      API.byGenre(genreId, p).then(d => {
        grid.innerHTML = (d.results||[]).map(cardHTML).join('');
        wireCards(grid); window.scrollTo(0,0);
      });
    });
  } catch { $('grid-movies').innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,.3)">Could not load genre.</div>'; }
}

/* ══════════════════════════════════════════════════════
   MY LIST
   ══════════════════════════════════════════════════════ */
function showMyList() {
  showView('view-my-list');
  document.title = '4Reels — My List';
  const list = listGet();
  const grid = $('mylist-grid');
  const sub  = $('mylist-sub');
  const clrBtn = $('mylist-clear');
  if (!grid) return;

  if (sub) sub.textContent = list.length ? `${list.length} saved title${list.length !== 1 ? 's' : ''}` : '';

  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:60px 20px;text-align:center;color:rgba(255,255,255,.22)">
      <div style="font-size:2rem;margin-bottom:12px">📋</div>
      <div style="font-family:Inter,sans-serif;font-size:.92rem;font-weight:500;margin-bottom:6px">Your list is empty</div>
      <div style="font-size:.8rem">Save movies and shows to watch later.</div>
    </div>`;
    if (clrBtn) clrBtn.style.display = 'none';
    return;
  }

  grid.innerHTML = list.map(cardHTML).join('');
  wireCards(grid);
  if (clrBtn) {
    clrBtn.style.display = '';
    clrBtn.onclick = () => { LS.remove('4reels_list'); showMyList(); };
  }
}

/* ══════════════════════════════════════════════════════
   SEARCH
   ══════════════════════════════════════════════════════ */
function initSearch() {
  const btn    = $('sb-search-btn-2') || $('sb-search-btn');
  const panel  = $('sb-search-panel');
  const inp    = $('search-input');
  const drop   = $('search-drop');
  const closeBtn = $('search-close');

  if (!btn || !panel) return;

  btn.addEventListener('click', () => {
    const isOpen = panel.style.display === 'flex';
    panel.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) setTimeout(() => inp?.focus(), 80);
  });

  closeBtn?.addEventListener('click', () => { 
    panel.style.display = 'none'; 
  });

  // Close when clicking anywhere outside
  document.addEventListener('click', e => {
    if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      panel.style.display = 'none';
    }
  });

  let debounce;
  inp?.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = inp.value.trim();
    if (!q) { 
      drop.innerHTML = ''; 
      return; 
    }
    drop.innerHTML = '<div style="padding:16px;color:rgba(255,255,255,.3);font-size:.8rem;text-align:center">Searching…</div>';
    
    debounce = setTimeout(async () => {
      try {
        const data = await API.search(q);
        const results = data.results || [];
        if (!results.length) { 
          drop.innerHTML = '<div style="padding:16px;color:rgba(255,255,255,.3);font-size:.8rem;text-align:center">No results</div>'; 
          return; 
        }
        drop.innerHTML = results.slice(0, 10).map(m => `
          <div class="search-item" data-id="${esc(m.tmdbId||m.id)}" style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05);transition:background .12s">
            <div style="width:32px;height:48px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,.06);flex-shrink:0">
              ${m.poster ? `<img src="${esc(m.poster)}" style="width:100%;height:100%;object-fit:cover" loading="lazy"/>` : ''}
            </div>
            <div>
              <div style="font-family:Inter,sans-serif;font-size:.82rem;font-weight:500;color:rgba(255,255,255,.8)">${esc(m.title)}</div>
              <div style="font-size:.7rem;color:rgba(255,255,255,.3);margin-top:2px">${esc(m.year||'')} · ${m.mediaType==='tv'?'Series':'Movie'}</div>
            </div>
          </div>`).join('');
        
        drop.querySelectorAll('.search-item').forEach(el => {
          el.addEventListener('mouseenter', () => el.style.background = 'rgba(255,255,255,.04)');
          el.addEventListener('mouseleave', () => el.style.background = '');
          el.addEventListener('click', () => {
            router.go(`/movie/${el.dataset.id}`);
            panel.style.display = 'none';
            inp.value = '';
          });
        });
      } catch { 
        drop.innerHTML = ''; 
      }
    }, 320);
  });

  // Mobile search toggle
  $('search-toggle')?.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
    if (panel.style.display === 'flex') setTimeout(() => inp?.focus(), 80);
  });
}

async function showSearch(q) {
  showView('view-grid');
  document.title = `Search: ${q} — 4Reels`;
  $('grid-title').textContent = `"${q}"`;
  $('grid-sub').textContent   = 'Search results';
  $('grid-back').style.display = '';
  $('grid-filters').style.display = 'none';
  $('grid-back').onclick = () => history.back();
  const grid = $('grid-movies');
  try {
    const data = await API.search(q);
    grid.innerHTML = (data.results||[]).map(cardHTML).join('') ||
      '<div style="padding:40px;text-align:center;color:rgba(255,255,255,.3)">No results found.</div>';
    wireCards(grid);
  } catch { grid.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,.3)">Search failed.</div>'; }
}

/* ══════════════════════════════════════════════════════
   MOVIE DETAIL
   ══════════════════════════════════════════════════════ */
async function showMovieDetail(id) {
  showView('view-movie');
  $('movie-loader').style.display  = 'flex';
  $('movie-detail-content').style.display = 'none';
  try {
    const m = await API.details(id);
    document.title = `${m.title} — 4Reels`;
    const inList = listHas(m.tmdbId);
    const content = $('movie-detail-content');
    content.innerHTML = `
      <div class="md-backdrop">
        <div class="md-backdrop-img" style="background-image:url('${esc(m.backdrop||m.poster||'')}')"></div>
        <div class="md-backdrop-grad"></div>
      </div>
      <div class="md-body">
        <div class="md-top">
          <div class="md-poster-wrap">
            <img class="md-poster" src="${esc(m.poster||'')}" alt="${esc(m.title)}" onerror="this.src=''"/>
          </div>
          <div class="md-info">
            ${m.cert ? `<span class="md-cert">${esc(m.cert)}</span>` : ''}
            <h1 class="md-title">${esc(m.title)}</h1>
            ${m.tagline ? `<p class="md-tagline">${esc(m.tagline)}</p>` : ''}
            <div class="md-stats">
              ${m.rating ? `<span class="md-rat">★ ${Number(m.rating).toFixed(1)}</span><span class="sdot"></span>` : ''}
              ${m.year   ? `<span>${esc(m.year)}</span><span class="sdot"></span>` : ''}
              ${m.runtime? `<span>${esc(m.runtime)}</span>` : ''}
            </div>
            <div class="md-genres">${(m.genres||[]).map(g=>`<span class="md-pill">${esc(g)}</span>`).join('')}</div>
            ${m.overview ? `<p class="md-overview">${esc(m.overview)}</p>` : ''}
            ${m.director ? `<p class="md-crew"><strong>Director</strong> ${esc(m.director)}</p>` : ''}
            <div class="md-actions">
              <button class="btn-pri" id="md-watch-btn">▶ Watch Now</button>
              <button class="btn-mylist${inList?' in-list':''}" id="md-list-btn">
                ${inList ? '✓ In My List' : '+ My List'}
              </button>
            </div>
          </div>
        </div>
        ${m.cast?.length ? `
          <div class="md-section">
            <div class="md-section-ttl">Cast</div>
            <div class="cast-row">
              ${m.cast.slice(0,12).map(c=>`
                <div class="cast-card">
                  <img class="cast-img" src="${esc(c.profile||'')}" alt="${esc(c.name)}" onerror="this.src=''"/>
                  <div class="cast-name">${esc(c.name)}</div>
                  <div class="cast-char">${esc(c.character||'')}</div>
                </div>`).join('')}
            </div>
          </div>` : ''}
        ${m.similar?.length ? `
          <div class="md-section">
            <div class="md-section-ttl">More Like This</div>
            <div class="sim-row">${m.similar.slice(0,10).map(cardHTML).join('')}</div>
          </div>` : ''}
      </div>`;

    $('movie-loader').style.display  = 'none';
    content.style.display            = '';

    $('md-watch-btn')?.addEventListener('click', () => router.go(`/movie/${m.tmdbId}/watch`));
    $('md-list-btn')?.addEventListener('click', () => {
      const added = listToggle(m);
      const btn   = $('md-list-btn');
      if (btn) {
        btn.textContent = added ? '✓ In My List' : '+ My List';
        btn.classList.toggle('in-list', added);
      }
      toast(added ? 'Added to My List' : 'Removed', 'success');
    });
    wireCards(content);
  } catch (e) {
    $('movie-loader').style.display = 'none';
    $('movie-detail-content').style.display = '';
    $('movie-detail-content').innerHTML = `<div style="padding:80px;text-align:center;color:rgba(255,255,255,.3)">${esc(e.message)}</div>`;
  }
}

/* ══════════════════════════════════════════════════════
   WATCH PAGE
   ══════════════════════════════════════════════════════ */
async function showWatch(id) {
  showView('view-watch');

  const playerWrap = $('watch-player-wrap');
  const infoEl     = $('watch-info');
  const sidebarEl  = $('watch-sidebar');

  if (!playerWrap) return;

  // Init player immediately — no server bar
  playerWrap.innerHTML = '';
  if (window["4reelsPlayer"]) new window["4reelsPlayer"]('watch-player-wrap', id);

  // Fetch metadata async
  try {
    const m = await API.details(id);
    document.title = `${m.title} — Watch — 4Reels`;
    cwAdd(m);


    // Movie info
    if (infoEl) {
      infoEl.innerHTML = `
        <h2 class="watch-title">${esc(m.title)}</h2>
        <div class="watch-meta">
          ${m.rating  ? `<span style="color:var(--warn);font-weight:600">★ ${Number(m.rating).toFixed(1)}</span><span style="width:2px;height:2px;background:rgba(255,255,255,.2);border-radius:50%;display:inline-block"></span>` : ''}
          ${m.year    ? `<span>${esc(m.year)}</span>` : ''}
          ${m.runtime ? `<span>${esc(m.runtime)}</span>` : ''}
          ${m.cert    ? `<span style="border:1px solid rgba(255,255,255,.1);padding:1px 5px;border-radius:3px;font-size:.62rem">${esc(m.cert)}</span>` : ''}
        </div>
        <div class="watch-genres">${(m.genres||[]).map(g=>`<span class="wpill">${esc(g)}</span>`).join('')}</div>
        ${m.overview ? `<p class="watch-overview">${esc(m.overview)}</p>` : ''}
        ${m.director ? `<p class="watch-crew"><strong>Director</strong> ${esc(m.director)}</p>` : ''}

        ${m.cast?.length ? `
        <div class="watch-cast">
          <div class="watch-cast-title">Cast</div>
          <div class="watch-cast-row">
            ${m.cast.slice(0,12).map(c => `
              <div class="watch-cast-card">
                <img 
                  class="watch-cast-img"
                  src="${esc(c.profile||'')}"
                  alt="${esc(c.name)}"
                  loading="lazy"
                  onerror="this.src=''">
                <div class="watch-cast-name">${esc(c.name)}</div>
                <div class="watch-cast-char">${esc(c.character||'')}</div>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}`;
    }

    // Sidebar
    if (sidebarEl && m.similar?.length) {
      sidebarEl.innerHTML = `
        <div class="sidebar-ttl">More Like This</div>
        ${m.similar.slice(0,6).map(s=>`
          <div class="sidebar-card" data-id="${esc(s.tmdbId||s.id)}">
            <img class="sb-poster" src="${esc(s.poster||'')}" alt="${esc(s.title)}" onerror="this.src=''"/>
            <div class="sb-info">
              <div class="sb-title">${esc(s.title)}</div>
              <div class="sb-meta">${esc(s.year||'')} · <span class="sb-rat">★ ${s.rating?.toFixed?.(1)||'—'}</span></div>
            </div>
          </div>`).join('')}`;
      sidebarEl.querySelectorAll('.sidebar-card').forEach(el =>
        el.addEventListener('click', () => router.go(`/movie/${el.dataset.id}/watch`))
      );
    }
  } catch (e) { console.error('Watch detail error', e); }
}

async function showSparks() {
  showView('view-grid');
  document.title = '4Reels — Sparks';
  const titleEl = $('grid-title'); if(titleEl) titleEl.innerHTML = '⚡ Sparks';
  const subEl = $('grid-sub'); if(subEl) subEl.textContent = 'Hottest trending right now';
  const backEl = $('grid-back'); if(backEl) backEl.style.display = 'none';
  const filEl = $('grid-filters'); if(filEl) filEl.style.display = 'none';
  const grid = $('grid-movies'); if(!grid) return;
  grid.innerHTML = Array(12).fill('<div class="mc"><div class="mc-poster skel" style="aspect-ratio:2/3"></div><div class="mc-info"><div class="skel" style="height:12px;margin-bottom:6px;border-radius:3px"></div></div></div>').join('');
  try {
    const data = await API.trending(1);
    grid.innerHTML = (data.results || []).map(cardHTML).join('');
    wireCards(grid);
    buildPagination(data.page, data.totalPages, async p => {
      const d = await API.trending(p);
      grid.innerHTML = (d.results||[]).map(cardHTML).join('');
      wireCards(grid); window.scrollTo(0,0);
    });
  } catch {
    grid.innerHTML = '<div style="padding:60px;text-align:center;color:rgba(255,255,255,.3)">Could not load trending.</div>';
  }
}

/* ══════════════════════════════════════════════════════
   CONTINUE WATCHING — dedicated page
   ══════════════════════════════════════════════════════ */
function showContinueWatching() {
  showView('view-grid');
  document.title = '4Reels — Continue Watching';
  const titleEl = $('grid-title'); if(titleEl) titleEl.textContent = 'Continue Watching';
  const subEl = $('grid-sub'); if(subEl) subEl.textContent = 'Pick up where you left off';
  const backEl = $('grid-back'); if(backEl) backEl.style.display = 'none';
  const filEl = $('grid-filters'); if(filEl) filEl.style.display = 'none';
  const pag = $('grid-pag'); if(pag) pag.innerHTML = '';
  const grid = $('grid-movies'); if(!grid) return;
  const cw = cwGet();
  if (!cw.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:60px 20px;text-align:center;color:rgba(255,255,255,.22)"><div style="font-size:2rem;margin-bottom:12px">⏱️</div><div style="font-family:Inter,sans-serif;font-size:.92rem;font-weight:500;margin-bottom:6px;color:rgba(255,255,255,.4)">Nothing in progress yet</div><div style="font-size:.8rem">Start watching and it will appear here.</div></div>';
    return;
  }
  // Render cw cards inside the grid
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px;padding:0 28px;max-width:var(--max)';
  wrap.innerHTML = cw.map(cwCardHTML).join('');
  grid.innerHTML = '';
  grid.appendChild(wrap);
  wireCards(wrap);
}

/* ══════════════════════════════════════════════════════
   PROFILE
   ══════════════════════════════════════════════════════ */
function showProfile() {
  const u = Auth.get();
  if (!u) { Auth.openModal('login'); return; }
  showView('view-profile');
  document.title = 'Profile — 4Reels';

  // Fill in current values
  const el = id => $(id);
  if (el('profile-display-name')) el('profile-display-name').textContent = u.displayName || u.username;
  if (el('profile-handle'))       el('profile-handle').textContent       = `@${u.username} · Member since ${new Date(u.createdAt||Date.now()).getFullYear()}`;
  if (el('input-display-name'))   el('input-display-name').value          = u.displayName || '';
  if (el('input-bio'))            el('input-bio').value                   = u.bio || '';
  if (el('stat-watched'))         el('stat-watched').textContent          = cwGet().length;
  if (el('stat-list'))            el('stat-list').textContent             = listGet().length;
  if (el('stat-hours'))           el('stat-hours').textContent            = Math.floor(cwGet().length * 1.8);

  // Avatar
  if (el('profile-avatar-initials-big'))
    el('profile-avatar-initials-big').textContent = (u.displayName||u.username||'?').slice(0,2).toUpperCase();

  // Prefs
  const prefs = prefsGet();
  if (el('toggle-show-ratings'))  el('toggle-show-ratings').checked    = prefs.showRatings !== false;
  if (el('toggle-remember-pos'))  el('toggle-remember-pos').checked    = prefs.rememberPos !== false;
  if (el('toggle-track-history')) el('toggle-track-history').checked   = prefs.trackHistory !== false;
  if (el('toggle-safe-banner'))   el('toggle-safe-banner').checked     = !prefs.hideSafeBanner;
  if (el('sel-default-server'))   el('sel-default-server').value       = prefs.defaultServer || '0';
  if (el('sel-language'))         el('sel-language').value             = prefs.language || 'en';

  // Profile tabs
  document.querySelectorAll('.profile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.profile-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      $('tab-' + tab.dataset.tab)?.classList.add('active');
    });
  });

  // Save display name
  el('save-display-name')?.addEventListener('click', async () => {
    const name = el('input-display-name').value.trim();
    if (!name) return;
    try {
      await Auth.authReq('/me', 'PATCH', { displayName: name });
      const u2 = Auth.get(); if (u2) { u2.displayName = name; localStorage.setItem('4reels_user', JSON.stringify(u2)); }
      Auth.updateSidebar(); toast('Name updated ✓', 'success');
    } catch (e) { toast(e.message, 'err'); }
  });

  // Save bio
  el('save-bio')?.addEventListener('click', async () => {
    try {
      await Auth.authReq('/me', 'PATCH', { bio: el('input-bio').value.trim() });
      toast('Bio saved ✓', 'success');
    } catch (e) { toast(e.message, 'err'); }
  });

  // Avatar colour swatches
  document.querySelectorAll('.color-swatch').forEach(sw => {
    if (u.avatarColor === sw.dataset.color) sw.classList.add('active');
    sw.addEventListener('click', async () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      try {
        await Auth.authReq('/me', 'PATCH', { avatarColor: sw.dataset.color });
        toast('Colour saved ✓', 'success');
      } catch {}
    });
  });

  // Avatar upload
  el('profile-avatar-btn')?.addEventListener('click', () => el('avatar-upload')?.click());
  el('profile-avatar-edit')?.addEventListener('click', () => el('avatar-upload')?.click());
  el('avatar-upload')?.addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        await Auth.authReq('/me', 'PATCH', { avatarBase64: ev.target.result });
        const u2 = Auth.get(); if (u2) { u2.avatarBase64 = ev.target.result; localStorage.setItem('4reels_user', JSON.stringify(u2)); }
        Auth.updateSidebar(); toast('Avatar updated ✓', 'success');
      } catch (e) { toast(e.message, 'err'); }
    };
    reader.readAsDataURL(file);
  });

  // Toggles & selects → save to prefs
  el('toggle-show-ratings')?.addEventListener('change',  e => prefsSave({ showRatings:  e.target.checked }));
  el('toggle-remember-pos')?.addEventListener('change',  e => prefsSave({ rememberPos:  e.target.checked }));
  el('toggle-track-history')?.addEventListener('change', e => prefsSave({ trackHistory: e.target.checked }));
  el('toggle-safe-banner')?.addEventListener('change',   e => {
    prefsSave({ hideSafeBanner: !e.target.checked });
    const b = $('safe-banner'); if (b) b.style.display = e.target.checked ? '' : 'none';
  });
  el('sel-default-server')?.addEventListener('change', e => prefsSave({ defaultServer: +e.target.value }));
  el('sel-language')?.addEventListener('change', e => prefsSave({ language: e.target.value }));

  // Clear buttons
  el('clear-cw-btn')?.addEventListener('click',   () => { cwClear();                toast('Watch history cleared', 'success'); });
  el('clear-list-btn')?.addEventListener('click', () => { LS.remove('4reels_list'); toast('List cleared', 'success'); });
  el('reset-all-btn')?.addEventListener('click', () => {
    if (!confirm('Reset everything? This cannot be undone.')) return;
    cwClear(); LS.remove('4reels_list'); LS.remove('4reels_prefs');
    toast('All data reset', 'success');
  });
}

/* ══════════════════════════════════════════════════════
   PAGINATION
   ══════════════════════════════════════════════════════ */
function buildPagination(cur, total, onPage) {
  const el = $('grid-pag'); 
  if (!el) return;
  if (!total || total <= 1) { 
    el.innerHTML = ''; 
    return; 
  }

  const pages = Math.min(total, 500);
  let html = `<button class="pg-btn" ${cur<=1?'disabled':''} id="pg-prev">‹</button>`;

  // First page
  html += `<button class="pg-btn${cur===1?' act':''}" data-p="1">1</button>`;
  
  if (cur > 3) html += `<span class="pg-btn ell">…</span>`;
  
  for (let i = Math.max(2, cur-1); i <= Math.min(pages-1, cur+1); i++) {
    html += `<button class="pg-btn${i===cur?' act':''}" data-p="${i}">${i}</button>`;
  }
  
  if (cur < pages-2) html += `<span class="pg-btn ell">…</span>`;
  if (pages > 1) html += `<button class="pg-btn${cur===pages?' act':''}" data-p="${pages}">${pages}</button>`;

  html += `<button class="pg-btn" ${cur>=pages?'disabled':''} id="pg-next">›</button>`;

  el.innerHTML = html;

  $('pg-prev')?.addEventListener('click', () => { if (cur>1) onPage(cur-1); });
  $('pg-next')?.addEventListener('click', () => { if (cur<pages) onPage(cur+1); });

  el.querySelectorAll('[data-p]').forEach(b => {
    b.addEventListener('click', () => {
      onPage(+b.dataset.p);
      window.scrollTo(0,0);
    });
  });
}

/* ══════════════════════════════════════════════════════
   SIDEBAR WIRING
   ══════════════════════════════════════════════════════ */
function initSidebar() {
  // Profile / avatar click
  $('nav-avatar')?.addEventListener('click', () => {
    if (Auth.get()) router.go('/profile');
    else Auth.openModal('login');
  });

  // Discord link
  fetch('/api/health').then(r=>r.json()).then(d=>{
    if (d.discordUrl) {
      const btn = $('nav-discord');
      if (btn) btn.href = d.discordUrl;
    }
  }).catch(()=>{});

  // Hamburger (mobile)
  $('hamburger')?.addEventListener('click', () => {
    const open = $('mob-nav').classList.toggle('open');
    $('hamburger').classList.toggle('open', open);
  });
}

/* ══════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════ */
async function boot() {
  const lb = $('lb');
  if (lb) {
    lb.style.width = '40%';
    await sleep(200);
    lb.style.width = '80%';
  }

  try {
    const health = await fetch('/api/health').then(r => r.json());
    if (!health.hasKey) { 
      location.href = '/setup'; 
      return; 
    }
  } catch (e) {
    console.warn('Health check failed', e);
  }

  initSidebar();
  initSearch();
  Auth.updateSidebar();

  if (lb) lb.style.width = '100%';
  await sleep(250);
  const ls = $('loading-screen');
  if (ls) { 
    ls.classList.add('hide'); 
    setTimeout(() => ls.remove(), 300); 
  }

  // Force home load
  router.handle(location.pathname + location.search);
}

document.addEventListener('DOMContentLoaded', boot);
