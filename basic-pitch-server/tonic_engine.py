# -*- coding: utf-8 -*-
"""tonic_engine.py — 主音检测引擎（v2.19.0 模块4/5/6）
与前端 key.js 的 detectKey 同构（K-S 相关 + 音阶成员 + 稳定性点积 + 结束音 + 吉他偏好），
并在此基础上完成本轮排查要求：

模块4 升级：
  - 动态权重：按音符数量调整（短旋律加重音阶成员/结束音、减轻稳定性点积；长旋律反之）
  - 转调检测：按时间中点分两段各自定根音，两段根音不同且各自有据 → 标记调制、置信度×0.8
  - Chew 螺旋数组按 partitura 公式实现（P(k)=(sin t, cos t, A·t), t=kπ/2, A=√(2/15)·π/2，
    大调中心=(k,k+1,k+4)/3 五度圈模板），作为证据输出（不计分，与 v2.17.1 定案一致）
模块5 升级：
  - 严格两步：先锁根音（12 根音取大小调较高分），再同根音内定大小调；
    无任何「关系大小调反向修正主音」逻辑（旧后端 detect_key 的该逻辑已移除）
模块6 升级：
  - 和弦验证：对检测出的调做轻量和弦匹配（I ii iii IV V vi vii° / 小调含大三 V），
    首尾落在主和弦 + 主和弦时长占比达标 → 置信度 +0.05；仅验证与诊断，不反向改调

输出：完整诊断报告（原始/清洗后音符、重心、音级直方图、12 根音得分表、Chew、转调、和弦、
置信度构成），随 /transcribe 响应 tonic_report 返回，供离线追踪每个环节。
"""
from __future__ import annotations

import math

# ---------- K-S 探测音谱（与 key.js 一致） ----------
KS_MAJOR_RAW = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
KS_MINOR_RAW = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]
SPELL = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
DISPLAY = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
GUILD = {"major": [0, 7, 2, 9, 4, 5], "minor": [0, 7, 2, 5]}

# ---------- 权重常量（v2.17.1 定案值；动态调整在 analyze_tonic 内进行） ----------
SCALE_BONUS = 0.20
STABILITY_WEIGHT = 0.10
ENDING_BONUS = 0.15
GUITAR_BIAS = 0.02
ENDING_MAX_MULT = 1.5


def _norm(p):
    m = sum(p) / len(p)
    return [v / m for v in p]


MAJOR_PROF = _norm(KS_MAJOR_RAW)
MINOR_PROF = _norm(KS_MINOR_RAW)


def _pc(midi):
    return int(round(midi)) % 12


def _corr(x, y):
    n = len(x)
    sx = sum(x)
    sy = sum(y)
    sxy = sum(a * b for a, b in zip(x, y))
    sxx = sum(a * a for a in x)
    syy = sum(b * b for b in y)
    denom = math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy))
    return 0.0 if abs(denom) < 1e-12 else (n * sxy - sx * sy) / denom


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def _shift(prof, root):
    return [prof[(i - root) % 12] for i in range(12)]


def _scale_membership(hist, root, mode):
    scale = MAJOR_SCALE if mode == "major" else MINOR_SCALE
    return sum(hist[(root + s) % 12] for s in scale)


def _circ_dist(a, b):
    d = abs((a % 12) - (b % 12)) % 12
    return d if d <= 6 else 12 - d


