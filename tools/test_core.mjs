/* tools/test_core.mjs —— js/core.js 單元測試（node tools/test_core.mjs）
 * 直接載入 data/dataset.js 與 js/core.js 到 vm 沙箱，不依賴瀏覽器。
 * 測試字串一律由資料本身推導，換教材後仍可跑。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ---------- 載入 ---------- */
function load_core() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/dataset.js'), 'utf8'), ctx, { filename: 'data/dataset.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/core.js'), 'utf8'), ctx, { filename: 'js/core.js' });
  return { C: ctx.window.CNCore, win: ctx.window };
}

const { C, win } = load_core();

/* ---------- 測試框架 ---------- */
let pass = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass += 1; return true; }
  failures.push(msg);
  console.log('  [FAIL] ' + msg);
  return false;
}
function eq(got, want, msg) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  return ok(same, msg + '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}
function section(name) { console.log('\n== ' + name); }

/* ---------- 測試資料 ---------- */
const HAN = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳';
function mk_item(i, type, unit) {
  const ch = HAN[i % HAN.length] + HAN[(i + 3) % HAN.length];
  if (type === 'cijie') {
    return {
      id: 'x' + i, type: 'cijie', unit,
      q_t: '題面【詞' + ch + '】，後句。', q_s: '题面【词' + ch + '】，后句。',
      w_t: '詞' + ch, w_s: '词' + ch,
      a_t: ['解釋' + ch], a_s: ['解释' + ch],
      k_t: ['關鍵' + ch], k_s: ['关键' + ch], note: ''
    };
  }
  if (type === 'mingju') {
    return {
      id: 'x' + i, type: 'mingju', unit,
      t: '上半' + ch + '，下半' + ch + '。', s: '上半' + ch + '，下半' + ch + '。',
      src_t: '出處' + ch, src_s: '出处' + ch, note: ''
    };
  }
  return {
    id: 'x' + i, type: 'changshi', unit,
    q_t: '問題' + ch, q_s: '问题' + ch,
    a_t: '答案' + ch, a_s: '答案' + ch, accept: ['答案' + ch], note: ''
  };
}
function mk_items(n, type, unitOf) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(mk_item(i, type, unitOf ? unitOf(i) : 'u1'));
  return out;
}
function with_dataset(ds, fn) {
  const old = win.CN_DATASET;
  win.CN_DATASET = ds;
  try { return fn(); } finally { win.CN_DATASET = old; C._reset_cache(); }
}

const items = C.items();
const mj = items.filter((it) => it.type === 'mingju');
const cj = items.filter((it) => it.type === 'cijie');
const cs = items.filter((it) => it.type === 'changshi');
ok(items.length > 0, '資料集非空（' + items.length + ' 題）');
ok(mj.length > 0 && cj.length > 0 && cs.length > 0, '三種題型都有資料');

/* ============================================================ */
section('1. 正規化 norm / norm_answer');
eq(C.norm('詩經，關雎。'), '诗经关雎', '去標點並逐字轉簡');
eq(C.norm('  詩 經  ABC  關雎  '), '诗经关雎', '去空白與英數');
eq(C.norm(''), '', '空字串安全');
eq(C.norm(null), '', 'null 安全');
eq(C.norm('，。！？；：'), '', '純標點為空');
eq(C.norm_answer('意思是文靜而美好'), '文静而美好', '去「意思是」前綴');
eq(C.norm_answer('文靜而美好之意'), '文静而美好', '去「之意」後綴');
eq(C.norm_answer('指的是《詩經》'), '诗经', '去「指的是」與書名號');
eq(C.norm_answer('春秋的意思'), '春秋', '去「的意思」後綴');
eq(C.to_simple('設定練習'), '设定练习', '介面文案可逐字轉簡');
eq(C.to_simple('abc，123'), 'abc，123', '非漢字原樣保留');

/* ============================================================ */
section('2. 名句切半與提示');
const sp = C.split_mingju('關關雎鳩，在河之洲；窈窕淑女，君子好逑。');
eq(sp.first, '關關雎鳩，', '以第一個標點切開前半（含標點）');
eq(sp.second, '在河之洲；窈窕淑女，君子好逑。', '後半');
eq(sp.degraded, false, '正常切半');
const sp2 = C.split_mingju('沒有標點');
eq(sp2.degraded, true, '無標點時退化切半');
ok(sp2.first.length > 0 && sp2.second.length > 0, '退化切半仍有兩段');
eq(C.count_han('非寧靜無以致遠。'), 7, '計算漢字數（標點不計）');

const mj0 = mk_item(0, 'mingju', 'u1');
const hs = C.mingju_pair(mj0, 'hs');
const sh = C.mingju_pair(mj0, 'sh');
const comma = mj0.t.indexOf('，');
eq(hs.prompt_t, mj0.t.slice(0, comma + 1), '給上默下：題面為前半');
eq(hs.answer_t, mj0.t.slice(comma + 1), '給上默下：答案為後半');
eq(sh.prompt_t, mj0.t.slice(comma + 1), '給下默上：題面為後半');
eq(sh.answer_t, mj0.t.slice(0, comma + 1), '給下默上：答案為前半');
ok(hs.ask.indexOf('下半') >= 0, '提示文案為默寫下半句');
ok(sh.ask.indexOf('上半') >= 0, '提示文案為默寫上半句');

