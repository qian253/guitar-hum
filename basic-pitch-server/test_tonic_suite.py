# -*- coding: utf-8 -*-
"""test_tonic_suite.py — 主音识别全面测试集（v2.19.0 模块7）
覆盖：12 大调 / 5 小调 / 短旋律 / 长旋律 / 转调 / 无调性 / 高音区 / 低音区 / 脏音符 /
五声音阶 / 非主音结尾；每例输出完整中间数据（原始音符→清洗后→重心→最长音级→根音得分
前四→Chew→最终主音），并对比 旧版 detect_key（关系大小调反向修正）vs 新引擎 的准确率。
另有：168 条合成基准回归（note 级）、13 首真实哼唱标注评估（简谱重建）、
预处理/八度修正/清洗自适应/和弦验证 专项用例、音频级全链路用例（真实 basic-pitch）。

用法：cd basic-pitch-server && venv/Scripts/python.exe test_tonic_suite.py [--audio]
  --audio 额外跑音频级全链路用例（真实 basic-pitch 推理，约 +60s）
"""
import json
import math
import os
import sys
import wave

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from note_cleaner import clean_notes  # noqa: E402
from octave_fix import fix_octave_errors  # noqa: E402
from preprocess import preprocess_bytes, pcm_to_wav_bytes  # noqa: E402
from tonic_engine import analyze_tonic, chew_analyze  # noqa: E402

SR = 44100
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_DEG = [0, 2, 4, 5, 7, 9, 11]
MINOR_DEG = [0, 2, 3, 5, 7, 8, 10]

failures = 0
case_fail = []


def ok(name, cond, extra=""):
    global failures
    tag = "PASS" if cond else "FAIL"
    print("  %s %s%s" % (tag, name, ("  " + extra) if extra else ""))
    if not cond:
        failures += 1
        case_fail.append(name)


def synth_note(dur, midi, amp, sr=SR):
    """与 gen_dataset.py 一致（basic-pitch 0 音分转录验证过）"""
    f0 = 440.0 * 2 ** ((midi - 69) / 12)
    n = int(dur * sr)
    out = np.zeros(n, dtype=np.float32)
    phase = 0.0
    f_prev = f0 * 2 ** (-8 / 1200)
    for i in range(n):
        attack = min(1.0, i / (0.02 * sr))
        release = min(1.0, max(0.0, (n - i) / (0.15 * sr)))
        slide = -8 * max(0.0, 1 - i / (0.12 * sr))
        f = f0 * 2 ** (slide / 1200)
        phase += 2 * math.pi * (f + f_prev) / (2 * sr)
        f_prev = f
        s = math.sin(phase) + 0.3 * math.sin(2 * phase) + 0.1 * math.sin(3 * phase)
        out[i] = amp * attack * release * s
    return out


def notes_to_wav_bytes(notes, sr=SR):
    chunks = []
    prev_end = 0.0
    for n in notes:
        gap = int((n["start"] - prev_end) * sr)
        if gap > 0:
            chunks.append(np.zeros(gap, dtype=np.float32))
        chunks.append(synth_note(n["dur"], n["midi"], n.get("amp", 0.9), sr))
        prev_end = n["end"]
    buf = np.concatenate(chunks)
    buf = buf / max(0.01, float(np.max(np.abs(buf)))) * 0.85
    return pcm_to_wav_bytes(buf, sr)


def mk_notes(midis, durs, start=0.0, amp=0.9):
    out = []
    t = start
    for m, d in zip(midis, durs):
        out.append({"midi": m, "start": round(t, 3), "end": round(t + d, 3), "dur": d, "amplitude": amp})
        t += d + 0.06
    return out


