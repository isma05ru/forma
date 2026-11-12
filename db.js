// Хранилище на устройстве (IndexedDB). Фотографии лежат отдельно от их
// карточек: иначе при каждом запуске в память поднимались бы все снимки.

const DB = (() => {
  let db;
  const KEYED = ['workouts', 'sessions', 'weights', 'photos', 'photoFiles'];

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('forma', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('kv');
        for (const s of KEYED) d.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => { db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const rq = fn(t.objectStore(store));
      t.oncomplete = () => resolve(rq ? rq.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    KEYED,
    open,
    get: (s, k) => tx(s, 'readonly', (o) => o.get(k)),
    all: (s) => tx(s, 'readonly', (o) => o.getAll()),
    put: (s, v, k) => tx(s, 'readwrite', (o) => (k !== undefined ? o.put(v, k) : o.put(v))),
    del: (s, k) => tx(s, 'readwrite', (o) => o.delete(k)),
    clear: (s) => tx(s, 'readwrite', (o) => o.clear()),
  };
})();