/* 真實資料：每一句名句都能切半 */
let split_ok = true;
mj.forEach((it) => {
  const p = C.split_mingju(C.pair(it, 'src').t ? C.str_field(it, 't') : '');
  const q = C.mingju_pair(it, 'hs');
  if (!q.prompt_t || !q.answer_t) split_ok = false;
});
ok(split_ok, '所有名句都能切出題面與答案');

/* ============================================================ */
section('3. 判分：名句');
const mj_good = hs.answer_t;
const mj_clean = mj_good.replace(/[，。；：？！,.;:?!]/g, '');
eq(C.grade_text(mj0, mj_clean, { direction: 'hs' }).ok, true, '標點不影響判對');
eq(C.grade_text(mj0, '，' + mj_clean + '。', { direction: 'hs' }).ok, true, '多餘標點仍判對');
eq(C.grade_text(mj0, mj_clean + '字', { direction: 'hs' }).ok, false, '多寫字判錯');
eq(C.grade_text(mj0, hs.answer_t.slice(0, -1).slice(0, 2), { direction: 'hs' }).ok, false, '只寫一部分判錯');
eq(C.grade_text(mj0, sh.answer_t.replace(/[，。]/g, ''), { direction: 'sh' }).ok, true, '給下默上判對');
eq(C.grade_text(mj0, mj_clean, { direction: 'sh' }).ok, false, '方向相反時判錯');
eq(C.grade_text(mj0, '   ', { direction: 'hs' }).ok, false, '空白不判對');
eq(C.grade_text(mj0, '', { direction: 'hs' }).empty, true, '空答案標記 empty');

/* ============================================================ */
section('4. 判分：繁簡互通');
const mj_real = mj[0];
const real_t = C.mingju_pair(mj_real, 'hs').answer_t;
const real_s = C.mingju_pair(mj_real, 'hs').answer_s;
eq(C.grade_text(mj_real, real_t, { direction: 'hs' }).ok, true, '繁體答案判對');
eq(C.grade_text(mj_real, real_s, { direction: 'hs' }).ok, true, '簡體答案判對');
eq(C.norm(real_t), C.norm(real_s), '同一句的繁簡正規化後相等');
eq(C.norm(C.str_field(mj_real, 't')), C.norm(C.str_field(mj_real, 's')), '全句繁簡正規化後相等');

/* ============================================================ */
section('5. 判分：詞解（標準答案／關鍵詞／外殼）');
const cj0 = cj[0];
const cd0 = C.cijie_data(cj0);
const k0 = cd0.k.t[0] || '';
eq(C.grade_text(cj0, cd0.a.t[0], {}).ok, true, '標準答案判對');
eq(C.grade_text(cj0, cd0.a.s[0] || cd0.a.t[0], {}).ok, true, '簡體標準答案判對');
eq(C.grade_text(cj0, '指的是' + cd0.a.t[0], {}).ok, true, '含口語外殼判對');
if (k0) {
  eq(C.grade_text(cj0, '這裡說的是' + k0 + '的樣子', {}).ok, true, '包含關鍵詞判對（' + k0 + '）');
  eq(C.grade_text(cj0, k0, {}).ok, true, '關鍵詞本身判對');
}
eq(C.grade_text(cj0, '皇帝陛下駕到', {}).ok, false, '無關答案判錯');
let cj_all_ok = true;
cj.forEach((it) => {
  const d = C.cijie_data(it);
  if (!d.a.t.length) cj_all_ok = false;
  else if (!C.grade_text(it, d.a.t[0], {}).ok) cj_all_ok = false;
});
ok(cj_all_ok, '所有詞解的標準答案都能判對（' + cj.length + ' 題）');

/* 回歸：單字關鍵詞不得讓「相反答案」過關（P1：是／不是、少／不少）
 * 例：答案「是」，輸入「不是」必須判錯；照抄標準答案仍判對
 */
const ds_neg = {
  meta: { title: 't' },
  units: [{ id: 'A', name: 'A' }],
  items: [
    {
      id: 'neg-yes', type: 'cijie', unit: 'A',
      q_t: '題面【是】', q_s: '题面【是】', w_t: '是', w_s: '是',
      a_t: ['是'], a_s: ['是'], k_t: ['是'], k_s: ['是'], note: ''
    },
    {
      id: 'neg-shao', type: 'cijie', unit: 'A',
      q_t: '題面【少】', q_s: '题面【少】', w_t: '少', w_s: '少',
      a_t: ['少'], a_s: ['少'], k_t: ['少'], k_s: ['少'], note: ''
    }
  ],
  t2s: {}
};
with_dataset(ds_neg, () => {
  const neg_yes = C.items().find((it) => it.id === 'neg-yes');
  const neg_shao = C.items().find((it) => it.id === 'neg-shao');
  ok(C.cs_keywords(C.cijie_data(neg_yes)).every((k) => k.length >= 2), '關鍵詞只收長度 ≥ 2 的詞');
  eq(C.grade_text(neg_yes, '是', {}).ok, true, '答案「是」照抄判對');
  eq(C.grade_text(neg_yes, '不是', {}).ok, false, '答案「是」不得因「不是」判對');
  eq(C.grade_text(neg_shao, '少', {}).ok, true, '答案「少」照抄判對');
  eq(C.grade_text(neg_shao, '不少', {}).ok, false, '答案「少」不得因「不少」判對');
});