def mel_pattern(root_pc, mode, pattern, tonic_midi=48):
    degs = MAJOR_DEG if mode == "major" else MINOR_DEG
    durs = {"scale": [0.35] * 15, "pop": [0.5, 0.3, 0.3, 0.6, 0.4, 0.3, 0.3, 0.5, 0.4, 0.8]}[pattern]
    seq = {"scale": [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0],
           "pop": [0, 4, 5, 7, 9, 7, 5, 4, 2, 0]}[pattern]
    midis, ds = [], []
    for i, d in enumerate(seq):
        semis = degs[d % 7] + (d // 7) * 12
        midis.append(tonic_midi + root_pc + semis)
        ds.append(durs[i])
    return mk_notes(midis, ds)


def nm(midi):
    return NOTE_NAMES[int(round(midi)) % 12] + str(int(round(midi)) // 12 - 1)


def run_engine(notes, recording_dur=None):
    return analyze_tonic(notes, recording_dur=recording_dur)


def old_detect_key(notes):
    """旧版 main.py detect_key（含关系大小调反向修正），用于修复前后对比"""
    KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
    KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

    def norm(p):
        m = sum(p) / len(p)
        return [v / m for v in p]

    MP, mP = norm(KS_MAJOR), norm(KS_MINOR)
    MS, mS = {0, 2, 4, 5, 7, 9, 11}, {0, 2, 3, 5, 7, 8, 10}

    def pc(m):
        return int(round(m)) % 12

    def corr(x, y):
        n = len(x)
        sx, sy = sum(x), sum(y)
        sxy = sum(a * b for a, b in zip(x, y))
        sxx, syy = sum(a * a for a in x), sum(b * b for b in y)
        den = math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy))
        return 0.0 if abs(den) < 1e-12 else (n * sxy - sx * sy) / den

    if len(notes) < 2:
        return {"key": None, "mode": None, "rootPC": None, "confidence": 0.0}
    hist = [0.5] * 12
    for n in notes:
        hist[pc(n["midi"])] += n.get("dur", 0.25)
    last = pc(notes[-1]["midi"])
    best = []
    for root in range(12):
        for mode, prof, scale in (("major", MP, MS), ("minor", mP, mS)):
            score = corr(hist, [prof[(i - root) % 12] for i in range(12)])
            member = sum(hist[i] for i in range(12) if (i - root) % 12 in scale)
            score += 0.2 * (member / sum(hist))
            if last == root:
                score += 0.15
            best.append((score, mode, root))
    best.sort(reverse=True)
    score, mode, root = best[0]
    rel_mode = "major" if mode == "minor" else "minor"
    rel_root = (root + 3) % 12 if mode == "minor" else (root + 9) % 12
    if last == rel_root:
        mode, root = rel_mode, rel_root
    return {"key": NOTE_NAMES[root] + ("小调" if mode == "minor" else "大调"), "mode": mode,
            "rootPC": root, "confidence": round(min(1.0, max(0.0, score - best[1][0]) / 0.15), 3)}


