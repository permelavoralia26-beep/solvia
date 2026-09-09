/**
 * Service worker di Solvia.
 *
 * Serve a due cose:
 *  1. rendere l'app installabile sulla schermata home (requisito di Android);
 *  2. far aprire l'interfaccia anche senza rete, mostrando una pagina chiara
 *     invece dell'errore del browser.
 *
 * Scelta importante: le chiamate alle API **non** vengono mai messe in cache.
 * Mostrare fatture o incassi vecchi come se fossero attuali sarebbe peggio
 * che non mostrarli affatto.
 */

const CACHE = 'solvia-v1';

// Solo il guscio dell'interfaccia: file che cambiano di rado e non contengono dati.
const SHELL = [
  '/app',
  '/css/styles.css',
  '/js/app.js',
  '/favicon.svg',
  '/icon-192.png',
  '/manifest.json',
  '/offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Rimuove le versioni precedenti della cache a ogni aggiornamento.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Dati: sempre dalla rete. Mai dalla cache, per non mostrare importi superati.
  if (url.pathname.startsWith('/api/')) return;

  // Pagine: prima la rete, con la pagina offline come rete di sicurezza.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then((r) => r || caches.match('/offline.html'))),
    );
    return;
  }

  // Risorse statiche: prima la cache, che è più veloce, ma si aggiorna in sottofondo.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
