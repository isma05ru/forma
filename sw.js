// Работа без сети. При любой правке файлов программы поднимайте номер версии:
// иначе телефон продолжит показывать прежние файлы из своего запаса.
const VERSION = 'forma-2';
const FILES = ['./', 'index.html', 'styles.css', 'data.js', 'db.js', 'app.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Отдаём сразу из запаса, а свежую версию подтягиваем на следующий запуск:
// в спортзале и в подвале связь плохая, ждать сеть перед тренировкой нельзя.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || fresh;
    }),
  );
});
