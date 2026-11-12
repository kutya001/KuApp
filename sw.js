// ═══════════════════════════════════════════════════════════════════════════════
// sw.js — Service Worker
// Свои файлы: «кэш сразу, обновление в фоне» (stale-while-revalidate) — приложение
// открывается мгновенно и работает офлайн, а свежая версия подтягивается к следующему запуску.
// Внешние API (Google Apps Script и т.п.) не перехватываются.
// ═══════════════════════════════════════════════════════════════════════════════

const CACHE_NAME = 'app-v19';

// Оболочка и общие файлы игр — кэшируются при установке
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-256.png',
  './icon-512.png',
  './apps/index.json',
  './apps/ku-arcade.css',
  './apps/ku-arcade.js',
  './apps/kunet.js',
  './apps/fonts/rubik-cyrillic.woff2',
  './apps/fonts/rubik-latin.woff2',
  './apps/fonts/russo-one-cyrillic.woff2',
  './apps/fonts/russo-one-latin.woff2',
];

const OFFLINE_PAGE = '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Нет сети</title></head>' +
  '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
  'background:#070b24;color:#eef2ff;font-family:system-ui,sans-serif;text-align:center;padding:24px">' +
  '<div><div style="font-size:48px">📡</div><h2 style="margin:12px 0 6px">Нет подключения</h2>' +
  '<p style="color:#a8b1d8;margin:0">Эта страница ещё не сохранена для работы без сети.<br>Подключитесь к интернету и откройте её снова.</p></div></body></html>';

// ─── Установка ────────────────────────────────────────────────────────────────
// Ошибка загрузки не глотается: неполная установка хуже, чем повтор при следующем визите.

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// ─── Активация ────────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Перехват запросов ────────────────────────────────────────────────────────

function cacheable(response) {
  return response && response.status === 200 && response.type === 'basic';
}

async function staleWhileRevalidate(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fromNetwork = fetch(request)
    .then(response => {
      // clone() до того, как тело будет прочитано
      if (cacheable(response)) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(fromNetwork);          // обновление в фоне — к следующему запуску
    return cached;
  }

  const response = await fromNetwork;
  if (response) return response;

  // Сети нет и в кэше пусто
  if (request.mode === 'navigate') {
    if (request.destination !== 'iframe') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response(OFFLINE_PAGE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return new Response('Offline', { status: 503, statusText: 'Offline' });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Только свои файлы; внешние адреса (GAS, Google API, CDN) браузер запрашивает напрямую
  if (url.origin !== self.location.origin) return;
  // Частичные запросы (медиа) кэш не обслуживает
  if (request.headers.has('range')) return;

  event.respondWith(staleWhileRevalidate(event));
});

// ─── Сообщения от приложения ──────────────────────────────────────────────────

/** Дозагрузить файлы, которых ещё нет в кэше (игры каталога — чтобы работали без сети). */
async function precache(urls) {
  const cache = await caches.open(CACHE_NAME);
  let added = 0;
  for (const raw of urls) {
    try {
      const url = new URL(raw, self.location.href);
      if (url.origin !== self.location.origin) continue;
      if (await cache.match(url.href)) continue;
      const response = await fetch(url.href);
      if (cacheable(response)) { await cache.put(url.href, response); added++; }
    } catch (e) { /* нет сети — попробуем в следующий раз */ }
  }
  return added;
}

self.addEventListener('message', event => {
  if (!event.data) return;

  const reply = data => {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(data);
  };

  if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys()
        .then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(() => reply({ ok: true, message: 'Кэш очищен' }))
        .catch(err => reply({ ok: false, message: err.message }))
    );
    return;
  }

  if (event.data.type === 'GET_CACHE_INFO') {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then(cache => cache.keys())
        .then(keys => reply({
          ok: true, cacheName: CACHE_NAME,
          data: keys.map(r => r.url), count: keys.length,
        }))
        .catch(err => reply({ ok: false, message: err.message }))
    );
    return;
  }

  if (event.data.type === 'PRECACHE' && Array.isArray(event.data.urls)) {
    event.waitUntil(
      precache(event.data.urls.slice(0, 200))
        .then(added => reply({ ok: true, added }))
        .catch(err => reply({ ok: false, message: err.message }))
    );
    return;
  }

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
});
