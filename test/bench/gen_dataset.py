#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_dataset.py — 生成 24 调 × 4 旋律模式 = 96 条合成哼唱基准
输出：
  data/notes/*.json   音符序列（midi/start/end/dur/amp，跑音版含 ±25 音分抖动）
  data/wav/*.wav      合成音频（基频+泛音+包络+滑音，模拟业余哼唱，供 basic-pitch e2e）
  data/manifest.json  清单（root/mode/pattern/文件路径）
"""
import json
import math
import os
import random
import wave

import numpy as np

SR = 44100
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(os.path.join(DATA, "notes"), exist_ok=True)
os.makedirs(os.path.join(DATA, "wav"), exist_ok=True)

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_DEG = [0, 2, 4, 5, 7, 9, 11]
MINOR_DEG = [0, 2, 3, 5, 7, 8, 10]

# 旋律模式：度为音阶下标（>7 自动升八度）
PATTERNS = {
    "scale":    [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0],   # 音阶上下行
    "arpeggio": [0, 2, 4, 7, 4, 2, 0, 0, 2, 4, 7],               # 主和弦琶音
    "pop":      [0, 4, 5, 7, 9, 7, 5, 4, 2, 0],                  # 流行短句
    "offtune":  [0, 4, 5, 7, 9, 7, 5, 4, 2, 0],                  # 同上 + 每音 ±25 音分跑音
    "nontonic_end": [0, 4, 5, 7, 9, 7, 5, 4, 2, 4],              # 结束在 4 级（结束音≠主音）
    "short":    [0, 4, 7, 4],                                    # 极短片段（4 音）
    "chromatic": [0, 2, 4, 5, 6, 7, 5, 0],                       # 含经过音 #4
}

# 每个模式的音符时值（秒）与响度模板
DURS = {
    "scale":    [0.35] * 15,
    "arpeggio": [0.4, 0.3, 0.3, 0.6, 0.3, 0.3, 0.5, 0.4, 0.3, 0.3, 0.8],
    "pop":      [0.5, 0.3, 0.3, 0.6, 0.4, 0.3, 0.3, 0.5, 0.4, 0.8],
    "offtune":  [0.5, 0.3, 0.3, 0.6, 0.4, 0.3, 0.3, 0.5, 0.4, 0.8],
    "nontonic_end": [0.5, 0.3, 0.3, 0.6, 0.4, 0.3, 0.3, 0.5, 0.4, 0.8],
    "short":    [0.5, 0.4, 0.7, 0.6],
    "chromatic": [0.4, 0.3, 0.3, 0.3, 0.2, 0.6, 0.3, 0.7],
}


def synth_note(dur, midi, detune_cents, amp):
    """基频+泛音+包络+起音滑音，模拟业余哼唱（与 test/e2e.js 的合成器一致）"""
    f0 = 440.0 * 2 ** ((midi - 69) / 12) * 2 ** (detune_cents / 1200)
    n = int(dur * SR)
    out = np.zeros(n, dtype=np.float32)
    phase = 0.0
    f_prev = f0 * 2 ** (-8 / 1200)
    for i in range(n):
        attack = min(1.0, i / (0.02 * SR))
        release = min(1.0, max(0.0, (n - i) / (0.15 * SR)))
        slide = -8 * max(0.0, 1 - i / (0.12 * SR))
        f = f0 * 2 ** (slide / 1200)
        phase += 2 * math.pi * (f + f_prev) / (2 * SR)
        f_prev = f
        s = math.sin(phase) + 0.3 * math.sin(2 * phase) + 0.1 * math.sin(3 * phase)
        out[i] = amp * attack * release * s
    return out


def gen_melody(root_pc, mode, pattern):
    degs = MAJOR_DEG if mode == "major" else MINOR_DEG
    seq = PATTERNS[pattern]
    durs = DURS[pattern]
    rng = random.Random(hash((root_pc, mode, pattern)) & 0xFFFFFFFF)
    tonic = 48 + root_pc  # 主音落在 C3~B3，旋律范围约 C3~B4，哼唱舒适音区
    notes = []
    t = 0.0
    for i, d in enumerate(seq):
        semis = degs[d % 7] + (d // 7) * 12
        midi = tonic + semis
        detune = (rng.random() - 0.5) * 50 if pattern == "offtune" else 0.0  # ±25 音分
        dur = durs[i]
        amp = 0.95 if i % 4 == 0 else 0.55 + 0.25 * rng.random()  # 强拍更响
        notes.append({
            "midi": round(midi + detune / 100, 2),
            "start": round(t, 3),
            "end": round(t + dur, 3),
            "dur": dur,
            "amp": round(amp, 3),
        })
        t += dur + 0.06
    return notes


def notes_to_wav(notes):
    """把音符序列合成 WAV（含音符间静音）"""
    chunks = []
    prev_end = 0.0
    for n in notes:
        gap = int((n["start"] - prev_end) * SR)
        if gap > 0:
            chunks.append(np.zeros(gap, dtype=np.float32))
        seg = synth_note(n["dur"], n["midi"], 0.0, n["amp"])
        chunks.append(seg)
        prev_end = n["end"]
    buf = np.concatenate(chunks)
    buf = buf / max(0.01, float(np.max(np.abs(buf)))) * 0.85
    pcm = (buf * 32767).astype("<i2")
    return pcm.tobytes()


def main():
    manifest = []
    for root in range(12):
        for mode in ("major", "minor"):
            for pattern in PATTERNS:
                key_name = NOTE_NAMES[root] + ("大调" if mode == "major" else "小调")
                fname = f"{NOTE_NAMES[root].replace('#', 's')}_{mode}_{pattern}"
                notes = gen_melody(root, mode, pattern)
                with open(os.path.join(DATA, "notes", fname + ".json"), "w", encoding="utf-8") as f:
                    json.dump(notes, f, ensure_ascii=False)
                wav_bytes = notes_to_wav(notes)
                with wave.open(os.path.join(DATA, "wav", fname + ".wav"), "wb") as w:
                    w.setnchannels(1)
                    w.setsampwidth(2)
                    w.setframerate(SR)
                    w.writeframes(wav_bytes)
                manifest.append({
                    "name": fname, "key": key_name, "root": root, "mode": mode,
                    "pattern": pattern,
                    "notes": os.path.join("notes", fname + ".json"),
                    "wav": os.path.join("wav", fname + ".wav"),
                })
    with open(os.path.join(DATA, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(f"生成 {len(manifest)} 条基准（24 调 × 4 模式）")


if __name__ == "__main__":
    main()
