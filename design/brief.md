# 中文溫習 · 設計說明（brief）

> 對應檔案：`css/style.css`（設計系統）、`design/preview.html`（所有畫面／狀態靜態預覽）
> 契約來源：`docs/spec.md`（本文件只描述視覺，不改變任何 DOM 契約）

---

## 1. 設計理念

**紙感・書卷氣・現代編輯排版。**

三個關鍵決定：

1. **紙不是背景，是材質。** 底色用暖米白（`#F5EFE2`），上疊一層極淡的紙纖維顆粒（內嵌 SVG `feTurbulence` 資料 URI，無外部資源、`file://` 可用），寬螢幕再於內容欄兩側畫「界行」髮絲線——像古籍的版框，讓 720px 的內容欄變成「一頁紙」而不是「一個容器」。
2. **線比框重要。** 全站幾乎不用重陰影，改用 1px 半透明髮絲線 ＋ 朱砂短劃（書眉／句讀）、雙細線（天頭 appbar、地腳操作條、區塊標題）。層級靠線與留白建立，不靠陰影。
3. **漢字是主角。** 標題、詩句、答案、數字一律用宋體／襯線（系統字堆疊），並放大到 24–28px、行高 1.9；正文用無襯線 17.8px 起。漢字與拉丁字混排時，中文永遠是視覺重心。

視覺識別符號：**朱砂小菱角**（`hero-kicker` 前的句讀點）、**朱砂書口**（卡片 hover／展開時的左側 3px 色條）、**朱砂印記**（結算頁大字正確率）。

---

## 2. 設計 tokens（`css/style.css` §0）

### 2.1 色彩

| token | 淺色 | 深色 | 用途 | 對比（vs 底色） |
| --- | --- | --- | --- | --- |
| `--paper` | `#F5EFE2` | `#16140F` | 紙底 | — |
| `--paper-2` | `#FCF8EF` | `#1E1B15` | 浮起面（卡片） | — |
| `--paper-3` | `#EDE5D4` | `#272218` | 凹陷面（輸入框、進度槽） | — |
| `--ink` | `#221E19` | `#F1EADB` | 正文 | 14.3:1 / 14.8:1 |
| `--ink-2` | `#4E453A` | `#C7BDAA` | 次要文字 | 8.4:1 / 9.9:1 |
| `--ink-3` | `#6B6152` | `#9A9184` | 說明／眉批 | 4.9:1 / 4.9:1 |
| `--accent` / `--accent-ink` | `#B23A2C` / `#8E2A1E` | `#D9694F` / `#EE9A83` | 朱砂：強調、行動、錯誤 | 5.3:1 / 7.0:1（深：6.2:1） |
| `--on-accent` | `#FFF8EC` | `#15110C` | 朱砂實心上的字 | 5.9:1 / 5.5:1 |
| `--gold` | `#7A5B26` | `#D3B070` | 金棕：進度、回顧、次強調 | 5.1:1 / 8.4:1 |
| `--ok` | `#2C6A4C` | `#7CC49B` | 答對 | 5.6:1 / 8.6:1 |
| `--bad` | `#A32B1E` | `#E88A77` | 答錯 | 5.6:1 / 6.8:1 |

全部都過 WCAG **AA**（≥4.5:1）；正文與標題實際落在 8:1 以上。朱砂只用於強調、行動與錯誤，不作大面積底色。

### 2.2 字體（純系統字，零外部檔案）

```css
--font-serif: "Songti SC","Songti TC","STSong","Noto Serif CJK TC",
              "Source Han Serif TC","SimSun","PMingLiU","MingLiU",Georgia,serif;
--font-sans:  "PingFang HK","PingFang TC","PingFang SC","Hiragino Sans GB",
              "Microsoft JhengHei","Microsoft YaHei","Noto Sans CJK TC",
              "Source Han Sans TC","Heiti TC","Segoe UI",system-ui,sans-serif;
```

- 標題／詩句／答案／數字 → `--font-serif`（宋體襯線），字距 `0.03–0.08em`。
- 正文／介面／按鈕 → `--font-sans`。
- 香港優先：`PingFang HK` → `Microsoft JhengHei`（Windows 繁中）。

### 2.3 字級

`1rem = var(--fs-base) × var(--fs-scale)`，`--fs-base: 17.8px`。