/* ============================================================ */
section('6. 判分：常識（accept／書名號）');
const cs0 = cs[0];
const csd = C.changshi_data(cs0);
eq(C.grade_text(cs0, csd.a.t, {}).ok, true, '標準答案判對');
eq(C.grade_text(cs0, csd.a.s, {}).ok, true, '簡體答案判對');
if (csd.accept.length) {
  eq(C.grade_text(cs0, csd.accept[0], {}).ok, true, 'accept 判對');
  eq(C.grade_text(cs0, '《' + csd.accept[0] + '》', {}).ok, true, '帶書名號判對');
  eq(C.grade_text(cs0, '「是' + csd.accept[0] + '」', {}).ok, true, '含引號與前綴仍判對');
}
eq(C.grade_text(cs0, '這答案一定不對', {}).ok, false, '錯誤答案判錯');
let cs_all_ok = true;
cs.forEach((it) => {
  const d = C.changshi_data(it);
  if (!C.grade_text(it, d.a.t, {}).ok) cs_all_ok = false;
});
ok(cs_all_ok, '所有常識題的標準答案都能判對（' + cs.length + ' 題）');

/* ============================================================ */
section('7. 選擇題選項生成');
const ds_mc = {
  meta: { title: 't' },
  units: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }],
  items: mk_items(12, 'changshi', (i) => (i < 6 ? 'A' : 'B')),
  t2s: {}
};
with_dataset(ds_mc, () => {
  const target = C.items()[0];
  const built = C.build_options(target, C.items(), { seed: 7 });
  eq(built.options.length, 4, '產生 4 個選項');
  eq(C.uniq(built.options.map((o) => C.norm(o.t))).length, 4, '選項互不重複');
  eq(C.norm(built.options[built.correct_index].t), C.norm(C.answer_variants(target).t), '正確項索引正確');
  eq(built.options.filter((o) => C.norm(o.t) === C.norm(C.answer_variants(target).t)).length, 1, '正確答案只出現一次');

  const unit_of_norm = {};
  C.items().forEach((it) => { unit_of_norm[C.norm(C.answer_variants(it).t)] = it.unit; });
  const distractors = built.options.filter((_, i) => i !== built.correct_index);
  eq(distractors.map((o) => unit_of_norm[C.norm(o.t)]), ['A', 'A', 'A'], '同 unit 優先取干擾項');

  const tiny = C.build_options(target, [target, C.items()[6]], { seed: 3 });
  ok(tiny.options.length >= 2 && tiny.options.length < 4, '題庫不足時仍給出可行選項（' + tiny.options.length + ' 個）');
  eq(C.norm(tiny.options[tiny.correct_index].t), C.norm(C.answer_variants(target).t), '小題庫的正確項仍正確');

  const cross = C.build_options(target, [target, C.items()[4], C.items()[8]], { seed: 3 });
  ok(cross.options.length >= 2, '同題型優先，不足時才跨題型（' + cross.options.length + ' 個）');
});

['mingju', 'cijie', 'changshi'].forEach((type) => {
  const pool = items.filter((it) => it.type === type);
  if (!pool.length) return;
  const target = pool[0];
  const built = C.build_options(target, items, { direction: 'hs', seed: 11 });
  const want = Math.min(4, C.uniq(pool.concat(items).map((it) => C.norm(C.answer_variants(it, 'hs').t))).filter(Boolean).length);
  ok(built.options.length >= Math.min(4, want), type + ' 選擇題選項數量足夠（' + built.options.length + '）');
  eq(C.norm(built.options[built.correct_index].t), C.norm(C.answer_variants(target, 'hs').t), type + ' 正確項索引正確');
  eq(C.uniq(built.options.map((o) => C.norm(o.t))).length, built.options.length, type + ' 選項不重複');
});
/* 迴歸：direction='author' 只影響名句，不得把非名句題型的干擾項全換成名句作者出處 */
['cijie', 'changshi'].forEach((type) => {
  const pool = items.filter((it) => it.type === type);
  if (!pool.length) return;
  const target = pool[0];
  const built = C.build_options(target, items, { direction: 'author', seed: 5 });
  const own = new Set(pool.map((it) => C.norm(C.answer_variants(it).t)).filter(Boolean));
  eq(
    built.options.map((o) => C.norm(o.t)).filter((n) => !own.has(n)),
    [],
    type + '（author 模式）干擾項仍取自同題型答案'
  );
});
eq(C.option_key(0) + C.option_key(3), 'AD', '選項鍵 A/B/C/D');

/* ============================================================ */
section('8. 隊列：錯題 5/10/20 重現');
const items25 = mk_items(25, 'changshi', () => 'u1');
const s25 = C.create_session({ items: items25, mode: 'practice', order: 'original', seed: 1 });
eq(s25.total, 25, '初始總題數');
eq(C.session_current(s25).id, 'x0', '第一題為 x0');
eq(C.session_answer(s25, false, { user: 'x' }).entry.id, 'x0', '先答錯第一題');
eq(s25.pending.findIndex((p) => p.id === 'x0'), 4, '第 1 次答錯：5 題後重現（索引 4）');
eq(s25.total, 26, '重現題計入總題數');
eq(s25.completed, 1, '完成題數 1');
for (let i = 0; i < 4; i++) C.session_answer(s25, true, {});
eq(C.session_current_entry(s25).id, 'x0', '第 5 題重現同一題');
C.session_answer(s25, false, { user: 'y' });
eq(s25.pending.findIndex((p) => p.id === 'x0'), 9, '第 2 次答錯：10 題後重現（索引 9）');
for (let i = 0; i < 9; i++) C.session_answer(s25, true, {});
C.session_answer(s25, false, { user: 'z' });
eq(s25.pending.findIndex((p) => p.id === 'x0'), 19, '第 3 次答錯：20 題後重現（索引 19）');
eq(C.wrong_offset(1) + '/' + C.wrong_offset(2) + '/' + C.wrong_offset(3) + '/' + C.wrong_offset(9), '5/10/20/20', '錯誤次數 → 間隔 5/10/20');
ok(s25.total === 25 + 3 + 13, '每次重現（3 次錯題＋13 次鞏固）都加進總題數（' + s25.total + '）');

