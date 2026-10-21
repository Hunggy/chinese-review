/* js/core.js —— 純邏輯層：資料存取、判分、隊列、進度儲存
 * 規範：不碰 DOM；在同構（node）環境下也可載入以做單元測試。
 * 對外介面掛在 root.CNCore（root = window 或 globalThis）。
 */
(function (root) {
  'use strict';

  /* ============================================================
   * 0. 常數與小工具
   * ============================================================ */

  var STORE_KEY = 'cn_review_v1';
  var STORE_VERSION = 1;

  /* 名句切半用標點（依 spec §7：以第一個標點切開） */
  var SPLIT_PUNCT = '，,；;：:？?！!';

  /* 漢字範圍（含擴充 A 與相容表意字） */
  var CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

  /* 模組定義（首頁四張卡） */
  var MODULES = [
    { id: 'mingju', no: '一', name: '名句默寫', desc: '給上／下半句，手寫默出', types: ['mingju'], short: '名句' },
    { id: 'cijie', no: '二', name: '詞解', desc: '解釋句中加點詞', types: ['cijie'], short: '詞解' },
    { id: 'changshi', no: '三', name: '文學常識・出處', desc: '問答與選擇題', types: ['changshi'], short: '常識' },
    { id: 'mixed', no: '四', name: '全部混合', desc: '以上全部隨機', types: ['mingju', 'cijie', 'changshi'], short: '混合' }
  ];

  /* 字號級別（html[data-font]） */
  var FONTS = ['sm', 'md', 'lg', 'xl'];
  var THEMES = ['light', 'dark'];
  var SCRIPTS = ['t', 's'];

  function is_cjk(ch) { return CJK_RE.test(ch); }
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function is_array(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }
  function uniq(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) { if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); } }
    return out;
  }

  /* 可重現亂數（mulberry32）；測試可指定 seed */
  function make_rng(seed) {
    var a = (seed === undefined || seed === null) ? (Date.now() >>> 0) : (seed >>> 0);
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    var a = arr.slice(), r = rng || Math.random, i, j, t;
    for (i = a.length - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ============================================================
   * 1. 資料
   * ============================================================ */

  function empty_dataset() {
    return { meta: { title: '中文溫習', version: '', generated_at: '' }, units: [], items: [], t2s: {} };
  }

  function dataset() {
    var ds = root.CN_DATASET;
    if (!ds || typeof ds !== 'object') return empty_dataset();
    if (!is_array(ds.items)) ds.items = [];
    if (!is_array(ds.units)) ds.units = [];
    if (!ds.t2s || typeof ds.t2s !== 'object') ds.t2s = {};
    if (!ds.meta || typeof ds.meta !== 'object') ds.meta = empty_dataset().meta;
    /* 防禦：去掉沒有 id 的題目、補上缺欄位 */
    var ids = {};
    ds.items = ds.items.filter(function (it) {
      if (!it || typeof it !== 'object') return false;
      if (!it.id || ids[it.id]) return false;
      ids[it.id] = 1;
      if (!it.type) it.type = 'changshi';
      if (!it.unit) it.unit = 'default';
      return true;
    });
    return ds;
  }

  function t2s_map() {
    var ds = dataset(), map = {}, k;
    for (k in ds.t2s) { if (Object.prototype.hasOwnProperty.call(ds.t2s, k) && ds.t2s[k]) map[k] = str(ds.t2s[k]); }
    /* 補充：介面文案用字（資料未出現但 UI 需要的常用繁簡對照） */
    for (k in UI_T2S_EXTRA) { if (!Object.prototype.hasOwnProperty.call(map, k)) map[k] = UI_T2S_EXTRA[k]; }
    return map;
  }

  var _t2s_cache = null, _t2s_stamp = null;
  function t2s() {
    var ds = dataset();
    if (_t2s_cache && _t2s_stamp === ds) return _t2s_cache;
    _t2s_cache = t2s_map();
    _t2s_stamp = ds;
    return _t2s_cache;
  }

  /* 逐字繁→簡；表外字原樣輸出 */
  function to_simple(text) {
    var s = str(text), map = t2s(), out = '', i;
    for (i = 0; i < s.length; i++) { out += (map[s.charAt(i)] || s.charAt(i)); }
    return out;
  }

  function is_simplified_char(ch) { return is_cjk(ch) && !t2s()[ch]; }

  function meta() { return dataset().meta || {}; }

  function all_items() { return dataset().items; }

  function item_by_id(id) {
    var items = all_items();
    for (var i = 0; i < items.length; i++) { if (items[i].id === id) return items[i]; }
    return null;
  }

  function items_of_types(types) {
    var items = all_items();
    return items.filter(function (it) { return types.indexOf(it.type) >= 0; });
  }

  function module_by_id(id) {
    for (var i = 0; i < MODULES.length; i++) { if (MODULES[i].id === id) return MODULES[i]; }
    return MODULES[0];
  }

  function items_for_module(module_id) {
    var m = module_by_id(module_id);
    return items_of_types(m.types);
  }

  /* 單元清單：一律由 items 推導，metadata 只提供名稱（避免資料不同步） */
  function unit_rows(module_id) {
    var m = module_by_id(module_id), items = items_for_module(module_id);
    var meta_units = {}, i, name;
    var units = dataset().units;
    for (i = 0; i < units.length; i++) { if (units[i] && units[i].id) meta_units[units[i].id] = str(units[i].name) || units[i].id; }
    var buckets = {}, order = [];
    for (i = 0; i < items.length; i++) {
      var u = items[i].unit;
      if (!buckets[u]) { buckets[u] = 0; order.push(u); }
      buckets[u] += 1;
    }
    return order.map(function (u) {
      name = meta_units[u] || u;
      return { id: u, name: name, module: m.id, count: buckets[u] };
    });
  }

  function units_for_module(module_id) { return unit_rows(module_id); }

  /* 範圍過濾：unit_ids 為 ['all'] 或空 → 全部；filters 可再疊加段／次（向後兼容） */
  function filter_by_units(items, unit_ids, filters) {
    var out;
    if (!is_array(unit_ids) || !unit_ids.length || unit_ids.indexOf('all') >= 0) out = items.slice();
    else out = items.filter(function (it) { return unit_ids.indexOf(it.unit) >= 0; });
    return filters ? filter_by_scope(out, filters) : out;
  }

  function items_for(module_id, unit_ids, filters) {
    return filter_by_units(items_for_module(module_id), unit_ids, filters);
  }

  /* ============================================================
   * 1b. 段／次大測（seg / exam，spec §3.5）
   * ============================================================ */

  function int_field(item, name) {
    var v = item ? item[name] : null;
    var n = parseInt(v, 10);
    return (isFinite(n) && n >= 1) ? n : 1;
  }

  function item_seg(item) { return int_field(item, 'seg'); }
  function item_exam(item) { return int_field(item, 'exam'); }

  /* 資料是否帶段／次欄位（瀏覽／統計的標籤只在有資料時顯示） */
  function has_scope_field(item) {
    if (!item) return false;
    var a = item.seg, b = item.exam;
    return (a !== undefined && a !== null && a !== '') || (b !== undefined && b !== null && b !== '');
  }

  function scope_label(item, opts) {
    if (!has_scope_field(item) && !(opts && opts.force)) return '';
    return '第 ' + item_seg(item) + ' 段・第 ' + item_exam(item) + ' 次大測';
  }

  function scope_label_seg(v) { return '第 ' + v + ' 段'; }
  function scope_label_exam(v) { return '第 ' + v + ' 次'; }

  /* 段／次的合法值：'all' 或 1 起的數字字串 */
  function norm_scope_value(v) {
    if (v === undefined || v === null || v === '' || v === 'all') return 'all';
    var n = parseInt(v, 10);
    return (isFinite(n) && n >= 1) ? String(n) : 'all';
  }

  function scope_values(items, kind) {
    var seen = {}, out = [], i, v;
    for (i = 0; i < items.length; i++) {
      v = kind === 'exam' ? item_exam(items[i]) : item_seg(items[i]);
      if (!seen[v]) { seen[v] = 1; out.push(v); }
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  /* [{value:1, label:'第 1 段', count:n}] */
  function seg_rows(items) {
    return scope_values(items, 'seg').map(function (v) {
      var n = 0, i;
      for (i = 0; i < items.length; i++) { if (item_seg(items[i]) === v) n += 1; }
      return { id: String(v), value: v, label: scope_label_seg(v), count: n };
    });
  }

  /* 指定段內的次（seg 為 'all' → 所有次） */
  function exam_rows(items, seg) {
    var base = filter_by_scope(items, { seg: seg });
    return scope_values(base, 'exam').map(function (v) {
      var n = 0, i;
      for (i = 0; i < base.length; i++) { if (item_exam(base[i]) === v) n += 1; }
      return { id: String(v), value: v, label: scope_label_exam(v), count: n };
    });
  }

  function filter_by_scope(items, opts) {
    opts = opts || {};
    var seg = norm_scope_value(opts.seg), exam = norm_scope_value(opts.exam);
    if (seg === 'all' && exam === 'all') return items.slice();
    var sn = seg === 'all' ? 0 : parseInt(seg, 10);
    var en = exam === 'all' ? 0 : parseInt(exam, 10);
    return items.filter(function (it) {
      if (sn && item_seg(it) !== sn) return false;
      if (en && item_exam(it) !== en) return false;
      return true;
    });
  }

  /* ============================================================
   * 2. 欄位讀取（對缺欄位防禦）
   * ============================================================ */

  function str_field(item, name) {
    if (!item) return '';
    var v = item[name];
    if (is_array(v)) return v.length ? str(v[0]) : '';
    return str(v);
  }

  function list_field(item, name) {
    if (!item) return [];
    var v = item[name], out = [], i;
    if (is_array(v)) { for (i = 0; i < v.length; i++) { if (str(v[i]).trim()) out.push(str(v[i])); } return out; }
    if (str(v).trim()) out.push(str(v));
    return out;
  }

  /* 名句（全句）的繁／簡對照：欄位為 t / s */
  function sentence(item) {
    var t = str_field(item, 't');
    var s = str_field(item, 's');
    if (!t) t = s;
    if (!s) s = t;
    return { t: t, s: s };
  }

  /* 作者欄位缺資料時視為「佚名」（詩經／古詩十九首等本無作者） */
  var ANON_NAMES = ['佚名', '無名氏', '不詳'];

  function author_pair(item) {
    var p = pair(item, 'author');
    if (!p.t && !p.s) return { t: ANON_NAMES[0], s: to_simple(ANON_NAMES[0]) };
    return p;
  }

  function source_pair(item) { return pair(item, 'src'); }

  /* 完整出處（含篇名，如《左傳·僖公五年》）——只用於寬容判分與搜尋，不顯示 */
  function source_full_pair(item) { return pair(item, 'src_full'); }

  /* 是否為「佚名」類寫法（含簡體變體） */
  function is_anon_text(text) {
    var n = norm(text);
    if (!n) return false;
    var forms = ANON_NAMES.concat(ANON_NAMES.map(to_simple)), i;
    for (i = 0; i < forms.length; i++) { if (norm(forms[i]) === n) return true; }
    return false;
  }

  /* 作者 +《出處》組合成一個字串（出處已含書名號時不重複加） */
  function join_author_src(author, src) {
    var a = str(author).trim(), s = str(src).trim();
    if (!s) return a;
    if (!a) return s;
    if (s.charAt(0) === '《' || s.charAt(0) === '【') return a + s;
    return a + '《' + s + '》';
  }

  /* 名句「作者・出處」模式的組合答案（選擇題選項用） */
  function author_variant(item) {
    var a = author_pair(item), s = source_pair(item);
    return { t: join_author_src(a.t, s.t), s: join_author_src(a.s, s.s) };
  }

  /* 取繁/簡成對欄位（如 a_t/a_s、src_t/src_s）；缺簡體欄位時退回繁體 */
  function pair(item, base) {
    var t = str_field(item, base + '_t');
    var s = str_field(item, base + '_s');
    if (!t) t = s;
    if (!s) s = t;
    return { t: t, s: s };
  }

  function list_pair(item, base) {
    var t = list_field(item, base + '_t');
    var s = list_field(item, base + '_s');
    if (!t.length) t = s.slice();
    if (!s.length) s = t.slice();
    return { t: t, s: s };
  }

  /* ============================================================
   * 3. 正規化與判分（spec §7）
   * ============================================================ */

  /* 只保留漢字，並逐字繁→簡 */
  function norm(text) {
    var s = str(text), out = '', i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (!is_cjk(ch)) continue;
      out += to_simple(ch);
    }
    return out;
  }

  /* 去掉口語外殼後再正規化（詞解／常識用） */
  var WRAP_PREFIX = [
    '答案是', '答案應是', '答案应为',
    '作者是', '作者為', '作者为', '出處是', '出處為', '出处是', '出处为',
    '應為', '应为', '是指', '指的是', '就是', '意思是', '意為', '意为', '即', '指', '為', '是'
  ];
  var WRAP_SUFFIX = ['的意思', '之意', '的含義', '的含义', '的意義', '的意义', '意思', '含義', '含义'];
  var LEAD_RE = /^[「『“"'（）()《》【】\[\]\s、，,。.；;：:！!？?]+/;

  function strip_wrapper(text) {
    var t = str(text).trim(), changed = true, i, m;
    var guard = 0;
    while (changed && guard++ < 12) {
      changed = false;
      for (i = 0; i < WRAP_PREFIX.length; i++) {
        if (t.indexOf(WRAP_PREFIX[i]) === 0 && t.length > WRAP_PREFIX[i].length) {
          t = t.slice(WRAP_PREFIX[i].length).trim(); changed = true;
        }
      }
      for (i = 0; i < WRAP_SUFFIX.length; i++) {
        if (t.length > WRAP_SUFFIX[i].length && t.slice(-WRAP_SUFFIX[i].length) === WRAP_SUFFIX[i]) {
          t = t.slice(0, t.length - WRAP_SUFFIX[i].length).trim(); changed = true;
        }
      }
      m = t.match(LEAD_RE);
      if (m && t.length > m[0].length) { t = t.slice(m[0].length).trim(); changed = true; }
    }
    return t;
  }

  function norm_answer(text) { return norm(strip_wrapper(text)); }

  /* 名句切半 */
  function split_mingju(text) {
    var s = str(text), i, idx = -1;
    for (i = 0; i < s.length; i++) { if (SPLIT_PUNCT.indexOf(s.charAt(i)) >= 0) { idx = i; break; } }
    if (idx < 0) {
      /* 次選：句號（例如「多情自古傷離別。更那堪、冷落清秋節。」） */
      idx = s.indexOf('。');
    }
    if (idx < 0) {
      /* 防禦：無標點時對半切，至少仍有題面與答案 */
      var half = Math.ceil(s.length / 2);
      return { first: s.slice(0, half), second: s.slice(half), punct: '', degraded: true };
    }
    return { first: s.slice(0, idx + 1), second: s.slice(idx + 1), punct: s.charAt(idx), degraded: false };
  }

  /* 名句的題面與答案（依 script 與 direction） */
  function mingju_pair(item, direction) {
    var t = sentence(item);
    var st = split_mingju(t.t), ss = split_mingju(t.s);
    var dir = direction === 'sh' ? 'sh' : 'hs';
    return {
      dir: dir,
      prompt_t: dir === 'sh' ? st.second : st.first,
      prompt_s: dir === 'sh' ? ss.second : ss.first,
      answer_t: dir === 'sh' ? st.first : st.second,
      answer_s: dir === 'sh' ? ss.first : ss.second,
      ask: dir === 'sh' ? '請默寫上半句：' : '請默寫下半句：'
    };
  }

  /* 計算漢字數（標點不計） */
  function count_han(text) {
    var s = str(text), n = 0, i;
    for (i = 0; i < s.length; i++) { if (is_cjk(s.charAt(i))) n++; }
    return n;
  }

  /* 詞解／常識的答案與關鍵詞 */
  function cijie_data(item) { return { a: list_pair(item, 'a'), k: list_pair(item, 'k') }; }
  function changshi_data(item) {
    var a = pair(item, 'a');
    var acc = list_field(item, 'accept');
    var acc_s = acc.map(to_simple);
    return { a: a, accept: uniq(acc.concat(acc_s)) };
  }

  /* 單題判分：回傳 {ok, expected, got, empty, reason} */
  function grade_text(item, user_text, opts) {
    opts = opts || {};
    var raw = str(user_text);
    if (!raw.trim() || !norm(raw)) {
      return { ok: false, empty: true, reason: 'empty', expected: expected_text(item, opts), got: raw };
    }
    if (!item) return { ok: false, reason: 'no-item', expected: '', got: raw };

    var type = item.type, got, i, targets;

    if (type === 'mingju') {
      var mp = mingju_pair(item, opts.direction);
      got = norm(raw);
      if (opts.direction === 'author') {
        /* 程式化呼叫（單一欄位）時，比對「作者《出處》」組合 */
        var av = author_variant(item);
        var a_forms = uniq([norm(raw), norm_answer(raw)]).filter(Boolean);
        var a_targets = uniq([norm(av.t), norm(av.s)]).filter(Boolean);
        return { ok: norm_match(a_forms, a_targets), expected: av.t, got: got, reason: 'author' };
      }
      var target = norm(mp.answer_t);
      return { ok: !!target && got === target, expected: mp.answer_t, got: got, reason: 'mingju' };
    }

    if (type === 'cijie') {
      var cd = cijie_data(item);
      got = norm_answer(raw);
      /* 使用者輸入與標準答案走同一套正規化（含去外殼），避免「為／是／指」開頭的答案被判錯 */
      var forms = uniq([norm(raw), got]).filter(Boolean);
      /* 選填 accept（如通假字拆開寫）：每個值都可獨立判對；沒有此欄時等同空陣列 */
      var cj_accept = list_field(item, 'accept');
      targets = uniq(
        cd.a.t.map(norm_answer)
          .concat(cd.a.s.map(norm_answer))
          .concat(cd.a.t.map(norm))
          .concat(cd.a.s.map(norm))
          .concat(cj_accept.map(norm_answer))
          .concat(cj_accept.map(norm))
          .filter(Boolean)
      );
      for (i = 0; i < forms.length; i++) {
        var fi;
        for (fi = 0; fi < targets.length; fi++) {
          if (forms[i] === targets[fi]) return { ok: true, expected: cd.a.t[0] || '', got: forms[i], reason: 'exact' };
        }
      }
      var ks = cs_keywords(cd);
      for (i = 0; i < forms.length; i++) {
        var kj;
        for (kj = 0; kj < ks.length; kj++) {
          if (ks[kj] && forms[i].indexOf(ks[kj]) >= 0) return { ok: true, expected: cd.a.t[0] || '', got: forms[i], reason: 'keyword', hit: ks[kj] };
        }
      }
      return { ok: false, expected: cd.a.t[0] || '', got: got, reason: 'mismatch' };
    }

    /* changshi */
    var ch = changshi_data(item);
    got = norm_answer(raw);
    var ch_forms = uniq([norm(raw), got]).filter(Boolean);
    var raw_targets = [ch.a.t, ch.a.s].concat(ch.accept).filter(function (v) { return str(v).length; });
    targets = uniq(
      raw_targets.map(norm_answer)
        .concat(raw_targets.map(norm))
        .filter(Boolean)
    );
    for (i = 0; i < ch_forms.length; i++) {
      var ti;
      for (ti = 0; ti < targets.length; ti++) {
        if (ch_forms[i] === targets[ti]) return { ok: true, expected: ch.a.t, got: ch_forms[i], reason: 'exact' };
      }
    }
    return { ok: false, expected: ch.a.t, got: got, reason: 'mismatch' };
  }

  /* 任一組寫法等於任一標準答案 */
  function norm_match(forms, targets) {
    var i, j;
    for (i = 0; i < forms.length; i++) {
      if (!forms[i]) continue;
      for (j = 0; j < targets.length; j++) {
        if (targets[j] && forms[i] === targets[j]) return true;
      }
    }
    return false;
  }

  /* 名句「作者・出處」判分：兩欄都對才算 ok；回傳逐欄結果（spec §7） */
  function grade_author(item, author_text, source_text, opts) {
    opts = opts || {};
    var a_raw = str(author_text).trim(), s_raw = str(source_text).trim();
    var exp_a = author_pair(item), exp_s = source_pair(item);
    var out = {
      ok: false,
      author_ok: false,
      source_ok: false,
      expected_author: exp_a.t,
      expected_author_s: exp_a.s,
      expected_source: exp_s.t,
      expected_source_s: exp_s.s,
      got_author: a_raw,
      got_source: s_raw,
      author_empty: !norm(a_raw),
      source_empty: !norm(s_raw),
      reason: 'author'
    };
    if (out.author_empty && out.source_empty) { out.empty = true; out.reason = 'empty'; return out; }

    var a_forms = uniq([norm(a_raw), norm_answer(a_raw)]).filter(Boolean);
    var s_forms = uniq([norm(s_raw), norm_answer(s_raw)]).filter(Boolean);
    var a_targets = uniq([norm(exp_a.t), norm(exp_a.s)]).filter(Boolean);
    /* 出處只考書名（src_t/src_s）；願意背篇名的人打完整出處（src_full_t/src_full_s）也算對 */
    var exp_s_full = source_full_pair(item);
    var s_targets = uniq([
      norm(exp_s.t), norm(exp_s.s), norm(exp_s_full.t), norm(exp_s_full.s)
    ]).filter(Boolean);
    /* 標準為「佚名」時，接受無名氏／不詳 */
    var anon_targets = ANON_NAMES.concat(ANON_NAMES.map(to_simple)).map(norm).filter(Boolean);
    var anon_expected = norm_match(a_targets, anon_targets);

    out.author_ok = norm_match(a_forms, a_targets) || (anon_expected && norm_match(a_forms, anon_targets));
    out.source_ok = !!(s_forms.length && s_targets.length) && norm_match(s_forms, s_targets);
    out.ok = out.author_ok && out.source_ok;
    if (!out.ok) out.reason = (out.author_ok ? 'source' : (out.source_ok ? 'author' : 'both'));
    return out;
  }

  /* 關鍵詞正規化：只收長度 ≥ 2 漢字的詞
   * 單字關鍵詞（如「是」「少」）用子字串比對時，會被「不是」「不少」這類相反答案命中 → 寧嚴不寬
   */
  function cs_keywords(cd) {
    var out = [], i;
    for (i = 0; i < cd.k.t.length; i++) { out.push(norm(cd.k.t[i])); }
    for (i = 0; i < cd.k.s.length; i++) { out.push(norm(cd.k.s[i])); }
    return uniq(out.filter(function (k) { return k.length >= 2; }));
  }

  /* 該題的標準答案（顯示用，依 script） */
  function expected_text(item, opts) {
    opts = opts || {};
    if (!item) return '';
    if (item.type === 'mingju') {
      if (opts.direction === 'author') return author_variant(item).t;
      return mingju_pair(item, opts.direction).answer_t;
    }
    if (item.type === 'cijie') return list_pair(item, 'a').t[0] || '';
    return pair(item, 'a').t;
  }

  /* 該題（選擇題／翻卡）簡短答案字串 */
  function answer_variants(item, direction) {
    if (!item) return { t: '', s: '' };
    if (item.type === 'mingju') {
      if (direction === 'author') return author_variant(item);
      var mp = mingju_pair(item, direction);
      return { t: mp.answer_t, s: mp.answer_s };
    }
    if (item.type === 'cijie') {
      var a = list_pair(item, 'a');
      return { t: a.t[0] || '', s: a.s[0] || '' };
    }
    var c = pair(item, 'a');
    return { t: c.t, s: c.s };
  }

  /* ============================================================
   * 4. 選擇題選項生成（同類優先：group／答案形態，答案不重複，4 個）
   * ============================================================ */

  /* 干擾項「同類」機制
   * - group：資料層選填欄（如「數量」「稱謂」），同 group 的答案才互當干擾項
   * - answer_shape：答案的粗分類（數量／書名／人／家／制度／節慶／文字長度）
   * 分層由近到遠：同 unit 同 group → 跨 unit 同 group → 同 unit 同形態 →
   * 同 unit → 同題型 → 同 unit → 全部；每層取滿 3 個不同答案才往下走。
   */

  /* 群組欄位（可為 undefined／空字串） */
  function item_group(item) {
    if (!item) return '';
    return str(item.group).trim();
  }

  /* 數量答案：開頭是漢字數字、結尾是量詞 */
  var SHAPE_NUM_HEAD = '一二三四五六七八九十百千萬零兩';
  var SHAPE_QUANT_TAIL = '卷篇章首人天年月日次甲科個位名里分歲';

  /* 答案形態：num:卷 / num:* / book / person / school / system / festival / text:2|text:3|text:6 */
  function answer_shape(text) {
    var s = str(text).trim();
    if (!s) return 'text:2';
    if (SHAPE_NUM_HEAD.indexOf(s.charAt(0)) >= 0) {
      var tail = s.charAt(s.length - 1);
      return 'num:' + (SHAPE_QUANT_TAIL.indexOf(tail) >= 0 ? tail : '*');
    }
    if (s.indexOf('《') >= 0 || s.indexOf('》') >= 0) return 'book';
    var last = s.charAt(s.length - 1);
    if (last === '人') return 'person';
    if (last === '家') return 'school';
    if (last === '制' || last === '法') return 'system';
    if (last === '節') return 'festival';
    var n = count_han(s);
    return 'text:' + (n <= 2 ? 2 : (n <= 5 ? 3 : 6));
  }

  /* 形態家族：num:卷 與 num:篇 同屬 num；其餘形態各自成族 */
  function shape_family(shape) {
    var s = str(shape);
    return s.indexOf('num:') === 0 ? 'num' : s;
  }

  function build_options(item, pool, opts) {
    opts = opts || {};
    var rng = opts.rng || make_rng(opts.seed === undefined ? undefined : opts.seed);
    var direction = opts.direction;
    pool = is_array(pool) && pool.length ? pool : all_items();
    /* 作者・出處模式：干擾項一律用其他名句的「作者《出處》」組合（只限名句題；
       詞解／常識題若沿用使用者的「作者・出處」設定，仍須取同題型的答案作干擾項） */
    if (direction === 'author' && item.type === 'mingju') {
      var only_mj = pool.filter(function (it) { return it && it.type === 'mingju'; });
      if (only_mj.length >= 4) pool = only_mj;
    }
    var correct = answer_variants(item, direction);

    /* 名句維持原狀（不做形態分組）；常識／詞解才用 group + 答案形態 */
    var use_shape = item.type !== 'mingju';
    var want_shape = use_shape ? answer_shape(correct.t) : '';
    var want_len = count_han(correct.t);
    var want_group = item_group(item);

    /* 候選一次算好（答案／形態／長度／群組），避免逐層重算：O(n)
       去重鍵（norm）延遲計算：norm 會逐字轉簡，成本高，只在真的要取用時才算 */
    var cands = [], i;
    for (i = 0; i < pool.length; i++) {
      var it = pool[i];
      if (!it || it.id === item.id) continue;
      var v = answer_variants(it, direction);
      cands.push({
        v: v, n: null, type: it.type, unit: it.unit, group: item_group(it),
        shape: use_shape ? answer_shape(v.t) : '', len: count_han(v.t)
      });
    }
    cands = shuffle(cands, rng);

    /* 分層（依序嘗試，每層取滿 3 個不同答案才往下走） */
    var tiers = [
      function (c) { return !!want_group && c.type === item.type && c.unit === item.unit && c.group === want_group; },
      function (c) { return !!want_group && c.type === item.type && c.group === want_group; },
      function (c) { return use_shape && c.type === item.type && c.unit === item.unit && c.shape === want_shape; },
      function (c) { return c.type === item.type && c.unit === item.unit; },
      function (c) { return c.type === item.type; },
      function (c) { return c.unit === item.unit; },
      function () { return true; }
    ];

    var picked = [], taken = {};
    taken[norm(correct.t)] = 1;
    if (norm(correct.s)) taken[norm(correct.s)] = 1;
    function cand_norm(c) {
      if (c.n === null) c.n = norm(c.v.t) || norm(c.v.s);
      return c.n;
    }
    function pick(c) {
      if (picked.length >= 3) return false;
      var n = cand_norm(c);
      if (!n || taken[n]) return false;
      taken[n] = 1;
      picked.push(c.v);
      return true;
    }

    for (i = 0; i < tiers.length && picked.length < 3; i++) {
      var matched = cands.filter(tiers[i]);
      if (!matched.length) continue;
      if (!use_shape) {
        for (var k = 0; k < matched.length && picked.length < 3; k++) pick(matched[k]);
        continue;
      }
      /* 同層內：先取形態完全相同者 → 再取同家族（如 num:卷 ← num:篇）→ 最後取長度相近者 */
      var pass, j, c0;
      for (pass = 0; pass < 2 && picked.length < 3; pass++) {
        for (j = 0; j < matched.length && picked.length < 3; j++) {
          c0 = matched[j];
          if (pass === 0) { if (c0.shape !== want_shape) continue; }
          else if (shape_family(c0.shape) !== shape_family(want_shape)) continue;
          pick(c0);
        }
      }
      if (picked.length < 3) {
        var rest = matched.slice();
        rest.sort(function (a, b) { return Math.abs(a.len - want_len) - Math.abs(b.len - want_len); });
        for (j = 0; j < rest.length && picked.length < 3; j++) pick(rest[j]);
      }
    }

    var options = picked.concat([correct]);
    options = shuffle(options, rng);
    var correct_index = 0;
    for (i = 0; i < options.length; i++) {
      if (options[i] === correct) correct_index = i;
    }
    /* 以 norm 再保險一次（同一物件參照已足夠，但防止答案字面相同） */
    for (i = 0; i < options.length; i++) {
      if (norm(options[i].t) === norm(correct.t) && norm(correct.t)) { correct_index = i; break; }
    }
    return { options: options, correct_index: correct_index, correct: correct, count: options.length };
  }

  /* 選項 key：A B C D */
  function option_key(i) { return String.fromCharCode(65 + i); }

  /* ============================================================
   * 5. 隊列（spec §6）
   * ============================================================ */

  var OFFSET_WRONG = [5, 10, 20];   /* 第 1/2/3+ 次答錯 */
  var OFFSET_CONSOLIDATE = 15;      /* 首次答對後的鞏固 */
  var OFFSET_FLASH = 5;             /* 翻卡未記住 */

  function wrong_offset(wrong_count) {
    if (wrong_count <= 1) return OFFSET_WRONG[0];
    if (wrong_count === 2) return OFFSET_WRONG[1];
    return OFFSET_WRONG[2];
  }

  /* 建立一輪隊列
   * opts: { module, items|ids, mode:'practice'|'speed'|'flash', direction, question, order, seed }
   */
  function create_session(opts) {
    opts = opts || {};
    var mode = opts.mode || 'practice';
    var order = opts.order || 'shuffle';
    var module_id = opts.module || 'mixed';
    var seed = (opts.seed === undefined) ? (Date.now() >>> 0) : (opts.seed >>> 0);
    var rng = make_rng(seed);

    var items = [];
    if (is_array(opts.items) && opts.items.length) {
      items = opts.items.filter(Boolean);
    } else if (is_array(opts.ids) && opts.ids.length) {
      items = opts.ids.map(item_by_id).filter(Boolean);
    } else {
      items = items_for(module_id, opts.units, { seg: opts.seg, exam: opts.exam });
    }

    var ids = items.map(function (it) { return it.id; });
    if (order === 'shuffle') ids = shuffle(ids, rng);

    var pending = ids.map(function (id) { return { id: id, kind: 'new' }; });
    var item_map = {};
    items.forEach(function (it) { if (it && it.id) item_map[it.id] = it; });
    var s = {
      module: module_id,
      mode: mode,
      question: opts.question || 'type',
      direction: (opts.direction === 'sh' || opts.direction === 'author') ? opts.direction : 'hs',
      order: order,
      units: opts.units || ['all'],
      seg: norm_scope_value(opts.seg),
      exam: norm_scope_value(opts.exam),
      seed: seed,
      rng: rng,
      item_map: item_map,
      ids: ids.slice(),
      pending: pending,
      states: {},
      history: [],
      completed: 0,
      total: pending.length,
      progress_max: 0,
      initial_total: pending.length,
      started_at: Date.now(),
      ended_at: null,
      finished: false
    };
    return s;
  }

  function session_state(s, id) {
    if (!s.states[id]) s.states[id] = { wrong: 0, correct: 0, scheduled: false, consolidated: false, forgotten: 0 };
    return s.states[id];
  }

  function session_insert(s, id, kind, offset) {
    var pos = clamp(offset - 1, 0, s.pending.length);
    s.pending.splice(pos, 0, { id: id, kind: kind });
    s.total += 1;
  }

  function session_current(s) {
    if (!s.pending.length) return null;
    var id = s.pending[0].id;
    return (s.item_map && s.item_map[id]) || item_by_id(id);
  }
  function session_current_entry(s) { return s.pending.length ? s.pending[0] : null; }
  function session_remaining(s) { return s.pending.length; }

  function session_progress(s) {
    var raw = s.completed / Math.max(1, s.total);
    if (raw > s.progress_max) s.progress_max = raw;
    return clamp(s.progress_max, 0, 1);
  }

  /* 作答；ok=true/false。回傳 {entry, rec, inserted} */
  function session_answer(s, ok, payload) {
    payload = payload || {};
    if (!s.pending.length) return null;
    var entry = s.pending.shift();
    var st = session_state(s, entry.id);
    var rec = {
      id: entry.id,
      kind: entry.kind,
      ok: !!ok,
      user: str(payload.user),
      gaveup: !!payload.gaveup,
      mc: payload.mc || null,
      dual: payload.dual || null,
      ts: Date.now(),
      seq: s.history.length,
      mode: s.mode,
      direction: s.direction
    };
    s.history.push(rec);
    s.completed += 1;

    var inserted = null;
    if (s.mode === 'speed') {
      /* 速通：不重現 */
    } else if (s.mode === 'flash') {
      if (rec.ok) { st.correct += 1; }
      else {
        st.wrong += 1; st.forgotten += 1;
        session_insert(s, entry.id, 'flash', OFFSET_FLASH);
        inserted = OFFSET_FLASH;
      }
    } else if (rec.ok) {
      st.correct += 1;
      if (entry.kind === 'consolidate') { st.consolidated = true; }
      if (!st.scheduled && !st.consolidated) {
        st.scheduled = true;
        session_insert(s, entry.id, 'consolidate', OFFSET_CONSOLIDATE);
        inserted = OFFSET_CONSOLIDATE;
      }
    } else {
      st.wrong += 1;
      if (entry.kind === 'consolidate') { st.consolidated = true; }
      session_insert(s, entry.id, 'wrong', wrong_offset(st.wrong));
      inserted = wrong_offset(st.wrong);
    }

    if (!s.pending.length) { s.finished = true; s.ended_at = Date.now(); }
    return { entry: entry, rec: rec, inserted: inserted };
  }

  /* 覆寫為答對：把歷史紀錄與統計改正，並移除該題尚未出現的重現 */
  function session_override(s, seq) {
    var rec = null, i;
    for (i = s.history.length - 1; i >= 0; i--) { if (s.history[i].seq === seq) { rec = s.history[i]; break; } }
    if (!rec || rec.ok) return rec;
    rec.ok = true;
    rec.overridden = true;
    var st = session_state(s, rec.id);
    if (st.wrong > 0) st.wrong -= 1;
    st.correct += 1;
    if (st.scheduled || st.consolidated) st.consolidated = true;
    /* 移除該題尚未出現的重現；移除幾個就把總題數扣回幾個，
     * 否則 total 永遠比實際多，進度條到不了 100%
     */
    var removed = 0;
    s.pending = s.pending.filter(function (p) {
      if (p.id !== rec.id) return true;
      removed += 1;
      return false;
    });
    if (removed > 0) s.total = Math.max(s.completed, s.total - removed, 1);
    if (!s.pending.length) { s.finished = true; s.ended_at = Date.now(); }
    return rec;
  }

  /* 重新打亂：只打亂未答部分（保留當前題） */
  function session_reshuffle(s) {
    if (s.pending.length <= 1) return s;
    var head = s.pending.slice(0, 1);
    var rest = shuffle(s.pending.slice(1), s.rng);
    s.pending = head.concat(rest);
    return s;
  }

  /* 結算：每題以「是否曾答錯」計，題數總和恆等於本輪題數 */
  function session_result(s) {
    var per = {}, i, rec, id;
    for (i = 0; i < s.history.length; i++) {
      rec = s.history[i];
      if (!per[rec.id]) per[rec.id] = { attempts: 0, wrong: 0, correct: 0, first_ok: null, last_user: '', last_ok: null };
      per[rec.id].attempts += 1;
      if (rec.ok) per[rec.id].correct += 1; else per[rec.id].wrong += 1;
      if (per[rec.id].first_ok === null) per[rec.id].first_ok = rec.ok;
      per[rec.id].last_user = rec.user;
      per[rec.id].last_ok = rec.ok;
    }
    var total_items = s.initial_total;
    var wrong_ids = [], correct_items = 0;
    for (id in per) {
      if (!Object.prototype.hasOwnProperty.call(per, id)) continue;
      if (per[id].wrong > 0) wrong_ids.push(id); else correct_items += 1;
    }
    var correct_items2 = Math.max(0, total_items - wrong_ids.length);
    var rate = total_items ? correct_items2 / total_items : 0;
    return {
      total_items: total_items,
      answered: s.history.length,
      ok_attempts: s.history.filter(function (r) { return r.ok; }).length,
      bad_attempts: s.history.filter(function (r) { return !r.ok; }).length,
      correct_items: correct_items2,
      wrong_items: wrong_ids.length,
      wrong_ids: wrong_ids,
      rate: rate,
      duration_ms: (s.ended_at || Date.now()) - s.started_at,
      per_item: per,
      mode: s.mode,
      finished: !!s.finished
    };
  }

  function format_duration(ms) {
    var sec = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(sec / 60), ss = sec % 60;
    return m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  /* ============================================================
   * 6. 進度儲存（localStorage: cn_review_v1）
   * ============================================================ */

  function default_settings() {
    return {
      script: 't',
      theme: 'light',
      font: 'md',
      order: 'shuffle',
      mode: 'practice',
      question: 'type',
      direction: 'hs',
      module: 'mingju',
      seg: 'all',
      exam: 'all',
      units: {}
    };
  }

  function default_store() {
    return { v: STORE_VERSION, settings: default_settings(), items: {}, daily: {}, updated_at: '' };
  }

  /* 記憶體後備（node 測試、隱私模式下 localStorage 不可用） */
  function memory_backend() {
    var mem = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = str(v); },
      removeItem: function (k) { delete mem[k]; }
    };
  }

  var _backend = null;
  function backend() {
    if (_backend) return _backend;
    try {
      var ls = root.localStorage;
      if (ls) {
        ls.setItem('__cn_probe', '1');
        ls.removeItem('__cn_probe');
        _backend = ls;
        return _backend;
      }
    } catch (e) { /* 忽略：改用記憶體 */ }
    _backend = memory_backend();
    return _backend;
  }

  var _cache = null;

  function sanitize_settings(raw) {
    var d = default_settings(), s = raw && typeof raw === 'object' ? raw : {}, k;
    for (k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) s[k] = Object.prototype.hasOwnProperty.call(s, k) ? s[k] : d[k]; }
    if (SCRIPTS.indexOf(s.script) < 0) s.script = d.script;
    if (THEMES.indexOf(s.theme) < 0) s.theme = d.theme;
    if (FONTS.indexOf(s.font) < 0) s.font = d.font;
    if (['shuffle', 'original'].indexOf(s.order) < 0) s.order = d.order;
    if (['practice', 'speed', 'flash'].indexOf(s.mode) < 0) s.mode = d.mode;
    if (['type', 'mc'].indexOf(s.question) < 0) s.question = d.question;
    if (['hs', 'sh', 'author'].indexOf(s.direction) < 0) s.direction = d.direction;
    if (['mingju', 'cijie', 'changshi', 'mixed'].indexOf(s.module) < 0) s.module = d.module;
    s.seg = norm_scope_value(s.seg);
    s.exam = norm_scope_value(s.exam);
    if (!s.units || typeof s.units !== 'object' || is_array(s.units)) s.units = {};
    return s;
  }

  function sanitize_entry(raw) {
    var e = raw && typeof raw === 'object' ? raw : {};
    return {
      wrong: Math.max(0, parseInt(e.wrong, 10) || 0),
      correct: Math.max(0, parseInt(e.correct, 10) || 0),
      hard: !!e.hard,
      last_wrong: typeof e.last_wrong === 'string' ? e.last_wrong : (e.last_wrong ? str(e.last_wrong) : '')
    };
  }

  function sanitize_store(raw) {
    var base = default_store(), s = raw && typeof raw === 'object' ? raw : {}, k;
    base.settings = sanitize_settings(s.settings);
    if (s.items && typeof s.items === 'object' && !is_array(s.items)) {
      for (k in s.items) { if (Object.prototype.hasOwnProperty.call(s.items, k)) base.items[k] = sanitize_entry(s.items[k]); }
    }
    if (s.daily && typeof s.daily === 'object' && !is_array(s.daily)) {
      for (k in s.daily) {
        if (!Object.prototype.hasOwnProperty.call(s.daily, k)) continue;
        var d = s.daily[k] || {};
        base.daily[k] = { answered: Math.max(0, parseInt(d.answered, 10) || 0), correct: Math.max(0, parseInt(d.correct, 10) || 0) };
      }
    }
    base.updated_at = str(s.updated_at);
    return base;
  }

  function store_load() {
    if (_cache) return _cache;
    var raw = null;
    try { raw = backend().getItem(STORE_KEY); } catch (e) { raw = null; }
    var parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch (e) { parsed = null; } }
    _cache = sanitize_store(parsed);
    return _cache;
  }

  function store_save() {
    var s = store_load();
    s.updated_at = new Date().toISOString();
    try { backend().setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* 空間不足時忽略 */ }
    return s;
  }

  function date_key(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function settings_get() { return store_load().settings; }

  function settings_patch(patch) {
    var s = store_load();
    var merged = {}, k;
    for (k in s.settings) { if (Object.prototype.hasOwnProperty.call(s.settings, k)) merged[k] = s.settings[k]; }
    for (k in (patch || {})) { if (Object.prototype.hasOwnProperty.call(patch, k)) merged[k] = patch[k]; }
    s.settings = sanitize_settings(merged);
    store_save();
    return s.settings;
  }

  function settings_units(module_id) {
    var u = store_load().settings.units || {};
    var v = u[module_id];
    if (!is_array(v) || !v.length) return ['all'];
    return v;
  }

  function settings_set_units(module_id, units) {
    var s = store_load();
    if (!s.settings.units || typeof s.settings.units !== 'object') s.settings.units = {};
    s.settings.units[module_id] = is_array(units) ? units.slice() : ['all'];
    store_save();
    return s.settings.units[module_id];
  }

  function item_entry(id) { return store_load().items[id] || null; }

  function item_stats(id) {
    var e = item_entry(id) || { wrong: 0, correct: 0, hard: false, last_wrong: '' };
    return {
      wrong: e.wrong, correct: e.correct, hard: !!e.hard, last_wrong: e.last_wrong || '',
      due: e.wrong > 0 && e.correct < 2,
      mastered: e.correct >= 2
    };
  }

  /* 記錄一次作答（跨輪次保存）
   * opts.override：覆寫既有錯誤（等同 record_override），供舊呼叫點使用
   */
  function record_answer(id, ok, opts) {
    if (!id) return null;
    opts = opts || {};
    if (opts.override) return record_override(id, opts);
    var s = store_load();
    var e = s.items[id] = sanitize_entry(s.items[id]);
    if (ok) { e.correct += 1; }
    else { e.wrong += 1; e.last_wrong = new Date().toISOString(); }
    var dk = date_key();
    if (!s.daily[dk]) s.daily[dk] = { answered: 0, correct: 0 };
    s.daily[dk].answered += 1;
    if (ok) s.daily[dk].correct += 1;
    trim_daily(s);
    store_save();
    return e;
  }

  /* 覆寫為答對（持久統計）：把先前記下的 wrong 回退 1 次、改記 1 次 correct
   * 讓「錯題統計」「待複習」跟著清掉；不改 answered（該次作答早已計入）
   * 參數：id 題目 id（opts 預留）；回傳更新後的 entry（同 record() 形狀），無 id 回傳 null
   */
  function record_override(id, opts) {
    if (!id) return null;
    opts = opts || {};
    var s = store_load();
    var e = s.items[id] = sanitize_entry(s.items[id]);
    if (e.wrong > 0) e.wrong -= 1;
    e.correct += 1;
    /* 錯題回退到 0 時 last_wrong 一併清掉（與 clear_wrong 語義一致） */
    if (e.wrong === 0) e.last_wrong = '';
    var dk = date_key();
    if (!s.daily[dk]) s.daily[dk] = { answered: 0, correct: 0 };
    s.daily[dk].correct = Math.min(s.daily[dk].answered, s.daily[dk].correct + 1);
    trim_daily(s);
    store_save();
    return e;
  }

  function trim_daily(s) {
    var keys = Object.keys(s.daily).sort();
    while (keys.length > 60) { delete s.daily[keys.shift()]; }
  }

  /* 手動標記：hard */
  function set_hard(id, hard) {
    if (!id) return null;
    var s = store_load();
    var e = s.items[id] = sanitize_entry(s.items[id]);
    e.hard = !!hard;
    store_save();
    return e;
  }

  function toggle_hard(id) {
    var st = item_stats(id);
    return set_hard(id, !st.hard);
  }

  function clear_wrong() {
    var s = store_load(), k, n = 0;
    for (k in s.items) {
      if (!Object.prototype.hasOwnProperty.call(s.items, k)) continue;
      if (s.items[k].wrong > 0) { n += 1; }
      s.items[k].wrong = 0;
      s.items[k].last_wrong = '';
    }
    store_save();
    return n;
  }

  function all_stats() {
    var s = store_load(), rows = [], k, it;
    for (k in s.items) {
      if (!Object.prototype.hasOwnProperty.call(s.items, k)) continue;
      it = item_by_id(k);
      if (!it) continue;
      rows.push({
        id: k, item: it, wrong: s.items[k].wrong, correct: s.items[k].correct,
        hard: !!s.items[k].hard, last_wrong: s.items[k].last_wrong || '',
        due: s.items[k].wrong > 0 && s.items[k].correct < 2,
        mastered: s.items[k].correct >= 2
      });
    }
    rows.sort(function (a, b) {
      if (b.wrong !== a.wrong) return b.wrong - a.wrong;
      return b.correct - a.correct;
    });
    return rows;
  }

  function summary() {
    var s = store_load(), st = all_stats(), i;
    var due = 0, mastered = 0, wrong_total = 0, c = 0, w = 0;
    for (i = 0; i < st.length; i++) {
      if (st[i].due) due += 1;
      if (st[i].mastered) mastered += 1;
      if (st[i].wrong > 0) wrong_total += 1;
      c += st[i].correct; w += st[i].wrong;
    }
    var today = s.daily[date_key()] || { answered: 0, correct: 0 };
    var items = all_items().length;
    return {
      today_answered: today.answered,
      today_correct: today.correct,
      today_rate: today.answered ? today.correct / today.answered : 0,
      rate: (c + w) ? c / (c + w) : 0,
      attempts: c + w,
      due: due,
      mastered: mastered,
      wrong_total: wrong_total,
      item_count: items,
      touched: st.length
    };
  }

  function module_summary(module_id) {
    var items = items_for_module(module_id), i, st, mastered = 0, due = 0, wrong = 0;
    for (i = 0; i < items.length; i++) {
      st = item_stats(items[i].id);
      if (st.mastered) mastered += 1;
      if (st.due) due += 1;
      if (st.wrong > 0) wrong += 1;
    }
    return { id: module_id, count: items.length, mastered: mastered, due: due, wrong: wrong };
  }

  /* 匯出／匯入／重設 */
  function export_obj() {
    var s = store_load();
    return {
      app: 'cn_review',
      v: STORE_VERSION,
      exported_at: new Date().toISOString(),
      settings: s.settings,
      items: s.items,
      daily: s.daily
    };
  }

  function export_text() { return JSON.stringify(export_obj(), null, 2); }

  /* 匯入：驗證結構後合併（同 id 取較大值，避免覆蓋掉更多練習紀錄） */
  function import_text(text, opts) {
    opts = opts || {};
    var obj;
    try { obj = JSON.parse(str(text)); } catch (e) { return { ok: false, error: '不是有效的 JSON 檔' }; }
    if (!obj || typeof obj !== 'object' || is_array(obj)) return { ok: false, error: '檔案內容不是物件' };
    if (!obj.items || typeof obj.items !== 'object' || is_array(obj.items)) return { ok: false, error: '缺少 items 進度資料' };
    var incoming = sanitize_store({ settings: obj.settings, items: obj.items, daily: obj.daily });
    var s = store_load(), k, n = 0;
    for (k in incoming.items) {
      if (!Object.prototype.hasOwnProperty.call(incoming.items, k)) continue;
      if (!item_by_id(k) && !opts.keep_unknown) continue;
      var cur = sanitize_entry(s.items[k]);
      var inc = incoming.items[k];
      s.items[k] = {
        wrong: Math.max(cur.wrong, inc.wrong),
        correct: Math.max(cur.correct, inc.correct),
        hard: cur.hard || inc.hard,
        last_wrong: inc.last_wrong || cur.last_wrong
      };
      n += 1;
    }
    for (k in incoming.daily) {
      if (!Object.prototype.hasOwnProperty.call(incoming.daily, k)) continue;
      var curd = s.daily[k] || { answered: 0, correct: 0 };
      s.daily[k] = {
        answered: Math.max(curd.answered, incoming.daily[k].answered),
        correct: Math.max(curd.correct, incoming.daily[k].correct)
      };
    }
    if (opts.replace_settings && incoming.settings) s.settings = incoming.settings;
    trim_daily(s);
    store_save();
    return { ok: true, count: n, exported_at: str(obj.exported_at) };
  }

  function reset_all(keep_settings) {
    var s = store_load();
    var settings = keep_settings ? s.settings : default_settings();
    _cache = default_store();
    _cache.settings = settings;
    store_save();
    return _cache;
  }

  /* 供測試／切換資料用 */
  function _set_backend(b) { _backend = b || null; _cache = null; }
  function _reset_cache() { _cache = null; }
  function _cache_store() { _backend = null; _cache = null; }

  /* ============================================================
   * 7. 搜尋（瀏覽頁，繁簡皆可）
   * ============================================================ */

  function search_norm(text) {
    var s = str(text).toLowerCase(), out = '', i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (is_cjk(ch)) { out += to_simple(ch); continue; }
      if (/[a-z0-9]/.test(ch)) out += ch;
    }
    return out;
  }

  function search_haystack(item) {
    if (!item) return '';
    var parts = [item.t, item.s, item.q_t, item.q_s, item.w_t, item.w_s, item.src_t, item.src_s, item.src_full_t, item.src_full_s, item.author_t, item.author_s, item.note];
    var lists = ['a_t', 'a_s', 'k_t', 'k_s', 'accept'];
    var i, j, v;
    for (i = 0; i < lists.length; i++) {
      v = item[lists[i]];
      if (is_array(v)) { for (j = 0; j < v.length; j++) parts.push(v[j]); }
      else parts.push(v);
    }
    parts.push(str_field(item, 'a_t'));
    return search_norm(parts.join(' '));
  }

  function search_items(query, items) {
    items = items || all_items();
    var q = search_norm(query);
    if (!q) return items.slice();
    return items.filter(function (it) { return search_haystack(it).indexOf(q) >= 0; });
  }

  /* ============================================================
   * 8. 顯示輔助（題面／加點詞）
   * ============================================================ */

  /* 詞解題面：q_t/q_s 內【…】轉成加點標記；回傳 HTML 片段（文字部分已轉義） */
  var HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function dot_html(item, use_simple) {
    var q = use_simple ? str_field(item, 'q_s') : str_field(item, 'q_t');
    if (!q) q = str_field(item, 'q_t') || str_field(item, 'q_s');
    var out = '', i, ch, inside = false;
    for (i = 0; i < q.length; i++) {
      ch = q.charAt(i);
      if (ch === '【') { out += '<em class="dot">'; inside = true; continue; }
      if (ch === '】') { out += '</em>'; inside = false; continue; }
      out += (HTML_ESC[ch] || ch);
    }
    if (inside) out += '</em>';
    return out;
  }

  /* 取題面純文字（名句／常識） */
  function prompt_text(item, opts) {
    opts = opts || {};
    var use_s = !!opts.simple;
    if (!item) return { ask: '', prompt: '', hint: '' };
    if (item.type === 'mingju') {
      var mp = mingju_pair(item, opts.direction);
      if (opts.flash) {
        var full = sentence(item);
        return { ask: '看句子，回想出處：', prompt: use_s ? full.s : full.t, hint: '' };
      }
      if (opts.direction === 'author') {
        var full2 = sentence(item);
        return {
          ask: '寫出作者與出處：',
          prompt: use_s ? full2.s : full2.t,
          hint: '作者與出處兩欄都答對才算對；出處填書名即可（打完整篇名也算對）（繁簡皆可）'
        };
      }
      return {
        ask: mp.ask,
        prompt: use_s ? mp.prompt_s : mp.prompt_t,
        hint: '標點已給出，共需 ' + count_han(use_s ? mp.answer_s : mp.answer_t) + ' 個漢字（繁簡皆可）'
      };
    }
    if (item.type === 'cijie') {
      return { ask: '解釋加點詞：', html: dot_html(item, use_s), hint: '寫出詞義即可，答中關鍵詞便算對（繁簡皆可）' };
    }
    return {
      ask: '請回答：',
      prompt: use_s ? str_field(item, 'q_s') : str_field(item, 'q_t'),
      hint: '簡短作答即可（繁簡皆可）'
    };
  }

  /* 詳解文字（翻卡背面／結算／瀏覽） */
  function detail(item, opts) {
    opts = opts || {};
    var use_s = !!opts.simple;
    if (!item) return { lines: [], src: '', note: '' };
    if (item.type === 'mingju') {
      var p = sentence(item);
      return { lines: [use_s ? p.s : p.t], src: use_s ? pair(item, 'src').s : pair(item, 'src').t, note: str(item.note) };
    }
    if (item.type === 'cijie') {
      var a = list_pair(item, 'a'), w = pair(item, 'w');
      var lines = (use_s ? a.s : a.t).slice();
      if (!lines.length) lines = [''];
      return { lines: lines, word: use_s ? w.s : w.t, src: use_s ? pair(item, 'src').s : pair(item, 'src').t, note: str(item.note) };
    }
    var c = pair(item, 'a');
    return { lines: [use_s ? c.s : c.t], src: use_s ? pair(item, 'src').s : pair(item, 'src').t, note: str(item.note) };
  }

  /* ============================================================
   * 9. UI 文案用的繁簡補充表（資料 t2s 之外的常用介面用字）
   * ============================================================ */
  var UI_T2S_EXTRA = {
    "並": "并", "亂": "乱", "併": "并", "來": "来", "個": "个", "們": "们", "備": "备", "傳": "传", "僅": "仅", "價": "价",
    "優": "优", "儲": "储", "內": "内", "兩": "两", "冊": "册", "別": "别", "刪": "删", "動": "动", "匯": "汇", "區": "区",
    "參": "参", "問": "问", "啟": "启", "單": "单", "圍": "围", "執": "执", "場": "场", "夠": "够", "學": "学", "實": "实",
    "寫": "写", "將": "将", "尋": "寻", "對": "对", "導": "导", "層": "层", "屬": "属", "師": "师", "幫": "帮", "幾": "几",
    "庫": "库", "張": "张", "強": "强", "後": "后", "從": "从", "復": "复", "恆": "恒", "態": "态", "憶": "忆", "應": "应",
    "捲": "卷", "掛": "挂", "換": "换", "擇": "择", "擊": "击", "據": "据", "擴": "扩", "敗": "败", "數": "数", "於": "于",
    "時": "时", "暫": "暂", "書": "书", "會": "会", "東": "东", "構": "构", "標": "标", "樣": "样", "樹": "树", "機": "机",
    "檔": "档", "欄": "栏", "歷": "历", "歸": "归", "殼": "壳", "沒": "没", "淺": "浅", "測": "测", "準": "准", "溫": "温",
    "漢": "汉", "濾": "滤", "瀏": "浏", "為": "为", "無": "无", "狀": "状", "現": "现", "環": "环", "產": "产", "畫": "画",
    "當": "当", "疇": "畴", "發": "发", "盤": "盘", "確": "确", "禦": "御", "種": "种", "稱": "称", "筆": "笔", "節": "节",
    "範": "范", "簡": "简", "紀": "纪", "約": "约", "純": "纯", "紙": "纸", "級": "级", "組": "组", "結": "结", "絕": "绝",
    "給": "给", "統": "统", "網": "网", "線": "线", "練": "练", "縮": "缩", "總": "总", "繪": "绘", "繼": "继", "續": "续",
    "義": "义", "習": "习", "聽": "听", "與": "与", "蓋": "盖", "處": "处", "號": "号", "補": "补", "裝": "装", "裡": "里",
    "製": "制", "複": "复", "見": "见", "規": "规", "覺": "觉", "覽": "览", "計": "计", "記": "记", "訪": "访", "設": "设",
    "註": "注", "評": "评", "詞": "词", "試": "试", "詩": "诗", "該": "该", "詳": "详", "認": "认", "語": "语", "誠": "诚",
    "誤": "误", "說": "说", "誰": "谁", "課": "课", "請": "请", "證": "证", "識": "识", "護": "护", "讀": "读", "讓": "让",
    "貼": "贴", "資": "资", "賴": "赖", "較": "较", "載": "载", "輔": "辅", "輪": "轮", "輯": "辑", "輸": "输", "轉": "转",
    "這": "这", "進": "进", "過": "过", "選": "选", "還": "还", "邊": "边", "邏": "逻", "釋": "释", "鈕": "钮", "錄": "录",
    "錯": "错", "鍵": "键", "鐘": "钟", "長": "长", "閃": "闪", "閉": "闭", "開": "开", "間": "间", "關": "关", "隊": "队",
    "階": "阶", "隨": "随", "險": "险", "隱": "隐", "雙": "双", "離": "离", "靜": "静", "鞏": "巩", "響": "响", "頁": "页",
    "項": "项", "順": "顺", "預": "预", "題": "题", "類": "类", "顧": "顾", "顯": "显", "驗": "验", "體": "体", "麼": "么",
    "點": "点"
  };

  /* ============================================================
   * 10. 對外介面
   * ============================================================ */
  var api = {
    /* 常數 */
    STORE_KEY: STORE_KEY,
    MODULES: MODULES,
    FONTS: FONTS,
    THEMES: THEMES,
    SCRIPTS: SCRIPTS,
    OFFSET_WRONG: OFFSET_WRONG,
    OFFSET_CONSOLIDATE: OFFSET_CONSOLIDATE,
    OFFSET_FLASH: OFFSET_FLASH,
    UI_T2S_EXTRA: UI_T2S_EXTRA,

    /* 小工具 */
    is_cjk: is_cjk,
    make_rng: make_rng,
    shuffle: shuffle,
    uniq: uniq,
    clamp: clamp,

    /* 資料 */
    dataset: dataset,
    meta: meta,
    items: all_items,
    item: item_by_id,
    modules: function () { return MODULES.slice(); },
    module: module_by_id,
    items_for_module: items_for_module,
    units_for_module: units_for_module,
    items_for: items_for,
    filter_by_units: filter_by_units,
    filter_by_scope: filter_by_scope,
    item_seg: item_seg,
    item_exam: item_exam,
    has_scope: has_scope_field,
    scope_label: scope_label,
    scope_label_seg: scope_label_seg,
    scope_label_exam: scope_label_exam,
    scope_values: scope_values,
    seg_rows: seg_rows,
    exam_rows: exam_rows,
    norm_scope_value: norm_scope_value,
    str_field: str_field,
    list_field: list_field,
    pair: pair,
    list_pair: list_pair,
    sentence: sentence,
    author_pair: author_pair,
    source_pair: source_pair,
    source_full_pair: source_full_pair,
    author_variant: author_variant,
    join_author_src: join_author_src,
    is_anon_text: is_anon_text,

    /* 文字 */
    t2s_map: t2s_map,
    to_simple: to_simple,
    norm: norm,
    norm_answer: norm_answer,
    strip_wrapper: strip_wrapper,
    count_han: count_han,

    /* 判分 */
    split_mingju: split_mingju,
    mingju_pair: mingju_pair,
    cijie_data: cijie_data,
    changshi_data: changshi_data,
    cs_keywords: cs_keywords,
    grade_text: grade_text,
    grade_author: grade_author,
    norm_match: norm_match,
    expected_text: expected_text,
    answer_variants: answer_variants,

    /* 選擇題 */
    build_options: build_options,
    option_key: option_key,
    answer_shape: answer_shape,
    shape_family: shape_family,
    item_group: item_group,

    /* 隊列 */
    create_session: create_session,
    session_current: session_current,
    session_current_entry: session_current_entry,
    session_remaining: session_remaining,
    session_progress: session_progress,
    session_answer: session_answer,
    session_override: session_override,
    session_reshuffle: session_reshuffle,
    session_result: session_result,
    session_state: session_state,
    wrong_offset: wrong_offset,
    format_duration: format_duration,

    /* 儲存 */
    settings: settings_get,
    patch_settings: settings_patch,
    default_settings: default_settings,
    units_setting: settings_units,
    set_units_setting: settings_set_units,
    item_stats: item_stats,
    record: record_answer,
    record_override: record_override,
    toggle_hard: toggle_hard,
    set_hard: set_hard,
    clear_wrong: clear_wrong,
    all_stats: all_stats,
    summary: summary,
    module_summary: module_summary,
    export_obj: export_obj,
    export_text: export_text,
    import_text: import_text,
    reset_all: reset_all,
    save: store_save,
    load: store_load,
    date_key: date_key,

    /* 搜尋 */
    search_norm: search_norm,
    search_haystack: search_haystack,
    search_items: search_items,

    /* 顯示輔助 */
    dot_html: dot_html,
    prompt_text: prompt_text,
    detail: detail,

    /* 測試用 */
    _set_backend: _set_backend,
    _reset_cache: _reset_cache,
    _cache_store: _cache_store
  };

  root.CNCore = api;
  if (typeof module !== 'undefined' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
