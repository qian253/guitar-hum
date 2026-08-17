# -*- coding: utf-8 -*-
"""debug_scores.py — 调试 #22(F# major)的内部得分"""
import json, sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "basic-pitch-server"))
import tonic_engine as te
sys.stdout.reconfigure(encoding='utf-8')

NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

with open(r'C:\Users\keyou\Downloads\哼唱标注数据.json', encoding='utf-8') as f:
    data = json.load(f)

# #22 = index 21 (第22首, 索引从0开始=22-1=21, 但有效从第17首开始=索引16, #22=索引16+5=21)
# 实际上 #22 在valid数组中是第6个 (17,18,19,20,21,22)
item = data[23]  # #24 E major (valid idx 7, data idx 16+7=23)
truth_root = item['truth']['root']  # 4 = E
print(f"Truth: {NAMES[truth_root]} major (root={truth_root})")

notes = [{'midi': n['m'], 'dur': n['d'], 'start': n['s'], 'end': n['s'] + n['d']} for n in item['notes']]
print(f"Notes: {len(notes)}")
print(f"MIDI range: {min(n['midi'] for n in notes):.1f} - {max(n['midi'] for n in notes):.1f}")

# Build histogram
hist = te._build_hist(notes)
print(f"\nHistogram:")
for i in range(12):
    bar = '█' * int(hist[i] * 100)
    print(f"  {NAMES[i]:>2}: {hist[i]:.4f} {bar}")

# pc_dur
pc_dur = [0.0] * 12
for x in notes:
    pc_dur[te._pc(x['midi'])] += max(0.05, x.get('dur', 0.25))
print(f"\nPC Duration:")
for i in range(12):
    bar = '█' * int(pc_dur[i] * 10)
    print(f"  {NAMES[i]:>2}: {pc_dur[i]:.3f} {bar}")

# K-S correlation for each root
print(f"\nK-S Correlation scores:")
print(f"{'Root':>5} {'Major':>8} {'Minor':>8} {'Max':>8} {'ScaleMaj':>8} {'ScaleMin':>8}")
for root in range(12):
    maj_corr = te._corr(hist, te._shift(te.MAJOR_PROF, root))
    min_corr = te._corr(hist, te._shift(te.MINOR_PROF, root))
    scale_maj = te._scale_membership(hist, root, 'major')
    scale_min = te._scale_membership(hist, root, 'minor')
    flag = ' ← TRUTH' if root == truth_root else ''
    flag += ' ← PRED' if root == 1 else ''  # C# was predicted
    print(f"{NAMES[root]:>5} {maj_corr:>8.4f} {min_corr:>8.4f} {max(maj_corr,min_corr):>8.4f} {scale_maj:>8.4f} {scale_min:>8.4f}{flag}")

# Run full engine
r = te.analyze_tonic(notes)
print(f"\nEngine result: root={NAMES[r['rootPC']]}, mode={r['mode']}, conf={r['confidence']:.3f}")
print(f"Top2: {r['top2']}")

# Show P1/P2/P3 details
report = r['report']
print(f"\nP1 (statistic) top 4:")
p1 = report['pillars']['p1_statistic']
for name, val in sorted(p1.items(), key=lambda x: -x[1])[:4]:
    print(f"  {name}: {val:.3f}")
print(f"\nP2 (triad) top 4:")
p2 = report['pillars']['p2_triad']
for name, val in sorted(p2.items(), key=lambda x: -x[1])[:4]:
    print(f"  {name}: {val:.3f}")
print(f"\nP3 (tendency) top 4:")
p3 = report['pillars']['p3_tendency']
for name, val in sorted(p3.items(), key=lambda x: -x[1])[:4]:
    print(f"  {name}: {val:.3f}")
print(f"\nFused top 4:")
fused = report['pillars']['fused']
for name, val in sorted(fused.items(), key=lambda x: -x[1])[:4]:
    print(f"  {name}: {val:.3f}")

