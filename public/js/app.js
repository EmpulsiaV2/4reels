/* 4reels v3 — SPA Frontend */
'use strict';

const $  = id  => document.getElementById(id);
const qq = sel => [...document.querySelectorAll(sel)];
const esc = s  => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function fmtRating(r){ const n=Number(r); return(!r||isNaN(n)||n<=0||n>10)?'N/A':n.toFixed(1); }
function fmtRuntime(m){ if(!m) return ''; const h=Math.floor(m/60),mi=m%60; return h?`${h}h ${mi}m`:`${mi}m`; }

// ── State ──────────────────────────────────────────────
const S = { allGenres:[], heroMovies:[], heroIdx:0, heroTimer:null, moviesSortBy:'popular', moviesGenreId:'' };

// ── API ────────────────────────────────────────────────
const API = {
  async get(path, params={}){
    const url=new URL('/api'+path,location.origin);
    Object.entries(params).forEach(([k,v])=>{ if(v!=null&&v!=='') url.searchParams.set(k,v); });
    const r=await fetch(url);
    if(!r.ok){ const e=await r.json().catch(()=>({})); throw new Error(e.error||`HTTP ${r.status}`); }
    return r.json();
  },
  home:       ()       => API.get('/home'),
  trending:   (p=1)    => API.get('/trending',            {page:p}),
  popular:    (p=1)    => API.get('/movies/popular',      {page:p}),
  topRated:   (p=1)    => API.get('/movies/top-rated',    {page:p}),
  nowPlaying: (p=1)    => API.get('/movies/now-playing',  {page:p}),
  byGenre:    (id,p=1) => API.get(`/movies/genre/${id}`,  {page:p}),
  details:    (id)     => API.get(`/movies/${id}`),
  search:     (q,p=1)  => API.get('/search',              {q,page:p}),
  genres:     ()       => API.get('/genres'),
};

const GCOL = {
  28:'#1a1a2e,#0f3460',12:'#0d2137,#0d5c63',16:'#1f0a35,#6b2fa0',
  35:'#1a2a1a,#3d6b3d',80:'#1a0a0a,#6b1f1f',99:'#1a1510,#6b5530',
  18:'#0a1a2e,#1a4780',14:'#1e0a3d,#6b35b0',36:'#2e1a0a,#8c5a20',
  27:'#0a0a1a,#1e1e4d',9648:'#1a1020,#4d2a6b',10749:'#2e0a1a,#8c2050',
  878:'#050e2e,#0f3090',53:'#1a0a10,#6b1f3a',10752:'#1a1510,#6b5020',37:'#2e1a0a,#8c6030',
};

// ── Loading bar ────────────────────────────────────────
const setLB  = p => { const b=$('lb'); if(b) b.style.width=p+'%'; };
const hideLB = () => { const s=$('loading-screen'); if(!s) return; s.classList.add('hide'); setTimeout(()=>s.remove(),400); };

// ── Toast ──────────────────────────────────────────────
function toast(msg, type='', ms=3000){
  const t=document.createElement('div');
  t.className='toast'+(type?' '+type:'');
  t.textContent=msg;
  $('toast-wrap').appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .25s'; setTimeout(()=>t.remove(),260); },ms);
}

// ── Skeleton card ──────────────────────────────────────
function skelCard(){
  const c=document.createElement('div'); c.className='mc';
  c.innerHTML=`<div style="aspect-ratio:2/3;border-radius:var(--r4) var(--r4) 0 0" class="skel"></div>
    <div style="padding:8px"><div class="skel" style="height:10px;border-radius:2px;margin-bottom:5px"></div>
    <div class="skel" style="height:9px;width:50%;border-radius:2px"></div></div>`;
  return c;
}

