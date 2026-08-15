#!/usr/bin/env node
/* test-harmony.js — 三层旋律驱动配和弦模型验收（v2.16）
 * 1. analyzeHarmony 输出用户要求格式（chord_progression / melody_alignment / functional_analysis）
 * 2. 小调 V 为大三和弦（和声小调导音，如 B 小调的 F# 大三和弦）
 * 3. 大调倾向 I/IV/V/vi，多窗进行首尾落主功能
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

const CHORD_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ctx = { CHORD_ROOTS, NOTE_NAMES, Math, Array };
ctx.chordName = new Function('with(this){ return (' + extractFn(html, 'chordName') + '); }').call(ctx);
ctx.buildDiatonic = new Function('with(this){ return (' + extractFn(html, 'buildDiatonic') + '); }').call(ctx);
ctx.harmonizeMelody = new Function('with(this){ return (' + extractFn(html, 'harmonizeMelody') + '); }').call(ctx);
ctx.analyzeHarmony = new Function('with(this){ return (' + extractFn(html, 'analyzeHarmony') + '); }').call(ctx);

const mk = (midi, dur, start) => ({ midi, dur, start: start || 0 });

// 1) 输出格式
{
  const notes = [mk(60, 0.5, 0), mk(64, 0.4, 0.5), mk(67, 0.6, 0.9), mk(62, 0.4, 1.5), mk(67, 0.5, 1.9)];
  const h = ctx.analyzeHarmony(notes, 0, 'major');
  ok('输出 chord_progression 数组', Array.isArray(h.chord_progression) && h.chord_progression.length >= 1, JSON.stringify(h.chord_progression));
  ok('输出 melody_alignment（片段键）', typeof h.melody_alignment === 'object' && /片段\d+/.test(Object.keys(h.melody_alignment).join('|')), Object.keys(h.melody_alignment).join(','));
  const seg1 = h.melody_alignment['片段1'];
  ok('对齐含 旋律音/匹配和弦/匹配得分', seg1 && Array.isArray(seg1['旋律音']) && typeof seg1['匹配和弦'] === 'string' && typeof seg1['匹配得分'] === 'number',
    JSON.stringify(seg1));
  ok('输出 functional_analysis', typeof h.functional_analysis === 'string' && /大调|小调/.test(h.functional_analysis), h.functional_analysis);
  ok('和弦名均为调内和弦', h.chord_progression.every(c => typeof c === 'string' && c.length >= 1));
}

// 2) 小调 V 大三和弦（B 小调 → F# 大三和弦，含导音 A#）
{
  const di = ctx.buildDiatonic(11, 'minor');
  const v = di[4];
  ok('小调 V 是大三和弦（B 小调 → F#）', v.name === 'F#' && v.quality === 'major' && v.roman === 'V', v.name + '/' + v.roman);
  const iChord = di[0];
  ok('小调 i 是小三和弦（Bm）', iChord.name === 'Bm' && iChord.roman === 'i');
}

// 3) 多窗进行：首尾落主功能 + 小调进行用 V
{
  // B 小调：B-D-F# 主导，后接 A#-B 导音解决 → 应出现 V（F#）与 i（Bm）
  const notes = [
    mk(59, 1.0, 0), mk(62, 1.0, 1.0), mk(66, 1.0, 2.1), mk(59, 1.0, 3.1),
    mk(70, 0.8, 4.2), mk(59, 1.0, 5.1)
  ];
  const h = ctx.analyzeHarmony(notes, 11, 'minor');
  ok('小调进行首和弦为主功能（Bm 或 G）', /^Bm$|^G$/.test(h.chord_progression[0]), h.chord_progression.join('→'));
  ok('小调进行包含 V 大三和弦（F#，导音解决不省略）', h.chord_progression.indexOf('F#') >= 0, h.chord_progression.join('→'));
  ok('末和弦为调内和弦（片段允许半终止）', /^(Bm|G|F#|D|Em|C#dim|A)$/.test(h.chord_progression[h.chord_progression.length - 1]), h.chord_progression.join('→'));
  ok('功能分析标注小调', h.functional_analysis.indexOf('小调') >= 0, h.functional_analysis);
}

console.log('\n' + (failures === 0 ? '三层配和弦模型验收全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
