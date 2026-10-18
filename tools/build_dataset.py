#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""由 source/*.csv 與 data/source/*.csv 產生 data/dataset.js 與 data/dataset.json（可重跑）。

用法
----
    python tools/build_dataset.py              # 產生資料檔（覆蓋 data/dataset.js / .json）
    python tools/build_dataset.py --check      # 只比對現有輸出是否與來源同步，不寫檔
    python tools/build_dataset.py --show 15    # 另印前 15 題摘要（--show all 全部）

資料來源
--------
- 掃描兩個目錄：專案根目錄 `source/`（放新教材）與 `data/source/`（內建資料）；
  同名檔以 `source/` 為準；非 CSV 檔（.docx/.pdf/.txt/圖片…）略過並列進報告。
- 已知 7 個檔名沿用固定 unit id／名稱／module（順序即 id 編號順序）。
- 未知檔名自動判斷：
    cijie | 詞解 | 词解 → cijie；mingju | 名句 → mingju；
    changshi | 常識 | 常识 | wenxue | 出處 | 出处 → changshi；
    皆無關鍵字時看表頭：有 example 欄 → cijie，否則 changshi（並在報告列 warning）。
- unit id：檔名 slug（ASCII 小寫，非字母數字轉 _）；純中文檔名用 u01、u02…遞增。
  unit 顯示名：檔名去掉副檔名與 _cijie/_mingju/_changshi 後綴。

欄位
----
- mingju  : word=句子（簡體）、chinese=出處。
- cijie   : word=詞、chinese=義、example=例句（繁體）。
- changshi: word=問、chinese=答（繁體）。

規則摘要
--------
1. 名句：s 保留 CSV 原文（簡體），t 用 OpenCC s2t 轉繁體；出處同理（src_t / src_s）。
2. 詞解：q_t 為例句並以【】標出該詞第一次出現；例句從缺或找不到該詞時改為
   「解釋「詞」」並在 note 說明。a_t 為義項（依「，；、：」切開，去掉括號補充與
   「音…」注音等註記）；k_t 為核心關鍵詞（義項再切出 >=2 漢字的片段，並保留原義項）。
3. 常識：accept = 答案去掉《》「」後的形式（繁簡各一）＋再去掉（…）補充的形式。
4. 所有繁體欄位以 OpenCC t2s 產生簡體欄位；t2s 表逐字轉換、只留有差異的字。
5. id 依「來源檔順序＋行號」編號（mj- / cj- / cs-），已知來源在前、新增來源按檔名排序，
   重跑穩定；重複條目會跳過。
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import re
import sys
from pathlib import Path

import opencc

# Windows 主控台預設可能是 GBK，強制用 UTF-8 輸出（中文訊息才不會爆掉）
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# ---------- 路徑 ----------
ROOT = Path(__file__).resolve().parents[1]
# 來源目錄（依序掃描，先找到的優先 → 專案根目錄 source/ 放新教材，會蓋過 data/source/ 的同名檔）
SOURCE_DIRS = [ROOT / "source", ROOT / "data" / "source"]
SOURCE_DIR = SOURCE_DIRS[1]          # 保留舊名（內建示範資料夾）
OUT_JS = ROOT / "data" / "dataset.js"
OUT_JSON = ROOT / "data" / "dataset.json"
OUT_REPORT = ROOT / "tools" / "build_report.json"


def resolve_source(filename: str):
    """（單檔查詢用）在多個來源目錄中找出檔案；同名時以較前面的目錄（source/）為準。

    回傳 (path, 相對路徑字串)；都找不到時回傳 (None, None)。
    """
    for d in SOURCE_DIRS:
        p = d / filename
        if p.exists():
            try:
                rel = p.relative_to(ROOT).as_posix()
            except ValueError:
                rel = str(p)
            return p, rel
    return None, None


T2S = opencc.OpenCC("t2s")
S2T = opencc.OpenCC("s2t")

META_TITLE = "中文溫習"