// ── Movie card ─────────────────────────────────────────
function makeCard(movie, inRow=false){
  const c=document.createElement('div'); c.className='mc';
  if(inRow){ c.style.width='132px'; c.style.flexShrink='0'; }
  const poster=movie.poster
    ?`<img src="${esc(movie.poster)}" alt="${esc(movie.title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    :'';
  c.innerHTML=`
    <div class="mc-poster">
      ${poster}
      <div class="mc-fb" style="display:${movie.poster?'none':'flex'}">🎬</div>
      <div class="mc-ov"><div class="mc-play"><svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div></div>
      <div class="mc-qtag">HD</div>
    </div>
    <div class="mc-info">
      <div class="mc-title">${esc(movie.title)}</div>
      <div class="mc-foot">
        <span class="mc-year">${esc(movie.year||'')}</span>
        <span class="mc-rat">★ ${esc(fmtRating(movie.rating))}</span>
      </div>
    </div>`;
  c.addEventListener('click',()=>router.go(`/movie/${movie.tmdbId||movie.id}`));
  return c;
}

// ── Row section ────────────────────────────────────────
function makeRow({title,span,sub,movies,onSeeAll}){
  const sec=document.createElement('div'); sec.className='row-sec';
  sec.innerHTML=`
    <div class="row-hdr">
      <div>
        <div class="row-ttl">${esc(title)} <span>${esc(span||'')}</span></div>
        ${sub?`<div class="row-sub">${esc(sub)}</div>`:''}
      </div>
      <a href="#" class="row-all">View all →</a>
    </div>
    <div class="movie-row"></div>`;
  const row=sec.querySelector('.movie-row');
  (movies||[]).forEach(m=>row.appendChild(makeCard(m,true)));
  sec.querySelector('.row-all').addEventListener('click',e=>{ e.preventDefault(); if(onSeeAll) onSeeAll(); });
  return sec;
}

// ── Feature strip carousel (replaces full-bleed hero) ──
function initHero(movies){
  if(!movies?.length) return;
  S.heroMovies=movies.slice(0,8);
  const slidesEl=$('hero-slides'), dotsEl=$('hero-dots'), contentEl=$('hero-content');
  if(!slidesEl||!dotsEl||!contentEl) return;
  slidesEl.innerHTML=''; dotsEl.innerHTML='';

  S.heroMovies.forEach((m,i)=>{
    const slide=document.createElement('div');
    slide.className='fs-slide'+(i===0?' active':'');
    if(m.backdrop) slide.style.backgroundImage=`url(${m.backdrop})`;
    slidesEl.appendChild(slide);

    const dot=document.createElement('button');
    dot.className='hero-dot-btn'+(i===0?' active':'');
    dot.addEventListener('click',()=>goHeroSlide(i));
    dotsEl.appendChild(dot);
  });

  renderHeroContent(0);
  $('hero-prev')?.addEventListener('click',()=>goHeroSlide((S.heroIdx-1+S.heroMovies.length)%S.heroMovies.length));
  $('hero-next')?.addEventListener('click',()=>goHeroSlide((S.heroIdx+1)%S.heroMovies.length));
  clearInterval(S.heroTimer);
  S.heroTimer=setInterval(()=>goHeroSlide((S.heroIdx+1)%S.heroMovies.length),7000);
}

function goHeroSlide(idx){
  clearInterval(S.heroTimer);
  S.heroIdx=idx;
  qq('.fs-slide').forEach((s,i)=>s.classList.toggle('active',i===idx));
  qq('.hero-dot-btn').forEach((d,i)=>d.classList.toggle('active',i===idx));
  renderHeroContent(idx);
  S.heroTimer=setInterval(()=>goHeroSlide((S.heroIdx+1)%S.heroMovies.length),7000);
}

function renderHeroContent(idx){
  const m=S.heroMovies[idx]; if(!m) return;
  const el=$('hero-content'); if(!el) return;
  const rating=fmtRating(m.rating);
  el.innerHTML=`
    <div class="fs-eyebrow"><span class="fs-eyebrow-dot"></span>Now Streaming</div>
    <h2 class="fs-title">${esc(m.title)}</h2>
    <div class="fs-meta">
      ${rating!=='N/A'?`<span class="fs-rating">★ ${esc(rating)}</span><span class="fs-dot"></span>`:''}
      ${m.year?`<span>${esc(m.year)}</span>`:''}
      ${(m.genres||[]).slice(0,2).map(g=>`<span class="fs-pill">${esc(g)}</span>`).join('')}
    </div>
    <div class="fs-btns">
      <button class="btn-pri js-hero-watch">▶ Watch</button>
      <button class="btn-gho js-hero-info">Info</button>
    </div>`;
  el.querySelector('.js-hero-watch')?.addEventListener('click',()=>router.go(`/movie/${m.tmdbId||m.id}/watch`));
  el.querySelector('.js-hero-info')?.addEventListener('click',()=>router.go(`/movie/${m.tmdbId||m.id}`));
}

// ── View switch ────────────────────────────────────────
function showView(id){
  qq('.view').forEach(v=>{ v.style.display='none'; v.style.animation=''; });
  const v=$(id);
  if(v){ v.style.display='block'; void v.offsetWidth; v.style.animation='fadeIn .18s ease'; }
}

// ── Safe banner ────────────────────────────────────────
function initSafeBanner(){
  if(localStorage.getItem('4reels-safe-dismissed')){
    const b=$('safe-banner'); if(b) b.style.display='none'; return;
  }
  $('safe-close')?.addEventListener('click',()=>{
    const b=$('safe-banner'); if(b) b.style.display='none';
    localStorage.setItem('4reels-safe-dismissed','1');
  });
}

// ── Genre select populate ──────────────────────────────
function populateGenreSel(genres){
  const sel=$('genre-sel'); if(!sel||sel.children.length>1) return;
  (genres||[]).forEach(g=>{ const o=document.createElement('option'); o.value=g.id; o.textContent=g.name; sel.appendChild(o); });
}

// ── HOME ───────────────────────────────────────────────
async function renderHome(){
  showView('view-home'); setActive('home');
  const rows=$('home-rows'); rows.innerHTML='';
  for(let i=0;i<2;i++){
    const s=document.createElement('div'); s.className='row-sec';
    s.innerHTML='<div class="row-hdr"><div class="skel" style="height:14px;width:120px;border-radius:3px"></div></div><div class="movie-row"></div>';
    const r=s.querySelector('.movie-row'); for(let j=0;j<8;j++) r.appendChild(skelCard());
    rows.appendChild(s);
  }
  try{
    const data=await API.home();
    rows.innerHTML='';
    initHero(data.trending||data.popular||[]);
    S.allGenres=data.genres||[];
    populateGenreSel(data.genres);
    if(data.trending?.length)   rows.appendChild(makeRow({title:'Trending',    span:'Now',      movies:data.trending,   onSeeAll:()=>router.go('/trending')}));
    if(data.popular?.length)    rows.appendChild(makeRow({title:'Most',        span:'Popular',  movies:data.popular,    onSeeAll:()=>router.go('/movies')}));
    if(data.topRated?.length)   rows.appendChild(makeRow({title:'Top',         span:'Rated',    movies:data.topRated,   onSeeAll:()=>router.go('/top-rated')}));
    if(data.nowPlaying?.length) rows.appendChild(makeRow({title:'Now',         span:'Playing',  movies:data.nowPlaying, onSeeAll:()=>router.go('/now-playing')}));
    (data.genreRows||[]).forEach(gr=>{ if(!gr.results?.length) return; rows.appendChild(makeRow({title:'Best',span:gr.name,movies:gr.results,onSeeAll:()=>router.go(`/genre/${gr.genreId}`)})); });
    injectCwRow(rows);
  } catch(e){
    rows.innerHTML=`<div style="text-align:center;padding:56px 20px;color:var(--tx2)">
      <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
      <h3 style="font-family:var(--fh);margin-bottom:8px">Couldn't load movies</h3>
      <p style="font-size:.82rem;color:var(--tx3);margin-bottom:16px">${esc(e.message)}</p>
      <button class="btn-sm js-retry" style="border:none">↺ Retry</button></div>`;
    rows.querySelector('.js-retry')?.addEventListener('click',()=>renderHome());
  }
}

// ── Grid ───────────────────────────────────────────────
async function renderGrid({title,sub,fetcher,showFilters=false,showBack=false,backHref='/',page=1}){
  showView('view-grid');
  $('grid-title').innerHTML=title;
  $('grid-sub').textContent=sub||'';
  $('grid-filters').style.display=showFilters?'':'none';
  const backBtn=$('grid-back');
  if(showBack){ backBtn.style.display=''; backBtn.onclick=()=>router.go(backHref); }
  else backBtn.style.display='none';
  const grid=$('grid-movies'), pag=$('grid-pag');
  grid.innerHTML=''; pag.innerHTML='';
  for(let i=0;i<20;i++) grid.appendChild(skelCard());
  try{
    const data=await fetcher(page);
    grid.innerHTML='';
    if(!data.results?.length){ grid.innerHTML='<p style="grid-column:1/-1;text-align:center;padding:48px;color:var(--tx3)">No results found.</p>'; return; }
    data.results.forEach(m=>grid.appendChild(makeCard(m)));
    buildPagination('grid-pag',page,data.totalPages||1,p=>renderGrid({title,sub,fetcher,showFilters,showBack,backHref,page:p}));
    window.scrollTo({top:0,behavior:'smooth'});
  } catch(e){
    grid.innerHTML=`<p style="grid-column:1/-1;text-align:center;padding:48px;color:var(--tx3)">${esc(e.message)}</p>`;
  }
}

// ── Genres ─────────────────────────────────────────────
async function renderGenres(){
  showView('view-genres'); setActive('genres');
  const grid=$('genres-grid'); grid.innerHTML='';
  let genres=S.allGenres;
  if(!genres.length){ try{ const d=await API.genres(); genres=S.allGenres=d.genres||[]; }catch{} }
  genres.forEach(g=>{
    const card=document.createElement('div'); card.className='genre-card';
    const [c1,c2]=(GCOL[g.id]||'#1e2028,#2e3140').split(',');
    card.innerHTML=`<div class="genre-bg" style="background:linear-gradient(135deg,${c1},${c2})"></div>
      <div class="genre-ov"><div class="genre-icon">${g.icon||'🎬'}</div><div class="genre-name">${esc(g.name)}</div></div>`;
    card.addEventListener('click',()=>router.go(`/genre/${g.id}`));
    grid.appendChild(card);
  });
}

// ── Movie detail ────────────────────────────────────────
async function renderMovieDetail(id){
  showView('view-movie');
  document.title='Loading… — 4reels';
  $('movie-loader').style.display='flex';
  $('movie-detail-content').style.display='none';
  $('movie-detail-content').innerHTML='';
  try{
    const m=await API.details(id);
    document.title=`${m.title} — 4reels`;
    $('movie-loader').style.display='none';
    $('movie-detail-content').style.display='block';
    $('movie-detail-content').innerHTML=buildDetailHTML(m);
    $('movie-detail-content').querySelector('.js-watch-btn')?.addEventListener('click',()=>router.go(`/movie/${m.tmdbId||m.id}/watch`));
    const simContainer=$('md-sim-container');
    if(simContainer&&m.similar?.length) m.similar.forEach(s=>simContainer.appendChild(makeCard(s)));
  } catch(e){
    $('movie-loader').innerHTML=`<div style="text-align:center;color:var(--tx2)"><p>${esc(e.message)}</p>
      <button class="btn-gho" style="margin-top:14px" onclick="history.back()">← Go Back</button></div>`;
  }
}

function buildDetailHTML(m){
  const bg=m.backdrop?`url(${m.backdrop})`:'none';
  const castHTML=(m.cast||[]).map(c=>`
    <div class="cast-card">
      <img class="cast-img" src="${esc(c.profile||'')}" alt="${esc(c.name)}" loading="lazy" onerror="this.src='';this.style.background='var(--s4)'"/>
      <div class="cast-name">${esc(c.name)}</div>
      <div class="cast-char">${esc(c.character||'')}</div>
    </div>`).join('');
  return `
    <div class="md-backdrop"><div class="md-backdrop-img" style="background-image:${bg}"></div><div class="md-backdrop-grad"></div></div>
    <div class="md-body">
      <div class="md-top">
        <div class="md-poster-wrap">${m.posterLarge||m.poster?`<img class="md-poster" src="${esc(m.posterLarge||m.poster)}" alt="${esc(m.title)}">`:''}
        </div>
        <div class="md-info">
          ${m.certification?`<span class="md-cert">${esc(m.certification)}</span>`:''}
          <h1 class="md-title">${esc(m.title)}</h1>
          ${m.tagline?`<p class="md-tagline">"${esc(m.tagline)}"</p>`:''}
          <div class="md-stats">
            ${fmtRating(m.rating)!=='N/A'?`<span class="md-rat">★ ${esc(fmtRating(m.rating))}</span><span class="sdot"></span>`:''}
            ${m.year?`<span>${esc(m.year)}</span>`:''}
            ${fmtRuntime(m.runtime)?`<span class="sdot"></span><span>${esc(fmtRuntime(m.runtime))}</span>`:''}
          </div>
          <div class="md-genres">${(m.genres||[]).map(g=>`<span class="md-pill">${esc(g)}</span>`).join('')}</div>
          <p class="md-overview">${esc(m.overview||'No overview available.')}</p>
          <div class="md-crew">
            ${m.director?`<div><strong>Director:</strong> ${esc(m.director)}</div>`:''}
            ${m.writers?`<div><strong>Writers:</strong> ${esc(m.writers)}</div>`:''}
          </div>
          <div class="md-actions">
            <button class="btn-pri js-watch-btn">▶ Watch Now</button>
            ${m.trailerKey?`<a class="btn-gho" href="https://www.youtube.com/watch?v=${esc(m.trailerKey)}" target="_blank" rel="noopener">▷ Trailer</a>`:''}
          </div>
        </div>
      </div>
      ${castHTML?`<div class="md-section"><div class="md-section-ttl">Cast</div><div class="cast-row">${castHTML}</div></div>`:''}
      ${m.similar?.length?`<div class="md-section"><div class="md-section-ttl">More Like This</div><div class="sim-row" id="md-sim-container"></div></div>`:''}
    </div>`;
}

// ── Watch page ─────────────────────────────────────────
async function renderWatchPage(id){
  showView('view-watch');
  document.title='Loading… — 4reels';
  const wrap=$('watch-player-wrap');
  const infoEl=$('watch-info'), sidebarEl=$('watch-sidebar');
  if(wrap){
    wrap.innerHTML='';
    if(window.4reelsPlayer) new window.4reelsPlayer('watch-player-wrap',id);
    // Party bar below player
    const partyBar = document.createElement('div');
    partyBar.className = 'watch-party-bar';
    partyBar.innerHTML = `
      <div class="watch-party-status" id="watch-party-status">
        ${window.Party && Party.isInParty()
          ? `<span class="party-dot"></span> <span>In party · ${Party.isHosting() ? 'You are the host' : 'Following host'}</span>`
          : '<span style="color:var(--tx3)">Not in a party</span>'}
      </div>
      <button class="party-btn" id="watch-party-btn" style="margin-left:auto">
        ${window.Party && Party.isInParty()
          ? `<span class="party-dot"></span>${Party.isHosting() ? '👑 Party (Host)' : '🎉 In Party'}`
          : '🎉 Watch Party'}
      </button>`;
    partyBar.querySelector('#watch-party-btn')?.addEventListener('click', () => {
      if(window.Party) Party.open();
    });
    wrap.appendChild(partyBar);
  }
  infoEl.innerHTML=''; sidebarEl.innerHTML='';
  try{
    const m=await API.details(id);
    document.title=`Watch ${m.title} — 4reels`;
    infoEl.innerHTML=`
      <h1 class="watch-title">${esc(m.title)}</h1>
      <div class="watch-meta">
        ${fmtRating(m.rating)!=='N/A'?`<span style="color:var(--warn);font-weight:700">★ ${esc(fmtRating(m.rating))}</span><span class="sdot"></span>`:''}
        ${m.year?`<span>${esc(m.year)}</span>`:''}
        ${fmtRuntime(m.runtime)?`<span class="sdot"></span><span>${esc(fmtRuntime(m.runtime))}</span>`:''}
        ${m.certification?`<span class="sdot"></span><span style="border:1px solid var(--bdr2);padding:1px 5px;border-radius:var(--r2);font-size:.66rem">${esc(m.certification)}</span>`:''}
      </div>
      <div class="watch-genres">${(m.genres||[]).map(g=>`<span class="wpill">${esc(g)}</span>`).join('')}</div>
      <p class="watch-overview">${esc(m.overview||'')}</p>
      <div class="watch-crew">
        ${m.director?`<div><strong>Director:</strong> ${esc(m.director)}</div>`:''}
        ${m.writers?`<div><strong>Writers:</strong> ${esc(m.writers)}</div>`:''}
      </div>
      ${m.cast?.length?`<div class="watch-cast-ttl">Cast</div><div class="cast-row">${
        m.cast.map(c=>`<div class="cast-card">
          <img class="cast-img" src="${esc(c.profile||'')}" alt="${esc(c.name)}" loading="lazy" onerror="this.src='';this.style.background='var(--s4)'"/>
          <div class="cast-name">${esc(c.name)}</div>
          <div class="cast-char">${esc(c.character||'')}</div>
        </div>`).join('')}</div>`:''}`;
    if(m.similar?.length){
      sidebarEl.innerHTML='<div class="sidebar-ttl">More Like This</div>';
      m.similar.forEach(s=>{
        const card=document.createElement('div'); card.className='sidebar-card';
        card.innerHTML=`<img class="sb-poster" src="${esc(s.poster||'')}" alt="${esc(s.title)}" loading="lazy" onerror="this.style.background='var(--s4)';this.src=''">
          <div class="sb-info"><div class="sb-title">${esc(s.title)}</div>
          <div class="sb-meta">${esc(s.year)} <span class="sb-rat">★ ${esc(fmtRating(s.rating))}</span></div></div>`;
        card.addEventListener('click',()=>router.go(`/movie/${s.tmdbId||s.id}/watch`));
        sidebarEl.appendChild(card);
      });
    }
  } catch(e){ console.error(e); }
}

// ── My List page ────────────────────────────────────────
function renderMyList(){
  showView('view-my-list'); setActive('my-list');
  document.title='My List — 4reels';
  const items=listGet(), grid=$('mylist-grid'), sub=$('mylist-sub'), clearBtn=$('mylist-clear');
  grid.innerHTML='';
  if(!items.length){
    sub.textContent='Your list is empty.'; clearBtn.style.display='none';
    grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:56px 20px;color:var(--tx2)">
      <div style="font-size:2.5rem;margin-bottom:12px">📋</div>
      <h3 style="font-family:var(--fh);margin-bottom:7px">Nothing saved yet</h3>
      <p style="font-size:.82rem;color:var(--tx3)">Hit the bookmark button on any movie to save it here.</p></div>`;
    return;
  }
  sub.textContent=`${items.length} saved title${items.length!==1?'s':''}`;
  clearBtn.style.display='inline-flex';
  clearBtn.onclick=()=>{ listSave([]); renderMyList(); };
  items.forEach(entry=>{
    const card=makeCard(entry);
    const removeBtn=document.createElement('button');
    removeBtn.style.cssText='position:absolute;top:5px;left:5px;z-index:3;width:22px;height:22px;border-radius:50%;background:rgba(239,68,68,.85);border:none;color:#fff;font-size:.65rem;display:none;align-items:center;justify-content:center;cursor:pointer';
    removeBtn.textContent='✕';
    removeBtn.addEventListener('click',e=>{ e.stopPropagation(); listRemove(entry.id); card.remove(); const remaining=listGet(); sub.textContent=`${remaining.length} saved title${remaining.length!==1?'s':''}`; if(!remaining.length) renderMyList(); });
    card.addEventListener('mouseenter',()=>removeBtn.style.display='flex');
    card.addEventListener('mouseleave',()=>removeBtn.style.display='none');
    card.appendChild(removeBtn);
    grid.appendChild(card);
  });
}