def _midi_name(midi):
    return SPELL[_pc(midi)] + str(int(round(midi)) // 12 - 1)


# ---------- Chew 螺旋数组（partitura 公式；仅作证据输出，不计分） ----------
SPIRAL_A = math.sqrt(2.0 / 15.0) * math.pi / 2


def _pc_fifths(pc):
    return (((7 * pc + 6) % 12) + 12) % 12 - 6


def _pc_from_fifths(k):
    return (((7 * k) % 12) + 12) % 12


def _chew_pos(k):
    t = k * math.pi / 2
    return (math.sin(t), math.cos(t), SPIRAL_A * t)


def _dist3(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def chew_analyze(notes):
    """返回 {tonic: {rootPC, mode}, confidence, keys:[{root,mode,d}], nearest_pc}"""
    if not notes:
        return None
    ws = [max(0.05, n.get("dur", 0.25)) for n in notes]
    wsum = sum(ws)
    reps = {}
    cx = cy = cz = 0.0
    for _rr in range(3):
        cex, cey, cez = cx / wsum, cy / wsum, cz / wsum
        cx = cy = cz = 0.0
        for i, n in enumerate(notes):
            pc = _pc(n["midi"])
            k0 = reps.get(pc, _pc_fifths(pc))
            best_k, best_d = k0, float("inf")
            for kv in (k0 - 12, k0, k0 + 12):
                pv = _chew_pos(kv)
                dv = (pv[0] - cex) ** 2 + (pv[1] - cey) ** 2 + (pv[2] - cez) ** 2
                if dv < best_d:
                    best_d, best_k = dv, kv
            reps[pc] = best_k
            pp = _chew_pos(best_k)
            w = ws[i]
            cx += pp[0] * w
            cy += pp[1] * w
            cz += pp[2] * w
    ce = (cx / wsum, cy / wsum, cz / wsum)
    dists = []
    for pc in range(12):
        dists.append((_dist3(ce, _chew_pos(_pc_fifths(pc))), pc))
    dists.sort()
    keys = []
    for kr in range(-6, 6):
        for mode, tri in (("major", (kr, kr + 1, kr + 4)), ("minor", (kr, kr + 1, kr + 3))):
            kc = tuple(sum(_chew_pos(k)[a] for k in tri) / 3 for a in range(3))
            keys.append({"root": _pc_from_fifths(kr), "mode": mode, "d": _dist3(ce, kc)})
    keys.sort(key=lambda x: x["d"])
    conf = max(0.0, min(1.0, 1 - dists[0][0] / (dists[1][0] or 1.0)))
    return {
        "tonic": {"rootPC": _pc_from_fifths(dists[0][1] and 0 or 0) if False else dists[0][1], "mode": keys[0]["mode"]},
        "confidence": round(conf, 3),
        "nearest_pc": dists[0][1],
        "top_keys": keys[:3],
    }


# ---------- 直方图（与 key.js 同构：log 压缩时长 + 伪计数平滑） ----------
def _build_hist(notes, ending_mult=1.0):
    hist = [0.0] * 12
    total = 0.0
    for i, n in enumerate(notes):
        w = math.log2(1 + max(0.05, n.get("dur", 0.25)))
        if i == len(notes) - 1:
            w *= ending_mult
        hist[_pc(n["midi"])] += w
        total += w
    for i in range(12):
        hist[i] += 0.5
    total += 6.0
    if total <= 0:
        return [1.0 / 12] * 12
    return [h / total for h in hist]


def _amp_weight(n, amp_mean):
    d = max(0.05, n.get("dur", 0.25))
    a = n.get("amplitude", 0.0) or n.get("amp", 0.0) or 0.0
    if not amp_mean or a <= 0:
        return d
    return d * max(0.3, min(2.0, a / amp_mean))


# ---------- 大小调判定（同根音二选一；小调须明显占优 ×1.25） ----------
def decide_mode(notes, root, hist):
    major_third = hist[(root + 4) % 12]
    minor_third = hist[(root + 3) % 12]
    major_triad = hist[root] + hist[(root + 4) % 12] + hist[(root + 7) % 12]
    minor_triad = hist[root] + hist[(root + 3) % 12] + hist[(root + 7) % 12]
    leading = 0
    for i in range(1, len(notes)):
        if _pc(notes[i - 1]["midi"]) == (root + 11) % 12 and _pc(notes[i]["midi"]) == root:
            leading += 1
    major_e = major_third * 2 + (major_triad - minor_triad) * 0.4 + leading * 0.4
    minor_e = minor_third * 2 + (minor_triad - major_triad) * 0.4
    mode = "minor" if minor_e > major_e * 1.25 else "major"
    return {
        "mode": mode, "major_third": major_third, "minor_third": minor_third,
        "major_triad": major_triad, "minor_triad": minor_triad, "leading": leading,
        "major_e": major_e, "minor_e": minor_e,
    }


# ---------- 快速根音（转调检测用：模式无关，K-S 取大 + 音阶成员） ----------
def _quick_root(notes):
    hist = _build_hist(notes)
    best_root, best_s = 0, -1e9
    margin = 0.0
    scores = []
    for root in range(12):
        s = max(_corr(hist, _shift(MAJOR_PROF, root)), _corr(hist, _shift(MINOR_PROF, root))) \
            + SCALE_BONUS * max(_scale_membership(hist, root, "major"), _scale_membership(hist, root, "minor"))
        scores.append(s)
        if s > best_s:
            best_s, best_root = s, root
    top = sorted(scores, reverse=True)
    margin = (top[0] - top[1]) if len(top) > 1 else 0.0
    return best_root, margin


def detect_modulation(notes, min_half_notes=4, min_margin=0.05):
    """按时间中点分两段各自定根音；两段根音不同且各自有据 → 判定疑似转调/离调。"""
    if len(notes) < 2 * min_half_notes:
        return None
    t_mid = (notes[0].get("start", 0.0) + notes[-1].get("end", notes[-1].get("start", 0.0) + notes[-1].get("dur", 0.25))) / 2
    first = [n for n in notes if n.get("start", 0.0) < t_mid]
    second = [n for n in notes if n.get("start", 0.0) >= t_mid]
    if len(first) < min_half_notes or len(second) < min_half_notes:
        return None
    r1, m1 = _quick_root(first)
    r2, m2 = _quick_root(second)
    if r1 != r2 and m1 >= min_margin and m2 >= min_margin:
        return {
            "first_half": {"root": r1, "name": SPELL[r1], "notes": len(first), "margin": round(m1, 3)},
            "second_half": {"root": r2, "name": SPELL[r2], "notes": len(second), "margin": round(m2, 3)},
        }
    return None


# ---------- 和弦验证（模块6：只验证据与加置信度，不反向改调） ----------
_TRIADS = {
    "major": {"I": [0, 4, 7], "ii": [2, 5, 9], "iii": [4, 7, 11], "IV": [5, 9, 0],
              "V": [7, 11, 2], "vi": [9, 0, 4], "vii°": [11, 2, 5]},
    "minor": {"i": [0, 3, 7], "ii°": [2, 5, 8], "III": [3, 7, 10], "iv": [5, 8, 0],
              "V": [7, 11, 2], "VI": [8, 0, 3], "VII": [10, 2, 5]},
}


def harmony_verify(notes, root, mode):
    triads = _TRIADS[mode]
    hits = {name: 0.0 for name in triads}
    labels = []
    for n in notes:
        pc = _pc(n["midi"])
        d = max(0.05, n.get("dur", 0.25))
        best_name, best_cost = None, 1e9
        for name, t in triads.items():
            cost = min(_circ_dist(pc, (root + x) % 12) for x in t)
            if cost < best_cost:
                best_cost, best_name = cost, name
        hits[best_name] += d
        labels.append(best_name)
    total = sum(hits.values()) or 1.0
    i_frac = hits["I" if mode == "major" else "i"] / total
    first_tonic = labels[0] in ("I", "i")
    last_tonic = labels[-1] in ("I", "i")
    confirmed = first_tonic and last_tonic and i_frac >= 0.25
    return {
        "chords": labels,
        "tonic_fraction": round(i_frac, 3),
        "first_tonic": first_tonic,
        "last_tonic": last_tonic,
        "confirmed": confirmed,
    }


# ---------- 主入口 ----------
def analyze_tonic(notes, recording_dur=None):
    """notes: [{midi, dur, start, end, amplitude}]（已按时间排序、已清洗、已八度修正）
    返回扁平结果 + report 诊断。"""
    if not notes or len(notes) < 2:
        return {"rootPC": None, "mode": None, "keyName": None, "confidence": 0.0,
                "evidence": ["音符不足，无法定调"], "top2": [], "report": {"in_count": len(notes)}}

    n = len(notes)
    total_dur = sum(max(0.05, x.get("dur", 0.25)) for x in notes)
    last = notes[-1]
    last_dur = max(0.05, last.get("dur", 0.25))
    trailing_silence = max(0.0, (recording_dur or 0) - (last.get("end") or 0))
    ending_mult = ENDING_MAX_MULT if (last_dur > 0.5 and trailing_silence >= 0.3 and total_dur > 5) else 1.0
    ending_pc = _pc(last["midi"])

    # 重心音（时长×振幅；无振幅退化为纯时长）
    amps = [n.get("amplitude", 0.0) or n.get("amp", 0.0) or 0.0 for n in notes]
    amp_mean = (sum(amps) / max(1, sum(1 for a in amps if a > 0))) if any(amps) else 0.0
    c_num = sum(_amp_weight(x, amp_mean) * x["midi"] for x in notes)
    c_den = sum(_amp_weight(x, amp_mean) for x in notes)
    centroid = c_num / c_den if c_den else last["midi"]
    centroid_pc = _pc(centroid)

    # 时长最长音级
    pc_dur = [0.0] * 12
    for x in notes:
        pc_dur[_pc(x["midi"])] += max(0.05, x.get("dur", 0.25))
    dominant_pc = max(range(12), key=lambda i: pc_dur[i])
    second_top = max(pc_dur[i] for i in range(12) if i != dominant_pc)
    dominance = max(0.0, (pc_dur[dominant_pc] - second_top) / pc_dur[dominant_pc]) if pc_dur[dominant_pc] else 0.0

    hist = _build_hist(notes, ending_mult)

    # 稳定性点积表
    stab = []
    for root in range(12):
        stab.append(max(_dot(hist, _shift(MAJOR_PROF, root)), _dot(hist, _shift(MINOR_PROF, root))))
    stab_min, stab_span = min(stab), (max(stab) - min(stab)) or 1.0
    stab_best = max(range(12), key=lambda i: stab[i])

    # Chew（证据）
    chew = chew_analyze(notes)

    # ---- 动态权重（模块4）：按音符数量调整 ----
    w_scale = SCALE_BONUS + (0.10 if n <= 5 else 0.0) - (0.05 if n >= 14 else 0.0)
    w_stab = STABILITY_WEIGHT * (0.6 if n <= 5 else 1.0)
    w_ending = ENDING_BONUS + (0.05 if n <= 5 else 0.0)
    weights = {"scale": round(w_scale, 3), "stability": round(w_stab, 3),
               "ending": round(w_ending, 3), "guitar": GUITAR_BIAS,
               "n_notes": n, "total_dur": round(total_dur, 2)}

    # ---- 第一步：锁根音（12 根音取大小调较高分；与调式解耦，禁止关系调反向修正） ----
    root_scores = []
    for root in range(12):
        maj = _corr(hist, _shift(MAJOR_PROF, root)) + w_scale * _scale_membership(hist, root, "major")
        mn = _corr(hist, _shift(MINOR_PROF, root)) + w_scale * _scale_membership(hist, root, "minor")
        s = max(maj, mn)
        s += w_stab * ((stab[root] - stab_min) / stab_span)
        if ending_pc == root and last_dur >= 0.5:
            s += w_ending
        if root in GUILD["major"] or root in GUILD["minor"]:
            s += GUITAR_BIAS
        root_scores.append({"root": root, "major": maj, "minor": mn, "score": s})
    ordered = sorted(range(12), key=lambda i: -root_scores[i]["score"])
    best_root = ordered[0]
    second_root = ordered[1]
    margin = root_scores[best_root]["score"] - root_scores[second_root]["score"]

    # ---- 第二步：同根音内定大小调（模块5） ----
    md = decide_mode(notes, best_root, hist)
    mode = md["mode"]

    # ---- 置信度 ----
    confidence = max(0.0, min(1.0, margin / 0.18))
    if total_dur < 3 or n < 5:
        confidence = min(confidence, 0.7)
    if abs(md["major_e"] - md["minor_e"]) < 0.06:
        confidence = min(confidence, 0.6)
    conf_breakdown = {"margin": round(margin, 4), "base": round(max(0.0, min(1.0, margin / 0.18)), 3),
                      "short_cap": total_dur < 3 or n < 5, "mode_fuzzy_cap": abs(md["major_e"] - md["minor_e"]) < 0.06}

    # ---- 转调检测（模块4） ----
    modulation = detect_modulation(notes)
    if modulation:
        confidence = round(confidence * 0.8, 3)

    # ---- 和弦验证（模块6） ----
    harmony = harmony_verify(notes, best_root, mode)
    if harmony["confirmed"]:
        confidence = round(min(1.0, confidence + 0.05), 3)

    key_name = DISPLAY[best_root] + ("小调" if mode == "minor" else "大调")
    rel_root = (best_root + 3) % 12 if mode == "minor" else (best_root + 9) % 12
    rel_mode = "major" if mode == "minor" else "minor"
    top_pct = round(confidence * 100)
    top2 = [
        {"root": best_root, "mode": mode, "keyName": key_name, "pct": top_pct},
        {"root": rel_root, "mode": rel_mode,
         "keyName": DISPLAY[rel_root] + ("小调" if rel_mode == "minor" else "大调"), "pct": 100 - top_pct},
    ]

    evidence = [
        "重心音 %s · 时长最长音级 %s · 结束音 %s（权重×%.1f）" % (_midi_name(centroid), SPELL[dominant_pc], _midi_name(last["midi"]), ending_mult),
        "主音 %s：大三度 %s=%.2f vs 小三度 %s=%.2f · 大三和弦=%.2f vs 小三和弦=%.2f · 导音 %d 次 → %s" % (
            SPELL[best_root], SPELL[(best_root + 4) % 12], md["major_third"], SPELL[(best_root + 3) % 12], md["minor_third"],
            md["major_triad"], md["minor_triad"], md["leading"], "大调" if mode == "major" else "小调"),
        "根音得分前四：" + " | ".join("%s %.3f" % (SPELL[root_scores[i]["root"]], root_scores[i]["score"]) for i in ordered[:4]),
        "音级稳定性模块主音：%s%s" % (SPELL[stab_best],
                                    "小" if _dot(hist, _shift(MINOR_PROF, stab_best)) > _dot(hist, _shift(MAJOR_PROF, stab_best)) else "大"),
    ]
    if chew:
        evidence.append("Chew螺旋：最近音级 %s（置信度 %.3f）· 最近调中心 %s%s" % (
            SPELL[chew["nearest_pc"]], chew["confidence"], SPELL[chew["top_keys"][0]["root"]],
            "小" if chew["top_keys"][0]["mode"] == "minor" else "大"))
    if modulation:
        evidence.append("⚠ 疑似转调/离调：前半段倾向 %s，后半段倾向 %s（置信度已×0.8）" % (
            modulation["first_half"]["name"], modulation["second_half"]["name"]))
    if harmony["confirmed"]:
        evidence.append("和弦验证 ✓：首尾均落主和弦，主和弦时长占比 %.0f%%（置信度 +0.05）" % (harmony["tonic_fraction"] * 100))
    elif not harmony["first_tonic"] or not harmony["last_tonic"]:
        evidence.append("和弦验证：首尾未都落主和弦（首=%s 尾=%s），不加成" % (harmony["chords"][0], harmony["chords"][-1]))

    report = {
        "engine": "v2.19.0",
        "in_count": n,
        "total_dur": round(total_dur, 2),
        "centroid": {"pc": centroid_pc, "name": SPELL[centroid_pc], "midi": round(centroid, 2)},
        "dominant": {"pc": dominant_pc, "name": SPELL[dominant_pc], "share": round(pc_dur[dominant_pc] / (sum(pc_dur) or 1), 3),
                     "dominance": round(dominance, 3)},
        "ending": {"pc": ending_pc, "name": SPELL[ending_pc], "dur": round(last_dur, 2), "mult": ending_mult},
        "hist": {SPELL[i]: round(hist[i] * 100, 1) for i in range(12)},
        "root_scores": sorted([{"root": r["root"], "name": SPELL[r["root"]], "major": round(r["major"], 3),
                                "minor": round(r["minor"], 3), "score": round(r["score"], 3)} for r in root_scores],
                              key=lambda x: -x["score"]),
        "stability": {"best_root": stab_best, "best_name": SPELL[stab_best]},
        "chew": chew,
        "weights": weights,
        "modulation": modulation,
        "harmony": harmony,
        "confidence_breakdown": conf_breakdown,
        "evidence": evidence,
        "top2": top2,
    }

    return {
        "rootPC": best_root,
        "mode": mode,
        "keyName": key_name,
        "confidence": confidence,
        "evidence": evidence,
        "top2": top2,
        "report": report,
    }


def detect_key(notes):
    """兼容旧接口（main.py / test_cleaner.py 用）：返回 {key, mode, rootPC, confidence}。
    与旧版相比去掉了「关系大小调反向修正主音」——主音与调式严格两步解耦。"""
    r = analyze_tonic(notes)
    if r["rootPC"] is None:
        return {"key": None, "mode": None, "rootPC": None, "confidence": 0.0}
    return {"key": r["keyName"], "mode": r["mode"], "rootPC": r["rootPC"], "confidence": r["confidence"]}
