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

  var GUITAR_BIAS = 0.02;     // 吉他友好调微调（仅在分数接近时起作用）
  var SCALE_BONUS = 0.20;     // 音阶成员加权：旋律落在该调音阶内的比例（强判别）
  var CENTROID_WEIGHT = 0.04; // 重心音：弱证据（对称旋律会落音阶中段，不宜过重）
  var DOMINANT_WEIGHT = 0.04; // 音级分布最长音级：弱证据，按「支配度」缩放
  var ENDING_MAX_MULT = 1.5;  // 结束音最大加权倍率（仅完整终止时触发）
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

  // 两个音级之间的循环半音距离（0..6）
  function circDist(a, b) {
    var d = Math.abs(pc(a) - pc(b)) % 12;
    if (d > 6) d = 12 - d;
    return d;
  }

  // 音名（含八度号，用于证据链输出），如 midiName(59.5) -> "B3"
  function midiName(m) {
    var r = Math.round(m);
    return SPELL[pc(r)] + String(Math.floor(r / 12) - 1);
  }

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
  // 试唱解决感评分（模拟人类"唱 do 找归属感"）
  // 对给定主音 rootPC，评估旋律的"回家感"：
  //   落尾是否落在主音 / 导音(主音-1半音) / 属音 —— 落主音=回家最强
  //   旋律内有没有 7→1 半音解决（导音回家）
  //   主和弦音(主音/三音/五音)占整体时长比例 —— 越稳越像主音
  // 关系大小调对（如 D大调 vs B小调）各自算一次，归属感强的胜出。
  // 返回 0..1 分数
  // ============================================================
  function singResolutionScore(notes, rootPC) {
    var last = pc(Math.round(notes[notes.length - 1].midi));
    var diff = (last - rootPC + 12) % 12;
    var cadence = 0;
    if (diff === 0) cadence = 1.0;          // 落在主音：回家感最强
    else if (diff === 11) cadence = 0.85;   // 导音：强烈想解决到主音
    else if (diff === 7) cadence = 0.5;     // 属音：半终止感
    else if (diff === 4 || diff === 3) cadence = 0.35; // 三音

    // 旋律内 7→1 半音解决次数（导音→主音）
    var lead = 0;
    for (var i = 1; i < notes.length; i++) {
      var p1 = pc(Math.round(notes[i - 1].midi));
      var p2 = pc(Math.round(notes[i].midi));
      if (p1 === (rootPC + 11) % 12 && p2 === rootPC) lead++;
    }

    // 主和弦音（主音/三音/五音）时长占比
    var stab = 0, total = 0;
    for (var j = 0; j < notes.length; j++) {
      var d = (pc(Math.round(notes[j].midi)) - rootPC + 12) % 12;
      if (d === 0 || d === 3 || d === 4 || d === 7) stab += (notes[j].dur || 0.25);
      total += (notes[j].dur || 0.25);
    }
    stab = total > 0 ? stab / total : 0;

    return cadence * 0.5 + Math.min(1, lead * 0.5) * 0.3 + stab * 0.2;
  }

  // ============================================================
  // 关系大小调裁判模块（DeepSeek 四级裁判，强制唯一结果）
  // 当检测到小调时，在它和关系大调之间强制判定唯一主音：
  //   L2 主和弦骨架审判：大调骨架(主音/大三/纯五) vs 小调骨架(主音/小三/纯五)
  //   L3 导音半音解决：小二度上行到主音（小调导音需临时升高半音）
  //   L4 试唱解决感：模拟"唱 do 找归属感"，归属感强的胜出
  // （L1 终点一票否决已移除——结束音不再主导主音判断，改由 detectKey 里的门控弱加权处理）
  // 返回 {verdict:'major'|'minor', pc, evidence, confidence, source}
  // ============================================================
  function judgeRelative(notes, majorPC, minorPC, preferMode) {
    var candA = { pc: majorPC, mode: 'major' };
    var candB = { pc: minorPC, mode: 'minor' };
    var evidence = [];
    // 时值加权直方图
    var hist = new Array(12).fill(0);
    for (var ni = 0; ni < notes.length; ni++) hist[pc(Math.round(notes[ni].midi))] += (notes[ni].dur || 0.25);

    // L1 终点审判已移除：结束音只作记录，不再一票否决
    evidence.push('结束音 ' + SPELL[pc(Math.round(notes[notes.length - 1].midi))] + '（不再主导主音判断）');

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

    // ---- L4 试唱解决感 + K-S 全局评分（综合"归属感"）----
    // 试唱解决感：模拟"唱 do 找归属感"（落尾/导音/主和弦稳定）
    // K-S 相关：整段旋律对候选调的贴合度（已含时长/音级分布）
    // 两者结合，避免单信号误判。
    var fitA = singResolutionScore(notes, candA.pc);
    var fitB = singResolutionScore(notes, candB.pc);
    // K-S 相关（复用现有 hist）
    var ksA = corr(hist, shiftProfile(MAJOR_PROF, candA.pc)) + SCALE_BONUS * scaleMembership(hist, candA.pc, 'major');
    var ksB = corr(hist, shiftProfile(MINOR_PROF, candB.pc)) + SCALE_BONUS * scaleMembership(hist, candB.pc, 'minor');
    // 归一化到相近量级：fit ∈[0,1]，ks ∈[-1,1] → 用 0.6*fit + 0.4*ks
    var totalA = 0.6 * fitA + 0.4 * Math.max(0, ksA);
    var totalB = 0.6 * fitB + 0.4 * Math.max(0, ksB);
    evidence.push('L4试唱: ' + SPELL[candA.pc] + '大=' + fitA.toFixed(2) + ' ' + SPELL[candB.pc] + '小=' + fitB.toFixed(2) + ' | KS ' + SPELL[candA.pc] + '=' + ksA.toFixed(2) + ' ' + SPELL[candB.pc] + '=' + ksB.toFixed(2) + ' | 合计 ' + totalA.toFixed(2) + ' vs ' + totalB.toFixed(2));
    if (totalA > totalB + 0.08) { evidence.push('L4:旋律向' + SPELL[candA.pc] + '归属/贴合强'); return { verdict: 'major', pc: candA.pc, evidence: evidence, confidence: 0.7, source: 'L4' }; }
    if (totalB > totalA + 0.08) { evidence.push('L4:旋律向' + SPELL[candB.pc] + '归属/贴合强'); return { verdict: 'minor', pc: candB.pc, evidence: evidence, confidence: 0.7, source: 'L4' }; }
    // 归属接近（大小调模糊）：保持原始判定的调，不再「默认偏大调」，避免小调被系统性地掰成大调
    if (preferMode === 'minor') { evidence.push('L4:归属接近，保持小调'); return { verdict: 'minor', pc: candB.pc, evidence: evidence, confidence: 0.5, source: 'L4' }; }
    evidence.push('L4:归属接近，保持大调'); return { verdict: 'major', pc: candA.pc, evidence: evidence, confidence: 0.5, source: 'L4' };
  }

  /**
   * 分析一段音符的调性。任意片段的主音判断不再依赖结束音：
   *   - 结束音只做「门控弱加权」（完整终止才×1.5，否则×1.0），不参与一票否决
   *   - 重心音（加权平均音高）与音级分布（时长最长音级）是主音核心证据
   *   - 主音确定后，用主和弦匹配（大三度 vs 小三度）决定大小调
   * @param notes [{midi, dur, start?, end?}]  midi 可为浮点
   * @param opts {recordingDur?:number} 录音总时长(秒)，用于判断结束音后是否有静音
   * @returns {mode, rootPC, score, margin, confidence, centroidNote, dominantPC, endingNote, endingMult, candidateScores, ...}
   */
  function detectKey(notes, opts) {
    opts = opts || {};
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
    // 稳定性优化（研究结论）：
    //   - 时长用 log 压缩：单音权重 = log2(1+dur)，防止一个长尾音主导整个直方图
    //   - 每个音类加平滑伪计数(+0.5)：短句(5音)不会因一个音缺席/多余而翻转
    //   - 相关前做 L2 归一化（corr 已做 Pearson，天然归一，这里主要针对伪计数后）
    // 时长合计 + 结束音信息
    var totalDur = 0;
    for (var d0 = 0; d0 < notes.length; d0++) totalDur += (notes[d0].dur || 0.25);
    var last = notes[notes.length - 1];
    var lastM = last.midi + shiftCents / 100;
    var lastDur = last.dur || 0.25;
    var trailingSilence = (opts.recordingDur != null) ? Math.max(0, opts.recordingDur - (last.end || 0)) : 0;

    // 结束音加权倍率：仅当「非跨次累计 + 结束音>0.5s + 尾静音≥0.3s + 全曲>5s」才×1.5，否则×1.0
    var endingMult = (!opts.noEndingBoost && lastDur > 0.5 && trailingSilence >= 0.3 && totalDur > 5) ? ENDING_MAX_MULT : 1.0;

    // 重心音：加权平均音高（权重=时长）
    var cNum = 0, cDen = 0;
    for (var g = 0; g < notes.length; g++) {
      var gw = notes[g].dur || 0.25;
      cNum += (notes[g].midi + shiftCents / 100) * gw;
      cDen += gw;
    }
    var centroid = cDen > 0 ? cNum / cDen : lastM;
    var centroidPC = pc(Math.round(centroid));
    // 重心音是否落在实际唱过的音级上（对称旋律的重心会落到未唱过的音，不可信）
    var centroidPresent = false;
    for (var cp = 0; cp < notes.length; cp++) if (pc(Math.round(notes[cp].midi + shiftCents / 100)) === centroidPC) { centroidPresent = true; break; }

    // 音级分布：出现总时长最长的音级（主音强候选）
    var pcDur = new Array(12).fill(0);
    for (var pd = 0; pd < notes.length; pd++) {
      pcDur[pc(Math.round(notes[pd].midi + shiftCents / 100))] += (notes[pd].dur || 0.25);
    }
    var dominantPC = 0;
    for (var p1 = 1; p1 < 12; p1++) if (pcDur[p1] > pcDur[dominantPC]) dominantPC = p1;
    // 支配度：最长音级相对次长音级的优势占比（平局→0，明确主导→接近1）
    var secondTop = 0;
    for (var p2 = 0; p2 < 12; p2++) if (p2 !== dominantPC && pcDur[p2] > secondTop) secondTop = pcDur[p2];
    var dominance = pcDur[dominantPC] > 0 ? Math.max(0, (pcDur[dominantPC] - secondTop) / pcDur[dominantPC]) : 0;

    // 时长加权 pitch-class 直方图（软量化 + 平滑 + 结束音门控加权）
    var hist = new Array(12).fill(0);
    var total = 0;
    for (var i = 0; i < notes.length; i++) {
      var d = notes[i].dur || 0.25;
      var w = Math.log2(1 + d); // log 压缩时长，长音不再一票独大
      if (i === notes.length - 1) w *= endingMult; // 结束音仅完整终止时×1.5
      var m = notes[i].midi + shiftCents / 100;
      var nearest = Math.round(m);
      var cent = (m - nearest) * 100; // -50..+50
      var wNear = 1 - Math.abs(cent) / 50; // 0..1
      hist[((nearest % 12) + 12) % 12] += w * wNear;
      hist[((Math.round(m + (cent >= 0 ? 1 : -1)) % 12) + 12) % 12] += w * (1 - wNear);
      total += w;
    }
    for (var pc0 = 0; pc0 < 12; pc0++) hist[pc0] += 0.5;
    total += 12 * 0.5;
    if (total <= 0) return null;
    for (var h = 0; h < 12; h++) hist[h] /= total;

    // 24 候选评分：K-S + 音阶成员 + 重心音 + 音级分布 + 吉他偏好
    var cands = [];
    for (var root = 0; root < 12; root++) {
      var majScore = corr(hist, shiftProfile(MAJOR_PROF, root));
      var minScore = corr(hist, shiftProfile(MINOR_PROF, root));
      majScore += SCALE_BONUS * scaleMembership(hist, root, 'major');
      minScore += SCALE_BONUS * scaleMembership(hist, root, 'minor');
      var cBonus = centroidPresent ? CENTROID_WEIGHT * (1 - circDist(centroidPC, root) / 6) : 0; // 重心音证据（模式无关）
      majScore += cBonus; minScore += cBonus;
      var domBonus = (root === dominantPC) ? DOMINANT_WEIGHT * dominance : 0;           // 音级分布证据
      majScore += domBonus; minScore += domBonus;
      if (GUILD.major.indexOf(root) >= 0) majScore += GUITAR_BIAS;
      if (GUILD.minor.indexOf(root) >= 0) minScore += GUITAR_BIAS;

      cands.push({ mode: 'major', root: root, score: majScore, shift: shiftCents, centroidBonus: cBonus, dominantBonus: domBonus });
      cands.push({ mode: 'minor', root: root, score: minScore, shift: shiftCents, centroidBonus: cBonus, dominantBonus: domBonus });
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
    var confidence = Math.max(0, Math.min(1, margin / 0.18));
    // 重心音与音级分布指向同一主音 → 置信度加成
    if (centroidPC === dominantPC && dominantPC === best.root) confidence = Math.min(1, confidence + 0.12);
    // 短片段/信息不足 → 置信度封顶（中等），避免过度自信
    if (totalDur < 3 || notes.length < 5) confidence = Math.min(confidence, 0.7);

    // 关系大小调：小调的关系大调 = root+3，大调的关系小调 = root+9。
    var relMode = (best.mode === 'minor') ? 'major' : 'minor';
    var relRoot = (best.mode === 'minor') ? (best.root + 3) % 12 : (best.root + 9) % 12;
    var relScore = 0;
    for (var ri = 0; ri < ranked.length; ri++) {
      if (ranked[ri].mode === relMode && ranked[ri].root === relRoot) { relScore = ranked[ri].score; break; }
    }

    // 关系大小调裁判（主和弦骨架/导音/试唱，已移除终点一票否决）
    var judge = null;
    var origDetected = null;
    if (best.mode === 'minor') {
      var relMajRoot = (best.root + 3) % 12;
      judge = judgeRelative(notes, relMajRoot, best.root, best.mode);
      if (judge.verdict === 'major') {
        origDetected = { mode: 'minor', root: best.root, score: best.score };
        best = { mode: 'major', root: relMajRoot, score: relScore, shift: shiftCents };
      }
    } else {
      var relMinRoot = (best.root + 9) % 12;
      judge = judgeRelative(notes, best.root, relMinRoot, best.mode);
      if (judge.verdict === 'minor') {
        origDetected = { mode: 'major', root: best.root, score: best.score };
        best = { mode: 'minor', root: relMinRoot, score: relScore, shift: shiftCents };
      }
    }
    // 关系大小调裁判若「归属接近」（L4 兜底），说明大小调本身模糊 → 置信度封顶，别过度自信
    if (judge && judge.source === 'L4') confidence = Math.min(confidence, 0.6);

    // 重新计算关系调（best 可能已被翻转）
    var relMode = (best.mode === 'minor') ? 'major' : 'minor';
    var relRoot = (best.mode === 'minor') ? (best.root + 3) % 12 : (best.root + 9) % 12;
    var relScore = 0;
    for (var ri2 = 0; ri2 < ranked.length; ri2++) {
      if (ranked[ri2].mode === relMode && ranked[ri2].root === relRoot) { relScore = ranked[ri2].score; break; }
    }

    var doName = SPELL[best.root];
    var keyName = (best.mode === 'major' ? doName + '大调' : doName + '小调');

    // 证据链：重心音 + 音级分布 + 结束音（权重倍率）+ 裁判证据
    var evidence = ['重心音 ' + midiName(centroid) + ' · 时长最长音级 ' + SPELL[dominantPC] + ' · 结束音 ' + midiName(lastM) + '（权重×' + endingMult + '）'];
    if (judge && judge.evidence && judge.evidence.length) evidence = evidence.concat(judge.evidence);

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
      judge: judge ? { verdict: judge.verdict, source: judge.source, confidence: judge.confidence, evidence: evidence } : null,
      origDetected: origDetected,
      centroidNote: midiName(centroid),
      dominantPC: dominantPC,
      dominantNote: SPELL[dominantPC],
      endingNote: midiName(lastM),
      endingMult: endingMult,
      candidateScores: ranked.slice(0, 4).map(function (r) { return { root: r.root, mode: r.mode, score: +r.score.toFixed(3) }; }),
      noteCount: notes.length,
      totalDur: totalDur
    };
  }

  global.KeyDetect = {
    detectKey: detectKey,
    SPELL: SPELL,
    pc: pc,
    distanceFromTonic: distanceFromTonic
  };
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
