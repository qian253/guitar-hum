# -*- coding: utf-8 -*-
"""note_cleaner.py — 音符清洗器（v2.18.0）
位于 basic-pitch 转录输出之后、任何调性分析之前，过滤人声哼唱常见脏数据：
  ① 极短音（<100ms）/ 低置信度音（<平均置信度 50%）
  ② 滑音过分割（相邻半音 + 任一 <120ms → 合并）
  ③ 跳跃毛刺（短音 + 两侧大跳 → 删除）

执行顺序说明（与需求文档的列出顺序不同，以自验证样例为准）：
  需求自验证样例 G3(80) #G3(90) A3(300) F3(100) G3(250) B3(400) 预期输出 G3 A3 G3 B3。
  若先执行「剔除极短音」，80ms 的真实音 G3 会被直接删掉，无法合并恢复——
  因此滑音合并必须先于极短音剔除，随后再做毛刺删除。顺序为：②合并 → ①剔除 → ③毛刺。

两处对需求文档的明确补充（均已用注释标出）：
  a. 合并取音高：两音时值接近（差 ≤20ms，样例 80/90ms 即此情况）时保留前一个音
     （滑音起点为真实音，中间过渡半音是过分割产物）；时值差明显时仍取更长者。
  b. 毛刺判据：需求「与前后的音程差都 ≥ 小三度」无法剔除样例 F3（F3→G3 仅 2 半音），
     补一条：短音与任一侧音程 ≥3 半音，且前后两音之间音程 ≤2（旋律线平滑、中间音
     为瞬时偏离）也判毛刺。两条判据取或。

清洗报告不阻塞流程：clean_notes 是纯函数，报告以数据形式随 /transcribe 响应返回，
仅供调试；前端忽略该字段即可。
"""
from __future__ import annotations

import copy

# ---- 可调参数（后续按真实录音数据标定）----
MIN_DUR = 0.100        # 规则1：极短音阈值（秒）
CONF_FRAC = 0.5        # 规则1：置信度低于平均值的该比例 → 剔除
GLISS_MAX_DUR = 0.120  # 规则2：滑音合并触发阈值（任一音时值小于此值）
SPIKE_MAX_DUR = 0.150  # 规则3：毛刺音最大时值
MERGE_TIE_DUR = 0.020  # 规则2 补充：两音时值差 ≤ 此值视为接近，保留前一个音
MINOR_THIRD = 3        # 规则3：小三度（半音数）
SMOOTH_NEIGHBOR = 2    # 规则3 补充：前后两音之间音程 ≤ 此值视为旋律线平滑

DEFAULT_PARAMS = {
    "min_dur": MIN_DUR,
    "conf_frac": CONF_FRAC,
    "gliss_max_dur": GLISS_MAX_DUR,
    "spike_max_dur": SPIKE_MAX_DUR,
    "merge_tie_dur": MERGE_TIE_DUR,
    "minor_third": MINOR_THIRD,
    "smooth_neighbor": SMOOTH_NEIGHBOR,
}


