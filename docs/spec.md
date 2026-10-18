# 中文溫習網站 — 產品與實作規格（v1）

> 本文件是設計與實作的**唯一契約**。兩條工作線（設計 / 實作）都必須遵守；如要改動 DOM 契約，先在此文件更新並通知對方。

## 0. 背景與目標

- 使用者：香港中學生（繁體為主，DSE 中文溫習）。
- 參考：`C:\Users\Hunggy\Desktop\review`（英文單詞網站的複習機制）＋ `https://github.com/asdadada64/shuaige`（單檔中文練習站的題型）。
- 目標：一個**零依賴、純靜態、可離線**的中文溫習網站，涵蓋：
  1. 名句默寫（給上半句默下半句 / 給下半句默上半句）
  2. 詞解（解釋句中加點詞，近義答案算對）
  3. 文學常識／出處（問答＋選擇題）
- 介面與題目預設**繁體**，可一鍵切換**簡體**；作答時繁簡混寫都判對。
- 交付：多檔靜態網站，部署 GitHub Pages；手機可「加到主畫面」離線使用。

## 1. 技術約束

- 原生 HTML + CSS + JavaScript（ES2020），**無框架、無打包、無第三方 CDN**。
- 資料以 `data/dataset.js` 提供（`window.CN_DATASET = {...}`），**不用 fetch**，確保 `file://` 雙擊也能跑。
- 所有狀態存 `localStorage`（key：`cn_review_v1`），不上傳伺服器。
- 手機優先（390px 起），桌面最大內容寬 720–760px。
- 代碼風格：中文註解、蛇形命名（`render_quiz` 除外可用 camelCase 以配合 DOM）、英文小寫檔名。
- 無外部字體檔；中文用系統字（`Songti SC / STSong / SimSun / Source Han Serif` 作標題，`PingFang SC / Microsoft YaHei` 作正文）。

## 2. 檔案與工作線分工

```
index.html                 實作（fixer）
css/style.css              設計（designer）
js/core.js                 實作：純邏輯（資料、判分、隊列、儲存），不碰 DOM
js/ui.js                   實作：渲染與事件
js/main.js                 實作：啟動
data/dataset.js            實作：由 tools/build_dataset.py 產生（勿手改）
data/source/*.csv          原始教材（使用者提供）
tools/build_dataset.py     實作：CSV/JSON → dataset.js（OpenCC 繁簡轉換）
tools/validate_data.py     實作：資料校驗
design/preview.html        設計：所有畫面/狀態的靜態預覽（可 link ../css/style.css）
design/brief.md            設計：設計說明（tokens、間距、狀態、響應式、深色）
manifest.webmanifest       實作
sw.js                      實作：離線快取
icons/                     實作：192/512 PNG（可用 SVG 產生）
README.md                  實作：使用、加教材、部署說明
```

- **designer 只寫** `css/style.css`、`design/preview.html`、`design/brief.md`。
- **fixer 只寫** 其餘檔案（`index.html`、`js/*`、`data/*`、`tools/*`、`manifest`、`sw`、`icons`、`README`）。
- `docs/spec.md` 由 orchestrator 維護。

## 3. 資料模型

`data/dataset.js`：

```js
window.CN_DATASET = {
  meta: {
    title: "中文溫習",
    version: "2026-10-18",
    generated_at: "2026-10-18T12:00:00+08:00"
  },
  units: [
    { id: "guanju", name: "《關雎》", module: "cijie" },
    { id: "xianqin", name: "先秦文學常識", module: "changshi" },
    { id: "mingju", name: "名句（詩經・楚辭）", module: "mingju" }
  ],
  items: [ /* 三種類型，見下 */ ],
  t2s: { "關": "关", "詩": "诗" /* … 只收錄資料中出現的繁體字 */ }
};
```

### 3.1 名句 `type: "mingju"`

```js
{
  id: "mj-001",
  type: "mingju",
  unit: "mingju",
  t: "關關雎鳩，在河之洲；窈窕淑女，君子好逑。",
  s: "关关雎鸠，在河之洲；窈窕淑女，君子好逑。",
  src_t: "《詩經・周南・關雎》",
  src_s: "《诗经・周南・关雎》",
  note: ""            // 可選
}
```