| token | md 實測 | 用途 |
| --- | --- | --- |
| `--fs-2xs` | 12.8px | 眉批、`chip-count`、`.q-hint`、`.appfoot` |
| `--fs-xs` | 14.2px | 說明、`.option-sub`、表格 |
| `--fs-sm` | 15.7px | 次要文字、按鈕、`seg` |
| `--fs-md` | 17.8px | 正文（≥16px 驗收） |
| `--fs-lg` | 19.9px | 卡片標題、輸入框、`appbar` 主標 |
| `--fs-xl` | 23.5px | 區塊標題、`stat-value` |
| `--fs-2xl` | 30.3px | `setup-title` |
| `--fs-3xl` | 38.3px | `hero-title`（clamp 後 35–55px） |
| 詩句 | 24–28px | `.q-prompt` `clamp(1.35rem, 6.6vw, 1.62rem)` |
| 答案 | 22–26px | `.answer-line` |
| 結算數字 | 57–70px | `.result-rate` |

**字號縮放**（規格 §10，`0.9 / 1 / 1.1 / 1.2`）：同時支援 `html[data-font="sm|md|lg|xl"]` 與 `html[style="--fs-scale:1.1"]`（行內樣式優先）。選 `--fs-base: 17.8px` 是為了讓最小值 `0.9` 仍有 **16.02px**，不違反「正文 16px 起」。

### 2.4 間距／圓角／陰影／動效

- 間距 `--sp-1..9` = 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56px；`--gutter` = 18px（≥480px 為 24px）。
- 圓角 `--r-xs..lg` = 8 / 12 / 14 / 18px ＋ `--r-pill`（膠囊：chip、進度條、badge）。
- 陰影只有三級且極淡：`--shadow-1`（卡）／`--shadow-2`（hover、黏底條）／`--shadow-3`（對話框）。
- 動效 `--t-fast 160ms` / `--t-base 200ms` / `--t-slow 240ms`，單一緩動 `cubic-bezier(.22,.68,.28,1)`。
- 版面 `--content-max: 720px`。

---

## 3. 畫面與狀態覆蓋

預覽頁 `design/preview.html` 可切換 **18 個畫面**（工具列亦可切深色、繁簡示範、四級字號、390px 手機框）：

| # | 預覽按鈕 | `data-screen` / `data-state` | 覆蓋重點 |
| --- | --- | --- | --- |
| 1 | 首頁 | `home` | hero＋統計、四模組卡（進度條）、quick 列、appfoot、進場錯落動畫 |
| 2 | 練習設定 | `setup` | chips 選中／未選、segmented（含 `seg-sub`）、chips 換行 |
| 3 | 答題·名句未答 | `quiz` / `asking` | 進度條、分數 badge、輸入框、sticky 操作條 |
| 4 | 答題·答對 | `answered` | `.verdict.is-ok`、答案區、唯讀輸入、卡片綠左條 |
| 5 | 答題·答錯 | `answered` | `.verdict.is-bad`（輕微推移）、錯題重現提示 |
| 6 | 答題·詞解 | `asking` | **加點詞着重號**（朱砂小圓點）、近義提示 |
| 7 | 選擇題·未答 | `asking` | `.options` A/B/C/D 鍵盤角標、選項進場 |
| 8 | 選擇題·已答 | `answered` | `.is-correct` 標綠、`.is-wrong` 標紅、`[disabled]` |
| 9 | 翻卡·正面 | `flash-front` | 只露題面、自評按鈕 `disabled` |
| 10 | 翻卡·背面 | `flash-back` | 答案區＋自評三鍵 |
| 11 | 回顧 | `review` | `.review-banner`、不再計分、金棕左條 |
| 12 | 結算 | `result` | 大字正確率、三格統計、錯題清單 |
| 13 | 瀏覽 | `browse` | 搜尋框、單元 chips、展開詳情（`.is-open`／`aria-expanded="true"`） |
| 14 | 瀏覽·無結果 | `browse` | `.empty` 空狀態 |
| 15 | 錯題統計 | `stats` | `wrong-table`（固定欄寬、加點詞）、排序數字 |
| 16 | 錯題·空 | `stats` | 空表格＋`.empty`＋`[disabled]` 清空鍵 |
| 17 | 設定頁 | `settings` | `setting-row` 四種、`.danger`、`.about` |
| 18 | 對話框＋提示 | `settings` | `#overlay` 對話卡（列點、雙鍵）、`#toast.is-show` |

### 狀態矩陣

