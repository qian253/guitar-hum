# -*- coding: utf-8 -*-
"""诊断台:12 条真实人声测试集(JSON 条目 16~27,全 12 大调)vs tonic_engine
用法: python diag12.py [--full N]   (N=条目序号,输出该条全部细节)
"""
import json
import sys
import tonic_engine as te

DATA = json.load(open("C:/Users/keyou/Downloads/哼唱标注数据.json", encoding="utf-8"))
SAMPLES = DATA[16:28]  # 12 大调全覆盖:B A# A G# G F# F E D# D C# C

DISPLAY = te.DISPLAY

def norm_notes(raw):
    """标注导出的原始音符 {m,d,s} → 引擎输入(统一字段名,缺失 amplitude 不影响)"""
    out = []
    for n in raw:
        m = n.get("m", n.get("midi"))
        d = n.get("d", n.get("dur", 0.25))
        s = n.get("s", n.get("start", 0.0))
        if m is None:
            continue
        nn = {"midi": m, "start": s, "dur": d}
        if n.get("amp") is not None or n.get("amplitude") is not None:
            nn["amplitude"] = n.get("amplitude", n.get("amp"))
        out.append(nn)
    return out

def run(idx):
    item = SAMPLES[idx]
    truth = item["truth"]
    notes = norm_notes(item["notes"])
    r = te.analyze_tonic(notes)
    rep = r["report"]
    return item, notes, r, rep

def summarize():
    print("=" * 100)
    print("12 样本总览: 序号 | 真值 | 检测 | 主音对? | 置信度")
    print("=" * 100)
    hits = 0
    root_hits = 0
    for i in range(12):
        item, notes, r, rep = run(i)
        truth = item["truth"]
        tr = truth["root"]
        ok_root = (r["rootPC"] == tr)
        ok_all = ok_root and r["mode"] == truth["mode"]
        hits += ok_all
        root_hits += ok_root
        dom = rep["dominant"]
        print(f"[{i:2d}] 真 {DISPLAY[tr]:>3}大 | 检 {r['keyName']:<14} | 主音{'✓' if ok_root else '✗'} | conf {r['confidence']:.0%} | "
              f"音数 {len(notes):2d} | 时长最长 {dom['name']:>3}({dom['share']:.0%}) | 结束 {rep['ending']['name']}")
    print("=" * 100)
    print(f"主音命中 {root_hits}/12 = {root_hits/12:.1%} | 全对 {hits}/12 = {hits/12:.1%}")

def full(idx):
    item, notes, r, rep = run(idx)
    truth = item["truth"]
    print("=" * 110)
    print(f"样本[{idx}] 真值 {DISPLAY[truth['root']]}大调 | 检测 {r['keyName']} conf {r['confidence']:.0%}")
    print("=" * 110)
    print("音符序列:", [(te.SPELL[te._pc(n['midi'])], round(n['dur'], 2)) for n in notes])
    print(f"重心音: {rep['centroid']['name']} | 时长最长: {rep['dominant']['name']} {rep['dominant']['share']:.0%} | 结束音: {rep['ending']['name']}")
    print(f"直方图: " + " ".join(f"{te.SPELL[i]}={rep['hist'][te.SPELL[i]]:.0f}" for i in range(12)))
    print(f"root_scores(排序):")
    for s in rep["root_scores"]:
        mark = " ←真值" if s["root"] == truth["root"] else ""
        print(f"  {s['name']:>3} score={s['score']:+.3f} (maj={s['major']:+.3f} min={s['minor']:+.3f}){mark}")
    p = rep["pillars"]
    print(f"P1统计: " + " ".join(f"{te.SPELL[i]}={p['p1_statistic'][te.SPELL[i]]:.2f}" for i in range(12)))
    print(f"P2三和弦: " + " ".join(f"{te.SPELL[i]}={p['p2_triad'][te.SPELL[i]]:.2f}" for i in range(12)))
    print(f"P3倾向: " + " ".join(f"{te.SPELL[i]}={p['p3_tendency'][te.SPELL[i]]:.2f}" for i in range(12)))
    print(f"融合: " + " ".join(f"{te.SPELL[i]}={p['fused'][te.SPELL[i]]:.2f}" for i in range(12)))
    for e in rep["evidence"]:
        print("  ·", e)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--full":
        full(int(sys.argv[2]))
    else:
        summarize()
