#!/usr/bin/env node
/* verify-jianpu-quantize.js — v2.33 简谱三阶段管线·阶段一(节奏量化)验收
 * 从 index.html 真实源码提取函数体运行,覆盖:
 *   BPM 估计(整数倍/细分双拟合+八度消歧)、自适应网格吸附、时值分类/休止符、
 *   附点/三连音、拍号、退化 fallback、教材式记谱符号流与 HTML。
 * 对应千问提案三验收:完美演唱 / 环境噪严重(抖动) / 跑调演唱(阶段二 v2.34 补)。
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

// 从源码中提取某个顶层 function 的完整函数体(处理字符串/注释/嵌套大括号)
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

// 从源码提取常量对象(扁平字面量,无嵌套花括号 → 非贪婪到首个 };),与 index.html 保持单一来源
function extractVarObj(name) {
  const m = html.match(new RegExp('var ' + name + ' = (\\{[\\s\\S]*?\\});'));
  if (!m) throw new Error('var not found: ' + name);
  return eval('(' + m[1] + ')');
}

// 共享沙箱:管线函数互相调用,必须全部挂在同一个 ctx 上(with 作用域动态查找)
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiName(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + String(Math.floor(m / 12) - 1); }
const ctx = { NOTE_NAMES, midiName, JIANPU_QUANT_OPTS: extractVarObj('JIANPU_QUANT_OPTS'), DUR_NAMES_JP: extractVarObj('DUR_NAMES_JP'), Math, Array };
function evalInto(name) {
  ctx[name] = new Function('with(this){ return (' + extractFn(html, name) + '); }').call(ctx);
}
['estimateBpm', 'quantizeRhythm', 'runJianpuPipeline', 'mergeFragments', 'jpMapDegrees', 'buildJianpuScore', 'buildJianpuScoreHtml', 'jpNoteHtml', 'dotRepeat'].forEach(evalInto);

// 确定性抖动源(乘法 LCG)
function lcg(seed) {
  let s = seed >>> 0;
  return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
function mkNotes(onsets, durs, midis) {
  return onsets.map((o, i) => ({ start: o, end: o + (durs[i] || 0.4), dur: durs[i] || 0.4, midi: midis ? midis[i] : 60 + (i % 7) }));
}

console.log('=== 场景1 完美演唱:8 音 @0.5s 精确 120bpm ===');
{
  const notes = mkNotes([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], [0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45]);
  const eb = ctx.estimateBpm(notes);
  ok('BPM∈[118,122]', eb.bpm >= 118 && eb.bpm <= 122, 'bpm=' + eb.bpm);
  ok('BPM 可靠', eb.reliable === true);
  const q = ctx.quantizeRhythm(notes);
  ok('无 fallback', q.fallback === null, 'fallback=' + q.fallback);
  ok('成功率 100%', q.stats.successRate === 1, 'rate=' + q.stats.successRate);
  ok('平均误差 <1ms', q.stats.meanErrMs < 1, 'mean=' + q.stats.meanErrMs.toFixed(2));
  ok('全四分音符', q.qNotes.every(x => x.value16 === 4 && x.durClass === 4), q.qNotes.map(x => x.value16).join(','));
  ok('4/4 拍', q.meter === '4/4');
  ok('无休止符', q.rests.length === 0);
  ok('1/8 网格(慢速旋律)', q.gridUnit === 8 && q.snapStep16 === 2);
  const score = ctx.buildJianpuScore(q, 0, 'major', null);
  ok('符号流:8 个 note + 1 个小节线', score.symbols.filter(s => s.t === 'note').length === 8 && score.symbols.filter(s => s.t === 'bar').length === 1);
  const h = ctx.buildJianpuScoreHtml(score);
  ok('HTML:8 个 .jp', (h.match(/class="jp"/g) || []).length === 8);
  ok('HTML:1 个小节线', (h.match(/jp-barsep/g) || []).length === 1);
  ok('HTML:data-i 索引完整', h.indexOf('data-i="0"') >= 0 && h.indexOf('data-i="7"') >= 0);
  ok('HTML:四分音符无减时线', h.indexOf('jp-num u1') < 0 && h.indexOf('jp-num u2') < 0);
  const meta = ctx.runJianpuPipeline(notes);
  ok('管线:F0 无告警', meta.f0Warn === false);
}

console.log('=== 场景2 快速十六分:6 音 @125ms(120bpm 十六分) ===');
{
  const notes = mkNotes([0, 0.125, 0.25, 0.375, 0.5, 0.625], [0.11, 0.11, 0.11, 0.11, 0.11, 0.11]);
  const eb = ctx.estimateBpm(notes);
  ok('BPM=120 而非 240/480(八度消歧)', eb.bpm >= 110 && eb.bpm <= 130, 'bpm=' + eb.bpm);
  const q = ctx.quantizeRhythm(notes);
  ok('1/16 网格', q.gridUnit === 16 && q.snapStep16 === 1);
  ok('全十六分(value16=1)', q.qNotes.every(x => x.value16 === 1), q.qNotes.map(x => x.value16).join(','));
  const score = ctx.buildJianpuScore(q, 0, 'major', null);
  const h = ctx.buildJianpuScoreHtml(score);
  ok('HTML:双减时线 u2', (h.match(/jp-num u2/g) || []).length === 6);
}

console.log('=== 场景3 附点节奏:0.75+0.25 对 @120bpm ===');
{
  const notes = mkNotes([0, 0.75, 1.0, 1.5, 2.0], [0.7, 0.2, 0.45, 0.45, 0.45]);
  const q = ctx.quantizeRhythm(notes);
  ok('BPM≈120', q.bpm >= 110 && q.bpm <= 130, 'bpm=' + q.bpm);
  ok('附点四分(value16=6)', q.qNotes[0].value16 === 6 && q.qNotes[0].durClass === 6, 'v=' + q.qNotes[0].value16);
  ok('八分(第二音)', q.qNotes[1].value16 === 2);
  ok('附点对已记录', q.dotted.some(d => d.from === 0 && d.to === 1));
  const score = ctx.buildJianpuScore(q, 0, 'major', null);
  const s0 = score.symbols.find(s => s.t === 'note' && s.noteIdx === 0);
  ok('符号含附点记号', s0 && s0.dot === true);
}

console.log('=== 场景4 三连音:3 等距音簇 @120bpm ===');
{
  const notes = mkNotes([0, 0.167, 0.333, 0.5, 0.75, 1.0, 1.25, 1.5], [0.15, 0.15, 0.15, 0.2, 0.2, 0.2, 0.2, 0.2]);
  const q = ctx.quantizeRhythm(notes);
  ok('BPM≈120', q.bpm >= 110 && q.bpm <= 130, 'bpm=' + q.bpm);
  ok('检出 1 组三连音', q.triplets.length === 1, JSON.stringify(q.triplets));
  ok('三连音组内时值=2(八分)', q.qNotes[0].value16 === 2 && q.qNotes[1].value16 === 2 && q.qNotes[2].value16 === 2);
  const score = ctx.buildJianpuScore(q, 0, 'major', null);
  ok('符号流含三连音组', score.symbols.some(s => s.t === 'triplet' && s.items.length === 3));
  const h = ctx.buildJianpuScoreHtml(score);
  ok('HTML:三连音标记', h.indexOf('jp-tri-mark') >= 0);
}

console.log('=== 场景5 长音+休止符 ===');
{
  const notes = mkNotes([0, 0.5, 1.5], [0.45, 0.45, 0.8]);
  const q = ctx.quantizeRhythm(notes);
  ok('无 fallback', q.fallback === null, 'fallback=' + q.fallback);
  ok('休止符 at16=8 value16=4', q.rests.length === 1 && q.rests[0].at16 === 8 && q.rests[0].value16 === 4, JSON.stringify(q.rests));
  const score = ctx.buildJianpuScore(q, 0, 'major', null);
  ok('符号流含休止符', score.symbols.some(s => s.t === 'rest' && s.value16 === 4));
  const h = ctx.buildJianpuScoreHtml(score);
  ok('HTML:休止符 0', h.indexOf('jp-rest') >= 0 && /<span class="jp-num[^"]*">0<\/span>/.test(h));
}

console.log('=== 场景6 环境噪严重(验收3):±80ms 种子抖动 ===');
{
  const rng = lcg(20260817);
  const onsets = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map(o => Math.round((o + (rng() * 2 - 1) * 0.08) * 1000) / 1000);
  const notes = mkNotes(onsets, onsets.map(() => 0.45));
  const q = ctx.quantizeRhythm(notes);
  ok('抖动下不整体退回', q.fallback === null, 'fallback=' + q.fallback);
  ok('BPM 仍落在合理域', q.bpm >= 95 && q.bpm <= 150, 'bpm=' + q.bpm);
  // 手算一致性:用同一规则复算 qOnset16 与 unquantized 标记
  let consistent = true;
  const t0 = notes[0].start;
  let last = 0;
  let hand = [];
  for (let i = 0; i < notes.length; i++) {
    const rel = (notes[i].start - t0) / q.gridMs;
    const cand = Math.max(last, Math.round(rel / q.snapStep16) * q.snapStep16);
    hand.push({ pos: cand, unq: Math.abs(cand * q.gridMs - rel * q.gridMs) * 1000 > q.tolMs + 1e-9 });
    last = cand;
  }
  for (let i = 0; i < notes.length; i++) {
    if (q.qNotes[i].qOnset16 !== hand[i].pos || q.qNotes[i].unquantized !== hand[i].unq) consistent = false;
  }
  ok('吸附结果与手算一致', consistent, 'qOnset16=' + q.qNotes.map(x => x.qOnset16).join(','));
  ok('unquantized 索引正确', q.qNotes.filter(x => x.unquantized).map(x => x.idx).join(',') === hand.map((x, i) => x.unq ? i : -1).filter(i => i >= 0).join(','));
  ok('成功率落在 (0.35, 0.8)', q.stats.successRate > 0.35 && q.stats.successRate < 0.8, 'rate=' + q.stats.successRate.toFixed(3));
  const meta = ctx.runJianpuPipeline(notes);
  ok('F0 告警与 0.7 阈值一致', meta.f0Warn === (q.stats.successRate < ctx.JIANPU_QUANT_OPTS.f0WarnSuccess), 'f0Warn=' + meta.f0Warn + ' rate=' + q.stats.successRate.toFixed(3));
  // 确定性:同种子两次结果一致
  const rng2 = lcg(20260817);
  const onsets2 = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map(o => Math.round((o + (rng2() * 2 - 1) * 0.08) * 1000) / 1000);
  const q2 = ctx.quantizeRhythm(mkNotes(onsets2, onsets2.map(() => 0.45)));
  ok('确定性输出', JSON.stringify(q2.qNotes.map(x => [x.qOnset16, x.unquantized])) === JSON.stringify(q.qNotes.map(x => [x.qOnset16, x.unquantized])));
  const score = ctx.buildJianpuScore(q, 0, 'major', null);
  const h = ctx.buildJianpuScoreHtml(score);
  ok('HTML:不稳音符带 unq 弱化样式', (h.match(/jp unq/g) || []).length === q.stats.nTotal - q.stats.nQuantized);
}

console.log('=== 场景7 退化用例 ===');
{
  ok('2 音 → tooShort', ctx.quantizeRhythm(mkNotes([0, 0.5], [0.4, 0.4])).fallback === 'tooShort');
  // 真正病态:60bpm 四分网格 + ±200ms 种子抖动,量化率 < 0.4 → 整体退回
  const r7 = lcg(777);
  const os7 = [0, 1, 2, 3, 4, 5, 6, 7].map(o => Math.round((o + (r7() * 2 - 1) * 0.2) * 1000) / 1000);
  const q7 = ctx.quantizeRhythm(mkNotes(os7, os7.map(() => 0.8)));
  ok('慢速+病态抖动 → tooUnstable', q7.fallback === 'tooUnstable', 'fallback=' + q7.fallback + ' rate=' + q7.stats.successRate.toFixed(3));
  ok('量化率 < 0.4', q7.stats.successRate < 0.4, 'rate=' + q7.stats.successRate.toFixed(3));
  const notes = mkNotes([0, 0.5, 1], [0.45, 0.45, 0.45]);
  const before = JSON.stringify(notes);
  ctx.quantizeRhythm(notes);
  ok('不修改输入音符', JSON.stringify(notes) === before);
}

console.log('=== 场景8 唱名映射基础(小调 la=6 约定) ===');
{
  // B 自然小调(B C# D E F# G A),同 verify-new.js 的 buildJianpu 用例
  const midis = [59, 61, 62, 64, 66, 67, 69, 71];
  const notes = mkNotes(midis.map((m, i) => i * 0.5), midis.map(() => 0.45), midis);
  const q = ctx.quantizeRhythm(notes);
  const score = ctx.buildJianpuScore(q, 11, 'minor', null);
  const nums = score.symbols.filter(s => s.t === 'note').map(s => s.num);
  ok('小调首音 la=6', nums[0] === 6, 'nums=' + nums.join(','));
  ok('小调音阶 6,7,1,2,3,4,5,6', nums.join(',') === '6,7,1,2,3,4,5,6');
}

console.log('=== 场景9 八度点 ===');
{
  // 中位数锚点:center=65 → tonicMid=C4=60;72(C5)=+12 → 高音点,59(B3)=-1 → 低音点
  const midis = [59, 60, 62, 64, 65, 67, 69, 72];
  const notes = mkNotes(midis.map((m, i) => i * 0.5), midis.map(() => 0.45), midis);
  const q = ctx.quantizeRhythm(notes);
  const score = ctx.buildJianpuScore(q, 0, 'major', null);
  const ns = score.symbols.filter(s => s.t === 'note');
  ok('高八度音带 hi-dot', ns[7].oct === 1, 'top oct=' + ns[7].oct);
  ok('低八度音带 lo-dot', ns[0].oct === -1, 'bottom oct=' + ns[0].oct);
  const h = ctx.buildJianpuScoreHtml(score);
  ok('HTML:hi-dot 渲染', h.indexOf('hi-dot') >= 0);
  ok('HTML:lo-dot 渲染', h.indexOf('lo-dot') >= 0);
}

console.log('=== 场景10 长音碎片合并(v2.33.1 机枪声根治) ===');
{
  // A. 大颤音碎片:1.8s 稳态音被切成 14 片(重叠 75ms、Δ≤1、交替振荡)→ 应并回 1 个长音
  const frags = [];
  for (let i = 0; i < 14; i++) frags.push({ start: i * 0.125, dur: 0.2, end: i * 0.125 + 0.2, midi: (i % 2 === 0 ? 63.4 : 64.4) });
  const mergedA = ctx.mergeFragments(frags);
  ok('14 片颤音碎片 → 1 个长音', mergedA.length === 1, 'len=' + mergedA.length);
  ok('合并后音高=加权均值', Math.abs(mergedA[0].midi - 63.9) < 0.1, 'midi=' + mergedA[0].midi.toFixed(2));
  ok('合并后时长=总跨度', Math.abs(mergedA[0].dur - 1.825) < 0.01, 'dur=' + mergedA[0].dur.toFixed(2));
  // B. 音阶跑动保护:单调同向 Δ=1 → 不得合并
  const run = mkNotes([0, 0.12, 0.24, 0.36], [0.11, 0.11, 0.11, 0.11], [60, 61, 62, 63]);
  ok('音阶跑动不合并', ctx.mergeFragments(run).length === 4, 'len=' + ctx.mergeFragments(run).length);
  // C. 回音 1-2-1 保护:Δ=1 交替但 <4 片 → 不得合并
  const turn = mkNotes([0, 0.12, 0.24], [0.11, 0.11, 0.11], [60, 61, 60]);
  ok('回音 1-2-1 不合并', ctx.mergeFragments(turn).length === 3, 'len=' + ctx.mergeFragments(turn).length);
  // D. 同音碎片(无颤音型交替):三个 60 贴近 → 合并
  const same = mkNotes([0, 0.15, 0.3], [0.12, 0.12, 0.12], [60, 60, 60]);
  const mergedD = ctx.mergeFragments(same);
  ok('同音碎片合并', mergedD.length === 1 && Math.round(mergedD[0].midi) === 60, JSON.stringify(mergedD.map(x => Math.round(x.midi))));
  // E. 真实旋律两音(Δ=4)不误并
  const real2 = mkNotes([0, 0.5], [0.45, 0.45], [60, 64]);
  ok('Δ=4 真实旋律不合并', ctx.mergeFragments(real2).length === 2);
  // F. 管道集成:碎片 + 两个真音 → 谱面 3 个长音,回放/高亮同源
  const frags2 = frags.concat(mkNotes([2.2, 3.0], [0.6, 0.5], [69, 64]));
  const metaF = ctx.runJianpuPipeline(frags2);
  ok('管线:mergedNotes=3 音(1并+2真)', metaF.stage1.mergedNotes.length === 3, 'len=' + metaF.stage1.mergedNotes.length);
  ok('管线:谱面音符数=3', metaF.stage1.qNotes.length === 3, 'qNotes=' + metaF.stage1.qNotes.length);
  ok('管线:首音为合并长音', metaF.stage1.qNotes[0].value16 >= 8, 'value16=' + metaF.stage1.qNotes[0].value16);
  const scoreF = ctx.buildJianpuScore(metaF.stage1, 0, 'major', null);
  const hF = ctx.buildJianpuScoreHtml(scoreF);
  ok('谱面:3 个 note 符号 + 增时线', (hF.match(/data-i="/g) || []).length === 3 && hF.indexOf('jp-dash') >= 0, 'h=' + hF.slice(0, 160));
}

console.log('\n' + (failures === 0 ? '...阶段一全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
