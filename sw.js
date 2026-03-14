const CACHE_NAME = 'mcgill-trainer-auto-v2';
const STATIC_ASSETS = [
    '/McGill/',
    '/McGill/index.html',
    '/McGill/manifest.json',
    '/McGill/icon-256.png',
    '/McGill/icon-512.png'
];

// Установка — кэшируем статику
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Активация — удаляем старые кэши
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(names.map(name => {
                if (name !== CACHE_NAME) return caches.delete(name);
            }))
        ).then(() => self.clients.claim())
    );
});

// Перехват запросов
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // index.json — Network First: всегда берём свежую версию, fallback к кэшу
    if (url.includes('workouts/index.json')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // ИСПРАВЛЕНИЕ: при успешной загрузке index.json
                    // параллельно кэшируем все указанные в нём workout-файлы
                    const toCache = response.clone();
                    caches.open(CACHE_NAME).then(async cache => {
                        cache.put(event.request, toCache.clone());
                        try {
                            const data  = await toCache.json();
                            const base  = url.replace('index.json', '');
                            // Кэшируем каждый workout-файл, если ещё не в кэше
                            data.forEach(file => {
                                const fileUrl = base + file;
                                cache.match(fileUrl).then(cached => {
                                    if (!cached) {
                                        fetch(fileUrl).then(r => {
                                            if (r.ok) cache.put(fileUrl, r);
                                        }).catch(() => {});
                                    }
                                });
                            });
                        } catch (e) {}
                    });
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Workout JSON файлы — Stale-While-Revalidate
    // (гарантируем наличие в кэше даже при первом cold-запросе)
    if (url.includes('/workouts/') && url.endsWith('.json')) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                const networkFetch = fetch(event.request).then(response => {
                    if (response && response.status === 200) {
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, response.clone());
                        });
                    }
                    return response;
                }).catch(() => null);

                return cached || networkFetch;
            })
        );
        return;
    }

    // Всё остальное (HTML, иконки, манифест) — Stale-While-Revalidate
    event.respondWith(
        caches.match(event.request).then(cached => {
            const networkFetch = fetch(event.request).then(response => {
                if (response && response.status === 200) {
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, response.clone());
                    });
                }
                return response;
            }).catch(() => null);

            return cached || networkFetch;
        })
    );
});