# ---------- 來源檔設定（順序 = unit 顯示順序 = id 編號順序） ----------
UNITS_CONFIG = [
    {"file": "mingju_shijing_chuci.csv", "id": "mingju", "name": "名句・詩經楚辭", "module": "mingju"},
    {"file": "guanju_cijie.csv", "id": "guanju", "name": "《關雎》", "module": "cijie"},
    {"file": "guoshang_cijie.csv", "id": "guoshang", "name": "《國殤》", "module": "cijie"},
    {"file": "jishi_cijie.csv", "id": "jishi", "name": "《季氏將伐顓臾》", "module": "cijie"},
    {"file": "liao_e_cijie.csv", "id": "liao_e", "name": "《蓼莪》", "module": "cijie"},
    {"file": "xianqin_wenxue.csv", "id": "xianqin", "name": "先秦文學常識", "module": "changshi"},
    {"file": "zhuzi_yuyan.csv", "id": "zhuzi", "name": "諸子寓言出處", "module": "changshi"},
]

ID_PREFIX = {"mingju": "mj", "cijie": "cj", "changshi": "cs"}
CJK_MIN, CJK_MAX = "\u4e00", "\u9fff"

# ---------- 未知來源檔的類型判斷 ----------
MODULE_HINTS = [
    (("cijie", "詞解", "词解"), "cijie"),
    (("mingju", "名句"), "mingju"),
    (("changshi", "常識", "常识", "wenxue", "出處", "出处"), "changshi"),
]
UNIT_SUFFIX_RE = re.compile(r"[_\-\s]*(cijie|mingju|changshi)$", re.I)
SLUG_KEEP_RE = re.compile(r"[^a-z0-9]+")
SLUG_ALNUM_RE = re.compile(r"[a-z]")
# 佔位／說明／系統檔：略過且不算「待人工處理」
PLACEHOLDER_HINTS = ("放教材", "readme", "說明", "说明", "note", "place",
                     "gitkeep", "desktop.ini", "thumbs.db", ".ds_store")
CSV_EXT = ".csv"

SPLIT_PUNCT = "，,；;：:？?！!"           # 名句切半用標點
CLAUSE_SEP_RE = re.compile("[，,；;、：:]")  # 義項切分
KEY_SEP_RE = re.compile("[，,；;、：:＝=／/～~·．.…而之與和及或]")  # 關鍵詞再切分
PHONETIC_RE = re.compile(r"音\s*[A-Za-zÀ-ÿĀ-ž]+")                 # 音qiú / 音shāng
PAREN_RE = re.compile(r"（[^（）]*）|\([^()]*\)")                    # 括號補充
TONGJIA_RE = re.compile(r"[同通](「[^」]*」|『[^』]*』)")              # 同「披」/ 通「埋」
LEAD_NOISE_RE = re.compile(r"^(?:一種|一類|一些|一個|某種|泛指|指|即|是|古代|古時)")
TAIL_NOISE_RE = re.compile(r"(?:的樣子|的人|之事|之貌)$")
GRAMMAR_META = ("作動詞", "用作動詞", "使動用法", "意動用法", "為動用法",
                "詞類活用", "活用", "通假", "古今異義", "音譯")


# ---------- 小型工具 ----------
def has_han(ch: str) -> bool:
    """是否為漢字（CJK 基本區）。"""
    return CJK_MIN <= ch <= CJK_MAX


def han_count(text: str) -> int:
    """漢字個數。"""
    return sum(1 for ch in text if has_han(ch))


def only_han(text: str) -> str:
    """只留漢字（判重、比對用）。"""
    return "".join(ch for ch in text if has_han(ch))


def t2s(text: str) -> str:
    return T2S.convert(text)


def s2t(text: str) -> str:
    return S2T.convert(text)


# OpenCC s2t 偶會選錯「一簡對多繁」的字（異體字或別字）。以下為明確修正表：
# (來源簡體字, OpenCC 輸出字) -> 應採用字。只做字形標準化／別字修正，不改動語意；
# 修正次數會列在建置報告（report["s2t_fixes"]）。
S2T_FIXES = {
    ("余", "餘"): "余",   # 亦余心之所善兮（第一人稱「余」，非「餘」）
    ("为", "爲"): "為",   # 統一用標準字形（OpenCC 有時輸出異體「爲」）
    ("众", "衆"): "眾",
    ("启", "啓"): "啟",
    ("峰", "峯"): "峰",
}

