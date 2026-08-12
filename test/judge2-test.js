#!/usr/bin/env node
/* judge2-test.js — 验证 DeepSeek 版"多级裁判"逻辑
 * 四级裁判（强制唯一结果，不返回"也可能是"）：
 *   L1 终点审判（一票否决）：最后 1-2 个音的强拍长音 = 主音
 *   L2 主和弦骨架审判：大调骨架(主音/大三/纯五) vs 小调骨架(主音/小三/纯五)，>30% 判定
 *   L3 导音半音解决：小二度上行到主音（小调导音需临时升高半音）
 *   L4 文化模板：默认偏大调（兜底）
 */
const SPELL = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pcOf = m => ((m % 12) + 12) % 12;

// 四级裁判：notes = [{midi,dur}], candA/candB = {pc, mode}
function judge(notes, candA, candB) {
  const evidence = [];
  // 时值加权直方图
  const hist = new Array(12).fill(0);
  notes.forEach(n => { hist[pcOf(n.midi)] += n.dur || 0.25; });

  // ---- L1 终点审判（一票否决）----
  // 优先看真正的最后一个音符：它若是某个主音，直接判（DeepSeek：最后一个非静音音符）
  const lastNote = notes[notes.length - 1];
  const lastPC = pcOf(lastNote.midi);
  const lastDur = lastNote.dur || 0.25;
  // 取最后 2 个音符中时值最长的（重拍长音），若与最后音一致则更可信
  const tail = notes.slice(-2);
  let tailBest = { pc: lastPC, dur: lastDur, isLast: true };
  tail.forEach(n => {
    const p = pcOf(n.midi);
    if (n.dur > tailBest.dur) tailBest = { pc: p, dur: n.dur, isLast: n === lastNote };
  });
  // 命中判定：主音匹配（最后一个音优先，其次重拍长音）
  if (lastPC === candA.pc || (tailBest.pc === candA.pc && tailBest.dur >= lastDur * 1.5)) {
    evidence.push('L1终点:主音=' + SPELL[candA.pc] + '(' + candA.mode + ')');
    return { verdict: candA.mode, pc: candA.pc, evidence, confidence: 0.97, source: 'L1' };
  }
  if (lastPC === candB.pc || (tailBest.pc === candB.pc && tailBest.dur >= lastDur * 1.5)) {
    evidence.push('L1终点:主音=' + SPELL[candB.pc] + '(' + candB.mode + ')');
    return { verdict: candB.mode, pc: candB.pc, evidence, confidence: 0.97, source: 'L1' };
  }
  evidence.push('L1终点:结尾音' + SPELL[lastPC] + '不是任一主音，进入L2');

  // ---- L2 主和弦骨架审判 ----
  const majTri = [candA.pc, (candA.pc + 4) % 12, (candA.pc + 7) % 12]; // 大调 I ii? 主和弦=主音/大三/纯五
  const minTri = [candA.pc, (candA.pc + 3) % 12, (candA.pc + 7) % 12]; // 小调 i = 主音/小三/纯五
  // 对两个候选都算各自的骨架权重，取高的那个
  function triadW(rootPc, isMajor) {
    const sems = isMajor ? [0, 4, 7] : [0, 3, 7];
    let w = 0;
    sems.forEach(s => { w += hist[(rootPc + s) % 12] || 0; });
    return w;
  }
  // 用每个候选"自己作为主音"的骨架权重比较——但这里两个候选是关系大小调，共享主音候选？
  // 不：candA 是 D大调(D=2), candB 是 B小调(B=11)，主音不同。
  const wA_maj = triadW(candA.pc, true);   // D大调骨架 D F# A
  const wA_min = triadW(candA.pc, false);  // D小调骨架 D F A
  const wB_maj = triadW(candB.pc, true);   // B大调骨架 B D# F#
  const wB_min = triadW(candB.pc, false);  // B小调骨架 B D F#
  // 候选A应为大调：用大调骨架；候选B应为小调：用小调骨架
  const sA = candA.mode === 'major' ? wA_maj : wA_min;
  const sB = candB.mode === 'major' ? wB_maj : wB_min;
  evidence.push(`L2骨架: ${SPELL[candA.pc]}${candA.mode}骨架=${sA.toFixed(2)}, ${SPELL[candB.pc]}${candB.mode}骨架=${sB.toFixed(2)}`);
  if (sA > sB * 1.3) { evidence.push('L2:大调骨架显著占优'); return { verdict: candA.mode, pc: candA.pc, evidence, confidence: 0.9, source: 'L2' }; }
  if (sB > sA * 1.3) { evidence.push('L2:小调骨架显著占优'); return { verdict: candB.mode, pc: candB.pc, evidence, confidence: 0.9, source: 'L2' }; }

  // ---- L3 导音半音解决 ----
  let leadA = 0, leadB = 0;
  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1].midi, cur = notes[i].midi, step = cur - prev;
    if (Math.abs(step - 1) <= 0.5) { // 小二度上行
      if (pcOf(cur) === candA.pc) leadA++;
      if (pcOf(cur) === candB.pc) leadB++;
    }
  }
  evidence.push(`L3导音: 到${SPELL[candA.pc]}=${leadA}次, 到${SPELL[candB.pc]}=${leadB}次`);
  if (leadA !== leadB) {
    if (leadA > leadB) { evidence.push('L3:导音解决倾向' + candA.mode); return { verdict: candA.mode, pc: candA.pc, evidence, confidence: 0.85, source: 'L3' }; }
    evidence.push('L3:导音解决倾向' + candB.mode); return { verdict: candB.mode, pc: candB.pc, evidence, confidence: 0.85, source: 'L3' };
  }

  // ---- L4 文化模板：偏大调 ----
  evidence.push('L4:前三级均无法区分，默认偏大调');
  return { verdict: 'major', pc: candA.pc, evidence, confidence: 0.55, source: 'L4' };
}

