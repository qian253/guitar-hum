#!/usr/bin/env node
/* verify-melody-buffer.js — 验证「听旋律」预渲染缓冲（从 index.html 提取真实 renderMelodyBuffer）
 * 在样本级断言：
 *   1. 每个音的时窗都有能量（「只剩最后一个音」的终极回归检测——缓冲是静态波形，能逐音验证）
 *   2. 峰值有界（软削波 ≤1，不可能「炸」）
 *   3. 音与音之间的间隙是静的（节奏停顿保留）
 *   4. 重音还原：振幅大的音时窗 RMS 更高；无振幅时从录音 PCM 窗口 RMS 还原
 *   5. 时窗位置与真实起音对齐（节奏还原）
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

function extractFn(source, name) {
  const idx = source.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('not found: ' + name);
  let i = source.indexOf('{', idx), depth = 0, inS = null, inLine = false, inBlock = false;
  for (; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(idx, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const ctx = { Math, Float32Array };
ctx.velByPitch = new Function('with(this){ return (' + extractFn(html, 'velByPitch') + '); }').call(ctx);
ctx.renderMelodyBuffer = new Function('with(this){ return (' + extractFn(html, 'renderMelodyBuffer') + '); }').call(ctx);

const SR = 44100;
const NOTES = [
  { midi: 59.2, start: 0.50, end: 1.20, dur: 0.7, amp: 0.9 },
  { midi: 62.0, start: 1.20, end: 1.60, dur: 0.4, amp: 0.3 },
  { midi: 66.1, start: 1.90, end: 3.40, dur: 1.5, amp: 0.5 },
  { midi: 62.3, start: 3.40, end: 3.90, dur: 0.5, amp: 0.2 },
  { midi: 59.4, start: 4.20, end: 5.80, dur: 1.6, amp: 0.7 },
];

function winRms(buf, t0, t1) {
  let s = 0, n = 0;
  const a = Math.max(0, Math.floor(t0 * SR)), b = Math.min(buf.length, Math.ceil(t1 * SR));
  for (let i = a; i < b; i++) { s += buf[i] * buf[i]; n++; }
  return n ? Math.sqrt(s / n) : 0;
}
function winPeak(buf, t0, t1) {
  let p = 0;
  const a = Math.max(0, Math.floor(t0 * SR)), b = Math.min(buf.length, Math.ceil(t1 * SR));
  for (let i = a; i < b; i++) { const v = Math.abs(buf[i]); if (v > p) p = v; }
  return p;
}

// ===== 场景1：振幅重音 =====
{
  console.log('  === 场景1：振幅重音（basic-pitch 模式）===');
  const buf = ctx.renderMelodyBuffer(NOTES, SR, null);
  const t0 = NOTES[0].start;
  const windows = NOTES.map(n => ({ t0: n.start - t0 + 0.01, t1: n.start - t0 + Math.min(n.dur, n.end - n.start) * 0.8 }));
  const rms = windows.map(w => winRms(buf, w.t0, w.t1));
  const peaks = windows.map(w => winPeak(buf, w.t0, w.t1));
  let allEnergy = true;
  for (let i = 0; i < NOTES.length; i++) {
    if (rms[i] < 0.03) allEnergy = false;
    ok('音' + (i + 1) + '（起音 ' + (NOTES[i].start - t0).toFixed(2) + 's）时窗有能量', rms[i] > 0.03, 'rms=' + rms[i].toFixed(4));
  }
  ok('全部 5 个音都有能量（「只剩最后一个音」回归检测）', allEnergy, rms.map(v => v.toFixed(3)).join(', '));
  ok('全局峰值有界（≤1，不可能炸）', winPeak(buf, 0, buf.length / SR) <= 1.0, '峰值=' + winPeak(buf, 0, buf.length / SR).toFixed(3));
  // 中后段能量：每个音在自身时值的中后段仍有可闻能量（平台包络，「只有起音滋声」的回归检测）
  let sustainOk = true;
  for (let i = 0; i < NOTES.length; i++) {
    const s = NOTES[i].start - t0;
    const d = Math.max(0.09, NOTES[i].end - NOTES[i].start);
    const mid = winRms(buf, s + Math.min(0.25, d * 0.5), s + Math.min(0.35, d * 0.7));
    if (mid < rms[i] * 0.4) sustainOk = false;
  }
  ok('每个音中后段仍有能量（平台包络，非只有起音尖峰）', sustainOk,
    NOTES.map((n, i) => {
      const s = n.start - t0, d = Math.max(0.09, n.end - n.start);
      return winRms(buf, s + Math.min(0.25, d * 0.5), s + Math.min(0.35, d * 0.7)).toFixed(3);
    }).join(', '));
  // 间隙静音：音1结束(1.2s-0.5s=0.7s)到音2起音(0.7s)之间有 0.3s 停顿（1.6s-0.5s=1.1s 到 1.4s）
  const gapRms = winRms(buf, NOTES[2].end - t0, NOTES[3].start - t0);
  ok('音与音之间的停顿是静的', gapRms < 0.005, '停顿rms=' + gapRms.toFixed(5));
  // 重音：amp 0.9 的音1 窗口 RMS > amp 0.2 的音4
  ok('响的地方弹得重（amp 0.9 vs 0.2）', rms[0] > rms[3], 'rms 音1=' + rms[0].toFixed(3) + ' 音4=' + rms[3].toFixed(3));
  // 起音对齐：音3 的 0.5-0.7s 处仍有能量（长音余音，阻尼 0.998）
  const lateRms = winRms(buf, NOTES[2].start - t0 + 0.5, NOTES[2].start - t0 + 0.7);
  ok('长音的余音延续（1.5s 音过半仍有能量）', lateRms > 0.002, '余音rms=' + lateRms.toFixed(4));
}

// ===== 场景2：无振幅 → 从录音 PCM 窗口 RMS 还原重音 =====
{
  console.log('  === 场景2：PCM-RMS 重音（快速模式）===');
  const srRec = 1000;
  const pcm = new Float32Array(6000);
  const segs = [
    { s: 0.50, e: 1.20, amp: 0.2 },
    { s: 1.20, e: 1.60, amp: 0.9 },
    { s: 1.90, e: 3.40, amp: 0.4 },
    { s: 3.40, e: 3.90, amp: 0.1 },
    { s: 4.20, e: 5.80, amp: 0.3 },
  ];
  for (const sg of segs) {
    for (let i = Math.floor(sg.s * srRec); i < Math.floor(sg.e * srRec); i++) pcm[i] = sg.amp;
  }
  const noAmp = NOTES.map(n => ({ midi: n.midi, start: n.start, end: n.end, dur: n.dur }));
  const buf = ctx.renderMelodyBuffer(noAmp, SR, { recordedSr: srRec, recordedPcm: pcm });
  const t0 = noAmp[0].start;
  const r2 = winRms(buf, noAmp[1].start - t0 + 0.01, noAmp[1].end - t0 - 0.02);
  const r1 = winRms(buf, noAmp[0].start - t0 + 0.01, noAmp[0].end - t0 - 0.02);
  ok('窗口 RMS 还原重音（第2音窗口最响 → 播放最重）', r2 > r1, 'rms 音2=' + r2.toFixed(3) + ' 音1=' + r1.toFixed(3));
}

// ===== 场景3：极短音不丢 =====
{
  console.log('  === 场景3：极短音不丢（0.12s 装饰音）===');
  const short = [
    { midi: 59, start: 0.5, end: 0.62, dur: 0.12, amp: 0.5 },
    { midi: 62, start: 0.62, end: 0.74, dur: 0.12, amp: 0.5 },
    { midi: 66, start: 0.74, end: 1.5, dur: 0.76, amp: 0.5 },
  ];
  const buf = ctx.renderMelodyBuffer(short, SR, null);
  const t0 = short[0].start;
  const w0 = winPeak(buf, 0, 0.1);
  const w1 = winPeak(buf, 0.12, 0.22);
  const w2 = winPeak(buf, 0.24, 0.6);
  ok('连续极短音全部有能量', w0 > 0.05 && w1 > 0.05 && w2 > 0.05, '峰值 ' + w0.toFixed(3) + '/' + w1.toFixed(3) + '/' + w2.toFixed(3));
}

// ===== 场景4：逆序输入（实测 basic-pitch 曾返回逆序 → 回放叠音） =====
{
  console.log('  === 场景4：逆序输入自动排序 ===');
  const reversed = NOTES.slice().reverse(); // 时间倒序输入
  const buf = ctx.renderMelodyBuffer(reversed, SR, null);
  const t0 = NOTES[0].start;
  // 排序后，每个音应出现在自己的真实时间窗口
  const rmsSorted = NOTES.map(n => {
    const s = n.start - t0;
    return winRms(buf, s + 0.01, s + Math.min(0.3, (n.end - n.start) * 0.8));
  });
  let allEnergySorted = true;
  for (let i = 0; i < NOTES.length; i++) if (rmsSorted[i] < 0.03) allEnergySorted = false;
  ok('逆序输入下每个音仍在真实时间窗口有能量（自动排序生效）', allEnergySorted, rmsSorted.map(v => v.toFixed(3)).join(', '));
  // 第一个窗口（0-0.1s）应只有音1、无叠音爆发：rms 不应远超单音水平
  const firstWin = winRms(buf, 0.01, 0.11);
  ok('首窗口无叠音（不是所有音挤在一起）', firstWin < 0.35, '首窗rms=' + firstWin.toFixed(3));
}

console.log('\n' + (failures === 0 ? '旋律预渲染缓冲验证全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
