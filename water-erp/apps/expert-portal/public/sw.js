/**
 * 轻量 app-shell service worker（Phase ⑤ Task 6）
 *
 * 策略：
 *   - 导航请求（HTML）：network-first，离线回退到缓存的 shell
 *   - 同源静态资源（JS/CSS/图片）：stale-while-revalidate
 *   - 跨域/API：不拦截，直接走网络
 *
 * 显式避开：/api/*（必须始终走网络，评标数据实时性要求高）
 */

const CACHE = 'expert-portal-shell-v1';
const SHELL_URLS = ['/', '/manifest.webmanifest', '/assets/logo.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
      .catch(() => { /* shell 预缓存失败不阻塞安装 */ }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 不同源 或 /api/* —— 放行
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  // HTML 导航：network-first，离线 fallback 到缓存的 shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((r) => r || caches.match('/')),
        ),
    );
    return;
  }

  // 同源静态资源：stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
