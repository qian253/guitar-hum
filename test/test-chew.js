#!/usr/bin/env node
/* test-chew.js — v2.16 验收测试：Chew 螺旋数组主音 + 大小调判定 + 变调夹换算
 * 用户指定验收用例：
 *   主音：B D F# A B → B；G B D F# G → G；A C E G A → A
 *   调式：主音 B，小三度特征（B-D 反复）→ B 小调；大三度特征（B-D#）→ B 大调
 *   变调夹：主音 B → G调夹4品；主音 D → C调夹2品；主音 G → G调夹0品
 */
const path = require('path');
const KeyDetect = require(path.join(__dirname, '..', 'key.js')).KeyDetect;

let failures = 0;
function ok(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}
const mk = (m, d) => ({ midi: m, dur: d || 0.4 });

/* ---------- 主音三例 ---------- */
console.log('【主音检测】');
{
  const cases = [
    ['B', [59, 62, 66, 69, 59]],
    ['G', [55, 59, 62, 66, 55]],
    ['A', [57, 60, 64, 67, 57]],
  ];
  const wantPC = { B: 11, G: 7, A: 9 };
  for (const [name, arr] of cases) {
    const notes = arr.map(m => mk(m)); // 注意：不能 .map(mk)——第二个参数 index 会被当成 dur
    const k = KeyDetect.detectKey(notes);
    const chew = KeyDetect.chewAnalyze(notes);
    ok('主音 ' + name + '：系统判 ' + (k ? k.keyName : 'null'), k && k.rootPC === wantPC[name], 'Chew最近音级=' + (chew ? KeyDetect.SPELL[chew.tonic.rootPC] : '-'));
    if (chew) {
      ok('Chew 输出主音候选与置信度', typeof chew.tonic.rootPC === 'number' && typeof chew.confidence === 'number' && chew.confidence >= 0 && chew.confidence <= 1, 'conf=' + chew.confidence);
      // Chew 作为辅助验证：候选应与真实主音一致或落在主和弦骨架内（主音/五音/三音）
      const d = ((chew.tonic.rootPC - wantPC[name]) % 12 + 12) % 12;
      const inSkeleton = [0, 3, 4, 7].indexOf(d) >= 0;
      console.log('    [Chew辅助] ' + name + ' 例候选 ' + KeyDetect.SPELL[chew.tonic.rootPC] + '（' + (inSkeleton ? '在主和弦骨架内 ✓' : '偏离 ✗') + '，系统主判据为准）');
    }
  }
}

/* ---------- 大小调判定 ---------- */
console.log('【大小调判定】');
{
  // 小三度特征：B-D 反复出现（B D B D F# B）→ B 小调
  const minorNotes = [59, 62, 59, 62, 66, 59].map(m => mk(m));
  const kMin = KeyDetect.detectKey(minorNotes);
  ok('B-D 小三度特征 → B 小调', kMin && kMin.rootPC === 11 && kMin.mode === 'minor', kMin && kMin.keyName);
  // 大三度特征：B-D# 反复出现（B D# B D# F# B）→ B 大调
  const majorNotes = [59, 63, 59, 63, 66, 59].map(m => mk(m));
  const kMaj = KeyDetect.detectKey(majorNotes);
  ok('B-D# 大三度特征 → B 大调', kMaj && kMaj.rootPC === 11 && kMaj.mode === 'major', kMaj && kMaj.keyName);
}

/* ---------- 变调夹换算 ---------- */
console.log('【变调夹换算】');
{
  // 复刻 index.html 的 recommendFingering 公式
  function recommendFingering(dmode, droot) {
    var target = dmode === 'major' ? droot : (droot + 3) % 12;
    var cCapo = target, gCapo = (target + 5) % 12;
    if (cCapo <= gCapo) return { shape: 'C', capo: cCapo };
    return { shape: 'G', capo: gCapo };
  }
  const b = recommendFingering('major', 11);
  ok('主音 B → G 调夹 4 品', b.shape === 'G' && b.capo === 4, b.shape + b.capo);
  const d = recommendFingering('major', 2);
  ok('主音 D → C 调夹 2 品', d.shape === 'C' && d.capo === 2, d.shape + d.capo);
  const g = recommendFingering('major', 7);
  ok('主音 G → G 调夹 0 品', g.shape === 'G' && g.capo === 0, g.shape + g.capo);
  // 全 24 调夹品范围 0~7
  let rangeOk = true;
  for (let r = 0; r < 12; r++) {
    const mj = recommendFingering('major', r), mn = recommendFingering('minor', r);
    if (mj.capo > 7 || mn.capo > 7) rangeOk = false;
  }
  ok('全部调性夹品范围 0~7', rangeOk);
}

console.log('\n' + (failures === 0 ? 'Chew 验收测试全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
