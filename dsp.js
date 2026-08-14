/* ============================================================
 * dsp.js — 音高检测（YIN）+ 音符分段 + 音分量化
 *
 * YIN (de Cheveigné & Kawahara, JASA 2002)：
 *   difference function -> CMNDF -> absolute threshold -> parabolic interp
 * 相比朴素自相关(ACF)，CMNDF 消去幅度依赖，对业余演唱的跑音/气息声
 * 更抗八度误判，且阈值本身可作为有声/清音置信度。
 * 分段：基于音高稳定度的自适应分段，配置信度门控。
 * 全程纯函数、无依赖，Node / 浏览器共用。
 * ============================================================ */
(function (global) {
  'use strict';

  var YIN_THRESHOLD = 0.20;     // 论文建议 0.1（对乐器）；人声放宽到 0.2
  var MIN_LAG = 40;             // ~1100Hz 上限（44.1k 下）
  var MAX_LAG = 882;            // ~50Hz 下限（男低音 E2）
  var SAMPLE_RATE = 44100;

  /* ---------- YIN 帧级检测 ---------- */
  // 输入: Float32Array 一段 2048 样本；输出 {freq, pitch (midi float), confidence 0..1} 或 null
  function yinPitchFrame(buf, sampleRate) {
    var n = buf.length;
    if (n < 64) return null;

    var cmndf = new Float32Array(n);
    var i, tau;

    // 差分函数 d(tau) = sum(x[i] - x[i+tau])^2
    var d = new Float32Array(n);
    for (tau = 1; tau < n; tau++) {
      var s = 0;
      for (i = 0; i < n - tau; i++) {
        var diff = buf[i] - buf[i + tau];
        s += diff * diff;
      }
      d[tau] = s;
    }
    // CMNDF d'(tau) = d(tau) / ((1/tau) * sum_{j<=tau} d(j))，幅度无关
    var running = 0;
    cmndf[0] = 1;
    for (tau = 1; tau < n; tau++) {
      running += d[tau];
      if (running === 0) { cmndf[tau] = 1; }
      else { cmndf[tau] = d[tau] * tau / running; }
    }

    // 在 [MIN_LAG, MAX_LAG] 内找第一个低于阈值、且为局部谷的 dip（真周期），
    // 而非阈值下方任意点；找不到则退化为全范围 argmin
    var bestTau = -1;
    var bestVal = Infinity;
    var lo = Math.min(MAX_LAG, n - 1);
    var i = MIN_LAG;
    while (i < lo) {
      if (cmndf[i] < YIN_THRESHOLD) {
        var dip = i;
        while (i + 1 < lo && cmndf[i + 1] < cmndf[dip]) { i += 1; dip = i; }
        if (dip + 1 < n && cmndf[dip] <= cmndf[dip + 1]) {
          bestTau = dip; bestVal = cmndf[dip];
          break;
        }
      }
      i += 1;
    }
    if (bestTau < 0) {
      for (var tt = MIN_LAG; tt < lo; tt++) {
        if (cmndf[tt] < bestVal) { bestVal = cmndf[tt]; bestTau = tt; }
      }
      if (bestVal > 0.5) return null; // 无周期结构，视为非音符帧
    }

    // 抛物线插值得到亚样本滞后
    var lag = bestTau;
    if (bestTau > 0 && bestTau < n - 1) {
      var s0 = cmndf[bestTau - 1], s1 = cmndf[bestTau], s2 = cmndf[bestTau + 1];
      var denom = (s0 - 2 * s1 + s2);
      if (Math.abs(denom) > 1e-12) {
        lag = bestTau + (s0 - s2) / (2 * denom);
      }
    }
    var freq = sampleRate / lag;
    var pitch = freqToMidi(freq);
    // 置信度：dip 越深越可信
    var conf = Math.max(0, Math.min(1, 1 - bestVal / 0.5));
    return { freq: freq, pitch: pitch, confidence: conf };
  }

  function freqToMidi(f) {
    if (f <= 0) return 0;
    return 69 + 12 * Math.log2(f / 440);
  }

  /* ---------- 音符分段（滞回状态机，稳定边界） ----------
   * 研究结论：单阈值切分在业余演唱（振动±30-50音分、边界抖动）下会误切，
   * 导致"同一段旋律每次边界不同 → 调翻转"。滞回（hysteresis）解决：
   *   - 离开当前音符需偏离 > leaveCents(0.7) 且持续 leaveMs(80ms) —— 大阈值防振动误切
   *   - 只要仍在 enterCents(0.4) 内即视为同一音符 —— 小阈值容忍微抖
   * 连续低置信（无声/气声）持续 unvoicedMs 视为乐句停顿，结束当前音符。
   */
  function segmentNotes(frames, opts) {
    opts = opts || {};
    var minConf = opts.minConf !== undefined ? opts.minConf : 0.55;
    var maxNoteDur = opts.maxNoteDur || 2.5;
    var mergeSlop = opts.mergeSlop || 0.5;
    var minLen = opts.minLen || 0.12;
    var leaveCents = opts.leaveCents || 0.7;   // 离开阈值（半音）
    var enterCents = opts.enterCents || 0.4;   // 保持阈值（半音）
    var leaveMs = opts.leaveMs || 80;          // 离开需持续(ms)
    var unvoicedMs = opts.unvoicedMs || 120;   // 无声持续(ms)视为停顿
    var refWindow = opts.refWindow || 7;       // 当前音符参考音高中值窗

    if (!frames || frames.length < 4) return [];

    // 1) 门控：保留可信帧（YIN 置信度）
    var valid = frames.filter(function (f) { return f.conf >= minConf; });
    if (valid.length < 4) return [];

    // 2) 中值滤波(窗口5)：平滑帧间微抖
    var pitches = valid.map(function (f) { return f.pitch; });
    var med = medFilter(pitches, 5);

    // 3) 滞回状态机切分
    // 核心：参考音高 refP 在音符建立时锁定（取该段前几帧中值），音符内不滑动更新，
    // 否则新音符刚开始几帧 refP 就追上它，偏离检测被重置，永远切不出边界。
    var segments = [];      // [{start,end,frames:[...]}]
    var cur = null;         // {start,end,frames,refP}
    var leaveSince = null;  // 最近一次连续离开的开始(帧序号)
    var unvoicedSince = null;

    for (var i = 0; i < valid.length; i++) {
      var t = valid[i].t;
      var m = med[i];
      var voiced = valid[i].conf >= 0.5;

      if (!voiced) {
        if (unvoicedSince === null) unvoicedSince = i;
        if (cur && (t - valid[unvoicedSince].t) >= unvoicedMs / 1000) {
          closeSeg(cur);
          cur = null;
          leaveSince = null;
        }
        continue;
      }
      unvoicedSince = null;

      if (!cur) {
        // 建音符：refP 用前 5 帧中值锁定（首帧可能抖）
        var seed = med.slice(i, i + 5).slice().sort(function (a, b) { return a - b; });
        cur = { start: t, end: t, frames: [m], refP: seed[Math.floor(seed.length / 2)] };
        leaveSince = null;
        continue;
      }

      var dev = Math.abs(m - cur.refP); // refP 锁定，不再滑动

      if (dev > leaveCents) {
        // 离开候选：记录首次离开时间；持续满 leaveMs 才真切断
        if (leaveSince === null) leaveSince = i;
        cur.frames.push(m); cur.end = t;
        if ((t - valid[leaveSince].t) >= leaveMs / 1000) {
          closeSeg(cur);
          // 新段从离开候选处起，refP 用新段前 5 帧中值
          var seed2 = med.slice(leaveSince, leaveSince + 5).slice().sort(function (a, b) { return a - b; });
          cur = { start: valid[leaveSince].t, end: t, frames: [m], refP: seed2[Math.floor(seed2.length / 2)] };
          leaveSince = null;
        }
      } else if (dev > enterCents) {
        // 滞回区：不切断、不重置离开候选（保持现状）
        cur.frames.push(m); cur.end = t;
      } else {
        // 回到音符内：清空离开候选（之前的偏离是振动）
        leaveSince = null;
        cur.frames.push(m); cur.end = t;
      }
    }
    if (cur) closeSeg(cur);

    function closeSeg(seg) {
      if (seg.frames.length >= 2) {
        var sp = seg.frames.slice().sort(function (a, b) { return a - b; });
        var mid = sp[Math.floor(sp.length / 2)];
        segments.push({ start: seg.start, end: seg.end, midi: mid, frames: seg.frames });
      }
    }

    // 4) 组段 → 音符（取段内中值音高，时长=首尾帧时间差）
    var notes = [];
    for (var k = 0; k < segments.length; k++) {
      var seg = segments[k];
      var dur = seg.end - seg.start;
      if (dur < minLen) continue;
      notes.push({ start: seg.start, end: seg.end, midi: seg.midi, freq: midiToFreq(seg.midi), dur: dur, conf: 0.9 });
    }

    // 5) 合并极短时相邻同音（装饰音/气息分裂）
    var merged = [];
    for (var m2 = 0; m2 < notes.length; m2++) {
      var cur2 = notes[m2];
      if (merged.length > 0) {
        var prev = merged[merged.length - 1];
        var gap = cur2.start - prev.end;
        if (gap < mergeSlop && Math.abs(cur2.midi - prev.midi) < 0.5) {
          prev.end = cur2.end;
          prev.dur = prev.end - prev.start;
          prev.midi = prev.dur > cur2.dur ? prev.midi : cur2.midi;
          prev.conf = Math.max(prev.conf, cur2.conf);
          continue;
        }
      }
      merged.push({
        start: cur2.start, end: cur2.end,
        midi: cur2.midi, freq: midiToFreq(cur2.midi),
        dur: cur2.dur, conf: cur2.conf
      });
    }

    // 6) 限制单音符过长（整段一个长音属异常）
    var capped = [];
    for (var c = 0; c < merged.length; c++) {
      var nn = merged[c];
      if (nn.dur > maxNoteDur) {
        capped.push({ start: nn.start, end: nn.start + maxNoteDur, midi: nn.midi, freq: nn.freq, dur: maxNoteDur, conf: nn.conf });
        var rest = nn.dur - maxNoteDur;
        if (rest > minLen) {
          capped.push({ start: nn.start + maxNoteDur, end: nn.end, midi: nn.midi, freq: nn.freq, dur: rest, conf: nn.conf });
        }
      } else {
        capped.push(nn);
      }
    }
    return capped;
  }

  function medFilter(vals, w) {
    var out = [];
    var h = Math.floor(w / 2);
    for (var i = 0; i < vals.length; i++) {
      var lo = Math.max(0, i - h), hi = Math.min(vals.length, i + h + 1);
      var win = vals.slice(lo, hi).sort(function (a, b) { return a - b; });
      out.push(win[Math.floor(win.length / 2)]);
    }
    return out;
  }

  function segAvg(seg) {
    var s = 0;
    for (var i = 0; i < seg.length; i++) s += seg[i].conf;
    return s / seg.length;
  }

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  /* ---------- 音分量化 ---------- */
  // 把浮点 midi 规整到最接近的半音，并返回与半音的偏差(cent)
  function quantizeMidi(m) {
    var r = Math.round(m);
    return { midi: r, cent: Math.round((m - r) * 100) };
  }

  /* ---------- 八度误差修正 ----------
   * YIN 偶尔会把某个音判高/低一个八度（孤立 ±12 半音跳变）。
   * 真实声乐旋律极少出现「上跳八度又立刻跳回」的孤立尖峰，因此：
   * 当某音比前一音偏离约 ±12 半音、且下一音又回到前一音附近时，
   * 判定为八度误判，把它拉回邻音所在八度。只修孤立尖峰，不碰正常旋律。
   */
  function fixOctaveErrors(notes) {
    if (!notes || notes.length < 3) return notes;
    var out = notes.slice();
    for (var i = 1; i < out.length - 1; i++) {
      var prev = Math.round(out[i - 1].midi);
      var cur = Math.round(out[i].midi);
      var next = Math.round(out[i + 1].midi);
      var dPrev = cur - prev;
      var dNext = next - cur;
      if (Math.abs(Math.abs(dPrev) - 12) <= 1 && Math.abs(dPrev + dNext) <= 2) {
        out[i] = { start: out[i].start, end: out[i].end, midi: cur - (dPrev > 0 ? 12 : -12), freq: midiToFreq(cur - (dPrev > 0 ? 12 : -12)), dur: out[i].dur, conf: out[i].conf };
      }
    }
    return out;
  }

  global.DSP = {
    YIN_THRESHOLD: YIN_THRESHOLD,
    yinPitchFrame: yinPitchFrame,
    freqToMidi: freqToMidi,
    midiToFreq: midiToFreq,
    segmentNotes: segmentNotes,
    quantizeMidi: quantizeMidi,
    fixOctaveErrors: fixOctaveErrors,
    MIN_LAG: MIN_LAG,
    MAX_LAG: MAX_LAG
  };
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
