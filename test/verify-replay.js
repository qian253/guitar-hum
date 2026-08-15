#!/usr/bin/env node
/* verify-replay.js — 验证「听旋律」节奏/重音还原（从 index.html 提取真实 replayMelody 模拟运行）
 * 检查：
 *   1. 每个音都被调度且按顺序发声（不丢音）
 *   2. 起音时刻 = 真实 start 归一化（快慢/停顿保留）
 *   3. 走 K-S 专用通道（playMelodyNote，不经采样器——采样器连续多音在部分浏览器只剩最后音）
 *   4. 重音还原：basic-pitch 振幅 → 力度；无振幅时从录音 PCM 按窗口 RMS 算力度
 *   5. 音长不压过下一音起音；浮点 midi 保留（音分偏移不丢）
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

function extractFn(source, name, isAsync) {
  const idx = source.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('not found: ' + name);
  const start = (isAsync && idx >= 6 && source.slice(idx - 6, idx) === 'async ') ? idx - 6 : idx;
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
    else if (c === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const NOTES = [
  { midi: 59.2, start: 0.50, end: 1.20, dur: 0.7, amp: 0.9 },
  { midi: 62.0, start: 1.20, end: 1.60, dur: 0.4, amp: 0.3 },
  { midi: 66.1, start: 1.90, end: 3.40, dur: 1.5, amp: 0.5 },
  { midi: 62.3, start: 3.40, end: 3.90, dur: 0.5, amp: 0.2 },
  { midi: 59.4, start: 4.20, end: 5.80, dur: 1.6, amp: 0.7 },
];

async function runCase(name, opts) {
  const calls = [];       // {midi, dur, vel, t}（playMelodyNote 捕获）
  const timers = [];      // {fn, delay}
  const ctx = {
    recordedNotes: opts.notes || NOTES,
    lastKeyResult: { rootPC: 11 },
    melodyTimers: [],
    diag: { lastReplay: null },
    state: opts.state || { recordedSr: 44100, recordedPcm: null },
    now: 0,
    stopAllTones: function () {},
    ensureAudioStarted: async function () {},
    waitSampler: async function () { return false; },
    $: function () { return { querySelectorAll: function () { return []; } }; },
    velByPitch: function (midi, base) { return Math.max(0.62, Math.min(0.95, (base || 0.9) - (midi - 60) * 0.006)); },
    setTimeout: function (fn, delay) { timers.push({ fn: fn, delay: delay }); return timers.length; },
    clearTimeout: function () {},
  };
  ctx.playMelodyNote = function (midi, dur, vel) {
    calls.push({ midi: midi, dur: dur, vel: vel, t: this.now });
  }.bind(ctx);

  const replay = new Function('with(this){ return (' + extractFn(html, 'replayMelody', true) + '); }').call(ctx);
  await replay.call(ctx);

  const sorted = timers.slice().sort(function (a, b) { return a.delay - b.delay; });
  for (const tm of sorted) { ctx.now = tm.delay; tm.fn(); }

  console.log('  === ' + name + ' ===');
  const total = (opts.notes || NOTES).length;
  ok('每个音都实际发声（不丢音）', calls.length === total, '发声 ' + calls.length + '/' + total);
  ok('自诊断计数完整', ctx.diag.lastReplay && ctx.diag.lastReplay.fired === total && ctx.diag.lastReplay.total === total,
    JSON.stringify(ctx.diag.lastReplay));
  let rhythmOk = true;
  const src = opts.notes || NOTES;
  for (let i = 0; i < calls.length; i++) {
    const expect = 60 + Math.round((src[i].start - src[0].start) * 1000);
    if (Math.abs(calls[i].t - expect) > 1) rhythmOk = false;
  }
  ok('起音时刻与真实节奏一致（快慢/停顿保留）', rhythmOk, calls.map(c => c.t + 'ms').join(', '));
  ok('走 K-S 专用通道（playMelodyNote，不经采样器）', calls.length === total, '');
  let noOverlap = true;
  for (let i = 0; i < calls.length - 1; i++) {
    if (calls[i].t + calls[i].dur * 1000 > calls[i + 1].t + 1) noOverlap = false;
  }
  ok('音长不压过下一音起音', noOverlap, calls.map(c => c.dur.toFixed(2) + 's').join(', '));
  return { ctx, calls };
}

(async function () {
  // 场景1：basic-pitch 振幅 → 重音
  {
    const { calls } = await runCase('场景1：振幅重音', {});
    const loud = calls[0], soft = calls[3];
    ok('响的地方弹得重（amp 0.9 > 0.2）', loud.vel > soft.vel, 'vel ' + loud.vel.toFixed(2) + ' vs ' + soft.vel.toFixed(2));
    ok('浮点 midi 保留（音分偏移不丢）', Math.abs(calls[0].midi - 59.2) < 1e-9 && Math.abs(calls[4].midi - 59.4) < 1e-9,
      'midi ' + calls[0].midi + ' / ' + calls[4].midi);
  }

  // 场景2：无振幅（快速模式）→ 从录音 PCM 按窗口 RMS 还原重音
  {
    const sr = 1000;
    const pcm = new Float32Array(6000); // 6 秒录音
    const segs = [
      { s: 0.50, e: 1.20, amp: 0.2 },
      { s: 1.20, e: 1.60, amp: 0.9 },
      { s: 1.90, e: 3.40, amp: 0.4 },
      { s: 3.40, e: 3.90, amp: 0.1 },
      { s: 4.20, e: 5.80, amp: 0.3 },
    ];
    for (const sg of segs) {
      for (let i = Math.floor(sg.s * sr); i < Math.floor(sg.e * sr); i++) pcm[i] = sg.amp;
    }
    const noAmpNotes = NOTES.map(function (n) { return { midi: n.midi, start: n.start, end: n.end, dur: n.dur }; });
    const { calls } = await runCase('场景2：PCM-RMS 重音（快速模式无振幅）', {
      notes: noAmpNotes,
      state: { recordedSr: sr, recordedPcm: pcm },
    });
    ok('窗口 RMS 还原重音（第2音窗口最响 → 力度最大）',
      calls[1].vel >= calls[0].vel && calls[1].vel >= calls[3].vel,
      calls.map(c => c.vel.toFixed(2)).join(', '));
  }

  console.log('\n' + (failures === 0 ? '旋律节奏/重音还原验证全部通过 ✓' : failures + ' 项失败 ✗'));
  process.exit(failures === 0 ? 0 : 1);
})();
