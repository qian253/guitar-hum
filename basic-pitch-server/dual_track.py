# -*- coding: utf-8 -*-
"""dual_track.py — 双轨转录校验（v2.24.0 P0）
解决 basic-pitch 在单音哼唱上「宁可多报」的问题:
  第一轨 basic-pitch:负责 onset(哪里有新音符开始)
  第二轨 YIN(librosa,逐帧 F0):负责确认「这个位置的音高到底是什么」
  交集判定:basic-pitch 音符的时间窗内,第二轨有足够比例的有声帧,
    且两者音高差 ≤1 半音 → 确认保留;否则视为伪影删除。
  (原方案建议第二轨用 CREPE;本实现用同源的 YIN——同为逐帧单 F0、
  零新依赖、毫秒级,且与前端快速模式行为一致。)
"""
from __future__ import annotations

import numpy as np
import librosa

HOP_MS = 23.0        # 帧步长(约 23ms,与前端 YIN 节奏一致)
TOL_S = 0.05         # 时间窗容差(窗内取帧)
TOL_SEMI = 1.0       # 音高差容差(半音)
MIN_VOICED_RATIO = 0.30  # 窗内有声帧占比低于此值 → 无证据
EDGE_TRIM_S = 0.02   # 音符首尾各去掉 20ms(起音/释音瞬态不可靠)


def yin_track(x, sr=22050):
    """逐帧 F0:返回 (times, f0),f0 中 NaN = 未出声帧"""
    hop = max(64, int(sr * HOP_MS / 1000))
    f0 = librosa.yin(x, fmin=60, fmax=1100, sr=sr,
                     frame_length=2048, hop_length=hop, trough_threshold=0.15)
    times = librosa.times_like(f0, sr=sr, hop_length=hop)
    return times, f0


def _midi_name(midi):
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return names[int(round(midi)) % 12] + str(int(round(midi)) // 12 - 1)


def verify_notes(notes, times, f0, audio=None, sr=22050):
    """双轨校验。返回 (kept, report)。notes 需已按 start 排序。
    audio 提供时先做能量门:窗内 RMS 过低(<0.012)直接判无证据(YIN 在静音上可能报随机高音)。"""
    report = {"kept": [], "dropped": [], "note": "双轨校验(basic-pitch onset × YIN 逐帧 F0)"}
    kept = []
    for n in notes:
        s = float(n.get("start", 0.0)) + EDGE_TRIM_S
        e = float(n.get("end", s)) - EDGE_TRIM_S
        if e <= s:
            kept.append(n)
            continue
        bp_midi = int(round(float(n.get("midi", 0))))
        if audio is not None:
            i0 = max(0, int(s * sr))
            i1 = min(len(audio), int(e * sr))
            rms = float(np.sqrt(np.mean(np.square(audio[i0:i1])))) if i1 > i0 else 0.0
            if rms < 0.012:
                report["dropped"].append({
                    "midi": bp_midi,
                    "start": round(s, 3),
                    "reason": "双轨校验:basic-pitch 报 %s(%.2f-%.2fs),但该窗内能量过低(rms=%.4f),判为伪影" % (
                        _midi_name(bp_midi), s, e, rms),
                })
                continue
        m = (times >= s) & (times <= e)
        f = f0[m]
        voiced = f[~np.isnan(f)]
        ratio = len(voiced) / max(1, len(f))
        if ratio < MIN_VOICED_RATIO:
            report["dropped"].append({
                "midi": bp_midi,
                "start": round(s, 3),
                "reason": "双轨校验:basic-pitch 报 %s(%.2f-%.2fs),但第二轨该窗内有声帧仅 %.0f%%(<%.0f%%),判为伪影" % (
                    _midi_name(bp_midi), s, e, ratio * 100, MIN_VOICED_RATIO * 100),
            })
            continue
        midi_yin = 69 + 12 * np.log2(np.median(voiced) / 440.0)
        diff = abs(midi_yin - bp_midi)
        if diff <= TOL_SEMI:
            kept.append(n)
            report["kept"].append({"midi": bp_midi, "diff_semi": round(float(diff), 2)})
        else:
            report["dropped"].append({
                "midi": bp_midi,
                "start": round(s, 3),
                "reason": "双轨校验:basic-pitch 报 %s,第二轨实测 %s(差 %.1f 半音),判为伪影" % (
                    _midi_name(bp_midi), _midi_name(midi_yin), diff),
            })
    return kept, report
