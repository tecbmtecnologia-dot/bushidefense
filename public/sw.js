const CACHE_NAME = "qg-cache-v32";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first, cache fallback: mantém o app usável mesmo com internet instável.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// Recebe a notificação push mesmo com o app fechado e exibe no sistema.
self.addEventListener("push", (event) => {
  let dados = { titulo: "QG Cia Paulista", mensagem: "Você tem uma novidade no app." };
  try { if (event.data) dados = { ...dados, ...event.data.json() }; } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(dados.titulo, {
      body: dados.mensagem,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientList) => {
      if (clientList.length > 0) return clientList[0].focus();
      return self.clients.openWindow("/alunos.html");
    })
  );
});