def eval_case(name, truth_root, truth_mode, notes, expect_modulation=None, expect_harmony=None, verbose=True):
    """跑新引擎，打印中间数据，返回 (root_ok, mode_ok)"""
    if verbose:
        print("▸", name)
        print("   原始音符:", " ".join("%s(%.2fs)" % (nm(n["midi"]), n["dur"]) for n in notes))
    cleaned, crep = clean_notes(notes)
    fixed, orep = fix_octave_errors(cleaned)
    if verbose and (crep["removed"] or orep["fixed"]):
        for r in crep["removed"]:
            print("   清洗剔除:", r["reason"])
        for f in orep["fixed"]:
            print("   八度修正:", f["reason"])
    if verbose:
        print("   清洗后音符:", " ".join("%s(%.2fs)" % (nm(n["midi"]), n["dur"]) for n in fixed))
    k = run_engine(fixed, recording_dur=max((n.get("end", 0) for n in fixed), default=0) + 0.5)
    rep = k["report"]
    if verbose:
        print("   重心音 %s · 最长音级 %s(占比%.0f%%) · 结束音 %s" % (
            rep["centroid"]["name"], rep["dominant"]["name"], rep["dominant"]["share"] * 100, rep["ending"]["name"]))
        print("   根音得分前四:", " | ".join("%s %.3f" % (r["name"], r["score"]) for r in rep["root_scores"][:4]))
        if rep["chew"]:
            print("   Chew最近音级: %s(conf %.3f)" % (NOTE_NAMES[rep["chew"]["nearest_pc"]], rep["chew"]["confidence"]))
        if rep["modulation"]:
            print("   ⚠ 转调检测:", rep["modulation"])
        if rep["harmony"]:
            print("   和弦验证: 首=%s 尾=%s 主和弦占比%.0f%% %s" % (
                rep["harmony"]["chords"][0], rep["harmony"]["chords"][-1],
                rep["harmony"]["tonic_fraction"] * 100, "确认✓" if rep["harmony"]["confirmed"] else "未确认"))
        print("   权重: scale=%s stab=%s ending=%s" % (rep["weights"]["scale"], rep["weights"]["stability"], rep["weights"]["ending"]))
    root_ok = k["rootPC"] == truth_root
    mode_ok = k["mode"] == truth_mode
    ok("%s → %s%s (conf %.2f) 期望 %s%s" % (name, k["keyName"], " ✓" if root_ok else " ✗", k["confidence"],
                                            NOTE_NAMES[truth_root], "大调" if truth_mode == "major" else "小调"),
       root_ok, "根音%s 调式%s" % ("✓" if root_ok else "✗(" + NOTE_NAMES[k["rootPC"]] + ")", "✓" if mode_ok else "✗"))
    if expect_modulation is not None:
        ok(name + " 转调检测", bool(rep["modulation"]) == expect_modulation,
           str(rep["modulation"] if rep["modulation"] else "无"))
    if expect_harmony is not None:
        ok(name + " 和弦验证", rep["harmony"]["confirmed"] == expect_harmony)
    return root_ok, mode_ok, k


# ================= 第一部分：note 级测试集（26 例） =================
print("=" * 90)
print("第一部分：音符级测试集（新引擎，逐例中间数据）")
print("=" * 90)
cases = []
# 12 大调（pop 或 scale 模式）
for root in range(12):
    cases.append(("大调·%s" % NOTE_NAMES[root], root, "major",
                  mel_pattern(root, "major", "pop" if root % 2 == 0 else "scale")))
# 5 小调
for root, mode in [(9, "minor"), (4, "minor"), (11, "minor"), (1, "minor"), (8, "minor")]:
    cases.append(("小调·%s" % NOTE_NAMES[root], root, "minor", mel_pattern(root, mode, "pop")))
# 短旋律（3/4 音）
cases.append(("短旋律·3音 C-E-G", 0, "major", mk_notes([60, 64, 67], [0.5, 0.4, 0.7])))
cases.append(("短旋律·4音 G-B-D-G", 7, "major", mk_notes([55, 59, 62, 55], [0.4, 0.3, 0.4, 0.8])))
# 长旋律（22 音）
long_midis = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 64, 67, 64, 62, 60, 59, 60]
cases.append(("长旋律·22音 C大调", 0, "major", mk_notes(long_midis, [0.3] * 22)))
# 转调（C 大调音阶上行 8 音 → F# 大调琶音 4 音）
# 文档化行为：整体判后段目标调 F# + 标记转调 + 置信度×0.8（低置信）
mod_notes = mk_notes([60, 62, 64, 65, 67, 69, 71, 72], [0.35] * 8) + \
    mk_notes([66, 70, 73, 78], [0.3, 0.3, 0.3, 0.5], start=3.28)
