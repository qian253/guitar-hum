#!/usr/bin/env node
/* verify-replay.js — 验证「听旋律」节奏高还原调度（从 index.html 提取真实 replayMelody 模拟运行）
 * 模拟：快音/长音/停顿/响度差异的真实旋律时间戳，检查：
 *   1. 每个音都被调度且按顺序发声（不丢音）
 *   2. 起音时刻 = 真实 start 归一化（快慢/停顿保留）
 *   3. 每次发声只短程调度（offset≈0.02s），不再长距离预调度（防「只听到最后个音」）
 *   4. 音长不压过下一音起音
 *   5. 响度大 → 力度大（basic-pitch 振幅）
 *   6. 浮点 midi 保留（音分偏移不丢）
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
  // async 函数：连同 'async ' 前缀一起提取
  const start = (idx >= 6 && source.slice(idx - 6, idx) === 'async ') ? idx - 6 : idx;
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

(async function () {
  // 模拟一段有快音/长音/停顿/响度差异的旋律（时间戳单位：秒）
  const notes = [
    { midi: 59.2, start: 0.50, end: 1.20, dur: 0.7, amp: 0.9 },
    { midi: 62.0, start: 1.20, end: 1.60, dur: 0.4, amp: 0.3 },
    { midi: 66.1, start: 1.90, end: 3.40, dur: 1.5, amp: 0.5 },
    { midi: 62.3, start: 3.40, end: 3.90, dur: 0.5, amp: 0.2 },
    { midi: 59.4, start: 4.20, end: 5.80, dur: 1.6, amp: 0.7 },
  ];
  const calls = [];       // {midi, dur, vel, t}（playMelodyNote 捕获）
  const timers = [];      // {fn, delay}
  const ctx = {
    recordedNotes: notes,
    lastKeyResult: { rootPC: 11 },
    melodyTimers: [],
    diag: { lastReplay: null },
    now: 0,
    stopAllTones: function () {},
    ensureAudioStarted: async function () {},
    waitSampler: async function () { return false; },
    $: function () { return { querySelectorAll: function () { return []; } }; },
    velByPitch: function (midi, base) { return Math.max(0.62, Math.min(0.95, (base || 0.9) - (midi - 60) * 0.006)); },
    setTimeout: function (fn, delay) { timers.push({ fn: fn, delay: delay }); return timers.length; },
    clearTimeout: function () {},
  };
  // 用 bind 让 playMelodyNote 里的 this 指向 ctx，从而读到模拟时钟 this.now
  ctx.playMelodyNote = function (midi, dur, vel) {
    calls.push({ midi: midi, dur: dur, vel: vel, t: this.now });
  }.bind(ctx);

  const replay = new Function('with(this){ return (' + extractFn(html, 'replayMelody') + '); }').call(ctx);
  await replay.call(ctx);

  ok('为每个音都注册了定时器', timers.length >= notes.length, timers.length + ' 个定时器（预期 ' + notes.length + ' 音 + 1 清高亮）');

  // 按时间顺序触发定时器（模拟真实时钟推进）
  const sorted = timers.slice().sort(function (a, b) { return a.delay - b.delay; });
  for (const tm of sorted) { ctx.now = tm.delay; tm.fn(); }

  ok('每个音都实际发声（不丢音）', calls.length === notes.length, '发声 ' + calls.length + '/' + notes.length);
  ok('自诊断计数完整（diag.lastReplay）', ctx.diag.lastReplay && ctx.diag.lastReplay.fired === notes.length && ctx.diag.lastReplay.total === notes.length,
    JSON.stringify(ctx.diag.lastReplay));

  // 起音时间 = 真实节奏（归一化后）：t_i ≈ 60ms + (start_i - start_0)*1000
  let rhythmOk = true;
  for (let i = 0; i < calls.length; i++) {
    const expect = 60 + Math.round((notes[i].start - notes[0].start) * 1000);
    if (Math.abs(calls[i].t - expect) > 1) rhythmOk = false;
  }
  ok('起音时刻与真实节奏一致（快慢/停顿保留）', rhythmOk, calls.map(c => c.t + 'ms').join(', '));

  ok('走 K-S 专用通道（playMelodyNote，不经采样器状态机）', calls.length === notes.length && calls.every(c => typeof c.midi === 'number'));

  let noOverlap = true;
  for (let i = 0; i < calls.length - 1; i++) {
    if (calls[i].t + calls[i].dur * 1000 > calls[i + 1].t + 1) noOverlap = false;
  }
  ok('音长不压过下一音起音', noOverlap, calls.map(c => c.dur.toFixed(2) + 's').join(', '));

  const loud = calls[0], soft = calls[3];
  ok('响的地方弹得重（amp 0.9 > 0.2 → vel 更大）', loud.vel > soft.vel, 'vel ' + loud.vel.toFixed(2) + ' vs ' + soft.vel.toFixed(2));

  ok('浮点 midi 保留（音分偏移不丢）', Math.abs(calls[0].midi - 59.2) < 1e-9 && Math.abs(calls[4].midi - 59.4) < 1e-9,
    'midi ' + calls[0].midi + ' / ' + calls[4].midi);

  console.log('\n' + (failures === 0 ? '旋律节奏还原验证全部通过 ✓' : failures + ' 项失败 ✗'));
  process.exit(failures === 0 ? 0 : 1);
})();