/* ============================================================ */
section('9. 隊列：答對 +15 鞏固（只一次）');
const s_one = C.create_session({ items: mk_items(1, 'changshi', () => 'u1'), mode: 'practice', order: 'original', seed: 2 });
eq(s_one.pending.length, 1, '單題隊列');
C.session_answer(s_one, true, {});
eq(s_one.pending.length, 1, '答對後插入鞏固題');
eq(s_one.pending[0].kind, 'consolidate', '插入的是鞏固題');
eq(s_one.total, 2, '鞏固題計入總題數');
C.session_answer(s_one, true, {});
eq(s_one.pending.length, 0, '鞏固一次後不再重現');
eq(s_one.history.length, 2, '兩次作答紀錄');
ok(s_one.finished, '隊列結束');
ok(C.session_state(s_one, 'x0').scheduled && C.session_state(s_one, 'x0').consolidated, '鞏固狀態已標記');

const s_two = C.create_session({ items: mk_items(1, 'changshi', () => 'u1'), mode: 'practice', order: 'original', seed: 2 });
C.session_answer(s_two, true, {});
C.session_answer(s_two, false, { user: '' });
eq(s_two.pending[0].id, 'x0', '鞏固時答錯仍會重現');
eq(C.session_state(s_two, 'x0').consolidated, true, '鞏固已用掉，不再安排');
C.session_answer(s_two, true, {});
eq(s_two.pending.length, 0, '之後答對不再插入鞏固');
eq(s_two.history.length, 3, '歷史 3 筆');

const s15 = C.create_session({ items: mk_items(30, 'changshi', () => 'u1'), mode: 'practice', order: 'original', seed: 5 });
C.session_answer(s15, true, {});
eq(s15.pending.findIndex((p) => p.id === 'x0'), 14, '答對後 +15 鞏固（索引 14）');
eq(s15.pending[14].kind, 'consolidate', '索引 14 的標記為 consolidate');

/* ============================================================ */
section('10. 隊列：速通 / 翻卡 / 進度 / 打亂');
const s_speed = C.create_session({ items: mk_items(5, 'changshi', () => 'u1'), mode: 'speed', order: 'original', seed: 1 });
for (let i = 0; i < 5; i++) C.session_answer(s_speed, i !== 2, { user: '' });
eq(s_speed.total, 5, '速通不重現，總題數不變');
eq(s_speed.pending.length, 0, '速通一次刷完');
const r_speed = C.session_result(s_speed);
eq(r_speed.total_items, 5, '結算題數');
eq(r_speed.correct_items, 4, '結算答對題數');
eq(r_speed.wrong_items, 1, '結算答錯題數');
eq(r_speed.wrong_ids, ['x2'], '結算錯題清單');
eq(r_speed.rate, 0.8, '結算正確率');
ok(C.format_duration(92000) === '1:32', '用時格式 m:ss');

const s_flash = C.create_session({ items: mk_items(3, 'cijie', () => 'u1'), mode: 'flash', order: 'original', seed: 1 });
C.session_answer(s_flash, false, { user: '' });
eq(s_flash.pending[s_flash.pending.length - 1].id, 'x0', '翻卡未記住：排到隊尾（不足 5 張）');
eq(s_flash.pending[0].id, 'x1', '未記住不影響下一張');
C.session_answer(s_flash, true, { user: '' });
eq(s_flash.pending[0].id, 'x2', '記住了則前進');
ok(C.session_state(s_flash, 'x0').forgotten === 1, '記錄未記住次數');

const s_flash5 = C.create_session({ items: mk_items(9, 'cijie', () => 'u1'), mode: 'flash', order: 'original', seed: 1 });
C.session_answer(s_flash5, false, { user: '' });
eq(s_flash5.pending.findIndex((p) => p.id === 'x0'), 4, '翻卡未記住：5 張後重現（索引 4）');

const s_prog = C.create_session({ items: mk_items(6, 'changshi', () => 'u1'), mode: 'practice', order: 'original', seed: 3 });
let last = -1, monotonic = true;
for (let i = 0; i < 12 && s_prog.pending.length; i++) {
  C.session_answer(s_prog, i % 3 !== 0, { user: '' });
  const pr = C.session_progress(s_prog);
  if (pr < last - 1e-9) monotonic = false;
  last = pr;
}
ok(monotonic, '進度不倒退');
ok(C.session_progress(s_prog) >= 0 && C.session_progress(s_prog) <= 1, '進度介於 0~1');
ok(s_prog.progress_max <= 1, '進度上限 1');