cases.append(("转调·C→F#", 6, "major", mod_notes))
# 无调性（半音阶）
chrom = mk_notes([60, 61, 62, 63, 64, 65, 66, 67, 68, 69], [0.25] * 10)
cases.append(("无调性·半音阶", None, None, chrom))
# 音域：低音区 C3 大调 / 高音区 C5 大调
cases.append(("低音区·C3大调", 0, "major", mel_pattern(0, "major", "scale", tonic_midi=24)))
cases.append(("高音区·C5大调", 0, "major", mel_pattern(0, "major", "scale", tonic_midi=72)))
# 脏音符（用户样例 G3-#G3-A3-F3-G3-B3）
dirty = mk_notes([55, 56, 57, 53, 55, 59], [0.22, 0.09, 0.32, 0.10, 0.28, 0.45])
cases.append(("脏音符·用户样例", 7, "major", dirty))
# 脏音符·B 大调（用户反馈场景：唱 B 被识别成别的调；含滑音/毛刺脏音，D# 为大三度）
b_dirty = mk_notes([59, 60, 61, 63, 59, 66, 59], [0.3, 0.08, 0.12, 0.4, 0.25, 0.5, 0.7])
cases.append(("脏音符·B大调用户场景", 11, "major", b_dirty))
# 五声音阶 C 大调五声（C D E G A）
pent = mk_notes([60, 62, 64, 67, 69, 67, 64, 62, 60], [0.4] * 9)
cases.append(("五声音阶·C宫调式", 0, "major", pent))
# 非主音结尾（结束在 2 级 D=62——非主和弦音；C G A C E C A G E D）
nontonic = mk_notes([60, 67, 69, 72, 76, 72, 69, 67, 64, 62], [0.5, 0.3, 0.3, 0.6, 0.4, 0.3, 0.3, 0.5, 0.4, 0.8])
cases.append(("非主音结尾·C大调结束在D(2级)", 0, "major", nontonic))
# 颤音式重复（同音反复）
trill = mk_notes([59, 60, 59, 60, 59, 60, 59], [0.12] * 7)
cases.append(("同音反复·B-C颤音", 11, "major", trill))

stats = {"new_root": 0, "new_mode": 0, "old_root": 0, "total": 0, "truth_total": 0}
for name, root, mode, notes in cases:
    if root is None:
        k = run_engine(notes)
        print("▸ %s → %s (conf %.2f)（无调性用例：只要求低置信/不崩溃）" % (name, k["keyName"], k["confidence"]))
        ok(name + " 置信度 ≤0.5（无调性）", k["confidence"] <= 0.5, "conf=%.2f" % k["confidence"])
        continue
    r_ok, m_ok, k = eval_case(name, root, mode, notes, verbose=(root in (0, 7, 11)))
    stats["total"] += 1
    stats["truth_total"] += 1
    if r_ok:
        stats["new_root"] += 1
    if m_ok:
        stats["new_mode"] += 1
    old = old_detect_key(notes)
    if old["rootPC"] == root:
        stats["old_root"] += 1

print()
print("第一部分小结：主音命中  新引擎 %d/%d  |  旧版(关系调反向修正) %d/%d" % (
    stats["new_root"], stats["total"], stats["old_root"], stats["total"]))

# ================= 第二部分：模块专项用例 =================
print()
print("=" * 90)
print("第二部分：模块专项（预处理 / 八度修正 / 清洗自适应 / 转调 / 和弦 / Chew）")
print("=" * 90)

print("【模块1 预处理】")
import io as _io
sr0 = 22050
t = np.arange(int(sr0 * 1.0)) / sr0
# 小声人声(0.2) + 50Hz嗡声(0.3) + DC偏移(0.1)：预处理应去 DC、压嗡声、归一化
x = (0.2 * np.sin(2 * np.pi * 196 * t) + 0.3 * np.sin(2 * np.pi * 50 * t) + 0.1).astype(np.float32)
wavbuf = _io.BytesIO()
with wave.open(wavbuf, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sr0)
    w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