// 测试用例：notes(旋律) + 两个候选(模式/主音pc) + 期望
const cases = [
  // 用户痛点：《演员》B小调 vs D大调
  ['演员:B小调旋律', [59, 62, 66, 64, 62, 59, 62, 59], { mode: 'major', pc: 2 }, { mode: 'minor', pc: 11 }, 'minor', 'B'],
  ['B小调:落尾B', [59, 62, 66, 64, 62, 59, 62, 59, 62, 59], { mode: 'major', pc: 2 }, { mode: 'minor', pc: 11 }, 'minor', 'B'],
  ['B小调:骨架B-D-F#', [59, 62, 66, 71, 66, 62, 59], { mode: 'major', pc: 2 }, { mode: 'minor', pc: 11 }, 'minor', 'B'],
  ['D大调:落尾D', [62, 66, 69, 71, 69, 66, 62], { mode: 'major', pc: 2 }, { mode: 'minor', pc: 11 }, 'major', 'D'],
  ['D大调:骨架D-F#-A', [62, 66, 69, 74, 69, 66, 62], { mode: 'major', pc: 2 }, { mode: 'minor', pc: 11 }, 'major', 'D'],
  // 关系调：C大调 vs Am
  ['C大调:落尾C', [60, 64, 67, 72, 67, 64, 60], { mode: 'major', pc: 0 }, { mode: 'minor', pc: 9 }, 'major', 'C'],
  ['Am小调:落尾A', [57, 60, 64, 67, 64, 60, 57], { mode: 'major', pc: 0 }, { mode: 'minor', pc: 9 }, 'minor', 'A'],
  ['Am小调:带导音G#→A', [56, 57, 60, 64, 60, 56, 57], { mode: 'major', pc: 0 }, { mode: 'minor', pc: 9 }, 'minor', 'A'],
  // G大调 vs Em
  ['G大调:落尾G', [55, 59, 62, 67, 62, 59, 55], { mode: 'major', pc: 7 }, { mode: 'minor', pc: 4 }, 'major', 'G'],
  ['Em小调:落尾E', [52, 55, 59, 62, 59, 55, 52], { mode: 'major', pc: 7 }, { mode: 'minor', pc: 4 }, 'minor', 'E'],
];

let pass = 0, fail = 0;
cases.forEach(c => {
  const notes = c[1].map(m => ({ midi: m, dur: 0.5 }));
  const r = judge(notes, c[2], c[3]);
  const ok = r.verdict === c[4] && SPELL[r.pc] === c[5];
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL'), c[0].padEnd(22), '→', SPELL[r.pc] + (r.verdict === 'major' ? '大' : '小'),
    '|', r.source, '|', r.confidence, ok ? '' : '← 期望' + c[5] + (c[4] === 'major' ? '大' : '小'));
});
console.log(`\n${pass}/${cases.length} 通过`);
process.exit(fail ? 1 : 0);
