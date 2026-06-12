// SMM Panel - Service Worker (feat_pwa)
const CACHE_NAME = 'smm-panel-v1';

// Statik dosyalar — cache'e al
const STATIC_ASSETS = [
    '/',
    '/style.css',
    '/app.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
];

// Install: statik dosyaları önbelleğe al
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS).catch(() => {
                // Bazı kaynaklar yüklenemezse sessizce devam et
            });
        })
    );
    self.skipWaiting();
});

// Activate: eski cache'leri temizle
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// Fetch: API isteklerini network-first, statikleri cache-first yönet
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // API isteklerini her zaman network'ten al, başarısız olursa hata döndür
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request).catch(() =>
                new Response(JSON.stringify({ success: false, detail: 'Çevrimdışı' }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                })
            )
        );
        return;
    }

    // Statik dosyalar: cache-first, bulamazsa network
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                // Sadece başarılı GET isteklerini cache'e al
                if (
                    event.request.method === 'GET' &&
                    response.status === 200 &&
                    response.type !== 'opaque'
                ) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => cached || new Response('Çevrimdışı', { status: 503 }));
        })
    );
});