- 題目以第一個標點（`，,；;：:？?！!`）切開；「給上默下」顯示前半（含標點），答案為後半；「給下默上」相反。
- 判分：去標點、去空白、繁→簡後**完全相等**。使用者可按「意思對了，算我對」覆寫。

### 3.2 詞解 `type: "cijie"`

```js
{
  id: "cj-001",
  type: "cijie",
  unit: "guanju",
  q_t: "窈窕【淑女】，君子好逑。",
  q_s: "窈窕【淑女】，君子好逑。",
  w_t: "淑女",
  w_s: "淑女",
  a_t: ["文靜而美好的女子"],
  a_s: ["文静而美好的女子"],
  k_t: ["文靜", "美好", "美善"],
  k_s: ["文静", "美好", "美善"],
  note: ""
}
```

- 題面把 `【…】` 內的詞加上着重號（漢字下小圓點），其餘正常顯示。
- 標準答案可多個（任何一個對即算對）；`k` 是核心義項關鍵詞，答中任一即算對。
- 判分前先去掉「意思是／指／即／的意思」等外殼。

### 3.3 常識／出處 `type: "changshi"`

```js
{
  id: "cs-001",
  type: "changshi",
  unit: "xianqin",
  q_t: "第一部詩歌總集",
  q_s: "第一部诗歌总集",
  a_t: "《詩經》",
  a_s: "《诗经》",
  accept: ["詩經", "诗经", "诗经"],
  note: ""
}
```

- 問答：輸入比對 `a_t/a_s` 或 `accept` 任一（去標點書名號後相等）。
- 選擇題：以同 unit／同 type 的其他答案作干擾項。

### 3.4 `t2s` 對照表

- 只收錄資料中出現的繁體字；`build_dataset.py` 用 OpenCC `t2s` 逐字產生。
- 執行時判分用 `t2s` 正規化；顯示用 `s` 欄位（預先轉好，避免逐字轉換出錯）。

## 4. 模組與模式

### 4.1 模組（首頁四張卡）

| module | 名稱 | 題型 |
| --- | --- | --- |
| `mingju` | 名句默寫 | 給上默下 / 給下默上 / 選擇題 / 翻卡 |
| `cijie` | 詞解 | 手打 / 選擇題 / 翻卡 |
| `changshi` | 文學常識・出處 | 手打 / 選擇題 / 翻卡 |
| `mixed` | 全部混合 | 以上全部（隨機題型） |

### 4.2 模式

1. **練習**（預設）：逐題作答，錯題重現（見 §6）。
2. **⚡ 速通**：範圍內每題一次、自動跳下一題（約 900ms）、結算顯示正確率，可「重練本次錯題」。
3. **🃏 翻卡**：先回想、翻面看答案、自評「記住了／還沒記住」，未記住 5 張後重現。
4. **📖 瀏覽**：搜尋＋單元篩選＋展開詳情（不計分）。

### 4.3 範圍與設定

- 範圍：該模組下的 unit chips（可多選）＋「全部」。
- 順序：亂序（預設）／原順序。
- 作答方式：手打（預設）／選擇題。
- 字形：繁體（預設）／簡體。
- 偏好即時保存（`settings`）。

## 5. 頁面與 DOM 契約

> class／id 為契約，設計可加修飾 class，但不得改名或搬走 hook。所有可點元素需 ≥44px 觸控區。

### 5.0 全域

```html
<html lang="zh-Hant" data-theme="light" data-script="t">
<body>
  <div id="app"></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <div id="overlay" class="overlay" hidden></div>
</body>
```

- `data-theme`: `light` / `dark`；`data-script`: `t` / `s`。
- `#toast` 用 `.toast.is-show` 顯示。
- `#overlay` 用於確認框／匯入說明。

### 5.1 Appbar（每個畫面共用）

```html
<header class="appbar">
  <button class="appbar-back" data-action="back" aria-label="返回">‹</button>
  <div class="appbar-title">
    <div class="appbar-title-main">中文溫習</div>
    <div class="appbar-title-sub">練習 · 自動判分 · 繁簡皆可</div>
  </div>
  <div class="appbar-tools">
    <button class="tool" data-action="toggle-script" title="切換繁簡">繁</button>
    <button class="tool" data-action="toggle-theme" title="深色模式">🌙</button>
    <button class="tool" data-action="font-dec" title="縮小字號">A-</button>
    <button class="tool" data-action="font-inc" title="放大字號">A+</button>
  </div>
</header>
```

