// eval12_js.js — 前端 key.js 在 12 条真实人声上的表现(与后端 eval12.py 对照)
const path = require('path');
const fs = require('fs');
const KeyDetect = require(path.join(__dirname, '..', 'key.js')).KeyDetect;
const data = JSON.parse(fs.readFileSync('C:/Users/keyou/Downloads/哼唱标注数据.json', 'utf8'));
const PICKS = [40, 41, 62, 65, 50, 66, 52, 64, 67, 58, 60, 61];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
let rh = 0, hits = 0;
for (let i = 0; i < PICKS.length; i++) {
  const item = data[PICKS[i]];
  const tr = item.truth.root;
  const notes = (item.notes || []).filter(n => n.m != null).map(n => ({ midi: n.m, start: n.s || 0, dur: n.d || 0.25 }));
  const r = KeyDetect.detectKey(notes);
  const okR = r.rootPC === tr;
  const okA = okR && r.mode === item.truth.mode;
  rh += okR; hits += okA;
  console.log(`[${String(i).padStart(2)}] ${NAMES[tr].padEnd(3)} → ${r.keyName.padEnd(10)} ${okR ? '✓' : '✗'}`);
}
console.log(`前端 key.js: 主音 ${rh}/12 全对 ${hits}/12`);
process.exit(0);
