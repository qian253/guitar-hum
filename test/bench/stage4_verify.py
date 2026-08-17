# -*- coding: utf-8 -*-
"""stage4_verify.py — 阶段四：自测验证
跑修改后的 tonic_engine.py，与基线对比准确率。
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "basic-pitch-server"))
import tonic_engine

sys.stdout.reconfigure(encoding='utf-8')

NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
JSON_PATH = r'C:\Users\keyou\Downloads\哼唱标注数据.json'
BASELINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baseline_results.json")


def load_valid_samples():
    with open(JSON_PATH, encoding='utf-8') as f:
        data = json.load(f)
    valid = data[16:]
    deduped = {}
    for i, item in enumerate(valid):
        key = (item['truth']['root'], item['truth']['mode'])
        deduped[key] = (i, item)
    samples = []
    for key in sorted(deduped.keys()):
        i, item = deduped[key]
        samples.append({
            'song_id': 17 + i,
            'truth_root': item['truth']['root'],
            'truth_mode': item['truth']['mode'],
            'truth_key': NAMES[item['truth']['root']] + ' ' + item['truth']['mode'],
            'notes_raw': item['notes'],
        })
    return samples


def convert_notes(notes_raw):
    return [{'midi': n['m'], 'dur': n['d'], 'start': n['s'], 'end': n['s'] + n['d']} for n in notes_raw]


def circ_dist(a, b):
    d = abs(a - b) % 12
    return d if d <= 6 else 12 - d


def main():
    samples = load_valid_samples()

    # 加载基线
    with open(BASELINE_PATH, encoding='utf-8') as f:
        baseline = json.load(f)

    # 跑修改后引擎
    new_results = []
    for s in samples:
        notes = convert_notes(s['notes_raw'])
        r = tonic_engine.analyze_tonic(notes)
        e_root = r['rootPC']
        e_mode = r['mode']
        e_conf = r['confidence']
        exact = (e_root == s['truth_root'] and e_mode == s['truth_mode'])
        tonic = (e_root == s['truth_root'])
        new_results.append({
            'song_id': s['song_id'],
            'truth_root': s['truth_root'],
            'truth_mode': s['truth_mode'],
            'engine_root': e_root,
            'engine_mode': e_mode,
            'engine_confidence': e_conf,
            'exact_match': exact,
            'tonic_match': tonic,
        })

    n = len(samples)

    # ---- 对比表 ----
    print("=" * 90)
    print("阶段四：自测验证 — 修改前 vs 修改后")
    print("=" * 90)
    print()
    print(f"{'#':>3} {'truth_key':<12} | {'修改前':>22} {'match':>5} | {'修改后':>22} {'match':>5} | {'变化':>4}")
    print("-" * 90)

    b_exact = 0
    n_exact = 0
    b_tonic = 0
    n_tonic = 0
    improved = []
    regressed = []

    for b, nw in zip(baseline, new_results):
        b_key = f"{NAMES[b['engine_root']]} {b['engine_mode']}" if b['engine_root'] is not None else "?"
        n_key = f"{NAMES[nw['engine_root']]} {nw['engine_mode']}" if nw['engine_root'] is not None else "?"
        b_match = "✓" if b['exact_match'] else ("~" if b['tonic_match'] else "✗")
        n_match = "✓" if nw['exact_match'] else ("~" if nw['tonic_match'] else "✗")

        if b['exact_match']:
            b_exact += 1
        if nw['exact_match']:
            n_exact += 1
        if b['tonic_match']:
            b_tonic += 1
        if nw['tonic_match']:
            n_tonic += 1

        # 变化标记
        if nw['exact_match'] and not b['exact_match']:
            change = "↑好"
            improved.append(nw['song_id'])
        elif not nw['exact_match'] and b['exact_match']:
            change = "↓坏"
            regressed.append(nw['song_id'])
        elif nw['tonic_match'] and not b['tonic_match']:
            change = "↑~"
            improved.append(nw['song_id'])
        elif not nw['tonic_match'] and b['tonic_match']:
            change = "↓~"
            regressed.append(nw['song_id'])
        else:
            change = "-"

        truth_key = f"{NAMES[b['truth_root']]} {b['truth_mode']}"
        print(f"{b['song_id']:>3} {truth_key:<12} | {b_key:>22} {b_match:>5} | {n_key:>22} {n_match:>5} | {change:>4}")

    print()
    print(f"{'指标':<20} {'修改前':>10} {'修改后':>10} {'变化':>10}")
    print("-" * 55)
    print(f"{'整体准确率':<20} {b_exact/n*100:>9.1f}% {n_exact/n*100:>9.1f}% {(n_exact-b_exact)/n*100:>+9.1f}%")
    print(f"{'主音匹配率':<20} {b_tonic/n*100:>9.1f}% {n_tonic/n*100:>9.1f}% {(n_tonic-b_tonic)/n*100:>+9.1f}%")
    # 大调/小调
    b_major = sum(1 for r in baseline if r['truth_mode'] == 'major' and r['exact_match'])
    n_major = sum(1 for r in new_results if r['truth_mode'] == 'major' and r['exact_match'])
    print(f"{'大调准确率':<20} {b_major/n*100:>9.1f}% {n_major/n*100:>9.1f}% {(n_major-b_major)/n*100:>+9.1f}%")
    print(f"{'小调准确率':<20} {'N/A':>10} {'N/A':>10} {'N/A':>10}")

    print()
    if improved:
        print(f"改善样本: {improved}")
    if regressed:
        print(f"退化样本: {regressed}")

    # ---- 混淆矩阵 ----
    print()
    print("【修改后混淆矩阵】")
    errors = []
    for r in new_results:
        if not r['exact_match']:
            truth_key = f"{NAMES[r['truth_root']]} {r['truth_mode']}"
            pred_key = f"{NAMES[r['engine_root']]} {r['engine_mode']}" if r['engine_root'] is not None else "?"
            d = circ_dist(r['truth_root'], r['engine_root']) if r['engine_root'] is not None else -1
            errors.append((r['song_id'], truth_key, pred_key, d))

    from collections import Counter
    pattern_cnt = Counter()
    for sid, tk, pk, d in errors:
        if d == 0:
            pattern_cnt["同主音大小调互判"] += 1
        elif d == 3:
            pattern_cnt["关系大小调(小三度)互判"] += 1
        elif d == 5 or d == 7:
            pattern_cnt["五度圈相邻调互判"] += 1
        elif d <= 2:
            pattern_cnt["半音/全音偏移"] += 1
        else:
            pattern_cnt["其他"] += 1

    print("误判模式统计:")
    for pat, cnt in pattern_cnt.most_common():
        print(f"  {pat}: {cnt}")

    # 判定是否通过
    print()
    if n_exact > b_exact:
        print("✅ 准确率提升，保留修改，进入阶段五")
    elif n_exact == b_exact and n_tonic > b_tonic:
        print("✅ 主音匹配率提升，保留修改，进入阶段五")
    elif n_exact == b_exact and n_tonic == b_tonic:
        print("➖ 准确率持平，尝试下一个修改方向")
    else:
        print("❌ 准确率下降或持平，需要回滚并尝试下一个修改方向")


if __name__ == '__main__':
    main()