FIX_LOG = []  # [(來源字, OpenCC 字, 採用字)]，由 main 匯總進報告


def s2t_fixed(raw: str):
    """s2t 轉換並套用修正表；來源與轉換結果長度不同時不做逐字修正。"""
    conv = S2T.convert(raw)
    if len(conv) != len(raw):
        return conv
    out = []
    for a, b in zip(raw, conv):
        fix = S2T_FIXES.get((a, b))
        if fix and fix != b:
            FIX_LOG.append((a, b, fix))
            out.append(fix)
        else:
            out.append(b)
    return "".join(out)


def dedupe(seq):
    """保序去重。"""
    out = []
    for x in seq:
        if x not in out:
            out.append(x)
    return out


def norm_key(text: str) -> str:
    """正規化：t2s 後只留漢字。"""
    return only_han(t2s(text))


def clean_annotations(text: str) -> str:
    """去掉括號補充、「同／通「X」」標記與「音…」注音等註記。"""
    s = PAREN_RE.sub("", text)
    s = TONGJIA_RE.sub(lambda m: m.group(1)[1:-1], s)
    s = PHONETIC_RE.sub("", s)
    s = s.strip(" \t，,；;、：:·．.「」『』")
    return s.strip()


def is_grammar_meta(text: str) -> bool:
    """是否為語法／詞類活用之類的說明詞（不算義項關鍵詞）。"""
    return any(k in text for k in GRAMMAR_META)


# ---------- 詞解：義項與關鍵詞 ----------
def build_senses(answer: str) -> list:
    """把答案切成義項陣列。

    先整條去掉括號補充、「音…」注音與「同／通「X」」標記，再依「，；、：」切開；
    純注音的片段（音qiú）會丟棄；若全部被清掉則退回原答案。
    """
    raw = answer.strip()
    if not raw:
        return []
    body = clean_annotations(raw)
    senses = []
    for frag in CLAUSE_SEP_RE.split(body):
        frag = clean_annotations(frag).strip()
        if not frag or han_count(frag) == 0:
            continue
        senses.append(frag)
    if not senses:
        senses = [raw]  # 例：答案只有「音qú」，退回原文
    return dedupe(senses)


def piece_variants(piece: str) -> list:
    """片段的變體：先給去掉量詞／指代與尾巴的短版，再給原片段。"""
    out = []
    cur = LEAD_NOISE_RE.sub("", piece)
    if cur != piece and cur:
        out.append(cur)
    cur2 = TAIL_NOISE_RE.sub("", cur)
    if cur2 != cur and cur2:
        out.append(cur2)
    out.append(piece)
    return out


def build_keywords(senses: list) -> list:
    """由義項產生核心關鍵詞（>=2 漢字，排除語法說明）。"""
    keys = []
    for sense in senses:
        for piece in KEY_SEP_RE.split(sense):
            piece = piece.strip()
            if not piece or han_count(piece) == 0:
                continue
            for variant in piece_variants(piece):
                if han_count(variant) >= 2 and not is_grammar_meta(variant):
                    keys.append(variant)
    keys = dedupe(keys)
    if not keys:
        # 沒有任何 >=2 漢字的片段：至少保留（清理後的）完整答案
        fallback = clean_annotations(senses[0]) if senses else ""
        keys = [fallback or (senses[0] if senses else "")]
    return [k for k in keys if k]


def mark_first(text: str, word: str):
    """在 text 中把 word 第一次出現標成【word】；找不到回傳 None。"""
    if not word or not text:
        return None
    i = text.find(word)
    if i < 0:
        return None
    return text[:i] + "【" + text[i:i + len(word)] + "】" + text[i + len(word):]


