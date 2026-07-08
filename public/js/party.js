/* ══════════════════════════════════════════════════════
   4reels PARTY — Client-side WebSocket sync engine
   ══════════════════════════════════════════════════════ */
'use strict';

const Party = (() => {

  // ── State ─────────────────────────────────────────────
  let ws            = null;
  let reconnTimer   = null;
  let pingTimer     = null;
  let code          = null;   // current party code
  let room          = null;   // snapshot from server
  let isHost        = false;
  let panelOpen     = false;

  // Sync engine state
  let syncInterval  = null;
  const SYNC_EVERY  = 8000;   // re-request sync every 8s

  // Latency estimate (round-trip / 2)
  let latency = 0;
  let lastPingTs = 0;

  // ── DOM helpers ────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function toast(msg, type='') {
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' '+type : '');
    t.textContent = msg;
    const wrap = document.getElementById('toast-wrap');
    if (wrap) { wrap.appendChild(t); setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .25s'; setTimeout(()=>t.remove(),260); }, 3000); }
  }

  // ── WebSocket connect ─────────────────────────────────
  function connect(partyCode) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    clearTimeout(reconnTimer);

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws/party`);

    ws.addEventListener('open', () => {
      clearTimeout(reconnTimer);
      // Send join message immediately
      const user = Party._getUser();
      ws.send(JSON.stringify({ type: 'join', code: partyCode, user }));
      // Start heartbeat
      startPing();
      // Periodic sync requests
      syncInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'sync_request' }));
        }
      }, SYNC_EVERY);
    });

    ws.addEventListener('message', e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleMessage(msg);
    });

    ws.addEventListener('close', e => {
      clearInterval(syncInterval);
      clearInterval(pingTimer);
      // Auto-reconnect unless we intentionally left
      if (code && e.code !== 1000 && e.code !== 4000) {
        reconnTimer = setTimeout(() => {
          if (code) connect(code);
        }, 2500);
        updateConnectionStatus('reconnecting');
      }
    });

    ws.addEventListener('error', () => {});
  }

  function startPing() {
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        lastPingTs = Date.now();
        ws.send(JSON.stringify({ type: '__ping', ts: lastPingTs }));
      }
    }, 20000);
  }

  // ── Message handler ────────────────────────────────────
  function handleMessage(msg) {
    // Measure latency from pong
    if (msg.type === '__pong') {
      latency = Math.round((Date.now() - (msg.ts || lastPingTs)) / 2);
      return;
    }

    switch (msg.type) {

      case 'room_state':
        room    = msg.room;
        code    = room.code;
        isHost  = (room.hostId === Party._getUser()?.id?.toString());
        renderRoom();
        break;

      case 'created':
        room   = msg.room;
        code   = room.code;
        isHost = true;
        renderRoom();
        toast('Party created! Share the code with friends 🎉', 'success');
        break;

      case 'movie_changed':
        if (room) room.movie = msg.movie;
        renderNowWatching();
        addSystemMsg(`Host changed the movie to "${esc(msg.movie?.title || 'something new')}"`);
        // Navigate all members to the new movie's watch page
        if (!isHost && msg.movie?.tmdbId) {
          navigateToMovie(msg.movie.tmdbId);
        }
        break;

      case 'play':
        syncPlayback({ playing: true, position: msg.position, serverTs: msg.server_ts });
        addSystemMsg('▶ Host resumed playback');
        break;

      case 'pause':
        syncPlayback({ playing: false, position: msg.position, serverTs: msg.server_ts });
        addSystemMsg('⏸ Host paused');
        break;

      case 'seek':
        syncPlayback({ playing: msg.playing, position: msg.position, serverTs: msg.server_ts });
        addSystemMsg(`⏩ Host seeked to ${formatTime(msg.position)}`);
        break;

      case 'sync':
        // Authoritative sync response — apply immediately
        syncPlayback({ playing: msg.playing, position: msg.position, serverTs: msg.server_ts });
        break;

      case 'member_joined':
        if (room) {
          // Optimistically add member to local state
          room.members = room.members || [];
        }
        renderMembers(msg);
        addSystemMsg(`${esc(msg.displayName || msg.username)} joined the party`);
        break;

      case 'member_left':
        addSystemMsg('Someone left the party');
        renderMembers();
        break;

      case 'host_changed':
        isHost = (String(msg.newHostId) === String(Party._getUser()?.id));
        if (room) room.hostId = msg.newHostId;
        addSystemMsg(`${esc(msg.newHostUsername)} is now the host`);
        if (isHost) toast("You're now the party host! 👑", 'success');
        renderHostControls();
        renderMembers();
        break;

      case 'chat':
        addChatMsg(msg);
        break;

      case 'error':
        toast(msg.message, 'err');
        break;
    }
  }

  // ── Sync engine ────────────────────────────────────────
  // Apply playback state from host, correcting for latency + server timestamp drift
  function syncPlayback({ playing, position, serverTs }) {
    const now      = Date.now();
    const elapsed  = serverTs ? (now - serverTs) / 1000 : latency / 1000;
    let   targetPos = position + (playing ? elapsed : 0);

    // Tell the active player to sync
    const player = getActivePlayer();
    if (!player) return;

    player.sync({ playing, position: targetPos });
  }

  function getActivePlayer() {
    // 4reelsPlayer exposes a global sync handle when on a watch page
    return window._partyPlayerHandle || null;
  }

  function navigateToMovie(tmdbId) {
    // Use the SPA router to navigate
    if (window.router) window.router.go(`/movie/${tmdbId}/watch`);
  }

  function formatTime(secs) {
    if (!secs && secs !== 0) return '—';
    const s = Math.floor(secs);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}:${String(m % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
    return `${m}:${String(s % 60).padStart(2,'0')}`;
  }

  // ── Send helpers (host only) ───────────────────────────
  function send(msg) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function hostPlay(position) {
    if (!isHost) return;
    send({ type: 'play', position });
  }

  function hostPause(position) {
    if (!isHost) return;
    send({ type: 'pause', position });
  }

  function hostSeek(position) {
    if (!isHost) return;
    send({ type: 'seek', position });
  }

  function hostSetMovie(movie) {
    if (!isHost) return;
    send({ type: 'set_movie', movie });
    // Navigate host to watch page too
    if (movie?.tmdbId) navigateToMovie(movie.tmdbId);
  }

  // ── UI rendering ───────────────────────────────────────
  function openPanel() {
    ensureModal();
    const overlay = $('party-overlay');
    if (overlay) { overlay.classList.add('open'); document.body.classList.add('noscroll'); }
    panelOpen = true;
    if (room) renderRoom();
    else renderSetup();
  }

  function closePanel() {
    const overlay = $('party-overlay');
    if (overlay) { overlay.classList.remove('open'); document.body.classList.remove('noscroll'); }
    panelOpen = false;
  }

  function ensureModal() {
    if ($('party-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'party-overlay';
    overlay.className = 'party-overlay';
    overlay.innerHTML = `
      <div class="party-panel" id="party-panel">
        <div class="party-panel-hdr">
          <h2>🎉 Watch Party</h2>
          <button class="party-panel-close" id="party-close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div id="party-body"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) closePanel(); });
    $('party-close').addEventListener('click', closePanel);
  }

  function renderSetup() {
    const body = $('party-body'); if (!body) return;
    body.innerHTML = `
      <div class="party-setup">
        <p>Watch movies in sync with friends — no lag, no out-of-sync moments. The host controls playback for everyone.</p>
        <div class="party-setup-btns">
          <button class="btn-pri" id="party-create-btn">+ Create Party</button>
        </div>
        <div class="party-divider">or join one</div>
        <div class="party-code-input">
          <input type="text" id="party-join-code" placeholder="Enter 6-letter code" maxlength="6" autocomplete="off" spellcheck="false"/>
          <button class="btn-gho" id="party-join-btn">Join</button>
        </div>
        <div id="party-join-err" style="font-size:.78rem;color:#ef4444;margin-top:8px;display:none"></div>
      </div>`;

    $('party-create-btn').addEventListener('click', () => {
      const user = Party._getUser();
      if (!user) { toast('Sign in to create a party', 'err'); return; }
      // Connect WS and create
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/ws/party`);
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'create', user }));
        startPing();
        syncInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sync_request' }));
        }, SYNC_EVERY);
      });
      ws.addEventListener('message', e => { try { handleMessage(JSON.parse(e.data)); } catch {} });
      ws.addEventListener('close', () => { clearInterval(syncInterval); clearInterval(pingTimer); });
    });

    const joinInput = $('party-join-code');
    const joinBtn   = $('party-join-btn');
    const joinErr   = $('party-join-err');

    joinInput?.addEventListener('input', () => {
      joinInput.value = joinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    joinInput?.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });

    joinBtn?.addEventListener('click', async () => {
      const enteredCode = joinInput.value.trim().toUpperCase();
      if (enteredCode.length < 4) { joinErr.textContent = 'Please enter a valid party code.'; joinErr.style.display = ''; return; }
      const user = Party._getUser();
      if (!user) { toast('Sign in to join a party', 'err'); return; }
      joinErr.style.display = 'none';
      joinBtn.disabled = true; joinBtn.textContent = 'Joining…';
      try {
        // Validate code exists
        const r = await fetch(`/api/party/exists/${enteredCode}`);
        if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Party not found.'); }
        // Connect
        code = enteredCode;
        connect(enteredCode);
      } catch (e) {
        joinErr.textContent = e.message; joinErr.style.display = '';
      } finally {
        joinBtn.disabled = false; joinBtn.textContent = 'Join';
      }
    });
  }

  function renderRoom() {
    const body = $('party-body'); if (!body || !room) return;
    const user = Party._getUser();

    body.innerHTML = `
      <!-- Code display -->
      <div class="party-room-info">
        <div class="party-code-display">
          <div>
            <div style="font-size:.67rem;color:var(--tx3);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Party Code</div>
            <div class="party-code-val">${esc(room.code)}</div>
          </div>
          <button class="party-copy-btn" id="party-copy">Copy</button>
        </div>
        <div style="font-size:.74rem;color:var(--tx2)">Share this code — friends can join from the party panel</div>
      </div>

      <!-- Now watching -->
      <div class="party-now-watching" id="party-now-watching">
        ${room.movie
          ? `<img class="party-nw-poster" src="${esc(room.movie.poster||'')}" alt="" onerror="this.style.background='var(--s4)';this.src=''"/>
             <div class="party-nw-info">
               <div class="party-nw-label">Now Watching</div>
               <div class="party-nw-title">${esc(room.movie.title)}</div>
             </div>`
          : `<div class="party-nw-info"><div class="party-nw-empty">No movie selected yet</div></div>`}
      </div>

      <!-- Members -->
      <div class="party-members">
        <div class="party-members-ttl">Members (${room.members?.length || 0})</div>
        <div class="party-members-list" id="party-members-list">
          ${(room.members || []).map(m => renderMemberChip(m, room.hostId)).join('')}
        </div>
      </div>

      <!-- Host controls -->
      ${renderHostControlsHTML()}

      <!-- Chat -->
      <div class="party-chat">
        <div class="party-chat-msgs" id="party-chat-msgs">
          <div class="party-system-msg">Party started — say hi! 👋</div>
        </div>
        <div class="party-chat-input">
          <input type="text" id="party-chat-in" placeholder="Say something…" maxlength="200" autocomplete="off"/>
          <button id="party-chat-send">Send</button>
        </div>
      </div>

      <!-- Leave button -->
      <div style="padding:10px 18px;border-top:1px solid var(--bdr);flex-shrink:0">
        <button class="btn-danger" id="party-leave-btn" style="width:100%;justify-content:center">Leave Party</button>
      </div>`;

    // Wire copy
    $('party-copy')?.addEventListener('click', () => {
      navigator.clipboard.writeText(room.code).then(() => {
        const btn = $('party-copy');
        btn.textContent = 'Copied!'; btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      }).catch(() => { toast('Copy failed'); });
    });

    // Wire host controls
    wireHostControls();

    // Wire chat
    const chatIn   = $('party-chat-in');
    const chatSend = $('party-chat-send');
    const sendChat = () => {
      const text = chatIn.value.trim();
      if (!text) return;
      send({ type: 'chat', text });
      chatIn.value = '';
    };
    chatSend?.addEventListener('click', sendChat);
    chatIn?.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

    // Wire leave
    $('party-leave-btn')?.addEventListener('click', leaveParty);

    // Scroll chat to bottom
    scrollChat();
  }

  function renderMemberChip(m, hostId) {
    return `<div class="party-member">
      <div class="party-member-av" style="background:${esc(m.avatarColor||'var(--s4)')}">${esc((m.displayName||m.username||'?').slice(0,2).toUpperCase())}</div>
      <span class="party-member-name">${esc(m.displayName||m.username)}</span>
      ${String(m.userId) === String(hostId) ? '<span class="party-host-crown">👑</span>' : ''}
    </div>`;
  }

  function renderHostControlsHTML() {
    if (!isHost) return '';
    const playing = room?.state?.playing;
    return `<div class="party-host-controls" id="party-host-controls">
      <span class="party-hc-label">👑 Host Controls</span>
      <div class="party-hc-btns">
        <button class="party-hc-btn primary" id="phc-play-pause">
          ${playing ? '⏸ Pause All' : '▶ Play All'}
        </button>
        <button class="party-hc-btn" id="phc-sync">⟳ Sync All</button>
        ${room?.movie ? `<button class="party-hc-btn" id="phc-change">Change Movie</button>` : ''}
      </div>
    </div>`;
  }

  function renderHostControls() {
    const existing = $('party-host-controls');
    if (!isHost) { if (existing) existing.remove(); return; }
    if (existing) existing.outerHTML = renderHostControlsHTML();
    wireHostControls();
  }

  function wireHostControls() {
    if (!isHost) return;
    $('phc-play-pause')?.addEventListener('click', () => {
      const handle = getActivePlayer();
      const pos    = handle?.getPosition() ?? 0;
      const playing = room?.state?.playing;
      if (playing) hostPause(pos); else hostPlay(pos);
    });

    $('phc-sync')?.addEventListener('click', () => {
      const handle  = getActivePlayer();
      const pos     = handle?.getPosition() ?? 0;
      const playing = room?.state?.playing;
      // Re-broadcast current state
      send({ type: playing ? 'play' : 'pause', position: pos });
      toast('Synced all members ✓', 'success');
    });

    $('phc-change')?.addEventListener('click', () => {
      closePanel();
      // Show a movie search UI
      openMoviePicker();
    });
  }

  function renderNowWatching() {
    const el = $('party-now-watching'); if (!el || !room) return;
    el.innerHTML = room.movie
      ? `<img class="party-nw-poster" src="${esc(room.movie.poster||'')}" alt="" onerror="this.style.background='var(--s4)';this.src=''"/>
         <div class="party-nw-info">
           <div class="party-nw-label">Now Watching</div>
           <div class="party-nw-title">${esc(room.movie.title)}</div>
         </div>`
      : `<div class="party-nw-info"><div class="party-nw-empty">No movie selected yet</div></div>`;
  }

  function renderMembers(newMemberData) {
    // Re-fetch from server by sending sync_request; for now update count
    const list = $('party-members-list');
    const ttl  = document.querySelector('.party-members-ttl');
    if (!list || !room) return;
    // Add new member chip if join event
    if (newMemberData?.type === 'member_joined') {
      const chip = document.createElement('div');
      chip.className = 'party-member';
      chip.innerHTML = `
        <div class="party-member-av" style="background:${esc(newMemberData.avatarColor||'var(--s4)')}">${esc((newMemberData.displayName||newMemberData.username||'?').slice(0,2).toUpperCase())}</div>
        <span class="party-member-name">${esc(newMemberData.displayName||newMemberData.username)}</span>`;
      list.appendChild(chip);
    }
    if (ttl) ttl.textContent = `Members (${newMemberData?.memberCount || list.children.length})`;
  }

  function addSystemMsg(text) {
    const msgs = $('party-chat-msgs'); if (!msgs) return;
    const div  = document.createElement('div');
    div.className   = 'party-system-msg';
    div.textContent = text;
    msgs.appendChild(div);
    scrollChat();
  }

  function addChatMsg(msg) {
    const msgs = $('party-chat-msgs'); if (!msgs) return;
    const div  = document.createElement('div');
    div.className = 'party-msg';
    div.innerHTML = `
      <div class="party-msg-av" style="background:${esc(msg.avatarColor||'var(--s4)')}">${esc((msg.displayName||'?').slice(0,2).toUpperCase())}</div>
      <div class="party-msg-body">
        <div class="party-msg-meta"><strong>${esc(msg.displayName)}</strong></div>
        <div class="party-msg-text">${esc(msg.text)}</div>
      </div>`;
    msgs.appendChild(div);
    scrollChat();
  }

  function scrollChat() {
    const msgs = $('party-chat-msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function updateConnectionStatus(status) {
    const btn = document.querySelector('.party-status-btn');
    if (!btn) return;
    if (status === 'reconnecting') btn.textContent = '⟳ Reconnecting…';
  }

  // ── Movie picker overlay ────────────────────────────────
  function openMoviePicker() {
    const existing = document.getElementById('party-picker-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'party-picker-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
      <div style="background:var(--s2);border:1px solid var(--bdr);border-radius:var(--r5);width:100%;max-width:500px;max-height:85vh;display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--bdr);flex-shrink:0">
          <h3 style="font-family:var(--fh);font-size:.95rem;font-weight:700">Pick a Movie</h3>
          <button id="party-picker-close" style="background:none;border:none;color:var(--tx2);cursor:pointer;display:flex;align-items:center">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div style="padding:12px 16px;border-bottom:1px solid var(--bdr);flex-shrink:0">
          <input type="text" id="party-picker-search" placeholder="Search movies…" autocomplete="off"
            style="width:100%;padding:8px 11px;background:var(--s1);border:1px solid var(--bdr);border-radius:var(--r3);color:var(--tx1);font-family:var(--fb);font-size:.85rem;outline:none"/>
        </div>
        <div id="party-picker-results" style="overflow-y:auto;flex:1;padding:8px 0"></div>
        <div style="padding:10px 16px;border-top:1px solid var(--bdr);font-size:.73rem;color:var(--tx3);flex-shrink:0">
          Selecting a movie will navigate all party members to its watch page.
        </div>
      </div>`;
    document.body.appendChild(overlay);

    $('party-picker-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    let searchTimer = null;
    const searchInp = $('party-picker-search');
    const resultsEl = $('party-picker-results');

    const loadDefault = async () => {
      resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--tx2);font-size:.82rem">Loading trending movies…</div>';
      try {
        const r    = await fetch('/api/trending?page=1');
        const data = await r.json();
        renderPickerResults(data.results || [], resultsEl, overlay);
      } catch {
        resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--tx3);font-size:.82rem">Could not load movies.</div>';
      }
    };

    loadDefault();

    searchInp.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInp.value.trim();
      if (!q) { loadDefault(); return; }
      searchTimer = setTimeout(async () => {
        resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--tx2);font-size:.82rem">Searching…</div>';
        try {
          const r    = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
          const data = await r.json();
          renderPickerResults(data.results || [], resultsEl, overlay);
        } catch {
          resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--tx3)">Search failed.</div>';
        }
      }, 350);
    });
  }

  function renderPickerResults(movies, container, overlay) {
    if (!movies.length) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:.82rem">No results found.</div>';
      return;
    }
    container.innerHTML = movies.map(m => `
      <div class="party-picker-item" data-id="${m.tmdbId||m.id}" data-title="${esc(m.title)}" data-poster="${esc(m.poster||'')}"
        style="display:flex;align-items:center;gap:11px;padding:9px 16px;cursor:pointer;border-bottom:1px solid var(--bdr);transition:background .14s">
        <img src="${esc(m.poster||'')}" alt="" style="width:32px;height:48px;border-radius:3px;object-fit:cover;background:var(--s4);flex-shrink:0" onerror="this.src=''"/>
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--fh);font-size:.82rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.title)}</div>
          <div style="font-size:.7rem;color:var(--tx2);margin-top:2px">${esc(m.year||'')} · ★ ${esc(m.rating?.toFixed?.(1)||'N/A')}</div>
        </div>
        <span style="font-size:.72rem;color:var(--ac);font-weight:600;flex-shrink:0">Select →</span>
      </div>`).join('');

    container.querySelectorAll('.party-picker-item').forEach(item => {
      item.addEventListener('mouseenter', () => item.style.background = 'var(--s3)');
      item.addEventListener('mouseleave', () => item.style.background = '');
      item.addEventListener('click', () => {
        const movie = {
          tmdbId: item.dataset.id,
          title:  item.dataset.title,
          poster: item.dataset.poster,
        };
        hostSetMovie(movie);
        overlay.remove();
        openPanel();
        toast(`Now watching: ${movie.title}`, 'success');
      });
    });
  }

  // ── Leave party ─────────────────────────────────────────
  function leaveParty() {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'leave' }));
      ws.close(1000);
    }
    clearInterval(syncInterval);
    clearInterval(pingTimer);
    clearTimeout(reconnTimer);
    ws = null; room = null; code = null; isHost = false;
    closePanel();
    toast('Left the party.');
    // Re-render setup next time panel opens
    const body = $('party-body'); if (body) renderSetup();
    // Update party buttons
    updatePartyButtons();
  }

  // ── Party buttons in watch page ─────────────────────────
  function updatePartyButtons() {
    document.querySelectorAll('.party-btn').forEach(btn => {
      btn.classList.toggle('in-party', !!room);
      btn.innerHTML = room
        ? `<span class="party-dot"></span>${isHost ? '👑 Party (Host)' : '🎉 In Party'}`
        : `🎉 Watch Party`;
    });
  }

  // ── Public API ─────────────────────────────────────────
  return {
    open:         openPanel,
    close:        closePanel,
    leave:        leaveParty,
    isInParty:    () => !!room,
    isHosting:    () => isHost,
    getCode:      () => code,
    hostPlay,
    hostPause,
    hostSeek,
    hostSetMovie,

    // Called by player.js to broadcast host actions
    onPlayerPlay:  (pos) => { if (isHost && room) hostPlay(pos); },
    onPlayerPause: (pos) => { if (isHost && room) hostPause(pos); },
    onPlayerSeek:  (pos) => { if (isHost && room) hostSeek(pos); },

    // Set current movie from the current watch page
    setCurrentMovie(tmdbId, title, poster) {
      if (isHost && room) hostSetMovie({ tmdbId: String(tmdbId), title, poster });
    },

    // Get current user from Auth
    _getUser() {
      try {
        const u = JSON.parse(localStorage.getItem('4reels_user') || 'null');
        return u;
      } catch { return null; }
    },

    // Inject a party button into any container element
    injectButton(container) {
      if (!container) return;
      const btn = document.createElement('button');
      btn.className = 'party-btn';
      btn.innerHTML = room
        ? `<span class="party-dot"></span>${isHost ? '👑 Party (Host)' : '🎉 In Party'}`
        : '🎉 Watch Party';
      btn.addEventListener('click', openPanel);
      container.appendChild(btn);
    },
  };
})();

window.Party = Party;
