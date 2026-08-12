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

  /* ---------- 音符分段（中值滤波 + 跳变切分） ---------- */
  // frames: [{t, pitch (midi float), conf}] 已按时间排序
  // 输出: [{start, end, midi, freq, dur, conf}]  (midi 为浮点中值)
  function segmentNotes(frames, opts) {
    opts = opts || {};
    var minConf = opts.minConf !== undefined ? opts.minConf : 0.7;
    var maxNoteDur = opts.maxNoteDur || 2.5;   // 单音符最长(秒)
    var mergeSlop = opts.mergeSlop || 0.5;     // 粘连/装饰音容忍(秒)
    var minLen = opts.minLen || 0.12;          // 最短音符(秒)
    var cutCents = opts.cutCents || 0.6;       // 切分跳变阈值(半音)

    if (!frames || frames.length < 4) return [];

    // 1) 门控：保留可信帧
    var valid = frames.filter(function (f) { return f.conf >= minConf; });
    if (valid.length < 4) return [];

    // 2) 中值滤波(窗口5)：平滑帧间微抖，保留真实音阶跳变
    var pitches = valid.map(function (f) { return f.pitch; });
    var med = medFilter(pitches, 5);

    // 3) 切分：相邻滤波后音高差 > cutCents 即断开
    var cuts = [0];
    for (var i = 1; i < valid.length; i++) {
      if (Math.abs(med[i] - med[i - 1]) > cutCents) cuts.push(i);
    }
    if (cuts[cuts.length - 1] !== valid.length - 1) cuts.push(valid.length - 1);

    // 4) 组段 => 音符（取中值音高，时长 = 首尾帧时间差）
    var notes = [];
    for (var k = 0; k < cuts.length - 1; k++) {
      var a = cuts[k], b = cuts[k + 1];
      var seg = valid.slice(a, b + 1);
      if (seg.length < 2) continue;
      var t0 = seg[0].t, t1 = seg[seg.length - 1].t;
      var dur = t1 - t0;
      if (dur < minLen) continue;
      var segP = seg.map(function (f) { return f.pitch; }).sort(function (x, y) { return x - y; });
      var m = segP[Math.floor(segP.length / 2)];
      notes.push({ start: t0, end: t1, midi: m, freq: midiToFreq(m), dur: dur, conf: segAvg(seg) });
    }

    // 5) 合并极短时相邻同音（装饰音/气息分裂）
    var merged = [];
    for (var m2 = 0; m2 < notes.length; m2++) {
      var cur = notes[m2];
      if (merged.length > 0) {
        var prev = merged[merged.length - 1];
        var gap = cur.start - prev.end;
        if (gap < mergeSlop && Math.abs(cur.midi - prev.midi) < 0.5) {
          prev.end = cur.end;
          prev.dur = prev.end - prev.start;
          prev.midi = prev.dur > cur.dur ? prev.midi : cur.midi;
          prev.conf = Math.max(prev.conf, cur.conf);
          continue;
        }
      }
      merged.push({
        start: cur.start, end: cur.end,
        midi: cur.midi, freq: midiToFreq(cur.midi),
        dur: cur.dur, conf: cur.conf
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

  global.DSP = {
    YIN_THRESHOLD: YIN_THRESHOLD,
    yinPitchFrame: yinPitchFrame,
    freqToMidi: freqToMidi,
    midiToFreq: midiToFreq,
    segmentNotes: segmentNotes,
    quantizeMidi: quantizeMidi,
    MIN_LAG: MIN_LAG,
    MAX_LAG: MAX_LAG
  };
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