pre, psr = preprocess_bytes(wavbuf.getvalue())
peak_pre = float(np.max(np.abs(pre)))
dc_pre = float(np.mean(pre))
spec_pre = np.abs(np.fft.rfft(pre))
freqs_pre = np.fft.rfftfreq(len(pre), 1 / psr)
hum_after = float(spec_pre[np.argmin(np.abs(freqs_pre - 50))])
sig_after = float(spec_pre[np.argmin(np.abs(freqs_pre - 196))])
ok("预处理·去直流（0.1 → <0.005）", abs(dc_pre) < 0.005, "DC=%.2e" % dc_pre)
ok("预处理·峰值归一化≈0.85", 0.80 < peak_pre <= 0.851, "peak=%.3f" % peak_pre)
ok("预处理·50Hz 嗡声被压到基频以下（衰减>4×）", hum_after / (sig_after + 1e-9) < 0.5,
   "50Hz/基频=%.3f（原始比值 0.3/0.2=1.5）" % (hum_after / (sig_after + 1e-9)))

print("【模块2 八度修正】")
oct_case = mk_notes([55, 71, 55], [0.3, 0.4, 0.3])  # G3 B4 G3：B4 应为 B3 的孤立八度跳变
fixed, orep = fix_octave_errors(oct_case)
ok("孤立八度跳变 B4→B3", [n["midi"] for n in fixed] == [55, 59, 55], str([n["midi"] for n in fixed]) + " " + str(orep))
oct_keep = mk_notes([55, 59, 60], [0.3, 0.4, 0.3])  # 正常旋律不误修
fixed2, _ = fix_octave_errors(oct_keep)
ok("正常旋律不误修", [n["midi"] for n in fixed2] == [55, 59, 60])

print("【模块3 清洗自适应】")
fast = mk_notes([60, 62, 64, 62, 60, 62, 64, 62], [0.11] * 8)  # 快速旋律真实短音（0.11s）
cfast, rfast = clean_notes(fast)
ok("快速旋律真实短音保留（自适应阈值收缩）", len(cfast) == 8,
   "阈值 min_dur=%s（默认0.100会全删，自适应后保留%d/8）" % (rfast["params"].get("min_dur"), len(cfast)))
slow = mk_notes([60, 62, 64, 62], [0.5] * 4)
cslow, rslow = clean_notes(slow)
ok("慢速旋律阈值维持规格默认", rslow["params"]["min_dur"] == 0.100, str(rslow["params"].get("min_dur")))

print("【模块4 动态权重 + 转调】")
short4 = mel_pattern(0, "major", "pop")[:4]
k4 = run_engine(short4)
ok("短旋律动态权重（scale↑ stab↓ ending↑）",
   k4["report"]["weights"]["scale"] > 0.20 and k4["report"]["weights"]["stability"] < 0.10
   and k4["report"]["weights"]["ending"] > 0.15, str(k4["report"]["weights"]))
long20 = mk_notes(long_midis[:20], [0.3] * 20)
k20 = run_engine(long20)
ok("长旋律动态权重（scale↓）", k20["report"]["weights"]["scale"] < 0.20, str(k20["report"]["weights"]))
kmod = run_engine(mod_notes)
ok("转调检测 C→F# 触发 + 返回目标调 F# + 置信度打折", bool(kmod["report"]["modulation"]) and kmod["rootPC"] == 6,
   "root=%s conf=%.2f %s" % (NOTE_NAMES[kmod["rootPC"]], kmod["confidence"], str(kmod["report"]["modulation"])))

print("【模块6 和弦验证】")
kpop = run_engine(mel_pattern(0, "major", "pop"))
ok("C大调 pop 首尾主和弦→确认", kpop["report"]["harmony"]["confirmed"] is True, str(kpop["report"]["harmony"]["chords"][:4]))
knt = run_engine(nontonic)
ok("非主音结尾→不确认", knt["report"]["harmony"]["confirmed"] is False)

print("【模块4 Chew 校验（partitura 公式；CE 最近音级 ≠ 主音，最近调中心才是）】")
chew_c = chew_analyze(mk_notes([60, 64, 67, 60], [0.4] * 4))  # C 大三和弦
ok("C大三和弦→Chew最近调中心 C大调", chew_c["top_keys"][0]["root"] == 0 and chew_c["top_keys"][0]["mode"] == "major",
   "最近调中心 %s%s（最近音级 %s）" % (NOTE_NAMES[chew_c["top_keys"][0]["root"]],
                                       "小" if chew_c["top_keys"][0]["mode"] == "minor" else "大",
                                       NOTE_NAMES[chew_c["nearest_pc"]]))
