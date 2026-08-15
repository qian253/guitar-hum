#!/usr/bin/env node
/* bench_weights.js — 用 168 条合成基准验证候选权重组合（tonic/exact 命中率）
 * 用法: node bench_weights.js [variant]
 *   variant: baseline | cand   （cand = 网格搜索出的真实数据最优组合）
 */
const fs = require('fs');
const path = require('path');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'manifest.json'), 'utf8'));
let src = fs.readFileSync(path.join(__dirname, '..', '..', 'key.js'), 'utf8');

const variant = process.argv[2] || 'baseline';
const OVERRIDES = {
  baseline: {},
  // 网格搜索最优：chew/centroid 关掉，结束音 0.15→0.25
  cand: {
    'var CHEW_WEIGHT = [\\d.]+': 'var CHEW_WEIGHT = 0',
    'var CENTROID_WEIGHT = [\\d.]+': 'var CENTROID_WEIGHT = 0',
    'var ENDING_BONUS = [\\d.]+': 'var ENDING_BONUS = 0.25',
  },
  // 对照：只调结束音
  ending25: {
    'var ENDING_BONUS = [\\d.]+': 'var ENDING_BONUS = 0.25',
  },
  // 对照：关 chew 保留 centroid
  nochew: {
    'var CHEW_WEIGHT = [\\d.]+': 'var CHEW_WEIGHT = 0',
  },
  // 对照：只关 centroid
  noctr: {
    'var CENTROID_WEIGHT = [\\d.]+': 'var CENTROID_WEIGHT = 0',
  },
  // 对照：关 chew+centroid，结束音保持 0.15
  chewctr: {
    'var CHEW_WEIGHT = [\\d.]+': 'var CHEW_WEIGHT = 0',
    'var CENTROID_WEIGHT = [\\d.]+': 'var CENTROID_WEIGHT = 0',
  },
  // 对照：关 chew+centroid，结束音 0.2
  chewctr_end20: {
    'var CHEW_WEIGHT = [\\d.]+': 'var CHEW_WEIGHT = 0',
    'var CENTROID_WEIGHT = [\\d.]+': 'var CENTROID_WEIGHT = 0',
    'var ENDING_BONUS = [\\d.]+': 'var ENDING_BONUS = 0.20',
  },
};
const ov = OVERRIDES[variant];
if (!ov) { console.error('未知 variant'); process.exit(2); }
for (const [re, rep] of Object.entries(ov)) src = src.replace(new RegExp(re), rep);

const m = { exports: {} };
new Function('module', src)(m);
const KD = m.exports.KeyDetect;

let exact = 0, tonic = 0, n = 0;
const byPattern = {};
for (const item of DATA) {
  const notes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', item.notes), 'utf8'));
  const k = KD.detectKey(notes, { noEndingBoost: false });
  if (!k) continue;
  n++;
  const tOk = k.rootPC === item.root;
  const eOk = tOk && k.mode === item.mode;
  if (tOk) tonic++;
  if (eOk) exact++;
  const pat = item.pattern;
  byPattern[pat] = byPattern[pat] || { n: 0, exact: 0, tonic: 0 };
  byPattern[pat].n++;
  if (tOk) byPattern[pat].tonic++;
  if (eOk) byPattern[pat].exact++;
}
console.log(`[${variant}] 总计: 主音 ${tonic}/${n} (${(tonic / n * 100).toFixed(1)}%)  精确 ${exact}/${n} (${(exact / n * 100).toFixed(1)}%)`);
for (const pat of ['scale', 'arpeggio', 'pop', 'offtune', 'nontonic_end', 'short', 'chromatic']) {
  const b = byPattern[pat];
  if (b) console.log(`  ${pat.padEnd(14)} 主音 ${b.tonic}/${b.n}  精确 ${b.exact}/${b.n}`);
}
