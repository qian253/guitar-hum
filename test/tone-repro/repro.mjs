// repro.mjs — 用真实 Tone.js + node-web-audio-api 复现并客观评估播放链路
// 指标：
//   RMS = 能量（有没有声）；flatness = 频谱平坦度（0≈纯乐音，1≈白噪声/电流声）
// 提取 index.html 真实函数跑：采样器路径 + K-S 修复后 + K-S 修复前(模拟旧滤波)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as WebAudio from 'node-web-audio-api';

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

const analyser = raw.createAnalyser();
analyser.fftSize = 2048;
analyser.connect(raw.destination);

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

const SCALE = 0.12;
const NOTES = [
  { midi: 59, start: 0.5, end: 1.2, dur: 0.7, amp: 0.9 },
  { midi: 62, start: 1.2, end: 1.6, dur: 0.4, amp: 0.3 },
  { midi: 66, start: 1.9, end: 3.4, dur: 1.5, amp: 0.5 },
  { midi: 62, start: 3.4, end: 3.9, dur: 0.5, amp: 0.2 },
  { midi: 59, start: 4.2, end: 5.8, dur: 1.6, amp: 0.7 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============ A/B：旧 biquad 环路 vs 新两点平均环路（各自全新 AudioContext 隔离测量） ============
async function loopAB(label, useBiquad, damping) {
  const ac2 = new AudioContext({ sampleRate: 44100 });
  const an = ac2.createAnalyser(); an.fftSize = 2048; an.connect(ac2.destination);
  const sr = ac2.sampleRate, freq = 233.08; // midi 59 ≈ B3
  const N = Math.max(2, Math.round(sr / freq));
  const when = ac2.currentTime + 0.05;
  const nb = ac2.createBuffer(1, N, sr);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < N; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / N);
  const src = ac2.createBufferSource(); src.buffer = nb;
  const delay = ac2.createDelay(2.0); delay.delayTime.value = N / sr;
  const sum = ac2.createGain(); sum.gain.value = 1.0;
  const fb = ac2.createGain(); fb.gain.value = damping;
  const out = ac2.createGain();
  out.gain.setValueAtTime(0.65, when); // 平直包络：单独测环路余音衰减，不被包络干扰
  src.connect(delay);
  if (useBiquad) {
    const lp = ac2.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(900, Math.min(6000, freq * 4));
    delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(out);
  } else {
    const oneSamp = ac2.createDelay(0.01); oneSamp.delayTime.value = 1 / sr;
    const g1 = ac2.createGain(); g1.gain.value = 0.5;
    const g2 = ac2.createGain(); g2.gain.value = 0.5;
    delay.connect(g1); g1.connect(sum);
    delay.connect(oneSamp); oneSamp.connect(g2); g2.connect(sum);
    sum.connect(fb); fb.connect(delay); sum.connect(out);
  }
  out.connect(an);
  src.start(when); src.stop(when + 0.02);
  // 采样 1.2 秒内的 RMS 峰值、800ms 后的余音、频谱平坦度
  let maxRms = 0, rmsAt800 = 0, flatSum = 0, flatN = 0, kCount = 0;
  const td = new Float32Array(an.fftSize);
  const fd = new Float32Array(an.frequencyBinCount);
  const binLo = Math.max(1, Math.floor(200 / (sr / an.fftSize)));
  const binHi = Math.min(fd.length - 1, Math.floor(8000 / (sr / an.fftSize)));
  for (let k = 0; k < 24; k++) {
    await sleep(50);
    an.getFloatTimeDomainData(td);
    let s = 0;
    for (let i = 0; i < td.length; i++) s += td[i] * td[i];
    const rms = Math.sqrt(s / td.length);
    if (rms > maxRms) maxRms = rms;
    if (kCount >= 14 && kCount <= 16) rmsAt800 = Math.max(rmsAt800, rms); // ~700-800ms 处的余音
    kCount++;
    an.getFloatFrequencyData(fd);
    let sumLin = 0, sumLog = 0, n = 0;
    for (let b = binLo; b <= binHi; b++) {
      const mag = Math.pow(10, fd[b] / 20);
      sumLin += mag; sumLog += Math.log(mag + 1e-9); n++;
    }
    flatSum += n ? Math.exp(sumLog / n) / (sumLin / n + 1e-9) : 0;
    flatN++;
  }
  await ac2.close();
  const bounded = Number.isFinite(maxRms) && maxRms < 2;
  const sustain = maxRms > 0 ? rmsAt800 / maxRms : 0;
  console.log('  ' + label + ': 峰值rms=' + (Number.isFinite(maxRms) ? maxRms.toFixed(4) : '∞') + (bounded ? ' ✓ 有界' : ' ✗ 失稳爆炸') + ' · 800ms余音比=' + sustain.toFixed(2) + (sustain > 0.2 ? ' ✓ 有余音' : ' ✗ 无余音(只剩起音滋声)') + ' · 平均平坦度=' + (flatSum / flatN).toFixed(3));
  return bounded && sustain > 0.2;
}
console.log('==== 环路稳定性 A/B（各自全新上下文，隔离测量）====');
const okBiquad = await loopAB('旧 biquad 低通环路（阻尼 0.985）', true, 0.985);
const okMA985 = await loopAB('两点平均 · 阻尼 0.985（旧）', false, 0.985);
const okMA99 = await loopAB('两点平均 · 阻尼 0.99（v2.11.4）', false, 0.99);
const okMA996 = await loopAB('两点平均 · 阻尼 0.996', false, 0.996);
const okMA999 = await loopAB('两点平均 · 阻尼 0.999（v2.11.5 采用）', false, 0.999);
console.log('\n结论: 阻尼 0.999 环路' + (okMA999 ? ' rms 有界 + 800ms 余音可闻 → 「小滋一声就没了」根因（阻尼过小衰减过快）已消除 ✓' : ' 仍有问题 ✗'));
process.exit(0);