// ── Search ──────────────────────────────────────────────
let _st=null;
function initSearch(){
  // Sidebar search
  const inp=$('search-input'), drop=$('search-drop');
  if(inp){
    inp.addEventListener('input',()=>{
      const val=inp.value.trim();
      if(!val){ drop.classList.remove('open'); return; }
      clearTimeout(_st);
      _st=setTimeout(async()=>{
        drop.innerHTML=`<div class="sd-empty">Searching…</div>`; drop.classList.add('open');
        try{ const d=await API.search(val,1); renderDrop(d,val,drop,inp); }
        catch(e){ drop.innerHTML=`<div class="sd-empty">${esc(e.message)}</div>`; }
      },320);
    });
    inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'&&inp.value.trim()){ drop.classList.remove('open'); inp.blur(); router.go(`/search?q=${encodeURIComponent(inp.value.trim())}`); }
      if(e.key==='Escape'){ drop.classList.remove('open'); inp.blur(); }
    });
  }

  // Mobile search (header toggle)
  $('search-toggle')?.addEventListener('click',()=>{
    const bar=$('mobile-search-bar');
    if(bar){ bar.style.display=bar.style.display==='none'||!bar.style.display?'flex':'none'; if(bar.style.display==='flex') $('mobile-search-input')?.focus(); }
  });
  const mInp=$('mobile-search-input');
  if(mInp){
    mInp.addEventListener('keydown',e=>{ if(e.key==='Enter'&&mInp.value.trim()){ router.go(`/search?q=${encodeURIComponent(mInp.value.trim())}`); mInp.value=''; } });
  }

  document.addEventListener('click',e=>{
    if(!e.target.closest('.sb-search')&&!e.target.closest('.search-drop')) drop?.classList.remove('open');
  });
}

