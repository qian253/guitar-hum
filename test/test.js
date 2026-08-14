#!/usr/bin/env node
/* test.js — 用 Node 验证核心模块 + index.html 内联 JS
 * 1) require dsp.js / key.js / guitar-map.js 做行为测试
 * 2) 提取 index.html 内联 <script>，做语法检查 + 同逻辑 smoke test
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function ok(name, cond, extra) {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`  ${mark} ${name}${extra ? '  ' + extra : ''}`);
}

/* ============ 1) 模块行为测试 ============ */
console.log('\n[1] 模块行为测试 (dsp/key/guitar-map)');
const DSP = require(path.join(ROOT, 'dsp.js')).DSP;
const KeyDetect = require(path.join(ROOT, 'key.js')).KeyDetect;
const GuitarMap = require(path.join(ROOT, 'guitar-map.js')).GuitarMap;

// YIN：纯正弦 440Hz 应检测到 69.000
{
  const sr = 44100;
  const buf = new Float32Array(2048);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.sin(2 * Math.PI * 440 * i / sr) * 0.5;
  const r = DSP.yinPitchFrame(buf, sr);
  ok('YIN 检测 440Hz→midi≈69', r && Math.abs(r.pitch - 69) < 0.05, r && r.pitch.toFixed(3));
}

// 分段：构造 5 个稳定音符的帧序列
{
  const frames = [];
  let t = 0;
  const notes = [62, 64, 66, 67, 69]; // D E F# G A
  for (const m of notes) {
    for (let f = 0; f < 20; f++) {
      frames.push({ t: t, pitch: m + (Math.random() - 0.5) * 0.1, conf: 0.95 });
      t += 0.0116;
    }
    t += 0.05; // 音符间间隔
  }
  const seg = DSP.segmentNotes(frames);
  ok('分段得到 5 个音符', seg.length === 5, 'got ' + seg.length);
  if (seg.length === 5) {
    ok('分段 midi 接近 62/64/66/67/69', Math.abs(seg[0].midi - 62) < 0.3 && Math.abs(seg[4].midi - 69) < 0.3);
  }
}

// 八度误差修正：孤立 ±12 尖峰被拉回，正常旋律不动
{
  const mk = (m, dur) => ({ midi: m, dur: dur || 0.3 });
  // 中间音 71(=59+12) 是孤立八度尖峰 → 应修回 59
  const fixed = DSP.fixOctaveErrors([mk(59), mk(71), mk(60)]);
  ok('孤立八度尖峰被修正', fixed[1].midi === 59, 'got ' + fixed[1].midi);
  // 正常旋律不动：62→64 不是八度跳变
  const normal = DSP.fixOctaveErrors([mk(62), mk(64), mk(66)]);
  ok('正常旋律不被误改', normal[1].midi === 64, 'got ' + normal[1].midi);
  // 少于 3 音直接返回
  ok('短序列原样返回', DSP.fixOctaveErrors([mk(60), mk(72)]).length === 2);
}

// 定调：D 大调旋律（时长为权重）
{
  const notes = [62, 66, 67, 69, 71, 69, 67, 66, 62].map(midi => ({ midi, dur: 0.4 }));
  const key = KeyDetect.detectKey(notes);
  ok('定调 D 大调', key && key.rootPC === 2 && key.mode === 'major', key && key.keyName);
}

// 定调：Am 小调（含落尾音权重）
{
  const notes = [57, 60, 62, 64, 67, 64, 62, 60, 57].map(midi => ({ midi, dur: 0.4 }));
  const key = KeyDetect.detectKey(notes);
  ok('定调 Am 小调', key && key.rootPC === 9 && key.mode === 'minor', key && key.keyName);
}

// 吉他映射
{
  const d = GuitarMap.MAJOR[2];
  ok('D 大调 do 位置 4弦空弦', d.doPositions[0].pos === '4弦空弦' && d.doPositions[0].midi === 50);
  ok('D 大调直接开放和弦', d.playLike.open === true);
  const g = GuitarMap.MAJOR[7];
  ok('G 大调开放和弦', g.playLike.open === true);
}

/* ============ 2) index.html 内联 JS 验证 ============ */
console.log('\n[2] index.html 内联 JS 验证');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 提取所有 <script>...</script>
const scripts = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html)) !== null) scripts.push(m[1]);
ok('找到内联 <script> 块', scripts.length >= 1, scripts.length + ' block(s)');

// 语法检查：逐个用 new Function 解析
let allValid = true;
scripts.forEach((code, i) => {
  try { new Function(code); }
  catch (e) { allValid = false; console.log('   语法错误块#' + i + ': ' + e.message); }
});
ok('内联 JS 语法全部有效', allValid);

// smoke：内联版 DSP/KeyDetect 在 node 环境跑一遍（模拟 window）
if (allValid) {
  try {
    const sandbox = {};
    const vm = require('vm');
    // 把三个 IIFE 块在 vm 里以 window 为 global 跑
    const ctx = vm.createContext({ window: { addEventListener: function () {} }, console });
    // 找出内联的三个模块脚本（GuitarMap/DSP/KeyDetect 定义 + 应用逻辑可跳过）
    const appCode = scripts.join('\n;\n');
    try {
      vm.runInContext(appCode, ctx, { timeout: 5000 });
      // 应用逻辑会立即执行 IIFE 并尝试绑定 DOM —— 没有 DOM 会抛错
      // 所以这里只验证模块脚本
    } catch (e) {
      // 应用逻辑失败可接受（无 DOM），但模块定义必须存在
      ok('内联 GuitarMap 已定义', !!(ctx.window && ctx.window.GuitarMap));
      ok('内联 DSP 已定义', !!(ctx.window && ctx.window.DSP));
      ok('内联 KeyDetect 已定义', !!(ctx.window && ctx.window.KeyDetect));
      if (ctx.window && ctx.window.KeyDetect) {
        const notes = [62, 66, 67, 69, 71, 69, 67, 66, 62].map(midi => ({ midi, dur: 0.4 }));
        const k = ctx.window.KeyDetect.detectKey(notes);
        ok('内联 KeyDetect 定调 D', k && k.rootPC === 2 && k.mode === 'major');
      }
    }
  } catch (e) {
    ok('内联 smoke 测试', false, e.message);
  }
}

console.log('\n' + (failures === 0 ? '全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
