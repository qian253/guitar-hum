# -*- coding: utf-8 -*-
"""stage1_diagnose.py — 阶段一：数据诊断
加载 哼唱标注数据.json，筛选第 17-28 条（12 个有效样本），
跑原始 tonic_engine.py 获取基线，计算准确率/混淆矩阵/误判模式。
"""
import json
import os
import sys
import re
import math

# 添加 tonic_engine 路径
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "basic-pitch-server"))
import tonic_engine

sys.stdout.reconfigure(encoding='utf-8')

NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
JSON_PATH = r'C:\Users\keyou\Downloads\哼唱标注数据.json'


def load_valid_samples():
    """加载 json，只取第 17-28 条（索引 16-27）"""
    with open(JSON_PATH, encoding='utf-8') as f:
        data = json.load(f)
    # 用户说：只有从第 17 首开始才是正确音频
    valid = data[16:]  # 索引 16 = 第 17 首
    print(f"总标注数: {len(data)}，有效样本(第17首起): {len(valid)}")
    # 检查是否有同调重复（取最后一遍）
    seen = {}
    for i, item in enumerate(valid):
        root = item['truth']['root']
        mode = item['truth']['mode']
        key = (root, mode)
        if key in seen:
            print(f"  ⚠ 同调重复: {NAMES[root]}{mode} 出现在 #{17+seen[key]} 和 #{17+i}，取最后一遍")
        seen[key] = i
    # 去重：同 (root, mode) 取最后一条
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
            'detected_keyName': item['detected']['keyName'],
            'detected_confidence_str': item['detected']['confidence'],
            'jianpu': item.get('jianpu', ''),
            'notes_raw': item['notes'],
            'ts': item.get('ts', 0),
        })
    print(f"去重后样本数: {len(samples)}")
    return samples


def parse_keyname(keyname):
    """解析 keyName 如 'D大调（B小调）' → (primary_root, primary_mode, alt_root, alt_mode)
    primary = 括号外的大调, alt = 括号内的小调（关系调）"""
    # 提取括号外
    m = re.match(r'([A-G]#?)\s*大调', keyname)
    primary_root_str = m.group(1) if m else None
    primary_root = NAMES.index(primary_root_str) if primary_root_str in NAMES else None
    primary_mode = 'major' if primary_root is not None else None
    # 提取括号内
    alt_root = None
    alt_mode = None
    m2 = re.search(r'（([A-G]#?)\s*小调）', keyname)
    if m2:
        alt_root_str = m2.group(1)
        alt_root = NAMES.index(alt_root_str) if alt_root_str in NAMES else None
        alt_mode = 'minor'
    return primary_root, primary_mode, alt_root, alt_mode


def convert_notes(notes_raw):
    """json 的 {m, d, s} → tonic_engine 的 {midi, dur, start, end}"""
    out = []
    for n in notes_raw:
        midi = n['m']
        dur = n['d']
        start = n['s']
        out.append({
            'midi': midi,
            'dur': dur,
            'start': start,
            'end': start + dur,
        })
    return out


def run_engine(notes):
    """跑 tonic_engine.analyze_tonic，返回 (rootPC, mode, confidence)"""
    r = tonic_engine.analyze_tonic(notes)
    if r['rootPC'] is None:
        return (None, None, 0.0)
    return (r['rootPC'], r['mode'], r['confidence'])


def circ_dist(a, b):
    """音级距离（0-6）"""
    d = abs(a - b) % 12
    return d if d <= 6 else 12 - d


