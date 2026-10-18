#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""校驗 data/dataset.js / data/dataset.json（由 tools/build_dataset.py 從 source/ 與 data/source/ 產生）。

用法
----
    python tools/validate_data.py            # 校驗，0 error 才算通過
    python tools/validate_data.py --strict   # 警告也算失敗（exit 1）

檢查項目
--------
1. meta / units / items / t2s 結構與必填欄位。
2. id 唯一、格式正確（mj- / cj- / cs- 三位數）且前綴與 type 一致。
3. unit 存在、module 合法。
4. 括號配對（【】《》「」（）〔〕『』）、詞解的【】恰好一組且內容等於 w_t。
5. 名句可切半（含句讀標點）。
6. t2s 覆蓋率：繁體欄位中每個可轉換的字都要在表中且值正確；表中不得有冗餘字。
7. 繁簡欄位長度一致（t/s、src_t/src_s、q、w、a[*]、k[*]）。
8. 同 unit 內正規化後重複條目。
9. 常識 accept 至少包含 a_t 去書名號後的形式。
10. dataset.js 內容與 dataset.json 一致。
11. 每題都有 seg / exam，且為 >=1 的整數。
12. 名句有 author_t / author_s（不可為空；佚名也算有），且 src 不含作者樣式
    （如 `屈原《離騷》`、開頭符合 `^[^《]+《` 一律 warning）。
