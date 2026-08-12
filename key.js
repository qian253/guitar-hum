/* ============================================================
 * key.js — 调性识别（Krumhansl-Schmuckler 探测音评分）
 *
 * 输入：notes = [{midi, dur}]（midi 为浮点，已分段）
 * 流程：pitch-class 直方图（时长加权）-> 与 24 个大/小调 profile 相关
 *      -> 落尾音 tonic 权重 -> 吉他友好微调 -> 置信度
 * 纯函数、无依赖，Node / 浏览器共用。
 * ============================================================ */
(function (global) {
  'use strict';

  // Krumhansl & Schmuckler (1982) 探测音评分 (relative, max=1)
  var KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  var KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  // 归一化到均值 ~1
  function normProf(p) {
    var mean = 0;
    for (var i = 0; i < p.length; i++) mean += p[i];
    mean /= p.length;
    return p.map(function (v) { return v / mean; });
  }
  var MAJOR_PROF = normProf(KS_MAJOR);
  var MINOR_PROF = normProf(KS_MINOR);

  var TONIC_BONUS = 0.15;     // 落尾音 = 主音时的加分
  var GUITAR_BIAS = 0.02;     // 吉他友好调微调（仅在分数接近时起作用）
  var SCALE_BONUS = 0.20;     // 音阶成员加权：旋律落在该调音阶内的比例（强判别）
  var GUILD = { // 吉他友好（开放和弦优先）的大调与小调主音（pc）
    major: [0, 7, 2, 9, 4, 5],   // C, G, D, A, E, F
    minor: [0, 7, 2, 5]         // Am, Em, Bm, Dm
  };
  var MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
  var MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

  // 旋律音符（直方图）落在某调音阶内的时长比例，0..1
  function scaleMembership(hist, root, mode) {
    var scale = (mode === 'major' ? MAJOR_SCALE : MINOR_SCALE).map(function (s) { return (root + s) % 12; });
    var m = 0;
    for (var i = 0; i < 12; i++) if (scale.indexOf(i) >= 0) m += hist[i];
    return m;
  }

  // 吉他语境常用等音记法（Db=C#、Eb=D#、Ab=G#、Bb=A#）
  var SPELL = { 0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F', 6: 'F#', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B' };

  function pc(midi) { return ((midi % 12) + 12) % 12; }

  // 皮尔逊相关系数
  function corr(x, y) {
    var n = x.length, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) {
      sx += x[i]; sy += y[i]; sxy += x[i] * y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i];
    }
    var denom = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    if (Math.abs(denom) < 1e-12) return 0;
    return (n * sxy - sx * sy) / denom;
  }

  // 循环平移 profile：使调主音落在 root 上
  function shiftProfile(prof, root) {
    var out = new Array(12);
    for (var i = 0; i < 12; i++) out[(i + root) % 12] = prof[i];
    return out;
  }

  // 某音高距主音（60+pc）的半音距离（八度环绕），单位半音
  function distanceFromTonic(midi, pcTarget) {
    var d = ((midi - (60 + pcTarget)) % 12 + 12) % 12;
    if (d > 6) d -= 12;
    return d;
  }

  // ============================================================
  // 关系大小调裁判模块（DeepSeek 四级裁判，强制唯一结果）
  // 当检测到小调时，在它和关系大调之间强制判定唯一主音：
  //   L1 终点审判（一票否决）：最后 1-2 个音的强拍长音 = 主音
  //   L2 主和弦骨架审判：大调骨架(主音/大三/纯五) vs 小调骨架(主音/小三/纯五)
  //   L3 导音半音解决：小二度上行到主音（小调导音需临时升高半音）
  //   L4 文化模板：默认偏大调（兜底）
  // 返回 {verdict:'major'|'minor', pc, evidence, confidence, source}
  // ============================================================
  function judgeRelative(notes, majorPC, minorPC) {
    var candA = { pc: majorPC, mode: 'major' };
    var candB = { pc: minorPC, mode: 'minor' };
    var evidence = [];
    // 时值加权直方图
    var hist = new Array(12).fill(0);
    for (var ni = 0; ni < notes.length; ni++) hist[pc(Math.round(notes[ni].midi))] += (notes[ni].dur || 0.25);

    // ---- L1 终点审判（一票否决）----
    var lastNote = notes[notes.length - 1];
    var lastPC = pc(Math.round(lastNote.midi));
    var lastDur = lastNote.dur || 0.25;
    var tail = notes.slice(-2);
    var tailBest = { pc: lastPC, dur: lastDur, isLast: true };
    for (var ti = 0; ti < tail.length; ti++) {
      var tpc = pc(Math.round(tail[ti].midi));
      if (tail[ti].dur > tailBest.dur) tailBest = { pc: tpc, dur: tail[ti].dur, isLast: tail[ti] === lastNote };
    }
    function endHit(cand) {
      // 最后一个音即主音 → 一票；或最后一个音是主音 ± 微小偏差
      if (lastPC === cand.pc) return true;
      // 重拍长音是主音且明显更长 → 一票
      if (tailBest.pc === cand.pc && tailBest.dur >= lastDur * 1.5) return true;
      return false;
    }
    if (endHit(candA)) { evidence.push('L1终点:主音=' + SPELL[candA.pc] + '(大调)'); return { verdict: 'major', pc: candA.pc, evidence: evidence, confidence: 0.97, source: 'L1' }; }
    if (endHit(candB)) { evidence.push('L1终点:主音=' + SPELL[candB.pc] + '(小调)'); return { verdict: 'minor', pc: candB.pc, evidence: evidence, confidence: 0.97, source: 'L1' }; }
    evidence.push('L1:结尾音' + SPELL[lastPC] + '不是任一主音');

    // ---- L2 主和弦骨架审判 ----
    function triadW(rootPc, isMajor) {
      var sems = isMajor ? [0, 4, 7] : [0, 3, 7];
      var w = 0;
      for (var s = 0; s < 3; s++) w += hist[(rootPc + sems[s]) % 12] || 0;
      return w;
    }
    var sA = triadW(candA.pc, candA.mode === 'major');
    var sB = triadW(candB.pc, candB.mode === 'major');
    evidence.push('L2骨架:' + SPELL[candA.pc] + '大=' + sA.toFixed(2) + ' ' + SPELL[candB.pc] + '小=' + sB.toFixed(2));
    if (sA > sB * 1.3) { evidence.push('L2:大调骨架显著占优'); return { verdict: 'major', pc: candA.pc, evidence: evidence, confidence: 0.9, source: 'L2' }; }
    if (sB > sA * 1.3) { evidence.push('L2:小调骨架显著占优'); return { verdict: 'minor', pc: candB.pc, evidence: evidence, confidence: 0.9, source: 'L2' }; }

    // ---- L3 导音半音解决 ----
    var leadA = 0, leadB = 0;
    for (var li = 1; li < notes.length; li++) {
      var prev = notes[li - 1].midi, cur = notes[li].midi, step = cur - prev;
      if (Math.abs(step - 1) <= 0.5) { // 小二度上行
        if (pc(Math.round(cur)) === candA.pc) leadA++;
        if (pc(Math.round(cur)) === candB.pc) leadB++;
      }
    }
    evidence.push('L3导音: 到' + SPELL[candA.pc] + '=' + leadA + '次 到' + SPELL[candB.pc] + '=' + leadB + '次');
    if (leadA !== leadB) {
      if (leadA > leadB) { evidence.push('L3:导音解决倾向大调'); return { verdict: 'major', pc: candA.pc, evidence: evidence, confidence: 0.85, source: 'L3' }; }
      evidence.push('L3:导音解决倾向小调'); return { verdict: 'minor', pc: candB.pc, evidence: evidence, confidence: 0.85, source: 'L3' };
    }

    // ---- L4 文化模板：偏大调 ----
    evidence.push('L4:前三级均无法区分，默认偏大调');
    return { verdict: 'major', pc: candA.pc, evidence: evidence, confidence: 0.55, source: 'L4' };
  }

  /**
   * 分析一段音符的调性。
   * @param notes [{midi, dur}]  midi 可为浮点
   * @returns {mode:'major'|'minor', rootPC, score, margin, confidence,
   *           doName, keyName, noteCount, totalDur}
   */
  function detectKey(notes) {
    if (!notes || notes.length < 2) return null;

    // 整体音分偏移补偿：业余演唱常整体偏低/偏高（低 15-30 音分）。
    // 用"各音对最近半音偏差的中位数"一次性补偿，而不是暴力搜索每个 shift
    // 找最高分（那样会把准的音推过边界，过拟合到相邻调）。
    var cents = [];
    for (var c0 = 0; c0 < notes.length; c0++) {
      var rm = notes[c0].midi - Math.round(notes[c0].midi);
      cents.push(rm * 100);
    }
    cents.sort(function (a, b) { return a - b; });
    var medianCents = cents[Math.floor(cents.length / 2)];
    if (Math.abs(medianCents) > 50) medianCents = medianCents > 0 ? 50 : -50;
    var shiftCents = -medianCents; // 补偿到中位数归零

    // 1) 时长加权 pitch-class 直方图（软量化，避免跑音被硬切到错误半音）
    var hist = new Array(12).fill(0);
    var total = 0;
    for (var i = 0; i < notes.length; i++) {
      var d = notes[i].dur || 0.25;
      var m = notes[i].midi + shiftCents / 100;
      var nearest = Math.round(m);
      var cent = (m - nearest) * 100; // -50..+50
      var wNear = 1 - Math.abs(cent) / 50; // 0..1
      hist[((nearest % 12) + 12) % 12] += d * wNear;
      hist[((Math.round(m + (cent >= 0 ? 1 : -1)) % 12) + 12) % 12] += d * (1 - wNear);
      total += d;
    }
    if (total <= 0) return null;
    for (var h = 0; h < 12; h++) hist[h] /= total;

    var last = notes[notes.length - 1];
    var lastM = last.midi + shiftCents / 100;

    // 2) 24 候选评分
    var cands = [];
    for (var root = 0; root < 12; root++) {
      var majScore = corr(hist, shiftProfile(MAJOR_PROF, root));
      var minScore = corr(hist, shiftProfile(MINOR_PROF, root));
      majScore += SCALE_BONUS * scaleMembership(hist, root, 'major');
      minScore += SCALE_BONUS * scaleMembership(hist, root, 'minor');
      if (Math.abs(distanceFromTonic(lastM, root)) < 0.7) {
        majScore += TONIC_BONUS;
        minScore += TONIC_BONUS;
      }
      if (GUILD.major.indexOf(root) >= 0) majScore += GUITAR_BIAS;
      if (GUILD.minor.indexOf(root) >= 0) minScore += GUITAR_BIAS;

      cands.push({ mode: 'major', root: root, score: majScore, shift: shiftCents });
      cands.push({ mode: 'minor', root: root, score: minScore, shift: shiftCents });
    }

    // 3) 去重 (mode, root)：同调只保留最高分，避免同名候选污染第二名
    var seen = {};
    for (var ci = 0; ci < cands.length; ci++) {
      var c = cands[ci];
      var key = c.mode + '_' + c.root;
      if (!seen[key] || c.score > seen[key].score) seen[key] = c;
    }
    var ranked = Object.keys(seen).map(function (k) { return seen[k]; })
      .sort(function (a, b) { return b.score - a.score; });
    var best = ranked[0];
    var second = ranked[1] || { mode: 'major', root: (best.root + 7) % 12, score: 0 };

    var margin = best.score - second.score;
    var confidence = Math.max(0, Math.min(1, margin / 0.15));

    // 关系大小调：小调的关系大调 = root+3，大调的关系小调 = root+9。
    // 二者共享相同音阶，纯旋律无法区分。返回供 UI 提示"也可能是 X 调"。
    var relMode = (best.mode === 'minor') ? 'major' : 'minor';
    var relRoot = (best.mode === 'minor') ? (best.root + 3) % 12 : (best.root + 9) % 12;
    var relScore = 0;
    for (var ri = 0; ri < ranked.length; ri++) {
      if (ranked[ri].mode === relMode && ranked[ri].root === relRoot) { relScore = ranked[ri].score; break; }
    }

    // ============================================================
    // 关系大小调裁判（DeepSeek 四级裁判）：检测出的调 与 它的关系调 强制仲裁唯一结果。
    // 关系大小调共享音阶（如 D大调/B小调），K-S 无法区分，必须靠终点/骨架/导音。
    // 无论 best 是大调还是小调，都运行裁判；若裁判选的是关系调，则翻转为关系调。
    // ============================================================
    var judge = null;
    var origDetected = null; // 被裁判覆盖的原始检测结果（保留供 UI/调试）
    if (best.mode === 'minor') {
      // minor 与它的关系大调仲裁
      var relMajRoot = (best.root + 3) % 12;
      judge = judgeRelative(notes, relMajRoot, best.root);
      if (judge.verdict === 'major') {
        origDetected = { mode: 'minor', root: best.root, score: best.score };
        best = { mode: 'major', root: relMajRoot, score: relScore, shift: shiftCents };
      }
    } else {
      // major 与它的关系小调仲裁（如检测到 D大调，需排除"其实是 B小调"）
      var relMinRoot = (best.root + 9) % 12;
      judge = judgeRelative(notes, best.root, relMinRoot);
      if (judge.verdict === 'minor') {
        origDetected = { mode: 'major', root: best.root, score: best.score };
        best = { mode: 'minor', root: relMinRoot, score: relScore, shift: shiftCents };
      }
    }

    // 重新计算关系调（best 可能已被翻转）
    var relMode = (best.mode === 'minor') ? 'major' : 'minor';
    var relRoot = (best.mode === 'minor') ? (best.root + 3) % 12 : (best.root + 9) % 12;
    var relScore = 0;
    for (var ri2 = 0; ri2 < ranked.length; ri2++) {
      if (ranked[ri2].mode === relMode && ranked[ri2].root === relRoot) { relScore = ranked[ri2].score; break; }
    }

    var doName = SPELL[best.root];
    var keyName = (best.mode === 'major' ? doName + '大调' : doName + '小调');

    return {
      mode: best.mode,
      rootPC: best.root,
      score: best.score,
      second: second,
      margin: margin,
      confidence: confidence,
      bestShift: shiftCents,
      doName: doName,
      keyName: keyName,
      relMode: relMode,
      relRoot: relRoot,
      relScore: relScore,
      relKeyName: SPELL[relRoot] + (relMode === 'major' ? '大调' : '小调'),
      judge: judge ? { verdict: judge.verdict, source: judge.source, confidence: judge.confidence, evidence: judge.evidence } : null,
      origDetected: origDetected,
      noteCount: notes.length,
      totalDur: notes.reduce(function (s, n) { return s + (n.dur || 0.25); }, 0)
    };
  }

  global.KeyDetect = {
    detectKey: detectKey,
    SPELL: SPELL,
    pc: pc,
    distanceFromTonic: distanceFromTonic
  };
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