# ---------- 常識：accept ----------
def build_accept(a_t: str) -> list:
    """答案去掉《》「」等形式（繁簡各一）＋去掉（…）補充的形式。"""
    marks = "《》「」『』〈〉"
    base = "".join(ch for ch in a_t if ch not in marks).strip()
    variants = [base]
    stripped = PAREN_RE.sub("", base).strip()
    if stripped and stripped not in variants:
        variants.append(stripped)
    out = []
    for v in variants:
        for form in (v, t2s(v)):
            if form and form not in out:
                out.append(form)
    return out


# ---------- 讀 CSV ----------
def read_header(path: Path):
    """回傳表頭（小寫、去空白）；讀不到回傳 []。"""
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as fh:
            reader = csv.reader(fh)
            for row in reader:
                return [c.strip().lower() for c in row]
    except Exception:
        return []
    return []


def read_rows(path: Path):
    """回傳 [(行號, {'word':…, 'chinese':…, 'example':…})]；行號從 1 起算（含表頭）。"""
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh)
        rows = list(reader)
    if not rows:
        return []
    header = [c.strip().lower() for c in rows[0]]
    out = []
    for idx, row in enumerate(rows[1:], start=2):
        if not any(c.strip() for c in row):
            continue
        rec = {}
        for i, name in enumerate(header):
            rec[name] = row[i].strip() if i < len(row) else ""
        out.append((idx, rec))
    return out


# ---------- 來源探索：source/ 與 data/source/ ----------
def rel_path(path: Path) -> str:
    """專案相對路徑（一律用 /）。"""
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def is_placeholder(name: str) -> bool:
    low = name.lower()
    return any(h.lower() in low for h in PLACEHOLDER_HINTS)


def guess_module(filename: str, path: Path):
    """由檔名關鍵字判斷類型；判斷不到時看表頭。回傳 (module, 依據, 是否為 fallback)。"""
    low = filename.lower()
    for keys, mod in MODULE_HINTS:
        for k in keys:
            if k in low:
                return mod, "檔名含「%s」" % k, False
    header = read_header(path)
    if "example" in header:
        return "cijie", "表頭有 example 欄", True
    return "changshi", "表頭無 example 欄（預設常識）", True


def unit_stem(filename: str) -> str:
    """檔名去掉副檔名與 _cijie/_mingju/_changshi 後綴。"""
    stem = Path(filename).stem
    return UNIT_SUFFIX_RE.sub("", stem).strip(" _-") or stem


def unit_display_name(filename: str) -> str:
    """unit 顯示名（沿用檔名本身，中文可讀）。"""
    return unit_stem(filename)


def unit_id_from_filename(filename: str, used: set, counter: list):
    """檔名 slug（ASCII 小寫、非字母數字轉 _）；純中文檔名用 u01、u02…遞增。

    與已知來源一致：先去掉 _cijie/_mingju/_changshi 後綴再做 slug
    （例：guanju_cijie.csv → guanju、tangshi_cijie.csv → tangshi）。
    """
    slug = SLUG_KEEP_RE.sub("_", unit_stem(filename).lower()).strip("_")
    if not SLUG_ALNUM_RE.search(slug):          # 沒有 ASCII 字母 → 用 u01 遞增
        slug = ""
    base = slug or "u%02d" % (counter[0] + 1)
    if not slug:
        counter[0] += 1
    cand, n = base, 1
    while cand in used:
        n += 1
        cand = "%s_%d" % (base, n)
    used.add(cand)
    return cand


