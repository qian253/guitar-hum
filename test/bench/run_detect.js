#!/usr/bin/env node
/* run_detect.js — 基准用定调 runner
 * 用法: node run_detect.js <profile> < notes.json
 *   profile: krumhansl | temperley | albrecht（覆盖 key.js 的 K-S profile 后运行真实 detectKey）
 * 输出: JSON {rootPC, mode, keyName, confidence}
 */
const fs = require('fs');
const path = require('path');
const PROFILE = process.argv[2] || 'krumhansl';

const PROFILES = {
  krumhansl: {
    major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
  },
  temperley: {
    major: [0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.366, 0.057, 0.400],
    minor: [0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330],
  },
  albrecht: {
    major: [0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.080, 0.008, 0.081],
    minor: [0.220, 0.006, 0.104, 0.123, 0.019, 0.103, 0.012, 0.214, 0.062, 0.022, 0.061, 0.052],
  },
};

const p = PROFILES[PROFILE];
if (!p) { console.error('未知 profile: ' + PROFILE); process.exit(2); }

let src = fs.readFileSync(path.join(__dirname, '..', '..', 'key.js'), 'utf8');
src = src.replace(/var KS_MAJOR = \[[^\]]*\]/, 'var KS_MAJOR = [' + p.major.join(',') + ']');
src = src.replace(/var KS_MINOR = \[[^\]]*\]/, 'var KS_MINOR = [' + p.minor.join(',') + ']');
const m = { exports: {} };
new Function('module', src)(m);
const KeyDetect = m.exports.KeyDetect;

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const notes = JSON.parse(input);
  const k = KeyDetect.detectKey(notes, { noEndingBoost: false });
  console.log(JSON.stringify(k ? { rootPC: k.rootPC, mode: k.mode, keyName: k.keyName, confidence: k.confidence } : null));
});
