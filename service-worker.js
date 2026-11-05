"use strict";

const CACHE = "app-palestra-v28";
const STATIC = [
  "./",
  "./index.html",
  "./styles.css?v=28",
  "./app.js?v=28",
  "./scheda-iniziale.json",
  "./assets/illustrazioni/catalogo.json",
  "./manifest.webmanifest",
  "./assets/apple-touch-icon.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const fresh = (urls) => Promise.all(urls.map((url) => cache.add(new Request(url, { cache: "reload" }))));
    await fresh(STATIC);
    const catalogUrl = new URL("./assets/illustrazioni/catalogo.json", self.registration.scope).href;
    const response = await cache.match(catalogUrl);
    const catalog = await response.json();
    if (!Array.isArray(catalog) || !catalog.every((item) =>
      item && typeof item.src === "string" &&
      /^\.\/assets\/illustrazioni\/[a-z0-9-]+\.svg$/.test(item.src)
    )) throw new Error("Catalogo illustrazioni non valido");
    await fresh(catalog.map((item) => item.src));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("app-palestra-") && key !== CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin ||
      !url.href.startsWith(self.registration.scope)) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(new URL("./index.html", self.registration.scope).href)
      )
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
