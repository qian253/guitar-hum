#!/usr/bin/env node
/* replay_annotations.js — 用 13 首真实标注重建音符序列，复现并网格搜索主音权重
 * 重建：jianpu 数字（按检测调解释的音阶级数）+ 证据链的时长最长音级/结束音近似时长
 * 变体：string-replace 修改 key.js 常量/公式 → 统计主音命中率 */
const fs = require('fs');
const path = require('path');

const KEY_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'key.js'), 'utf8');
const data = JSON.parse(fs.readFileSync('C:/Users/keyou/Downloads/哼唱标注数据.json', 'utf8'));

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAME_PC = Object.fromEntries(NAMES.map((n, i) => [n, i]));
const MAJOR_SEMS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SEMS = [0, 2, 3, 5, 7, 8, 10];

// 从 detected.keyName 提取检测调（谱面模式显示「D大调（B小调）」→ 取括号前的）
function detectRootMode(keyName) {
  const m = keyName.match(/([A-G]#?)\s*(大调|小调)/);
  if (!m) return null;
  return { root: NAME_PC[m[1]], mode: m[2] === '大调' ? 'major' : 'minor' };
}

// 重建音符序列（近似：统一 0.4s；最长音级音 +0.4s；结束音改 1.0s）
function rebuildNotes(item) {
  const dm = detectRootMode(item.detected.keyName);
  if (!dm) return null;
  const semis = dm.mode === 'major' ? MAJOR_SEMS : MINOR_SEMS;
  const jp = item.jianpu;
  const notes = [];
  for (const ch of jp) {
    if (!/[1-7]/.test(ch)) continue;
    const deg = parseInt(ch, 10) - 1;
    const pc = (dm.root + semis[deg]) % 12;
    // 音高：给一个中音区基音（C4=60），同音级都用同一 midi（音级分析不需要八度）
    notes.push({ midi: 60 + pc, dur: 0.4 });
  }
  if (!notes.length) return null;
  // 证据链：时长最长音级 + 结束音
  const ev = item.evidence || '';
  let domM = ev.match(/时长最长音级\s+([A-G]#?)/);
  let endM = ev.match(/结束音\s+([A-G]#?)/);
  if (domM) {
    const pc = NAME_PC[domM[1]];
    for (const n of notes) { if (((Math.round(n.midi) % 12) + 12) % 12 === pc) n.dur += 0.4; }
  }
  if (endM) {
    const pc = NAME_PC[endM[1]];
    const last = notes[notes.length - 1];
    if (((Math.round(last.midi) % 12) + 12) % 12 === pc) last.dur = 1.0;
    else notes.push({ midi: 60 + pc, dur: 1.0 });
  }
  return notes;
}

// 生成带自定义权重的 detectKey
function makeDetect(opts) {
  let src = KEY_SRC;
  src = src.replace(/var CENTROID_WEIGHT = [\d.]+/, 'var CENTROID_WEIGHT = ' + (opts.centroid != null ? opts.centroid : 0.04));
  src = src.replace(/var STABILITY_WEIGHT = [\d.]+/, 'var STABILITY_WEIGHT = ' + (opts.stability != null ? opts.stability : 0.10));
  src = src.replace(/var CHEW_WEIGHT = [\d.]+/, 'var CHEW_WEIGHT = ' + (opts.chew != null ? opts.chew : 0.12));
  src = src.replace(/var SCALE_BONUS = [\d.]+/, 'var SCALE_BONUS = ' + (opts.scale != null ? opts.scale : 0.20));
  // 新增：结束音证据（root === endingPC 时加分）
  if (opts.ending != null) {
    src = src.replace('var cBonus = centroidPresent',
      'var endingPC = pc(Math.round(lastM)); var eBonus = (endingPC === root) ? ' + opts.ending + ' : 0; var cBonus = centroidPresent');
    src = src.replace('+ cBonus + stabBonus + chewBonus + guitarBonus', '+ cBonus + eBonus + stabBonus + chewBonus + guitarBonus');
  } else {
    src = src.replace('var cBonus = centroidPresent', 'var endingPC = pc(Math.round(lastM)); var eBonus = 0; var cBonus = centroidPresent');
    src = src.replace('+ cBonus + stabBonus + chewBonus + guitarBonus', '+ cBonus + eBonus + stabBonus + chewBonus + guitarBonus');
  }
  // 新增：最长音级证据
  if (opts.dominant != null) {
    src = src.replace('var eBonus =', 'var dBonus = (dominantPC === root) ? ' + opts.dominant + ' : 0; var eBonus =');
    src = src.replace('+ cBonus + eBonus + stabBonus', '+ cBonus + eBonus + dBonus + stabBonus');
  } else {
    src = src.replace('var eBonus =', 'var dBonus = 0; var eBonus =');
    src = src.replace('+ cBonus + eBonus + stabBonus', '+ cBonus + eBonus + dBonus + stabBonus');
  }
  const m = { exports: {} };
  new Function('module', src)(m);
  return m.exports.KeyDetect;
}

function score(KD, tolerance) {
  let hit = 0, total = 0;
  const details = [];
  for (const item of data) {
    const notes = rebuildNotes(item);
    if (!notes) continue;
    total++;
    const truth = item.truth.root;
    const k = KD.detectKey(notes, { noEndingBoost: false, recordingDur: 8 });
    if (!k) { details.push('null'); continue; }
    const diff = Math.abs(k.rootPC - truth);
    const ok = diff === 0 || (tolerance ? diff <= tolerance : false);
    if (ok) hit++;
    details.push('t' + NAMES[truth] + '→' + NAMES[k.rootPC] + (ok ? '✓' : '✗'));
  }
  return { hit, total, details };
}

function run(label, opts, tolerance) {
  const KD = makeDetect(opts);
  const r = score(KD, tolerance);
  console.log(label.padEnd(46) + ' 主音命中 ' + r.hit + '/' + r.total + ' = ' + (r.hit / r.total * 100).toFixed(0) + '%' + (tolerance ? '（±' + tolerance + '半音容忍）' : '') + '   ' + r.details.join(' '));
  return r;
}

console.log('13 首真实标注 · 主音权重网格搜索（重建近似音符）\n');
run('基线（当前权重）', {}, 0);
run('基线（±1 半音容忍）', {}, 1);
console.log();
run('加 结束音 +0.12', { ending: 0.12 }, 0);
run('加 结束音 +0.15', { ending: 0.15 }, 0);
run('加 结束音 +0.2', { ending: 0.2 }, 0);
run('加 最长音级 +0.08', { dominant: 0.08 }, 0);
run('加 结束0.15 + 最长0.06', { ending: 0.15, dominant: 0.06 }, 0);
run('结束0.15+最长0.06+Chew降0.06', { ending: 0.15, dominant: 0.06, chew: 0.06 }, 0);
run('结束0.15+最长0.06+Chew降0.06+scale0.15', { ending: 0.15, dominant: 0.06, chew: 0.06, scale: 0.15 }, 0);
run('结束0.15+最长0.06+Chew降0.06（±1容忍）', { ending: 0.15, dominant: 0.06, chew: 0.06 }, 1);