chew_g = chew_analyze(mel_pattern(7, "major", "scale"))
ok("G大调音阶→Chew最近调中心根音 G（完整音阶上 Chew 的大小调模板距离接近，根音判定为准）",
   chew_g["top_keys"][0]["root"] == 7,
   "最近调中心 %s%s（top3: %s）" % (NOTE_NAMES[chew_g["top_keys"][0]["root"]],
                                    "小" if chew_g["top_keys"][0]["mode"] == "minor" else "大",
                                    " / ".join("%s%s" % (NOTE_NAMES[k["root"]], "小" if k["mode"] == "minor" else "大")
                                              for k in chew_g["top_keys"])))

# ================= 第三部分：168 合成基准回归（note 级） =================
print()
print("=" * 90)
print("第三部分：168 条合成基准回归（新引擎 note 级）")
print("=" * 90)
manifest_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "bench", "data", "manifest.json")
bench_tonic = bench_exact = bench_n = 0
by_pat = {}
with open(manifest_path, encoding="utf-8") as f:
    manifest = json.load(f)
for item in manifest:
    notes_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "bench", "data", item["notes"])
    with open(notes_path, encoding="utf-8") as f:
        notes = json.load(f)
    notes = [{"midi": n["midi"], "dur": n.get("dur", 0.25), "start": n.get("start", 0), "end": n.get("end", 0),
              "amplitude": n.get("amp", 0)} for n in notes]
    k = run_engine(notes)
    pat = item["pattern"]
    by_pat.setdefault(pat, [0, 0, 0])
    by_pat[pat][2] += 1
    bench_n += 1
    if k["rootPC"] == item["root"]:
        bench_tonic += 1
        by_pat[pat][0] += 1
    if k["rootPC"] == item["root"] and k["mode"] == item["mode"]:
        bench_exact += 1
        by_pat[pat][1] += 1
print("  总计: 主音 %d/%d (%.1f%%)  精确 %d/%d (%.1f%%)" % (
    bench_tonic, bench_n, bench_tonic / bench_n * 100, bench_exact, bench_n, bench_exact / bench_n * 100))
for pat, v in sorted(by_pat.items()):
    print("    %-14s 主音 %d/%d  精确 %d/%d" % (pat, v[0], v[2], v[1], v[2]))
ok("基准主音 100%", bench_tonic == bench_n, "%d/%d" % (bench_tonic, bench_n))

# ================= 第四部分：13 首真实哼唱标注评估（简谱重建，注意标注真值噪声） =================
print()
print("=" * 90)
print("第四部分：13 首真实哼唱标注（简谱重建音符；标注无参考音、真值有噪声，仅供参考）")
print("=" * 90)
anno_path = "C:/Users/keyou/Downloads/哼唱标注数据.json"
if os.path.exists(anno_path):
    with open(anno_path, encoding="utf-8") as f:
        annos = json.load(f)
    anno_hit = 0
    for i, item in enumerate(annos):
        truth = item["truth"]
        jp = item.get("jianpu", "")
        dkey_m = item["detected"]["keyName"].split("（")[0]
        dkey_name = dkey_m.strip("（）")
        import re
        m2 = re.match(r"([A-G]#?)\s*大调", dkey_name)
        dkey_root = NOTE_NAMES.index(m2.group(1)) if m2 else 0
        digits = []
        chars = list(jp)
        idx = 0
        while idx < len(chars):
            c = chars[idx]
            if "1" <= c <= "7":
                digits.append(int(c))
            idx += 1
        ev = item.get("evidence", "")
        dom_m = re.search(r"时长最长音级\s+([A-G](?:#|b)?)", ev)
        end_m = re.search(r"结束音\s+([A-G](?:#|b)?\d)", ev)
        FLAT = {"C": 0, "Db": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11}
        notes = []
        for d in digits:
            pc = (dkey_root + MAJOR_DEG[(d - 1) % 7]) % 12
            notes.append({"midi": 60 + pc, "start": 0, "end": 0.4, "dur": 0.4, "amplitude": 0.8})
        if dom_m:
            dom_pc = FLAT[dom_m.group(1)]
            for n in notes:
                if n["midi"] % 12 == dom_pc:
                    n["dur"] += 0.4
        if end_m:
            end_pc = FLAT[re.match(r"([A-G](?:#|b)?)", end_m.group(1)).group(1)]
            notes.append({"midi": 60 + end_pc, "start": 0, "end": 1.0, "dur": 1.0, "amplitude": 0.8})
        k = run_engine(notes)
        hit = k["rootPC"] == truth["root"]
        if hit:
            anno_hit += 1
        print("  #%02d 真值 %s大调 → 引擎 %s (%s conf %.2f)  %s" % (
            i + 1, NOTE_NAMES[truth["root"]], k["keyName"], "✓" if hit else "✗", k["confidence"],
            "" if hit else "（标注无参考音，内容可能本就不在所选调上）"))
    print("  主音命中 %d/%d（参考值；上轮分析已证 10/13 首哼唱内容与所选调不符）" % (anno_hit, len(annos)))

