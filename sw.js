// Service worker: קבצי האפליקציה – קודם רשת (כדי לקבל עדכונים), ואם אין רשת – מהמטמון.
// המודלים והמנוע מה-CDN – קודם מהמטמון, כי הם כבדים ולא משתנים (הגרסה נעולה).

const APP_CACHE = 'pc-app-v4';
const MODEL_CACHE = 'pc-models-v1';
const APP_FILES = [
  './',
  'index.html',
  'css/style.css',
  'manifest.json',
  'icons/icon-192.png',
  'js/app.js',
  'js/config.js',
  'js/geom.js',
  'js/framing.js',
  'js/analyze.js',
  'js/feedback.js',
  'js/vision.js',
  'js/sensors.js',
  'js/speech.js',
  'js/draw.js',
  'js/store.js',
  'js/ai.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![APP_CACHE, MODEL_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isModel = url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'storage.googleapis.com';

  if (isModel) {
    e.respondWith(
      caches.open(MODEL_CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone(); // חייבים לשכפל לפני שהגוף נקרא
            caches.open(APP_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('index.html'))),
    );
  }
});
