#!/usr/bin/env node
/* verify-new.js — 验证 v2.1.0 新增的纯逻辑（从 index.html 真实源码中提取函数体运行）
 * 覆盖：小调简谱 la=主音/do=关系大调、八度基准、C/G 指法推荐、和弦命名。
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

// 从源码中提取某个顶层 function 的完整函数体（处理字符串/注释/嵌套大括号）
function extractFn(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('function not found: ' + name);
  let i = src.indexOf('{', idx);
  let depth = 0;
  let inS = null, inLine = false, inBlock = false;
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

// 提取常量定义（从常量块里抠出，供沙箱使用）
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHORD_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const MAJOR_SEMS = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_QUAL = ['major', 'minor', 'minor', 'major', 'major', 'minor', 'dim'];

function sandbox() {
  return { NOTE_NAMES, CHORD_ROOTS, MAJOR_SEMS, MAJOR_QUAL, Math, Array };
}

function evalFn(name) {
  const src = extractFn(html, name);
  const ctx = sandbox();
  const fn = new Function('with(this){ return (' + src + '); }').call(ctx);
  return fn;
}

// 1) buildJianpu：小调 la=6、do=1，八度正确
{
  const buildJianpu = evalFn('buildJianpu');
  // B 自然小调（B C# D E F# G A），主音 la=B(rootPC=11)
  // 用中音区：B3=59, D4=62, F#4=66, A4=69, C#4=61, E4=64, G4=67
  const notes = [59, 62, 66, 69, 61, 64, 67].map(m => ({ midi: m }));
  const jp = buildJianpu(notes, 11, 'minor');
  // la(B)=6, do(D)=1, re(E)=2, mi(F#)=3, fa(G)=4, sol(A)=5, si(C#)=7
  const expect = [6, 1, 3, 5, 7, 2, 4];
  const got = jp.map(j => j.num);
  ok('B小调简谱 la=6/do=1/…', JSON.stringify(got) === JSON.stringify(expect), JSON.stringify(got));
  // 八度：la(B3)=0，do(D4)=1（do 在 la 上方小三度，应高八度=1）
  ok('B小调 do(D4) 记高八度点', jp[1].oct === 1, 'oct=' + jp[1].oct + ' num=' + jp[1].num);
  ok('B小调 la(B3) 无点', jp[0].oct === 0, 'oct=' + jp[0].oct);
}

// 1b) 大调 do=1
{
  const buildJianpu = evalFn('buildJianpu');
  const notes = [60, 62, 64, 65, 67, 69, 71].map(m => ({ midi: m })); // C D E F G A B
  const jp = buildJianpu(notes, 0, 'major');
  ok('C大调简谱 1..7', JSON.stringify(jp.map(j => j.num)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7]), JSON.stringify(jp.map(j => j.num)));
}

// 2) scaleDegreeIndexes：小调唱名 la/si/do…
{
  const scaleDegreeIndexes = evalFn('scaleDegreeIndexes');
  const notes = [59, 62, 66].map(m => ({ midi: m })); // B D F# 在 B 小调 = la, do, mi
  const r = scaleDegreeIndexes(notes, 11, 'minor');
  ok('小调唱名 la/do/mi', JSON.stringify(r.map(x => x.sj)) === JSON.stringify(['la', 'do', 'mi']), JSON.stringify(r.map(x => x.sj)));
  const r2 = scaleDegreeIndexes(notes.map(n => ({ midi: n.midi })), 0, 'major'); // C D F#? 不验
}

// 3) recommendFingering：B小调 → C调指法夹2品；绝不出 E/A/Am/Em 指法
{
  const recommendFingering = evalFn('recommendFingering');
  const bMinor = recommendFingering('minor', 11); // B 小调，关系大调 D(2)
  ok('B小调 → C 调指法', bMinor.shape === 'C', JSON.stringify(bMinor));
  ok('B小调 → 变调夹夹 2 品', bMinor.capo === 2, JSON.stringify(bMinor));
  // 遍历 24 调，确保只出现 C/G 两种 shape
  const shapes = new Set();
  for (let mode of ['major', 'minor']) for (let root = 0; root < 12; root++) {
    shapes.add(recommendFingering(mode, root).shape);
  }
  const onlyCG = ['C', 'G'].every(s => shapes.has(s)) && shapes.size === 2;
  ok('24调只推荐 C/G 指法', onlyCG, 'shapes=' + [...shapes].join(','));
  // C 大调不夹、G 大调不夹
  ok('C大调不夹', recommendFingering('major', 0).capo === 0 && recommendFingering('major', 0).shape === 'C');
  ok('G大调不夹', recommendFingering('major', 7).capo === 0 && recommendFingering('major', 7).shape === 'G');
  // 用户给出的映射表（大调主音 → 推荐指法+品位）
  const majorTable = { 11: ['G', 4], 2: ['C', 2], 4: ['C', 4], 5: ['C', 5], 7: ['G', 0], 9: ['G', 2] };
  let tableOk = true, tableDetail = '';
  for (const [pc, [sh, cp]] of Object.entries(majorTable)) {
    const r = recommendFingering('major', parseInt(pc, 10));
    if (r.shape !== sh || r.capo !== cp) { tableOk = false; tableDetail += `pc${pc}→${r.shape}${r.capo}≠${sh}${cp}; `; }
  }
  ok('大调映射表 B/D/E/F/G/A 全对', tableOk, tableDetail);
  // 备选方案与超5品提示存在性
  const bMaj = recommendFingering('major', 11);
  ok('B大调有备选方案(C夹11)', bMaj.altShape === 'C' && bMaj.altCapo === 11, JSON.stringify(bMaj));
  const fSharp = recommendFingering('major', 6);
  ok('F#大调触发超5品提示', fSharp.capo > 5 && fSharp.highCapo === true, 'capo=' + fSharp.capo);
}

// 4) chordName：B 小调走向 6-4-1-5 → Bm-G-D-A
{
  const chordName = evalFn('chordName');
  const relMajor = 2; // D 大调（B 小调的关系大调）
  const degToChord = deg => chordName((relMajor + MAJOR_SEMS[deg - 1]) % 12, MAJOR_QUAL[deg - 1]);
  const prog6451 = [6, 4, 1, 5].map(degToChord);
  ok('B小调 6-4-1-5 = Bm-G-D-A', JSON.stringify(prog6451) === JSON.stringify(['Bm', 'G', 'D', 'A']), prog6451.join('-'));
  const prog6534 = [6, 5, 3, 4].map(degToChord);
  ok('B小调 6-5-3-4 = Bm-A-F#m-G', JSON.stringify(prog6534) === JSON.stringify(['Bm', 'A', 'F#m', 'G']), prog6534.join('-'));
  // C 大调 1-5-6-4 = C-G-Am-F
  const cMaj = deg => chordName((0 + MAJOR_SEMS[deg - 1]) % 12, MAJOR_QUAL[deg - 1]);
  ok('C大调 1-5-6-4 = C-G-Am-F', JSON.stringify([1, 5, 6, 4].map(cMaj)) === JSON.stringify(['C', 'G', 'Am', 'F']));
  // Am 小调 6-4-1-5 = Am-F-C-G（与需求示例一致）
  const am = deg => chordName((0 + MAJOR_SEMS[deg - 1]) % 12, MAJOR_QUAL[deg - 1]);
  ok('Am小调 6-4-1-5 = Am-F-C-G', JSON.stringify([6, 4, 1, 5].map(am)) === JSON.stringify(['Am', 'F', 'C', 'G']));
}

console.log('\n' + (failures === 0 ? '新增逻辑验证全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
