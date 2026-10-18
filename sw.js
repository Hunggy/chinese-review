/* sw.js —— 離線快取
 * 策略：導覽請求 network-first（離線回退快取）；其他靜態資源
 * stale-while-revalidate（先回快取，同時背景更新）。
 * ⚠️ 每次發版請修改下面的 VERSION（日期＋流水號），activate 會清掉舊版快取。
 * 只在 http/https 下註冊（file:// 不支援）。
 */
(function () {
  'use strict';

  var VERSION = 'cn-review-2026-10-18.7';

  var PRECACHE = [
    './',
    './index.html',
    './manifest.webmanifest',
    './css/style.css',
    './js/core.js',
    './js/ui.js',
    './js/main.js',
    './data/dataset.js',
    './icons/icon-192.png',
    './icons/icon-512.png'
  ];

  self.addEventListener('install', function (e) {
    e.waitUntil(
      caches.open(VERSION).then(function (cache) {
        /* 逐項加入：任何一項缺失都不該讓安裝失敗（例如 CSS 尚未產生） */
        return Promise.all(PRECACHE.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () { });
        }));
      }).then(function () { return self.skipWaiting(); })
    );
  });

  self.addEventListener('activate', function (e) {
    e.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== VERSION) return caches.delete(k);
          return null;
        }));
      }).then(function () { return self.clients.claim(); })
    );
  });

  function should_handle(req, url) {
    if (req.method !== 'GET') return false;
    if (url.origin !== self.location.origin) return false;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return true;
  }

  function put(req, res) {
    if (!res || !res.ok || res.type !== 'basic') return;
    var copy = res.clone();
    caches.open(VERSION).then(function (c) { c.put(req, copy); }).catch(function () { });
  }

  /* 導覽請求：network-first，失敗才用快取 */
  function network_first(req) {
    return fetch(req, { cache: 'no-store' }).then(function (res) {
      put(req, res);
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    });
  }

  /* 靜態資源：stale-while-revalidate */
  function stale_while_revalidate(req) {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      var network = fetch(req, { cache: 'no-store' }).then(function (res) {
        put(req, res);
        return res;
      }).catch(function () { return null; });
      if (hit) {
        /* 不 await：背景更新，先回快取 */
        return hit;
      }
      return network.then(function (res) {
        return res || new Response('', { status: 504, statusText: 'Offline' });
      });
    });
  }

  self.addEventListener('fetch', function (e) {
    var req = e.request;
    var url;
    try { url = new URL(req.url); } catch (err) { return; }
    if (!should_handle(req, url)) return;

    var is_navigate = req.mode === 'navigate' || req.destination === 'document';
    e.respondWith(is_navigate ? network_first(req) : stale_while_revalidate(req));
  });

  /* 讓頁面可主動要求接管新版 */
  self.addEventListener('message', function (e) {
    if (e.data === 'skip-waiting') self.skipWaiting();
  });
})();
