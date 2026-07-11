/* 4REELS — Player (2 servers only, no visible server bar, party sync) */
'use strict';

(function blockAds() {
  const _open = window.open.bind(window);
  window.open = function(url, name, feat) {
    const u = String(url||'').toLowerCase();
    if (['youtube.com','youtu.be'].some(h=>u.includes(h))) return _open(url,name,feat);
    return null;
  };
})();


const SERVERS = [
  { id:'s1', name:'Server 1', url: id=>`https://embed.filmu.in/movie/${id}` },
  { id:'s2', name:'Server 2', url: id=>`https://vidrift.in/embed/movie/${id}` },
];

class Player {
  constructor(containerId, tmdbId) {
    this.el       = document.getElementById(containerId);
    this.id       = String(tmdbId);
    this.cur      = 0;
    this._timer   = null;
    this._pos     = 0;
    this._playing = false;
    if (!this.el) return;

    // Read server preference from account settings (0 or 1)
    try {
      const prefs = JSON.parse(localStorage.getItem('4reels_prefs') ||
                               localStorage.getItem('4reels_prefs') || '{}');
      this.cur = prefs.defaultServer === 1 ? 1 : 0;
    } catch {}

    this._render();

    window._partyPlayerHandle = {
      sync:        s  => this._partySync(s),
      getPosition: () => this._pos,
    };
  }

  _render() {
    this.el.innerHTML = `
      <div class="player-shell">
        <div class="player-stage" id="pstage-${this.id}">
          <div class="player-overlay" id="povl-${this.id}">
            <div class="pspinner"></div>
            <span class="povl-txt">Loading stream…</span>
          </div>
          <iframe 
            id="pif-${this.id}" 
            allow="fullscreen *; autoplay *; picture-in-picture *; encrypted-media *" 
            style="position:absolute;inset:0;width:100%;height:100%;border:none;background:#000" 
            src="about:blank">
          </iframe>
        </div>
      </div>`;

    this._load(this.cur);

    clearInterval(this._posTracker);
    this._posTracker = setInterval(() => {
      if (this._playing) this._pos += 1;
    }, 1000);
  }

  _load(idx) {
    this.cur = idx;
    const srv    = SERVERS[idx] || SERVERS[0];
    const iframe = document.getElementById(`pif-${this.id}`);
    const ovl    = document.getElementById(`povl-${this.id}`);

    if (!iframe) return;
    if (ovl) ovl.style.display = 'flex';

    iframe.src = 'about:blank';
    clearTimeout(this._timer);

    setTimeout(() => {
      iframe.src = srv.url(this.id);
      const done = () => {
        clearTimeout(this._timer);
        if (ovl) ovl.style.display = 'none';
        this._playing = true;
        iframe.removeEventListener('load', done);
      };
      iframe.addEventListener('load', done);
      // Fallback hide after 14s
      this._timer = setTimeout(() => {
        if (ovl) ovl.style.display = 'none';
        this._playing = true;
      }, 14000);
    }, 180);
  }

  // Called externally (e.g. from settings) to switch server
  switchServer(idx) {
    if (idx < 0 || idx >= SERVERS.length) return;
    this._load(idx);
  }

  // ── Party sync overlay ────────────────────────────────
  _partySync({ playing, position }) {
    this._pos     = position;
    this._playing = playing;
    const stage = document.getElementById(`pstage-${this.id}`);
    if (!stage) return;

    let ov = stage.querySelector('.party-sync-ov');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'party-sync-ov';
      ov.style.cssText = [
        'position:absolute;bottom:12px;right:12px;z-index:20',
        'background:rgba(0,0,0,.72);border:1px solid rgba(255,255,255,.12)',
        'border-radius:8px;padding:5px 12px',
        'font-family:Inter,sans-serif;font-size:.72rem;color:rgba(255,255,255,.8)',
        'display:flex;align-items:center;gap:6px',
        'pointer-events:none;transition:opacity .4s',
      ].join(';');
      stage.appendChild(ov);
    }

    const m = Math.floor(position / 60);
    const s = String(Math.floor(position % 60)).padStart(2, '0');
    ov.innerHTML = `<span>${playing ? '▶' : '⏸'}</span> Party sync · ${m}:${s}`;
    ov.style.opacity = '1';
    clearTimeout(this._syncOvTimer);
    this._syncOvTimer = setTimeout(() => { ov.style.opacity = '0'; }, 3500);
  }

  destroy() {
    clearInterval(this._posTracker);
    clearTimeout(this._timer);
    window._partyPlayerHandle = null;
  }
}

window["4reelsPlayer"] = Player;
window["4reelsPlayer"] = Player; // backward compat
