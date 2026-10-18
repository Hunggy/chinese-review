# 中文溫習（離線・零依賴）

一個給自己溫習中文的純靜態網站：**名句默寫、詞解、常識**三大模組，可離線使用、可「加到主畫面」。
沒有後端、沒有網路請求、沒有追蹤——所有進度只存在你手機／電腦的瀏覽器裡。

- 零依賴：不需要 npm、不需要建置步驟，開檔即用
- 離線可用：Service Worker 快取全部資源
- 繁簡皆可作答：題目與介面可切換繁體／簡體，答案兩種字形都接受
- 手機優先：單手可操作，深色模式、四段字號

---

## 1. 快速開始

### 直接開（最快）

用瀏覽器打開 `index.html` 即可（`file://` 也能跑；此模式下不會註冊 Service Worker，故無離線快取）。

### 本機伺服器（想測 PWA／離線就用這個）

```bash
# 在專案根目錄
python -m http.server 8137
# 然後開 http://127.0.0.1:8137/index.html
```

> Service Worker 只在 `http://` / `https://` 下註冊；`127.0.0.1` 也算安全來源。

### GitHub Pages

1. 把整個資料夾推上 GitHub。
2. `Settings → Pages → Source: Deploy from a branch → main / (root)`。
3. 等一兩分鐘，開 `https://<帳號>.github.io/<專案名>/`。
   所有路徑都是相對路徑，放在子目錄也能正常運作。

### 加到主畫面（離線使用）

- **iPhone / iPad（Safari）**：分享 → 「加入主畫面」。
- **Android（Chrome）**：右上選單 → 「安裝應用程式／加到主畫面」。

---

## 2. 怎麼用

### 三個模組（主頁卡片）

| 模組 | 內容 |
| --- | --- |
| 名句默寫 | 名句補全（可選「給上句填下句」或「給下句填上句」） |
| 詞解 | 依例句解釋加點詞，答中關鍵詞即算對 |
| 常識 | 先秦文學常識、諸子寓言出處 |

### 四種模式（設定頁／開始頁可切換）

| 模式 | 說明 |
| --- | --- |
| 練習 | 逐題作答（手打或四選一）；答錯會稍後再出現 |
| 速通 | 全題快問快答，答完自動跳下一題；不重複出題，適合考前跑一遍 |
| 翻卡 | 先看題面自評「還沒記住／記住了」，適合快速掃描 |

「作答方式」可選 **手打** 或 **選擇題**（四選一，可用鍵盤 `1`～`4`）。

### 佇列規則（為什麼會再遇到同一題）

- 答錯：依本輪錯誤次數，把題目插回第 **5 / 10 / 20** 題之後。
- 答對：答對第一次時，把題目插到第 **15** 題之後做一次鞏固（只做一次）。
- 進度條只增不減，題數（例如 `3 / 50`）會隨插題變大，不會嚇到你。
- 練習中可隨時「☆ 標記」難題，之後在「錯題統計」裡複習。

### 答題小技巧

- 只寫關鍵字或整句都可以；標點、空白、句末標點不影響判分。
- 繁簡混寫也可以（例：`为什么` 與 `為什麼` 都算對）。
- 詞解只要包含核心關鍵詞就算對（例如答「和鳴聲」即可）。
- 判錯了？按「算我對」可手動覆寫，成績不會被冤判。
- 不會寫就按「看答案」，題目會稍後再出現。

### 錯題統計

主頁 → 「錯題統計」：列出每題答錯／答對次數與平均錯誤排名，可「只練這些錯題」或「清空錯題」。

### 進度保存／匯出

- 進度自動存在瀏覽器 `localStorage`（鍵名 `cn_review_v1`），換裝置前先按「匯出進度」下載 JSON。
- 「匯入進度」可還原檔案；「重設」會清空所有紀錄（會先問你一次）。

### 鍵盤快捷鍵（電腦）

| 按鍵 | 作用 |
| --- | --- |
| `Enter` | 提交答案／下一題／翻卡後標記「記住了」 |
| `空格` | 翻卡模式下翻面 |
| `1`～`4` | 選擇題選項 |
| `←` | 回顧上一題（不改變成績） |
| `→` 或 `Enter` | 回顧時返回目前題目 |
| `Esc` | 回首頁（練習中會先確認） |
| `a` | 標記／取消標記本題為難題 |

---

## 3. 加教材（換題庫）

題庫是由 CSV 產生的，程式不直接讀 CSV，所以改完要跑一次產生器。

### 教材放哪裡

```
source/            ← 新教材放這裡（優先，同名檔會蓋過 data/source/）
data/source/       ← 內建示範資料（可保留原樣，不用動）
```

`tools/build_dataset.py` 會**依序掃描這兩個目錄**，同名檔以根目錄 `source/` 為準。

### CSV 格式

