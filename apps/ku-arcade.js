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

  var resizeT = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { document.querySelectorAll('.ku-logo[data-text]').forEach(fit); }, 120);
  });

  // экран или оверлей стал видимым (у них анимация появления) — подогнать заголовки внутри
  document.addEventListener('animationstart', function (e) {
    var t = e.target;
    if (t && t.classList && (t.classList.contains('ku-screen') || t.classList.contains('ku-overlay')))
      t.querySelectorAll('.ku-logo[data-text]').forEach(fit);
  }, true);

  function boot() {
    logos();
    // после загрузки шрифта ширина букв меняется — пересчитываем размер заголовков
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {
      document.querySelectorAll('.ku-logo[data-text]').forEach(fit);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.KuArcade = { embedded: embedded, logo: logo, toast: toast, color: color, confirm: confirmDialog, alert: alertDialog };
})();
