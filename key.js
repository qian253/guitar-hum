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
  // v2.17.1（13 首真实哼唱标注分析，analyze_next.js）：
  //   重心音/Chew 螺旋在短哼唱上只会加噪（单独命中率 9%/10%，关掉后真实数据 4/13→5/13，
  //   合成基准 168 条主音仍 100% 零回归），故权重归零保留代码留作证据链展示。
  var CENTROID_WEIGHT = 0;    // 重心音：对称旋律会落音阶中段，不可信（已停用）
  var STABILITY_WEIGHT = 0.10; // 音级稳定性 K-S（v2.15）：稳定性点积比「出现最久音级」更能抓主音
  var CHEW_WEIGHT = 0;        // Chew 螺旋数组（v2.16）：全曲级特征，短哼唱加噪（已停用）
  var ENDING_MAX_MULT = 1.5;  // 结束音最大加权倍率（仅完整终止时触发）
  var ENDING_BONUS = 0.15;   // 结尾长音=主音（v2.17）：真实标注实测结束音单独命中 3/13，高于其余单模块；0.15 为合成基准安全上限（0.25 会破坏「非主音结尾」旋律）
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

  // ============ Elaine Chew 螺旋数组（Spiral Array，简化版，v2.16） ============
  // 参考：Chew, "Towards a Mathematical Model of Tonality"；partitura 实现公式：
  //   音级沿五度圈排布，位置 P(k) = (r·sin(t), r·cos(t), A·t)，t = k·π/2，A = √(2/15)·π/2
  //   k 为五度圈索引（C=0, G=1, D=2, A=3, E=4, B=5, F=-1, Bb=-2, Eb=-3, Ab=-4, Db=-5, Gb=-6）
  // 中心效应点 CE = 各音符位置（按时长×振幅加权）的平均；距 CE 最近的音级即主音候选。
  var SPIRAL_A = Math.sqrt(2 / 15) * Math.PI / 2;
  function pcFifths(pc) { return (((7 * pc + 6) % 12) + 12) % 12 - 6; } // 音级 → 五度圈索引 [-6..5]
  function pcFromFifths(k) { return (((7 * k) % 12) + 12) % 12; }
  function chewPos(k) {
    var t = k * Math.PI / 2;
    return { x: Math.sin(t), y: Math.cos(t), z: SPIRAL_A * t };
  }
  function dist3(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  // 螺旋数组主音分析：返回 {ce, nearestPC, distances, keys:[{root,mode,d}], tonic, confidence}
  function chewAnalyze(notes) {
    if (!notes || notes.length < 1) return null;
    // 拼写消歧（Chew "Mapping MIDI to the Spiral Array"）：每个音级有 k / k±12 三个等价位置，
    // 每轮选择离当前 CE 最近的拼写，迭代 3 次收敛——避免等音拼写把 CE 拉偏到错误音级。
    var reps = {}; // pc → 拼写后的五度圈索引
    var cx = 0, cy = 0, cz = 0, wsum = 0;
    function noteW(n) {
      var w = n.dur || 0.25;
      var amp = n.amp || n.amplitude;
      if (amp && amp > 0) w *= 0.5 + amp;
      return w;
    }
    for (var i0 = 0; i0 < notes.length; i0++) wsum += noteW(notes[i0]);
    if (wsum <= 0) return null;
    for (var rr = 0; rr < 3; rr++) {
      var cex = wsum > 0 ? cx / wsum : 0, cey = cy / wsum, cez = cz / wsum;
      cx = 0; cy = 0; cz = 0;
      for (var i2 = 0; i2 < notes.length; i2++) {
        var pc2 = pc(Math.round(notes[i2].midi));
        var k0 = reps[pc2] != null ? reps[pc2] : pcFifths(pc2);
        var bestK = k0, bestD = Infinity;
        for (var kv = k0 - 12; kv <= k0 + 12; kv += 12) {
          var pv = chewPos(kv);
          var dv = (pv.x - cex) * (pv.x - cex) + (pv.y - cey) * (pv.y - cey) + (pv.z - cez) * (pv.z - cez);
          if (dv < bestD) { bestD = dv; bestK = kv; }
        }
        reps[pc2] = bestK;
        var w2 = noteW(notes[i2]);
        var pp2 = chewPos(bestK);
        cx += pp2.x * w2; cy += pp2.y * w2; cz += pp2.z * w2;
      }
    }
    var ce = { x: cx / wsum, y: cy / wsum, z: cz / wsum };
    // 最近音级 = 主音候选（比较各音级在拼写后的位置）
    var distances = [];
    var nearestK = 0, nearestD = Infinity;
    for (var pcx = 0; pcx < 12; pcx++) {
      var kk = reps[pcx] != null ? reps[pcx] : pcFifths(pcx);
      var d = dist3(ce, chewPos(kk));
      distances.push({ k: kk, pc: pcx, d: d });
      if (d < nearestD) { nearestD = d; nearestK = kk; }
    }
    distances.sort(function (a, b) { return a.d - b.d; });
    // 最近大小调中心：CE_key(k) = mean(P(k), P(k+1), P(k+4)) 大调 / (k, k+1, k+3) 小调
    var keys = [];
    for (var kr = -6; kr <= 5; kr++) {
      var maj = { x: 0, y: 0, z: 0 }, min = { x: 0, y: 0, z: 0 };
      [[kr, kr + 1, kr + 4], [kr, kr + 1, kr + 3]].forEach(function (tri, mi) {
        var tgt = mi === 0 ? maj : min;
        for (var ti = 0; ti < 3; ti++) {
          var pp = chewPos(tri[ti]);
          tgt.x += pp.x / 3; tgt.y += pp.y / 3; tgt.z += pp.z / 3;
        }
      });
      keys.push({ root: pcFromFifths(kr), mode: 'major', d: dist3(ce, maj) });
      keys.push({ root: pcFromFifths(kr), mode: 'minor', d: dist3(ce, min) });
    }
    keys.sort(function (a, b) { return a.d - b.d; });
    var secondD = distances.length > 1 ? distances[1].d : nearestD;
    var confidence = Math.max(0, Math.min(1, 1 - nearestD / (secondD || 1))); // 距离比 → 置信度
    return {
      ce: ce,
      tonic: { rootPC: pcFromFifths(nearestK), mode: keys[0].mode },
      confidence: +confidence.toFixed(3),
      nearestPC: pcFromFifths(nearestK),
      distances: distances.slice(0, 3).map(function (d) { return { pc: d.pc, d: +d.d.toFixed(3) }; }),
      keys: keys.slice(0, 3).map(function (d) { return { root: d.root, mode: d.mode, d: +d.d.toFixed(3) }; })
    };
  }

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

  // 调式判定：主音已锁定（rootPC），只在「同主音大小调」之间二选一，不再跨到关系大小调
  // 三度能量(音分感知版 v2.33):人声的 mi/降mi 常有 ±40~80 音分偏移,
  // 四舍五入进直方图会把「略低的大三度」全丢进小三度(12 条真实人声实测 3 例大调被判小调的真凶)。
  // 按每音与目标三度的音分距离软计数:≤75 音分计入,权重 1-|cents|/75。
  function thirdEnergyCents(notes, rootPC, isMajor) {
    var thirdPC = isMajor ? (rootPC + 4) % 12 : (rootPC + 3) % 12;
    var e = 0;
    for (var i = 0; i < notes.length; i++) {
      var m = notes[i].midi;
      var r = Math.round(m);
      var d = ((((r % 12) + 12) - thirdPC) % 12 + 12) % 12;
      if (d > 6) d -= 12;
      var cents = d * 100 + (m - r) * 100;
      if (Math.abs(cents) < 75) e += Math.max(0.05, notes[i].dur || 0.25) * (1 - Math.abs(cents) / 75);
    }
    return e;
  }

  function decideMode(notes, rootPC, hist) {
    // 三度证据用音分感知能量(v2.33 同步后端);三和弦/导音仍用直方图
    var totalW = 0;
    for (var i = 0; i < notes.length; i++) totalW += Math.max(0.05, notes[i].dur || 0.25);
    var majorThird = totalW > 0 ? thirdEnergyCents(notes, rootPC, true) / totalW : hist[(rootPC + 4) % 12];   // 大三度（如 A→C#）
    var minorThird = totalW > 0 ? thirdEnergyCents(notes, rootPC, false) / totalW : hist[(rootPC + 3) % 12];   // 小三度（如 A→C）
    var majorTriad = hist[rootPC] + hist[(rootPC + 4) % 12] + hist[(rootPC + 7) % 12];
    var minorTriad = hist[rootPC] + hist[(rootPC + 3) % 12] + hist[(rootPC + 7) % 12];
    var leading = 0; // 导音半音解决（主音-1 → 主音）
    for (var i = 1; i < notes.length; i++) {
      var p1 = pc(Math.round(notes[i - 1].midi));
      var p2 = pc(Math.round(notes[i].midi));
      if (p1 === (rootPC + 11) % 12 && p2 === rootPC) leading++;
    }
    // 大调证据：大三度 + 大三和弦优势 + 导音；小调证据：小三度 + 小三和弦优势
    var majorE = majorThird * 2 + (majorTriad - minorTriad) * 0.4 + leading * 0.4;
    var minorE = minorThird * 2 + (minorTriad - majorTriad) * 0.4;
    // 保守：小调必须「明显」占优才判小调（经过音小三度/导音不能一票否决大调）；否则按流行歌先验判大调
    var mode = (minorE > majorE * 1.25) ? 'minor' : 'major';
    return { mode: mode, majorThird: majorThird, minorThird: minorThird, majorTriad: majorTriad, minorTriad: minorTriad, leading: leading, majorE: majorE, minorE: minorE };
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
    var endingPC = pc(Math.round(lastM));
    // 起始长音(镜像结束音 v2.33 同步后端):人唱歌常以主音起调,起始长音是主音的强信号
    var firstDur = Math.max(0.05, (notes[0].dur || 0.25));
    var firstPC = pc(Math.round(notes[0].midi + shiftCents / 100));

    // 重心音：加权平均音高（权重 = 时长 × 振幅/节拍强度）。
    // basic-pitch 音符带 amplitude（强拍更响），用「相对响度」放大强拍音符的重心权重；
    // 振幅先按均值归一化并夹到 [0.3, 2]，权重 = 时长 × norm，避免绝对音量尺度与单个极响音主导。
    // 快速模式（YIN）无振幅 → 退化为纯时长权重；混入的无振幅音符按中性权重处理。
    var hasAmp = false, ampSum = 0, ampCount = 0;
    for (var a0 = 0; a0 < notes.length; a0++) {
      var av = (notes[a0].amp != null ? notes[a0].amp : notes[a0].amplitude) || 0;
      if (av > 0) { hasAmp = true; ampSum += av; ampCount++; }
    }
    var ampMean = hasAmp ? ampSum / ampCount : 0;
    function ampWeight(n) {
      var d = n.dur || 0.25;
      if (!hasAmp || !ampMean) return d;
      var a = (n.amp != null ? n.amp : n.amplitude) || 0;
      if (a <= 0) return d;
      return d * Math.max(0.3, Math.min(2, a / ampMean));
    }
    var cNum = 0, cDen = 0;
    for (var g = 0; g < notes.length; g++) {
      var gw = ampWeight(notes[g]);
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

    // ============ 音级分布模块 v2.15：基于音级稳定性权重的 K-S ============
    // K-S 探测音谱本质是「音级稳定性权重」（主音最稳、导音最不稳）。
    // 用「点积」而非 Pearson 相关：直方图质量直接加权稳定性，短旋律更稳健
    // （Pearson 会把稀有的离调音也放大权重，主音反而被拉偏）。
    // 输出：24 候选调的稳定性分 + 模块自身的主音判断 stabBestRoot。
    var stabTable = [];
    var stabMin = Infinity, stabMax = -Infinity;
    for (var sroot = 0; sroot < 12; sroot++) {
      var smaj = 0, smin = 0;
      var pm = shiftProfile(MAJOR_PROF, sroot);
      var pn = shiftProfile(MINOR_PROF, sroot);
      for (var si = 0; si < 12; si++) { smaj += hist[si] * pm[si]; smin += hist[si] * pn[si]; }
      stabTable.push({ root: sroot, major: smaj, minor: smin, best: Math.max(smaj, smin), bestMode: (smaj >= smin ? 'major' : 'minor') });
      if (smaj < stabMin) stabMin = smaj;
      if (smin < stabMin) stabMin = smin;
      if (smaj > stabMax) stabMax = smaj;
      if (smin > stabMax) stabMax = smin;
    }
    var stabSpan = (stabMax - stabMin) || 1;
    var stabBestRoot = 0;
    for (var sr2 = 1; sr2 < 12; sr2++) {
      if (stabTable[sr2].best > stabTable[stabBestRoot].best) stabBestRoot = sr2;
    }

    // ============ Chew 螺旋数组（v2.16）：中心效应点距各音级距离 → 主音候选 ============
    var chew = chewAnalyze(notes);
    var chewDists = {};
    var chewMaxD = 0;
    if (chew) {
      for (var ck = 0; ck < 12; ck++) {
        chewDists[ck] = dist3(chew.ce, chewPos(pcFifths(ck)));
        if (chewDists[ck] > chewMaxD) chewMaxD = chewDists[ck];
      }
      if (chewMaxD <= 0) chewMaxD = 1;
    }

    // ============ 第一步：锁定主音（与调式解耦） ============
    // 对每个根音取「大调/小调中较高分」作为主音得分（K-S + 音阶成员 + 重心 + 音级分布 + 吉他偏好）
    var tonicScores = new Array(12).fill(0);
    var tonicDetails = [];
    for (var root = 0; root < 12; root++) {
      var majScore = corr(hist, shiftProfile(MAJOR_PROF, root)) + SCALE_BONUS * scaleMembership(hist, root, 'major');
      var minScore = corr(hist, shiftProfile(MINOR_PROF, root)) + SCALE_BONUS * scaleMembership(hist, root, 'minor');
      var cBonus = centroidPresent ? CENTROID_WEIGHT * (1 - circDist(centroidPC, root) / 6) : 0;
      var stabBonus = STABILITY_WEIGHT * ((stabTable[root].best - stabMin) / stabSpan); // 音级稳定性（v2.15，替代旧「最长音级」加成）
      var chewBonus = chew ? CHEW_WEIGHT * (1 - chewDists[root] / chewMaxD) : 0; // 螺旋数组（v2.16）
      var eBonus = (endingPC === root && lastDur >= 0.5) ? ENDING_BONUS : 0; // 结尾长音=主音（v2.17，真实数据最强单信号）
      var oBonus = 0; // 起始长音=主音（v2.33 同步后端：分级 0.20/0.15/0.05）
      if (firstPC === root) oBonus = firstDur >= 0.8 ? 0.20 : (firstDur >= 0.5 ? 0.15 : 0.05);
      var guitarBonus = (GUILD.major.indexOf(root) >= 0 || GUILD.minor.indexOf(root) >= 0) ? GUITAR_BIAS : 0;
      var tScore = Math.max(majScore, minScore) + cBonus + stabBonus + chewBonus + eBonus + oBonus + guitarBonus;
      tonicScores[root] = tScore;
      tonicDetails.push({ root: root, major: majScore, minor: minScore, tonic: tScore });
    }
    var bestRoot = 0, secondRoot = (tonicScores[1] >= tonicScores[0] ? 0 : 1);
    for (var tr = 0; tr < 12; tr++) {
      if (tonicScores[tr] > tonicScores[bestRoot]) { secondRoot = bestRoot; bestRoot = tr; }
      else if (tr !== bestRoot && tonicScores[tr] > tonicScores[secondRoot]) secondRoot = tr;
    }
    var margin = tonicScores[bestRoot] - tonicScores[secondRoot];
    var confidence = Math.max(0, Math.min(1, margin / 0.18));
    if (centroidPC === dominantPC && dominantPC === bestRoot) confidence = Math.min(1, confidence + 0.12);
    if (totalDur < 3 || notes.length < 5) confidence = Math.min(confidence, 0.7);

    // ============ 第二步：主音锁定后，只在同主音大小调之间二选一 ============
    var md = decideMode(notes, bestRoot, hist);
    var mode = md.mode;
    // 调式证据接近时（大小调难分）→ 置信度封顶，别过度自信
    if (Math.abs(md.majorE - md.minorE) < 0.06) confidence = Math.min(confidence, 0.6);

    var doName = SPELL[bestRoot];
    var keyName = mode === 'major' ? doName + '大调' : doName + '小调';
    var relMode = mode === 'minor' ? 'major' : 'minor';
    var relRoot = mode === 'minor' ? (bestRoot + 3) % 12 : (bestRoot + 9) % 12;
    var relKeyName = SPELL[relRoot] + (relMode === 'major' ? '大调' : '小调');
    // 前两名候选调：第一名=检测结果；第二名=关系大小调（同音阶最易混，别硬给一个答案）。
    // 用置信度做百分比拆分（confidence 越高，备选占比越低）。
    var topPct = Math.round(confidence * 100);
    var top2 = [
      { root: bestRoot, mode: mode, keyName: keyName, pct: topPct },
      { root: relRoot, mode: relMode, keyName: relKeyName, pct: 100 - topPct }
    ];

    // 证据链：主音证据 + 调式证据（大三度/小三度、三和弦、导音），逻辑自洽
    var evidence = [
      '重心音 ' + midiName(centroid) + ' · 时长最长音级 ' + SPELL[dominantPC] + ' · 结束音 ' + midiName(lastM) + '（权重×' + endingMult + '）',
      '主音 ' + SPELL[bestRoot] + '：大三度 ' + SPELL[(bestRoot + 4) % 12] + '=' + md.majorThird.toFixed(2) + ' vs 小三度 ' + SPELL[(bestRoot + 3) % 12] + '=' + md.minorThird.toFixed(2) +
        ' · 大三和弦=' + md.majorTriad.toFixed(2) + ' vs 小三和弦=' + md.minorTriad.toFixed(2) + ' · 导音 ' + md.leading + ' 次 → ' + (mode === 'major' ? '大调' : '小调')
    ];

    // 音级稳定性输出（v2.15）：相对最终主音的 12 个音级稳定性得分（直方图质量 × K-S 稳定性权重，归一化到合计 100）
    var stabilityByDegree = new Array(12).fill(0);
    {
      var sProf = shiftProfile(mode === 'major' ? MAJOR_PROF : MINOR_PROF, bestRoot);
      var degSum = 0;
      for (var sd0 = 0; sd0 < 12; sd0++) { var scv = hist[sd0] * sProf[sd0]; stabilityByDegree[sd0] = scv; degSum += scv; }
      for (var sd1 = 0; sd1 < 12; sd1++) stabilityByDegree[sd1] = degSum > 0 ? +((stabilityByDegree[sd1] / degSum) * 100).toFixed(1) : 0;
    }
    evidence.push('音级稳定性（模块主音判断 ' + SPELL[stabBestRoot] + (stabTable[stabBestRoot].bestMode === 'major' ? '大' : '小') + '）：' +
      stabilityByDegree.map(function (v, idx) { return SPELL[(bestRoot + idx) % 12] + ' ' + v; }).join(' / '));
    if (chew) {
      evidence.push('Chew螺旋：中心效应点最近音级 ' + SPELL[chew.tonic.rootPC] + '（置信度 ' + chew.confidence + '）' +
        ' · 最近调中心 ' + SPELL[chew.keys[0].root] + (chew.keys[0].mode === 'major' ? '大' : '小'));
    }

    return {
      mode: mode,
      rootPC: bestRoot,
      score: tonicScores[bestRoot],
      second: { mode: (tonicDetails[bestRoot].major >= tonicDetails[bestRoot].minor ? 'minor' : 'major'), root: bestRoot, score: Math.min(tonicDetails[bestRoot].major, tonicDetails[bestRoot].minor) },
      margin: margin,
      confidence: confidence,
      bestShift: shiftCents,
      doName: doName,
      keyName: keyName,
      relMode: relMode,
      relRoot: relRoot,
      relScore: 0,
      relKeyName: relKeyName,
      judge: { verdict: mode, source: 'decideMode', confidence: confidence, evidence: evidence },
      origDetected: null,
      centroidNote: midiName(centroid),
      dominantPC: dominantPC,
      dominantNote: SPELL[dominantPC],
      endingNote: midiName(lastM),
      endingMult: endingMult,
      candidateScores: tonicDetails.slice().sort(function (a, b) { return b.tonic - a.tonic; }).slice(0, 4).map(function (t) { return { root: t.root, mode: (t.major >= t.minor ? 'major' : 'minor'), score: +t.tonic.toFixed(3) }; }),
      modeEvidence: { majorThird: md.majorThird, minorThird: md.minorThird, majorTriad: md.majorTriad, minorTriad: md.minorTriad, leading: md.leading },
      stability: { scores: stabilityByDegree, tonic: { rootPC: stabBestRoot, mode: stabTable[stabBestRoot].bestMode }, weight: STABILITY_WEIGHT },
      chew: chew,
      top2: top2,
      ampWeighted: hasAmp,
      noteCount: notes.length,
      totalDur: totalDur
    };
  }

  global.KeyDetect = {
    detectKey: detectKey,
    SPELL: SPELL,
    pc: pc,
    distanceFromTonic: distanceFromTonic,
    chewAnalyze: chewAnalyze
  };
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
