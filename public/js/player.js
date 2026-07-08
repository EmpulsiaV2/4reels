/* LUVENN — Multi-server player with Party sync */
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
  { id:'strigil', name:'Strigil',  badge:'HD', url: id=>`https://vidsrc.cc/v2/embed/movie/${id}` },
  { id:'vidup',   name:'VidUp',    badge:'HD', url: id=>`https://vidsrc.me/embed/movie/${id}` },
  { id:'vidcore', name:'VidCore',  badge:'4K', url: id=>`https://vidsrc.pro/embed/movie/${id}` },
  { id:'videasy', name:'VidEasy',  badge:'HD', url: id=>`https://player.videasy.net/movie/${id}` },
  { id:'vidplus', name:'VidPlus',  badge:'HD', url: id=>`https://vidlink.pro/movie/${id}?autoplay=true` },
  { id:'vidsrc0', name:'Vidsrc0',  badge:'HD', url: id=>`https://vidsrc.to/embed/movie/${id}` },
  { id:'adrock',  name:'AdRock',   badge:'4K', url: id=>`https://vidsrc.su/embed/movie/${id}` },
  { id:'vidnest', name:'VidNest',  badge:'HD', url: id=>`https://multiembed.mov/directstream.php?video_id=${id}&tmdb=1` },
  { id:'vidlink', name:'VidLink',  badge:'HD', url: id=>`https://www.2embed.cc/embed/${id}` },
  { id:'vidify',  name:'Vidify',   badge:'HD', url: id=>`https://player.autoembed.cc/embed/movie/${id}` },
  { id:'vidzee',  name:'Vidzee',   badge:'4K', url: id=>`https://vidzee.wtf/movie/${id}` },
];

class Player {
  constructor(containerId, tmdbId) {
    this.el       = document.getElementById(containerId);
    this.id       = String(tmdbId);
    this.cur      = 0;
    this._timer   = null;
    this._pos     = 0;       // best-effort local position
    this._playing = false;
    if (!this.el) return;

    // Read preferred server from settings
    try {
      const prefs = JSON.parse(localStorage.getItem('luvenn_prefs')||'{}');
      if (prefs.defaultServer != null) this.cur = +prefs.defaultServer;
    } catch {}

    this._render();

    // Register as party player handle for sync
    window._partyPlayerHandle = {
      sync:        (s) => this._partySync(s),
      getPosition: ()  => this._pos,
    };
  }

  _render() {
    this.el.innerHTML = `
      <div class="player-shell">
        <div class="server-bar">
          <span class="srv-label">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            Server
          </span>
          <div class="srv-btns" id="sbtns-${this.id}">
            ${SERVERS.map((s,i)=>`<button class="srv-btn${i===this.cur?' active':''}" data-idx="${i}">${s.name}<span class="srv-badge">${s.badge}</span></button>`).join('')}
          </div>
          <span class="adblock-pill"><span class="adblock-dot"></span>Ads Blocked</span>
        </div>
        <div class="player-stage" id="pstage-${this.id}">
          <div class="player-overlay" id="povl-${this.id}">
            <div class="pspinner"></div>
            <span class="povl-txt">Loading <strong id="pname-${this.id}">${SERVERS[this.cur].name}</strong>…</span>
          </div>
          <iframe id="pif-${this.id}" referrerpolicy="no-referrer"
            allow="fullscreen *; autoplay *; picture-in-picture *; encrypted-media *"
            style="position:absolute;inset:0;width:100%;height:100%;border:none;background:#000"></iframe>
        </div>
      </div>`;

    document.getElementById(`sbtns-${this.id}`)
      ?.addEventListener('click', e => {
        const b = e.target.closest('.srv-btn');
        if (b) this._load(+b.dataset.idx);
      });

    this._load(this.cur);

    // Estimate position via elapsed time (since iframes are sandboxed)
    this._posTracker = setInterval(() => {
      if (this._playing) this._pos += 1;
    }, 1000);
  }

  _load(idx) {
    this.cur = idx;
    const srv   = SERVERS[idx];
    const iframe= document.getElementById(`pif-${this.id}`);
    const ovl   = document.getElementById(`povl-${this.id}`);
    const name  = document.getElementById(`pname-${this.id}`);

    document.querySelectorAll(`#sbtns-${this.id} .srv-btn`)
      .forEach((b,i) => b.classList.toggle('active', i === idx));

    if (!iframe) return;
    if (ovl) ovl.style.display = 'flex';
    if (name) name.textContent = srv.name;

    iframe.src = 'about:blank';
    clearTimeout(this._timer);
    setTimeout(() => {
      iframe.src = srv.url(this.id);
      iframe.referrerPolicy = 'no-referrer';
      const done = () => {
        clearTimeout(this._timer);
        if (ovl) ovl.style.display = 'none';
        this._playing = true;
        iframe.removeEventListener('load', done);
      };
      iframe.addEventListener('load', done);
      this._timer = setTimeout(() => { if (ovl) ovl.style.display = 'none'; this._playing = true; }, 14000);
    }, 150);
  }

  // ── Party sync ────────────────────────────────────────
  // Called by Party.sync engine with { playing, position }
  // Since iframes are sandboxed we can't control playback directly,
  // but we can reload at the right position via URL params where supported.
  _partySync({ playing, position }) {
    this._pos     = position;
    this._playing = playing;

    // Servers that support time param
    const srv = SERVERS[this.cur];
    const srvId = srv.id;

    let url = srv.url(this.id);

    // Append time where supported
    if (['videasy','vidplus','vidcore','vidify'].includes(srvId)) {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}t=${Math.floor(position)}`;
    }

    // Only reload if position drift > 5 seconds (avoid thrash)
    const iframe = document.getElementById(`pif-${this.id}`);
    if (!iframe) return;

    // For play/pause: we can only show a visual overlay telling the user
    const stage = document.getElementById(`pstage-${this.id}`);
    this._showSyncOverlay(stage, playing, position);
  }

  _showSyncOverlay(stage, playing, position) {
    let overlay = stage?.querySelector('.party-sync-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'party-sync-overlay';
      overlay.style.cssText = `
        position:absolute;bottom:10px;right:10px;z-index:10;
        background:rgba(11,12,16,.85);border:1px solid var(--bdr2);
        border-radius:var(--r3);padding:6px 10px;
        font-family:var(--fh);font-size:.72rem;color:var(--tx1);
        display:flex;align-items:center;gap:6px;
        pointer-events:none;transition:opacity .3s;
      `;
      stage?.appendChild(overlay);
    }

    const icon = playing ? '▶' : '⏸';
    const mins = Math.floor(position / 60);
    const secs = String(Math.floor(position % 60)).padStart(2, '0');
    overlay.innerHTML = `<span style="color:var(--ac)">${icon}</span> Party sync · ${mins}:${secs}`;
    overlay.style.opacity = '1';
    clearTimeout(this._syncOverlayTimer);
    this._syncOverlayTimer = setTimeout(() => { if (overlay) overlay.style.opacity = '0'; }, 3000);
  }

  destroy() {
    clearInterval(this._posTracker);
    clearTimeout(this._timer);
    if (window._partyPlayerHandle?.getPosition === (() => this._pos)) {
      window._partyPlayerHandle = null;
    }
  }
}

window.LuvennPlayer = Player;
