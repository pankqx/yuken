// Offline cache: the dock Wi-Fi drops, the app should not.
const CACHE = 'yuken-pol-v8';
const CORE = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/store-local.js', 'js/common.js', 'js/config.js', 'js/hero.js', 'js/db.js', 'js/util.js', 'js/ui.js', 'js/parse.js', 'js/export.js', 'js/camera.js', 'js/google.js',
  'vendor/html5-qrcode.min.js', 'vendor/three.min.js', 'assets/yuken-logo.svg', 'assets/yuken-logo-white.svg', 'vendor/xlsx.full.min.js', 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js', 'icons/icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Network first so updates land straight away; cache when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); if (r.ok) caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