def main():
    samples = load_valid_samples()
    print()

    # ---- 跑原始引擎获取基线 ----
    print("=" * 70)
    print("阶段一：数据诊断")
    print("=" * 70)
    print()

    # ---- 解析 json 中的 detected 字段（前端/旧引擎结果）----
    print("【A. json 中 recorded detected 结果】")
    print(f"{'#':>3} {'truth_key':<12} {'detected_keyName':<20} {'conf':>5} {'primary':<10} {'alt':<10} {'match':>5}")
    print("-" * 75)

    exact_hits = 0
    tonic_hits = 0
    rel_hits = 0  # 包括关系调匹配
    error_pairs = []
    all_results = []

    for s in samples:
        truth_root = s['truth_root']
        truth_mode = s['truth_mode']
        p_root, p_mode, a_root, a_mode = parse_keyname(s['detected_keyName'])
        conf_str = s['detected_confidence_str']

        # 精确匹配（root+mode）
        exact = (p_root == truth_root and p_mode == truth_mode)
        # 主音匹配（root only）
        tonic = (p_root == truth_root)
        # 关系调匹配（primary 或 alt 的 root 匹配 truth_root）
        rel = tonic or (a_root is not None and a_root == truth_root)

        if exact:
            exact_hits += 1
        if tonic:
            tonic_hits += 1
        if rel:
            rel_hits += 1

        if not exact:
            error_pairs.append((truth_root, p_root, s['song_id']))

        p_str = f"{NAMES[p_root]} {p_mode}" if p_root is not None else "?"
        a_str = f"{NAMES[a_root]} {a_mode}" if a_root is not None else "-"
        match_str = "✓" if exact else ("~" if rel else "✗")

        print(f"{s['song_id']:>3} {s['truth_key']:<12} {s['detected_keyName']:<20} {conf_str:>5} {p_str:<10} {a_str:<10} {match_str:>5}")

        all_results.append({
            'song_id': s['song_id'],
            'truth_root': truth_root,
            'truth_mode': truth_mode,
            'truth_key': s['truth_key'],
            'detected_keyName': s['detected_keyName'],
            'detected_primary_root': p_root,
            'detected_primary_mode': p_mode,
            'detected_alt_root': a_root,
            'detected_alt_mode': a_mode,
            'detected_confidence_str': conf_str,
            'exact_match': exact,
            'tonic_match': tonic,
            'relative_match': rel,
        })

    n = len(samples)
    print()
    print(f"精确匹配 (root+mode): {exact_hits}/{n} = {exact_hits/n*100:.1f}%")
    print(f"主音匹配 (root only): {tonic_hits}/{n} = {tonic_hits/n*100:.1f}%")
    print(f"关系调匹配 (含括号内 alt): {rel_hits}/{n} = {rel_hits/n*100:.1f}%")
    # 大调/小调准确率
    major_samples = [r for r in all_results if r['truth_mode'] == 'major']
    minor_samples = [r for r in all_results if r['truth_mode'] == 'minor']
    major_exact = sum(1 for r in major_samples if r['exact_match'])
    minor_exact = sum(1 for r in minor_samples if r['exact_match'])
    if major_samples:
        print(f"大调准确率: {major_exact}/{len(major_samples)} = {major_exact/len(major_samples)*100:.1f}%")
    if minor_samples:
        print(f"小调准确率: {minor_exact}/{len(minor_samples)} = {minor_exact/len(minor_samples)*100:.1f}%")
    else:
        print(f"小调准确率: N/A (无小调样本)")

    # ---- B. 跑原始 tonic_engine.py 获取基线 ----
    print()
    print("【B. 原始 tonic_engine.py 重跑基线】")
    print(f"{'#':>3} {'truth_key':<12} {'engine_root':<6} {'engine_mode':<8} {'engine_key':<12} {'conf':>6} {'match':>5}")
    print("-" * 65)

    engine_exact = 0
    engine_tonic = 0
    engine_rel = 0
    engine_results = []

    for s in samples:
        notes = convert_notes(s['notes_raw'])
        e_root, e_mode, e_conf = run_engine(notes)
        truth_root = s['truth_root']
        truth_mode = s['truth_mode']

        exact = (e_root == truth_root and e_mode == truth_mode)
        tonic = (e_root == truth_root)
        # 引擎的 top2 包含关系调
        rel = tonic  # 引擎只返回 primary，关系调在 top2 里

        if exact:
            engine_exact += 1
        if tonic:
            engine_tonic += 1

        e_key = f"{NAMES[e_root]} {e_mode}" if e_root is not None else "?"
        match_str = "✓" if exact else ("~" if tonic else "✗")
        print(f"{s['song_id']:>3} {s['truth_key']:<12} {NAMES[e_root]:<6} {e_mode:<8} {e_key:<12} {e_conf:>6.3f} {match_str:>5}")

        engine_results.append({
            'song_id': s['song_id'],
            'truth_root': truth_root,
            'truth_mode': truth_mode,
            'engine_root': e_root,
            'engine_mode': e_mode,
            'engine_confidence': e_conf,
            'exact_match': exact,
            'tonic_match': tonic,
        })

    print()
    print(f"引擎精确匹配: {engine_exact}/{n} = {engine_exact/n*100:.1f}%")
    print(f"引擎主音匹配: {engine_tonic}/{n} = {engine_tonic/n*100:.1f}%")
    major_engine = sum(1 for r in engine_results if r['truth_mode'] == 'major' and r['exact_match'])
    print(f"引擎大调准确率: {major_engine}/{n} = {major_engine/n*100:.1f}%")
    print(f"引擎小调准确率: N/A (无小调样本)")

    # ---- C. 混淆矩阵 + Top 5 误判对 ----
    print()
    print("【C. 混淆矩阵（引擎基线，truth → predicted）】")
    confusion = {}
    for r in engine_results:
        truth_key = f"{NAMES[r['truth_root']]} {r['truth_mode']}"
        pred_key = f"{NAMES[r['engine_root']]} {r['engine_mode']}" if r['engine_root'] is not None else "?"
        pair = (truth_key, pred_key)
        confusion[pair] = confusion.get(pair, 0) + 1

    errors = {k: v for k, v in confusion.items() if k[0] != k[1]}
    sorted_errors = sorted(errors.items(), key=lambda x: -x[1])
    print("误判组合（按频次）:")
    for (t, p), cnt in sorted_errors:
        print(f"  {t:<14} → {p:<14}  {cnt}次")

    # ---- D. 误判模式分析 ----
    print()
    print("【D. 误判模式分析】")

    rel_major_minor = 0  # 关系大小调互判
    same_tonic = 0       # 同主音大小调互判
    fifth_circle = 0     # 五度圈相邻调互判
    semitone_shift = 0   # 半音/全音偏移
    other = 0

    for r in engine_results:
        if r['exact_match']:
            continue
        tr = r['truth_root']
        pr = r['engine_root']
        tm = r['truth_mode']
        pm = r['engine_mode']
        d = circ_dist(tr, pr)

        if d == 0 and tm != pm:
            same_tonic += 1
            print(f"  #{r['song_id']} 同主音大小调互判: {NAMES[tr]}{tm} → {NAMES[pr]}{pm}")
        elif d == 3 and tm != pm:
            rel_major_minor += 1
            print(f"  #{r['song_id']} 关系大小调互判: {NAMES[tr]}{tm} → {NAMES[pr]}{pm} (距离={d})")
        elif d == 7 or d == 5:
            fifth_circle += 1
            print(f"  #{r['song_id']} 五度圈相邻调互判: {NAMES[tr]}{tm} → {NAMES[pr]}{pm} (距离={d})")
        elif d <= 2:
            semitone_shift += 1
            print(f"  #{r['song_id']} 半音/全音偏移: {NAMES[tr]}{tm} → {NAMES[pr]}{pm} (距离={d})")
        else:
            other += 1
            print(f"  #{r['song_id']} 其他误判: {NAMES[tr]}{tm} → {NAMES[pr]}{pm} (距离={d})")

    print()
    print(f"关系大小调互判: {rel_major_minor}")
    print(f"同主音大小调互判: {same_tonic}")
    print(f"五度圈相邻调互判: {fifth_circle}")
    print(f"半音/全音偏移: {semitone_shift}")
    print(f"其他: {other}")

    # ---- E. 变化音调性分析 ----
    print()
    print("【E. 变化音调性（C#/F#/G# 等）准确率分析】")
    chromatic_roots = [1, 6, 8, 10]  # C#, F#, G#, A#
    nat_roots = [0, 2, 4, 5, 7, 9, 11]  # C, D, E, F, G, A, B
    chr_hits = sum(1 for r in engine_results if r['truth_root'] in chromatic_roots and r['exact_match'])
    chr_total = sum(1 for r in engine_results if r['truth_root'] in chromatic_roots)
    nat_hits = sum(1 for r in engine_results if r['truth_root'] in nat_roots and r['exact_match'])
    nat_total = sum(1 for r in engine_results if r['truth_root'] in nat_roots)
    print(f"变化音调 (C#/F#/G#/A#): {chr_hits}/{chr_total} = {chr_hits/max(1,chr_total)*100:.1f}%")
    print(f"自然音调 (C/D/E/F/G/A/B): {nat_hits}/{nat_total} = {nat_hits/max(1,nat_total)*100:.1f}%")

    # ---- F. 置信度分析 ----
    print()
    print("【F. 置信度分析】")
    correct_confs = [r['engine_confidence'] for r in engine_results if r['exact_match']]
    wrong_confs = [r['engine_confidence'] for r in engine_results if not r['exact_match']]
    if correct_confs:
        print(f"正确样本平均置信度: {sum(correct_confs)/len(correct_confs):.3f}")
    if wrong_confs:
        print(f"错误样本平均置信度: {sum(wrong_confs)/len(wrong_confs):.3f}")
    print("高置信但错误(>0.7):")
    for r in engine_results:
        if not r['exact_match'] and r['engine_confidence'] > 0.7:
            print(f"  #{r['song_id']} {NAMES[r['truth_root']]}{r['truth_mode']} → {NAMES[r['engine_root']]}{r['engine_mode']} conf={r['engine_confidence']:.3f}")

    # ---- 保存基线结果供阶段四对比 ----
    baseline_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baseline_results.json")
    with open(baseline_path, 'w', encoding='utf-8') as f:
        json.dump(engine_results, f, ensure_ascii=False, indent=2)
    print(f"\n基线结果已保存: {baseline_path}")


if __name__ == '__main__':
    main()
