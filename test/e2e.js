#!/usr/bin/env node
/* e2e.js — 端到端验证：JS 合成音频 → JS YIN → JS 分段 → JS 定调 → 吉他查表
 * 完整走一遍 index.html 里真正发货的 JS 代码路径。
 * 用真实正弦合成（含轻微滑音+泛音+跑音），不用理想化帧数据。
 */
const path = require('path');
const DSP = require(path.join(__dirname, '..', 'dsp.js')).DSP;
const KeyDetect = require(path.join(__dirname, '..', 'key.js')).KeyDetect;
const GuitarMap = require(path.join(__dirname, '..', 'guitar-map.js')).GuitarMap;

const SR = 44100, FRAME = 2048, HOP = 1024;
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
let failures = 0;
function ok(name, cond, extra) { console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) failures++; }

// 合成一个音符（基频 + 轻微滑音 + 泛音 + 跑音），模拟真实演唱
function synthNote(dur, midi, detuneCents) {
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const out = new Float32Array(Math.floor(dur * SR));
  let phase = 0, fPrev = f0 * Math.pow(2, -8 / 1200); // 起音低 8 音分
  for (let i = 0; i < out.length; i++) {
    const attack = Math.min(1, i / (0.02 * SR));
    const release = Math.min(1, Math.max(0, (out.length - i) / (0.15 * SR)));
    const slide = -8 * Math.max(0, 1 - i / (0.12 * SR)); // 滑向稳定
    const f = f0 * Math.pow(2, (slide + detuneCents) / 1200);
    phase += 2 * Math.PI * (f + fPrev) / (2 * SR); fPrev = f;
    let s = Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase);
    out[i] = 0.5 * attack * release * s;
  }
  return out;
}

function synthMelody(rootMidi, mode, degs, noteLen, pause, detuneSeed) {
  const degSemis = mode === 'major' ? [0,2,4,5,7,9,11] : [0,2,3,5,7,8,10];
  let rng = detuneSeed >>> 0;
  const rand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 4294967296; };
  const chunks = [];
  degs.forEach(deg => {
    const semis = degSemis[deg % 7] + Math.floor(deg / 7) * 12;
    const detune = (rand() - 0.5) * 24; // ±12 音分跑音
    chunks.push(synthNote(noteLen, rootMidi + semis, detune));
    chunks.push(new Float32Array(Math.floor(pause * SR)));
  });
  let total = chunks.reduce((s, c) => s + c.length, 0);
  const buf = new Float32Array(total); let o = 0;
  chunks.forEach(c => { buf.set(c, o); o += c.length; });
  return buf;
}

// 逐帧 YIN（滑动窗口，模拟浏览器 ScriptProcessor 行为）
function analyzeBuf(buf) {
  const frames = [];
  const nFrames = Math.floor((buf.length - FRAME) / HOP) + 1;
  for (let fi = 0; fi < nFrames; fi++) {
    const start = fi * HOP;
    const win = buf.slice(start, start + FRAME);
    let rms = 0; for (let i = 0; i < win.length; i++) rms += win[i] * win[i];
    rms = Math.sqrt(rms / win.length);
    if (rms < 0.008) continue; // 静音门控
    const r = DSP.yinPitchFrame(win, SR);
    if (r) frames.push({ t: start / SR, pitch: r.pitch, conf: r.confidence });
  }
  return frames;
}

// 输出内容模拟 index.html 的渲染结果
function describe(notes, key) {
  const entry = (key.mode === 'major' ? GuitarMap.MAJOR : GuitarMap.MINOR)[key.rootPC];
  const doNames = entry.doPositions.map(d => d.pos + '(' + d.label + ')').join(' / ');
  const play = entry.playLike.open
    ? '直接弹' + entry.playLike.label
    : '用' + entry.playLike.label + '调指法，变调夹夹' + entry.playLike.capo + '品';
  return { keyName: entry.key, doNames, play, chords: entry.commonChords.slice(0, 3).join(' ') };
}

const CASES = [
  { name: 'D大调', root: 62, mode: 'major', degs: [0, 4, 5, 7, 9, 7, 5, 4, 0], seed: 7 },
  { name: 'G大调', root: 55, mode: 'major', degs: [0, 4, 5, 7, 9, 7, 5, 4, 0], seed: 11 },
  { name: 'C大调', root: 60, mode: 'major', degs: [0, 4, 5, 7, 9, 7, 5, 4, 0], seed: 3 },
  { name: 'Am小调', root: 57, mode: 'minor', degs: [0, 2, 4, 6, 5, 4, 2, 0], seed: 5 },
  { name: 'Em小调', root: 52, mode: 'minor', degs: [0, 2, 4, 6, 5, 4, 2, 0], seed: 9 }
];

console.log('\n端到端验证（JS 真实代码路径：合成→YIN→分段→定调→查表）');
CASES.forEach(c => {
  const buf = synthMelody(c.root, c.mode, c.degs, 0.4, 0.06, c.seed);
  const frames = analyzeBuf(buf);
  const notes = DSP.segmentNotes(frames);
  const key = KeyDetect.detectKey(notes);
  if (!key) { ok(c.name + ' 出结果', false, '无调性结果'); return; }
  const entry = (key.mode === 'major' ? GuitarMap.MAJOR : GuitarMap.MINOR)[key.rootPC];
  // 名字以 GuitarMap 为准（KeyDetect 只负责 rootPC+mode），避免命名差异误报
  const correct = entry.key === c.name;
  const out = describe(notes, key);
  ok(c.name + '  →  ' + out.keyName, correct,
     `do=${out.doNames} | ${out.play} | 和弦 ${out.chords} | conf=${key.confidence.toFixed(2)} | ${notes.length}个音`);
});

console.log('\n' + (failures === 0 ? '端到端全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