- 首頁不顯示 `.appbar-back`（以 `hidden` 隱藏）。
- `data-action="toggle-script"` 按鈕文字隨字形顯示「繁」或「簡」。

### 5.2 畫面容器

```html
<main class="screen" data-screen="home|setup|quiz|result|browse|stats|settings">…</main>
```

### 5.3 首頁 `data-screen="home"`

```html
<section class="hero">
  <p class="hero-kicker">文言 · 默寫 · 詞解</p>
  <h1 class="hero-title">中文溫習</h1>
  <p class="hero-sub">每天十分鐘，把名句與詞解記牢。</p>
  <div class="hero-stats">
    <div class="stat"><span class="stat-value">12</span><span class="stat-label">今日已答</span></div>
    <div class="stat"><span class="stat-value">76%</span><span class="stat-label">正確率</span></div>
    <div class="stat"><span class="stat-value">8</span><span class="stat-label">待複習</span></div>
  </div>
</section>

<div class="module-grid">
  <button class="module-card" data-module="mingju">
    <span class="module-card-no">一</span>
    <span class="module-card-body">
      <span class="module-card-name">名句默寫</span>
      <span class="module-card-desc">給上／下半句，手寫默出</span>
      <span class="module-card-meta">共 52 題 · 已掌握 18</span>
      <span class="module-progress"><i style="width:35%"></i></span>
    </span>
    <span class="module-card-go">›</span>
  </button>
  <!-- 詞解 / 常識 / 混合 同構 -->
</div>

<div class="quick-row">
  <button class="quick" data-action="open-stats">📊 錯題統計</button>
  <button class="quick" data-action="open-browse">📖 瀏覽</button>
  <button class="quick" data-action="open-settings">⚙️ 設定</button>
</div>
<footer class="appfoot">…</footer>
```

### 5.4 設定畫面 `data-screen="setup"`（每個模組的練習設定）

```html
<section class="setup">
  <h2 class="setup-title">名句默寫</h2>
  <p class="setup-desc">標點由系統給出，只需默寫漢字；繁簡皆可。</p>

  <div class="setup-block">
    <h3 class="setup-label">範圍</h3>
    <div class="chips" data-field="units">
      <button class="chip is-on" data-value="all">全部</button>
      <button class="chip" data-value="guanju">《關雎》<span class="chip-count">18</span></button>
    </div>
  </div>

  <div class="setup-block">
    <h3 class="setup-label">模式</h3>
    <div class="segmented" data-field="mode">
      <button class="seg is-on" data-value="practice">練習<span class="seg-sub">錯題會重現</span></button>
      <button class="seg" data-value="speed">⚡ 速通<span class="seg-sub">一次刷完</span></button>
      <button class="seg" data-value="flash">🃏 翻卡<span class="seg-sub">自評記憶</span></button>
    </div>
  </div>

  <div class="setup-block" data-block="question">
    <h3 class="setup-label">作答方式</h3>
    <div class="segmented" data-field="question">
      <button class="seg is-on" data-value="type">手打</button>
      <button class="seg" data-value="mc">選擇題</button>
    </div>
  </div>

  <div class="setup-block" data-block="mingju-direction">
    <h3 class="setup-label">默寫方向</h3>
    <div class="segmented" data-field="direction">
      <button class="seg is-on" data-value="hs">給上默下</button>
      <button class="seg" data-value="sh">給下默上</button>
    </div>
  </div>

  <div class="setup-block">
    <h3 class="setup-label">順序</h3>
    <div class="segmented" data-field="order">
      <button class="seg is-on" data-value="shuffle">亂序</button>
      <button class="seg" data-value="original">原順序</button>
    </div>
  </div>

  <button class="btn btn-primary start-btn" data-action="start">開始練習（52 題）</button>
</section>
```

- `混色`… 模組為 mixed 時，`data-block="question"` 顯示、`direction` 只在有 mingju 時顯示。
- 翻卡模式時 `data-block="question"` 隱藏。
- chips：`aria-pressed` 同步，`is-on` 為選中態。

### 5.5 答題 `data-screen="quiz"`

