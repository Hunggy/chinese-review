/* js/ui.js —— 渲染與事件（唯一的 DOM 層）
 * 依 docs/spec.md §5 的 DOM 契約實作；class／id／data-action 不可改名。
 */
(function () {
  'use strict';

  var C = window.CNCore;

  /* ============================================================
   * 0. 狀態與小工具
   * ============================================================ */

  var S = {
    screen: 'home',
    module: 'mingju',
    settings: null,
    session: null,        /* core session */
    phase: 'asking',      /* asking | answered | flash-front | flash-back | review */
    live_phase: 'asking', /* 離開回顧後要還原的狀態 */
    last: null,           /* 最近一筆作答紀錄 */
    options: null,        /* 當前選擇題選項（含 item_id） */
    review: null,         /* {cursor} */
    result: null,
    browse: { q: '', units: ['all'], open: {} },
    draft: '',            /* 未提交的輸入 */
    dual_author: '',      /* 作者・出處模式的兩欄草稿 */
    dual_source: '',
    composing: false,
    timer: null,          /* 速通自動跳題 */
    overlay_ok: null
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function h(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 動態文案的繁簡轉換（靜態模板由 apply_script 走訪處理） */
  function T(text) {
    return S.settings && S.settings.script === 's' ? C.to_simple(String(text)) : String(text);
  }

  function is_simple() { return S.settings && S.settings.script === 's'; }

  function pct(n) { return Math.round(n * 100) + '%'; }

  /* ============================================================
   * 1. 偏好（主題／字形／字號）
   * ============================================================ */

  function apply_prefs() {
    var el = document.documentElement;
    el.setAttribute('data-theme', S.settings.theme);
    el.setAttribute('data-script', S.settings.script);
    el.setAttribute('data-font', S.settings.font);
    el.setAttribute('lang', S.settings.script === 's' ? 'zh-Hans' : 'zh-Hant');
    var meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', S.settings.theme === 'dark' ? '#141210' : '#f7f2e8');
  }

  function set_setting(patch) {
    S.settings = C.patch_settings(patch);
    apply_prefs();
  }

  function set_script(v) {
    if (C.SCRIPTS.indexOf(v) < 0) return;
    set_setting({ script: v });
    render();
  }

  function set_theme(v) {
    if (C.THEMES.indexOf(v) < 0) return;
    set_setting({ theme: v });
    render();
  }

  function set_font(v) {
    if (C.FONTS.indexOf(v) < 0) return;
    set_setting({ font: v });
    render();
  }

  function step_font(delta) {
    var i = C.FONTS.indexOf(S.settings.font);
    if (i < 0) i = 1;
    i = C.clamp(i + delta, 0, C.FONTS.length - 1);
    set_font(C.FONTS[i]);
  }

  /* 把畫面上所有文字節點逐字轉成簡體（data-raw 子樹為資料原文，跳過） */
  function apply_script(root) {
    if (!is_simple() || !root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var v = node.nodeValue;
        if (!v || !/[\u3400-\u4DBF\u4E00-\u9FFF]/.test(v)) return NodeFilter.FILTER_REJECT;
        var p = node.parentNode;
        while (p && p.nodeType === 1) {
          if (p.hasAttribute('data-raw')) return NodeFilter.FILTER_REJECT;
          var tag = p.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'INPUT' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node, list = [];
    while ((node = walker.nextNode())) list.push(node);
    for (var i = 0; i < list.length; i++) {
      var cv = C.to_simple(list[i].nodeValue);
      if (cv !== list[i].nodeValue) list[i].nodeValue = cv;
    }
    /* 屬性文案（title / placeholder / aria-label） */
    $$('[title],[placeholder],[aria-label]', root).forEach(function (el) {
      ['title', 'placeholder', 'aria-label'].forEach(function (attr) {
        var v = el.getAttribute(attr);
        if (v && /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(v)) el.setAttribute(attr, C.to_simple(v));
      });
    });
  }

  /* ============================================================
   * 2. Toast 與 overlay
   * ============================================================ */

  var toast_timer = null;
  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = T(msg);
    t.classList.add('is-show');
    if (toast_timer) clearTimeout(toast_timer);
    toast_timer = setTimeout(function () { t.classList.remove('is-show'); }, 1800);
  }

  function overlay_open() { return $('#overlay') && !$('#overlay').hidden; }

  function open_overlay(html, on_ok) {
    var o = $('#overlay');
    o.innerHTML = '<div class="overlay-card">' + html + '</div>';
    o.hidden = false;
    S.overlay_ok = on_ok || null;
    apply_script(o);
  }

  function close_overlay() {
    var o = $('#overlay');
    o.hidden = true;
    o.innerHTML = '';
    S.overlay_ok = null;
  }

  function confirm_overlay(opts) {
    var danger = opts.danger ? ' danger' : '';
    var ok_label = h(opts.ok_label || '確定');
    var cancel_label = h(opts.cancel_label || '取消');
    open_overlay(
      '<h3 class="overlay-title">' + h(opts.title) + '</h3>' +
      (opts.text ? '<p class="overlay-text">' + h(opts.text) + '</p>' : '') +
      '<div class="overlay-actions">' +
      '<button class="btn btn-ghost" type="button" data-action="overlay-cancel">' + cancel_label + '</button>' +
      '<button class="btn btn-primary' + danger + '" type="button" data-action="overlay-ok">' + ok_label + '</button>' +
      '</div>',
      opts.on_ok
    );
  }

  /* ============================================================
   * 3. Appbar
   * ============================================================ */

  function appbar_html() {
    var show_back = S.screen !== 'home';
    var sub = '練習 · 自動判分 · 繁簡皆可';
    return '' +
      '<header class="appbar">' +
        '<button class="appbar-back" type="button" data-action="back" aria-label="返回"' + (show_back ? '' : ' hidden') + '>‹</button>' +
        '<div class="appbar-title">' +
          '<div class="appbar-title-main">中文溫習</div>' +
          '<div class="appbar-title-sub">' + sub + '</div>' +
        '</div>' +
        '<div class="appbar-tools">' +
          '<button class="tool" type="button" data-action="toggle-script" title="切換繁簡">' + (is_simple() ? '簡' : '繁') + '</button>' +
          '<button class="tool" type="button" data-action="toggle-theme" title="' + (S.settings.theme === 'dark' ? '淺色模式' : '深色模式') + '">' + (S.settings.theme === 'dark' ? '☀' : '🌙') + '</button>' +
          '<button class="tool" type="button" data-action="font-dec" title="縮小字號">A-</button>' +
          '<button class="tool" type="button" data-action="font-inc" title="放大字號">A+</button>' +
        '</div>' +
      '</header>';
  }

  /* ============================================================
   * 4. 首頁
   * ============================================================ */

  function home_html() {
    var sm = C.summary();
    var cards = C.modules().map(function (m) {
      var ms = C.module_summary(m.id);
      var p = ms.count ? Math.round(ms.mastered / ms.count * 100) : 0;
      return '' +
        '<button class="module-card" type="button" data-module="' + m.id + '">' +
          '<span class="module-card-no">' + h(m.no) + '</span>' +
          '<span class="module-card-body">' +
            '<span class="module-card-name">' + h(m.name) + '</span>' +
            '<span class="module-card-desc">' + h(m.desc) + '</span>' +
            '<span class="module-card-meta">共 ' + ms.count + ' 題 · 已掌握 ' + ms.mastered + '</span>' +
            '<span class="module-progress"><i style="width:' + p + '%"></i></span>' +
          '</span>' +
          '<span class="module-card-go">›</span>' +
        '</button>';
    }).join('');

    return '' +
      '<main class="screen" data-screen="home">' +
        '<section class="hero">' +
          '<p class="hero-kicker">文言 · 默寫 · 詞解</p>' +
          '<h1 class="hero-title">中文溫習</h1>' +
          '<p class="hero-sub">每天十分鐘，把名句與詞解記牢。</p>' +
          '<div class="hero-stats">' +
            '<div class="stat"><span class="stat-value">' + sm.today_answered + '</span><span class="stat-label">今日已答</span></div>' +
            '<div class="stat"><span class="stat-value">' + pct(sm.rate) + '</span><span class="stat-label">正確率</span></div>' +
            '<div class="stat"><span class="stat-value">' + sm.due + '</span><span class="stat-label">待複習</span></div>' +
          '</div>' +
        '</section>' +
        '<div class="module-grid">' + cards + '</div>' +
        '<div class="quick-row">' +
          '<button class="quick" type="button" data-action="open-stats">📊 錯題統計</button>' +
          '<button class="quick" type="button" data-action="open-browse">📖 瀏覽</button>' +
          '<button class="quick" type="button" data-action="open-settings">⚙️ 設定</button>' +
        '</div>' +
        '<footer class="appfoot">資料只存在你的瀏覽器 · 可離線使用</footer>' +
      '</main>';
  }

  /* ============================================================
   * 5. 練習設定
   * ============================================================ */

  function seg_html(field, options, current) {
    return '<div class="segmented" data-field="' + field + '">' + options.map(function (o) {
      var on = o.value === current;
      return '<button class="seg' + (on ? ' is-on' : '') + '" type="button" data-value="' + h(o.value) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        h(o.label) + (o.sub ? '<span class="seg-sub">' + h(o.sub) + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function chips_html(field, rows, selected) {
    var sel = selected && selected.length ? selected : ['all'];
    var all_on = sel.indexOf('all') >= 0;
    var html = '<div class="chips" data-field="' + field + '">' +
      '<button class="chip' + (all_on ? ' is-on' : '') + '" type="button" data-value="all" aria-pressed="' + (all_on ? 'true' : 'false') + '">全部</button>';
    rows.forEach(function (u) {
      var on = !all_on && sel.indexOf(u.id) >= 0;
      var count = (u.count === undefined || u.count === null) ? '' : '<span class="chip-count">' + u.count + '</span>';
      html += '<button class="chip' + (on ? ' is-on' : '') + '" type="button" data-value="' + h(u.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        h(u.name) + count + '</button>';
    });
    return html + '</div>';
  }

  /* 段／次 chips 的資料（單選：'all' 或數字字串） */
  function scope_chips_html(field, rows, current) {
    var v = C.norm_scope_value(current);
    return chips_html(field, rows.map(function (r) {
      return { id: String(r.value), name: r.label, count: null };
    }), [v]);
  }

  /* 目前模組的段／次狀態：有效值（不在資料內會退回 'all'）與過濾後題目 */
  function scope_state() {
    var module_items = C.items_for_module(S.module);
    var segs = C.seg_rows(module_items);
    var seg = C.norm_scope_value(S.settings.seg);
    var seg_ids = segs.map(function (r) { return String(r.value); });
    if (seg !== 'all' && seg_ids.indexOf(seg) < 0) seg = 'all';

    var exams = C.exam_rows(module_items, seg);
    var exam = C.norm_scope_value(S.settings.exam);
    var exam_ids = exams.map(function (r) { return String(r.value); });
    if (exam !== 'all' && exam_ids.indexOf(exam) < 0) exam = 'all';

    var items = C.items_for(S.module, C.units_setting(S.module), { seg: seg, exam: exam });
    return {
      module_items: module_items,
      segs: segs,
      seg: seg,
      exams: exams,
      exam: exam,
      items: items,
      single_seg: segs.length <= 1,
      single_exam: exams.length <= 1
    };
  }

  function setup_html() {
    var m = C.module(S.module);
    var units = C.units_setting(S.module);
    var st = scope_state();
    var scope = st.items;
    var has_mingju = st.module_items.some(function (it) { return it.type === 'mingju'; });
    var s = S.settings;

    var desc = {
      mingju: '標點由系統給出，只需默寫漢字；繁簡皆可。',
      cijie: '解釋句中加點詞，答中關鍵詞即算對。',
      changshi: '文學常識與出處，簡短作答即可。',
      mixed: '名句、詞解、常識混合出題。'
    }[S.module] || '';

    /* 段／次：只有一段（或一次）時整個區塊隱藏，避免只有「全部」可選 */
    var seg_block = st.single_seg ? '' :
      '<div class="setup-block" data-block="segments">' +
        '<h3 class="setup-label">段</h3>' +
        scope_chips_html('segments', st.segs, st.seg) +
      '</div>';
    var exam_block = st.single_exam ? '' :
      '<div class="setup-block" data-block="exams">' +
        '<h3 class="setup-label">次大測</h3>' +
        scope_chips_html('exams', st.exams, st.exam) +
      '</div>';

    return '' +
      '<main class="screen" data-screen="setup">' +
        '<section class="setup">' +
          '<h2 class="setup-title">' + h(m.name) + '</h2>' +
          '<p class="setup-desc">' + h(desc) + '</p>' +

          seg_block +
          exam_block +

          '<div class="setup-block">' +
            '<h3 class="setup-label">範圍</h3>' +
            chips_html('units', C.units_for_module(S.module), units) +
          '</div>' +

          '<div class="setup-block">' +
            '<h3 class="setup-label">模式</h3>' +
            seg_html('mode', [
              { value: 'practice', label: '練習', sub: '錯題會重現' },
              { value: 'speed', label: '⚡ 速通', sub: '一次刷完' },
              { value: 'flash', label: '🃏 翻卡', sub: '自己評核' }
            ], s.mode) +
          '</div>' +

          '<div class="setup-block" data-block="question"' + (s.mode === 'flash' ? ' hidden' : '') + '>' +
            '<h3 class="setup-label">作答方式</h3>' +
            seg_html('question', [
              { value: 'type', label: '手打' },
              { value: 'mc', label: '選擇題' }
            ], s.question) +
          '</div>' +

          '<div class="setup-block" data-block="mingju-direction"' + (has_mingju && s.mode !== 'flash' ? '' : ' hidden') + '>' +
            '<h3 class="setup-label">默寫方向</h3>' +
            seg_html('direction', [
              { value: 'hs', label: '給上默下' },
              { value: 'sh', label: '給下默上' },
              { value: 'author', label: '作者・出處' }
            ], s.direction) +
          '</div>' +

          '<div class="setup-block">' +
            '<h3 class="setup-label">順序</h3>' +
            seg_html('order', [
              { value: 'shuffle', label: '亂序' },
              { value: 'original', label: '原順序' }
            ], s.order) +
          '</div>' +

          '<button class="btn btn-primary start-btn" type="button" data-action="start">開始練習（' + scope.length + ' 題）</button>' +
        '</section>' +
      '</main>';
  }

  /* ============================================================
   * 6. 答題
   * ============================================================ */

  function cur_item() { return S.session ? C.session_current(S.session) : null; }

  function view() {
    var s = S.session;
    if (!s) return null;
    if (S.phase === 'review' && S.review) {
      var rec = s.history[S.review.cursor];
      return rec ? { item: C.item(rec.id), state: 'review', rec: rec } : null;
    }
    if (S.phase === 'answered' && S.last) {
      return { item: C.item(S.last.id), state: 'answered', rec: S.last };
    }
    var it = cur_item();
    return it ? { item: it, state: S.phase, rec: null } : null;
  }

  function ensure_options(item) {
    if (!item || S.settings.question !== 'mc') return null;
    if (S.session && S.session.mode === 'flash') return null;
    if (!S.options || S.options.item_id !== item.id) {
      var built = C.build_options(item, C.items(), { direction: S.session ? S.session.direction : S.settings.direction });
      built.item_id = item.id;
      S.options = built;
    }
    return S.options;
  }

  function prompt_block(item, dir) {
    var sm = is_simple();
    if (item.type === 'mingju') {
      if (dir === 'author') {
        var full = C.sentence(item);
        return {
          ask: '寫出作者與出處：',
          prompt: sm ? full.s : full.t,
          hint: '作者與出處兩欄都答對才算對（繁簡皆可）'
        };
      }
      var mp = C.mingju_pair(item, dir);
      return {
        ask: mp.ask,
        prompt: sm ? mp.prompt_s : mp.prompt_t,
        hint: '標點已給出，共需 ' + C.count_han(sm ? mp.answer_s : mp.answer_t) + ' 個漢字（繁簡皆可）'
      };
    }
    if (item.type === 'cijie') {
      return { ask: '解釋加點詞：', html: C.dot_html(item, sm), hint: '寫出詞義即可，答中關鍵詞便算對（繁簡皆可）' };
    }
    return {
      ask: '請回答：',
      prompt: sm ? C.str_field(item, 'q_s') : C.str_field(item, 'q_t'),
      hint: '簡短作答即可（繁簡皆可）'
    };
  }

  function answer_box_html(item, dir, rec) {
    var sm = is_simple();
    var line = '', src = '', note = '', alts = [], pre = '';

    if (item.type === 'mingju') {
      if (dir === 'author') {
        /* 作者・出處模式：顯示整句 + 「作者《出處》」 */
        var full = C.sentence(item);
        line = sm ? full.s : full.t;
        var av = C.author_variant(item);
        src = sm ? av.s : av.t;
      } else {
        var mp = C.mingju_pair(item, dir);
        line = sm ? mp.answer_s : mp.answer_t;
        var sc = C.pair(item, 'src');
        src = sm ? sc.s : sc.t;
      }
    } else if (item.type === 'cijie') {
      var a = C.list_pair(item, 'a');
      var w = C.pair(item, 'w');
      var lines = sm ? a.s : a.t;
      if (!lines.length) lines = [''];
      pre = (sm ? w.s : w.t);
      line = lines[0];
      alts = lines.slice(1);
      var sc2 = C.pair(item, 'src');
      src = sm ? sc2.s : sc2.t;
    } else {
      var ans = C.pair(item, 'a');
      line = sm ? ans.s : ans.t;
      var sc3 = C.pair(item, 'src');
      src = sm ? sc3.s : sc3.t;
    }
    note = item.note ? String(item.note) : '';

    var verdict = '';
    if (rec) {
      var words = {
        mingju: ['✓ 默寫正確', '✗ 默寫有誤'],
        cijie: ['✓ 詞義正確', '✗ 再記一次'],
        changshi: ['✓ 回答正確', '✗ 再記一次']
      }[item.type] || ['✓ 正確', '✗ 再記一次'];
      if (rec.dual) words = ['✓ 作者出處正確', '✗ 作者或出處有誤'];
      verdict = '<div class="verdict ' + (rec.ok ? 'is-ok' : 'is-bad') + '" role="status">' + h(rec.ok ? words[0] : words[1]) + '</div>';
    }

    var yours = '';
    if (rec) {
      if (rec.mc) {
        var chosen = rec.mc.options[rec.mc.chosen];
        var ctext = chosen ? (sm ? chosen.s : chosen.t) : '（未作答）';
        yours = '<div class="your-answer">你選的是：<span data-raw>' + h(ctext) + '</span></div>';
      } else if (rec.dual) {
        yours = '';   /* 作者・出處：逐欄顯示於 .dual-result */
      } else if (rec.gaveup) {
        yours = '<div class="your-answer">（直接看了答案）</div>';
      } else if (rec.user) {
        yours = '<div class="your-answer">你的答案：<span data-raw>' + h(rec.user) + '</span></div>';
      } else {
        yours = '<div class="your-answer">（未作答）</div>';
      }
    }

    var override = (rec && !rec.ok && !rec.mc && rec.mode !== 'flash')
      ? '<button class="btn btn-ghost" type="button" data-action="override">意思對了，算我對</button>' : '';

    return '' +
      verdict +
      '<div class="answer-box">' +
        '<div class="answer-line han" data-raw>' + (pre ? '<span class="answer-word">' + h(pre) + '</span>：' : '') + h(line) + '</div>' +
        (alts.length ? alts.map(function (t) {
          return '<div class="answer-alt" data-raw>' + h(t) + '</div>';
        }).join('') : '') +
        (src ? '<div class="answer-src" data-raw>' + h(src) + '</div>' : '') +
        (note ? '<div class="answer-note">' + h(note) + '</div>' : '') +
        yours +
        override +
      '</div>';
  }

  /* 作者・出處模式：兩個輸入欄（spec §5.5） */
  function dual_form_html() {
    return '' +
      '<form class="answer-form answer-form--dual" data-mode="author" autocomplete="off">' +
        '<label class="dual-field">' +
          '<span class="field-label">' + h(T('作者')) + '</span>' +
          '<input class="answer-input" id="authorInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
          'placeholder="' + h(T('例如：屈原')) + '" value="' + h(S.dual_author) + '" aria-label="' + h(T('作者')) + '" />' +
        '</label>' +
        '<label class="dual-field">' +
          '<span class="field-label">' + h(T('出處')) + '</span>' +
          '<input class="answer-input" id="sourceInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
          'placeholder="' + h(T('例如：《離騷》')) + '" value="' + h(S.dual_source) + '" aria-label="' + h(T('出處')) + '" />' +
        '</label>' +
        '<button class="btn btn-primary" type="submit" data-action="submit">提交</button>' +
      '</form>';
  }

  /* 作者・出處答後逐欄判分（✓/✗ ＋「你寫：…」） */
  function dual_result_html(item, rec) {
    if (!item || item.type !== 'mingju') return '';
    var sm = is_simple();
    var ea = C.author_pair(item), es = C.source_pair(item);
    var exp_a = sm ? ea.s : ea.t, exp_s = sm ? es.s : es.t;
    var d = rec && rec.dual ? rec.dual : null;
    var gave_up = !!(rec && rec.gaveup);

    function row(label, expected, ok, yours) {
      var cls = 'dual-result-row' + (ok === true ? ' is-ok' : (ok === false ? ' is-bad' : ''));
      return '<div class="' + cls + '">' +
        '<span class="field-label">' + h(T(label)) + '</span>' +
        '<span class="dual-answer han" data-raw>' + h(expected) + '</span>' +
        (ok === null ? '' : '<span class="dual-mark">' + (ok ? '✓' : '✗') + '</span>') +
        (ok === false && yours ? '<span class="dual-yours">' + h(T('你寫：')) + '<span data-raw>' + h(yours) + '</span></span>' : '') +
      '</div>';
    }

    var a_ok = d ? !!d.author_ok : (gave_up ? false : null);
    var s_ok = d ? !!d.source_ok : (gave_up ? false : null);
    return '<div class="dual-result">' +
      row('作者', exp_a, a_ok, d ? d.author : '') +
      row('出處', exp_s, s_ok, d ? d.source : '') +
    '</div>';
  }

  function options_html(item, state, rec) {
    var o = ensure_options(item);
    if (!o) return '';
    var sm = is_simple();
    var answered = state === 'answered' || state === 'review';
    if (!rec) rec = S.last;
    var chosen = (rec && rec.mc) ? rec.mc.chosen : -1;
    var correct_index = (rec && rec.mc) ? rec.mc.correct_index : o.correct_index;
    var opts = (rec && rec.mc) ? rec.mc.options : o.options;

    return '<div class="options" data-mode="mc">' + opts.map(function (opt, i) {
      var cls = 'option';
      if (answered) {
        if (i === correct_index) cls += ' is-correct';
        else if (i === chosen) cls += ' is-wrong';
      }
      return '<button class="' + cls + '" type="button" data-index="' + i + '"' + (answered ? ' disabled' : '') + '>' +
        '<span class="option-key">' + C.option_key(i) + '</span>' +
        '<span class="option-text han" data-raw>' + h(sm ? opt.s : opt.t) + '</span>' +
        '</button>';
    }).join('') + '</div>';
  }

  function card_controls_html(state) {
    var front = state === 'flash-front';
    return '' +
      '<div class="card-controls"' + (S.session.mode === 'flash' ? '' : ' hidden') + '>' +
        '<button class="btn btn-ghost" type="button" data-action="flip"' + (state === 'flash-front' ? '' : ' hidden') + '>翻面</button>' +
        '<button class="btn btn-ghost" type="button" data-action="again"' + (front ? ' disabled' : '') + '>✗ 還沒記住</button>' +
        '<button class="btn btn-primary" type="button" data-action="known"' + (front ? ' disabled' : '') + '>✓ 記住了</button>' +
      '</div>';
  }

  function quiz_html() {
    var s = S.session;
    if (!s) return '<main class="screen" data-screen="quiz"><p class="empty">沒有進行中的練習。</p></main>';
    var v = view();
    if (!v) return '<main class="screen" data-screen="quiz"><p class="empty">本輪已完成。</p></main>';

    var item = v.item, state = v.state, rec = v.rec;
    var mode = s.mode;
    var dir = rec ? rec.direction : s.direction;
    var is_flash = mode === 'flash';
    /* 作者・出處模式：翻卡照舊看句子回想出處（不受 direction 影響） */
    var pdir = (!is_flash && dir === 'author') ? 'author' : (dir === 'sh' ? 'sh' : 'hs');
    var pb = prompt_block(item, pdir);
    var answered = state === 'answered' || state === 'review';
    var dual_mode = pdir === 'author' && item.type === 'mingju' && S.settings.question === 'type';

    var ask_label = state === 'flash-front' ? T(pb.ask) : pb.ask;
    var prompt_node = pb.html !== undefined
      ? '<div class="q-prompt han" data-raw>' + pb.html + '</div>'
      : '<div class="q-prompt han" data-raw>' + h(pb.prompt) + '</div>';
    var hint_node = (is_flash && state === 'flash-front')
      ? '' : '<p class="q-hint"' + (is_flash ? '' : '') + '>' + h(pb.hint || '') + '</p>';

    var can_input = (mode === 'practice' || mode === 'speed') && !answered;
    var input_node = '';
    if (can_input && dual_mode) {
      input_node = dual_form_html();
    } else if (can_input && S.settings.question === 'type') {
      input_node = '<form class="answer-form" autocomplete="off">' +
          '<input class="answer-input" id="answerInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
          'placeholder="' + h(T('在此輸入答案')) + '" aria-label="' + h(T('答案輸入')) + '" />' +
          '<button class="btn btn-primary" type="submit" data-action="submit">提交</button>' +
        '</form>';
    }

    var mc_node = (!is_flash && S.settings.question === 'mc') ? options_html(item, state, rec) : '';
    var dual_node = (pdir === 'author' && item.type === 'mingju' && !is_flash && (answered || state === 'flash-back') && !(rec && rec.mc))
      ? dual_result_html(item, rec) : '';

    var review_banner = state === 'review' ? '<div class="review-banner">回顧中 · 按 → 返回</div>' : '';

    var progress = Math.round(C.session_progress(s) * 100);
    var ok_count = 0, i;
    for (i = 0; i < s.history.length; i++) { if (s.history[i].ok) ok_count += 1; }
    var bad_count = s.history.length - ok_count;

    var pos_text;
    if (state === 'review') {
      pos_text = '回顧 ' + (S.review.cursor + 1) + ' / ' + s.history.length;
    } else {
      pos_text = '第 ' + Math.min(s.completed + (state === 'answered' ? 0 : 1), s.total) + ' / ' + s.total + ' 題';
    }

    var hard_state = C.item_stats(item.id).hard;
    var next_label = state === 'review' ? '返回 ›' : '下一題 ›';

    return '' +
      '<main class="screen" data-screen="quiz">' +
        '<section class="quiz">' +
          '<div class="quiz-head">' +
            '<span class="quiz-progress-text">' + h(pos_text) + '</span>' +
            '<span class="quiz-score"><span class="is-ok">✓ ' + ok_count + '</span><span class="is-bad">✗ ' + bad_count + '</span></span>' +
            '<button class="btn-mini" type="button" data-action="reshuffle"' + (state === 'review' ? ' hidden' : '') + '>重新打亂</button>' +
          '</div>' +
          '<div class="progress"><i style="width:' + progress + '%"></i></div>' +

          '<article class="qcard" data-qtype="' + h(item.type) + '" data-state="' + h(state) + '">' +
            '<p class="q-ask">' + h(ask_label) + '</p>' +
            prompt_node +
            hint_node +
            input_node +
            dual_node +
            mc_node +
            card_controls_html(state) +
            (answered || state === 'flash-back' ? answer_box_html(item, pdir, state === 'flash-back' ? null : rec) : '') +
            review_banner +
          '</article>' +

          '<div class="quiz-actions">' +
            '<button class="btn-mini" type="button" data-action="hard" aria-pressed="' + (hard_state ? 'true' : 'false') + '"' + (state === 'review' ? ' hidden' : '') + '>⭐ 標記</button>' +
            '<button class="btn-mini" type="button" data-action="giveup"' + (state === 'asking' ? '' : ' hidden') + '>看答案</button>' +
            '<button class="btn btn-primary" type="button" data-action="next"' + (state === 'asking' || state === 'flash-front' || state === 'flash-back' ? ' hidden' : '') + '>' + h(next_label) + '</button>' +
            '<button class="btn-mini" type="button" data-action="prev-review"' + (s.history.length ? '' : ' hidden') + '>‹ 回顧</button>' +
          '</div>' +
        '</section>' +
      '</main>';
  }

  /* ============================================================
   * 7. 結算
   * ============================================================ */

  function result_html() {
    var r = S.result;
    if (!r) return home_html();
    var wrong_rows = r.wrong_ids.map(function (id) {
      var it = C.item(id);
      if (!it) return '';
      var per = r.per_item[id] || {};
      var pb = prompt_block(it, S.session ? S.session.direction : 'hs');
      var qline = pb.html !== undefined ? C.dot_html(it, is_simple()) : h(pb.prompt);
      var det = C.detail(it, { simple: is_simple() });
      var meta = [];
      if (per.last_user) meta.push('你的答案：' + per.last_user);
      if (det.src) meta.push(det.src);
      return '' +
        '<article class="wrong-item">' +
          '<p class="wrong-q">' + h(pb.ask) + '<span data-raw>' + qline + '</span></p>' +
          '<p class="wrong-a han" data-raw>' + h(det.lines.join('／')) + '</p>' +
          '<p class="wrong-meta">' + h(meta.join('　·　')) + '</p>' +
        '</article>';
    }).join('');

    return '' +
      '<main class="screen" data-screen="result">' +
        '<section class="result">' +
          '<div class="result-hero">' +
            '<div class="result-rate">' + pct(r.rate) + '<small>正確率</small></div>' +
            '<p class="result-sub">' + r.total_items + ' 題 · 答對 ' + r.correct_items + ' · 答錯 ' + r.wrong_items + '</p>' +
          '</div>' +
          '<div class="result-stats">' +
            '<div class="stat"><span class="stat-value">' + r.correct_items + '</span><span class="stat-label">答對</span></div>' +
            '<div class="stat"><span class="stat-value">' + r.wrong_items + '</span><span class="stat-label">答錯</span></div>' +
            '<div class="stat"><span class="stat-value">' + C.format_duration(r.duration_ms) + '</span><span class="stat-label">用時</span></div>' +
          '</div>' +
          '<div class="result-actions">' +
            '<button class="btn btn-primary" type="button" data-action="again">再來一輪</button>' +
            '<button class="btn btn-ghost" type="button" data-action="retry-wrong"' + (r.wrong_ids.length ? '' : ' disabled') + '>只練錯題</button>' +
            '<button class="btn btn-ghost" type="button" data-action="home">回首頁</button>' +
          '</div>' +
          (wrong_rows ? '<div class="wrong-list">' + wrong_rows + '</div>' : '<p class="empty">全部答對，做得好。</p>') +
        '</section>' +
      '</main>';
  }

  /* ============================================================
   * 8. 瀏覽
   * ============================================================ */

  function browse_items() {
    var scope = C.filter_by_units(C.items(), S.browse.units);
    return C.search_items(S.browse.q, scope);
  }

  /* 回傳已轉義的 HTML：詞解含加點標記，其餘純文字先 escape */
  function browse_term(it) {
    var sm = is_simple();
    if (it.type === 'cijie') {
      var w = C.pair(it, 'w');
      return h(sm ? w.s : w.t) + '　' + C.dot_html(it, sm);
    }
    return h(sm ? C.str_field(it, 's') : C.str_field(it, 't'));
  }

  function browse_sub(it) {
    var sm = is_simple();
    if (it.type === 'cijie') {
      var a = C.list_pair(it, 'a');
      return (sm ? a.s : a.t).join('／');
    }
    var src = C.pair(it, 'src');
    return sm ? src.s : src.t;
  }

  function type_label(t) {
    return { mingju: '名句', cijie: '詞解', changshi: '常識' }[t] || '';
  }

  function browse_body(it) {
    var sm = is_simple();
    var det = C.detail(it, { simple: sm });
    var rows = [];
    var sc = C.pair(it, 'src');
    var src = sm ? sc.s : sc.t;
    if (it.type === 'mingju') {
      rows.push('<div class="browse-full han" data-raw>' + h(sm ? C.str_field(it, 's') : C.str_field(it, 't')) + '</div>');
      if (src) rows.push('<div class="browse-src" data-raw>' + h(src) + '</div>');
    } else if (it.type === 'cijie') {
      var w = C.pair(it, 'w');
      rows.push('<div class="browse-full" data-raw>' + h((sm ? w.s : w.t) + '：' + det.lines.join('／')) + '</div>');
      if (src) rows.push('<div class="browse-src" data-raw>' + h(src) + '</div>');
    } else {
      rows.push('<div class="browse-full" data-raw>' + h(det.lines.join('／')) + '</div>');
      if (src) rows.push('<div class="browse-src" data-raw>' + h(src) + '</div>');
    }
    if (it.note) rows.push('<div class="browse-note">' + h(it.note) + '</div>');
    var sl = C.scope_label(it);
    rows.push('<div class="browse-tag">' + h(type_label(it.type)) + ' · ' + h(it.unit) + (sl ? ' · ' + h(sl) : '') + '</div>');
    return rows.join('');
  }

  function browse_list_html() {
    var items = browse_items();
    if (!items.length) return { list: '', empty: true };
    var list = items.map(function (it) {
      var open = !!S.browse.open[it.id];
      return '' +
        '<button class="browse-item' + (open ? ' is-open' : '') + '" type="button" data-id="' + h(it.id) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
          '<span class="browse-item-head">' +
            '<span class="browse-item-term han" data-raw>' + browse_term(it) + '</span>' +
            '<span class="browse-item-sub" data-raw>' + h(browse_sub(it)) + '</span>' +
          '</span>' +
          '<span class="browse-item-body"' + (open ? '' : ' hidden') + '>' + browse_body(it) + '</span>' +
        '</button>';
    }).join('');
    return { list: list, empty: false };
  }

  function browse_html() {
    var bl = browse_list_html();
    return '' +
      '<main class="screen" data-screen="browse">' +
        '<section class="browse">' +
          '<div class="browse-tools">' +
            '<input class="search-input" id="browseSearch" type="search" placeholder="搜尋名句、詞解、出處…" value="' + h(S.browse.q) + '" />' +
          '</div>' +
          chips_html('units', C.units_for_module('mixed'), S.browse.units) +
          '<div class="browse-list">' + bl.list + '</div>' +
          '<p class="empty"' + (bl.empty ? '' : ' hidden') + '>沒有符合的項目。</p>' +
        '</section>' +
      '</main>';
  }

  function refresh_browse() {
    var bl = browse_list_html();
    var list = $('.browse-list');
    if (list) list.innerHTML = bl.list;
    var empty = $('.browse .empty');
    if (empty) empty.hidden = !bl.empty;
    apply_script($('.browse') || document.body);
  }

  /* ============================================================
   * 9. 錯題統計
   * ============================================================ */

  function stats_html() {
    var rows = C.all_stats().filter(function (r) { return r.wrong > 0; });
    var sm = C.summary();
    var avg = rows.length ? (rows.reduce(function (a, r) { return a + r.wrong; }, 0) / rows.length) : 0;

    var body = rows.map(function (r) {
      /* 統計頁固定用「給上默下」呈現名句題面（方向只影響作答，不影響清單） */
      var sdir = S.settings.direction === 'author' ? 'hs' : S.settings.direction;
      var pb = prompt_block(r.item, sdir);
      var label = pb.html !== undefined ? C.dot_html(r.item, is_simple()) : h(pb.prompt);
      var sl = C.scope_label(r.item);
      return '<tr>' +
        '<td class="wrong-table-q" data-raw>' + label +
          (sl ? '<span class="q-scope"> · ' + h(sl) + '</span>' : '') + '</td>' +
        '<td>' + r.wrong + '</td>' +
        '<td>' + r.correct + '</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<main class="screen" data-screen="stats">' +
        '<section class="stats-screen">' +
          '<div class="stats-summary">' +
            '<div class="stat"><span class="stat-value">' + sm.wrong_total + '</span><span class="stat-label">錯題數</span></div>' +
            '<div class="stat"><span class="stat-value">' + (avg ? avg.toFixed(1) : '0') + '</span><span class="stat-label">平均錯次</span></div>' +
          '</div>' +
          (rows.length
            ? '<table class="wrong-table"><thead><tr><th>題目</th><th>答錯</th><th>答對</th></tr></thead><tbody>' + body + '</tbody></table>'
            : '') +
          '<div class="stats-actions">' +
            '<button class="btn btn-primary" type="button" data-action="practice-wrong"' + (rows.length ? '' : ' disabled') + '>只練這些錯題</button>' +
            '<button class="btn btn-ghost" type="button" data-action="clear-wrong"' + (rows.length ? '' : ' disabled') + '>清空錯題記錄</button>' +
          '</div>' +
          '<p class="empty"' + (rows.length ? ' hidden' : '') + '>還沒有錯題，繼續保持。</p>' +
        '</section>' +
      '</main>';
  }

  /* ============================================================
   * 10. 設定
   * ============================================================ */

  function setting_row(title, sub, seg) {
    return '<div class="setting-row">' +
      '<div class="setting-text"><b>' + h(title) + '</b><small>' + h(sub) + '</small></div>' +
      seg + '</div>';
  }

  function settings_html() {
    var s = S.settings;
    return '' +
      '<main class="screen" data-screen="settings">' +
        '<section class="settings">' +
          setting_row('字形', '介面與題目顯示', seg_html('script', [
            { value: 't', label: '繁體' }, { value: 's', label: '簡體' }
          ], s.script)) +
          setting_row('深色模式', '深色底、淺色字，夜間護眼', seg_html('theme', [
            { value: 'light', label: '淺色' }, { value: 'dark', label: '深色' }
          ], s.theme)) +
          setting_row('字號', '詩句與正文大小', seg_html('font', [
            { value: 'sm', label: '小' }, { value: 'md', label: '中' },
            { value: 'lg', label: '大' }, { value: 'xl', label: '特大' }
          ], s.font)) +
          setting_row('作答方式', '預設出題方式', seg_html('question', [
            { value: 'type', label: '手打' }, { value: 'mc', label: '選擇題' }
          ], s.question)) +
          setting_row('順序', '練習出題順序', seg_html('order', [
            { value: 'shuffle', label: '亂序' }, { value: 'original', label: '原順序' }
          ], s.order)) +

          '<div class="settings-actions">' +
            '<button class="btn btn-ghost" type="button" data-action="export">📤 匯出進度</button>' +
            '<button class="btn btn-ghost" type="button" data-action="import">📥 匯入進度</button>' +
            '<input id="importFile" type="file" accept=".json,application/json" hidden />' +
            '<button class="btn btn-ghost danger" type="button" data-action="reset">重設所有進度</button>' +
          '</div>' +
          '<p class="about">資料只存在你的瀏覽器；換裝置請先匯出。</p>' +
        '</section>' +
      '</main>';
  }

  /* ============================================================
   * 11. 渲染
   * ============================================================ */

  function main_html() {
    switch (S.screen) {
      case 'setup': return setup_html();
      case 'quiz': return quiz_html();
      case 'result': return result_html();
      case 'browse': return browse_html();
      case 'stats': return stats_html();
      case 'settings': return settings_html();
      default: return home_html();
    }
  }

  function capture_draft() {
    var input = $('#answerInput');
    if (input && !input.disabled) S.draft = input.value;
    var ai = $('#authorInput');
    if (ai && !ai.disabled) S.dual_author = ai.value;
    var si = $('#sourceInput');
    if (si && !si.disabled) S.dual_source = si.value;
    return S.draft;
  }

  function render() {
    /* 隊列已空且不在作答完成狀態 → 直接結算 */
    if (S.screen === 'quiz' && S.session && S.phase !== 'review' && S.phase !== 'answered' && !S.session.pending.length) {
      finish();
      return;
    }
    S.settings = S.settings || C.settings();
    var draft = S.screen === 'quiz' ? capture_draft() : S.draft;
    S.draft = draft;

    $('#app').innerHTML = appbar_html() + main_html();
    apply_prefs();
    apply_script($('#app'));
    restore_focus();
  }

  function restore_focus() {
    if (S.screen !== 'quiz' || S.phase !== 'asking') return;
    var ai = $('#authorInput');
    if (ai && !ai.disabled) {
      var si = $('#sourceInput');
      var target = (S.dual_author && !S.dual_source) ? si : ai;
      if (target) { try { target.focus(); target.setSelectionRange(target.value.length, target.value.length); } catch (e) { } }
      return;
    }
    var input = $('#answerInput');
    if (input && !input.disabled) {
      if (S.draft) input.value = S.draft;
      try { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } catch (e) { }
    }
  }

  function go(screen) {
    S.screen = screen;
    render();
  }

  function go_home() {
    if (S.screen === 'quiz' && S.session && S.session.pending.length && !S.session.finished) {
      confirm_overlay({
        title: '離開練習？',
        text: '這一輪的進度不會保留（已作答的統計會保留）。',
        ok_label: '離開',
        on_ok: function () { clear_auto(); S.session = null; S.review = null; close_overlay(); go('home'); }
      });
      return;
    }
    clear_auto();
    go('home');
  }

  /* ============================================================
   * 12. 流程控制
   * ============================================================ */

  function choose_module(id) {
    S.module = id;
    set_setting({ module: id });
    go('setup');
  }

  function start_session(opts) {
    opts = opts || {};
    var cfg = S.settings;
    var module_id = opts.module || S.module;
    var mode = opts.mode || cfg.mode;
    var scope = opts.ids ? null : scope_state();
    var session = C.create_session({
      module: module_id,
      units: opts.ids ? null : C.units_setting(module_id),
      seg: opts.ids ? null : (opts.seg !== undefined ? opts.seg : scope.seg),
      exam: opts.ids ? null : (opts.exam !== undefined ? opts.exam : scope.exam),
      ids: opts.ids || null,
      mode: mode,
      question: cfg.question,
      direction: cfg.direction,
      order: opts.order || cfg.order
    });
    if (!session.total) { toast('這個範圍還沒有題目'); return; }
    S.session = session;
    S.result = null;
    S.last = null;
    S.options = null;
    S.review = null;
    S.draft = '';
    S.dual_author = '';
    S.dual_source = '';
    S.phase = mode === 'flash' ? 'flash-front' : 'asking';
    S.live_phase = S.phase;
    clear_auto();
    go('quiz');
  }

  function clear_auto() {
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
  }

  function submit_answer(user_text) {
    var s = S.session;
    if (!s || S.phase !== 'asking') return;
    var item = cur_item();
    if (!item) return;

    /* 作者・出處：兩欄都對才算對（Enter 提交、兩欄都空不提交） */
    if (s.direction === 'author' && S.settings.question === 'type' && item.type === 'mingju') {
      var ai = $('#authorInput'), si = $('#sourceInput');
      var a_text = String(ai ? ai.value : S.dual_author).trim();
      var s_text = String(si ? si.value : S.dual_source).trim();
      if (!a_text && !s_text) { toast('請先寫下答案'); return; }
      var dual_res = C.grade_author(item, a_text, s_text, {});
      S.dual_author = a_text;
      S.dual_source = s_text;
      do_answer(item, !!dual_res.ok, {
        user: '作者：' + (a_text || '（空）') + '　出處：' + (s_text || '（空）'),
        dual: { author: a_text, source: s_text, author_ok: !!dual_res.author_ok, source_ok: !!dual_res.source_ok }
      });
      return;
    }

    var text = String(user_text === undefined ? ($('#answerInput') ? $('#answerInput').value : S.draft) : user_text);
    if (!text.trim()) { toast('請先寫下答案'); return; }
    var res = C.grade_text(item, text, { direction: s.direction });
    do_answer(item, !!res.ok, { user: text.trim() });
  }

  function pick_option(index) {
    var s = S.session;
    if (!s || S.phase !== 'asking' || S.settings.question !== 'mc') return;
    var item = cur_item();
    if (!item) return;
    var o = ensure_options(item);
    if (!o || index < 0 || index >= o.options.length) return;
    do_answer(item, index === o.correct_index, {
      user: '',
      mc: { options: o.options.slice(), chosen: index, correct_index: o.correct_index }
    });
  }

  function do_answer(item, ok, payload) {
    var s = S.session;
    var out = C.session_answer(s, ok, payload);
    if (!out) return;
    var rec = out.rec;
    C.record(rec.id, ok, {});
    S.last = rec;
    S.draft = '';
    S.phase = 'answered';
    S.live_phase = 'answered';
    render();

    if (S.screen === 'quiz') {
      if (rec.ok) toast('答對了');
      else if (rec.dual && (rec.dual.author_ok || rec.dual.source_ok)) toast('只對了一半，稍後會再出現');
      else toast('答錯了，稍後會再出現');
    }
    if (s.mode === 'speed') schedule_auto();
  }

  function schedule_auto() {
    clear_auto();
    S.timer = setTimeout(function () {
      S.timer = null;
      if (S.screen === 'quiz' && S.phase === 'answered' && !overlay_open()) next_question(true);
    }, 900);
  }

  function next_question(auto) {
    var s = S.session;
    if (!s) return;
    clear_auto();
    S.review = null;
    S.last = null;
    S.options = null;
    S.draft = '';
    S.dual_author = '';
    S.dual_source = '';
    if (!s.pending.length) { finish(); return; }
    S.phase = s.mode === 'flash' ? 'flash-front' : 'asking';
    S.live_phase = S.phase;
    render();
  }

  function give_up() {
    var s = S.session;
    if (!s || S.phase !== 'asking') return;
    var item = cur_item();
    if (!item) return;
    do_answer(item, false, { user: '', gaveup: true });
  }

  function override_answer() {
    var s = S.session;
    if (!s || !S.last || S.last.ok) return;
    var rec = C.session_override(s, S.last.seq);
    if (!rec) return;
    C.record(rec.id, true, {});
    toast('已算你對');
    render();
  }

  function flip_card() {
    if (!S.session || S.session.mode !== 'flash') return;
    if (S.phase === 'flash-front') { S.phase = 'flash-back'; render(); return; }
    if (S.phase === 'flash-back') { S.phase = 'flash-front'; render(); }
  }

  function flash_mark(known) {
    var s = S.session;
    if (!s || s.mode !== 'flash') return;
    if (S.phase !== 'flash-back') { toast('先翻面看答案'); return; }
    var item = cur_item();
    if (!item) return;
    var out = C.session_answer(s, known, { user: '' });
    if (!out) return;
    C.record(out.rec.id, known, {});
    toast(known ? '記住了' : '稍後再見');
    S.last = null;
    S.phase = 'flash-front';
    S.live_phase = 'flash-front';
    if (!s.pending.length) { finish(); return; }
    render();
  }

  function finish() {
    var s = S.session;
    if (!s) { go('home'); return; }
    clear_auto();
    S.result = C.session_result(s);
    S.review = null;
    S.phase = 'done';
    S.screen = 'result';
    render();
  }

  function enter_review() {
    var s = S.session;
    if (!s || S.screen !== 'quiz') return;
    if (!s.history.length) { toast('還沒有可回顧的題目'); return; }
    if (!S.review) {
      S.review = { cursor: s.history.length - 1 };
    } else if (S.review.cursor > 0) {
      S.review.cursor -= 1;
    } else {
      toast('已到最前');
      return;
    }
    clear_auto();
    S.phase = 'review';
    render();
  }

  function review_forward() {
    var s = S.session;
    if (!s || !S.review) return;
    S.review.cursor += 1;
    if (S.review.cursor >= s.history.length) {
      S.review = null;
      S.phase = S.live_phase || 'asking';
    }
    render();
  }

  function reshuffle() {
    var s = S.session;
    if (!s) return;
    C.session_reshuffle(s);
    S.options = null;
    toast('已重新打亂未答題目');
    render();
  }

  function toggle_hard(btn) {
    var v = view();
    var item = v ? v.item : null;
    if (!item && S.last) item = C.item(S.last.id);
    if (!item) return;
    var e = C.toggle_hard(item.id);
    if (btn) btn.setAttribute('aria-pressed', e && e.hard ? 'true' : 'false');
    toast(e && e.hard ? '已標記為待加強' : '已取消標記');
  }

  function practice_wrong(ids) {
    var list = ids || C.all_stats().filter(function (r) { return r.wrong > 0; }).map(function (r) { return r.id; });
    if (!list.length) { toast('沒有錯題'); return; }
    start_session({ module: 'mixed', ids: list, mode: 'practice' });
  }

  /* ============================================================
   * 13. 事件
   * ============================================================ */

  function on_click(e) {
    var el = e.target.closest ? e.target.closest('[data-action],[data-module],[data-index],[data-value],[data-id]') : null;

    /* 點 overlay 卡片以外區域 = 關閉 */
    if (!el) {
      if (e.target.id === 'overlay') close_overlay();
      return;
    }
    if (e.target.id === 'overlay' && !el.hasAttribute('data-action')) { close_overlay(); return; }

    if (el.hasAttribute('data-action')) { do_action(el.getAttribute('data-action'), el, e); return; }
    if (el.hasAttribute('data-module')) { choose_module(el.getAttribute('data-module')); return; }
    if (el.hasAttribute('data-index')) { pick_option(parseInt(el.getAttribute('data-index'), 10)); return; }
    if (el.hasAttribute('data-value')) { on_value(el); return; }
    if (el.hasAttribute('data-id')) { toggle_browse(id_of(el)); return; }
  }

  function id_of(el) { return el.getAttribute('data-id'); }

  function toggle_browse(id) {
    S.browse.open[id] = !S.browse.open[id];
    var it = C.item(id);
    var bl = browse_list_html();
    var list = $('.browse-list');
    if (list) list.innerHTML = bl.list;
    apply_script($('.browse') || document.body);
    if (it) { /* 保持捲動：不整頁重繪 */ }
  }

  /* 段／次 chips：切段時若當前次不在新段內，重置為「全部」 */
  function set_segment(value) {
    var v = C.norm_scope_value(value);
    var module_items = C.items_for_module(S.module);
    var exams = C.exam_rows(module_items, v).map(function (r) { return String(r.value); });
    var patch = { seg: v };
    var cur_exam = C.norm_scope_value(S.settings.exam);
    if (cur_exam !== 'all' && exams.indexOf(cur_exam) < 0) patch.exam = 'all';
    set_setting(patch);
    render();
  }

  function set_exam(value) {
    var v = C.norm_scope_value(value);
    var st = scope_state();
    var ids = st.exams.map(function (r) { return String(r.value); });
    if (v !== 'all' && ids.indexOf(v) < 0) return;
    set_setting({ exam: v });
    render();
  }

  function on_value(el) {
    var field = el.parentElement ? el.parentElement.getAttribute('data-field') : null;
    var value = el.getAttribute('data-value');
    var container = el.parentElement;
    if (!field) return;

    if (container.classList.contains('chips')) {
      if (field === 'segments') { set_segment(value); return; }
      if (field === 'exams') { set_exam(value); return; }
      if (S.screen === 'browse') {
        var cur = S.browse.units.slice();
        if (value === 'all') cur = ['all'];
        else {
          cur = cur.filter(function (v) { return v !== 'all'; });
          var i = cur.indexOf(value);
          if (i >= 0) cur.splice(i, 1); else cur.push(value);
          if (!cur.length) cur = ['all'];
        }
        S.browse.units = cur;
        render();
      } else {
        var cur2 = C.units_setting(S.module).slice();
        if (value === 'all') cur2 = ['all'];
        else {
          cur2 = cur2.filter(function (v) { return v !== 'all'; });
          var j = cur2.indexOf(value);
          if (j >= 0) cur2.splice(j, 1); else cur2.push(value);
          if (!cur2.length) cur2 = ['all'];
        }
        C.set_units_setting(S.module, cur2);
        render();
      }
      return;
    }

    /* segmented：單選 */
    if (field === 'script') { set_script(value); return; }
    if (field === 'theme') { set_theme(value); return; }
    if (field === 'font') { set_font(value); return; }
    var patch = {};
    patch[field] = value;
    set_setting(patch);
    render();
  }

  function do_action(action, el) {
    /* 先處理覆蓋層 */
    if (action === 'overlay-cancel') { close_overlay(); return; }
    if (action === 'overlay-ok') {
      var fn = S.overlay_ok;
      S.overlay_ok = null;
      if (fn) fn(); else close_overlay();
      return;
    }

    /* 依畫面分派（同名按鈕在不同畫面語意不同） */
    if (S.screen === 'result') {
      if (action === 'again') {
        start_session({
          module: S.session ? S.session.module : S.module,
          mode: S.session ? S.session.mode : S.settings.mode,
          order: S.session ? S.session.order : S.settings.order
        });
        return;
      }
      if (action === 'retry-wrong') { practice_wrong(S.result ? S.result.wrong_ids : null); return; }
      if (action === 'home') { go('home'); return; }
    }
    if (S.screen === 'stats') {
      if (action === 'practice-wrong') { practice_wrong(); return; }
      if (action === 'clear-wrong') {
        confirm_overlay({
          title: '清空錯題記錄？',
          text: '所有題目的「答錯次數」會歸零，答對次數保留。',
          ok_label: '清空', danger: true,
          on_ok: function () { C.clear_wrong(); close_overlay(); toast('已清空錯題記錄'); render(); }
        });
        return;
      }
    }
    if (S.screen === 'settings') {
      if (action === 'export') { export_progress(); return; }
      if (action === 'import') { var f = $('#importFile'); if (f) f.click(); return; }
      if (action === 'reset') {
        confirm_overlay({
          title: '重設所有進度？',
          text: '答對、答錯、標記與偏好都會回到初始狀態，無法復原。',
          ok_label: '重設', danger: true,
          on_ok: function () {
            C.reset_all(false);
            S.settings = C.settings();
            close_overlay();
            apply_prefs();
            toast('已重設');
            render();
          }
        });
        return;
      }
    }

    switch (action) {
      case 'back': go_home(); return;
      case 'toggle-script': set_script(is_simple() ? 't' : 's'); return;
      case 'toggle-theme': set_theme(S.settings.theme === 'dark' ? 'light' : 'dark'); return;
      case 'font-dec': step_font(-1); return;
      case 'font-inc': step_font(1); return;

      case 'open-stats': S.screen = 'stats'; render(); return;
      case 'open-browse': S.screen = 'browse'; render(); return;
      case 'open-settings': S.screen = 'settings'; render(); return;

      case 'start': start_session({ module: S.module }); return;
      case 'reshuffle': reshuffle(); return;
      case 'submit': return;                /* 交由表單 submit 事件處理，避免重複提交 */
      case 'giveup': give_up(); return;
      case 'override': override_answer(); return;
      case 'next': if (S.phase === 'review') review_forward(); else next_question(); return;
      case 'prev-review': enter_review(); return;
      case 'hard': toggle_hard(el); return;
      case 'flip': flip_card(); return;
      case 'known': flash_mark(true); return;
      case 'again': flash_mark(false); return;
      default: return;
    }
  }

  /* ============================================================
   * 14. 匯出／匯入
   * ============================================================ */

  function export_progress() {
    try {
      var text = C.export_text();
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'cn-review-' + C.date_key() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('已匯出進度檔');
    } catch (err) {
      toast('匯出失敗');
    }
  }

  function import_progress_file(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var res = C.import_text(String(reader.result));
      if (!res.ok) { toast('匯入失敗：' + res.error); return; }
      confirm_overlay({
        title: '匯入完成',
        text: '已合併 ' + res.count + ' 題的進度紀錄（同題取較多者）。',
        ok_label: '知道了',
        on_ok: function () { close_overlay(); render(); }
      });
    };
    reader.onerror = function () { toast('讀取檔案失敗'); };
    reader.readAsText(file, 'utf-8');
  }

  /* ============================================================
   * 15. 鍵盤
   * ============================================================ */

  function in_input() {
    var a = document.activeElement;
    if (!a) return false;
    var t = a.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || a.isContentEditable;
  }

  /* 作答輸入框（單欄或作者／出處兩欄） */
  function is_answer_input(el) {
    if (!el || !el.id) return false;
    return el.id === 'answerInput' || el.id === 'authorInput' || el.id === 'sourceInput';
  }

  function on_keydown(e) {
    var k = e.key;

    if (overlay_open()) {
      if (k === 'Escape') { e.preventDefault(); close_overlay(); }
      if (k === 'Enter') {
        var ok = $('[data-action="overlay-ok"]');
        if (ok) { e.preventDefault(); ok.click(); }
      }
      return;
    }

    if (k === 'Escape') { e.preventDefault(); go_home(); return; }
    if (S.screen !== 'quiz' || !S.session) return;

    var typing = in_input();

    if (S.phase === 'review') {
      if (k === 'ArrowLeft') { e.preventDefault(); enter_review(); return; }
      if (k === 'ArrowRight') { e.preventDefault(); review_forward(); return; }
      if (k === 'Escape') { e.preventDefault(); review_forward(); return; }
      if (k === 'Enter') { e.preventDefault(); review_forward(); return; }
      return;
    }

    if (S.phase === 'asking') {
      if (S.settings.question === 'mc' && ['1', '2', '3', '4'].indexOf(k) >= 0) {
        e.preventDefault();
        pick_option(parseInt(k, 10) - 1);
        return;
      }
      if (k === 'Enter' && !typing) { e.preventDefault(); submit_answer(); return; }
    } else if (S.phase === 'answered') {
      if (k === 'Enter') { e.preventDefault(); next_question(); return; }
    } else if (S.phase === 'flash-front') {
      if (k === ' ' || k === 'Enter') { e.preventDefault(); flip_card(); return; }
    } else if (S.phase === 'flash-back') {
      if (k === ' ') { e.preventDefault(); flip_card(); return; }
      if (k === 'Enter') { e.preventDefault(); flash_mark(true); return; }
    }

    if (k === 'ArrowLeft') { e.preventDefault(); enter_review(); return; }
    if (k === 'a' || k === 'A') {
      if (typing) return;
      e.preventDefault();
      toggle_hard($('[data-action="hard"]'));
      return;
    }
  }

  function on_keydown_input(e) {
    /* 中文輸入法組字中：Enter 不提交 */
    if (e.key === 'Enter' && (e.isComposing || S.composing)) { e.preventDefault(); return; }
  }

  /* ============================================================
   * 16. 啟動
   * ============================================================ */

  function init() {
    S.settings = C.settings();
    S.module = S.settings.module || 'mingju';
    apply_prefs();
    $('#app').innerHTML = appbar_html() + main_html();
    apply_script($('#app'));

    document.addEventListener('click', on_click);
    document.addEventListener('keydown', on_keydown);

    document.addEventListener('submit', function (e) {
      if (!e.target.classList || !e.target.classList.contains('answer-form')) return;
      e.preventDefault();
      if (S.composing) return;
      submit_answer();
    });

    document.addEventListener('compositionstart', function (e) {
      if (is_answer_input(e.target)) S.composing = true;
    });
    document.addEventListener('compositionend', function (e) {
      if (is_answer_input(e.target)) S.composing = false;
    });

    document.addEventListener('keydown', function (e) {
      if (is_answer_input(e.target)) on_keydown_input(e);
    }, true);

    document.addEventListener('input', function (e) {
      if (e.target.id === 'answerInput') { S.draft = e.target.value; return; }
      if (e.target.id === 'authorInput') { S.dual_author = e.target.value; return; }
      if (e.target.id === 'sourceInput') { S.dual_source = e.target.value; return; }
      if (e.target.id === 'browseSearch') {
        S.browse.q = e.target.value;
        refresh_browse();
      }
    });

    document.addEventListener('change', function (e) {
      if (e.target.id === 'importFile') {
        import_progress_file(e.target.files && e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  window.CNUI = {
    init: init,
    apply_prefs: apply_prefs,
    render: render,
    state: S
  };
})();