const s_shuf = C.create_session({ items: mk_items(8, 'changshi', () => 'u1'), mode: 'practice', order: 'original', seed: 9 });
C.session_answer(s_shuf, true, { user: '' });
const before_head = s_shuf.pending[0].id;
const before_ids = s_shuf.pending.map((p) => p.id).slice().sort().join(',');
C.session_reshuffle(s_shuf);
eq(s_shuf.pending[0].id, before_head, '重新打亂保留當前題');
eq(s_shuf.pending.map((p) => p.id).slice().sort().join(','), before_ids, '重新打亂不增減題目');

/* 真實資料：每題都能開出一輪 */
let real_ok = true;
['mingju', 'cijie', 'changshi', 'mixed'].forEach((m) => {
  const s = C.create_session({ module: m, mode: 'practice', order: 'original', seed: 1 });
  if (!s.total) real_ok = false;
  if (!C.session_current(s)) real_ok = false;
});
ok(real_ok, '四個模組都能建立非空隊列');
eq(C.units_for_module('mixed').length, C.dataset().units.length, '混合模組涵蓋所有單元');
ok(C.items_for('mingju', ['all']).every((it) => it.type === 'mingju'), '模組過濾題型正確');

/* ============================================================ */
section('11. 覆寫（算我對）');
const s_ov = C.create_session({ items: mk_items(4, 'changshi', () => 'u1'), mode: 'practice', order: 'original', seed: 4 });
const ov_out = C.session_answer(s_ov, false, { user: '錯' });
const before_ov = s_ov.pending.length;
const rec_ov = C.session_override(s_ov, ov_out.rec.seq);
eq(rec_ov.ok, true, '覆寫後紀錄為答對');
eq(rec_ov.overridden, true, '標記為覆寫');
ok(s_ov.pending.length < before_ov, '覆寫後移除該題的重現');
eq(C.session_result(s_ov).wrong_items, 0, '覆寫後結算無錯題');

/* 進度（P2）：答錯插入重現 → 覆寫 → 進度必須回到 100% 且本輪結束 */
const s_ov_prog = C.create_session({ items: mk_items(1, 'changshi', () => 'u1'), mode: 'practice', order: 'original', seed: 9 });
const prog_out = C.session_answer(s_ov_prog, false, { user: '錯' });
eq(s_ov_prog.total, 2, '答錯插入重現 → 總題數 2');
ok(C.session_progress(s_ov_prog) < 1, '答錯後進度未滿');
C.session_override(s_ov_prog, prog_out.rec.seq);
eq(s_ov_prog.total, s_ov_prog.completed, '覆寫後總題數扣回（= 完成數）');
eq(C.session_progress(s_ov_prog), 1, '覆寫後進度 100%');
eq(s_ov_prog.finished, true, '覆寫後本輪標記完成');

/* 持久統計（P1）：先答錯 → 覆寫 → wrong 回退、correct +1、待複習清掉 */
C._cache_store();
const ov_id = items[2].id;
C.record(ov_id, false);
eq(C.item_stats(ov_id).wrong, 1, '覆寫前持久統計 wrong=1');
const ov_correct_before = C.item_stats(ov_id).correct;
const ov_entry = C.record_override(ov_id);
eq(ov_entry.wrong, 0, '覆寫後 wrong 回退到 0');
eq(C.item_stats(ov_id).correct, ov_correct_before + 1, '覆寫後 correct +1');
eq(C.item_stats(ov_id).due, false, '覆寫後不再列入待複習');
eq(C.item_stats(ov_id).last_wrong, '', '錯題歸零後清掉 last_wrong');
ok(!C.all_stats().some((r) => r.id === ov_id && r.due), '錯題清單不再標記待複習');
eq(C.record_override(ov_id).wrong, 0, '重複覆寫不會讓 wrong 變負數');
eq(C.record_override(''), null, '無 id 回傳 null');
C.record(ov_id, false);
eq(C.item_stats(ov_id).wrong, 1, 'record() 行為不變：仍正常累加 wrong');
eq(C.record(ov_id, true, { override: true }).wrong, 0, 'record(..., {override:true}) 同樣回退舊錯誤');
C._cache_store();

/* ============================================================ */
section('12. 儲存：settings / 統計 / 匯出匯入 / 重設');
C._cache_store();
const id0 = items[0].id, id1 = items[1].id;
C.patch_settings({ script: 's', theme: 'dark', font: 'lg', order: 'original' });
eq(C.settings().script, 's', '偏好即時保存');
C.patch_settings({ script: 't', theme: 'light', font: 'md', order: 'shuffle' });
eq(C.settings().script, 't', '偏好可改回');
C.patch_settings({ mode: 'flash', question: 'mc', direction: 'sh', font: 'bogus', theme: 'x' });
eq(C.settings().font, 'md', '非法字號被忽略');
eq(C.settings().theme, 'light', '非法主題被忽略');
eq(C.settings().mode, 'flash', '模式保存');
eq(C.settings().threshold, undefined, '未知欄位不會被寫入');
C.set_units_setting('mingju', ['u1']);
eq(C.units_setting('mingju'), ['u1'], '單元範圍保存');
C.set_units_setting('mingju', []);
eq(C.units_setting('mingju'), ['all'], '空範圍回退為全部');

