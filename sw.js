const CACHE_NAME = 'mcgill-trainer-v1';
const ASSETS_TO_CACHE = [
  '/McGill/',
  '/McGill/index.html',
  '/McGill/manifest.json',
  '/McGill/icon-256.png',
  '/McGill/icon-512.png'
];

// Установка Service Worker и кэширование файлов
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Кэширование файлов успешно');
        return cache.addAll(ASSETS_TO_CACHE);
      })
  );
  self.skipWaiting();
});

// Активация и удаление старых кэшей
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Удаление старого кэша:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Перехват запросов (стратегия Cache First, затем Network)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Возвращаем из кэша, если найдено
        if (response) {
          return response;
        }
        // Иначе идем в сеть
        return fetch(event.request);
      })
  );
});