```html
<section class="quiz">
  <div class="quiz-head">
    <span class="quiz-progress-text">第 3 / 52 題</span>
    <span class="quiz-score"><span class="is-ok">✓ 2</span><span class="is-bad">✗ 1</span></span>
    <button class="btn-mini" data-action="reshuffle">重新打亂</button>
  </div>
  <div class="progress"><i style="width:6%"></i></div>

  <article class="qcard" data-qtype="mingju|cijie|changshi" data-state="asking|answered|flash-front|flash-back|review">
    <p class="q-ask">請默寫下半句：</p>
    <div class="q-prompt han">非淡泊無以明志，</div>
    <p class="q-hint">標點已給出，共需 7 個漢字（繁簡皆可）</p>

    <!-- 手打 -->
    <form class="answer-form" autocomplete="off">
      <input class="answer-input" id="answerInput" type="text" ... />
      <button class="btn btn-primary" data-action="submit" type="submit">提交</button>
    </form>

    <!-- 選擇題 -->
    <div class="options" data-mode="mc">
      <button class="option" data-index="0"><span class="option-key">A</span><span class="option-text">…</span></button>
      <!-- B C D -->
    </div>

    <!-- 翻卡按鈕 -->
    <div class="card-controls">
      <button class="btn btn-ghost" data-action="flip">翻面</button>
      <button class="btn btn-ghost" data-action="again">✗ 還沒記住</button>
      <button class="btn btn-primary" data-action="known">✓ 記住了</button>
    </div>

    <!-- 作答後 -->
    <div class="verdict is-ok">✓ 默寫正確</div>
    <div class="answer-box">
      <div class="answer-line han">非寧靜無以致遠。</div>
      <div class="answer-src">—— 諸葛亮《誡子書》</div>
      <div class="your-answer">你寫的是：非寧靜無以致遠</div>
      <button class="btn btn-ghost" data-action="override">意思對了，算我對</button>
    </div>
    <div class="review-banner">回顧中 · 按 → 返回</div>
  </article>

  <div class="quiz-actions">
    <button class="btn-mini" data-action="hard" aria-pressed="false">⭐ 標記</button>
    <button class="btn-mini" data-action="giveup">看答案</button>
    <button class="btn btn-primary" data-action="next">下一題 ›</button>
    <button class="btn-mini" data-action="prev-review">‹ 回顧</button>
  </div>
</section>
```

- 只渲染當前狀態需要的節點；用 `hidden` 控制顯示，其他狀態元素可不存在。
- `data-qtype` 決定加點詞渲染、提示文案。
- 選擇題：`data-mode="mc"`、`.option[data-index]`，答後 `.option.is-correct` / `.option.is-wrong`，正確答案永遠標綠。
- 翻卡：`data-state="flash-front"` 只顯示 `.q-prompt`（不泄露答案）＋「翻面」；`flash-back` 顯示 `.answer-box`＋自評按鈕；自評按鈕在正面時 disabled。
- 回顧：`data-state="review"` 顯示該題完整資料＋`.review-banner`，不可再作答。

### 5.6 結算 `data-screen="result"`

```html
<section class="result">
  <div class="result-hero">
    <div class="result-rate">86%<small>正確率</small></div>
    <p class="result-sub">52 題 · 答對 45 · 答錯 7</p>
  </div>
  <div class="result-stats">
    <div class="stat"><span class="stat-value">45</span><span class="stat-label">答對</span></div>
    <div class="stat"><span class="stat-value">7</span><span class="stat-label">答錯</span></div>
    <div class="stat"><span class="stat-value">6:32</span><span class="stat-label">用時</span></div>
  </div>
  <div class="result-actions">
    <button class="btn btn-primary" data-action="again">再來一輪</button>
    <button class="btn btn-ghost" data-action="retry-wrong">只練錯題</button>
    <button class="btn btn-ghost" data-action="home">回首頁</button>
  </div>
  <div class="wrong-list">
    <article class="wrong-item">
      <p class="wrong-q">請默寫下半句：非淡泊無以明志，</p>
      <p class="wrong-a han">非寧靜無以致遠。</p>
      <p class="wrong-meta">你寫的是：非寧靜無以致遠　·　諸葛亮《誡子書》</p>
    </article>
  </div>
</section>
```

