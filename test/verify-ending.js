#!/usr/bin/env node
/* verify-ending.js — 验证「结束音不再主导主音判断」
 * 用完整音阶旋律（含特征音）确保旋律本身无歧义，再测结束音误导场景。
 */
const path = require('path');
const KeyDetect = require(path.join(__dirname, '..', 'key.js')).KeyDetect;

let failures = 0;
function ok(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}
function mk(midi, dur) { return { midi, dur }; }

// 1) C 大调完整音阶旋律，C 为主音，结束在 G（属音）→ 应为 C 大调
{
  const notes = [
    mk(60,0.5), mk(62,0.3), mk(64,0.4), mk(65,0.3), mk(67,0.3),
    mk(69,0.3), mk(71,0.3), mk(72,0.5),
    mk(71,0.3), mk(69,0.3), mk(67,0.4), mk(65,0.3), mk(64,0.3),
    mk(62,0.3), mk(60,0.5),
    mk(67,0.6) // 结束在 G（属音）
  ];
  const k = KeyDetect.detectKey(notes);
  const correct = k && k.rootPC === 0 && k.mode === 'major';
  ok('C大调完整音阶结束在G → 识别 C 大调', correct, k && (k.keyName + ' | 重心 ' + k.centroidNote + ' | 时长最长音级 ' + k.dominantNote + ' | 结束 ' + k.endingNote + ' ×' + k.endingMult));
}

// 2) B 小调（自然小调）完整音阶，结束在 F#（属音）→ 应为 B 小调
{
  const notes = [
    mk(59,0.5), mk(61,0.3), mk(62,0.4), mk(64,0.3), mk(66,0.3),
    mk(67,0.3), mk(69,0.3), mk(71,0.5),
    mk(69,0.3), mk(67,0.3), mk(66,0.4), mk(64,0.3), mk(62,0.3),
    mk(61,0.3), mk(59,0.5),
    mk(66,0.6) // 结束在 F#（属音）
  ];
  const k = KeyDetect.detectKey(notes);
  const correct = k && k.rootPC === 11 && k.mode === 'minor';
  ok('B小调完整音阶结束在F# → 识别 B 小调', correct, k && (k.keyName + ' | 重心 ' + k.centroidNote + ' | 时长最长音级 ' + k.dominantNote + ' | 结束 ' + k.endingNote + ' ×' + k.endingMult));
}

// 3) 不完整、无终止感片段（几个不构成完整音阶的音）→ 给出调性 + 中等置信度
{
  const notes = [mk(62,0.3), mk(64,0.3), mk(60,0.3), mk(65,0.4)];
  const k = KeyDetect.detectKey(notes);
  ok('无终止感片段能给出调性', !!k && !!k.keyName, k && k.keyName);
  ok('无终止感片段置信度中等（<0.9）', k && k.confidence < 0.9, k && ('conf=' + k.confidence.toFixed(2)));
}

// 4) 短 C 大调片段结束在三音 E → 识别 C 大调，不把 E 当主音
{
  const notes = [mk(60,0.5), mk(64,0.3), mk(65,0.3), mk(67,0.3), mk(62,0.3), mk(60,0.5), mk(64,0.4)]; // C E F G D C E
  const k = KeyDetect.detectKey(notes);
  const correct = k && k.rootPC === 0 && k.mode === 'major';
  ok('短片段结束在三音E → 识别 C 大调', correct, k && (k.keyName + ' | 结束 ' + k.endingNote + ' ×' + k.endingMult));
}

// 5) 证据链字段完整性
{
  const notes = [mk(60,0.4), mk(64,0.4), mk(67,0.4), mk(60,0.5)];
  const k = KeyDetect.detectKey(notes);
  const hasFields = k && typeof k.centroidNote === 'string' && typeof k.dominantPC === 'number'
    && typeof k.endingNote === 'string' && typeof k.endingMult === 'number'
    && Array.isArray(k.candidateScores) && k.candidateScores.length > 0
    && k.judge && Array.isArray(k.judge.evidence);
  ok('证据链字段完整', !!hasFields);
  if (k && k.judge && k.judge.evidence) {
    ok('证据链含重心/音级/结束音信息', k.judge.evidence.some(s => /重心音/.test(s) && /时长最长音级/.test(s) && /结束音/.test(s)));
  }
}

console.log('\n' + (failures === 0 ? '结束音权重修正验证全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