def _midi_name(midi):
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return names[int(round(midi)) % 12] + str(int(round(midi)) // 12 - 1)


def _copy_note(n):
    return {k: v for k, v in n.items() if k != "pitch_bends"} | (
        {"pitch_bends": list(n["pitch_bends"])} if n.get("pitch_bends") else {}
    )


def _dur(n):
    return max(0.0, n.get("dur", 0.0) or (n.get("end", 0.0) - n.get("start", 0.0)))


def _conf(n):
    """音符置信度：优先 confidence 字段；basic-pitch 无逐音置信度，退回 amplitude 作代理。"""
    if n.get("confidence") is not None:
        return float(n["confidence"])
    return float(n.get("amplitude", 0.0))


# ---- 规则2：滑音合并 ----
def _merge_gliss(notes, p, report):
    out = []
    i = 0
    while i < len(notes):
        a = notes[i]
        if i + 1 < len(notes):
            b = notes[i + 1]
            da, db = _dur(a), _dur(b)
            if abs(int(round(a["midi"])) - int(round(b["midi"]))) == 1 and (
                da < p["gliss_max_dur"] or db < p["gliss_max_dur"]
            ):
                # 合并音高：时值更长者；接近（≤20ms）时保留前一个音（滑音起点）
                if db - da > p["merge_tie_dur"]:
                    keep, drop = b, a
                elif da - db > p["merge_tie_dur"]:
                    keep, drop = a, b
                else:
                    keep, drop = a, b
                merged = _copy_note(keep)
                merged["start"] = min(a.get("start", 0.0), b.get("start", 0.0))
                merged["dur"] = round(da + db, 3)
                merged["end"] = round(merged["start"] + merged["dur"], 3)
                merged["amplitude"] = max(a.get("amplitude", 0.0), b.get("amplitude", 0.0))
                if "confidence" in keep:
                    merged["confidence"] = keep["confidence"]
                if drop.get("pitch_bends"):
                    merged.setdefault("pitch_bends", list(drop["pitch_bends"]))
                report["removed"].append({
                    "midi": int(round(drop["midi"])),
                    "dur": round(_dur(drop), 3),
                    "reason": "滑音过分割：%s+%s 半音相邻且含短音 → 合并为 %s(%ss)" % (
                        _midi_name(a["midi"]), _midi_name(b["midi"]),
                        _midi_name(merged["midi"]), round(merged["dur"], 2)),
                })
                out.append(merged)
                i += 2
                continue
        out.append(a)
        i += 1
    return out


# ---- 规则1：剔除极短音 / 低置信度音 ----
def _drop_short_lowconf(notes, p, report):
    confs = [_conf(n) for n in notes]
    mean_conf = (sum(confs) / len(confs)) if confs else 0.0
    conf_thresh = mean_conf * p["conf_frac"]
    out = []
    for n in notes:
        d = _dur(n)
        if d < p["min_dur"]:
            report["removed"].append({
                "midi": int(round(n["midi"])), "dur": round(d, 3),
                "reason": "极短音：时值 %ss < %ss" % (round(d, 3), p["min_dur"]),
            })
            continue
        c = _conf(n)
        # 仅当音符确实携带置信度/振幅信息时才做置信度过滤（防全零振幅误杀）
        if confs and any(x > 0 for x in confs) and c < conf_thresh:
            report["removed"].append({
                "midi": int(round(n["midi"])), "dur": round(d, 3),
                "reason": "低置信度：%.3f < 平均值(%.3f)的 %d%%" % (c, mean_conf, int(p["conf_frac"] * 100)),
            })
            continue
        out.append(n)
    return out


# ---- 规则3：跳跃毛刺删除 ----
def _drop_spikes(notes, p, report):
    out = list(notes)
    changed = True
    guard = 0
    while changed and len(out) >= 3 and guard < len(notes):
        changed = False
        guard += 1
        for i in range(1, len(out) - 1):
            prev_m, mid_m, next_m = (int(round(x["midi"])) for x in out[i - 1:i + 2])
            d = _dur(out[i])
            if d >= p["spike_max_dur"]:
                continue
            d_prev, d_next = abs(mid_m - prev_m), abs(next_m - mid_m)
            # 判据A（需求原文）：与前后音程都 ≥ 小三度
            both_big = d_prev >= p["minor_third"] and d_next >= p["minor_third"]
            # 判据B（补充）：一侧 ≥ 小三度，且前后两音平滑（≤2 半音）——中间音为瞬时偏离
            one_big_smooth = max(d_prev, d_next) >= p["minor_third"] and abs(next_m - prev_m) <= p["smooth_neighbor"]
            if both_big or one_big_smooth:
                report["removed"].append({
                    "midi": mid_m, "dur": round(d, 3),
                    "reason": "跳跃毛刺：%s→%s→%s（%s）" % (
                        _midi_name(prev_m), _midi_name(mid_m), _midi_name(next_m),
                        "两侧均≥小三度" if both_big else "一侧≥3半音且前后平滑"),
                })
                out.pop(i)
                changed = True
                break  # 重头扫描，避免索引失效
    return out


def clean_notes(notes, params=None):
    """清洗音符序列。返回 (cleaned, report)。
    cleaned 与输入同结构（dict 列表）；report 含原始序列/剔除明细/参数。"""
    p = dict(DEFAULT_PARAMS)
    if params:
        p.update(params)

    # 邻接规则（滑音合并/毛刺）依赖时间顺序；basic-pitch 返回顺序不保证（实测有过逆序），先按 start 排序
    notes = sorted(notes, key=lambda n: n.get("start", 0.0))
    raw = [dict(n) for n in notes]
    report = {
        "raw": raw,
        "raw_count": len(raw),
        "removed": [],
        "params": p,
    }
    # 执行顺序：②滑音合并 → ①极短/低置信 → ③毛刺（见模块 docstring）
    seq = _merge_gliss(notes, p, report)
    seq = _drop_short_lowconf(seq, p, report)
    seq = _drop_spikes(seq, p, report)
    report["cleaned"] = [dict(n) for n in seq]
    report["cleaned_count"] = len(seq)
    return seq, report