UTF-8、表頭 `word,chinese,example`：

| 檔案 | word | chinese | example |
| --- | --- | --- | --- |
| 名句（如 `mingju_shijing_chuci.csv`） | 句子（可用簡體） | 出處 | — |
| 詞解（如 `guanju_cijie.csv`） | 要解釋的詞 | 詞義 | 課文例句 |
| 常識（如 `xianqin_wenxue.csv`） | 問題 | 答案 | — |

- 名句句子請帶句讀標點（`，` 之類），程式才能自動切上下半句。
- 詞解的 `example` 請包含 `word` 那個詞，程式會用【】標出加點詞；找不到時會自動改成「解釋『某詞』」。

### 三步驟

```bash
# 1) 產生 data/dataset.js 與 data/dataset.json
python tools/build_dataset.py            # 加 --show 15 可順便印前 15 題檢查
                                         # 加 --check 只比對是否同步，不寫檔

# 2) 校驗資料（0 error 才算過）
python tools/validate_data.py            # 加 --strict 連警告都算失敗

# 3) 跑邏輯回歸測試（需要 node）
node tools/test_core.mjs
```

若你在 `source/` 放了全新的 CSV，程式會**自動判斷模組**（檔名含 `mingju`／`名句` → 名句；`cijie`／`詞解` → 詞解；`changshi`／`常識`／`出處`／`wenxue` → 常識），並自動產生 unit。想指定顯示名稱、穩定 id 或模組，才需要在 `tools/build_dataset.py` 的 `UNITS_CONFIG` 補一行（`file` / `id` / `name` / `module`）。

---

## 4. 版本與快取（發版必看）

`sw.js` 的策略：

- **導覽請求（HTML）**：network-first——先上網拿最新頁面，離線才回快取。
- **其他靜態資源（css/js/data/圖示）**：stale-while-revalidate——先回快取、背景順手更新，所以**改檔後重新開兩次**才會看到最新版。
- `activate` 會清掉所有非當前版本的快取。

> **每次發版請修改 `sw.js` 裡的 `VERSION`**（例如 `cn-review-2026-10-18.1` → `cn-review-2026-10-19.1`），
> 否則使用者可能繼續吃到舊快取。頁面用 `navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })` 註冊，
> 每次載入都會繞過 HTTP 快取檢查 `sw.js` 是否更新。

---

## 5. 隱私

- 沒有伺服器、沒有帳號、沒有任何網路請求（字型與圖示都在本機）。
- 作答紀錄、設定只存在 `localStorage`，只有你自己看得到，清除瀏覽器資料即消失。
- 匯出檔（`cn-review-YYYY-MM-DD.json`）完全由你的瀏覽器產生，不會上傳。

---

## 6. 專案結構

```
index.html                 單頁外殼（所有畫面由 js/ui.js 產生）
manifest.webmanifest       PWA 設定（加到主畫面用）
sw.js                      Service Worker（離線快取；發版要改 VERSION）
css/style.css              樣式
js/core.js                 純邏輯：資料、正規化、判分、出題佇列、儲存、搜尋（window.CNCore）
js/ui.js                   畫面與事件（畫面均由 JS 產生，未用任何框架）
js/main.js                 啟動與註冊 Service Worker
data/dataset.js            題庫（由 build_dataset.py 產生，勿手改）
data/dataset.json          同上（給工具／驗證用）
data/source/*.csv          內建示範教材
source/                    放新教材的目錄（優先）
icons/icon-192.png         主畫面圖示
icons/icon-512.png         主畫面圖示
tools/build_dataset.py     CSV → dataset.js / dataset.json
tools/validate_data.py     資料校驗
tools/test_core.mjs        邏輯回歸測試（node tools/test_core.mjs）
design/                    設計稿（參考用，不影響執行）
docs/spec.md               規格書
```

---

## 7. 測試

```bash
node tools/test_core.mjs          # 189 項斷言：判分、佇列、儲存、搜尋、全量回歸
node --check js/core.js           # 語法檢查（ui.js / main.js / sw.js 同理）
python tools/validate_data.py     # 資料結構與繁簡對照校驗
```

其中「全量回歸」會拿真實題庫（167 題）逐題驗證：**標準答案照抄必對、簡體答案必對、繁簡混寫必對**，
並確認無關答案不會被誤判為對。

## 8. 已知限制

- 名句原文若沒有句讀標點，就無法自動切上下半句，該題仍會保留但不出現在默寫佇列。
- 判分是關鍵詞／正規化比對，不是語意理解：換句話說得對但用詞差太遠仍會判錯（可用「算我對」覆寫）。
- 詞解答題只認題庫中的義項關鍵詞；太口語的說明可能被判錯。
- 進度存在瀏覽器；換裝置或清資料前請先匯出。
- `file://` 模式無法使用離線快取與「加到主畫面」。