C.record(id0, false);
C.record(id0, false);
C.record(id0, true);
C.record(id1, true);
C.record(id1, true);
const st0 = C.item_stats(id0);
eq(st0.wrong, 2, '累計答錯次數');
eq(st0.correct, 1, '累計答對次數');
ok(st0.due, '答錯未滿兩次 → 待複習');
ok(C.item_stats(id1).mastered, '答對兩次 → 已掌握');
ok(!!st0.last_wrong, '記錄最後答錯時間');
eq(C.toggle_hard(id0).hard, true, '標記 hard');
eq(C.item_stats(id0).hard, true, 'hard 已保存');
eq(C.toggle_hard(id0).hard, false, '取消 hard');

const sum = C.summary();
eq(sum.today_answered, 5, '今日已答統計');
eq(sum.today_correct, 3, '今日答對統計');
ok(sum.due >= 1, '待複習數');
ok(sum.mastered >= 1, '已掌握數');
const mod_sum = C.module_summary(items[0].type === 'mingju' ? 'mingju' : 'mixed');
ok(typeof mod_sum.count === 'number', '模組統計可用');

const all_rows = C.all_stats();
ok(all_rows.length >= 2, '錯題清單含已作答題目');
ok(all_rows[0].wrong >= all_rows[all_rows.length - 1].wrong, '錯題清單按答錯次數倒序');

const txt = C.export_text();
const obj = JSON.parse(txt);
eq(obj.v, 1, '匯出含版本');
eq(obj.app, 'cn_review', '匯出含標記');
ok(obj.items[id0].wrong === 2, '匯出含題目統計');
eq(C.import_text('not json').ok, false, '匯入非 JSON 失敗');
eq(C.import_text('{"v":1}').ok, false, '匯入缺少 items 失敗');
eq(C.import_text('[]').ok, false, '匯入陣列失敗');
const imported = C.import_text(JSON.stringify({ v: 1, items: { [id0]: { wrong: 7, correct: 3, hard: true }, 'no-such-id': { wrong: 1, correct: 0 } }, daily: {} }));
eq(imported.ok, true, '匯入合法檔成功');
eq(imported.count, 1, '忽略不存在的題目 id');
eq(C.item_stats(id0).wrong, 7, '匯入取較大值合併');
ok(C.item_stats(id0).hard, true, '匯入 hard');

ok(C.clear_wrong() >= 1, '清空錯題有作用');
eq(C.item_stats(id0).wrong, 0, '清空後答錯歸零');
eq(C.item_stats(id0).correct, 3, '清空後答對保留');
C.reset_all(false);
eq(C.item_stats(id0).wrong, 0, '重設後統計歸零');
eq(C.summary().attempts, 0, '重設後無作答紀錄');
eq(C.settings().script, 't', '重設後偏好回到預設');

/* ============================================================ */
section('13. 搜尋（繁簡皆可）');
const target_item = mj[0];
const s_t = C.str_field(target_item, 't');
const s_s = C.str_field(target_item, 's');
const frag_t = s_t.slice(0, 2);
const frag_s = C.to_simple(frag_t);
ok(C.search_items(frag_t, items).some((it) => it.id === target_item.id), '繁體片段可搜到（' + frag_t + '）');
ok(C.search_items(frag_s, items).some((it) => it.id === target_item.id), '簡體片段可搜到（' + frag_s + '）');
eq(C.search_items('', items).length, items.length, '空查詢回傳全部');
eq(C.search_items('zzz查無此物', items).length, 0, '無命中回傳空');
ok(C.search_items(C.pair(cj[0], 'w').t, items).some((it) => it.id === cj[0].id), '可用詞語搜到詞解');
ok(C.search_items(C.str_field(cs[0], 'q_t'), items).some((it) => it.id === cs[0].id), '可用問題搜到常識');
ok(C.search_items(C.pair(mj[0], 'src').t, items).some((it) => it.id === mj[0].id), '可用出處搜到名句');

/* ============================================================ */
section('14. 顯示輔助與防禦');
eq(C.dot_html({ q_t: '窈窕【淑女】，君子好逑。' }, false), '窈窕<em class="dot">淑女</em>，君子好逑。', '【】轉為加點標記且不顯示括號');
ok(C.dot_html({ q_t: '窈窕【淑女' }, false).indexOf('</em>') >= 0, '未閉合的【 也能收尾');
const real_dot = C.dot_html(cj[0], false);
ok(real_dot.indexOf('<em class="dot">') >= 0 && real_dot.indexOf('【') < 0, '真實詞解題面有加點且無括號');
eq(C.dot_html({ q_t: 'a<b>&"c"【d】' }, false), 'a&lt;b&gt;&amp;&quot;c&quot;<em class="dot">d</em>', '加點題面的文字部分會轉義（可安全注入 HTML）');
const dot_tags = real_dot.match(/<[^>]*>/g) || [];
ok(dot_tags.every((t) => t === '<em class="dot">' || t === '</em>'), '真實題面輸出的標籤只有 <em class="dot">／</em>');
const pt = C.prompt_text(mj_real, { direction: 'hs' });
ok(pt.hint.indexOf(String(C.count_han(C.mingju_pair(mj_real, 'hs').answer_t))) >= 0, '名句提示顯示需默寫字數');
ok(C.prompt_text(cj[0], {}).html.indexOf('dot') >= 0, '詞解提示使用加點題面');
eq(C.detail(mj_real).lines.length, 1, '名句詳解含全句');
ok(C.detail(cj[0]).lines.length >= 1, '詞解詳解含解釋');
eq(C.detail(cs[0]).lines[0], C.changshi_data(cs[0]).a.t, '常識詳解為答案');
ok(!!C.detail(mj_real, { simple: true }).lines[0], '簡體詳解可用');

