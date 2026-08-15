#!/usr/bin/env node
/* analyze_deep.js — 13 首真实哼唱标注深度解剖（第二部分）
 *
 * 与 replay_annotations.js（用简谱重建）不同：本脚本从证据链的
 * 「音级稳定性」数组反解出 detectKey 实际使用的时长加权直方图 hist
 * （稳定性_i = hist[pc_i] × sProf[pc_i] / degSum × 100，Σhist=1 → 可逆），
 * 再逐模块看「真实主音在各证据里的排名」，找落点失败的根因。
 *
 * 输出：
 *   A. 反解 hist 与证据自检（argmax(hist) 应≈时长最长音级）
 *   B. 每首：真实调音阶含 hist 多少质量（判断是"唱偏"还是"算法偏"）
 *   C. 真实主音在 9 个证据模块中的排名（1=第一名）
 *   D. 当前公式重放 vs 系统实际判定
 *   E. 模块组合网格搜索：最大化真实主音命中率
 */
const fs = require('fs');
const path = require('path');

const DATA = JSON.parse(fs.readFileSync('C:/Users/keyou/Downloads/哼唱标注数据.json', 'utf8'));
const KEY_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'key.js'), 'utf8');

// ---------- 音名表 ----------
const SPELL = { 0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F', 6: 'F#', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B' };
const NAME_PC = Object.fromEntries(Object.entries(SPELL).map(([pc, nm]) => [nm, +pc]));
// 检测结果显示用升号记法（A#小调）
const SHARP_PC = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

const KS_MAJOR_RAW = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR_RAW = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function normMean(a) { const m = a.reduce((s, v) => s + v, 0) / a.length; return a.map(v => v / m); }
const MAJOR_PROF = normMean(KS_MAJOR_RAW);
const MINOR_PROF = normMean(KS_MINOR_RAW);
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

function shiftProf(prof, root) { const out = new Array(12); for (let i = 0; i < 12; i++) out[(i + root) % 12] = prof[i]; return out; }
function corr(x, y) {
  const n = x.length; let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxy += x[i] * y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; }
  const denom = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return Math.abs(denom) < 1e-12 ? 0 : (n * sxy - sx * sy) / denom;
}
function dot(a, b) { let s = 0; for (let i = 0; i < 12; i++) s += a[i] * b[i]; return s; }
function scaleMembership(hist, root, mode) {
  const scale = (mode === 'major' ? MAJOR_SCALE : MINOR_SCALE).map(s => (root + s) % 12);
  return scale.reduce((m, i) => m + hist[i], 0);
}
function circDist(a, b) { const d = Math.abs(a - b) % 12; return d > 6 ? 12 - d : d; }

