# -*- coding: utf-8 -*-
"""eval_vocalset.py — VocalSet 真实人声定调评估
对提取出的 wav 走完整产品链路(预处理→basic-pitch→清洗→八度→双轨校验→三支柱引擎),
与文件名标注的调性对比,输出真实人声的定调准确率。
VocalSet 命名:arpeggio/scale 文件名含起始音(如 arpeggio_E4 = E 大调琶音),模式在名字里
(major/minor/harmonic_minor/melodic_minor/diminished/augmented/chromatic…)。
用法: venv/Scripts/python.exe eval_vocalset.py [目录] [limit]
"""
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from basic_pitch.inference import predict
from note_cleaner import clean_notes
from octave_fix import fix_octave_errors
from dual_track import yin_track, verify_notes
from preprocess import preprocess_bytes
from tonic_engine import analyze_tonic

DATA = sys.argv[1] if len(sys.argv) > 1 else "eval_data/vocalset"
LIMIT = int(sys.argv[2]) if len(sys.argv) > 2 else 999
NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def truth_from_name(name):
    """VocalSet 命名 f1_scales_c_fast_piano_u.wav → (root_pc, 'major')"""
    m = re.search(r"_(scales|arpeggios)_([a-g])_", name, re.I)
    if not m:
        return None
    letter = m.group(2).lower()
    lut = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
    if letter not in lut:
        return None
    return lut[letter], "major"


def run_one(path):
    data = open(path, "rb").read()
    pre = preprocess_bytes(data)
    if pre is None:
        return None, "预处理失败"
    x, sr = pre
    tmp = path + ".tmp.wav"
    from preprocess import pcm_to_wav_bytes
    with open(tmp, "wb") as f:
        f.write(pcm_to_wav_bytes(x, sr))
    try:
        _mo, _md, evs = predict(tmp)
    except Exception as e:  # noqa: BLE001
        return None, "bp失败: %s" % e
    finally:
        os.unlink(tmp)
    notes = [{"midi": int(ev[2]), "start": round(float(ev[0]), 3), "end": round(float(ev[1]), 3),
              "dur": round(max(0.0, float(ev[1]) - float(ev[0])), 3), "amplitude": round(float(ev[3]), 4)} for ev in evs]
    notes, _c = clean_notes(notes)
    notes, _o = fix_octave_errors(notes)
    times, f0 = yin_track(x, sr)
    notes, _d = verify_notes(notes, times, f0, audio=x, sr=sr)
    if len(notes) < 2:
        return None, "音符不足(%d)" % len(notes)
    k = analyze_tonic(notes, recording_dur=notes[-1]["end"] + 0.3)
    return k, None


def main():
    files = sorted(f for f in os.listdir(DATA) if f.endswith(".wav"))
    print("共 %d 个 wav,评估前 %d 个" % (len(files), min(LIMIT, len(files))))
    n = root_hit = mode_hit = 0
    fails = []
    for i, fn in enumerate(files[:LIMIT]):
        truth = truth_from_name(fn)
        if not truth:
            continue
        n += 1
        k, err = run_one(os.path.join(DATA, fn))
        if k is None:
            fails.append((fn, err))
            print("  ✗ %-40s %s" % (fn[:40], err))
            continue
        r_ok = k["rootPC"] == truth[0]
        m_ok = truth[1] == "other" or k["mode"] == truth[1]
        root_hit += r_ok
        mode_hit += m_ok
        print("  %s %-42s 真值 %s%s → %s(conf %.2f) %s" % (
            "✓" if r_ok else "✗", fn[:42], NOTES[truth[0]], truth[1], k["keyName"], k["confidence"],
            "" if r_ok else "  根音错" + NOTES[k["rootPC"]]))
    print()
    print("=" * 60)
    print("真实人声(VocalSet)定调评估:主音 %d/%d = %.0f%%" % (root_hit, n, root_hit / n * 100 if n else 0))
    print("大小调命中 %d/%d" % (mode_hit, n))
    if fails:
        print("失败 %d 条: %s" % (len(fails), "、".join(x[0] for x in fails[:5])))


if __name__ == "__main__":
    main()
