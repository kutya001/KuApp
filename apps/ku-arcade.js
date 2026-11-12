/* ═══════════════════════════════════════════════════════════════════════════
 * ku-arcade.js — мини-хелперы единого стиля игр KuApp (пара к ku-arcade.css)
 *
 *  • html.ku-embedded — игра открыта внутри платформы (iframe): левый верхний
 *    угол занят кнопкой «←» платформы, шапка .ku-top сдвигается сама.
 *  • .ku-logo — текст заголовка разбивается на неоновые буквы (цвета Тетриса)
 *    и ужимается по ширине экрана. После смены текста: KuArcade.logo(el).
 *  • KuArcade.toast(msg, kind?, ms?) — тост внизу экрана (kind: good|bad|gold, + 'top' — сверху).
 *  • KuArcade.color('--accent') — значение CSS-переменной (для canvas).
 *  • KuArcade.confirm(msg, {title, ok, cancel, danger}) → Promise<boolean>,
 *    KuArcade.alert(msg, {title, ok}) → Promise — диалоги в стиле набора
 *    (вместо системных confirm/alert, которые выбиваются из стиля).
 *  • KuArcade.confetti({count, x, y, colors}) — залп конфетти поверх экрана (x, y — доли экрана 0…1);
 *    KuArcade.celebrate() — праздничный салют. Запускается и сам: когда открывается окно .ku-overlay,
 *    в котором виден заголовок h2.win или строка .ku-new-best (победа, новый рекорд).
 *    Отключить для окна: атрибут data-ku-nofx. При «уменьшить движение» эффектов нет.
 *  • Экран не гаснет, пока идёт игра (Screen Wake Lock): блокировка берётся при касании/нажатии
 *    и отпускается через 3 минуты без действий или при сворачивании.
 * ═════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var root = document.documentElement;
  var embedded = false;
  try { embedded = window.self !== window.top; } catch (e) { embedded = true; }
  if (embedded) root.classList.add('ku-embedded');

  var PALETTE = ['--cyan', '--yellow', '--purple', '--green', '--blue', '--red', '--orange'];

  function fit(el) {
    el.style.fontSize = '';
    var avail = el.clientWidth - 4;           // ширина строки заголовка (0 — элемент скрыт)
    if (avail <= 0) return;
    var size = parseFloat(getComputedStyle(el).fontSize) || 40, guard = 0;
    // ужимаем, пока самое длинное слово не помещается в строку
    while (guard++ < 30 && size > 18) {
      var widest = 0;
      el.querySelectorAll('.w').forEach(function (w) { widest = Math.max(widest, w.getBoundingClientRect().width); });
      if (widest <= avail) break;
      size *= 0.92; el.style.fontSize = size + 'px';
    }
  }

  function logo(el) {
    if (!el) return;
    var text = el.getAttribute('data-text') || el.textContent.trim();
    el.setAttribute('data-text', text);
    el.setAttribute('aria-label', text);
    el.textContent = '';
    var i = 0;
    text.split(/\s+/).forEach(function (word, wi) {
      if (wi > 0) el.appendChild(document.createTextNode(' '));
      var w = document.createElement('span'); w.className = 'w'; w.setAttribute('aria-hidden', 'true');
      Array.from(word).forEach(function (ch) {
        var s = document.createElement('span');
        s.className = 'ch'; s.textContent = ch;
        s.style.setProperty('--i', i);
        s.style.setProperty('--c', 'var(' + PALETTE[i % PALETTE.length] + ')');
        i++; w.appendChild(s);
      });
      el.appendChild(w);
    });
    fit(el);
  }

  function logos() { document.querySelectorAll('.ku-logo').forEach(logo); }

  var toastEl = null, toastTimer = 0;
  function toast(msg, kind, ms) {
    if (!toastEl) {
      toastEl = document.querySelector('.ku-toast');
      if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'ku-toast'; document.body.appendChild(toastEl); }
      if (!toastEl.hasAttribute('role')) { toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); }
    }
    toastEl.textContent = msg;
    toastEl.className = 'ku-toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2200);
  }

  function color(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  /* Диалог в стиле набора вместо confirm()/alert().
   * KuArcade.confirm('Сбросить рекорды?', { title: 'Сброс', ok: 'Сбросить', cancel: 'Отмена', danger: true }) → Promise<boolean>
   * KuArcade.alert('Готово', { title: '…', ok: 'Понятно' }) → Promise<void>
   * Esc / тап по подложке — отмена; фокус на «ОК» (для danger — на «Отмена»), Enter жмёт кнопку в фокусе. */
  function dialog(message, o, withCancel) {
    o = o || {};
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.className = 'ku-overlay open ku-dialog';
      var card = document.createElement('div'); card.className = 'ku-card';
      card.setAttribute('role', 'alertdialog'); card.setAttribute('aria-modal', 'true');
      var h = document.createElement('h2'); h.textContent = o.title || (withCancel ? 'ПОДТВЕРДИТЕ' : 'ВНИМАНИЕ');
      var p = document.createElement('p'); p.textContent = message || '';
      var ok = document.createElement('button');
      ok.className = 'ku-btn ' + (o.danger ? 'red' : 'primary');
      ok.textContent = o.ok || (withCancel ? 'Да' : 'Понятно');
      card.appendChild(h); card.appendChild(p); card.appendChild(ok);
      var cancel = null;
      if (withCancel) {
        cancel = document.createElement('button'); cancel.className = 'ku-btn ghost';
        cancel.textContent = o.cancel || 'Отмена'; card.appendChild(cancel);
      }
      ov.appendChild(card); document.body.appendChild(ov);
      var prevFocus = document.activeElement;
      function done(v) {
        document.removeEventListener('keydown', onKey, true);
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
        resolve(withCancel ? v : undefined);
      }
      function onKey(e) {
        // пока открыт диалог, клавиши не доходят до игры (Enter/пробел по-прежнему нажимают кнопку в фокусе)
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); done(false); }
      }
      ok.onclick = function () { done(true); };
      if (cancel) cancel.onclick = function () { done(false); };
      ov.addEventListener('pointerdown', function (e) { if (e.target === ov) done(false); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(function () { try { (o.danger && cancel ? cancel : ok).focus({ preventScroll: true }); } catch (e) {} }, 0);
    });
  }
  function confirmDialog(message, o) { return dialog(message, o, true); }
  function alertDialog(message, o) { return dialog(message, o, false); }

  /* ── Салют: конфетти на отдельном холсте поверх всего (без перерисовки игры) ── */
  var fxCanvas = null, fxParts = [], fxRaf = 0, fxLast = 0, lastCelebrate = 0;
  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function confetti(o) {
    o = o || {};
    if (reducedMotion() || !document.body) return;
    var W = window.innerWidth, H = window.innerHeight;
    if (!fxCanvas) {
      fxCanvas = document.createElement('canvas');
      fxCanvas.className = 'ku-fx'; fxCanvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(fxCanvas);
    }
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (fxCanvas.width !== Math.round(W * dpr) || fxCanvas.height !== Math.round(H * dpr)) {
      fxCanvas.width = Math.round(W * dpr); fxCanvas.height = Math.round(H * dpr);
    }
    var n = Math.max(8, Math.min(160, o.count || (W < 500 ? 70 : 110)));
    var colors = (o.colors || PALETTE.map(color)).filter(Boolean);
    if (!colors.length) colors = ['#00e5ff', '#ffd60a', '#ff4dd2', '#51f58b'];
    var x0 = (o.x == null ? 0.5 : o.x) * W, y0 = (o.y == null ? 0.36 : o.y) * H, unit = Math.min(W, H);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = (0.3 + Math.random() * 0.9) * unit * 1.35;
      fxParts.push({ x: x0, y: y0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - unit * 0.55, g: unit * 2.1,
        w: 5 + Math.random() * 6, h: 4 + Math.random() * 5, r: Math.random() * 6.283, vr: (Math.random() - 0.5) * 14,
        ph: Math.random() * 6.283, c: colors[i % colors.length], life: 0, ttl: 1.4 + Math.random() * 1.2 });
    }
    if (fxParts.length > 420) fxParts.splice(0, fxParts.length - 420);
    if (!fxRaf) { fxLast = performance.now(); fxRaf = requestAnimationFrame(fxTick); }
  }
  function fxTick(t) {
    var dt = Math.min(0.05, Math.max(0, (t - fxLast) / 1000)); fxLast = t;
    var W = window.innerWidth, H = window.innerHeight, ctx = fxCanvas.getContext('2d');
    ctx.setTransform(fxCanvas.width / W, 0, 0, fxCanvas.height / H, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var drag = Math.pow(0.22, dt);
    for (var i = fxParts.length - 1; i >= 0; i--) {
      var p = fxParts[i]; p.life += dt;
      if (p.life > p.ttl || p.y > H + 40) { fxParts.splice(i, 1); continue; }
      p.vx *= drag; p.vy = p.vy * drag + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      var flip = Math.abs(Math.cos(p.life * 8 + p.ph));          // «переворот» бумажки
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, Math.min(1, (p.ttl - p.life) / 0.45));
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h * flip / 2, p.w, p.h * flip + 1);
      ctx.restore();
    }
    if (fxParts.length) fxRaf = requestAnimationFrame(fxTick);
    else { fxRaf = 0; ctx.clearRect(0, 0, W, H); }
  }
  function celebrate(o) {
    var now = Date.now();
    if (now - lastCelebrate < 1500) return;      // одно окно — один салют
    lastCelebrate = now;
    confetti(o);
    setTimeout(function () { confetti({ count: 46, x: 0.18 + Math.random() * 0.14, y: 0.3 }); }, 260);
    setTimeout(function () { confetti({ count: 46, x: 0.68 + Math.random() * 0.14, y: 0.3 }); }, 480);
  }
  function shown(el) {
    if (!el || !el.getClientRects().length) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && (el.textContent || '').trim() !== '';
  }
  function checkWin(ov) {
    if (!ov || !ov.isConnected || !ov.classList.contains('open')) return;
    if (ov.classList.contains('ku-dialog') || ov.hasAttribute('data-ku-nofx')) return;
    var els = ov.querySelectorAll('h2.win, .ku-new-best');
    for (var i = 0; i < els.length; i++) if (shown(els[i])) {
      // то же окно с тем же текстом, открытое повторно («посмотреть поле» → назад к итогам), — без второго салюта
      var sig = (ov.textContent || '').replace(/\s+/g, ' ').slice(0, 200), now = Date.now();
      if (ov.__kuWinSig === sig && now - (ov.__kuWinAt || 0) < 120000) return;
      ov.__kuWinSig = sig; ov.__kuWinAt = now;
      celebrate();
      return;
    }
  }

  /* ── Окно и кнопка «←» платформы ──
   * Внутри платформы левый верхний угол (64×64) занят кнопкой «←». Окно, которое в него попадает,
   * опускается под кнопку (класс .ku-below); остальные встают по центру и получают всю высоту экрана. */
  function placeOverlay(ov) {
    if (!embedded || !ov || !ov.isConnected || !ov.classList.contains('open')) return;
    ov.classList.remove('ku-below');
    var box = ov.firstElementChild;
    while (box && !box.offsetWidth) box = box.nextElementSibling;
    if (!box) return;
    // offsetLeft/Top — по раскладке, без учёта анимации появления (scale)
    if (box.offsetLeft < 62 && box.offsetTop < 62) ov.classList.add('ku-below');
  }
  function placeOverlays() {
    var list = document.querySelectorAll('.ku-overlay.open');
    for (var i = 0; i < list.length; i++) placeOverlay(list[i]);
  }

  /* ── Экран не гаснет во время игры ── */
  var wakeLock = null, wakePending = false, wakeTimer = 0, WAKE_IDLE_MS = 180000;
  function wakeRelease() {
    clearTimeout(wakeTimer);
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  }
  function wakeKick() {
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(wakeRelease, WAKE_IDLE_MS);
    if (wakeLock || wakePending || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    wakePending = true;
    try {
      navigator.wakeLock.request('screen').then(function (lock) {
        wakePending = false; wakeLock = lock;
        lock.addEventListener('release', function () { if (wakeLock === lock) wakeLock = null; });
        if (document.visibilityState !== 'visible') wakeRelease();
      }).catch(function () { wakePending = false; });
    } catch (e) { wakePending = false; }
  }
  window.addEventListener('pointerdown', wakeKick, { passive: true, capture: true });
  window.addEventListener('keydown', wakeKick, { passive: true, capture: true });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState !== 'visible') wakeRelease(); });

  var resizeT = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { document.querySelectorAll('.ku-logo[data-text]').forEach(fit); placeOverlays(); }, 120);
  });

  // экран или оверлей стал видимым (у них анимация появления) — подогнать заголовки внутри
  document.addEventListener('animationstart', function (e) {
    var t = e.target;
    if (t && t.classList && (t.classList.contains('ku-screen') || t.classList.contains('ku-overlay'))) {
      t.querySelectorAll('.ku-logo[data-text]').forEach(fit);
      if (e.target === t && t.classList.contains('ku-overlay')) {
        placeOverlay(t);                                   // сразу, до первой отрисовки окна
        // окно победы / нового рекорда — салют (содержимое окна игра могла дописать сразу после открытия)
        setTimeout(function () { placeOverlay(t); checkWin(t); }, 90);
        setTimeout(function () { placeOverlay(t); }, 420);
      }
    }
  }, true);

  function boot() {
    logos();
    // после загрузки шрифта ширина букв меняется — пересчитываем размер заголовков
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {
      document.querySelectorAll('.ku-logo[data-text]').forEach(fit);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.KuArcade = { embedded: embedded, logo: logo, toast: toast, color: color, confirm: confirmDialog, alert: alertDialog,
    confetti: confetti, celebrate: celebrate };
})();
