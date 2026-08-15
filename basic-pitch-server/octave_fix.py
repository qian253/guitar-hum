# -*- coding: utf-8 -*-
"""octave_fix.py — 八度误差修正（v2.19.0 模块2）
basic-pitch 在强泛音/轻音量的人声上偶尔会把个别音锁到 ±1 个八度（如 B3→B4）。
修正策略（保守、基于相邻音连续性，只修「孤立八度跳变」）：
  对每个音，取前后相邻音为参照：
    - 相邻音彼此接近（|prev-next| ≤ 6 半音，旋律线平滑）；
    - 且该音与两者的距离都在 [11,13] 半音（几乎整八度错位）；
    - 则按 ±12 半音折回，使它与相邻音的最近距离 ≤ 3 半音。
  前后邻缺失（首/尾音）或音符 <3 个时不修。
输出：修正后的音符列表 + 修正报告（原音高/新音高/依据），报告随响应返回仅调试用。
"""
from __future__ import annotations


def _midi_name(midi):
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return names[int(round(midi)) % 12] + str(int(round(midi)) // 12 - 1)


def fix_octave_errors(notes, max_neighbor_gap=6):
    """notes: [{midi, start, dur, ...}]（已按时间排序）→ (fixed, report)
    判定：该音与前后邻的「当前最大距离」> 6 半音，且按 ±12 折八度后
    与两邻的最大距离 ≤ 4 半音 → 视为孤立八度跳变，折回。
    首/尾音或音符 <3 个时不修；正常大跳（折回后仍不贴邻）不误修。"""
    report = {"fixed": [], "note": "孤立八度跳变修正（当前距邻>6半音 且 折八度后距两邻≤4半音）"}
    if not notes or len(notes) < 3:
        return list(notes), report

    fixed = [dict(n) for n in notes]
    for i in range(1, len(fixed) - 1):
        prev_m = int(round(fixed[i - 1]["midi"]))
        mid_m = int(round(fixed[i]["midi"]))
        next_m = int(round(fixed[i + 1]["midi"]))
        if abs(next_m - prev_m) > max_neighbor_gap:
            continue  # 邻音本身不连续，参照不可信
        cur_dmax = max(abs(mid_m - prev_m), abs(next_m - mid_m))
        if cur_dmax <= 6:
            continue  # 当前与邻音贴合，不动
        best_m, best_dmax = mid_m, cur_dmax
        for fold in (mid_m - 12, mid_m + 12):
            dmax = max(abs(fold - prev_m), abs(next_m - fold))
            if dmax < best_dmax:
                best_dmax, best_m = dmax, fold
        if best_m != mid_m and best_dmax <= 4:
            report["fixed"].append({
                "index": i,
                "from": "%s(%d)" % (_midi_name(mid_m), mid_m),
                "to": "%s(%d)" % (_midi_name(best_m), best_m),
                "reason": "孤立八度跳变：邻音 %s→%s 平滑，本音距邻最大 %d 半音，折回后最大 %d" % (
                    _midi_name(prev_m), _midi_name(next_m), cur_dmax, best_dmax),
            })
            fixed[i]["midi"] = best_m
    return fixed, report