| 元件 | 預設 | hover | 選中／開啟 | 正確／成功 | 錯誤 | disabled | 焦點 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `.chip` | 紙白＋細框 | 框加深 | `.is-on`／`aria-pressed="true"` → 朱砂框＋淡底 | — | — | — | 朱砂外框 |
| `.seg` | 透明（在凹陷槽內） | 文字轉墨 | `.is-on` → 浮起＋微陰影＋`seg-sub` 轉朱砂 | — | — | — | 朱砂外框 |
| `.btn-primary` | 朱砂實心 | 提亮 6% | — | — | — | 半透明、停用游標 | 朱砂外框 |
| `.btn-ghost` | 紙白＋細框 | 凹陷底 | — | — | `.danger` 轉朱砂 | 同上 | 朱砂外框 |
| `.btn-mini` | 紙白＋細框 | 凹陷底 | `aria-pressed="true"`（⭐標記）→ 金棕 | — | — | 同上 | 朱砂外框 |
| `.option` | 細框 | 凹陷底 | `.is-picked`／`aria-pressed` → 朱砂 | `.is-correct` → 綠框綠角標 | `.is-wrong` → 朱砂框紅角標 | 游標還原、色態保留 | 朱砂外框 |
| `.module-card` | 卡＋淡陰影 | 上浮 2px＋朱砂書口＋箭頭位移 | — | — | — | — | 朱砂外框 |
| `.browse-item` | 卡 | 框加深 | `.is-open`／`aria-expanded="true"` → 朱砂左條 | — | — | — | 朱砂外框 |
| `.answer-input` | 凹陷底 | 框加深 | 聚焦 → 紙白＋朱砂框＋3px 光暈 | — | — | `readonly`／`disabled` → 虛線框、**字色不淡化** | 朱砂光暈 |
| `.qcard` | 卡 | — | `[data-state="review"]` → 金棕左條 | `.is-ok` → 綠左條 | `.is-bad` → 朱砂左條 | — | — |
| `#toast` | 隱形 | — | `.is-show` → 浮起＋淡入 | — | — | — | — |
| `#overlay` | — | — | 預設 `hidden`；顯示時罩層＋對話卡 | — | — | — | — |

### 着重號（詞解加點詞）

```css
text-emphasis: dot; text-emphasis-position: under right; text-emphasis-color: var(--accent);
```

契約未指定加點詞用什麼元素包住，因此 CSS 對 `.q-prompt` 內部的 `em / i / b / mark / .dot / .word / .em /.cijie-word` **全部兜底**（並在 `.han` 內同樣生效），實作端用哪個都能出正確效果。預覽頁第 6 個畫面可直接檢查小圓點。

---

## 4. 響應式

| 斷點 | 變化 |
| --- | --- |
| ≤360px | 快捷列改 2 欄、操作條縮字距、`quick` 收窄 |
| ≤439px | 收起 `appbar-title-sub`（4 個工具鍵＋標題已佔滿 390px，避免出現「…」截字） |
| 390px（手機基準） | 單欄、sticky 底部操作條＋`env(safe-area-inset-bottom)` |
| ≥480px | `--gutter` 18→24px |
| ≥560px | 模組卡 2 欄、答案表單改左右排、翻卡三鍵橫排、結算／統計按鈕橫排、設定按鈕 2 欄 |
| ≥760px | 卡片內距加大、`appbar` 加高、操作條由「通欄」變成懸浮圓角條（保留 sticky） |
| ≥1080px | 顯示界行（`body::after` 髮絲線） |

**底部安全區**：`.quiz-actions` 用 `padding-bottom: calc(var(--sp-3) + env(safe-area-inset-bottom, 0px))`；`#toast` 位置亦加同一 inset。為了讓「黏底條」在內容很短的頁面也貼齊視窗底（否則會浮在半空、下方留一大片空白），版面用了一組結構：`#app` 為直向 flex＋`min-height:100vh`、`.screen` `flex:1 0 auto`、`.screen:has(> .quiz)` 與 `.quiz` 再成直向 flex、`.quiz-actions` `margin-top:auto`；並以 `.screen:has(.quiz-actions){padding-bottom:0}` 讓條身貼齊視窗底。內容長時 `margin-top:auto` 自動變 0，卡片與條之間仍有 `.qcard` 的 24px 下邊距。（已用真實 `index.html` 實測：條身 `bottom = 視窗高`，滾到底答案區與「算我對」按鈕完整可見。）

**提示條（toast）**：`width:max-content` ＋ `max-width:min(88vw,420px)`。若只寫 `max-width`，在 `left:50%` 下可用寬度只有半個畫面，短句會被迫折成兩行。

