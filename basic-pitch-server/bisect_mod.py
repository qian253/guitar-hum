# -*- coding: utf-8 -*-
"""bisect_mod.py — 转调用例二分:哪个改动杀死了 v2.25.0 能过的转调场景"""
import sys
import tonic_engine as te

def mk(onsets_midis, durs, start=0.0):
    out = []
    t = start
    for (m, d) in zip(onsets_midis, durs):
        out.append({"midi": float(m), "start": round(t, 3), "dur": d, "end": round(t + d, 3)})
        t += d + 0.06  # 与 test_tonic_suite.mk_notes 一致:音间 0.06s 间隙
    return out

mod_notes = mk([60, 62, 64, 65, 67, 69, 71, 72], [0.35] * 8) + \
    mk([66, 70, 73, 78], [0.3, 0.3, 0.3, 0.5], start=3.28)

def report(tag):
    r = te.analyze_tonic(mod_notes)
    print(f"{tag}: → {r['keyName']} conf={r['confidence']:.0%} mod={bool(r['report']['modulation'])}")

report("A 当前全量状态")

# B: P3 门 2.0 → 1.5(v2.25.0 原值)
orig_tend = te.tendency_scores
def tend15(notes):
    tend = [0.0] * 12
    pairs = 0
    for i in range(1, len(notes)):
        iv = int(round(notes[i]["midi"])) - int(round(notes[i - 1]["midi"]))
        pairs += 1
        src_dur = max(0.05, notes[i - 1].get("dur", 0.25))
        dst_dur = max(0.05, notes[i].get("dur", 0.25))
        if dst_dur < src_dur * 1.5:
            continue
        if iv == 1:
            tend[te._pc(notes[i]["midi"])] += 0.3
        elif iv == -7:
            tend[te._pc(notes[i]["midi"])] += 0.2
        elif iv == 5:
            tend[te._pc(notes[i]["midi"])] += 0.15
    norm = max(0.3, pairs * 0.3)
    return [min(1.0, t / norm) for t in tend]
te.tendency_scores = tend15
report("B P3门1.5(v2.25原值)")
te.tendency_scores = orig_tend

# C: 无起始音加成
te.OPENING_BONUS_STRONG = 0.0
te.OPENING_BONUS_MID = 0.0
te.OPENING_BONUS_WEAK = 0.0
report("C 去掉起始音加成")
te.OPENING_BONUS_STRONG = 0.35
te.OPENING_BONUS_MID = 0.25
te.OPENING_BONUS_WEAK = 0.05

# D: P2 长度门控关掉(全量 0.30)
import re
src = open("tonic_engine.py", encoding="utf-8").read()
src2 = src.replace("w2_scale = 1.0 if n <= 5 else (0.5 if n <= 8 else 0.1667)", "w2_scale = 1.0")
ns = {}
exec(compile(src2, "te_nogate", "exec"), ns)
te2 = ns
r = te2["analyze_tonic"](mod_notes)
print(f"D P2门控关: → {r['keyName']} conf={r['confidence']:.0%}")