# ================= 第五部分：音频级全链路（真实 basic-pitch） =================
if "--audio" in sys.argv:
    print()
    print("=" * 90)
    print("第五部分：音频级全链路用例（预处理→basic-pitch→清洗→八度修正→主音引擎）")
    print("=" * 90)
    from basic_pitch.inference import predict
    audio_cases = [
        ("音频·C大调音阶", 0, "major", mel_pattern(0, "major", "scale")),
        ("音频·G大调pop", 7, "major", mel_pattern(7, "major", "pop")),
        ("音频·A小调", 9, "minor", mel_pattern(9, "minor", "pop")),
        ("音频·B大调(用户反馈场景)", 11, "major", mel_pattern(11, "major", "pop")),
        ("音频·脏音符样例", 7, "major", dirty),
        ("音频·转调C→F#(判目标调+标记)", 6, "major", mod_notes),
        ("音频·高音区C5大调", 0, "major", mel_pattern(0, "major", "scale", tonic_midi=72)),
    ]
    import tempfile
    for name, root, mode, notes in audio_cases:
        wav_bytes = notes_to_wav_bytes(notes)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(wav_bytes)
            tmp_path = tmp.name
        try:
            _mo, _md, evs = predict(tmp_path)
        finally:
            os.unlink(tmp_path)
        raw = [{"midi": int(ev[2]), "start": round(float(ev[0]), 3), "end": round(float(ev[1]), 3),
                "dur": round(max(0.0, float(ev[1]) - float(ev[0])), 3), "amplitude": round(float(ev[3]), 4)} for ev in evs]
        cleaned, crep = clean_notes(raw)
        fixed, orep = fix_octave_errors(cleaned)
        k = run_engine(fixed, recording_dur=fixed[-1]["end"] + 0.3)
        if "转调" in name:
            # 转调用例：允许判前段调(C=0)或后段目标调(root)，但必须标记转调（低置信）
            cond = k["rootPC"] in (root, 0) and bool(k["report"]["modulation"])
        else:
            cond = k["rootPC"] == root
        ok("%s → %s (conf %.2f) 期望 %s%s" % (name, k["keyName"], k["confidence"], NOTE_NAMES[root],
                                              "大调" if mode == "major" else "小调"), cond,
           "原始%d音→清洗%d音→修正%d音" % (len(raw), len(cleaned), len(fixed)))
        if name.startswith("音频·脏音符"):
            print("     基本pitch原始:", " ".join(nm(n["midi"]) for n in raw))
            print("     清洗后:", " ".join(nm(n["midi"]) for n in fixed))

print()
if failures:
    print("✗ %d 项失败：%s" % (failures, "；".join(case_fail)))
    sys.exit(1)
print("✓ 主音识别测试集全部通过")
