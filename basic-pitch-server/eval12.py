# -*- coding: utf-8 -*-
"""eval12.py — 12 条真实人声测试集评估台
用法: python eval12.py            # 总览+逐条
      python eval12.py <样本号>    # 单条详情
每次改引擎后跑一遍,准确率下降即回滚。
"""
import json
import sys
import tonic_engine as te

DATA = json.load(open("C:/Users/keyou/Downloads/哼唱标注数据.json", encoding="utf-8"))
# v2 测试集(2026-08-17 小星星模板录制):同调多录取最后一录
# 第一次:20:40~21:00(B A# A G# G F# F E D# D C# C);21:26~21:36 重录 A/E/G#/F#/D# 五个调
_PICKS = [40, 41, 62, 65, 50, 66, 52, 64, 67, 58, 60, 61]
SAMPLES = [DATA[i] for i in _PICKS]
# v1 旧测试集(17:22~17:34 自由即兴,内容多与标签不符,作压力集):
OLD_PICKS = list(range(16, 28))
SAMPLES_V1 = [DATA[i] for i in OLD_PICKS]

def norm_notes(raw):
    out = []
    for n in raw:
        m = n.get("m", n.get("midi"))
        if m is None:
            continue
        nn = {"midi": m, "start": n.get("s", n.get("start", 0.0)), "dur": n.get("d", n.get("dur", 0.25))}
        if n.get("amp") is not None or n.get("amplitude") is not None:
            nn["amplitude"] = n.get("amplitude", n.get("amp"))
        out.append(nn)
    return out

def content_fit(notes, root):
    """标注音阶成员时长占比 + 主音占比(诊断用,不是引擎输入)"""
    MAJ = [0, 2, 4, 5, 7, 9, 11]
    h = [0.0] * 12
    tot = 0.0
    for n in notes:
        w = max(0.05, n.get("dur", 0.25))
        h[int(round(n["midi"])) % 12] += w
        tot += w
    if tot <= 0:
        return 0.0, 0.0
    mem = sum(h[(root + s) % 12] for s in MAJ) / tot
    return mem, h[root] / tot

def eval_all():
    hits = root_hits = 0
    print(f"{'#':>3} {'标注':>5} {'检测':<12} {'主音':>4} {'conf':>5} {'成员占比':>7} {'主音占比':>7}")
    for i in range(len(SAMPLES)):
        item = SAMPLES[i]
        tr = item["truth"]["root"]
        notes = norm_notes(item["notes"] or [])
        r = te.analyze_tonic(notes)
        ok_r = r["rootPC"] == tr
        ok_a = ok_r and r["mode"] == item["truth"]["mode"]
        hits += ok_a
        root_hits += ok_r
        mem, tshare = content_fit(notes, tr)
        print(f"[{i:>2}] {te.DISPLAY[tr]:>5} {r['keyName']:<12} {'✓' if ok_r else '✗':>4} {r['confidence']:>5.0%} {mem:>7.0%} {tshare:>7.0%}")
    print("-" * 60)
    print(f"主音命中 {root_hits}/{len(SAMPLES)} = {root_hits/len(SAMPLES):.1%} | 全对 {hits}/{len(SAMPLES)} = {hits/len(SAMPLES):.1%}")
    return hits, root_hits

def eval_one(idx):
    item = SAMPLES[idx]
    tr = item["truth"]["root"]
    notes = norm_notes(item["notes"] or [])
    r = te.analyze_tonic(notes)
    rep = r["report"]
    mem, tshare = content_fit(notes, tr)
    print(f"样本[{idx}] 标注 {te.DISPLAY[tr]}大调 | 检测 {r['keyName']} conf={r['confidence']:.0%} | 内容成员 {mem:.0%} 主音 {tshare:.0%}")
    print("root_scores:", " ".join(f"{s['name']}={s['score']:+.2f}" for s in rep["root_scores"]))
    p = rep["pillars"]
    print("P1:", " ".join(f"{te.SPELL[i]}={p['p1_statistic'][te.SPELL[i]]:.2f}" for i in range(12)))
    print("P2:", " ".join(f"{te.SPELL[i]}={p['p2_triad'][te.SPELL[i]]:.2f}" for i in range(12)))
    print("P3:", " ".join(f"{te.SPELL[i]}={p['p3_tendency'][te.SPELL[i]]:.2f}" for i in range(12)))
    print("融合:", " ".join(f"{te.SPELL[i]}={p['fused'][te.SPELL[i]]:.2f}" for i in range(12)))
    for e in rep["evidence"]:
        print("  ·", e)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        eval_one(int(sys.argv[1]))
    else:
        eval_all()