function renderDrop(data,q,drop,inp){
  drop.innerHTML='';
  if(!data.results?.length){ drop.innerHTML=`<div class="sd-empty">No results for "${esc(q)}"</div>`; return; }
  data.results.slice(0,6).forEach(m=>{
    const item=document.createElement('div'); item.className='sd-item';
    item.innerHTML=`<img class="sd-poster" src="${esc(m.poster||'')}" alt="" loading="lazy" onerror="this.src=''">
      <div><div class="sd-title">${esc(m.title)}</div>
      <div class="sd-meta">${esc(m.year)} · <span class="sd-rating">★ ${esc(fmtRating(m.rating))}</span></div></div>`;
    item.addEventListener('click',()=>{ drop.classList.remove('open'); if(inp) inp.value=''; router.go(`/movie/${m.tmdbId||m.id}`); });
    drop.appendChild(item);
  });
  if(data.totalResults>6){
    const f=document.createElement('div'); f.className='sd-footer'; f.textContent=`See all ${data.totalResults} results`;
    f.addEventListener('click',()=>{ drop.classList.remove('open'); if(inp) inp.value=''; router.go(`/search?q=${encodeURIComponent(q)}`); });
    drop.appendChild(f);
  }
  drop.classList.add('open');
}

// ── Pagination ─────────────────────────────────────────
function buildPagination(id,cur,total,onClick){
  const el=$(id); if(!el||total<=1) return; el.innerHTML='';
  const max=Math.min(total,500);
  const btn=(label,page,active=false,disabled=false,ell=false)=>{
    const b=document.createElement('button');
    b.className=`pg-btn${active?' act':''}${ell?' ell':''}`;
    b.textContent=label; b.disabled=disabled;
    if(!disabled&&!ell) b.addEventListener('click',()=>onClick(page));
    el.appendChild(b);
  };
  btn('←',cur-1,false,cur===1);
  pagRange(cur,max).forEach(p=>p==='…'?btn('…',null,false,false,true):btn(p,p,p===cur));
  btn('→',cur+1,false,cur>=max);
}
function pagRange(c,t){ if(t<=7) return Array.from({length:t},(_,i)=>i+1); if(c<=4) return [1,2,3,4,5,'…',t]; if(c>=t-3) return [1,'…',t-4,t-3,t-2,t-1,t]; return [1,'…',c-1,c,c+1,'…',t]; }

// ── Active nav ─────────────────────────────────────────
function setActive(route){
  qq('.sb-link[data-route],.mob-nav a[data-route]').forEach(a=>{
    const dr=a.dataset.route||''; const href=a.getAttribute('href')||'';
    a.classList.toggle('active',dr===route||href==='/'+(route)||href===route);
  });
}

// ── Continue Watching + My List ────────────────────────
const CW_KEY='4reels_cw', LIST_KEY='4reels_list';
function cwGet(){ try{ return JSON.parse(localStorage.getItem(CW_KEY)||'[]'); }catch{ return []; } }
function cwSave(a){ localStorage.setItem(CW_KEY,JSON.stringify(a.slice(0,20))); }
function cwAdd(movie){ if(!movie?.id&&!movie?.tmdbId) return; let l=cwGet().filter(m=>String(m.id)!==String(movie.tmdbId||movie.id)); l.unshift({id:String(movie.tmdbId||movie.id),title:movie.title||'',year:movie.year||'',rating:movie.rating||'N/A',poster:movie.poster||null,backdrop:movie.backdrop||null,addedAt:Date.now()}); cwSave(l); }
function cwRemove(id){ cwSave(cwGet().filter(m=>String(m.id)!==String(id))); }
function listGet(){ try{ return JSON.parse(localStorage.getItem(LIST_KEY)||'[]'); }catch{ return []; } }
function listSave(a){ localStorage.setItem(LIST_KEY,JSON.stringify(a.slice(0,200))); }
function listHas(id){ return listGet().some(m=>String(m.id)===String(id)); }
function listAdd(movie){ if(!movie?.id&&!movie?.tmdbId) return; const id=String(movie.tmdbId||movie.id); if(listHas(id)) return; let arr=listGet(); arr.unshift({id,title:movie.title||'',year:movie.year||'',rating:movie.rating||'N/A',poster:movie.poster||null,addedAt:Date.now()}); listSave(arr); }
function listRemove(id){ listSave(listGet().filter(m=>String(m.id)!==String(id))); }
function listToggle(movie){ const id=String(movie?.tmdbId||movie?.id); if(listHas(id)){listRemove(id);return false;} listAdd(movie);return true; }

