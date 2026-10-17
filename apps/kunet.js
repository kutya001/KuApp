/**
 * KuNet — сетевая игра для пошаговых игр KuApp через Google Apps Script.
 *
 * Подключение в игре:   <script src="kunet.js"></script>
 *
 *   const sess = KuNet.session('tictac');
 *   KuNet.openLobby({
 *     game: 'tictac', title: 'Крестики-нолики',
 *     initialState: () => ({ board: Array(9).fill(null) }),
 *     onStart: (sess) => { ... }        // комната укомплектована, можно играть
 *   });
 *
 *   sess.seat            // 0 — создатель комнаты (ходит первым), 1 — гость
 *   sess.isMyTurn()
 *   sess.move(state, nextTurn, moveInfo, finished)   // мой ход
 *   sess.reset(state, turn)                          // новая партия
 *   sess.leave()
 *   sess.onUpdate = (room) => { ... }   // пришло новое состояние
 *   sess.onClosed = (room) => { ... }   // соперник вышел
 *   sess.startPolling(); sess.stopPolling();
 *
 * Сервер: gas/Code.gs, действия room* (комнаты в CacheService).
 */
(function () {
  'use strict';

  var FALLBACK_URL = 'https://script.google.com/macros/s/AKfycbz1UKFwY4nUUQkVVSgupHY6SREofWFy2qDhlEhpP7dUaUIKmjdO-k7GqPKw0QHC0aj1yg/exec';
  var REQUEST_TIMEOUT = 20000;

  function platform() {
    try { return (window.parent && window.parent !== window && window.parent.PlatformAPI) || null; }
    catch (e) { return null; }
  }

  function gasUrl() {
    var api = platform();
    try { var u = api && api.db && api.db.getGasUrl && api.db.getGasUrl(); if (u) return u; } catch (e) {}
    return FALLBACK_URL;
  }

  function myToken() {
    var api = platform();
    try { return (api && api.user && api.user.getToken && api.user.getToken()) || null; } catch (e) { return null; }
  }

  /** Вошёл ли пользователь по коду (гостям сеть недоступна). */
  function isLoggedIn() {
    var api = platform();
    try { return !!(api && api.user && !api.user.isGuest()); } catch (e) { return false; }
  }

  function myName() {
    var api = platform();
    try {
      var p = api && api.user && api.user.getProfile && api.user.getProfile();
      if (p && !p.isGuest) return String(p.name || p.playerId || p.login);
    } catch (e) {}
    var g = null;
    try { g = sessionStorage.getItem('kunet_guest'); } catch (e) {}
    if (!g) {
      g = 'Гость-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      try { sessionStorage.setItem('kunet_guest', g); } catch (e) {}
    }
    return g;
  }

  function call(action, params) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT) : null;
    var body = { action: action, params: params || {} };
    var token = myToken();
    if (token) body.token = token;          // сессия платформы: roomCreate/roomJoin требуют входа по коду
    return fetch(gasUrl(), {
      method: 'POST',
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      if (!d.ok) throw new Error(d.error || 'Ошибка сервера');
      return d.data;
    }).catch(function (e) {
      if (e && e.name === 'AbortError') throw new Error('Сервер не ответил, проверьте сеть');
      throw e;
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  /* ───────────────────────── Session ───────────────────────── */

  function Session(game) {
    this.game = game;
    this.room = null;
    this.token = null;
    this.seat = -1;
    this.onUpdate = null;      // (room) => void — новое состояние от соперника
    this.onClosed = null;      // (room) => void — соперник вышел
    this.onError = null;       // (err) => void — ошибка сети при опросе
    this.pollTimer = null;
    this.polling = false;
    this.busy = false;         // идёт запрос, который меняет состояние
    this.pollInterval = 2000;
    this.pollIntervalIdle = 4000;
    this.lastError = null;
  }

  Session.prototype._apply = function (room) {
    if (!room || room.unchanged) return false;
    if (room.token) this.token = room.token;
    if (typeof room.seat === 'number' && room.seat >= 0) this.seat = room.seat;
    var prevVer = this.room ? this.room.ver : -1;
    this.room = room;
    return room.ver !== prevVer;
  };

  Session.prototype.create = function (state, meta) {
    var self = this;
    return call('roomCreate', { game: this.game, player: myName(), state: state, meta: meta || null })
      .then(function (room) { self._apply(room); return room; });
  };

  Session.prototype.join = function (id) {
    var self = this;
    return call('roomJoin', { id: String(id || '').toUpperCase().trim(), player: myName() })
      .then(function (room) { self._apply(room); return room; });
  };

  Session.prototype.list = function () {
    return call('roomList', { game: this.game }).then(function (d) { return d.rooms || []; });
  };

  Session.prototype.isMyTurn = function () {
    return !!this.room && this.room.status === 'playing' && this.room.turn === this.seat;
  };
  Session.prototype.opponentName = function () {
    if (!this.room || this.seat < 0) return '';
    return this.room.players[1 - this.seat] || '';
  };
  Session.prototype.status = function () { return this.room ? this.room.status : 'none'; };

  /** Отправить мой ход: новое состояние целиком + кому ходить дальше. */
  Session.prototype.move = function (state, nextTurn, moveInfo, finished) {
    var self = this;
    if (!this.room) return Promise.reject(new Error('Нет комнаты'));
    this.busy = true;
    return call('roomMove', {
      id: this.room.id, token: this.token, ver: this.room.ver,
      state: state, turn: nextTurn, move: moveInfo === undefined ? null : moveInfo, finished: !!finished
    }).then(function (room) {
      var stale = !!room.stale;
      self._apply(room);
      if (stale) { if (self.onUpdate) self.onUpdate(room, true); throw new Error('Ход отклонён: состояние устарело'); }
      return room;
    }).finally(function () { self.busy = false; });
  };

  /** Новая партия в той же комнате. */
  Session.prototype.reset = function (state, turn) {
    var self = this;
    if (!this.room) return Promise.reject(new Error('Нет комнаты'));
    this.busy = true;
    return call('roomReset', { id: this.room.id, token: this.token, state: state, round: this.room.round, turn: turn || 0 })
      .then(function (room) { self._apply(room); return room; })
      .finally(function () { self.busy = false; });
  };

  Session.prototype.leave = function () {
    var self = this;
    this.stopPolling();
    if (!this.room || !this.token) return Promise.resolve();
    var id = this.room.id, token = this.token;
    this.room = null; this.token = null; this.seat = -1;
    return call('roomLeave', { id: id, token: token }).catch(function () {});
  };

  /** Попытка уведомить сервер при закрытии вкладки (best effort). */
  Session.prototype.leaveBeacon = function () {
    if (!this.room || !this.token || !navigator.sendBeacon) return;
    try {
      var body = JSON.stringify({ action: 'roomLeave', params: { id: this.room.id, token: this.token } });
      navigator.sendBeacon(gasUrl(), new Blob([body], { type: 'text/plain' }));
    } catch (e) {}
  };

  Session.prototype.refresh = function () {
    var self = this;
    if (!this.room) return Promise.resolve(null);
    return call('roomGet', { id: this.room.id, ver: this.room.ver, token: this.token }).then(function (room) {
      self.lastError = null;
      if (room.unchanged) return null;
      var changed = self._apply(room);
      if (room.status === 'closed') { if (self.onClosed) self.onClosed(room); return room; }
      if (changed && self.onUpdate) self.onUpdate(room, false);
      return room;
    }).catch(function (e) {
      self.lastError = e;
      if (self.onError) self.onError(e);
      return null;
    });
  };

  Session.prototype.startPolling = function () {
    var self = this;
    this.stopPolling();
    this.polling = true;
    var tick = function () {
      if (!self.polling) return;
      var p = (self.busy || !self.room) ? Promise.resolve(null) : self.refresh();
      p.then(function () {
        if (!self.polling) return;
        var idle = self.isMyTurn() && self.room && self.room.status === 'playing';
        var wait = idle ? self.pollIntervalIdle : self.pollInterval;
        if (document.hidden) wait = Math.max(wait, 6000);
        self.pollTimer = setTimeout(tick, wait);
      });
    };
    this.pollTimer = setTimeout(tick, 300);
  };

  Session.prototype.stopPolling = function () {
    this.polling = false;
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
  };

  /* ───────────────────────── Lobby UI ───────────────────────── */

  var CSS = [
    '.kn-ov{position:fixed;inset:0;z-index:9000;background:rgba(6,6,12,.92);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;color:#f0f0f8;padding:16px}',
    '.kn-box{width:100%;max-width:360px;background:#121218;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);max-height:92vh;overflow:auto;-webkit-overflow-scrolling:touch}',
    '.kn-h{font-size:1.1rem;font-weight:800;text-align:center;letter-spacing:.06em;margin-bottom:4px}',
    '.kn-sub{font-size:.7rem;color:#8888aa;text-align:center;margin-bottom:16px}',
    '.kn-btn{display:block;width:100%;padding:12px;margin:8px 0;border-radius:12px;border:2px solid #5b8cff;background:transparent;color:#fff;font:inherit;font-weight:700;font-size:.85rem;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:transform .1s}',
    '.kn-btn:active{transform:scale(.97)}',
    '.kn-btn.p{background:#5b8cff;color:#000;box-shadow:0 0 18px rgba(91,140,255,.35)}',
    '.kn-btn.dim{border-color:#444;color:#8888aa}',
    '.kn-btn:disabled{opacity:.5;cursor:default}',
    '.kn-row{display:flex;gap:8px;margin:8px 0}',
    '.kn-inp{flex:1;min-width:0;padding:12px;border-radius:12px;border:2px solid #333;background:#0a0a0f;color:#fff;font:inherit;font-size:1rem;letter-spacing:.3em;text-transform:uppercase;text-align:center;outline:none}',
    '.kn-inp:focus{border-color:#5b8cff}',
    '.kn-row .kn-btn{width:auto;margin:0;padding:12px 16px}',
    '.kn-lbl{font-size:.65rem;color:#8888aa;text-transform:uppercase;letter-spacing:.1em;margin:14px 0 6px}',
    '.kn-list{display:flex;flex-direction:column;gap:6px;min-height:40px}',
    '.kn-room{display:flex;align-items:center;justify-content:space-between;background:#1a1a24;border-radius:10px;padding:10px 12px;font-size:.8rem}',
    '.kn-room b{color:#00e5a0;letter-spacing:.2em}',
    '.kn-room small{color:#8888aa;display:block;font-size:.65rem;letter-spacing:0}',
    '.kn-room button{background:#00e5a0;border:none;color:#000;font:inherit;font-weight:700;padding:8px 14px;border-radius:8px;cursor:pointer}',
    '.kn-empty{font-size:.72rem;color:#666;text-align:center;padding:10px}',
    '.kn-code{font-size:2.4rem;font-weight:800;letter-spacing:.35em;text-align:center;color:#00e5a0;margin:10px 0 4px;text-shadow:0 0 16px rgba(0,229,160,.4)}',
    '.kn-wait{font-size:.75rem;color:#8888aa;text-align:center;margin-bottom:12px}',
    '.kn-wait::after{content:"";display:inline-block;width:1.2em;text-align:left;animation:kn-dots 1.2s steps(4) infinite}',
    '@keyframes kn-dots{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}',
    '.kn-err{font-size:.72rem;color:#ff4466;text-align:center;min-height:1.2em;margin-top:6px}',
    '.kn-me{font-size:.7rem;color:#8888aa;text-align:center;margin-bottom:10px}.kn-me b{color:#f0f0f8}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('kn-css')) return;
    var st = document.createElement('style'); st.id = 'kn-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /**
   * Открыть лобби. opts:
   *   game, title, initialState(): object, meta?: object (настройки партии, задаёт создатель),
   *   onStart(sess), onClose()
   */
  function openLobby(opts) {
    injectCss();
    var sess = new Session(opts.game);
    var ov = el('div', 'kn-ov'), box = el('div', 'kn-box');
    ov.appendChild(box);
    document.body.appendChild(ov);
    var listTimer = null, waitTimer = null, closed = false;

    function destroy() {
      closed = true;
      if (listTimer) clearTimeout(listTimer);
      if (waitTimer) clearTimeout(waitTimer);
      if (ov.parentNode) ov.parentNode.removeChild(ov);
    }

    function renderLoginRequired() {
      box.innerHTML = '';
      box.appendChild(el('div', 'kn-h', opts.title || 'ИГРА ПО СЕТИ'));
      box.appendChild(el('div', 'kn-sub', 'Игра по сети доступна после входа по коду'));
      box.appendChild(el('div', 'kn-empty', 'Вы играете как гость. Введите код игрока на платформе KuApp, чтобы создавать комнаты и присоединяться к ним.'));
      var api = platform();
      if (api && api.ui && api.ui.openLogin) {
        var btnLogin = el('button', 'kn-btn p', 'Войти по коду');
        btnLogin.onclick = function () { destroy(); if (opts.onClose) opts.onClose(); api.ui.openLogin(); };
        box.appendChild(btnLogin);
      }
      var btnBack = el('button', 'kn-btn dim', 'Назад'); box.appendChild(btnBack);
      btnBack.onclick = function () { destroy(); if (opts.onClose) opts.onClose(); };
    }

    function renderMain() {
      if (!isLoggedIn()) { renderLoginRequired(); return; }
      box.innerHTML = '';
      box.appendChild(el('div', 'kn-h', opts.title || 'ИГРА ПО СЕТИ'));
      box.appendChild(el('div', 'kn-sub', 'Создайте комнату или войдите в открытую'));
      var me = el('div', 'kn-me', 'Вы: '); var b = el('b', '', myName()); me.appendChild(b); box.appendChild(me);

      var btnCreate = el('button', 'kn-btn p', 'Создать комнату');
      box.appendChild(btnCreate);

      var row = el('div', 'kn-row');
      var inp = el('input', 'kn-inp'); inp.placeholder = 'КОД'; inp.maxLength = 4; inp.autocomplete = 'off'; inp.spellcheck = false;
      var btnJoin = el('button', 'kn-btn', 'Войти');
      row.appendChild(inp); row.appendChild(btnJoin); box.appendChild(row);

      box.appendChild(el('div', 'kn-lbl', 'Открытые комнаты'));
      var list = el('div', 'kn-list'); box.appendChild(list);
      var err = el('div', 'kn-err'); box.appendChild(err);
      var btnBack = el('button', 'kn-btn dim', 'Назад'); box.appendChild(btnBack);

      function setErr(e) { err.textContent = e ? (e.message || String(e)) : ''; }
      function lock(on) { btnCreate.disabled = btnJoin.disabled = on; }

      btnCreate.onclick = function () {
        lock(true); setErr('');
        sess.create(opts.initialState ? opts.initialState() : null, opts.meta || null)
          .then(function (room) { renderWaiting(room); })
          .catch(function (e) { setErr(e); lock(false); });
      };
      var doJoin = function (code) {
        code = String(code || '').toUpperCase().trim();
        if (code.length < 4) { setErr('Введите код из 4 символов'); return; }
        lock(true); setErr('');
        sess.join(code)
          .then(function () { destroy(); opts.onStart(sess); })
          .catch(function (e) { setErr(e); lock(false); });
      };
      btnJoin.onclick = function () { doJoin(inp.value); };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(inp.value); });
      btnBack.onclick = function () { destroy(); if (opts.onClose) opts.onClose(); };

      function refreshList() {
        if (closed) return;
        sess.list().then(function (rooms) {
          if (closed) return;
          list.innerHTML = '';
          if (!rooms.length) { list.appendChild(el('div', 'kn-empty', 'Пока нет открытых комнат')); }
          rooms.forEach(function (r) {
            var it = el('div', 'kn-room');
            var left = el('div'); var code = el('b', '', r.id); left.appendChild(code);
            var host = el('small', '', r.host + (r.meta && r.meta.label ? ' · ' + r.meta.label : '')); left.appendChild(host);
            var jb = el('button', '', 'Играть'); jb.onclick = function () { doJoin(r.id); };
            it.appendChild(left); it.appendChild(jb); list.appendChild(it);
          });
          setErr('');
        }).catch(function (e) { if (!closed) setErr(e); })
          .then(function () { if (!closed) listTimer = setTimeout(refreshList, 5000); });
      }
      refreshList();
    }

    function renderWaiting(room) {
      box.innerHTML = '';
      box.appendChild(el('div', 'kn-h', 'КОМНАТА СОЗДАНА'));
      box.appendChild(el('div', 'kn-sub', 'Сообщите код сопернику'));
      box.appendChild(el('div', 'kn-code', room.id));
      box.appendChild(el('div', 'kn-wait', 'Ждём соперника'));
      var err = el('div', 'kn-err'); box.appendChild(err);
      var btnCancel = el('button', 'kn-btn dim', 'Отменить'); box.appendChild(btnCancel);
      btnCancel.onclick = function () { sess.leave(); renderMain(); };

      var poll = function () {
        if (closed) return;
        if (!sess.room) { return; }
        call('roomGet', { id: sess.room.id, ver: sess.room.ver, token: sess.token }).then(function (r) {
          if (closed || !sess.room) return;
          err.textContent = '';
          if (!r.unchanged) {
            sess._apply(r);
            if (r.status === 'playing') { destroy(); opts.onStart(sess); return; }
            if (r.status === 'closed') { err.textContent = 'Комната закрыта'; return; }
          }
          waitTimer = setTimeout(poll, 2500);
        }).catch(function (e) {
          if (closed) return;
          err.textContent = e.message || String(e);
          waitTimer = setTimeout(poll, 4000);
        });
      };
      waitTimer = setTimeout(poll, 2000);
    }

    renderMain();
    return { close: destroy, session: sess };
  }

  window.KuNet = {
    call: call,
    myName: myName,
    isLoggedIn: isLoggedIn,
    gasUrl: gasUrl,
    session: function (game) { return new Session(game); },
    openLobby: openLobby,
    Session: Session
  };
})();
