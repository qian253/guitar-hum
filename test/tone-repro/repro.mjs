// repro.mjs — 用真实 Tone.js + node-web-audio-api 复现「听旋律只播最后一个音」
// 提取 index.html 里真实的 replayMelody/playNote/velByPitch，跑真实调度，
// 用 AnalyserNode 直接采样输出波形，按时间窗打印 RMS —— 数据说话：哪个音响、哪个音不响。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as WebAudio from 'node-web-audio-api';

// Tone 的 UMD 在加载时捕获 window（Node 里为 null → isAudioParam 恒 false），
// 必须先补一个 window 再导入 Tone，并把 Web Audio 类挂到 globalThis
globalThis.window = globalThis;
for (const [k, v] of Object.entries(WebAudio)) {
  if (typeof v === 'function' && !globalThis[k]) globalThis[k] = v;
}
const Tone = (await import('tone')).default;
const AudioContext = WebAudio.AudioContext;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

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

const nativeAC = new AudioContext({ sampleRate: 44100 });
const toneCtx = new Tone.Context(nativeAC);
Tone.setContext(toneCtx);
const raw = nativeAC;

// 输出监听：AnalyserNode 采样 + BufferSource start/stop 事件
const analyser = raw.createAnalyser();
analyser.fftSize = 2048;
analyser.connect(raw.destination);
const events = [];
const origCBS = raw.createBufferSource.bind(raw);
raw.createBufferSource = function () {
  const src = origCBS();
  const origStart = src.start.bind(src), origStop = src.stop.bind(src);
  src.start = function (when, offset, duration, gain) {
    events.push({ type: 'start', when: +(when || 0).toFixed(3), dur: duration != null ? +duration.toFixed(3) : null });
    return origStart(when, offset, duration);
  };
  src.stop = function (when) {
    events.push({ type: 'stop', when: +(when || 0).toFixed(3) });
    return origStop(when);
  };
  return src;
};

function makeBuffer(midi) {
  const sr = raw.sampleRate, len = Math.floor(sr * 1.2);
  const buf = raw.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  for (let i = 0; i < len; i++) d[i] = Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-3 * i / len);
  return buf;
}
const urls = {};
for (let m = 48; m <= 84; m++) urls[m] = makeBuffer(m);

const sampler = new Tone.Sampler({ urls: urls, attack: 0.002, release: 0.6, volume: -1 });
const bright = new Tone.Filter(10000, 'highshelf');
bright.gain.value = 4;
sampler.connect(bright);
bright.connect(analyser);

const SCALE = 0.12; // 时间压缩（相对节奏不变），加快复现

const NOTES = [
  { midi: 59, start: 0.5, end: 1.2, dur: 0.7, amp: 0.9 },
  { midi: 62, start: 1.2, end: 1.6, dur: 0.4, amp: 0.3 },
  { midi: 66, start: 1.9, end: 3.4, dur: 1.5, amp: 0.5 },
  { midi: 62, start: 3.4, end: 3.9, dur: 0.5, amp: 0.2 },
  { midi: 59, start: 4.2, end: 5.8, dur: 1.6, amp: 0.7 },
];

async function run(pathLabel, samplerReady) {
  events.length = 0;
  await new Promise((res) => { const t = setInterval(() => { if (sampler.loaded) { clearInterval(t); res(); } }, 20); });

  const ctx = {
    recordedNotes: NOTES,
    lastKeyResult: { rootPC: 11 },
    melodyTimers: [],
    Tone: Tone,
    toneSampler: sampler,
    toneSamplerReady: function () { return samplerReady && !!sampler.loaded; },
    stopAllTones: function () { try { sampler.releaseAll(); } catch (e) {} },
    ensureAudioStarted: async function () { await Tone.start(); },
    waitSampler: async function () { return samplerReady; },
    $: function () { return { querySelectorAll: function () { return []; } }; },
    setTimeout: function (fn, delay) { return global.setTimeout(fn, delay * SCALE); },
    clearTimeout: function (id) { global.clearTimeout(id); },
    getPlayCtx: function () { return raw; },
    activeOscs: [],
    Math: Math,
  };
  ctx.velByPitch = new Function('with(this){ return (' + extractFn(html, 'velByPitch') + '); }').call(ctx);
  ctx.toneOsc = new Function('with(this){ return (' + extractFn(html, 'toneOsc') + '); }').call(ctx);
  ctx.playNote = new Function('with(this){ return (' + extractFn(html, 'playNote') + '); }').call(ctx);
  const replay = new Function('with(this){ return (' + extractFn(html, 'replayMelody', true) + '); }').call(ctx);

  // RMS 采样（真实时间轴 × SCALE）
  const rmsLog = [];
  const t0 = Date.now();
  const poll = setInterval(() => {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let s = 0;
    for (let i = 0; i < data.length; i++) s += data[i] * data[i];
    rmsLog.push({ ms: Date.now() - t0, rms: Math.sqrt(s / data.length) });
  }, 60);

  await replay.call(ctx);
  await new Promise((r) => setTimeout(r, 6000 * SCALE + 500));
  clearInterval(poll);

  console.log('==== ' + pathLabel + ' ====');
  // 按 100ms 桶聚合 RMS
  const buckets = [];
  for (const p of rmsLog) {
    const b = Math.floor(p.ms / 100);
    buckets[b] = Math.max(buckets[b] || 0, p.rms);
  }
  console.log('  时间窗 RMS（×' + SCALE + ' 压缩，约 10ms≈真实 100ms）：');
  for (let b = 0; b < buckets.length; b++) {
    if (buckets[b] == null) continue;
    const bar = '#'.repeat(Math.min(50, Math.round(buckets[b] * 400)));
    console.log('    ' + String(b).padStart(3) + '00ms  ' + buckets[b].toFixed(4).padStart(8) + '  ' + bar);
  }
  const starts = events.filter((e) => e.type === 'start');
  console.log('  start 次数: ' + starts.length + '/5，事件:');
  events.forEach((e) => console.log('    ' + e.type.padEnd(5) + ' @' + e.when + 's' + (e.dur != null ? ' dur=' + e.dur + 's' : '')));
}

await run('采样器路径（toneSamplerReady=true）', true);
await run('K-S 降级路径（toneSamplerReady=false）', false);
process.exit(0);