function makeCwCard(entry){
  const c=document.createElement('div'); c.className='cw-card';
  const bg=entry.backdrop||entry.poster;
  c.innerHTML=`
    <div class="cw-poster">
      ${bg?`<img src="${esc(bg)}" alt="${esc(entry.title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`:''}
      <div class="cw-poster-fb" style="display:${bg?'none':'flex'}">🎬</div>
      <div class="cw-overlay"><div class="cw-play"><svg width="11" height="11" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div></div>
      <button class="cw-remove" title="Remove">✕</button>
    </div>
    <div class="cw-info">
      <div class="cw-title">${esc(entry.title)}</div>
      <div class="cw-meta"><span class="cw-year">${esc(entry.year)}</span><span class="cw-rat">★ ${esc(fmtRating(entry.rating))}</span></div>
    </div>
    <div class="cw-progress"><div class="cw-progress-bar" style="width:${entry.progress||0}%"></div></div>`;
  c.addEventListener('click',e=>{ if(e.target.closest('.cw-remove')) return; router.go(`/movie/${entry.id}/watch`); });
  c.querySelector('.cw-remove')?.addEventListener('click',e=>{ e.stopPropagation(); cwRemove(entry.id); c.style.opacity='0'; c.style.transition='opacity .2s'; setTimeout(()=>c.remove(),200); });
  return c;
}

function injectCwRow(container){
  const items=cwGet(); if(!items.length) return;
  const existing=container.querySelector('.cw-row-sec'); if(existing) existing.remove();
  const sec=document.createElement('div'); sec.className='row-sec cw-row-sec';
  sec.innerHTML=`
    <div class="row-hdr">
      <div><div class="row-ttl">Continue <span>Watching</span></div><div class="row-sub">${items.length} title${items.length!==1?'s':''}</div></div>
      <a href="#" class="row-all">Clear</a>
    </div>
    <div class="movie-row" id="cw-row"></div>`;
  sec.querySelector('.row-all').addEventListener('click',e=>{ e.preventDefault(); cwSave([]); sec.remove(); });
  const row=sec.querySelector('#cw-row');
  items.forEach(entry=>row.appendChild(makeCwCard(entry)));
  if(container.firstChild) container.insertBefore(sec,container.firstChild);
  else container.appendChild(sec);
}

function buildMyListBtn(movie){
  const inList=listHas(String(movie.tmdbId||movie.id));
  const btn=document.createElement('button');
  btn.className='btn-mylist'+(inList?' in-list':'');
  btn.innerHTML=inList?'✕ Remove from List':'+ Add to List';
  btn.addEventListener('click',()=>{
    const added=listToggle(movie);
    btn.className='btn-mylist'+(added?' in-list':'');
    btn.innerHTML=added?'✕ Remove from List':'+ Add to List';
    toast(added?'Added to My List':'Removed from My List');
  });
  return btn;
}

// ── Router ─────────────────────────────────────────────
let _navBusy=false;
const router={
  go(path){ if(location.pathname+location.search===path) return; history.pushState({},'' ,path); this.handle(path); },
  async handle(path){
    if(_navBusy) return;
    _navBusy=true;
    window.scrollTo({top:0,behavior:'instant'});
    // Close mobile nav
    const hb=$('hamburger'), mn=$('mob-nav'), sb=$('sidebar');
    if(hb) hb.classList.remove('open');
    if(mn) mn.classList.remove('open');
    if(sb) sb.classList.remove('open');
    document.body.classList.remove('noscroll');
    $('search-drop')?.classList.remove('open');
    try{
      const watchM=path.match(/^\/movie\/(\d+)\/watch$/);
      if(watchM){ const m=await renderWatchAndCW(watchM[1]); return; }
      const movieM=path.match(/^\/movie\/(\d+)$/);
      if(movieM){ await renderMovieDetailWithList(movieM[1]); return; }
      if(path.startsWith('/search')){
        const q=new URLSearchParams(path.split('?')[1]||'').get('q')||'';
        setActive('');
        if(q) await renderGrid({title:`Results for <span>"${esc(q)}"</span>`,fetcher:p=>API.search(q,p),showBack:true,backHref:'/'});
        return;
      }
      const genreM=path.match(/^\/genre\/(\d+)$/);
      if(genreM){
        const gid=+genreM[1]; const gname=S.allGenres.find(g=>g.id===gid)?.name||'Genre';
        setActive('genres');
        await renderGrid({title:`${gname} <span>Movies</span>`,fetcher:p=>API.byGenre(gid,p),showBack:true,backHref:'/genres'});
        return;
      }
      switch(path){
        case '/': case '/home': setActive('home'); await renderHome(); break;
        case '/movies':      setActive('movies');    await renderGrid({title:'All <span>Movies</span>',showFilters:true,fetcher:p=>API.popular(p)}); break;
        case '/series':      setActive('series');    await renderGrid({title:'TV <span>Series</span>',fetcher:p=>API.popular(p)}); break;
        case '/trending':    setActive('trending');  await renderGrid({title:'Trending <span>Now</span>',sub:'Most watched this week',fetcher:p=>API.trending(p)}); break;
        case '/top-rated':   setActive('top-rated'); await renderGrid({title:'Top <span>Rated</span>',fetcher:p=>API.topRated(p)}); break;
        case '/now-playing': setActive('');          await renderGrid({title:'Now <span>Playing</span>',fetcher:p=>API.nowPlaying(p)}); break;
        case '/genres':      await renderGenres(); break;
        case '/my-list':     renderMyList(); break;
        case '/profile':     renderProfile(); break;
        default:             setActive('home'); await renderHome();
      }
    } catch(e){ console.error('[router]',e); }
    finally{ _navBusy=false; }
  },
};
window.addEventListener('popstate',()=>{ _navBusy=false; router.handle(location.pathname+location.search); });

async function renderWatchAndCW(id){
  await renderWatchPage(id);
  try{
    const m=await API.details(id).catch(()=>null);
    if(m){
      cwAdd(m);
      Auth._updateSidebar();
      // Tell the party system what's playing (host only, no-op for guests)
      if(window.Party && Party.isInParty() && Party.isHosting()){
        Party.setCurrentMovie(m.tmdbId||m.id, m.title, m.poster||'');
      }
    }
  } catch{}
}

async function renderMovieDetailWithList(id){
  await renderMovieDetail(id);
  try{
    const m=await API.details(id).catch(()=>null);
    if(!m) return;
    const actionsEl=$('movie-detail-content')?.querySelector('.md-actions');
    if(actionsEl) actionsEl.appendChild(buildMyListBtn(m));
  } catch{}
}

// ── Filters ─────────────────────────────────────────────
function initFilters(){
  $('sort-sel')?.addEventListener('change',e=>{
    const f={popular:p=>API.popular(p),'top-rated':p=>API.topRated(p),trending:p=>API.trending(p),'now-playing':p=>API.nowPlaying(p)};
    if(S.moviesGenreId) renderGrid({title:'All <span>Movies</span>',showFilters:true,fetcher:p=>API.byGenre(S.moviesGenreId,p)});
    else renderGrid({title:'All <span>Movies</span>',showFilters:true,fetcher:f[e.target.value]||f.popular});
  });
  $('genre-sel')?.addEventListener('change',e=>{
    S.moviesGenreId=e.target.value;
    if(e.target.value) renderGrid({title:'All <span>Movies</span>',showFilters:true,fetcher:p=>API.byGenre(+e.target.value,p)});
    else renderGrid({title:'All <span>Movies</span>',showFilters:true,fetcher:p=>API.popular(p)});
  });
}

// ── Nav/sidebar init ────────────────────────────────────
function initNav(){
  const hb=$('hamburger'), mn=$('mob-nav'), sb=$('sidebar');
  hb?.addEventListener('click',()=>{
    const open=hb.classList.toggle('open');
    mn?.classList.toggle('open',open);
    document.body.classList.toggle('noscroll',open);
  });
  // SPA link interception
  const STATIC=['/dmca','/privacy','/terms','/contact','/setup'];
  document.addEventListener('click',e=>{
    const a=e.target.closest('a[href]'); if(!a) return;
    const href=a.getAttribute('href'); if(!href) return;
    if(href.startsWith('http')||href.startsWith('//')||href.startsWith('#')||href.startsWith('mailto')) return;
    if(STATIC.includes(href)) return;
    e.preventDefault(); router.go(href);
  });
}

/* ══════════════════════════════════════════════════════
   AUTH + PROFILE + ADMIN (Neon Postgres backend)
   ══════════════════════════════════════════════════════ */

// ── Auth state ─────────────────────────────────────────
const Auth={
  _user:null, _token:null,
  init(){
    this._token=localStorage.getItem('4reels_token');
    try{ this._user=JSON.parse(localStorage.getItem('4reels_user')||'null'); }catch{}
    this._applyPrefs();
    this._updateSidebar();
  },
  get user(){ return this._user; },
  get token(){ return this._token; },
  get isLoggedIn(){ return !!this._token&&!!this._user; },
  get isAdmin(){ return this._user?.role==='admin'; },
  save(token,user){ this._token=token; this._user=user; localStorage.setItem('4reels_token',token); localStorage.setItem('4reels_user',JSON.stringify(user)); this._updateSidebar(); this._applyPrefs(); },
  logout(){ this._token=null; this._user=null; localStorage.removeItem('4reels_token'); localStorage.removeItem('4reels_user'); this._updateSidebar(); toast('Logged out.'); router.go('/'); },
  async refresh(){ if(!this._token) return; try{ const r=await authFetch('GET','/api/auth/me'); this._user=r; localStorage.setItem('4reels_user',JSON.stringify(r)); this._updateSidebar(); }catch{ this.logout(); } },
  _updateSidebar(){
    const avatarEl=$('sb-profile-avatar'), nameEl=$('sb-profile-name'), initialsEl=$('nav-avatar-initials');
    if(this._user){
      const initials=(this._user.displayName||this._user.username||'?').slice(0,2).toUpperCase();
      if(avatarEl){
        if(this._user.avatarBase64){ avatarEl.innerHTML=`<img src="${esc(this._user.avatarBase64)}" alt=""/>`; }
        else{ avatarEl.innerHTML=initials; avatarEl.style.background=this._user.avatarColor||'var(--ac)'; }
      }
      if(nameEl) nameEl.textContent=this._user.displayName||this._user.username;
      if(initialsEl) initialsEl.textContent=initials;
    } else {
      if(avatarEl){ avatarEl.innerHTML='?'; avatarEl.style.background='var(--s4)'; }
      if(nameEl) nameEl.textContent='Sign in';
      if(initialsEl) initialsEl.textContent='?';
    }
  },
  _applyPrefs(){
    const p=getPrefs();
    applyAccent(p.accent||'coral');
    if(p.compactCards) document.body.classList.add('compact'); else document.body.classList.remove('compact');
  },
};

async function authFetch(method,path,body){
  const opts={method,headers:{'Content-Type':'application/json'}};
  if(Auth.token) opts.headers['Authorization']='Bearer '+Auth.token;
  if(body) opts.body=JSON.stringify(body);
  const r=await fetch(path,opts);
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||`HTTP ${r.status}`);
  return data;
}

const PREFS_KEY='4reels_prefs';
function getPrefs(){ try{ return JSON.parse(localStorage.getItem(PREFS_KEY)||'{}'); }catch{ return {}; } }
function savePrefs(patch){ const p={...getPrefs(),...patch}; localStorage.setItem(PREFS_KEY,JSON.stringify(p)); return p; }

const ACCENT_MAP={
  coral:{ac:'#ff5d4e',dim:'#e0503e'},
  blue:{ac:'#4f8dff',dim:'#3a6fe0'},
  violet:{ac:'#a463ff',dim:'#8a47e0'},
  emerald:{ac:'#3ddc84',dim:'#2bc06e'},
  amber:{ac:'#ffb648',dim:'#e8a02f'},
  pink:{ac:'#ff6ec7',dim:'#e652ab'},
};
function applyAccent(name){
  const c=ACCENT_MAP[name]||ACCENT_MAP.coral;
  document.documentElement.style.setProperty('--ac',c.ac);
  document.documentElement.style.setProperty('--ac-dim',c.dim);
  document.documentElement.style.setProperty('--ac-soft',c.ac+'1a');
}

// ── Auth Modal ─────────────────────────────────────────
function buildAuthModal(){
  if($('auth-overlay')) return;
  const overlay=document.createElement('div');
  overlay.id='auth-overlay'; overlay.className='auth-overlay';
  overlay.innerHTML=`
    <div class="auth-modal">
      <button class="auth-close" id="auth-close">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      <div class="auth-modal-logo"><img src="/4reels-icon.svg" alt="4reels"/></div>
      <div class="auth-tabs">
        <button class="auth-tab active" data-auth-tab="login">Sign In</button>
        <button class="auth-tab" data-auth-tab="register">Create Account</button>
      </div>
      <div id="auth-panel-login">
        <div class="auth-field"><label>Username</label><input type="text" id="auth-login-user" placeholder="your_username" autocomplete="username"/></div>
        <div class="auth-field"><label>Password</label><input type="password" id="auth-login-pass" placeholder="••••••••" autocomplete="current-password"/></div>
        <div class="auth-error" id="auth-login-err"></div>
        <button class="auth-submit" id="auth-login-btn">Sign In</button>
      </div>
      <div id="auth-panel-register" style="display:none">
        <div class="auth-field"><label>Username</label><input type="text" id="auth-reg-user" placeholder="cool_username" autocomplete="username" maxlength="20"/></div>
        <div class="auth-field"><label>Email (optional)</label><input type="email" id="auth-reg-email" placeholder="you@example.com" autocomplete="email"/></div>
        <div class="auth-field"><label>Password</label><input type="password" id="auth-reg-pass" placeholder="min 6 characters" autocomplete="new-password"/></div>
        <div class="auth-error" id="auth-reg-err"></div>
        <button class="auth-submit" id="auth-reg-btn">Create Account</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('.auth-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      overlay.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active')); tab.classList.add('active');
      $('auth-panel-login').style.display=tab.dataset.authTab==='login'?'':'none';
      $('auth-panel-register').style.display=tab.dataset.authTab==='register'?'':'none';
    });
  });
  $('auth-close').addEventListener('click',closeAuthModal);
  overlay.addEventListener('click',e=>{ if(e.target===overlay) closeAuthModal(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeAuthModal(); });
  $('auth-login-btn').addEventListener('click',async()=>{
    const btn=$('auth-login-btn'), errEl=$('auth-login-err');
    errEl.classList.remove('show'); btn.disabled=true; btn.textContent='Signing in…';
    try{
      const d=await authFetch('POST','/api/auth/login',{username:$('auth-login-user').value.trim(),password:$('auth-login-pass').value});
      Auth.save(d.token,d.user); closeAuthModal(); toast(`Welcome back, ${d.user.displayName||d.user.username}! 👋`,'success');
    } catch(e){ errEl.textContent=e.message; errEl.classList.add('show'); }
    finally{ btn.disabled=false; btn.textContent='Sign In'; }
  });
  [$('auth-login-user'),$('auth-login-pass')].forEach(el=>el?.addEventListener('keydown',e=>{ if(e.key==='Enter') $('auth-login-btn').click(); }));
  $('auth-reg-btn').addEventListener('click',async()=>{
    const btn=$('auth-reg-btn'), errEl=$('auth-reg-err');
    errEl.classList.remove('show'); btn.disabled=true; btn.textContent='Creating account…';
    try{
      const d=await authFetch('POST','/api/auth/register',{username:$('auth-reg-user').value.trim(),email:$('auth-reg-email').value.trim(),password:$('auth-reg-pass').value});
      Auth.save(d.token,d.user); closeAuthModal(); toast(`Welcome to 4reels, ${d.user.displayName||d.user.username}! 🎬`,'success');
    } catch(e){ errEl.textContent=e.message; errEl.classList.add('show'); }
    finally{ btn.disabled=false; btn.textContent='Create Account'; }
  });
}