def discover_sources():
    """掃描 source/ 與 data/source/。

    回傳 (entries, manual_todo, ignored_files, shadowed)：
      entries      已知來源（UNITS_CONFIG 順序）在前、新來源按檔名排序
      manual_todo  非 CSV 的教材檔（待人工處理）
      ignored_files 佔位／說明／系統檔（略過）
      shadowed     同名檔被忽略的記錄（以 source/ 為準）
    """
    found = {}          # filename(lower) -> {file, path, rel}
    seen_other = {}     # 非 CSV 檔名(lower) -> 記錄，避免兩個目錄重複列
    manual_todo, ignored_files, shadowed = [], [], []

    for base in SOURCE_DIRS:
        if not base.is_dir():
            continue
        for p in sorted(base.iterdir(), key=lambda x: x.name.lower()):
            if p.is_dir():
                continue
            name = p.name
            key = name.lower()
            if p.suffix.lower() != CSV_EXT:
                if key in seen_other:
                    continue
                rec = {"file": name, "source": rel_path(p),
                       "ext": p.suffix.lower() or "(無)",
                       "placeholder": is_placeholder(name)}
                seen_other[key] = rec
                (ignored_files if rec["placeholder"] else manual_todo).append(rec)
                continue
            if key in found:
                shadowed.append({"file": name, "ignored": rel_path(p),
                                 "used": found[key]["rel"]})
                continue
            found[key] = {"file": name, "path": p, "rel": rel_path(p)}

    entries = []
    used_ids = set()
    for cfg in UNITS_CONFIG:                       # 1) 已知來源，固定順序與 id
        e = found.pop(cfg["file"].lower(), None)
        if e is None:
            continue
        used_ids.add(cfg["id"])
        entries.append({**e, "id": cfg["id"], "name": cfg["name"],
                        "module": cfg["module"], "known": True,
                        "detected_by": "已知來源"})

    counter = [0]
    for e in sorted(found.values(), key=lambda x: x["file"].lower()):  # 2) 新來源，檔名排序
        module, how, fallback = guess_module(e["file"], e["path"])
        e["module"] = module
        e["id"] = unit_id_from_filename(e["file"], used_ids, counter)
        e["name"] = unit_display_name(e["file"])
        e["known"] = False
        e["detected_by"] = how
        e["fallback"] = fallback
        entries.append(e)

    return entries, manual_todo, ignored_files, shadowed


# ---------- 條目建構 ----------
def build_mingju(rec: dict, unit: str):
    raw = rec.get("word", "").strip()
    src = rec.get("chinese", "").strip()
    if not raw:
        return None, "word（句子）為空"
    t = s2t_fixed(raw)
    note = ""
    if not any(ch in SPLIT_PUNCT for ch in raw):
        note = "原句無句讀標點，無法切半（仍保留）"
    if not src:
        note = (note + "；" if note else "") + "出處從缺"
    return {
        "type": "mingju", "unit": unit,
        "t": t, "s": raw,
        "src_t": s2t_fixed(src), "src_s": src,
        "note": note,
    }, None


def build_cijie(rec: dict, unit: str):
    word = rec.get("word", "").strip()
    answer = rec.get("chinese", "").strip()
    example = rec.get("example", "").strip()
    if not word:
        return None, "word（詞）為空"
    if not answer:
        return None, "chinese（義）為空"

    notes = []
    marked = mark_first(example, word)
    if not example:
        q_t = "解釋「%s」" % word
        notes.append("例句從缺，題面改為「解釋「詞」」")
    elif marked is None:
        q_t = "解釋「%s」" % word
        notes.append("例句未出現該詞，題面改為「解釋「詞」」")
    else:
        q_t = marked

    senses = build_senses(answer)
    keys = build_keywords(senses)
    if senses and senses[0] == answer.strip() and clean_annotations(answer) == "":
        notes.append("來源僅提供注音，未提供義項")

    return {
        "type": "cijie", "unit": unit,
        "q_t": q_t, "q_s": t2s(q_t),
        "w_t": word, "w_s": t2s(word),
        "a_t": senses, "a_s": [t2s(x) for x in senses],
        "k_t": keys, "k_s": [t2s(x) for x in keys],
        "note": "；".join(notes),
    }, None


def build_changshi(rec: dict, unit: str):
    q = rec.get("word", "").strip()
    a = rec.get("chinese", "").strip()
    if not q:
        return None, "word（問）為空"
    if not a:
        return None, "chinese（答）為空"
    return {
        "type": "changshi", "unit": unit,
        "q_t": q, "q_s": t2s(q),
        "a_t": a, "a_s": t2s(a),
        "accept": build_accept(a),
        "note": "",
    }, None


BUILDERS = {"mingju": build_mingju, "cijie": build_cijie, "changshi": build_changshi}