/* 缺欄位／空資料不得拋錯 */
let threw = null;
try {
  C.grade_text(null, 'x', {});
  C.grade_text({}, 'x', {});
  C.grade_text({ type: 'mingju' }, 'x', {});
  C.grade_text({ type: 'cijie', q_t: '【】' }, 'x', {});
  C.grade_text({ type: 'changshi' }, 'x', {});
  C.prompt_text(null, {});
  C.detail(null, {});
  C.build_options({ id: 'z', type: 'changshi' }, [], {});
  C.create_session({ module: '不存在的模組', items: [] });
  C.import_text('{}');
  C.answer_variants(null);
  C.item_stats('no-such-id');
} catch (e) { threw = e; }
ok(!threw, '缺欄位／空資料不拋錯' + (threw ? '：' + threw.message : ''));

with_dataset({}, () => {
  eq(C.items().length, 0, '無資料時 items 為空');
  eq(C.summary().item_count, 0, '無資料時統計安全');
  eq(C.create_session({ module: 'mingju' }).total, 0, '無資料時隊列為空');
  ok(C.grade_text({ type: 'changshi', a_t: '甲' }, '甲', {}).ok, '缺 t2s 時仍可判分');
  eq(C.search_items('甲').length, 0, '無資料時搜尋安全');
});

/* ============================================================ */
section('15. 全量回歸：標準答案照抄必對、繁簡混寫必對');
function mix_script(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let out = '';
  for (let i = 0; i < a.length; i++) out += i % 2 === 0 ? a[i] : b[i];
  return out;
}
const regress_fail = [];
function check_copy(item, text, label, opts) {
  if (!text) return;
  const r = C.grade_text(item, text, opts || {});
  if (!r.ok) regress_fail.push(item.id + ' ' + label + '「' + text + '」→' + (r.reason || 'mismatch'));
}
function check_mixed(item, a, b, label, opts) {
  const mixed = mix_script(a, b);
  if (!mixed) return;
  const r = C.grade_text(item, mixed, opts || {});
  if (!r.ok) regress_fail.push(item.id + ' ' + label + '混寫「' + mixed + '」→' + (r.reason || 'mismatch'));
}

mj.forEach((it) => {
  ['hs', 'sh'].forEach((dir) => {
    const p = C.mingju_pair(it, dir);
    check_copy(it, p.answer_t, dir + ' 繁體', { direction: dir });
    check_copy(it, p.answer_s, dir + ' 簡體', { direction: dir });
    check_mixed(it, p.answer_t, p.answer_s, dir, { direction: dir });
  });
});
cj.forEach((it) => {
  const d = C.cijie_data(it);
  d.a.t.forEach((a, i) => {
    check_copy(it, a, '答案' + i);
    if (d.a.s[i]) check_copy(it, d.a.s[i], '簡體答案' + i);
    if (d.a.s[i]) check_mixed(it, a, d.a.s[i], '答案' + i);
  });
});
cs.forEach((it) => {
  const d = C.changshi_data(it);
  check_copy(it, d.a.t, '答案');
  check_copy(it, d.a.s, '簡體答案');
  check_mixed(it, d.a.t, d.a.s, '答案');
  d.accept.forEach((a) => check_copy(it, a, 'accept「' + a + '」'));
});
eq(regress_fail.slice(0, 12), [], '標準答案／繁簡混寫全部判對（共 ' + (mj.length * 2 + cj.length + cs.length) + ' 題）');

/* 標點、空白、口語外殼都不應影響標準答案 */
const shell_fail = [];
function check_shell(item, text, label, opts) {
  const r = C.grade_text(item, text, opts || {});
  if (!r.ok) shell_fail.push(item.id + ' ' + label);
}
mj.slice(0, 10).forEach((it) => {
  const p = C.mingju_pair(it, 'hs');
  check_shell(it, '  ' + p.answer_t + '  ', '空白包住', { direction: 'hs' });
  check_shell(it, '，' + p.answer_t.replace(/[。！？]/g, '') + '。', '多餘標點', { direction: 'hs' });
});
cj.slice(0, 20).forEach((it) => {
  const a = C.cijie_data(it).a.t[0];
  if (a) check_shell(it, '意思是' + a, '加「意思是」');
});
cs.slice(0, 10).forEach((it) => {
  const a = C.changshi_data(it).a.t;
  check_shell(it, '指的是' + a, '加「指的是」');
  check_shell(it, '《' + a.replace(/[《》]/g, '') + '》', '換成書名號');
});
eq(shell_fail, [], '標點／空白／口語外殼不影響判分');

/* 明顯錯的答案一定要判錯（避免過度寬鬆） */
const wrong_fail = [];
['皇帝陛下駕到', '天地玄黃宇宙洪荒'].forEach((bad) => {
  cj.forEach((it) => { if (C.grade_text(it, bad, {}).ok) wrong_fail.push(it.id + ' 誤判「' + bad + '」'); });
});
eq(wrong_fail.slice(0, 5), [], '無關答案不被誤判為對');