function openAuthModal(tab='login'){
  buildAuthModal();
  const overlay=$('auth-overlay'); overlay.classList.add('open'); document.body.classList.add('noscroll');
  overlay.querySelectorAll('.auth-tab').forEach(t=>t.classList.toggle('active',t.dataset.authTab===tab));
  $('auth-panel-login').style.display=tab==='login'?'':'none';
  $('auth-panel-register').style.display=tab==='register'?'':'none';
  setTimeout(()=>$(tab==='login'?'auth-login-user':'auth-reg-user')?.focus(),200);
}
function closeAuthModal(){ $('auth-overlay')?.classList.remove('open'); document.body.classList.remove('noscroll'); }
window.openAuthModal=openAuthModal;

// ── Profile page ────────────────────────────────────────
function renderProfile(){
  showView('view-profile'); setActive('profile');
  document.title='Profile — 4reels';
  if(!Auth.isLoggedIn){
    const layout=document.querySelector('.profile-layout');
    if(layout) layout.innerHTML=`<div style="text-align:center;padding:64px 20px">
      <div style="font-size:2.5rem;margin-bottom:14px">👤</div>
      <h2 style="font-family:var(--fh);font-size:1.3rem;margin-bottom:8px">Sign in to access your profile</h2>
      <p style="color:var(--tx2);font-size:.84rem;margin-bottom:20px">Create a free account to save your list, track what you've watched, and customise your experience.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn-pri" onclick="openAuthModal('register')">Create Account</button>
        <button class="btn-gho" onclick="openAuthModal('login')">Sign In</button>
      </div></div>`;
    return;
  }
  const u=Auth.user;
  const initials=(u.displayName||u.username||'?').slice(0,2).toUpperCase();
  const avatarBtn=$('profile-avatar-btn');
  if(avatarBtn){
    if(u.avatarBase64){ avatarBtn.innerHTML=`<img src="${esc(u.avatarBase64)}" alt="avatar"/><div class="pa-overlay">Change</div>`; }
    else{ avatarBtn.style.background=u.avatarColor||'var(--ac)'; const el=$('profile-avatar-initials-big'); if(el) el.textContent=initials; }
  }
  if($('profile-display-name')) $('profile-display-name').textContent=u.displayName||u.username;
  if($('profile-handle')) $('profile-handle').textContent=`@${u.username} · Member since ${u.createdAt?.slice(0,4)||'2026'}`;
  const badgesEl=$('profile-badges');
  if(badgesEl){
    const badges=[];
    if(u.role==='admin') badges.push('👑 Admin');
    else if(u.role==='moderator') badges.push('🛡 Mod');
    if(u.badge) badges.push(u.badge);
    if(!badges.length) badges.push('Member');
    badgesEl.innerHTML=badges.map(b=>`<span class="profile-badge">${esc(b)}</span>`).join('');
  }
  const cwCount=cwGet().length, listCount=listGet().length;
  if($('stat-watched')) $('stat-watched').textContent=cwCount;
  if($('stat-list'))    $('stat-list').textContent=listCount;
  if($('stat-hours'))   $('stat-hours').textContent=Math.floor(cwCount*1.8);
  const inp=$('input-display-name'); if(inp) inp.value=u.displayName||'';
  const bio=$('input-bio'); if(bio) bio.value=u.bio||'';
  const prefs=getPrefs();
  const toggleMap={'toggle-compact':'compactCards','toggle-show-ratings':'showRatings','toggle-autoplay':'autoplay','toggle-remember-pos':'rememberPos','toggle-skip-intro':'skipIntro','toggle-track-history':'trackHistory','toggle-safe-banner':'safeBanner'};
  Object.entries(toggleMap).forEach(([id,key])=>{
    const el=$(id); if(!el) return;
    const def=['showRatings','autoplay','rememberPos','skipIntro','trackHistory','safeBanner'].includes(key);
    el.checked=prefs[key]!==undefined?prefs[key]:def;
    el.addEventListener('change',()=>{ savePrefs({[key]:el.checked}); Auth._applyPrefs(); toast('Setting saved.'); });
  });
  const selLang=$('sel-language'); if(selLang){ selLang.value=prefs.language||'en'; selLang.addEventListener('change',()=>{ savePrefs({language:selLang.value}); toast('Language saved.'); }); }
  const selSrv=$('sel-default-server'); if(selSrv){ selSrv.value=String(prefs.defaultServer||0); selSrv.addEventListener('change',()=>{ savePrefs({defaultServer:+selSrv.value}); toast('Default server saved.'); }); }
  document.querySelectorAll('#accent-swatches .color-swatch').forEach(sw=>{
    sw.classList.toggle('active',sw.dataset.accent===(prefs.accent||'coral'));
    sw.addEventListener('click',()=>{ document.querySelectorAll('#accent-swatches .color-swatch').forEach(s=>s.classList.remove('active')); sw.classList.add('active'); savePrefs({accent:sw.dataset.accent}); applyAccent(sw.dataset.accent); toast('Accent colour updated.'); });
  });
  document.querySelectorAll('#avatar-color-swatches .color-swatch').forEach(sw=>{
    sw.classList.toggle('active',sw.dataset.color===(u.avatarColor||''));
    sw.addEventListener('click',async()=>{
      document.querySelectorAll('#avatar-color-swatches .color-swatch').forEach(s=>s.classList.remove('active')); sw.classList.add('active');
      try{ await authFetch('PATCH','/api/auth/me',{avatarColor:sw.dataset.color}); await Auth.refresh(); toast('Avatar colour updated.'); }
      catch(e){ toast(e.message,'err'); }
    });
  });
  const avatarUpload=$('avatar-upload');
  $('profile-avatar-btn')?.addEventListener('click',()=>avatarUpload?.click());
  $('profile-avatar-edit')?.addEventListener('click',()=>avatarUpload?.click());
  avatarUpload?.addEventListener('change',async e=>{
    const file=e.target.files?.[0]; if(!file) return;
    if(file.size>2*1024*1024){ toast('Image must be under 2MB','err'); return; }
    const reader=new FileReader();
    reader.onload=async ev=>{
      try{ await authFetch('PATCH','/api/auth/me',{avatarBase64:ev.target.result}); await Auth.refresh(); toast('Profile photo updated!','success'); renderProfile(); }
      catch(err){ toast(err.message,'err'); }
    };
    reader.readAsDataURL(file); e.target.value='';
  });
  $('save-display-name')?.addEventListener('click',async()=>{
    const val=$('input-display-name')?.value.trim(); if(!val) return toast('Name cannot be empty','err');
    try{ await authFetch('PATCH','/api/auth/me',{displayName:val}); await Auth.refresh(); if($('profile-display-name')) $('profile-display-name').textContent=val; toast('Name saved.','success'); }
    catch(e){ toast(e.message,'err'); }
  });
  $('save-bio')?.addEventListener('click',async()=>{
    try{ await authFetch('PATCH','/api/auth/me',{bio:$('input-bio')?.value.trim()||''}); await Auth.refresh(); toast('Bio saved.','success'); }
    catch(e){ toast(e.message,'err'); }
  });
  $('clear-cw-btn')?.addEventListener('click',()=>{ cwSave([]); toast('Watch history cleared.'); if($('stat-watched')) $('stat-watched').textContent='0'; });
  $('clear-list-btn')?.addEventListener('click',()=>{ listSave([]); toast('My List cleared.'); if($('stat-list')) $('stat-list').textContent='0'; });
  $('reset-all-btn')?.addEventListener('click',()=>{
    if(!confirm('Reset ALL data? This cannot be undone.')) return;
    cwSave([]); listSave([]); localStorage.removeItem(PREFS_KEY); localStorage.removeItem('4reels-safe-dismissed');
    Auth.logout(); toast('All data reset.','success');
  });
  document.querySelectorAll('.profile-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      document.querySelectorAll('.profile-tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.profile-tab-content').forEach(c=>c.classList.remove('active'));
      tab.classList.add('active'); $(`tab-${tab.dataset.tab}`)?.classList.add('active');
    });
  });
  if(Auth.isAdmin) addAdminTab();
  const dangerZone=document.querySelector('.danger-zone');
  if(dangerZone&&!$('logout-btn')){
    const btn=document.createElement('button'); btn.id='logout-btn'; btn.className='btn-out'; btn.textContent='Sign Out';
    btn.style.marginTop='10px'; btn.addEventListener('click',()=>Auth.logout()); dangerZone.appendChild(btn);
  }
}

