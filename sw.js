const CACHE_NAME = 'mcgill-trainer-v2';
const ASSETS_TO_CACHE = [
  '/McGill/',
  '/McGill/index.html',
  '/McGill/manifest.json',
  '/McGill/workouts/index.json',
  '/McGill/icon-256.png',
  '/McGill/icon-512.png'
];

// Установка Service Worker и кэширование базовых файлов
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

// Активация и очистка старых кэшей
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Перехват запросов
self.addEventListener('fetch', (event) => {
  // 1. Для списка файлов (index.json) всегда используем сеть, чтобы сразу видеть новые программы. 
  // Если интернета нет — берем из кэша.
  if (event.request.url.includes('index.json')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 2. Для всего остального: Сначала кэш, потом сеть (быстрая загрузка)
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response; // Возвращаем из кэша
        }
        
        return fetch(event.request).then((networkResponse) => {
          // ДИНАМИЧЕСКОЕ КЭШИРОВАНИЕ: Если загружен файл из папки workouts, сохраняем его в кэш!
          if (networkResponse && networkResponse.status === 200 && event.request.url.includes('/workouts/')) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        });
      })
  );
});
