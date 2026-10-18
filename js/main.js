/* js/main.js —— 啟動：註冊 service worker、初始化偏好與介面 */
(function () {
  'use strict';

  /* 僅在 http/https 下註冊（file:// 雙擊開啟時不支援 SW） */
  function register_sw() {
    if (!('serviceWorker' in navigator)) return;
    var proto = location.protocol;
    if (proto !== 'http:' && proto !== 'https:') return;
    try {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
        /* 有新版本時主動檢查（下次導覽即生效） */
        if (reg && reg.update) { try { reg.update(); } catch (e) { } }
      }).catch(function (err) {
        /* 開發時常會失敗，不影響功能 */
        if (window.console && console.warn) console.warn('[sw] 註冊失敗：', err && err.message);
      });
    } catch (e) { /* 忽略 */ }
  }

  function fatal(msg) {
    var app = document.getElementById('app');
    if (app) app.textContent = msg;
  }

  function boot() {
    if (!window.CN_DATASET) {
      fatal('找不到題庫資料（data/dataset.js）。請先執行 tools/build_dataset.py 產生資料。');
      return;
    }
    if (!window.CNCore) { fatal('核心模組 js/core.js 載入失敗。'); return; }
    if (!window.CNUI) { fatal('介面模組 js/ui.js 載入失敗。'); return; }

    window.CNUI.init();
    register_sw();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