# Root scores with co-occurrence
print(f"\nRoot scores (with co-occurrence bonus):")
for rs in report['root_scores'][:6]:
    print(f"  {rs['name']:>2}: major={rs['major']:.3f} minor={rs['minor']:.3f} score={rs['score']:.3f}")

# Ending note
print(f"\nEnding note: {report['ending']['name']} (pc={report['ending']['pc']}, dur={report['ending']['dur']:.2f})")
print(f"Centroid: {report['centroid']['name']} (pc={report['centroid']['pc']}, midi={report['centroid']['midi']:.1f})")
print(f"Dominant: {report['dominant']['name']} (pc={report['dominant']['pc']}, share={report['dominant']['share']:.3f})")

# decide_mode for truth_root
md = te.decide_mode(notes, truth_root, hist)
print(f"\ndecide_mode (root={NAMES[truth_root]}):")
print(f"  major_third(G)={md['major_third']:.4f} minor_third(G)={md['minor_third']:.4f}")
print(f"  major_triad={md['major_triad']:.4f} minor_triad={md['minor_triad']:.4f}")
print(f"  leading={md['leading']}")
print(f"  major_e={md['major_e']:.4f} minor_e={md['minor_e']:.4f}")
print(f"  ks_maj={md.get('ks_maj',-1):.4f} ks_min={md.get('ks_min',-1):.4f}")
print(f"  mode={md['mode']} (rule: minor if minor_e > major_e*1.5; KS reverse if ks_maj > ks_min+0.15)")

# ---- 全 12 样本 P3 触发诊断 ----
print("\n" + "=" * 70)
print("全 12 样本 P3 (tendency) 触发诊断")
print("=" * 70)
valid = data[16:]
deduped = {}
for i, it in enumerate(valid):
    deduped.setdefault((it['truth']['root'], it['truth']['mode']), (i, it))
samples = sorted(deduped.values(), key=lambda x: x[0])
print(f"{'#':>3} {'truth':<8} {'pairs':>5} {'hit':>4} {'P3max':>6} {'argmax':<6} {'iv_patterns':<30}")
total_hit = 0
total_pairs = 0
for i, it in samples:
    sid = 17 + i
    truth = NAMES[it['truth']['root']] + " " + it['truth']['mode']
    notes = [{'midi': n['m'], 'dur': n['d'], 'start': n['s'], 'end': n['s'] + n['d']} for n in it['notes']]
    tend = [0.0] * 12
    pairs = 0
    hit = 0
    iv_seen = {}
    for j in range(1, len(notes)):
        iv = int(round(notes[j]['midi'])) - int(round(notes[j - 1]['midi']))
        pairs += 1
        src_dur = max(0.05, notes[j - 1].get('dur', 0.25))
        dst_dur = max(0.05, notes[j].get('dur', 0.25))
        gated = dst_dur >= src_dur * 1.5
        # 检查是否是 P3 关心的音程
        cared = iv in (1, -7, 5)
        if cared:
            key = f"iv={iv},gate={'Y' if gated else 'N'}"
            iv_seen[key] = iv_seen.get(key, 0) + 1
        if gated and cared:
            tend[te._pc(notes[j]['midi'])] += {1: 0.3, -7: 0.2, 5: 0.15}[iv]
            hit += 1
    total_hit += hit
    total_pairs += pairs
    mx = max(tend)
    argmax = NAMES[tend.index(mx)] if mx > 0 else '-'
    iv_str = ', '.join(f'{k}={v}' for k, v in sorted(iv_seen.items())) or 'none'
    print(f"{sid:>3} {truth:<8} {pairs:>5} {hit:>4} {mx:>6.3f} {argmax:<6} {iv_str}")
print(f"\n总计: pairs={total_pairs}, P3命中配对={total_hit}, 命中率={total_hit/max(1,total_pairs)*100:.1f}%")