**390×844 無橫向滾動**：以 `html{overflow-x:clip}`＋表格 `table-layout:fixed`＋`overflow-wrap` 處理；已用瀏覽器逐畫面量測（見 §7）。

---

## 5. 深色模式

`html[data-theme="dark"]` 重寫全部色彩 token：**墨底（`#16140F`）紙白字（`#F1EADB`）**，朱砂提亮為 `#D9694F`（實心按鈕改配近黑字，維持 5.5:1），金棕提亮為 `#D3B070`。顆粒紋理改用 `soft-light` 混合、透明度降至 0.2；陰影加深（深色下淡陰影看不見）。另外三處小覆寫：模組卡數字底、選項角標字色、唯讀輸入框底色。**主題切換不需要任何額外 class，全部靠 token。**

---

## 6. 無障礙

- **對比**：正文／次要／說明三級在兩個主題都 ≥4.5:1；狀態色（綠／朱砂／金棕）配淡底亦 ≥5:1。唯讀輸入框刻意**不淡化字色**（`-webkit-text-fill-color` 覆寫），讓已答內容仍達正文對比。
- **觸控區 ≥44px**：`.btn`(50)、`.btn-mini`/`.chip`/`.tool`/`.appbar-back`(44)、`.seg`(48)、`.option`(56)、`.quick`(56)、`.module-card`(96)、`.answer-input`(54)、`.search-input`(50)。
- **焦點**：`:focus-visible` 統一 2px 朱砂外框＋2px 位移；滑鼠點擊不顯示外框；輸入框改用朱砂光暈。
- **reduced motion**：`prefers-reduced-motion: reduce` 時所有動畫／過渡縮到 0.001ms（單一 `!important`，屬標準寫法）。
- **高對比**：`prefers-contrast: more` 加深全部線條。
- **色彩以外的提示**：答對／答錯同時有文字（✓／✗）、左側色條與底色變化，不只靠顏色。
- **`hidden` 契約**：CSS 只保留一條 `[hidden]{display:none !important}`（規格 §5 以 `hidden` 切換狀態，這條是保證它永遠勝出）。全份 CSS 的 `!important` 只有 3 處：這條、`prefers-reduced-motion`、`@media print`。

---

## 7. 動效（160–240ms）

| 時機 | 效果 |
| --- | --- |
| 畫面進場 | `.screen` 淡入＋上移 6px（200ms） |
| 首頁載入 | hero 三件＋四張模組卡依序錯落上移（0/60/120/180ms） |
| 首頁 hover | 卡片上浮 2px、朱砂書口由 `scaleY(0)` 展開、箭頭右移 2px |
| 題目進場 | 四個選項 40ms 錯落 |
| 判分 | 答對：淡綠底＋極輕 1.012 縮放；答錯：輕微左右位移 3px（不做花俏動畫） |
| 換題／進度 | 進度條 `width` 240ms 補間 |
| Toast | 淡入＋上移 12px |
| 對話框 | 罩層淡入＋卡片 200ms 上移 |

---

## 8. 與 `docs/spec.md` 的偏差／建議

**已依契約實作、但需要實作端配合的假設：**

1. **Appbar 寬度**：`.appbar` 自己帶 `max-width` 與 `padding-inline`，因此放在 `#app` 直下（`.screen` 之外）最理想；若放在 `.screen` 內會再被內距縮一次。建議 spec 註明 appbar 與 `.screen` 為兄弟節點。
2. **詞解加點詞的 hook 未定義**：我已對多個可能的 class 兜底，但建議 spec 明確寫「以 `<em>` 包裹」或指定 `.dot`，避免實作端自由發揮。
3. **`#overlay` 內容無契約**：我的作法是「`#overlay` 的第一個非 script/style 子元素＝對話卡」，並提供 `.overlay-actions`／`.dialog-actions`（兩鍵並排）。建議把 `.overlay-card`、`.overlay-actions` 寫進 spec。
4. **`.browse-item` 展開**：契約只有 `browse-item-body hidden`，我另外支援 `aria-expanded="true"` 與 `.is-open`（控制左側朱砂條）。建議 spec 補上 `aria-expanded`（螢幕閱讀器需要）。
5. **`.qcard` 答後配色**：契約沒定義卡片本身的成敗態，我提供修飾 class `.is-ok`／`.is-bad`（左側 3px 色條）。**可選**，不加也不影響正確性；建議 spec 收錄，因為它對「一眼知道對錯」幫助很大。
6. **已答狀態的輸入框**：建議實作用 `readonly`（而非 `disabled`）呈現使用者答案；`disabled` 雖然我也做了對比補救，但 `readonly` 語意更準（內容仍可選取、可讀）。
7. **`data-font` 與 `--fs-scale` 並存**：兩種都支援，但建議以 `data-font` 為單一寫入點（`--fs-scale` 當內部變數），避免兩處互相覆蓋。
8. **`data-script` 只用於字形**：介面文案切換要由 JS 重繪（預覽頁用 `data-t`/`data-s` 示範）。建議 spec 註明「`data-script` 只作狀態旗標，文案由 JS 換」。
9. **`.wrong-table` 窄屏**：為避免橫向滾動，採固定欄寬（第 1 欄彈性、後 2 欄 58px）＋`overflow-wrap:anywhere`。若日後加「操作」欄，需要改成可橫向滑動的容器。

