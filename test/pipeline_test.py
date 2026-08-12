#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pipeline_test.py — 离线自测：YIN 音高检测 -> 分段 -> K-S 定调
读入合成 WAV，复刻 dsp.js/key.js 的算法（Python 版），验证整条管线。
用法: python pipeline_test.py
"""
import math, struct, wave, sys, os

SR = 44100
YIN_THRESHOLD = 0.20
MIN_LAG = 40
MAX_LAG = 882
FRAME = 2048
HOP = 1024

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# ---------------- YIN (numpy 向量化) ----------------
import numpy as np

def yin_frame(buf):
    n = len(buf)
    if n < 64:
        return None
    x = np.asarray(buf, dtype=np.float64)
    # 差分函数 d(tau) = sum((x[i]-x[i+tau])^2)
    #   = sum_i x[i]^2 + sum_i x[i+tau]^2 - 2*sum_i x[i]*x[i+tau]
    # 互相关用 np.correlate(全模式) 一次性算所有 lag，不手写边界
    xcorr = np.correlate(x, x, 'full')[n - 1:]  # tau=0..n-1 的 sum(x[i]*x[i+tau])
    cumSq = np.cumsum(x * x)
    full = cumSq[-1]
    d = np.empty(n)
    d[0] = 0.0
    for tau in range(1, n):
        sqA = cumSq[n - tau - 1]               # sum_{i=0}^{n-tau-1} x[i]^2
        sqB = full - (cumSq[tau - 1])          # sum_{i=tau}^{n-1} x[i]^2
        d[tau] = sqA + sqB - 2 * xcorr[tau]

    cmndf = np.empty(n)
    cmndf[0] = 1.0
    running = np.cumsum(d)
    for tau in range(1, n):
        cmndf[tau] = (d[tau] * tau / running[tau]) if running[tau] != 0 else 1.0

    lo = min(MAX_LAG, n - 1)
    best_tau = -1
    best_val = float('inf')
    # 找第一个低于阈值、且为局部谷的 dip（真周期），而非阈值下方任意点
    i = MIN_LAG
    while i < lo:
        if cmndf[i] < YIN_THRESHOLD:
            # 从 i 起找本段局部谷（曲线开始回升前的极小值点）
            dip = i
            while i + 1 < lo and cmndf[i + 1] < cmndf[dip]:
                i += 1
                dip = i
            # 若该谷后面仍是连续低于阈值（说明是持续低谷），则选中
            if dip + 1 < n and cmndf[dip] <= cmndf[dip + 1]:
                best_tau = dip
                best_val = cmndf[dip]
                break
        i += 1
    if best_tau < 0:
        # 无阈值谷：退化为全范围 argmin
        best_idx = int(np.argmin(cmndf[MIN_LAG:lo])) + MIN_LAG
        best_tau = best_idx
        best_val = cmndf[best_idx]
        if best_val > 0.5:
            return None

    lag = float(best_tau)
    if 0 < best_tau < n - 1:
        s0, s1, s2 = cmndf[best_tau - 1], cmndf[best_tau], cmndf[best_tau + 1]
        denom = s0 - 2 * s1 + s2
        if abs(denom) > 1e-12:
            lag = best_tau + (s0 - s2) / (2 * denom)
    freq = SR / lag
    pitch = 69 + 12 * math.log2(freq / 440.0)
    conf = max(0.0, min(1.0, 1 - best_val / 0.5))
    return freq, pitch, conf

# ---------------- 分段 ----------------
def segment(notes, min_conf=0.7, max_note=2.5, merge=0.5, min_len=0.12):
    if len(notes) < 4:
        return []
    # 只保留可信帧（高置信；业余演唱跑音靠后段中值吸收，不用邻域替换）
    voiced = [n for n in notes if n[2] >= min_conf]
    if len(voiced) < 4:
        return []
    # 1) 中值滤波（窗口 5）：平滑帧间微抖，保留真实音阶跳变
    def medfilter(vals, w=5):
        out = []
        h = w // 2
        for i in range(len(vals)):
            lo = max(0, i - h); hi = min(len(vals), i + h + 1)
            out.append(sorted(vals[lo:hi])[len(vals[lo:hi]) // 2])
        return out
    pitches = medfilter([f[1] for f in voiced])
    # 2) 切分：相邻帧音高差 > 0.6 半音（稳定音符内允许 ±50cent 微抖）即断开
    cuts = [0]
    for i in range(1, len(voiced)):
        if abs(pitches[i] - pitches[i - 1]) > 0.6:
            cuts.append(i)
    if cuts[-1] != len(voiced) - 1:
        cuts.append(len(voiced) - 1)
    # 3) 组段：每段取音高中值
    segs = []
    for k in range(len(cuts) - 1):
        a, b = cuts[k], cuts[k + 1]
        seg = voiced[a:b + 1]
        if len(seg) < 2:
            continue
        t0, t1 = seg[0][0], seg[-1][0]
        dur = t1 - t0
        if dur < min_len:
            continue
        ps = sorted(f[1] for f in seg)
        med = ps[len(ps) // 2]
        segs.append({'start': t0, 'end': t1, 'midi': med, 'dur': dur,
                     'conf': sum(f[2] for f in seg) / len(seg)})
    # 4) 合并极短同音（装饰音/气息分裂）
    merged = []
    for cur in segs:
        if merged:
            prev = merged[-1]
            if cur['start'] - prev['end'] < merge and abs(cur['midi'] - prev['midi']) < 0.5:
                prev['end'] = cur['end']
                prev['dur'] = prev['end'] - prev['start']
                prev['midi'] = prev['midi'] if prev['dur'] >= cur['dur'] else cur['midi']
                prev['conf'] = max(prev['conf'], cur['conf'])
                continue
        merged.append(dict(cur))
    # 5) 截断超长
    capped = []
    for nn in merged:
        if nn['dur'] > max_note:
            capped.append({**nn, 'end': nn['start'] + max_note, 'dur': max_note})
            rest = nn['dur'] - max_note
            if rest > min_len:
                capped.append({**nn, 'start': nn['start'] + max_note, 'dur': rest})
        else:
            capped.append(nn)
    return capped

# ---------------- K-S 定调 ----------------
KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
def norm(p):
    m = sum(p) / len(p)
    return [v / m for v in p]
MAJOR_PROF, MINOR_PROF = norm(KS_MAJOR), norm(KS_MINOR)
TONIC_BONUS, GUITAR_BIAS = 0.15, 0.02
SCALE_BONUS = 0.20
GUILD = {'major': [0, 7, 2, 9, 4, 5], 'minor': [0, 7, 2, 5]}
MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]
def scale_membership(hist, root, mode):
    scale = [(root + s) % 12 for s in (MAJOR_SCALE if mode == 'major' else MINOR_SCALE)]
    return sum(hist[i] for i in range(12) if i in scale)
def pc(m):
    return m % 12
def corr(x, y):
    n = len(x)
    sx = sum(x); sy = sum(y)
    sxy = sum(a * b for a, b in zip(x, y))
    sxx = sum(a * a for a in x); syy = sum(b * b for b in y)
    den = math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy))
    return (n * sxy - sx * sy) / den if den != 0 else 0
def shift(prof, root):
    out = [0.0] * 12
    for i in range(12):
        out[(i + root) % 12] = prof[i]
    return out
def dist_from_tonic(midi, pc_target):
    d = ((midi - (60 + pc_target)) % 12 + 12) % 12
    return d - 12 if d > 6 else d

def detect_key(notes):
    if len(notes) < 2:
        return None
    # 整体音分偏移补偿：用"各音对最近半音偏差的中位数"一次性补偿，
    # 不暴力搜索 shift（避免过拟合到相邻调）
    cents = [(n['midi'] - round(n['midi'])) * 100 for n in notes]
    cents.sort()
    median_cents = cents[len(cents) // 2]
    if abs(median_cents) > 50:
        median_cents = 50 if median_cents > 0 else -50
    shift_cents = -median_cents

    hist = [0.0] * 12
    total = 0.0
    for n in notes:
        d = n['dur'] if n['dur'] else 0.25
        m = n['midi'] + shift_cents / 100.0
        # 软量化：按音分距离同时投给相邻两个半音，避免跑音被硬切到错误半音
        nearest = round(m)
        cent = (m - nearest) * 100.0
        w_near = 1 - abs(cent) / 50.0
        hist[nearest % 12] += d * w_near
        hist[round(m + (1 if cent >= 0 else -1)) % 12] += d * (1 - w_near)
        total += d
    if total <= 0:
        return None
    hist = [h / total for h in hist]

    last = notes[-1]
    last_m = last['midi'] + shift_cents / 100.0
    cands = []
    for root in range(12):
        ms = corr(hist, shift(MAJOR_PROF, root))
        ns = corr(hist, shift(MINOR_PROF, root))
        ms += SCALE_BONUS * scale_membership(hist, root, 'major')
        ns += SCALE_BONUS * scale_membership(hist, root, 'minor')
        if abs(dist_from_tonic(last_m, root)) < 0.7:
            ms += TONIC_BONUS
            ns += TONIC_BONUS
        if root in GUILD['major']: ms += GUITAR_BIAS
        if root in GUILD['minor']: ns += GUITAR_BIAS
        cands.append({'mode': 'major', 'root': root, 'score': ms,
                      'shift': shift_cents})
        cands.append({'mode': 'minor', 'root': root, 'score': ns,
                      'shift': shift_cents})
    # 去重 (mode, root)：同调只保留最高分，避免同名候选污染第二名
    seen = {}
    for c in cands:
        key = (c['mode'], c['root'])
        if key not in seen or c['score'] > seen[key]['score']:
            seen[key] = c
    ranked = sorted(seen.values(), key=lambda c: c['score'], reverse=True)
    best = ranked[0]
    second = ranked[1] if len(ranked) > 1 else None
    if second is None:
        second = {'mode': 'major', 'root': (best['root'] + 7) % 12,
                  'score': 0.0, 'shift': 0}
    margin = best['score'] - second['score']
    conf = max(0.0, min(1.0, margin / 0.15))
    return {**best, 'margin': margin, 'confidence': conf,
            'name': NOTE_NAMES[best['root']] +
                    ('大调' if best['mode'] == 'major' else '小调'),
            'note_count': len(notes)}

# ---------------- 主流程 ----------------
def load_wav(path):
    with wave.open(path, 'rb') as w:
        assert w.getnchannels() == 1 and w.getsampwidth() == 2
        n = w.getnframes()
        raw = w.readframes(n)
    return struct.unpack('<%dh' % n, raw)

def run_pipeline(path):
    samples = load_wav(path)
    frames = []
    # 计算 RMS 门控：避免把静音/环境噪声当音符
    n_frames = (len(samples) - FRAME) // HOP + 1
    for fi in range(n_frames):
        start = fi * HOP
        buf = samples[start:start + FRAME]
        if len(buf) < FRAME:
            break
        rms = math.sqrt(sum((x / 32767.0) ** 2 for x in buf) / len(buf))
        if rms < 0.01:
            continue
        res = yin_frame([x / 32767.0 for x in buf])
        if res:
            freq, pitch, conf = res
            t = start / SR
            frames.append((t, pitch, conf, freq))
    notes = segment(frames)
    if not notes:
        return None, frames
    key = detect_key(notes)
    return key, frames

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    cases = [
        # (file, expected_name)
        ('d_major.wav', 'D大调'),
        ('g_major.wav', 'G大调'),
        ('c_major.wav', 'C大调'),
        ('a_minor.wav', 'A小调'),
        ('e_minor.wav', 'E小调'),
    ]
    total = 0
    for fname, expected in cases:
        path = os.path.join(here, fname)
        if not os.path.exists(path):
            print(f"SKIP {fname} (missing)")
            continue
        total += 1
        key, frames = run_pipeline(path)
        n_frames = len(frames)
        if not key:
            print(f"FAIL {fname}: 无分段结果 (frames={n_frames})")
            continue
        ok = key['name'] == expected
        marks = {
            'mode': 'major' if key['mode'] == 'major' else 'minor',
            'conf': round(key['confidence'], 2),
            'margin': round(key['margin'], 3),
            'notes': key['note_count'],
        }
        status = 'PASS' if ok else 'FAIL'
        print(f"{status} {fname}: detected={key['name']} expected={expected} "
              f"{marks}")
    print(f"\n{total} cases run")

if __name__ == '__main__':
    main()
