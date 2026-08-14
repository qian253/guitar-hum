#!/usr/bin/env node
/* verify-essentia-vote.js — 验证「Essentia 参与投票」逻辑（从 index.html 提取真实 applyEssentiaVote）
 * 场景：
 *   1. Essentia 与前端一致 → 置信度 +0.08（封顶 1.0）
 *   2. Essentia 给出关系大小调（同音阶）→ +0.02
 *   3. Essentia 冲突 → ×0.8
 *   4. Essentia 不可用（null）→ 不改置信度、返回 null
 *   5. 返回的 before/after 记录正确
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

function extractFn(source, name) {
  const idx = source.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('not found: ' + name);
  let i = source.indexOf('{', idx), depth = 0, inS = null, inLine = false, inBlock = false;
  for (; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(idx, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const ctx = { Math };
const applyEssentiaVote = new Function('with(this){ return (' + extractFn(html, 'applyEssentiaVote') + '); }').call(ctx);

// 1) 一致 → +0.08，封顶 1.0
{
  const key = { rootPC: 11, mode: 'minor', confidence: 0.7 };
  const vote = applyEssentiaVote(key, { rootPC: 11, mode: 'minor' });
  ok('一致 → 置信度 +0.08', Math.abs(key.confidence - 0.78) < 1e-9, '0.70 → ' + key.confidence);
  ok('vote.agree 标记', vote && vote.agree === true && vote.relAgree === false);
  ok('before/after 记录', vote && vote.before === 0.7 && Math.abs(vote.after - 0.78) < 1e-9);
  const key2 = { rootPC: 0, mode: 'major', confidence: 0.95 };
  applyEssentiaVote(key2, { rootPC: 0, mode: 'major' });
  ok('一致但封顶 1.0', key2.confidence === 1.0, '0.95 → ' + key2.confidence);
}

// 2) 关系大小调（B 小调 vs D 大调）→ +0.02
{
  const key = { rootPC: 11, mode: 'minor', confidence: 0.6 };
  const vote = applyEssentiaVote(key, { rootPC: 2, mode: 'major' });
  ok('关系大小调 → +0.02', Math.abs(key.confidence - 0.62) < 1e-9, '0.60 → ' + key.confidence);
  ok('relAgree 标记', vote && vote.relAgree === true && vote.agree === false);
  // 反向：D 大调 vs B 小调 也是关系调
  const key2 = { rootPC: 2, mode: 'major', confidence: 0.6 };
  const vote2 = applyEssentiaVote(key2, { rootPC: 11, mode: 'minor' });
  ok('关系调反向成立（D大 vs B小）', vote2 && vote2.relAgree === true && Math.abs(key2.confidence - 0.62) < 1e-9);
}

// 3) 冲突 → ×0.8
{
  const key = { rootPC: 11, mode: 'minor', confidence: 0.7 };
  const vote = applyEssentiaVote(key, { rootPC: 0, mode: 'major' });
  ok('冲突 → ×0.8', Math.abs(key.confidence - 0.56) < 1e-9, '0.70 → ' + key.confidence);
  ok('冲突标记 agree=false relAgree=false', vote && vote.agree === false && vote.relAgree === false);
}

// 4) null / 无 Essentia → 原样返回
{
  const key = { rootPC: 11, mode: 'minor', confidence: 0.7 };
  ok('essentia 不可用 → 不改置信度', applyEssentiaVote(key, null) === null && key.confidence === 0.7);
  ok('无 key → null', applyEssentiaVote(null, { rootPC: 11, mode: 'minor' }) === null);
}

console.log('\n' + (failures === 0 ? 'Essentia 投票验证全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
