const CACHE_NAME = 'mcgill-trainer-auto-v1';
const ASSETS_TO_CACHE = [
  '/McGill/',
  '/McGill/index.html',
  '/McGill/manifest.json',
  '/McGill/icon-256.png',
  '/McGill/icon-512.png'
];

// Установка Service Worker и базовое кэширование
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting(); // Заставляет новый SW немедленно активироваться
});

// Активация и удаление старых кэшей (если вы когда-то смените CACHE_NAME)
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
  self.clients.claim(); // Заставляет SW сразу взять контроль над открытыми страницами
});

// Перехват запросов
self.addEventListener('fetch', (event) => {
  // 1. Исключение для каталога программ (index.json) - Стратегия: Сначала Сеть (Network First)
  // Мы всегда хотим сразу видеть, если добавились новые тренировки.
  if (event.request.url.includes('workouts/index.json')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          return response;
        })
        .catch(() => caches.match(event.request)) // Если нет интернета, берем старый список из кэша
    );
    return;
  }

  // 2. Для всех остальных файлов (HTML, JSON тренировок, картинки) - Стратегия: Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      
      // Параллельно запускаем скачивание свежей версии с GitHub в фоновом режиме
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          caches.open(CACHE_NAME).then((cache) => {
            // Тихо обновляем файл в кэше на будущее
            cache.put(event.request, networkResponse.clone());
          });
        }
        return networkResponse;
      }).catch(() => {
        // Ошибка сети игнорируется (штатная работа без интернета)
      });

      // Мгновенно отдаем файл из кэша. Если в кэше файла еще нет — ждем завершения fetchPromise
      return cachedResponse || fetchPromise;
    })
  );
});