**我沒有改動、但發現的規格問題（供 orchestrator 參考）：**

10. spec §2／§9 寫 `data/source/*.csv`（現時專案已同時存在 `data/source/` 與舊 `source/`，需確認 `tools/build_dataset.py` 讀哪個）。
11. spec §5.5 的 `.quiz-actions` 在 390px 下放 4 個按鈕非常緊（實測需要 `下一題` 用 `flex:1` 撐開、其餘 `flex:0 1 auto` 才不擠）；若日後再加按鈕，建議改成「主要動作＋更多選單」。
12. `.stat` 被 hero／result／stats 三處重用，但三處容器不同（`.hero-stats`、`.result-stats`、`.stats-summary`）；我已讓三者視覺一致（細框＋分隔線），建議 spec 統一成同一容器 class 以減少實作分岐。
13. **⚠️ Service Worker 會讓樣式更新上不了線**：實測時發現 `sw.js` 以 cache-first 提供 `css/style.css`，改完設計後瀏覽器仍套用舊樣式（我一度看到 45736 字元的舊版本，實際檔案已是 46227 字元）。建議 `sw.js` 在每次發版時更換 cache 名稱並在 `activate` 清舊快取；開發時可先 `unregister()` 再測。這點對「設計定稿後才調 CSS」的流程影響很大。
14. `.answer-form` 在 `data-state="answered"` 時實作仍會渲染（顯示一個空的虛線輸入框）；我在 CSS 將它隱藏（答案已由 `.answer-box` 的「你寫的是」呈現），預覽頁同步如此。若實作打算在已答狀態保留輸入框顯示使用者的字，請改用 `readonly`，我會把這條 CSS 移除。

---

## 9. 交付清單

| 檔案 | 內容 |
| --- | --- |
| `css/style.css` | 設計系統＋全部元件樣式；16 個中文註解分區；零外部資源；`!important` 只用 3 處（`[hidden]`、`prefers-reduced-motion`、`@media print`） |
| `design/preview.html` | 18 個畫面／狀態靜態預覽；可切換淺色／深色、繁簡示範、4 級字號、390px 手機框；`pv-*` 樣式只服務預覽 |
| `design/brief.md` | 本文件 |

**實測驗證（Chromium；`design/preview.html` 與實作端 `index.html` 都跑過，靜態服務 `127.0.0.1`）：**

- 預覽頁 390×844 **字號調到最大（xl）**逐一量測 18 個畫面：`scrollWidth = 390`（無橫向滾動），無任何元素超出視窗左右邊界。
- 答題畫面滾到底：答案區與「意思對了，算我對」按鈕完整可見，未被黏底操作條遮擋；黏底條 `bottom` 與視窗底對齊。
- 深色模式抽查首頁／答題／統計／瀏覽／設定／對話框：文字皆可讀，對話框幾何置中（`top 276 / height 313`／視窗 844）。
- 1280×900 桌面：內容欄 720px 置中、模組卡 2 欄、界行顯示。
- **實作端 `index.html` 對接**：在真實渲染（`js/ui.js` 產生的 DOM）下逐項確認——`#app` 內 `.appbar` 與 `.screen` 為兄弟節點（符合 §8-1 假設）；詞解用 `<em class="dot">`（着重號如常顯示）；`overlay` 用 `.overlay-card`；`chip`／`seg` 同時有 `is-on` 與 `aria-pressed`；`verdict` 有 `is-ok`／`is-bad`；首頁／設定頁／答題（未答、答錯）／`toast` 皆正常，觸控區與輸入框聚焦光暈正常。
