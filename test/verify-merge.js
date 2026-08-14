#!/usr/bin/env node
/* verify-merge.js — 验证「多段补充哼唱」合并分析
 * 模拟结果页「再哼一段」的核心逻辑：每段单独定调，再把所有段合并重新定调。
 * 场景：
 *   1. 同调两段合并 → 调性正确，且置信度 ≥ 单段（提升）
 *   2. 同调三段合并 → 调性正确，置信度 ≥ 单段
 *   3. 不同调两段合并 → 不崩溃、给出调性，且置信度低于单段（矛盾信息）
 * 注：合并时结束音不再有特殊权重（noEndingBoost:true），只依赖整体重心/音级分布。
 */
const path = require('path');
const KeyDetect = require(path.join(__dirname, '..', 'key.js')).KeyDetect;

let failures = 0;
function ok(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}
function mk(midi) { return { midi: midi, dur: 0.4 }; }

// B 小调三段旋律（不同片段，同为 B 自然小调音阶；第 3 段含导音 C# 且结束在 B，避免与关系大调 D 混淆）
const bm1 = [59, 62, 66, 62, 59].map(mk);
const bm2 = [66, 69, 66, 62, 59].map(mk);
const bm3 = [59, 61, 62, 66, 59].map(mk);
// C 大调一段（用于不同调矛盾场景）
const c1 = [60, 64, 67, 64, 60].map(mk);

function merged(segs) {
  let all = [];
  segs.forEach(s => { all = all.concat(s); });
  return all;
}

// 1) 同调两段合并 → 提升
{
  const single = KeyDetect.detectKey(bm1, { noEndingBoost: false });
  const both = KeyDetect.detectKey(merged([bm1, bm2]), { noEndingBoost: true });
  const correct = both && both.rootPC === 11 && both.mode === 'minor';
  ok('同调两段合并 → B 小调', correct, both && (both.keyName + ' conf=' + both.confidence.toFixed(2)));
  ok('两段合并置信度 ≥ 单段', both && single && both.confidence >= single.confidence,
    '单段 ' + (single && single.confidence.toFixed(2)) + ' → 合并 ' + (both && both.confidence.toFixed(2)));
}

// 2) 同调三段合并 → 提升且稳定
{
  const single = KeyDetect.detectKey(bm1, { noEndingBoost: false });
  const three = KeyDetect.detectKey(merged([bm1, bm2, bm3]), { noEndingBoost: true });
  const correct = three && three.rootPC === 11 && three.mode === 'minor';
  ok('同调三段合并 → B 小调', correct, three && (three.keyName + ' conf=' + three.confidence.toFixed(2)));
  ok('三段合并置信度 ≥ 单段', three && single && three.confidence >= single.confidence,
    '单段 ' + (single && single.confidence.toFixed(2)) + ' → 合并 ' + (three && three.confidence.toFixed(2)));
}

// 3) 不同调合并 → 不崩溃 + 置信度下降
{
  const single = KeyDetect.detectKey(bm1, { noEndingBoost: false });
  const mix = KeyDetect.detectKey(merged([bm1, c1]), { noEndingBoost: true });
  ok('不同调合并仍给出调性（不崩溃）', !!mix && !!mix.keyName, mix && mix.keyName);
  ok('不同调合并置信度低于单段', mix && single && mix.confidence < single.confidence,
    '单段 ' + (single && single.confidence.toFixed(2)) + ' → 混合 ' + (mix && mix.confidence.toFixed(2)));
  // 两段各自的倾向应不同（正是 UI 触发「调性不一致」警告的依据）
  const kA = KeyDetect.detectKey(bm1, { noEndingBoost: false });
  const kB = KeyDetect.detectKey(c1, { noEndingBoost: false });
  ok('两段单独倾向不同（触发不一致提示）', kA && kB && (kA.rootPC !== kB.rootPC || kA.mode !== kB.mode),
    kA && kB && (kA.keyName + ' vs ' + kB.keyName));
}

console.log('\n' + (failures === 0 ? '多段合并验证全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