def dedupe_key(item: dict):
    if item["type"] == "mingju":
        return (item["unit"], "mingju", norm_key(item["t"]), norm_key(item["src_t"]))
    if item["type"] == "cijie":
        return (item["unit"], "cijie", norm_key(item["w_t"]), norm_key("".join(item["a_t"])))
    return (item["unit"], "changshi", norm_key(item["q_t"]), norm_key(item["a_t"]))


# ---------- 主流程 ----------
def build_dataset(now: str = None):
    units = []
    drafts = []
    skips = []
    unit_stats = []
    warnings = []

    entries, manual_todo, ignored_files, shadowed = discover_sources()
    present = {e["file"].lower() for e in entries}

    # 已知來源檔缺席（兩個目錄都找不到）
    for cfg in UNITS_CONFIG:
        if cfg["file"].lower() not in present:
            skips.append({"file": cfg["file"], "line": 0, "type": cfg["module"],
                          "reason": "來源檔不存在（已找過 %s）"
                                    % "、".join(rel_path(d) for d in SOURCE_DIRS)})

    for e in entries:
        path = e["path"]
        unit = e["id"]
        module = e["module"]
        if e.get("fallback"):
            warnings.append("來源 %s 檔名判斷不出類型，依表頭判為 %s（%s）"
                            % (e["file"], module, e["detected_by"]))

        rows = read_rows(path)
        builder = BUILDERS[module]
        seen = {}
        count = 0
        skipped = 0
        for line_no, rec in rows:
            item, reason = builder(rec, unit)
            if item is None:
                skipped += 1
                skips.append({"file": e["file"], "line": line_no, "source": e["rel"],
                              "type": module, "reason": reason,
                              "raw": [rec.get("word", ""), rec.get("chinese", "")]})
                continue
            item["type"] = module
            item["module"] = module
            key = dedupe_key(item)
            if key in seen:
                skipped += 1
                skips.append({"file": e["file"], "line": line_no, "source": e["rel"],
                              "type": module,
                              "reason": "重複條目（與 %s:%d 相同）" % (e["file"], seen[key]),
                              "raw": [rec.get("word", ""), rec.get("chinese", "")]})
                continue
            seen[key] = line_no
            count += 1
            drafts.append(item)

        unit_stats.append({"file": e["file"], "source": e["rel"], "unit": unit,
                           "name": e["name"], "module": module, "known": e["known"],
                           "detected_by": e["detected_by"],
                           "count": count, "skipped": skipped})
        if count:
            units.append({"id": unit, "name": e["name"], "module": module})
        elif not e["known"]:
            warnings.append("來源 %s 沒有任何可用題目（已略過該 unit）" % e["file"])

    # 未被任何 unit 使用的模組不列入
    module_counts = {}
    for item in drafts:
        module_counts[item["type"]] = module_counts.get(item["type"], 0) + 1

    # 穩定 id：同 type 依出現順序編號
    counters = {"mingju": 0, "cijie": 0, "changshi": 0}
    items = []
    for d in drafts:
        t = d["type"]
        counters[t] = counters.get(t, 0) + 1
        item = {"id": "%s-%03d" % (ID_PREFIX[t], counters[t]), "type": t, "unit": d["unit"]}
        item["module"] = d["module"]
        for k, v in d.items():
            if k in ("type", "module", "unit"):
                continue
            item[k] = v
        items.append(item)

    # t2s 對照表：收集所有繁體欄位的字，逐字轉換、只留有差異者
    t_fields = []
    for it in items:
        for k, v in it.items():
            if k.endswith("_t"):
                t_fields.extend(v if isinstance(v, list) else [v])
        if it["type"] == "mingju":
            t_fields.append(it["t"])
    t_fields.extend(u["name"] for u in units)

    chars = set()
    for text in t_fields:
        chars.update(ch for ch in text if has_han(ch))
    t2s_table = {}
    for ch in sorted(chars):
        conv = T2S.convert(ch)
        if conv and conv != ch:
            t2s_table[ch] = conv

    # 繁體欄位中「可能」殘留的簡體字：只看詞解／常識這些本來就是繁體的來源欄位
    # （名句 t 是 s2t 產生的，不列入，否則會誤報「余／峰」等修正後的字）。
    # 注意：OpenCC s2t 對繁簡同形字（干、采、岳…）也會給出不同字形，故僅供提醒。
    src_t_chars = set()
    for it in items:
        if it["type"] in ("cijie", "changshi"):
            for k in ("q_t", "w_t", "a_t", "k_t"):
                v = it.get(k)
                if v is None:
                    continue
                for text in (v if isinstance(v, list) else [v]):
                    src_t_chars.update(ch for ch in text if has_han(ch))
    stray = sorted(ch for ch in src_t_chars
                   if S2T.convert(ch) != ch and T2S.convert(ch) == ch)

    dataset = {
        "meta": {"title": META_TITLE, "version": now[:10], "generated_at": now},
        "units": units,
        "items": items,
        "t2s": t2s_table,
    }

    report = {
        "generated_at": now,
        "source_dirs": [rel_path(d) for d in SOURCE_DIRS],
        "source_dir": "source（優先）＋ data/source",
        "units": unit_stats,
        "module_counts": module_counts,
        "total": len(items),
        "skips": skips,
        "warnings": warnings,
        "manual_todo": manual_todo,
        "ignored_files": ignored_files,
        "shadowed": shadowed,
        "notes": [{"id": it["id"], "unit": it["unit"], "note": it["note"]}
                  for it in items if it.get("note")],
        "fallback_q": [{"id": it["id"], "unit": it["unit"], "w_t": it["w_t"], "q_t": it["q_t"]}
                       for it in items if it["type"] == "cijie" and "解釋「" in it["q_t"]],
        "t2s_count": len(t2s_table),
        "s2t_fixes": [{"from": a, "opencc": b, "used": c, "count": n}
                      for (a, b, c), n in sorted(_count_fixes().items())],
        "stray_simplified_chars": stray,
    }
    return dataset, report


