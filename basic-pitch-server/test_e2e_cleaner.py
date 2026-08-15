# -*- coding: utf-8 -*-
"""test_e2e_cleaner.py — 清洗器端到端验证（真实 basic-pitch 转录链路）
用基准同款合成器（gen_dataset.py 的 synth_note：基频+泛音+包络+起音滑音，44.1kHz，
basic-pitch 对其转录误差 0.0 音分）合成用户描述的脏哼唱：
  G3(实音) → #G3(滑音过分割短音) → A3 → F3(气息毛刺短音) → G3 → B3
跑真实 basic-pitch → 清洗器 → 断言清洗后 == G3 A3 G3 B3。

用法：cd basic-pitch-server && venv/Scripts/python.exe test_e2e_cleaner.py
"""
import math
import os
import sys
import tempfile
import wave

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from note_cleaner import clean_notes  # noqa: E402

SR = 44100


def synth_note(dur, midi, amp):
    """与 test/bench/gen_dataset.py 完全一致的合成器（bench 已证 basic-pitch 0 音分误差）"""
    f0 = 440.0 * 2 ** ((midi - 69) / 12)
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


def main():
    # 用户描述的脏哼唱：真实音 G3 A3 G3 B3 + 两个脏音 #G3(滑音) / F3(毛刺)，脏音稍轻
    seq = [  # (midi, dur, amp)
        (55, 0.22, 0.95),   # G3
        (56, 0.09, 0.70),   # #G3 滑音过分割
        (57, 0.32, 0.95),   # A3
        (53, 0.10, 0.70),   # F3 气息毛刺
        (55, 0.28, 0.95),   # G3
        (59, 0.45, 0.95),   # B3
    ]
    parts = [np.zeros(int(0.10 * SR), dtype=np.float32)]
    for midi, dur, amp in seq:
        parts.append(synth_note(dur, midi, amp))
        parts.append(np.zeros(int(0.06 * SR), dtype=np.float32))
    audio = np.concatenate(parts)
    # 与 gen_dataset.py 一致：峰值归一化到 0.85（不归一化会削波失真，basic-pitch 会听出杂音）
    audio = audio / max(0.01, float(np.max(np.abs(audio)))) * 0.85

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp_path = tmp.name
    tmp.close()
    with wave.open(tmp_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((audio * 32767).astype("<i2").tobytes())

    try:
        from basic_pitch.inference import predict
        _mo, _md, note_events = predict(tmp_path)
    finally:
        os.unlink(tmp_path)

    raw = []
    for ev in note_events:
        start_t, end_t, pitch = ev[0], ev[1], ev[2]
        amplitude = float(ev[3]) if len(ev) > 3 else 0.0
        raw.append({"midi": int(pitch), "start": round(float(start_t), 3),
                    "end": round(float(end_t), 3),
                    "dur": round(max(0.0, float(end_t) - float(start_t)), 3),
                    "amplitude": round(amplitude, 4)})
    # basic-pitch 返回顺序不保证按时间，清洗器内部会排序；展示按时间序
    raw_sorted = sorted(raw, key=lambda n: n["start"])

    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

    def nm(n):
        return names[int(round(n["midi"])) % 12] + str(int(round(n["midi"])) // 12 - 1)

    cleaned, report = clean_notes(raw)

    print("basic-pitch 原始转录: %s（%d 个音）" % (str([nm(n) for n in raw_sorted]), len(raw_sorted)))
    if report["removed"]:
        for r in report["removed"]:
            print("  清洗剔除:", r["reason"])
    else:
        print("  （本次 basic-pitch 已自行合并滑音/忽略毛刺，清洗器原样保留——验证不误伤）")
    print("清洗后: %s（%d 个音）" % (str([nm(n) for n in cleaned]), len(cleaned)))

    got = [nm(n) for n in cleaned]
    expect = ["G3", "A3", "G3", "B3"]
    print("预期: %s" % str(expect))
    if got != expect:
        print("✗ 端到端清洗结果不符: %s" % str(got))
        sys.exit(1)
    print("✓ 端到端验证通过：真实 basic-pitch 输出经清洗后正确还原 G3 A3 G3 B3")


if __name__ == "__main__":
    main()
