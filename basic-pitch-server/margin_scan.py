# -*- coding: utf-8 -*-
"""margin_scan.py — 168 基准上扫 detect_modulation 的 margin 分布,定切换阈值"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tonic_engine as te

BASE = "C:/Users/keyou/hum-key/test/bench/data"
mf = json.load(open(os.path.join(BASE, "manifest.json"), encoding="utf-8"))
mods = []
for it in mf:
    np_ = os.path.join(BASE, it["notes"])
    raw = json.load(open(np_, encoding="utf-8"))
    notes = []
    for n in raw:
        nn = {"midi": n.get("midi", n.get("m")), "start": n.get("start", n.get("s", 0.0)),
              "dur": n.get("dur", n.get("d", 0.25))}
        if n.get("end") is not None:
            nn["end"] = n["end"]
        notes.append(nn)
    mod = te.detect_modulation(notes)
    if mod:
        mods.append((mod["second_half"]["margin"], mod["first_half"]["margin"],
                     it["root"], it["pattern"], it["name"]))
mods.sort()
print("触发转调的基准条目(共%d):" % len(mods))
for m2, m1, truth, pat, name in mods:
    print(f"  m1={m1:.3f} m2={m2:.3f} truth={te.DISPLAY[truth]:>3} {pat:<14} {name}")