def _count_fixes():
    import collections
    return collections.Counter(FIX_LOG)


def dump_js(dataset: dict) -> str:
    head = "/* 由 tools/build_dataset.py 自動產生，請勿手改。 */\n"
    body = json.dumps(dataset, ensure_ascii=False, indent=2)
    return head + "window.CN_DATASET = " + body + ";\n"


def dump_json(dataset: dict) -> str:
    return json.dumps(dataset, ensure_ascii=False, indent=2) + "\n"


def print_report(dataset: dict, report: dict, show: str = None):
    print("來源目錄：" + "（優先，新教材）＋ ".join("%s/" % d for d in report["source_dirs"])
          + "（內建示範）→ 共 %d 個 CSV 來源" % len(report["units"]))
    print("單位題數：")
    row_fmt = "  %-9s %-14s %3d 題（skip %d，%s%s）"
    for st in report["units"]:
        print(row_fmt % (st["module"], unit_name(dataset, st["unit"]), st["count"], st["skipped"],
                         st.get("source") or st["file"],
                         "" if st.get("known", True) else "，自動判斷：" + st["detected_by"]))
    print("模組題數：" + " / ".join("%s %d" % (m, c) for m, c in report["module_counts"].items())
          + "，合計 %d" % report["total"])
    if report["skips"]:
        print("跳過 %d 筆：" % len(report["skips"]))
        for s in report["skips"]:
            print("  %s:%s %s" % (s["file"], s["line"], s["reason"]))
    else:
        print("跳過 0 筆")
    if report["fallback_q"]:
        print("詞解題面 fallback %d 筆：" % len(report["fallback_q"]))
        for f in report["fallback_q"]:
            print("  %s %s（%s）→ %s" % (f["id"], f["unit"], f["w_t"], f["q_t"]))
    if report["notes"]:
        print("其他 note %d 筆：" % len(report["notes"]))
        for n in report["notes"]:
            print("  %s %s：%s" % (n["id"], n["unit"], n["note"]))
    print("t2s 對照表：%d 字" % report["t2s_count"])
    if report.get("warnings"):
        print("來源提醒 %d 筆：" % len(report["warnings"]))
        for w in report["warnings"]:
            print("  ! %s" % w)
    if report.get("shadowed"):
        print("同名檔 %d 筆（以 source/ 為準）：" % len(report["shadowed"]))
        for s in report["shadowed"]:
            print("  %s：忽略 %s，使用 %s" % (s["file"], s["ignored"], s["used"]))
    if report.get("manual_todo"):
        print("待人工處理（非 CSV，請自行轉成 CSV）%d 筆：" % len(report["manual_todo"]))
        for f in report["manual_todo"]:
            print("  %s（%s）" % (f["source"], f["ext"]))
    if report.get("ignored_files"):
        print("已略過的非 CSV 檔 %d 筆（佔位／說明／系統檔）：%s"
              % (len(report["ignored_files"]),
                 "、".join(f["source"] for f in report["ignored_files"])))
    if report.get("s2t_fixes"):
        print("s2t 修正 %d 處（OpenCC 誤選異體／別字）："
              % sum(f["count"] for f in report["s2t_fixes"]))
        for f in report["s2t_fixes"]:
            print("  %s（OpenCC 給 %s）→ %s ×%d" % (f["from"], f["opencc"], f["used"], f["count"]))
    if report["stray_simplified_chars"]:
        print("提醒：繁體欄位可能殘留簡體字（s2t 可還原；繁簡同形字也會列出，來源未改）：%s"
              % "".join(report["stray_simplified_chars"]))

    if show:
        items = dataset["items"]
        limit = len(items) if show == "all" else max(0, int(show))
        for it in items[:limit]:
            if it["type"] == "mingju":
                print("  %s [%s] t=%s | src=%s%s"
                      % (it["id"], it["unit"], it["t"], it["src_t"],
                         (" | note=" + it["note"]) if it["note"] else ""))
            elif it["type"] == "cijie":
                print("  %s [%s] q=%s | a=%s | k=%s%s"
                      % (it["id"], it["unit"], it["q_t"], "／".join(it["a_t"]),
                         ",".join(it["k_t"]),
                         (" | note=" + it["note"]) if it["note"] else ""))
            else:
                print("  %s [%s] q=%s | a=%s | accept=%s"
                      % (it["id"], it["unit"], it["q_t"], it["a_t"],
                         ",".join(it["accept"])))