### 5.7 瀏覽 `data-screen="browse"`

```html
<section class="browse">
  <div class="browse-tools">
    <input class="search-input" id="browseSearch" type="search" placeholder="搜尋名句、詞解、出處…" />
  </div>
  <div class="chips" data-field="units">…</div>
  <div class="browse-list">
    <button class="browse-item" data-id="mj-001">
      <span class="browse-item-head">
        <span class="browse-item-term han">關關雎鳩，在河之洲；窈窕淑女，君子好逑。</span>
        <span class="browse-item-sub">《詩經・周南・關雎》</span>
      </span>
      <span class="browse-item-body" hidden>… 完整資料／詞解 …</span>
    </button>
  </div>
  <p class="empty">沒有符合的項目。</p>
</section>
```

### 5.8 錯題統計 `data-screen="stats"`

```html
<section class="stats-screen">
  <div class="stats-summary">
    <div class="stat"><span class="stat-value">14</span><span class="stat-label">錯題總數</span></div>
    <div class="stat"><span class="stat-value">3.2</span><span class="stat-label">平均錯誤</span></div>
  </div>
  <table class="wrong-table">
    <thead><tr><th>題目</th><th>答錯</th><th>答對</th></tr></thead>
    <tbody>
      <tr><td class="wrong-table-q">窈窕【淑女】</td><td>3</td><td>1</td></tr>
    </tbody>
  </table>
  <div class="stats-actions">
    <button class="btn btn-primary" data-action="practice-wrong">只練這些錯題</button>
    <button class="btn btn-ghost" data-action="clear-wrong">清空錯題記錄</button>
  </div>
  <p class="empty">還沒有錯題，繼續保持。</p>
</section>
```

### 5.9 設定 `data-screen="settings"`

```html
<section class="settings">
  <div class="setting-row">
    <div class="setting-text"><b>字形</b><small>介面與題目顯示</small></div>
    <div class="segmented" data-field="script">
      <button class="seg is-on" data-value="t">繁體</button>
      <button class="seg" data-value="s">簡體</button>
    </div>
  </div>
  <div class="setting-row">…深色模式 / 字號…</div>
  <div class="settings-actions">
    <button class="btn btn-ghost" data-action="export">📤 匯出進度</button>
    <button class="btn btn-ghost" data-action="import">📥 匯入進度</button>
    <input id="importFile" type="file" accept=".json" hidden />
    <button class="btn btn-ghost danger" data-action="reset">重設所有進度</button>
  </div>
  <p class="about">資料只存在你的瀏覽器；換裝置請先匯出。</p>
</section>
```

## 6. 複習機制（核心）

- 一輪隊列 = 範圍內題目（亂序或原序）。
- **答錯**：即時把同一題重新插入隊列，間隔依該題在本輪的錯誤次數：第 1 次 +5、第 2 次 +10、第 3 次起 +20（插到隊尾則提前結束）。
- **答對**：若該題在本輪是首次答對，於 +15 題後再鞏固一次（只鞏固一次）。
- **速通**：不重現，逐題一次；結算可重練本次錯題。
- **翻卡**：按「還沒記住」→ +5 張後重現，直到按「記住了」為止。
- 進度條以「已完成題數 / 本輪總題數（含重現）」估算，避免倒退。
- 每題統計（跨輪次保存）：`wrong`、`correct`、`hard`、`last_wrong`。
  - 「待複習」= `wrong > 0 && correct < 2`。
  - 「已掌握」= `correct >= 2`。
- 錯題頁按 `wrong` 倒序；可「只練這些錯題」。
- 「重新打亂」只打亂未答部分。

## 7. 判分細節

```js
norm(text)      // 只保留漢字，t2s 轉簡，去掉標點/空白/英數
norm_answer(s)  // 再去掉「意思是/指/即/為/就是/指的是」前綴與「的意思/之意」後綴
```

- 名句：`norm(用戶) === norm(標準答案)`。
- 詞解：`norm_answer(用戶)` 等於任一 `a`，或包含任一 `k`（`k` 長度 ≥ 1 漢字）。
- 常識：`norm_answer(用戶)` 等於 `a` 或任一 `accept`（比較時去掉書名號）。
- 選擇題：選中 `option.dataset.index` 對應正確項。
- 所有題型提供「算我對」覆寫（選擇題除外）。
- 使用者輸入為空時不提交，提示「請先寫下答案」。

