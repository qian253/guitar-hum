#!/usr/bin/env node
/* judge-test.js — 验证"关系大小调裁判模块"算法（独立于 key.js 先跑通逻辑）
 * 四条规则（按优先级加权）：
 *   1) 导音解决（最有力）：X→主音 的小二度上行解决
 *   2) 落点音：曲末音符权重×5 后重算相关性
 *   3) 主和弦骨架音：大调三和弦 vs 小调三和弦的权重差
 *   4) 大调优先：兜底偏 major
 */
const KS_M = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_N = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const nm = p => { const m = p.reduce((a, b) => a + b, 0) / p.length; return p.map(v => v / m); };
const MP = nm(KS_M), NP = nm(KS_N);
const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
const SPELL = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pcOf = m => ((m % 12) + 12) % 12;

function corr(x, y) {
  const n = x.length; let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxy += x[i] * y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; }
  const d = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return d ? (n * sxy - sx * sy) / d : 0;
}
function shift(p, r) { const o = new Array(12); for (let i = 0; i < 12; i++) o[(i + r) % 12] = p[i]; return o; }
function memb(hist, root, mode) {
  const sc = (mode === 'major' ? MAJ : MIN).map(s => (root + s) % 12);
  let m = 0; for (let i = 0; i < 12; i++) if (sc.indexOf(i) >= 0) m += hist[i];
  return m;
}
function makeHist(notes, endBoost) {
  const hist = new Array(12).fill(0); let tot = 0;
  notes.forEach((n, i) => {
    const d = n.dur || 0.25;
    const w = (endBoost && i >= notes.length - 2) ? d * 5 : d; // 规则2：落点音×5
    hist[pcOf(n.midi)] += w; tot += w;
  });
  return hist.map(v => v / tot);
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// 裁判模块：输入 notes + 关系大小调对（majorPC/minorPC），返回 [-1,1]（>0 偏大调）
function judge(notes, majorPC, minorPC) {
  // 规则1：导音解决（最有力）
  let lead = 0;
  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1].midi, cur = notes[i].midi;
    const step = cur - prev; // 音高差（半音）
    // 大调导音：prev 比主音低半音，上行解决到主音
    if (Math.abs(step - 1) <= 0.5 && Math.abs(pcOf(cur) - majorPC) <= 0.5) lead += 1;
    // 小调导音：prev 比主音低半音，上行解决到主音（自然小调的导音是调外音，特意升高）
    if (Math.abs(step - 1) <= 0.5 && Math.abs(pcOf(cur) - minorPC) <= 0.5) lead -= 1;
  }
  if (lead > 2) lead = 2; if (lead < -2) lead = -2;
  const E_lead = lead / 2;

  // 规则2：落点音×5 后重算相关性
  const hEnd = makeHist(notes, true);
  const majEnd = corr(hEnd, shift(MP, majorPC)) + 0.20 * memb(hEnd, majorPC, 'major');
  const minEnd = corr(hEnd, shift(NP, minorPC)) + 0.20 * memb(hEnd, minorPC, 'minor');
  const E_end = clamp((majEnd - minEnd) / 0.30, -1, 1);

  // 规则3：主和弦骨架音
  const hBase = makeHist(notes, false);
  const majTri = [(majorPC) % 12, (majorPC + 4) % 12, (majorPC + 7) % 12];
  const minTri = [(minorPC) % 12, (minorPC + 3) % 12, (minorPC + 7) % 12];
  let mTri = 0, nTri = 0;
  majTri.forEach(p => mTri += hBase[p]);
  minTri.forEach(p => nTri += hBase[p]);
  const E_triad = clamp((mTri - nTri) / 0.40, -1, 1);

  // 规则4：大调优先（兜底）
  const E_major = 0.05;

  const score = 0.40 * E_lead + 0.30 * E_end + 0.25 * E_triad + E_major;
  return {
    score, E_lead: E_lead.toFixed(2), E_end: E_end.toFixed(2), E_triad: E_triad.toFixed(2),
    verdict: score >= 0 ? 'major' : 'minor'
  };
}

// 测试用例：notes + 期望调（majorPC=关系大调主音, minorPC=关系小调主音）
const cases = [
  // 暧昧场景：F大调 vs Dm小调 (majorPC=5 F, minorPC=2 D)
  ['暧昧式:D突出(期望大调F)', [65, 69, 72, 74, 77, 72, 74, 62], 5, 2, 'major'],
  ['F大调:落尾F(期望F大)', [65, 67, 69, 70, 72, 69, 67, 65], 5, 2, 'major'],
  ['F大调:落尾A(期望F大)', [65, 67, 69, 70, 72, 74, 72, 69], 5, 2, 'major'],
  ['F大调:带导音E->F(期望F大)', [64, 65, 69, 72, 77, 72, 69, 65], 5, 2, 'major'],
  // 真小调场景：Am vs C大调 (majorPC=0 C, minorPC=9 A)
  ['真小调Am:带导音G#->A(期望Am小)', [56, 57, 60, 64, 60, 57, 60, 57], 0, 9, 'minor'],
  ['真小调Am:落尾A(期望Am小)', [57, 60, 62, 64, 67, 64, 62, 60, 57], 0, 9, 'minor'],
  ['真小调Am:完整进行(期望Am小)', [57, 60, 64, 65, 67, 64, 62, 60, 57], 0, 9, 'minor'],
  // 大调场景：C大调 vs Am (majorPC=0, minorPC=9)
  ['C大调:完整(期望C大)', [60, 62, 64, 65, 67, 69, 71, 72], 0, 9, 'major'],
  ['C大调:落尾G五音(期望C大)', [60, 62, 64, 67, 69, 67, 64, 67], 0, 9, 'major'],
  // Em vs G大调 (majorPC=7, minorPC=4)
  ['真小调Em:落尾E(期望Em小)', [52, 55, 57, 59, 62, 59, 57, 55, 52], 7, 4, 'minor'],
  ['G大调:落尾G(期望G大)', [55, 59, 62, 64, 67, 64, 62, 59, 55], 7, 4, 'major'],
];

let pass = 0, fail = 0;
cases.forEach(c => {
  const notes = c[1].map(m => ({ midi: m, dur: 0.4 }));
  const r = judge(notes, c[2], c[3]);
  const ok = r.verdict === c[4];
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL'), c[0].padEnd(22),
    '→', r.verdict === 'major' ? SPELL[c[2]] + '大' : SPELL[c[3]] + '小',
    '| 总分', r.score.toFixed(2),
    '| 导音', r.E_lead, '落点', r.E_end, '骨架', r.E_triad);
});
console.log(`\n${pass}/${cases.length} 通过`);
process.exit(fail ? 1 : 0);