def unit_name(dataset: dict, unit: str) -> str:
    for u in dataset["units"]:
        if u["id"] == unit:
            return u["name"]
    return unit


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="建立 data/dataset.js 與 data/dataset.json")
    ap.add_argument("--check", action="store_true", help="只比對現有輸出是否同步，不寫檔")
    ap.add_argument("--show", nargs="?", const="all", default=None,
                    help="另印題目摘要（數字＝前 N 題，all＝全部）")
    args = ap.parse_args(argv)

    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).replace(microsecond=0).isoformat()

    if args.check:
        if OUT_JSON.exists():
            try:
                old = json.loads(OUT_JSON.read_text(encoding="utf-8"))
                now = old.get("meta", {}).get("generated_at", now)
            except Exception:
                pass

    dataset, report = build_dataset(now)

    if args.check:
        old_js = OUT_JS.read_text(encoding="utf-8") if OUT_JS.exists() else ""
        old_json = OUT_JSON.read_text(encoding="utf-8") if OUT_JSON.exists() else ""
        same = (old_js == dump_js(dataset)) and (old_json == dump_json(dataset))
        print_report(dataset, report, args.show)
        if same:
            print("--check：資料檔與來源同步（%s，%d 題）"
                  % ("＋".join(report["source_dirs"]), report["total"]))
            return 0
        print("--check：資料檔與來源（%s）不一致，請執行 python tools/build_dataset.py 重新產生"
              % "＋".join(report["source_dirs"]))
        return 1

    OUT_JSON.write_text(dump_json(dataset), encoding="utf-8", newline="\n")
    OUT_JS.write_text(dump_js(dataset), encoding="utf-8", newline="\n")
    OUT_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                          encoding="utf-8", newline="\n")

    print_report(dataset, report, args.show)
    print("已輸出：data/dataset.js、data/dataset.json、tools/build_report.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
