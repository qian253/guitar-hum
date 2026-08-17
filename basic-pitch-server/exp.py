# -*- coding: utf-8 -*-
"""exp.py — 单变量实验运行器:python exp.py <实验名>
每个实验 = 对 tonic_engine 的运行时补丁,一次只改一个变量,
跑 12 条真实人声测试集输出对比,确认有效再落进 tonic_engine.py。
"""
import json
import sys
import tonic_engine as te
from eval12 import norm_notes, content_fit, DATA, SAMPLES

def ks_smooth(raw, blend):
    out = []
    for i in range(12):
        sm = (raw[(i - 1) % 12] + 2 * raw[i] + raw[(i + 1) % 12]) / 4.0
        out.append(raw[i] * (1 - blend) + sm * blend)
    return out

PATCHES = {}

def patch(exp):
    if exp == "ks_smooth50":
        te.MAJOR_PROF = te._norm(ks_smooth(te.KS_MAJOR_RAW, 0.5))
        te.MINOR_PROF = te._norm(ks_smooth(te.KS_MINOR_RAW, 0.5))
        return "K-S 模板 50% 平滑(3点圆滑,降峰值依赖)"
    if exp == "ks_smooth100":
        te.MAJOR_PROF = te._norm(ks_smooth(te.KS_MAJOR_RAW, 1.0))
        te.MINOR_PROF = te._norm(ks_smooth(te.KS_MINOR_RAW, 1.0))
        return "K-S 模板 100% 平滑"
    if exp == "temperley":
        # Temperley 2001 主音模板(温和版,归一化由 _norm 处理)
        te.MAJOR_PROF = te._norm([5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.5, 5.5, 2.0, 3.0, 1.5, 2.0])
        te.MINOR_PROF = te._norm([5.0, 2.0, 3.5, 4.5, 2.0, 3.5, 2.5, 5.5, 2.0, 3.0, 3.5, 3.0])
        return "Temperley 模板替换 K-S"
    if exp == "scale30":
        te.SCALE_BONUS = 0.30
        return "音阶成员权重 0.20→0.30"
    if exp == "scale40":
        te.SCALE_BONUS = 0.40
        return "音阶成员权重 0.20→0.40"
    if exp == "scale50":
        te.SCALE_BONUS = 0.50
        return "音阶成员权重 0.20→0.50"
    if exp == "flat_ks":
        # 完全平坦模板:相关性退化为纯音阶成员
        te.MAJOR_PROF = [1.0] * 12
        te.MINOR_PROF = [1.0] * 12
        return "完全平坦模板(K-S 退化为纯音阶成员)"
    if exp.startswith("fuse"):
        w = {"fuse552520": (0.55, 0.25, 0.20), "fuse651515": (0.65, 0.20, 0.15),
             "fuse702010": (0.70, 0.20, 0.10), "fuse800505": (0.80, 0.05, 0.05),
             "fuse451525": (0.45, 0.15, 0.25), "fuse55405": (0.55, 0.40, 0.05)}[exp]
        te.FUSION_W = w
        return "融合权重 P1/P2/P3 = %.2f/%.2f/%.2f" % w
    if exp == "scale100":
        te.SCALE_BONUS = 1.0
        return "音阶成员权重 0.20→1.00(与K-S相关同量级)"
    if exp == "smooth50_scale100":
        te.MAJOR_PROF = te._norm(ks_smooth(te.KS_MAJOR_RAW, 0.5))
        te.MINOR_PROF = te._norm(ks_smooth(te.KS_MINOR_RAW, 0.5))
        te.SCALE_BONUS = 1.0
        return "K-S 50%平滑 + 音阶成员×1.0"
    if exp == "smooth100_scale100":
        te.MAJOR_PROF = te._norm(ks_smooth(te.KS_MAJOR_RAW, 1.0))
        te.MINOR_PROF = te._norm(ks_smooth(te.KS_MINOR_RAW, 1.0))
        te.SCALE_BONUS = 1.0
        return "K-S 100%平滑 + 音阶成员×1.0"
    if exp == "flat_fuse80":
        te.MAJOR_PROF = [1.0] * 12
        te.MINOR_PROF = [1.0] * 12
        te.FUSION_W = (0.80, 0.05, 0.05)
        return "平坦模板 + 融合 0.80/0.05/0.05(P2P3弱化)"
    if exp == "flat_fuse90":
        te.MAJOR_PROF = [1.0] * 12
        te.MINOR_PROF = [1.0] * 12
        te.FUSION_W = (0.90, 0.05, 0.05)
        return "平坦模板 + 融合 0.90/0.05/0.05"
    if exp == "smooth100_scale150":
        te.MAJOR_PROF = te._norm(ks_smooth(te.KS_MAJOR_RAW, 1.0))
        te.MINOR_PROF = te._norm(ks_smooth(te.KS_MINOR_RAW, 1.0))
        te.SCALE_BONUS = 1.5
        return "K-S 100%平滑 + 音阶成员×1.5"
    if exp.startswith("p3gate"):
        gate = {"p3gate15": 1.5, "p3gate20": 2.0, "p3gate25": 2.5}[exp]

        def _tend(notes, g=gate):
            tend = [0.0] * 12
            pairs = 0
            for i in range(1, len(notes)):
                iv = int(round(notes[i]["midi"])) - int(round(notes[i - 1]["midi"]))
                pairs += 1
                src_dur = max(0.05, notes[i - 1].get("dur", 0.25))
                dst_dur = max(0.05, notes[i].get("dur", 0.25))
                if dst_dur < src_dur * g:
                    continue
                if iv == 1:
                    tend[te._pc(notes[i]["midi"])] += 0.3
                elif iv == -7:
                    tend[te._pc(notes[i]["midi"])] += 0.2
                elif iv == 5:
                    tend[te._pc(notes[i]["midi"])] += 0.15
            norm = max(0.3, pairs * 0.3)
            return [min(1.0, t / norm) for t in tend]
        te.tendency_scores = _tend
        return "P3 序列倾向时长门回滚到 %.1f×" % gate
    if exp == "p3weight10":
        te.FUSION_W = (0.50, 0.30, 0.10)
        return "融合权重 0.50/0.30/0.10(P3 降权)"
    if exp == "p2weight15":
        te.FUSION_W = (0.50, 0.15, 0.25)
        return "融合权重 0.50/0.15/0.25(P2 降权)"
    if exp == "p2p3down":
        te.FUSION_W = (0.60, 0.15, 0.10)
        return "融合权重 0.60/0.15/0.10(P2P3 双降)"
    raise ValueError("unknown exp: " + exp)

def run(exp):
    desc = patch(exp)
    print(f"实验: {desc}")
    hits = root_hits = 0
    rows = []
    for i in range(12):
        item = SAMPLES[i]
        tr = item["truth"]["root"]
        notes = norm_notes(item["notes"] or [])
        r = te.analyze_tonic(notes)
        ok_r = r["rootPC"] == tr
        ok_a = ok_r and r["mode"] == item["truth"]["mode"]
        hits += ok_a
        root_hits += ok_r
        mem, tshare = content_fit(notes, tr)
        rows.append((i, te.DISPLAY[tr], r["keyName"], ok_r, r["confidence"], mem, tshare))
    for (i, tr, det, ok_r, conf, mem, tshare) in rows:
        print(f"[{i:>2}] {tr:>5} → {det:<12} {'✓' if ok_r else '✗'} conf={conf:>3.0%} 成员={mem:>3.0%} 主音={tshare:>3.0%}")
    print(f"主音命中 {root_hits}/12 | 全对 {hits}/12")

if __name__ == "__main__":
    run(sys.argv[1])
