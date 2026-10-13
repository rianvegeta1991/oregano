// Oregano – Service Worker: Offline-Fähigkeit + Aktionen in Benachrichtigungen.
// Strategie „Netz zuerst, Cache als Rückfall“: Updates kommen sofort an, ohne Netz läuft die App aus dem Cache.
// Bei Dateiänderungen CACHE hochzählen.
const CACHE = 'oregano-v1';
const CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'css/themes.css', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/db.js', 'js/store.js', 'js/icons.js', 'js/ui.js', 'js/dnd.js', 'js/reminders.js', 'js/notify.js',
  'js/itemdialog.js', 'js/overview.js', 'js/calendar.js', 'js/board.js', 'js/lists.js', 'js/search.js', 'js/settings.js', 'js/version.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'sounds/oregano.wav',
];

self.addEventListener('install', (e) => {
  // Einzeln cachen: fehlt eine Datei, soll nicht die ganze Installation scheitern.
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(CORE.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(new Request(req, { cache: 'no-cache' }));
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await caches.match('index.html')) || (await caches.match('./'));
      return Response.error();
    }
  })());
});

// Klick auf eine Erinnerung oder ihre Aktionen („Erledigt“, „Später“)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { itemId, sound } = e.notification.data || {};
  const action = e.action;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (action && itemId) {
      if (wins.length) { wins[0].postMessage({ type: 'reminder-action', action, itemId, sound }); return; }
      return self.clients.openWindow(`./?act=${encodeURIComponent(action)}&item=${encodeURIComponent(itemId)}`);
    }
    if (wins.length) return wins[0].focus();
    return self.clients.openWindow('./');
  })());
});