// ── Admin tab ──────────────────────────────────────────
function addAdminTab(){
  const tabs=document.querySelector('.profile-tabs');
  if(!tabs||document.querySelector('[data-tab="admin"]')) return;
  const adminTabBtn=document.createElement('button');
  adminTabBtn.className='profile-tab'; adminTabBtn.dataset.tab='admin'; adminTabBtn.innerHTML='👑 Admin';
  tabs.appendChild(adminTabBtn);
  const profileLayout=document.querySelector('.profile-layout');
  const tabContent=document.createElement('div');
  tabContent.className='profile-tab-content'; tabContent.id='tab-admin';
  tabContent.innerHTML=`<div class="settings-section"><div class="settings-section-title">User Management</div>
    <div id="admin-users-container"><div style="text-align:center;padding:28px;color:var(--tx2)"><div class="spinner" style="margin:0 auto 10px"></div>Loading users…</div></div></div>`;
  profileLayout.appendChild(tabContent);
  adminTabBtn.addEventListener('click',()=>{
    document.querySelectorAll('.profile-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.profile-tab-content').forEach(c=>c.classList.remove('active'));
    adminTabBtn.classList.add('active'); tabContent.classList.add('active'); loadAdminUsers();
  });
}

async function loadAdminUsers(){
  const container=$('admin-users-container'); if(!container) return;
  try{
    const users=await authFetch('GET','/api/auth/admin/users');
    const currentId=Auth.user?.id;
    container.innerHTML=`<div style="overflow-x:auto"><table class="admin-users-table">
      <thead><tr><th>User</th><th>Role</th><th>Badge</th><th>Joined</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u=>`<tr data-uid="${esc(u.id)}">
        <td><div class="user-info-cell">
          <div class="user-avatar-sm" style="background:${esc(u.avatarColor||'var(--s4)')}">${esc((u.displayName||u.username||'?').slice(0,2).toUpperCase())}</div>
          <div><div style="font-family:var(--fh);font-size:.8rem;font-weight:700">${esc(u.displayName||u.username)}</div>
          <div style="font-size:.68rem;color:var(--tx3)">@${esc(u.username)}${u.email?` · ${esc(u.email)}`:''}</div></div>
        </div></td>
        <td><select class="admin-select" data-field="role" ${u.id===currentId?'disabled':''}>
          <option value="member" ${u.role==='member'?'selected':''}>Member</option>
          <option value="moderator" ${u.role==='moderator'?'selected':''}>Mod</option>
          <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
        </select></td>
        <td><input class="admin-input" data-field="badge" value="${esc(u.badge||'')}" placeholder="⭐ VIP" maxlength="40"/></td>
        <td style="font-size:.72rem;color:var(--tx3);white-space:nowrap">${u.createdAt?.slice(0,10)||'—'}</td>
        <td><div class="admin-actions">
          <button class="btn-sm admin-save-btn" style="font-size:.68rem;padding:4px 10px">Save</button>
          ${u.banned?`<button class="btn-sm admin-ban-btn" style="background:var(--ok);font-size:.68rem;padding:4px 10px">Unban</button>`
            :u.id!==currentId?`<button class="btn-danger admin-ban-btn" style="font-size:.68rem;padding:4px 10px">Ban</button>`:''}
          ${u.id!==currentId?`<button class="btn-danger admin-del-btn" style="font-size:.68rem;padding:4px 10px">Delete</button>`:''}
        </div></td>
      </tr>`).join('')}</tbody></table></div>
      <p style="font-size:.72rem;color:var(--tx3);padding:10px 0">${users.length} user${users.length!==1?'s':''}</p>`;
    container.querySelectorAll('tr[data-uid]').forEach(row=>{
      const uid=row.dataset.uid;
      row.querySelector('.admin-save-btn')?.addEventListener('click',async()=>{
        const role=row.querySelector('[data-field="role"]')?.value, badge=row.querySelector('[data-field="badge"]')?.value.trim();
        try{ await authFetch('PATCH',`/api/auth/admin/users/${uid}`,{role,badge}); toast('User updated.','success'); loadAdminUsers(); }
        catch(e){ toast(e.message,'err'); }
      });
      row.querySelector('.admin-ban-btn')?.addEventListener('click',async()=>{
        const user=users.find(u=>u.id===uid), newBan=!user?.banned;
        if(!confirm(`${newBan?'Ban':'Unban'} @${user?.username}?`)) return;
        try{ await authFetch('PATCH',`/api/auth/admin/users/${uid}`,{banned:newBan}); toast(newBan?'User banned.':'User unbanned.','success'); loadAdminUsers(); }
        catch(e){ toast(e.message,'err'); }
      });
      row.querySelector('.admin-del-btn')?.addEventListener('click',async()=>{
        const user=users.find(u=>u.id===uid);
        if(!confirm(`Permanently delete @${user?.username}?`)) return;
        try{ await authFetch('DELETE',`/api/auth/admin/users/${uid}`); toast('User deleted.','success'); loadAdminUsers(); }
        catch(e){ toast(e.message,'err'); }
      });
    });
  } catch(e){ container.innerHTML=`<div style="text-align:center;padding:28px;color:var(--tx3)">${esc(e.message)}</div>`; }
}

