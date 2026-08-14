#!/usr/bin/env node
/* verify-chords.js — 验证「旋律驱动和弦」harmonizeMelody（从 index.html 提取真实函数）
 * 场景：
 *  1. C 大调 C-E-G 片段 → 应配 I 级 C 和弦
 *  2. C 大调 G-B-D 片段 → 应配 V 级 G 和弦
 *  3. B 小调 B-D-F# 片段 → 应配 i 级 Bm
 *  4. 多窗口不连续重复同一和弦 > 2 次
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

function extractFn(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('{', idx), depth = 0, inS = null, inLine = false, inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const CHORD_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const ctx = { CHORD_ROOTS, Math, Array };
const chordName = new Function('with(this){ return (' + extractFn(html, 'chordName') + '); }').call(ctx);
const buildDiatonic = new Function('with(this){ return (' + extractFn(html, 'buildDiatonic') + '); }').call(ctx);
ctx.chordName = chordName; ctx.buildDiatonic = buildDiatonic;
const harmonizeMelody = new Function('with(this){ return (' + extractFn(html, 'harmonizeMelody') + '); }').call(ctx);

function mk(midi, dur, start) { return { midi, dur, start: start || 0 }; }

// 1) C 大调 C-E-G → I 级 C
{
  const notes = [mk(60, 0.4, 0), mk(64, 0.4, 0.4), mk(67, 0.5, 0.8)];
  const chords = harmonizeMelody(notes, 0, 'major');
  ok('C大调 C-E-G → 配 C(I)', chords.length === 1 && chords[0].name === 'C' && chords[0].roman === 'I', chords.map(c => c.name).join('→'));
}

// 2) C 大调 G-B-D → V 级 G
{
  const notes = [mk(67, 0.4, 0), mk(71, 0.4, 0.4), mk(74, 0.5, 0.8)];
  const chords = harmonizeMelody(notes, 0, 'major');
  ok('C大调 G-B-D → 配 G(V)', chords.length === 1 && chords[0].name === 'G' && chords[0].roman === 'V', chords.map(c => c.name).join('→'));
}

// 3) B 小调 B-D-F# → i 级 Bm
{
  const notes = [mk(59, 0.4, 0), mk(62, 0.4, 0.4), mk(66, 0.5, 0.8)];
  const chords = harmonizeMelody(notes, 11, 'minor');
  ok('B小调 B-D-F# → 配 Bm(i)', chords.length === 1 && chords[0].name === 'Bm' && chords[0].roman === 'i', chords.map(c => c.name).join('→'));
}

// 4) 多窗口：每窗不同旋律音 → 配不同和弦，且不连续 3 次重复
{
  // 4 个 2 秒窗：C、G、C、C（若第 3、4 窗都倾向 C，则第 4 窗应换）
  const notes = [
    mk(60, 1.0, 0), mk(64, 1.0, 1.0),            // 窗1: C E → C
    mk(67, 1.0, 2.1), mk(71, 1.0, 3.1),          // 窗2: G B → G
    mk(60, 1.0, 4.2), mk(64, 1.0, 5.2),          // 窗3: C E → C
    mk(60, 1.0, 6.3), mk(64, 1.0, 7.3)           // 窗4: C E → C（但前面已 C,G,C，应避免）
  ];
  const chords = harmonizeMelody(notes, 0, 'major');
  const names = chords.map(c => c.name);
  ok('多窗口配出和弦', chords.length >= 4, names.join('→'));
  // 检查无连续 3 个相同
  let noTriple = true;
  for (let i = 2; i < names.length; i++) if (names[i] === names[i-1] && names[i] === names[i-2]) noTriple = false;
  ok('无连续 3 次相同和弦', noTriple, names.join('→'));
}

console.log('\n' + (failures === 0 ? '旋律驱动和弦验证全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
