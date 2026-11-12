// Работа без сети. При любой правке файлов программы поднимайте номер версии:
// иначе телефон продолжит показывать прежние файлы из своего запаса.
const VERSION = 'forma-4';
const FILES = ['./', 'index.html', 'styles.css', 'data.js', 'db.js', 'app.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-512.png'];

// Каждый файл версии запрашивается с её номером в адресе и в обход запасов
// браузера. Без этого сервер раздачи ещё минут десять отдаёт прежний app.js,
// он ложится в запас новой версии, и программа работает на смеси старого
// с новым: так при выпуске второй версии новый sw.js получил старый app.js.
// Запас собирается целиком или не собирается вовсе - при сбое остаётся прежний.
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    const loaded = await Promise.all(FILES.map(async (f) => {
      const res = await fetch(`${f}?v=${VERSION}`, { cache: 'reload' });
      if (!res.ok) throw new Error(`${f}: ${res.status}`);
      return [f, res];
    }));
    await Promise.all(loaded.map(([f, res]) => cache.put(f, res)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Только из запаса: файлы одной версии не должны смешиваться с другой,
// а в спортзале и в подвале ждать сеть перед тренировкой нельзя.
// Обновление приходит единственным путём - новым номером версии выше.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => (await cache.match(e.request, { ignoreSearch: true })) || fetch(e.request)),
  );
});