/* ============================================================ */
section('16. 資料相容性');
let dup = {}, dup_found = [];
items.forEach((it) => { if (dup[it.id]) dup_found.push(it.id); dup[it.id] = 1; });
eq(dup_found, [], '題目 id 不重複');
let type_ok = true;
items.forEach((it) => {
  if (['mingju', 'cijie', 'changshi'].indexOf(it.type) < 0) type_ok = false;
  if (!it.unit) type_ok = false;
});
ok(type_ok, '每題都有合法 type 與 unit');
let pair_ok = true;
items.forEach((it) => {
  if (it.type === 'mingju' && (!it.t || !it.s)) pair_ok = false;
  if (it.type === 'cijie' && (!C.cijie_data(it).a.t.length)) pair_ok = false;
  if (it.type === 'changshi' && !C.changshi_data(it).a.t) pair_ok = false;
});
ok(pair_ok, '必填欄位齊全（t/s、a、a_t）');

/* ============================================================
 * 17. 名句作者・出處（v1.1）
 * ============================================================ */
section('17. 名句作者・出處');

const named = mj.find((it) => it.author_t && !C.is_anon_text(it.author_t));
ok(!!named, '題庫有名句帶具名作者');
mj.forEach((it) => {
  ok(!!it.author_t && !!it.author_s, it.id + ' 有作者欄位');
  ok(!!it.src_t && !!it.src_s, it.id + ' 有出處欄位');
  ok(!/^[^《]+《/.test(it.src_t), it.id + ' 出處不含作者');
});

if (named) {
  const expA = named.author_t;
  const expS = named.src_t;
  const okAll = C.grade_author(named, expA, expS, {});
  eq(okAll.ok, true, '作者＋出處全對 → ok');
  eq(okAll.author_ok, true, '作者全對 → author_ok');
  eq(okAll.source_ok, true, '出處全對 → source_ok');

  const badAuthor = C.grade_author(named, '某某', expS, {});
  eq(badAuthor.ok, false, '作者錯 → 整題錯');
  eq(badAuthor.source_ok, true, '作者錯但出處對 → source_ok');
  eq(badAuthor.author_ok, false, '作者錯 → author_ok=false');

  const badSource = C.grade_author(named, expA, '錯出處', {});
  eq(badSource.ok, false, '出處錯 → 整題錯');
  eq(badSource.author_ok, true, '出處錯但作者對 → author_ok');

  const shellA = C.grade_author(named, '作者是' + expA, '出處是' + expS, {});
  eq(shellA.ok, true, '「作者是／出處是」外殼也判對');

  const simpleA = C.grade_author(named, C.to_simple(expA), C.to_simple(expS), {});
  eq(simpleA.ok, true, '作者出處簡體也判對');
}

const anon = mj.find((it) => C.is_anon_text(it.author_t));
if (anon) {
  ['佚名', '無名氏', '不詳'].forEach((v) => {
    eq(C.grade_author(anon, v, anon.src_t, {}).author_ok, true, '佚名接受「' + v + '」');
  });
}

/* 作者出處選擇題：4 個選項、含正確組合、不重複 */
const opt = C.build_options(named, mj, { direction: 'author', seed: 7 });
eq(opt.options.length, 4, '作者出處選擇題 4 個選項');
eq(new Set(opt.options.map((o) => o.t)).size, 4, '作者出處選項不重複');
ok(opt.options.some((o) => C.norm(o.t) === C.norm(named.author_t + '《' + named.src_t.replace(/^《|》$/g, '') + '》') || C.norm(o.t) === C.norm(C.join_author_src(named.author_t, named.src_t))), '選項含正確作者＋出處');
ok(opt.options.every((o) => o.t.indexOf('《') >= 0), '每個選項都是「作者《出處》」格式');

/* ============================================================
 * 18. 段／次大測（v1.1）
 * ============================================================ */
section('18. 段／次大測');

ok(items.every((it) => Number.isInteger(it.seg) && it.seg >= 1), '所有題目 seg 為正整數');
ok(items.every((it) => Number.isInteger(it.exam) && it.exam >= 1), '所有題目 exam 為正整數');

const scoped = mk_items(6, 'cijie');
scoped[0].seg = 1; scoped[0].exam = 1;
scoped[1].seg = 1; scoped[1].exam = 2;
scoped[2].seg = 1; scoped[2].exam = 2;
scoped[3].seg = 2; scoped[3].exam = 1;
scoped[4].seg = 2; scoped[4].exam = 3;
scoped[5].seg = 3; scoped[5].exam = 1;
with_dataset({
  meta: { title: 't' }, units: [{ id: 'u1', name: 'u1', module: 'cijie' }],
  items: scoped, t2s: {}
}, () => {
  eq(C.filter_by_scope(scoped, { seg: '2', exam: 'all' }).length, 2, '段 2 有 2 題');
  eq(C.filter_by_scope(scoped, { seg: '2', exam: '3' }).length, 1, '段 2・第 3 次有 1 題');
  eq(C.filter_by_scope(scoped, { seg: 'all', exam: 'all' }).length, 6, '全部＝6 題');
  eq(C.exam_rows(scoped, '2').map((r) => r.value), [1, 3], '段 2 的次選項＝1,3');
  eq(C.seg_rows(scoped).map((r) => r.value), [1, 2, 3], '段選項＝1,2,3');
  const sess = C.create_session({ module: 'cijie', mode: 'practice', seg: '2', exam: '3' });
  eq(sess.total, 1, 'create_session 套用段／次 → 1 題');
});

/* ============================================================ */
console.log('\n' + '='.repeat(52));
if (failures.length) {
  console.log('失敗 ' + failures.length + ' 項，通過 ' + pass + ' 項');
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
} else {
  console.log('全部通過：' + pass + ' 項');
  process.exit(0);
}