13. 另印出來源統計（tools/build_report.json）：每 unit 題數、skip 原因、待人工處理的非 CSV 檔。
"""

from __future__ import annotations

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

ROOT = Path(__file__).resolve().parents[1]
OUT_JS = ROOT / "data" / "dataset.js"
OUT_JSON = ROOT / "data" / "dataset.json"
REPORT = ROOT / "tools" / "build_report.json"

T2S = opencc.OpenCC("t2s")
CJK_MIN, CJK_MAX = "\u4e00", "\u9fff"
SPLIT_PUNCT = "，,；;：:？?！!"
PAIRS = [("【", "】"), ("《", "》"), ("「", "」"), ("『", "』"), ("（", "）"),
         ("(", ")"), ("〔", "〕")]
VALID_MODULES = ("mingju", "cijie", "changshi")
ID_RE = re.compile(r"^(mj|cj|cs)-(\d{3})$")
PREFIX_OF = {"mingju": "mj", "cijie": "cj", "changshi": "cs"}
AUTHOR_IN_SRC_RE = re.compile(r"^[^《]+《")   # 出處欄開頭疑似含作者

errors = []
warnings = []


def err(msg: str):
    errors.append(msg)


def warn(msg: str):
    warnings.append(msg)


def has_han(ch: str) -> bool:
    return CJK_MIN <= ch <= CJK_MAX


def only_han(text: str) -> str:
    return "".join(ch for ch in text if has_han(ch))


def check_brackets(label: str, text: str):
    """括號配對（數量相等且順序正確）。"""
    for open_ch, close_ch in PAIRS:
        n_open = text.count(open_ch)
        n_close = text.count(close_ch)
        if n_open != n_close:
            err("%s 括號不配對：%s / %s（%s）" % (label, open_ch, close_ch, text))
        elif n_open:
            depth = 0
            bad = False
            for ch in text:
                if ch == open_ch:
                    depth += 1
                elif ch == close_ch:
                    depth -= 1
                    if depth < 0:
                        bad = True
                        break
            if bad or depth != 0:
                err("%s 括號順序錯誤（%s%s）：%s" % (label, open_ch, close_ch, text))


def load():
    if not OUT_JSON.exists():
        err("找不到 data/dataset.json（請先執行 tools/build_dataset.py）")
        return None, None, None
    data = json.loads(OUT_JSON.read_text(encoding="utf-8"))
    js_text = OUT_JS.read_text(encoding="utf-8") if OUT_JS.exists() else ""
    if not js_text:
        err("找不到 data/dataset.js")
        js_data = None
    else:
        m = re.search(r"window\.CN_DATASET\s*=\s*(\{.*\})\s*;", js_text, re.S)
        if not m:
            err("dataset.js 找不到 window.CN_DATASET = {...}")
            js_data = None
        else:
            try:
                js_data = json.loads(m.group(1))
            except Exception as exc:
                err("dataset.js 內容不是合法 JSON：%s" % exc)
                js_data = None
    report = None
    if REPORT.exists():
        try:
            report = json.loads(REPORT.read_text(encoding="utf-8"))
        except Exception:
            warn("tools/build_report.json 無法解析")
    return data, js_data, report


def validate(data: dict, js_data, report):
    # 1. meta / 基本結構
    if not isinstance(data.get("meta"), dict):
        err("meta 缺失")
    else:
        for key in ("title", "version", "generated_at"):
            if not data["meta"].get(key):
                err("meta.%s 缺失" % key)
    units = data.get("units")
    items = data.get("items")
    t2s = data.get("t2s")
    if not isinstance(units, list) or not units:
        err("units 缺失或為空")
        units = []
    if not isinstance(items, list) or not items:
        err("items 缺失或為空")
        items = []
    if not isinstance(t2s, dict) or not t2s:
        err("t2s 缺失或為空")
        t2s = {}

    if not errors:
        if data["meta"]["title"] != "中文溫習":
            warn("meta.title 不是「中文溫習」：%s" % data["meta"]["title"])
        if data["meta"]["version"] != data["meta"]["generated_at"][:10]:
            warn("meta.version 與 generated_at 日期不一致")

    # 2. units
    unit_ids = set()
    for u in units:
        uid = u.get("id", "")
        if not uid:
            err("unit 缺 id：%r" % u)
            continue
        if uid in unit_ids:
            err("unit id 重複：%s" % uid)
        unit_ids.add(uid)
        if u.get("module") not in VALID_MODULES:
            err("unit %s 的 module 不合法：%r" % (uid, u.get("module")))
        if not u.get("name"):
            err("unit %s 缺 name" % uid)

    # 3. items
    seen_ids = set()
    seen_keys = {}
    counts = {}
    seg_counts = {}
    author_kinds = {}
    t_side_chars = set()
    t_side_texts = []
    accept_violations = 0

    for idx, it in enumerate(items):
        label = it.get("id", "#%d" % idx)
        itype = it.get("type")

        # id
        iid = it.get("id", "")
        m = ID_RE.match(iid)
        if not m:
            err("%s id 格式錯誤（應為 mj-/cj-/cs- + 三位數）" % label)
        elif PREFIX_OF.get(itype) != m.group(1):
            err("%s id 前綴與 type 不一致（type=%s）" % (label, itype))
        if iid in seen_ids:
            err("id 重複：%s" % iid)
        seen_ids.add(iid)

        if itype not in VALID_MODULES:
            err("%s type 不合法：%r" % (label, itype))
            continue
        if it.get("unit") not in unit_ids:
            err("%s unit 不存在：%r" % (label, it.get("unit")))
        counts[(itype, it.get("unit"))] = counts.get((itype, it.get("unit")), 0) + 1

        # 段／次大測：所有題型都必須有 >=1 的整數
        for key in ("seg", "exam"):
            val = it.get(key)
            if isinstance(val, bool) or not isinstance(val, int):
                err("%s %s 必須是整數：%r" % (label, key, val))
            elif val < 1:
                err("%s %s 必須 >= 1：%r" % (label, key, val))
        seg_counts[(it.get("seg"), it.get("exam"))] = \
            seg_counts.get((it.get("seg"), it.get("exam")), 0) + 1

        if itype == "mingju":
            for key in ("t", "s", "src_t", "src_s"):
                if not it.get(key):
                    err("%s 缺 %s" % (label, key))
            for key in ("author_t", "author_s"):
                if not it.get(key):
                    err("%s 缺 %s（名句必須有作者，佚名也算）" % (label, key))
            for key in ("author_t", "author_s", "t", "s", "src_t", "src_s"):
                check_brackets("%s.%s" % (label, key), it.get(key, ""))
            if it.get("author_t") and len(it.get("author_t", "")) != len(it.get("author_s", "")):
                err("%s 作者繁簡長度不一致：%s / %s"
                    % (label, it.get("author_t"), it.get("author_s")))
            for key in ("author_t", "author_s"):
                val = it.get(key, "")
                if "《" in val or "》" in val:
                    warn("%s %s 含書名號，作者欄應只放作者：%s" % (label, key, val))
            if it.get("author_t"):
                author_norm = only_han(T2S.convert(it.get("author_t", "")))
                if not author_norm:
                    err("%s 作者欄沒有漢字：%r" % (label, it.get("author_t")))
                kind = "佚名" if it.get("author_t") in ("佚名", "無名氏", "无名氏", "不詳", "不详") \
                    else "具名"
                author_kinds[kind] = author_kinds.get(kind, 0) + 1
            for key in ("src_t", "src_s"):
                val = it.get(key, "")
                if AUTHOR_IN_SRC_RE.match(val):
                    warn("%s %s 開頭疑似含作者，出處欄應只留書名（如《離騷》）：%s"
                         % (label, key, val))
            if len(it.get("t", "")) != len(it.get("s", "")):
                err("%s 繁簡長度不一致：t(%d) / s(%d)" % (label, len(it.get("t", "")), len(it.get("s", ""))))
            if len(it.get("src_t", "")) != len(it.get("src_s", "")):
                err("%s 出處繁簡長度不一致：%s / %s" % (label, it.get("src_t"), it.get("src_s")))
            if t2s and only_han(T2S.convert(it.get("t", ""))) != only_han(it.get("s", "")):
                err("%s t2s 轉換後與 s 不一致：t=%s s=%s" % (label, it.get("t"), it.get("s")))
            if not any(ch in SPLIT_PUNCT for ch in it.get("t", "")):
                if not it.get("note"):
                    warn("%s 名句無法切半且未標 note" % label)
            else:
                half = _split_half(it.get("t", ""))
                if not half or not only_han(half):
                    warn("%s 切半後上半句沒有漢字" % label)
            t_side_texts.extend([it.get("t", ""), it.get("src_t", "")])

        elif itype == "cijie":
            for key in ("q_t", "q_s", "w_t", "w_s"):
                if not it.get(key):
                    err("%s 缺 %s" % (label, key))
            for key in ("a_t", "a_s", "k_t", "k_s"):
                if not isinstance(it.get(key), list) or not it.get(key):
                    err("%s 缺 %s（需為非空陣列）" % (label, key))
            a_t, a_s = it.get("a_t", []), it.get("a_s", [])
            k_t, k_s = it.get("k_t", []), it.get("k_s", [])
            if len(a_t) != len(a_s):
                err("%s a_t/a_s 長度不同（%d/%d）" % (label, len(a_t), len(a_s)))
            if len(k_t) != len(k_s):
                err("%s k_t/k_s 長度不同（%d/%d）" % (label, len(k_t), len(k_s)))
            for x, y in list(zip(a_t, a_s)) + list(zip(k_t, k_s)):
                if len(x) != len(y):
                    err("%s 義項繁簡長度不一致：%s / %s" % (label, x, y))
                check_brackets("%s a/k" % label, x)
                check_brackets("%s a/k(s)" % label, y)
            if len(it.get("q_t", "")) != len(it.get("q_s", "")):
                err("%s 題面繁簡長度不一致：%s / %s" % (label, it.get("q_t"), it.get("q_s")))
            if len(it.get("w_t", "")) != len(it.get("w_s", "")):
                err("%s 詞繁簡長度不一致：%s / %s" % (label, it.get("w_t"), it.get("w_s")))
            for key in ("q_t", "q_s", "w_t", "w_s"):
                check_brackets("%s.%s" % (label, key), it.get(key, ""))
            q_t = it.get("q_t", "")
            if q_t.count("【") == 1 and q_t.count("】") == 1:
                inner = q_t.split("【", 1)[1].split("】", 1)[0]
                if inner != it.get("w_t"):
                    err("%s 【】內容與 w_t 不一致：%s / %s" % (label, inner, it.get("w_t")))
                elif q_t == "【%s】" % it.get("w_t"):
                    warn("%s 詞即整句（【】包住全部題面，來源如此）" % label)
            else:
                if q_t != "解釋「%s」" % it.get("w_t"):
                    err("%s 題面缺【】且不是「解釋「詞」」形式：%s" % (label, q_t))
                if not it.get("note"):
                    warn("%s 題面 fallback 但沒有 note 說明" % label)
            # 資料衛生：顯示的標準答案若以外殼詞開頭，使用者照抄會被前端 strip_wrapper 判錯
            # （除非 a/k 內另有去掉前綴的同形答案可命中）
            head = (a_t or [""])[0]
            hit = _wrapper_prefix(head)
            if hit:
                stripped = head[len(hit):].strip()
                rescue = any(x == stripped for x in list(a_t) + list(k_t))
                if not rescue:
                    warn("%s 標準答案以「%s」開頭且無替代關鍵詞，照抄會被判錯：%s"
                         % (label, hit, head))
            t_side_texts.extend([q_t, it.get("w_t", "")] + a_t + k_t)

        else:  # changshi
            for key in ("q_t", "q_s", "a_t", "a_s"):
                if not it.get(key):
                    err("%s 缺 %s" % (label, key))
            acc = it.get("accept")
            if not isinstance(acc, list) or not acc:
                err("%s 缺 accept（需為非空陣列）" % label)
            else:
                marks = "《》「」『』〈〉"
                base = "".join(ch for ch in it.get("a_t", "") if ch not in marks)
                forms = list(acc)
                if base not in forms and T2S.convert(base) not in forms:
                    err("%s accept 未包含去書名號後的答案「%s」（accept=%s）"
                        % (label, base, ",".join(forms)))
                if len(forms) != len(set(forms)):
                    warn("%s accept 有重複項" % label)
                accept_violations += len(acc) < 1
            if len(it.get("q_t", "")) != len(it.get("q_s", "")):
                err("%s 題面繁簡長度不一致：%s / %s" % (label, it.get("q_t"), it.get("q_s")))
            if len(it.get("a_t", "")) != len(it.get("a_s", "")):
                err("%s 答案繁簡長度不一致：%s / %s" % (label, it.get("a_t"), it.get("a_s")))
            for key in ("q_t", "a_t"):
                check_brackets("%s.%s" % (label, key), it.get(key, ""))
            for form in (acc or []):
                check_brackets("%s.accept" % label, form)
            t_side_texts.extend([it.get("q_t", ""), it.get("a_t", "")] + list(acc))

        # 重複條目（同 unit、同 type、正規化後相同）
        if isinstance(it.get("a_t"), list):
            a_norm = only_han(T2S.convert("".join(it.get("a_t", []))))
        else:
            a_norm = only_han(T2S.convert(it.get("a_t", "")))
        if itype == "mingju":
            key = (it.get("unit"), itype, only_han(T2S.convert(it.get("t", ""))),
                   only_han(T2S.convert(it.get("src_t", ""))))
        elif itype == "cijie":
            key = (it.get("unit"), itype, only_han(T2S.convert(it.get("w_t", ""))), a_norm)
        else:
            key = (it.get("unit"), itype, only_han(T2S.convert(it.get("q_t", ""))), a_norm)
        if key in seen_keys:
            err("重複條目：%s 與 %s" % (label, seen_keys[key]))
        else:
            seen_keys[key] = label

        # for t2s 覆蓋率
        for k, v in it.items():
            if k.endswith("_t"):
                t_side_texts.extend(v if isinstance(v, list) else [v])

    t_side_texts.extend(u.get("name", "") for u in units)
    for text in t_side_texts:
        t_side_chars.update(ch for ch in text if has_han(ch))

    # 4. t2s 覆蓋率
    if isinstance(t2s, dict):
        for ch in sorted(t_side_chars):
            conv = T2S.convert(ch)
            if conv != ch:
                if ch not in t2s:
                    err("t2s 缺字：%s（應為 %s）" % (ch, conv))
                elif t2s[ch] != conv:
                    err("t2s 映射錯誤：%s → %s（應為 %s）" % (ch, t2s[ch], conv))
        for ch, val in t2s.items():
            if ch == val:
                err("t2s 不應收錄無差異的字：%s" % ch)
            elif T2S.convert(ch) != val:
                err("t2s 值與 OpenCC 不一致：%s → %s" % (ch, val))
            elif ch not in t_side_chars:
                warn("t2s 含資料中未出現的字：%s" % ch)

    # 5. dataset.js 與 dataset.json 一致
    if js_data is not None and js_data != data:
        err("dataset.js 與 dataset.json 內容不一致")
    if js_data is not None and js_data.get("meta", {}).get("generated_at", "") != \
            data.get("meta", {}).get("generated_at", ""):
        warn("dataset.js 與 dataset.json 的 generated_at 不同")

    # 6. 統計輸出
    print("單位題數：")
    for u in units:
        n = counts.get((u.get("module"), u.get("id")), 0)
        print("  %-9s %-14s %3d 題" % (u.get("module"), u.get("name"), n))
    print("模組題數：" + " / ".join(
        "%s %d" % (m, sum(c for (t, _), c in counts.items() if t == m))
        for m in VALID_MODULES) + "，合計 %d" % len(items))
    print("t2s 對照表：%d 字" % len(t2s))
    seg_rows = sorted(seg_counts.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1])))
    print("段／次大測：" + "、".join(
        "seg %s / exam %s → %d 題" % (s, e, c) for (s, e), c in seg_rows))
    if author_kinds:
        print("名句作者：具名 %d 題／佚名 %d 題"
              % (author_kinds.get("具名", 0), author_kinds.get("佚名", 0)))

    if report:
        dirs = report.get("source_dirs") or ["（未記錄）"]
        print("來源目錄：" + "、".join("%s/" % d for d in dirs)
              + "（同名檔以 source/ 為準）")
        skips = report.get("skips", [])
        print("來源 skip：%d 筆%s" % (len(skips), "" if not skips else
                                     "（" + "；".join(
                                         "%s:%s %s" % (s["file"], s["line"], s["reason"])
                                         for s in skips) + "）"))
        warns = report.get("warnings", [])
        if warns:
            print("來源提醒：%d 筆（%s）" % (len(warns), "；".join(warns)))
        todo = report.get("manual_todo", [])
        print("待人工處理（非 CSV）：%d 筆%s"
              % (len(todo), "" if not todo else
                 "（" + "、".join(f["source"] for f in todo) + "，請先轉成 CSV）"))
        ignored = report.get("ignored_files", [])
        if ignored:
            print("已略過的非 CSV 檔：%d 筆（%s）"
                  % (len(ignored), "、".join(f["source"] for f in ignored)))
        shadowed = report.get("shadowed", [])
        if shadowed:
            print("同名檔：%d 筆（%s）"
                  % (len(shadowed), "；".join("%s → 用 %s" % (s["file"], s["used"])
                                              for s in shadowed)))
        fb = report.get("fallback_q", [])
        if fb:
            print("詞解題面 fallback：%d 筆（%s）"
                  % (len(fb), "；".join("%s %s" % (f["id"], f["w_t"]) for f in fb)))
        notes = report.get("notes", [])
        if notes:
            print("note：%d 筆（%s）"
                  % (len(notes), "；".join("%s %s" % (n["id"], n["note"]) for n in notes)))
    else:
        print("來源 skip：無法取得（tools/build_report.json 不存在，請先跑 build）")


def _split_half(text: str):
    for i, ch in enumerate(text):
        if ch in SPLIT_PUNCT:
            return text[:i]
    return None


# 與 js/core.js 的 WRAP_PREFIX 對齊：判分前會去掉這些前綴
WRAP_PREFIX = ["答案是", "答案應是", "答案应为", "應為", "应为", "是指", "指的是",
               "就是", "意思是", "意為", "意为", "即", "指", "為", "是"]
WRAP_SUFFIX = ["的意思", "之意", "的含義", "的含义", "的意義", "的意义", "意思", "含義", "含义"]


def _wrapper_prefix(text: str):
    """回傳會被前端外殼規則吃掉的前綴（沒有則 None）。"""
    for p in WRAP_PREFIX:
        if text.startswith(p) and len(text) > len(p):
            return p
    for s in WRAP_SUFFIX:
        if text.endswith(s) and len(text) > len(s):
            return s + "（後綴）"
    return None


def main(argv=None) -> int:
    strict = "--strict" in (argv or sys.argv[1:])
    data, js_data, report = load()
    if data is not None:
        validate(data, js_data, report)

    print()
    if warnings:
        print("警告 %d 筆：" % len(warnings))
        for w in warnings[:60]:
            print("  ⚠ %s" % w)
        if len(warnings) > 60:
            print("  …（其餘 %d 筆省略）" % (len(warnings) - 60))
    else:
        print("警告 0 筆")
    print("錯誤 %d 筆%s" % (len(errors), "" if not errors else "："))
    for e in errors[:60]:
        print("  ✗ %s" % e)
    if len(errors) > 60:
        print("  …（其餘 %d 筆省略）" % (len(errors) - 60))

    failed = bool(errors) or (strict and bool(warnings))
    print("結果：" + ("不通過" if failed else "通過"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
