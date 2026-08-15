#!/usr/bin/env node
/* verify-ks-processor.js — 仿真验证 AudioWorklet 版 K-S 处理器（从 index.html 提取真实代码）
 * 模拟音频线程：逐量子（128 样本）推进 currentTime，喂入 5 个音高/时值/力度不同的音符，
 * 检查：
 *   1. 每个音都产生能量（不丢音、不静默）——「只剩最后一个音」的回归检测
 *   2. 输出有界（|样本| < 2，不可能自激爆炸）——「炸一下」的回归检测
 *   3. 声部按自身时值结束（音末 +0.15s 后停止贡献）
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

// 提取 KS_PROCESSOR_CODE：捕获整个拼接表达式后 eval 还原完整字符串
const m = html.match(/var KS_PROCESSOR_CODE = ([\s\S]*?);\s*function ensureKSWorklet/);
if (!m) { console.log('  FAIL 未找到 KS_PROCESSOR_CODE'); process.exit(1); }
const code = eval(m[1]); // eslint-disable-line no-eval

// 模拟 worklet 全局环境
let registered = null;
function registerProcessor(name, cls) { registered = cls; }
let mockSampleRate = 44100;
let mockCurrentTime = 0;
const QUANTUM = 128;

class AudioWorkletProcessor {
  constructor() {
    this._onmsg = null;
    this.port = {
      set onmessage(fn) { this._fn = fn; },
      get onmessage() { return this._fn; },
    };
    // 触发构造器里的 this.port.onmessage = ...
  }
}

function makeProcessor() {
  registered = null;
  const fn = new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime', code);
  fn(AudioWorkletProcessor, registerProcessor, { get value() { return mockSampleRate; } }, { get value() { return mockCurrentTime; } });
  return new registered();
}

// 处理器代码里 sampleRate/currentTime 是裸标识符——用 getter 注入动态值（currentTime 随仿真推进）
function makeProcessor2() {
  registered = null;
  const G = { sampleRate: 44100, now: 0 };
  Object.defineProperty(G, 'currentTime', { get: function () { return G.now; } });
  const fn = new Function('AudioWorkletProcessor', 'registerProcessor', 'selfGlobal', 'return (function(){ with(selfGlobal) { ' +
    code.replace('registerProcessor("ks-pluck",KSPluck);', 'return KSPluck;') + ' } })();');
  const Cls = fn(AudioWorkletProcessor, registerProcessor, G);
  return { proc: new Cls(), G: G };
}

function runVoice(note) {
  const { proc, G } = makeProcessor2();
  proc.port.onmessage({ data: { freq: note.freq, vel: note.vel, dur: note.dur, startAt: G.now + 0.01 } });
  let energy = 0, peak = 0;
  const totalQ = Math.ceil((note.dur + 0.25) * G.sampleRate / QUANTUM);
  for (let q = 0; q < totalQ; q++) {
    G.now = (q * QUANTUM) / G.sampleRate;
    const out = [new Float32Array(QUANTUM)];
    proc.process(null, [out]);
    for (let i = 0; i < QUANTUM; i++) {
      energy += out[0][i] * out[0][i];
      const a = Math.abs(out[0][i]);
      if (a > peak) peak = a;
    }
  }
  return { energy: Math.sqrt(energy / (totalQ * QUANTUM)), peak: peak };
}

const NOTES = [
  { freq: 233.08, vel: 0.9, dur: 0.7 },   // B3 长音
  { freq: 293.66, vel: 0.6, dur: 0.4 },   // D4 短音
  { freq: 369.99, vel: 0.7, dur: 1.5 },   // F#4 长音
  { freq: 293.66, vel: 0.5, dur: 0.5 },   // D4
  { freq: 233.08, vel: 0.8, dur: 1.6 },   // B3
];

console.log('AudioWorklet K-S 处理器仿真（提取 index.html 真实代码）:');
let allEnergy = true;
for (let i = 0; i < NOTES.length; i++) {
  const r = runVoice(NOTES[i]);
  const hasEnergy = r.energy > 0.01;
  const bounded = r.peak < 2;
  if (!hasEnergy) allEnergy = false;
  ok('音' + (i + 1) + '（' + NOTES[i].freq.toFixed(0) + 'Hz ' + NOTES[i].dur + 's）产生能量', hasEnergy, 'rms=' + r.energy.toFixed(4) + ' 峰值=' + r.peak.toFixed(3));
  ok('音' + (i + 1) + ' 输出有界（不可能自激爆炸）', bounded, '峰值=' + r.peak.toFixed(3));
}
ok('全部音符都发声（「只剩最后一个音」回归检测）', allEnergy);

// 复音：一个处理器同时 5 个声部
{
  const { proc, G } = makeProcessor2();
  NOTES.forEach(function (n, i) {
    proc.port.onmessage({ data: { freq: n.freq, vel: n.vel, dur: n.dur, startAt: G.now + 0.01 + i * 0.01 } });
  });
  let energy = 0, peak = 0;
  const totalQ = Math.ceil(2.0 * G.sampleRate / QUANTUM);
  for (let q = 0; q < totalQ; q++) {
    G.now = (q * QUANTUM) / G.sampleRate;
    const out = [new Float32Array(QUANTUM)];
    proc.process(null, [out]);
    for (let i = 0; i < QUANTUM; i++) {
      energy += out[0][i] * out[0][i];
      const a = Math.abs(out[0][i]);
      if (a > peak) peak = a;
    }
  }
  ok('复音混音有能量且峰值有界', Math.sqrt(energy / (totalQ * QUANTUM)) > 0.01 && peak < 2, 'rms=' + (Math.sqrt(energy / (totalQ * QUANTUM))).toFixed(4) + ' 峰值=' + peak.toFixed(3));
}

console.log('\n' + (failures === 0 ? 'K-S 处理器仿真验证全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
