#!/usr/bin/env node
/* test-stability.js — 验证「音级稳定性权重 K-S」模块（v2.15）
 * 检查：
 *   1. 输出 12 个音级稳定性得分（合计≈100）
 *   2. 模块自身的主音判断正确（C 大调 / B 小调 / D 大调）
 *   3. 稳定性得分最高的音级 = 主音（旋律质量集中在主音时）
 */
const path = require('path');
const KeyDetect = require(path.join(__dirname, '..', 'key.js')).KeyDetect;

let failures = 0;
function ok(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}
const mk = (m, d) => ({ midi: m, dur: d || 0.4 });

// 1) C 大调：主音 C 反复出现
{
  const notes = [60, 64, 67, 64, 60, 62, 67, 60].map(mk);
  const k = KeyDetect.detectKey(notes);
  ok('C 大调识别正确', k && k.rootPC === 0 && k.mode === 'major', k && k.keyName);
  ok('输出 12 个音级稳定性得分', k && Array.isArray(k.stability.scores) && k.stability.scores.length === 12);
  const sum = k.stability.scores.reduce((a, b) => a + b, 0);
  ok('稳定性得分合计≈100', Math.abs(sum - 100) < 0.5, '合计 ' + sum.toFixed(2));
  const maxIdx = k.stability.scores.indexOf(Math.max.apply(null, k.stability.scores));
  ok('稳定性最高的音级 = 主音 C', maxIdx === 0, '最高音级下标 ' + maxIdx + '（0=主音）');
  ok('模块主音判断 = C', k.stability.tonic.rootPC === 0, JSON.stringify(k.stability.tonic));
}

// 2) B 小调：B 为主音
{
  const notes = [59, 62, 66, 62, 59, 66, 59].map(mk);
  const k = KeyDetect.detectKey(notes);
  ok('B 小调识别正确', k && k.rootPC === 11 && k.mode === 'minor', k && k.keyName);
  ok('模块主音判断 = B', k && k.stability.tonic.rootPC === 11, k && JSON.stringify(k.stability.tonic));
}

// 3) D 大调：主音 D，旋律不结束在主音（考验稳定性模块）
{
  const notes = [62, 66, 69, 67, 66, 62, 69].map(mk);
  const k = KeyDetect.detectKey(notes);
  ok('D 大调识别正确（不结束在主音）', k && k.rootPC === 2 && k.mode === 'major', k && k.keyName);
}

// 4) 证据链含稳定性
{
  const notes = [60, 64, 67, 60].map(mk);
  const k = KeyDetect.detectKey(notes);
  ok('证据链含音级稳定性', k && k.judge.evidence.some(s => /音级稳定性/.test(s)));
}

console.log('\n' + (failures === 0 ? '音级稳定性模块验证全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
