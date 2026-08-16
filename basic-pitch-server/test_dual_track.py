# -*- coding: utf-8 -*-
"""test_dual_track.py — 双轨转录校验验收(v2.24.0 P0)
1) 单元:basic-pitch 报出静音窗/音高不符的伪影 → 第二轨(YIN 逐帧 F0+能量门)删除
2) 单元:真实音符窗内 F0 相符 → 保留(不误杀)
3) 单元:滑音音高渐变窗 → 按中值音高判定(≤1 半音保留)
用法:cd basic-pitch-server && venv/Scripts/python.exe test_dual_track.py
"""
import sys

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, ".")

from dual_track import yin_track, verify_notes  # noqa: E402

SR = 22050
failures = 0


def ok(name, cond, extra=""):
    global failures
    print("  %s %s%s" % ("PASS" if cond else "FAIL", name, ("  " + extra) if extra else ""))
    if not cond:
        failures += 1


def tone(freq, t0, t1, amp=0.6):
    tt = np.arange(len(x)) / SR if False else None
    return None


print("【1】伪影删除:静音窗(气息毛刺)")
x = np.zeros(int(SR * 1.5), dtype=np.float32)
t = np.arange(len(x)) / SR
x[(t >= 0.2) & (t < 0.6)] = 0.6 * np.sin(2 * np.pi * 196 * t[(t >= 0.2) & (t < 0.6)])
x[(t >= 0.75) & (t < 1.2)] = 0.6 * np.sin(2 * np.pi * 220 * t[(t >= 0.75) & (t < 1.2)])
times, f0 = yin_track(x, SR)
notes = [
    {"midi": 55, "start": 0.2, "end": 0.6, "dur": 0.4},
    {"midi": 56, "start": 0.65, "end": 0.72, "dur": 0.07},  # 静音伪影
    {"midi": 57, "start": 0.75, "end": 1.2, "dur": 0.45},
]
kept, rep = verify_notes(notes, times, f0, audio=x, sr=SR)
ok("静音伪影 G#3 删除", [n["midi"] for n in kept] == [55, 57], str([n["midi"] for n in kept]))
ok("删除报告有原因", len(rep["dropped"]) == 1 and "能量过低" in rep["dropped"][0]["reason"])

print("【2】真实音符不误杀")
notes2 = [
    {"midi": 55, "start": 0.2, "end": 0.6, "dur": 0.4},
    {"midi": 57, "start": 0.75, "end": 1.2, "dur": 0.45},
]
kept2, rep2 = verify_notes(notes2, times, f0, audio=x, sr=SR)
ok("真实音符全保留", [n["midi"] for n in kept2] == [55, 57], str(rep2["dropped"]))

print("【3】音高不符伪影删除(F0 与 basic-pitch 差 >1 半音)")
x3 = np.zeros(int(SR * 1.6), dtype=np.float32)
t3 = np.arange(len(x3)) / SR
x3[(t3 >= 0.2) & (t3 < 0.55)] = 0.6 * np.sin(2 * np.pi * 196 * t3[(t3 >= 0.2) & (t3 < 0.55)])
x3[(t3 >= 0.6) & (t3 < 0.95)] = 0.6 * np.sin(2 * np.pi * 220 * t3[(t3 >= 0.6) & (t3 < 0.95)])
times3, f03 = yin_track(x3, SR)
notes3 = [
    {"midi": 55, "start": 0.2, "end": 0.55, "dur": 0.35},
    {"midi": 59, "start": 0.6, "end": 0.95, "dur": 0.35},  # bp 错报 B3,实际是 A3
]
kept3, rep3 = verify_notes(notes3, times3, f03, audio=x3, sr=SR)
ok("音高不符的 B3 删除", [n["midi"] for n in kept3] == [55], str(rep3["dropped"]))

print("【4】滑音窗(音高渐变)按中值判定保留")
x4 = np.zeros(int(SR * 1.4), dtype=np.float32)
t4 = np.arange(len(x4)) / SR
seg = (t4 >= 0.2) & (t4 < 0.9)
freqs = np.linspace(196, 220, seg.sum())
x4[seg] = 0.6 * np.sin(2 * np.pi * np.cumsum(freqs) / SR)
times4, f04 = yin_track(x4, SR)
notes4 = [{"midi": 57, "start": 0.2, "end": 0.9, "dur": 0.7}]  # G→A 滑音,bp 合并为一个 A
kept4, rep4 = verify_notes(notes4, times4, f04, audio=x4, sr=SR)
ok("滑音合并音保留(A 与中值音高差 ≤1 半音)", [n["midi"] for n in kept4] == [57], str(rep4["dropped"]))

print()
if failures:
    print("✗ %d 项失败" % failures)
    sys.exit(1)
print("✓ 双轨转录校验验收全部通过")