function initDiscord(){
  const link=$('nav-discord'); if(!link) return;
  const url=localStorage.getItem('4reels_discord')||'#';
  if(url&&url!=='#') link.href=url;
  // Fetch discord URL from env via a quick health check — server can expose it
  fetch('/api/health').then(r=>r.json()).then(d=>{ if(d.discordUrl){ link.href=d.discordUrl; } }).catch(()=>{});
  link.addEventListener('click',e=>{ if(link.getAttribute('href')==='#'){ e.preventDefault(); toast('Discord link not configured yet.','err',3000); } });
}

// ── Nav profile btn ────────────────────────────────────
function initAuthNav(){
  $('nav-avatar')?.addEventListener('click',()=>{ if(Auth.isLoggedIn) router.go('/profile'); else openAuthModal('login'); });
}

// ── Init ───────────────────────────────────────────────
async function init(){
  Auth.init();
  setLB(15);
  initNav(); initSearch(); initFilters(); initSafeBanner(); initAuthNav(); initDiscord();
  setLB(40);
  if(Auth.isLoggedIn) Auth.refresh().catch(()=>{});
  try{ await router.handle(location.pathname+location.search); }
  catch(e){ console.error('Init error:',e); }
  setLB(100);
  setTimeout(hideLB,400);
}
document.addEventListener('DOMContentLoaded',init);
