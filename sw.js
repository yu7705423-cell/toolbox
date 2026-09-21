/*
  只缓存合集页自己的外壳（四个文件），让它离线也能打开、进得快。
  各个工具是独立网址，不在这里缓存 —— 它们自己管自己的离线。

  改过 index.html / theme.css 之后把 VERSION 加一，旧缓存会被清掉，
  不然手机上会一直看到旧版本。
*/
const VERSION = 'toolbox-v1';
const SHELL = ['./', 'index.html', 'theme.css', 'manifest.json', 'icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  // 同源的才管，跳去别的工具的请求一律不碰
  if(new URL(req.url).origin !== location.origin) return;
  // 先拿网络（这样一上线就能看到新版），断网了再回退到缓存
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
  );
});