## 8. 鍵盤與無障礙

- `1`–`4` 選擇選項；`Enter` 提交／下一題；`←` 回顧上一題；`→` 由回顧返回；`Space` 翻卡；`A` 標記；`Esc` 回首頁／關閉覆蓋層。
- 輸入框自動 focus；`aria-live` 宣佈判分結果；所有按鈕有可讀 label。
- 尊重 `prefers-reduced-motion`。

## 9. 資料建置

`tools/build_dataset.py`：

1. 讀 `data/source/*.csv`（UTF-8，表頭 `word,chinese,example`）：
   - 檔名含 `cijie` → 詞解；`mingju` → 名句；`xianqin`／`zhuzi`／`changshi` → 常識。
2. 詞解：`word` 為詞、`chinese` 為答案、`example` 為例句。若例句含該詞，用 `【】` 標出第一次出現；否則以「解釋「word」」作題面。
3. 名句：`word` 為句子、`chinese` 為出處；用 OpenCC 產生繁體 `t` 與簡體 `s`。
4. 常識：`word` 為問、`chinese` 為答；`accept` 由答案去掉書名號後生成。
5. 產生 `t2s`（資料中每個繁體字 → 簡體）。
6. 寫出 `data/dataset.js`；同步 `data/dataset.json`（供校驗與除錯）。
7. 產生穩定 `id`：`mj-001` / `cj-001` / `cs-001`，以來源檔＋行號排序。

`tools/validate_data.py`：檢查必填欄位、重複 id、括號配對、名句可切半、t2s 覆蓋率、簡繁欄位長度一致。

## 10. 設計要求（designer）

- 氣質：紙感、書卷氣、現代編輯排版；不要「模板 Bootstrap」感。
- 色：米白紙底、墨黑正文、朱砂紅作強調、金棕作進度／次強調；深色為墨底紙白。
- 標題用宋體／襯線，正文用無襯線；行高 1.7–1.9；詩句放大（24–28px）。
- 卡片圓角 14–18px、邊框 1px 半透明、極輕陰影；不要重陰影。
- 動效 160–240ms，答對／答錯用顏色＋輕微位移，不做花俏動畫。
- 手機：底部操作條 sticky；安全區 `env(safe-area-inset-bottom)`。
- 深色模式變數完整；`data-theme="dark"`。
- 字號：`--fs-scale`（0.9 / 1 / 1.1 / 1.2），由 `html[style]` 或 `data-font` 控制。
- 提供 `design/preview.html`：用假資料靜態展示所有畫面與狀態（含深色切換示範），供實作對照與使用者預覽。

## 11. 驗收清單

- [ ] 首頁四張模組卡、統計數字正確；點擊進入設定。
- [ ] 名句：給上默下 / 給下默上；繁簡互寫判對；標點不影響。
- [ ] 詞解：加點詞正確顯示；近義答案（關鍵詞）判對；可覆寫。
- [ ] 常識：手打與選擇題均可。
- [ ] 選擇題：4 選項、正確項標綠、錯項標紅、鍵盤 1–4。
- [ ] 練習：錯題 5/10/20 重現；答對 15 題後鞏固一次；結算正確。
- [ ] 速通：自動跳題、結算、重練錯題。
- [ ] 翻卡：正面不泄露答案；翻面自評；未記住重現。
- [ ] 回顧：← 回看上一題、→ 返回、回顧中不改分。
- [ ] 瀏覽：搜尋（繁簡皆可找到）、單元篩選、展開詳情。
- [ ] 錯題統計：排序、只練錯題、清空。
- [ ] 繁簡切換：介面＋題目＋選項全切換；重新載入保持。
- [ ] 深色模式、字號調整、偏好持久化。
- [ ] 匯出／匯入進度；重設。
- [ ] 刷新／關閉再開，進度保留。
- [ ] 手機 390×844 無橫向滾動；按鈕不被底部安全區遮擋。
- [ ] `file://` 雙擊可運行（資料以 JS 載入）。
- [ ] 部署 GitHub Pages 後可用；加到主畫面離線可開。
- [ ] 無 console error；鍵盤操作完整。
```

