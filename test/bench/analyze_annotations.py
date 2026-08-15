# -*- coding: utf-8 -*-
"""analyze_annotations.py — 解剖 13 首真实哼唱标注：各证据模块的单独表现
输出：每首的 真实主音 / 重心音 / 时长最长音级 / 结束音 / Chew候选 / 稳定性候选 / 系统判定
以及各模块单独命中率统计。
v2.17.1 修复：①降号音名（Bb/Eb/Ab/Db）正则漏匹配导致结束音/稳定性命中率虚高
（43% 实为 23%）；②系统判定改取括号里的真实调（谱面模式）。"""
import json
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
NAME_PC = {n: i for i, n in enumerate(NAMES)}
FLAT_TO_PC = {'C': 0, 'Db': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11}


def note_pc(name):
    """从证据链里的音名（如 'C4'、'Bb3'）提取音级（降号/升号统一映射）"""
    m = re.search(r'([A-G](?:#|b)?)', name or '')
    if not m:
        return None
    return FLAT_TO_PC.get(m.group(1))


def parse_evidence(ev):
    info = {}
    m = re.search(r'重心音\s+([A-G](?:#|b)?\d)', ev or '')
    if m:
        info['centroid'] = m.group(1)
    m = re.search(r'时长最长音级\s+([A-G](?:#|b)?)', ev or '')
    if m:
        info['dominant'] = m.group(1)
    m = re.search(r'结束音\s+([A-G](?:#|b)?\d)', ev or '')
    if m:
        info['ending'] = m.group(1)
    m = re.search(r'Chew螺旋：中心效应点最近音级\s+([A-G](?:#|b)?)\s*（置信度\s*([\d.]+)', ev or '')
    if m:
        info['chew'] = (m.group(1), float(m.group(2)))
    m = re.search(r'音级稳定性（模块主音判断\s+([A-G](?:#|b)?)([大小])', ev or '')
    if m:
        info['stability'] = m.group(1) + ('小' if m.group(2) == '小' else '大')
    return info


def main():
    with open('C:/Users/keyou/Downloads/哼唱标注数据.json', encoding='utf-8') as f:
        data = json.load(f)

    print(f'共 {len(data)} 首标注，逐首解剖：')
    print()
    mod_hits = {'centroid': 0, 'dominant': 0, 'ending': 0, 'chew': 0, 'stability': 0, 'system': 0}
    mod_cnt = {'centroid': 0, 'dominant': 0, 'ending': 0, 'chew': 0, 'stability': 0, 'system': 0}

    for i, item in enumerate(data):
        t = item['truth']
        truth_pc = t['root']
        det = item['detected']
        ev = item.get('evidence', '')
        info = parse_evidence(ev)
        jp = item.get('jianpu', '')
        print(f"#{i+1} 真实 {NAMES[truth_pc]}大调 → 检测 {det['keyName']}（{det['confidence']}）")
        print(f"   简谱: {jp}")
        for key, label in [('centroid', '重心音'), ('dominant', '最长音级'), ('ending', '结束音'),
                           ('chew', 'Chew候选'), ('stability', '稳定性候选')]:
            v = info.get(key)
            if v:
                mod_cnt[key] += 1
                if key == 'chew':
                    pc = NAME_PC.get(v[0])
                    print(f"   {label}: {v[0]}（conf {v[1]}）")
                elif key == 'stability':
                    print(f"   {label}: {v}")
                    pc = FLAT_TO_PC.get(v[0])
                else:
                    pc = note_pc(v)
                    print(f"   {label}: {v}")
                if pc == truth_pc:
                    mod_hits[key] += 1
        # 系统判定命中：谱面模式取括号里的真实调（如「C#大调（A#小调）」→ A# 小调）
        keyname = det['keyName']
        m = re.search(r'（(.+?)）', keyname)
        real = m.group(1) if m else keyname
        m2 = re.match(r'([A-G]#?)\s*[大小]', real)
        if m2:
            mod_cnt['system'] += 1
            if NAME_PC.get(m2.group(1)) == truth_pc:
                mod_hits['system'] += 1
        print()

    print('=' * 56)
    print('各模块单独命中率（对主音）：')
    labels = {'centroid': '重心音', 'dominant': '时长最长音级', 'ending': '结束音',
              'chew': 'Chew螺旋', 'stability': '音级稳定性', 'system': '系统最终判定'}
    for key in ['centroid', 'dominant', 'ending', 'chew', 'stability', 'system']:
        n = mod_cnt[key]
        h = mod_hits[key]
        print(f"  {labels[key]:<10} {h}/{n} = {h/n*100:.0f}%" if n else f"  {labels[key]:<10} 无数据")
    print()
    print('注：更深度的分析（内容可靠性/权重搜索）见 test/bench/analyze_next.js')


if __name__ == '__main__':
    main()