// ---------- 解析检测结果（真实调） ----------
function detectRootMode(keyName) {
  let real = keyName;
  const pm = keyName.match(/（(.+?)）$/);
  if (pm) real = pm[1];
  const m = real.match(/([A-G]#?)\s*(大调|小调)/);
  if (!m) return null;
  return { root: SHARP_PC[m[1]], mode: m[2] === '大调' ? 'major' : 'minor' };
}
function noteNamePc(name) { // 证据链用降号记法，如 Db4 → {pc:1, oct:4}
  const m = (name || '').match(/([A-G](?:#|b)?)(-?\d)?/);
  if (!m) return null;
  let nm = m[1];
  if (nm.length === 2 && nm[1] === 'b') {
    nm = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E' }[nm] || nm;
  }
  return { pc: SHARP_PC[nm] != null ? SHARP_PC[nm] : NAME_PC[nm], oct: m[2] != null ? +m[2] : null };
}

// ---------- 反解 hist ----------
function recoverHist(item) {
  const det = detectRootMode(item.detected.keyName);
  if (!det) return null;
  const ev = item.evidence || '';
  const stabM = ev.match(/音级稳定性（模块主音判断[^）]*）：(.+?)(?:；Chew|$)/);
  if (!stabM) return null;
  const toks = stabM[1].split('/').map(t => t.trim()).filter(Boolean);
  const vals = {};
  let curName = null;
  for (const t of toks) {
    const nmM = t.match(/([A-G](?:#|b)?)\s+([\d.]+)/);
    if (nmM) { curName = nmM[1]; vals[curName] = +nmM[2]; }
    else { const vM = t.match(/[\d.]+/); if (vM && curName) vals[curName] = +vM[0]; }
  }
  if (Object.keys(vals).length !== 12) return null;
  // 检测调的音级稳定性：顺序从 det.root 半音上行；profile 用检测到的调式
  const prof = det.mode === 'major' ? MAJOR_PROF : MINOR_PROF;
  const w = new Array(12).fill(0);
  let wsum = 0;
  for (const [nm, v] of Object.entries(vals)) {
    const pc = noteNamePc(nm).pc;
    const idx = (pc - det.root + 12) % 12;
    if (prof[idx] <= 0) return null;
    w[pc] = v / prof[idx];
    wsum += w[pc];
  }
  if (wsum <= 0) return null;
  const hist = w.map(x => x / wsum);
  return { hist, detRoot: det.root, detMode: det.mode };
}

// ---------- 证据特征 ----------
function parseFeatures(item) {
  const ev = item.evidence || '';
  const f = {};
  let m = ev.match(/重心音\s+([A-G](?:#|b)?\d)/); if (m) f.centroid = noteNamePc(m[1]);
  m = ev.match(/时长最长音级\s+([A-G](?:#|b)?)/); if (m) f.dominant = noteNamePc(m[1]).pc;
  m = ev.match(/结束音\s+([A-G](?:#|b)?\d)/); if (m) f.ending = noteNamePc(m[1]);
  m = ev.match(/Chew螺旋：中心效应点最近音级\s+([A-G](?:#|b)?)\s*（置信度\s*([\d.]+)/); if (m) f.chew = { pc: noteNamePc(m[1]).pc, conf: +m[2] };
  m = ev.match(/模块主音判断\s+([A-G](?:#|b)?)([大小])/); if (m) f.stab = { pc: noteNamePc(m[1]).pc, mode: m[2] === '大' ? 'major' : 'minor' };
  return f;
}

// ---------- 各模块对真实主音的排名 ----------
function moduleRanks(hist, feat, truthRoot) {
  const r = {};
  // 1) K-S 相关（大调/小调/取大）
  const ksM = [], ksN = [], ksMax = [];
  for (let root = 0; root < 12; root++) {
    ksM.push(corr(hist, shiftProf(MAJOR_PROF, root)));
    ksN.push(corr(hist, shiftProf(MINOR_PROF, root)));
    ksMax.push(Math.max(ksM[root], ksN[root]));
  }
  r.ksMajor = rankOf(ksM, truthRoot);
  r.ksMinor = rankOf(ksN, truthRoot);
  r.ksMax = rankOf(ksMax, truthRoot);
  // 2) 音阶成员（大调/小调/取大）
  const smM = [], smN = [], smMax = [];
  for (let root = 0; root < 12; root++) {
    smM.push(scaleMembership(hist, root, 'major'));
    smN.push(scaleMembership(hist, root, 'minor'));
    smMax.push(Math.max(smM[root], smN[root]));
  }
  r.scaleMax = rankOf(smMax, truthRoot);
  r.scaleMajor = rankOf(smM, truthRoot);
  // 3) 稳定性点积（取大/小较大）
  const st = [];
  for (let root = 0; root < 12; root++) st.push(Math.max(dot(hist, shiftProf(MAJOR_PROF, root)), dot(hist, shiftProf(MINOR_PROF, root))));
  r.stab = rankOf(st, truthRoot);
  // 4) 重心距离
  if (feat.centroid) {
    const cd = []; for (let root = 0; root < 12; root++) cd.push(-circDist(feat.centroid.pc, root));
    r.centroid = rankOf(cd, truthRoot);
  }
  // 5) 时长最长音级
  if (feat.dominant != null) r.dominant = rankOfMatch(feat.dominant, truthRoot);
  // 6) 结束音
  if (feat.ending) r.ending = rankOfMatch(feat.ending.pc, truthRoot);
  // 7) Chew 螺旋（虚拟音符重建）
  const chewNearest = chewFromHist(hist);
  if (chewNearest != null) r.chew = rankOfMatch(chewNearest, truthRoot);
  return { ranks: r, ksMax, smMax, st };
}
function rankOf(arr, target) { // 1 = 最高分（并列取最小名次）
  const v = arr[target]; let rank = 1;
  for (const x of arr) if (x > v + 1e-9) rank++;
  return rank;
}
function rankOfMatch(pc, truthRoot) { return pc === truthRoot ? 1 : 2; }

// Chew 螺旋：用 hist 虚拟音符（每个音级一音，质量=hist）重建中心效应点
function chewFromHist(hist) {
  const SPIRAL_A = Math.sqrt(2 / 15) * Math.PI / 2;
  function pcFifths(pc) { return (((7 * pc + 6) % 12) + 12) % 12 - 6; }
  function pos(k) { const t = k * Math.PI / 2; return { x: Math.sin(t), y: Math.cos(t), z: SPIRAL_A * t }; }
  let cx = 0, cy = 0, cz = 0;
  for (let pc = 0; pc < 12; pc++) {
    const p = pos(pcFifths(pc));
    cx += p.x * hist[pc]; cy += p.y * hist[pc]; cz += p.z * hist[pc];
  }
  const ce = { x: cx, y: cy, z: cz };
  let best = 0, bestD = Infinity;
  for (let pc = 0; pc < 12; pc++) {
    const p = pos(pcFifths(pc));
    const d = Math.hypot(p.x - ce.x, p.y - ce.y, p.z - ce.z);
    if (d < bestD) { bestD = d; best = pc; }
  }
  return best;
}

// ---------- 当前公式重放（参数可调） ----------
const SCALE_BONUS = 0.20, CENTROID_WEIGHT = 0.04, STABILITY_WEIGHT = 0.10, CHEW_WEIGHT = 0.12,
  ENDING_BONUS = 0.15, GUITAR_BIAS = 0.02;
const GUILD = { major: [0, 7, 2, 9, 4, 5], minor: [0, 7, 2, 5] };

function tonicScores(hist, feat, w) {
  // w = {scale, centroid, stab, chew, ending, dominant, guitar}
  const st = [];
  for (let root = 0; root < 12; root++) st.push(Math.max(dot(hist, shiftProf(MAJOR_PROF, root)), dot(hist, shiftProf(MINOR_PROF, root))));
  const smMax = [];
  for (let root = 0; root < 12; root++) smMax.push(Math.max(scaleMembership(hist, root, 'major'), scaleMembership(hist, root, 'minor')));
  const stMin = Math.min(...st), stSpan = (Math.max(...st) - stMin) || 1;
  const chewD = [];
  if (feat.chew != null) {
    // 用真实 Chew 候选做距离近似：候选=0，其他=按音级差
    for (let root = 0; root < 12; root++) chewD.push(circDist(feat.chew.pc, root));
  } else {
    const nearest = chewFromHist(hist);
    for (let root = 0; root < 12; root++) chewD.push(circDist(nearest, root));
  }
  const scores = [];
  for (let root = 0; root < 12; root++) {
    let s = 0;
    s += corr(hist, shiftProf(MAJOR_PROF, root)) + (w.scale != null ? w.scale : SCALE_BONUS) * smMax[root];
    if (feat.centroid && w.centroid) s += w.centroid * (1 - circDist(feat.centroid.pc, root) / 6);
    if (w.stab) s += w.stab * ((st[root] - stMin) / stSpan);
    if (w.chew) s += w.chew * (1 - chewD[root] / 6);
    if (w.ending && feat.ending && feat.ending.pc === root) s += w.ending;
    if (w.dominant && feat.dominant === root) s += w.dominant;
    if (w.guitar) s += (GUILD.major.indexOf(root) >= 0 || GUILD.minor.indexOf(root) >= 0) ? w.guitar : 0;
    scores.push(s);
  }
  return scores;
}
function bestRootOf(scores) {
  let b = 0; for (let i = 1; i < 12; i++) if (scores[i] > scores[b]) b = i;
  return b;
}

// ---------- 主流程 ----------
console.log('='.repeat(88));
console.log('A. 反解 hist 自检（argmax(hist) 应≈证据里的时长最长音级）');
console.log('='.repeat(88));
const rows = [];
for (let i = 0; i < DATA.length; i++) {
  const item = DATA[i];
  const truth = item.truth;
  const det = detectRootMode(item.detected.keyName);
  const feat = parseFeatures(item);
  const rh = recoverHist(item);
  if (!rh) { console.log(`#${i + 1} 无法反解 hist`); continue; }
  const { hist } = rh;
  let argmax = 0; for (let p = 1; p < 12; p++) if (hist[p] > hist[argmax]) argmax = p;
  const truthMembership = scaleMembership(hist, truth.root, truth.mode);
  const bestScale = Math.max(...Array.from({ length: 12 }, (_, root) => scaleMembership(hist, root, truth.mode)));
  const bestScaleRoot = Array.from({ length: 12 }, (_, root) => scaleMembership(hist, root, truth.mode)).indexOf(bestScale);
  const top3 = hist.map((v, pc) => [pc, v]).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([pc, v]) => `${SPELL[pc]} ${(v * 100).toFixed(0)}%`).join('  ');
  const mr = moduleRanks(hist, feat, truth.root).ranks;
  rows.push({ i, item, truth, det, feat, hist, mr, truthMembership, bestScale, bestScaleRoot });
  console.log(`#${i + 1} 真实 ${SPELL[truth.root]}${truth.mode === 'major' ? '大' : '小'} → 检测 ${item.detected.keyName}`);
  console.log(`   hist 前三: ${top3}   | 最长音级(证据): ${feat.dominant != null ? SPELL[feat.dominant] : '—'} | argmax(hist): ${SPELL[argmax]}`);
  console.log(`   真实调音阶含质量: ${(truthMembership * 100).toFixed(0)}%  | 最贴合音阶: ${SPELL[bestScaleRoot]}${truth.mode === 'major' ? '大' : '小'}(${(bestScale * 100).toFixed(0)}%)`);
  console.log(`   真实主音排名: K-S大调${mr.ksMajor} K-S小调${mr.ksMinor} 取大${mr.ksMax} 音阶取大${mr.scaleMax} 稳定${mr.stab} 重心${mr.centroid ?? '—'} 最长${mr.dominant ?? '—'} 结束${mr.ending ?? '—'} Chew${mr.chew ?? '—'}`);
}
console.log();

console.log('='.repeat(88));
console.log('B. 当前公式重放（无结束音加成 = 录制时实际算法；含 = 最新未提交版）');
console.log('='.repeat(88));
let hitOld = 0, hitNew = 0;
for (const r of rows) {
  const truth = r.truth;
  const cur = { scale: SCALE_BONUS, centroid: CENTROID_WEIGHT, stab: STABILITY_WEIGHT, chew: CHEW_WEIGHT, ending: 0, dominant: 0, guitar: GUITAR_BIAS };
  const oldRoot = bestRootOf(tonicScores(r.hist, r.feat, cur));
  const newRoot = bestRootOf(tonicScores(r.hist, r.feat, { ...cur, ending: ENDING_BONUS }));
  const detRoot = detectRootMode(r.item.detected.keyName).root;
  if (oldRoot === truth.root) hitOld++;
  if (newRoot === truth.root) hitNew++;
  console.log(`#${r.i + 1} 真实${SPELL[truth.root]} 系统实际检测${SPELL[detRoot]} | 重放(旧公式)${SPELL[oldRoot]} ${oldRoot === truth.root ? '✓' : '✗'} (新公式+结束0.15)${SPELL[newRoot]} ${newRoot === truth.root ? '✓' : '✗'}`);
}
console.log(`重放(旧公式) 命中 ${hitOld}/13 | 重放(新公式) 命中 ${hitNew}/13 | 系统实际 2/13`);
console.log();

console.log('='.repeat(88));
console.log('C. 模块权重网格搜索（最大化真实主音命中）');
console.log('='.repeat(88));
const grids = {
  scale: [0.15, 0.20, 0.25, 0.30, 0.40],
  stab: [0, 0.05, 0.10, 0.15],
  chew: [0, 0.06, 0.12],
  centroid: [0, 0.04],
  ending: [0, 0.15, 0.25, 0.40],
  dominant: [0, 0.10, 0.20],
  guitar: [0, 0.02],
};
let best = { hits: -1, meanRank: 999, w: null };
const results = [];
for (const sc of grids.scale) for (const sb of grids.stab) for (const cw of grids.chew) for (const ct of grids.centroid) for (const en of grids.ending) for (const dm of grids.dominant) for (const gu of grids.guitar) {
  const w = { scale: sc, stab: sb, chew: cw, centroid: ct, ending: en, dominant: dm, guitar: gu };
  let hits = 0, rankSum = 0;
  for (const r of rows) {
    const scores = tonicScores(r.hist, r.feat, w);
    const br = bestRootOf(scores);
    if (br === r.truth.root) hits++;
    rankSum += rankOf(scores, r.truth.root);
  }
  const meanRank = rankSum / rows.length;
  if (hits > best.hits || (hits === best.hits && meanRank < best.meanRank)) best = { hits, meanRank, w };
  results.push({ w, hits, meanRank });
}
results.sort((a, b) => b.hits - a.hits || a.meanRank - b.meanRank);
console.log('前 12 名组合（命中数 / 平均排名）：');
for (const r of results.slice(0, 12)) {
  console.log(`  ${r.hits}/13 均值排名${r.meanRank.toFixed(2)}  scale=${r.w.scale} stab=${r.w.stab} chew=${r.w.chew} centroid=${r.w.centroid} ending=${r.w.ending} dominant=${r.w.dominant} guitar=${r.w.guitar}`);
}
console.log();
console.log(`最优组合命中 ${best.hits}/13：`);
console.log(JSON.stringify(best.w));
console.log();
console.log('最优组合逐首明细：');
for (const r of rows) {
  const scores = tonicScores(r.hist, r.feat, best.w);
  const br = bestRootOf(scores);
  const srt = rankOf(scores, r.truth.root);
  const top2 = scores.map((s, pc) => [pc, s]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([pc, s]) => `${SPELL[pc]}(${s.toFixed(3)})`).join(' ');
  console.log(`  #${r.i + 1} 真实${SPELL[r.truth.root]} → 判${SPELL[br]} ${br === r.truth.root ? '✓' : '✗'} 真实排名${srt} 前二: ${top2}`);
}
