#!/usr/bin/env node
/* analyze_next.js — 第二部分深度分析（基于简谱重建的忠实音符序列）
 *
 * 关键区别：jianpu 数字是通过「显示调」映射回绝对音级（buildJianpu 的逆运算），
 * 这是转录层的真实输出，与定调层打分无关，不受检测错误污染（八度点只影响八度，不影响音级）。
 * 配合证据链的绝对特征（重心音/时长最长音级/结束音/Chew/稳定性模块），
 * 判断：①标注真值是否与哼唱内容一致（内容可靠性）②各模块对真实主音的支撑 ③权重搜索。
 */
const fs = require('fs');
const path = require('path');
const DATA = JSON.parse(fs.readFileSync('C:/Users/keyou/Downloads/哼唱标注数据.json', 'utf8'));

const SPELL = { 0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F', 6: 'F#', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B' };
const NAME_PC = Object.fromEntries(Object.entries(SPELL).map(([pc, nm]) => [nm, +pc]));
const SHARP_PC = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

// ---- 解析 ----
function displayKey(keyName) { // 简谱按显示调渲染：取第一个「X调」；谱面模式=关系大调
  const m = keyName.match(/([A-G]#?)\s*(大调|小调)/);
  return { root: SHARP_PC[m[1]], mode: m[2] === '大调' ? 'major' : 'minor' };
}
function detectRealKey(keyName) {
  let real = keyName; const pm = keyName.match(/（(.+?)）$/); if (pm) real = pm[1];
  const m = real.match(/([A-G]#?)\s*(大调|小调)/);
  return { root: SHARP_PC[m[1]], mode: m[2] === '大调' ? 'major' : 'minor' };
}
function noteNamePc(name) {
  const m = (name || '').match(/([A-G](?:#|b)?)(-?\d)?/);
  if (!m) return null;
  let nm = m[1];
  if (nm.length === 2 && nm[1] === 'b') nm = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' }[nm] || nm;
  return { pc: SHARP_PC[nm] != null ? SHARP_PC[nm] : NAME_PC[nm], oct: m[2] != null ? +m[2] : null };
}
function parseEvidence(item) {
  const ev = item.evidence || '';
  const f = {};
  let m = ev.match(/重心音\s+([A-G](?:#|b)?\d)/); if (m) f.centroid = noteNamePc(m[1]);
  m = ev.match(/时长最长音级\s+([A-G](?:#|b)?)/); if (m) f.dominant = noteNamePc(m[1]).pc;
  m = ev.match(/结束音\s+([A-G](?:#|b)?\d)/); if (m) f.ending = noteNamePc(m[1]);
  m = ev.match(/Chew螺旋：中心效应点最近音级\s+([A-G](?:#|b)?)\s*（置信度\s*([\d.]+)/); if (m) f.chew = { pc: noteNamePc(m[1]).pc, conf: +m[2] };
  m = ev.match(/模块主音判断\s+([A-G](?:#|b)?)([大小])/); if (m) f.stab = { pc: noteNamePc(m[1]).pc, mode: m[2] === '大' ? 'major' : 'minor' };
  return f;
}
// jianpu 文本 → 音级序列（八度点解析：点在前=高八度，在后=低八度；数字相邻=不同音）
function parseJianpu(text, dkey) {
  const scale = dkey.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  const notes = [];
  const chars = text.split('');
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (/[1-7]/.test(c)) {
      let hi = 0; let j = i - 1; while (j >= 0 && chars[j] === '·') { hi++; j--; }
      let lo = 0; let k = i + 1; while (k < chars.length && chars[k] === '·') { lo++; k++; }
      // 注意：前一音的低八度点也可能紧贴本音（"4·5"），处理：若前一个数字已消费这些点则不重复
      // 简化：只认「点直接在前」为高八度；点在后为低八度，且向前不越过已消费的数字。
      // 这里直接跳过（音级与八度无关）
      const deg = +c - 1;
      notes.push({ pc: (dkey.root + scale[deg]) % 12, oct: hi - lo, digit: c });
      i = k;
    } else i++;
  }
  return notes;
}

// ---- 评分引擎（key.js 各模块的忠实移植）----
const KS_MAJOR_RAW = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR_RAW = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const nm = a => a.map(v => v / (a.reduce((s, v) => s + v, 0) / a.length));
const MAJOR_PROF = nm(KS_MAJOR_RAW), MINOR_PROF = nm(KS_MINOR_RAW);
function shiftProf(prof, root) { const out = new Array(12); for (let i = 0; i < 12; i++) out[(i + root) % 12] = prof[i]; return out; }
function corr(x, y) {
  const n = x.length; let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxy += x[i] * y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; }
  const d = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return Math.abs(d) < 1e-12 ? 0 : (n * sxy - sx * sy) / d;
}
function dot(a, b) { let s = 0; for (let i = 0; i < 12; i++) s += a[i] * b[i]; return s; }
function scaleMembership(hist, root, mode) { const sc = (mode === 'major' ? MAJOR_SCALE : MINOR_SCALE).map(s => (root + s) % 12); return sc.reduce((m, i) => m + hist[i], 0); }
function circDist(a, b) { const d = Math.abs(a - b) % 12; return d > 6 ? 12 - d : d; }
// Chew 螺旋（key.js 同款）
const SPIRAL_A = Math.sqrt(2 / 15) * Math.PI / 2;
function pcFifths(pc) { return (((7 * pc + 6) % 12) + 12) % 12 - 6; }
function chewPos(k) { const t = k * Math.PI / 2; return { x: Math.sin(t), y: Math.cos(t), z: SPIRAL_A * t }; }
function dist3(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function chewDistances(notes) { // 返回每个音级到中心效应点的距离
  let cx = 0, cy = 0, cz = 0, wsum = 0;
  const reps = {};
  const ws = notes.map(n => n.dur || 0.25);
  ws.forEach(w => { wsum += w; });
  for (let rr = 0; rr < 3; rr++) {
    const cex = cx / wsum, cey = cy / wsum, cez = cz / wsum;
    cx = 0; cy = 0; cz = 0;
    for (let i = 0; i < notes.length; i++) {
      const pc = notes[i].pc;
      const k0 = reps[pc] != null ? reps[pc] : pcFifths(pc);
      let bestK = k0, bestD = Infinity;
      for (let kv = k0 - 12; kv <= k0 + 12; kv += 12) {
        const pv = chewPos(kv);
        const dv = (pv.x - cex) ** 2 + (pv.y - cey) ** 2 + (pv.z - cez) ** 2;
        if (dv < bestD) { bestD = dv; bestK = kv; }
      }
      reps[pc] = bestK;
      const pp = chewPos(bestK), w = ws[i];
      cx += pp.x * w; cy += pp.y * w; cz += pp.z * w;
    }
  }
  const ce = { x: cx / wsum, y: cy / wsum, z: cz / wsum };
  const ds = {};
  for (let pc = 0; pc < 12; pc++) ds[pc] = dist3(ce, chewPos(pcFifths(pc)));
  return ds;
}

// 直方图：log 压缩时长 + 平滑（与 key.js 一致，但音级来自重建序列，无音分）
function buildHist(notes, opts) {
  const hist = new Array(12).fill(0);
  let total = 0;
  for (const n of notes) {
    const w = opts.log ? Math.log2(1 + (n.dur || 0.25)) : (n.dur || 0.25);
    hist[n.pc] += w; total += w;
  }
  if (opts.smooth) { for (let i = 0; i < 12; i++) hist[i] += 0.5; total += 6; }
  for (let i = 0; i < 12; i++) hist[i] /= total;
  return hist;
}

// 通用评分：模块权重可调
function scoreRoots(rec, w) {
  const { notes, feat } = rec;
  const hist = buildHist(notes, { log: w.logComp !== false, smooth: w.smooth !== false });
  const chewDs = chewDistances(notes);
  const chewMax = Math.max(...Object.values(chewDs));
  const st = [];
  for (let root = 0; root < 12; root++) st.push(Math.max(dot(hist, shiftProf(MAJOR_PROF, root)), dot(hist, shiftProf(MINOR_PROF, root))));
  const stMin = Math.min(...st), stSpan = (Math.max(...st) - stMin) || 1;
  const scores = [];
  for (let root = 0; root < 12; root++) {
    let s = 0;
    if (w.ks) s += Math.max(corr(hist, shiftProf(MAJOR_PROF, root)) + (w.scale || 0) * scaleMembership(hist, root, 'major'),
      corr(hist, shiftProf(MINOR_PROF, root)) + (w.scale || 0) * scaleMembership(hist, root, 'minor'));
    else s += Math.max(corr(hist, shiftProf(MAJOR_PROF, root)), corr(hist, shiftProf(MINOR_PROF, root)));
    if (w.centroid && feat.centroid) s += w.centroid * (1 - circDist(feat.centroid.pc, root) / 6);
    if (w.stab) s += w.stab * ((st[root] - stMin) / stSpan);
    if (w.chew) s += w.chew * (1 - chewDs[root] / chewMax);
    if (w.ending && feat.ending && feat.ending.pc === root) s += w.ending;
    if (w.dominant && feat.dominant === root) s += w.dominant;
    if (w.guitar) s += (w.guitar * ((root === 0 || root === 7 || root === 2 || root === 9 || root === 4 || root === 5) ? 1 : 0));
    scores.push(s);
  }
  return scores;
}
function bestRootOf(s) { let b = 0; for (let i = 1; i < 12; i++) if (s[i] > s[b]) b = i; return b; }
function rankOf(arr, t) { const v = arr[t]; let r = 1; for (const x of arr) if (x > v + 1e-9) r++; return r; }

// ---- 主流程 ----
const recs = [];
for (let i = 0; i < DATA.length; i++) {
  const item = DATA[i];
  const truth = item.truth;
  const dk = displayKey(item.detected.keyName);
  const rk = detectRealKey(item.detected.keyName);
  const feat = parseEvidence(item);
  const jp = parseJianpu(item.jianpu, dk);
  // 时长建模：基准 0.4s；时长最长音级 +0.4s；结束音 1.0s（追加为最后一个音，若无则补）
  const notes = jp.map(n => ({ pc: n.pc, dur: 0.4 }));
  if (feat.dominant != null) for (const n of notes) if (n.pc === feat.dominant) n.dur += 0.4;
  if (feat.ending) {
    const last = notes[notes.length - 1];
    if (last && last.pc === feat.ending.pc) last.dur = 1.0;
    else notes.push({ pc: feat.ending.pc, dur: 1.0 });
  }
  recs.push({ i: i + 1, truth, dk, rk, feat, notes });
}

console.log('='.repeat(100));
console.log('A. 标注内容可靠性：哼唱内容（简谱重建音级 + 绝对证据） vs 标注真值');
console.log('='.repeat(100));
for (const r of recs) {
  const { truth, feat, notes } = r;
  const pcs = [...new Set(notes.map(n => n.pc))];
  const inScale = pcs.filter(p => (truth.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE).some(s => (truth.root + s) % 12 === p));
  const contentSet = pcs.map(p => SPELL[p]).join('');
  const truthScale = (truth.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE).map(s => SPELL[(truth.root + s) % 12]).join('');
  const evStr = [
    feat.centroid ? '重心' + SPELL[feat.centroid.pc] : '',
    feat.dominant != null ? '最长' + SPELL[feat.dominant] : '',
    feat.ending ? '结束' + SPELL[feat.ending.pc] : ''
  ].filter(Boolean).join(' ');
  const okCount = pcs.length - inScale.length;
  console.log(`#${r.i} 真值${SPELL[truth.root]}${truth.mode === 'major' ? '大' : '小'}[${truthScale}] 检测${r.rk.mode === 'minor' ? SPELL[r.rk.root] + '小' : SPELL[r.rk.root] + '大'}`);
  console.log(`   哼唱内容音级: {${contentSet}}  ${evStr}  →  音阶外音级 ${okCount} 个` + (okCount === 0 ? '  ✓内容与真值音阶吻合' : okCount <= 1 ? '  △轻微偏离' : '  ✗内容明显不在真值调上'));
}
console.log();

// v2.17.1 生产权重（key.js 当前值）：chew/centroid 已停用（真实标注分析结论）
const CUR = { ks: true, scale: 0.20, centroid: 0, stab: 0.10, chew: 0, ending: 0.15, dominant: 0, guitar: 0.02, logComp: true, smooth: true };
const VARIANTS = {
  cur: CUR,
  v217_old: { ...CUR, chew: 0.12, centroid: 0.04 },
  chewctr_end20: { ...CUR, ending: 0.20 },
  cand: { ...CUR, ending: 0.25 },
};
const CHOSEN = process.argv[2] || 'cur';
if (!VARIANTS[CHOSEN]) { console.error('未知 variant，可选: ' + Object.keys(VARIANTS).join(' ')); process.exit(2); }
console.log('='.repeat(100));
console.log(`B. 权重重放（variant=${CHOSEN}，重建序列 + 证据特征）`);
console.log('='.repeat(100));
let hits = 0;
for (const r of recs) {
  const s = scoreRoots(r, VARIANTS[CHOSEN]);
  const br = bestRootOf(s);
  const ok = br === r.truth.root;
  if (ok) hits++;
  const top3 = s.map((v, pc) => [pc, v]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([pc, v]) => `${SPELL[pc]} ${v.toFixed(3)}`).join(' | ');
  console.log(`#${r.i} 真值${SPELL[r.truth.root]} → 判${SPELL[br]} ${ok ? '✓' : '✗'} 真值分${s[r.truth.root].toFixed(3)} 排名${rankOf(s, r.truth.root)}  前三: ${top3}`);
}
console.log(`该权重命中 ${hits}/${recs.length}`);
console.log();
if (process.argv[2]) process.exit(0); // 指定 variant 时只做重放

console.log('='.repeat(100));
console.log('C. 权重网格搜索');
console.log('='.repeat(100));
const grids = {
  scale: [0.15, 0.20, 0.25, 0.30],
  stab: [0, 0.05, 0.10, 0.15],
  chew: [0, 0.06, 0.12, 0.20],
  centroid: [0, 0.04, 0.08],
  ending: [0, 0.15, 0.25, 0.40],
  dominant: [0, 0.10, 0.20],
  guitar: [0, 0.02],
};
let best = { hits: -1, meanRank: 99, w: null };
const all = [];
for (const sc of grids.scale) for (const sb of grids.stab) for (const cw of grids.chew) for (const ct of grids.centroid)
  for (const en of grids.ending) for (const dm of grids.dominant) for (const gu of grids.guitar) {
    const w = { ks: true, scale: sc, stab: sb, chew: cw, centroid: ct, ending: en, dominant: dm, guitar: gu, logComp: true, smooth: true };
    let h = 0, rs = 0;
    for (const r of recs) { const s = scoreRoots(r, w); if (bestRootOf(s) === r.truth.root) h++; rs += rankOf(s, r.truth.root); }
    const mr = rs / recs.length;
    if (h > best.hits || (h === best.hits && mr < best.meanRank)) best = { hits: h, meanRank: mr, w };
    all.push({ h, mr, w });
  }
all.sort((a, b) => b.h - a.h || a.mr - b.mr);
for (const x of all.slice(0, 10)) console.log(`  ${x.h}/13 均排${x.mr.toFixed(2)}  scale=${x.w.scale} stab=${x.w.stab} chew=${x.w.chew} centroid=${x.w.centroid} ending=${x.w.ending} dominant=${x.w.dominant} guitar=${x.w.guitar}`);
console.log();
console.log('最优组合逐首：');
for (const r of recs) {
  const s = scoreRoots(r, best.w);
  const br = bestRootOf(s);
  const ok = br === r.truth.root;
  console.log(`  #${r.i} 真值${SPELL[r.truth.root]} → ${SPELL[br]} ${ok ? '✓' : '✗'} 真值排名${rankOf(s, r.truth.root)} 差值${(s[r.truth.root] - s[br]).toFixed(3)}`);
}
console.log();
console.log('='.repeat(100));
console.log('D. 变体实验：乘性组合 / 排名聚合 / 无 log 压缩 / 无平滑');
console.log('='.repeat(100));
// 1) 乘性：∏(1+模块分)
function scoreMult(r) {
  const { notes, feat } = r;
  const hist = buildHist(notes, { log: true, smooth: true });
  const chewDs = chewDistances(notes);
  const chewMax = Math.max(...Object.values(chewDs));
  const st = [];
  for (let root = 0; root < 12; root++) st.push(Math.max(dot(hist, shiftProf(MAJOR_PROF, root)), dot(hist, shiftProf(MINOR_PROF, root))));
  const stMin = Math.min(...st), stSpan = (Math.max(...st) - stMin) || 1;
  const out = [];
  for (let root = 0; root < 12; root++) {
    let p = 1;
    p *= 1 + Math.max(corr(hist, shiftProf(MAJOR_PROF, root)), corr(hist, shiftProf(MINOR_PROF, root)));
    p *= 1 + 0.4 * Math.max(scaleMembership(hist, root, 'major'), scaleMembership(hist, root, 'minor'));
    p *= 1 + 0.2 * ((st[root] - stMin) / stSpan);
    p *= 1 + 0.2 * (1 - chewDs[root] / chewMax);
    if (feat.ending && feat.ending.pc === root) p *= 1.3;
    if (feat.dominant === root) p *= 1.15;
    out.push(p);
  }
  return out;
}
let h2 = 0;
for (const r of recs) { const s = scoreMult(r); if (bestRootOf(s) === r.truth.root) h2++; }
console.log(`乘性组合命中: ${h2}/13`);
// 2) 排名聚合（Borda）：各模块给 12 个根音排序，名次和最小者胜
function borda(r) {
  const { notes, feat } = r;
  const hist = buildHist(notes, { log: true, smooth: true });
  const chewDs = chewDistances(notes);
  const st = [];
  for (let root = 0; root < 12; root++) st.push(Math.max(dot(hist, shiftProf(MAJOR_PROF, root)), dot(hist, shiftProf(MINOR_PROF, root))));
  const mods = [
    Array.from({ length: 12 }, (_, root) => Math.max(corr(hist, shiftProf(MAJOR_PROF, root)), corr(hist, shiftProf(MINOR_PROF, root)))),
    Array.from({ length: 12 }, (_, root) => Math.max(scaleMembership(hist, root, 'major'), scaleMembership(hist, root, 'minor'))),
    st,
    Array.from({ length: 12 }, (_, root) => -chewDs[root]),
    Array.from({ length: 12 }, (_, root) => (feat.ending && feat.ending.pc === root ? 1 : 0)),
    Array.from({ length: 12 }, (_, root) => (feat.dominant === root ? 1 : 0)),
  ];
  const tot = new Array(12).fill(0);
  for (const mod of mods) {
    const order = mod.map((v, i) => [i, v]).sort((a, b) => b[1] - a[1]);
    order.forEach(([pc], rank) => { tot[pc] += rank; });
  }
  return tot.map(v => -v);
}
let h3 = 0;
for (const r of recs) { const s = borda(r); if (bestRootOf(s) === r.truth.root) h3++; }
console.log(`Borda 排名聚合命中: ${h3}/13`);
// 3) 无 log 压缩 / 无平滑的影响
for (const variant of [
  { name: '无log压缩', logComp: false, smooth: true },
  { name: '无平滑', logComp: true, smooth: false },
  { name: '两者都无', logComp: false, smooth: false },
]) {
  let h4 = 0;
  for (const r of recs) {
    const s = scoreRoots(r, { ...CUR, ...variant });
    if (bestRootOf(s) === r.truth.root) h4++;
  }
  console.log(`${variant.name}（其余同当前权重）命中: ${h4}/13`);
}
