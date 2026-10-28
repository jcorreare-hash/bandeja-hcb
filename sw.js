// Guarda la app para que abra rápido y sin señal. Los datos de la hoja nunca se guardan aquí.
const VERSION = "bandeja-hcb-v2.1";
const ARCHIVOS = ["./", "index.html", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // Primero la red (para recibir cambios de la app); si no hay señal, lo guardado.
  e.respondWith(fetch(req).then((res) => {
    const copia = res.clone();
    caches.open(VERSION).then((c) => c.put(req, copia)).catch(() => {});
    return res;
  }).catch(() => caches.match(req).then((r) => r || caches.match("index.html"))));
});
