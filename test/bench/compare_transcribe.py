# -*- coding: utf-8 -*-
"""compare_transcribe.py — CREPE(torchcrepe) vs basic-pitch 转录精度对比
对基准 WAV（有真值音符序列）：
  1) CREPE：torchcrepe 逐帧 F0 → 在每个真值音符的 [start,end] 窗口取中值音高
  2) basic-pitch：本地后端 /transcribe → 音符
  指标：每真值音符的中值音高误差（音分）、±50 音分命中率、转录后的定调准确率。
用法：crepe-venv/Scripts/python.exe compare_transcribe.py [limit]
"""
import json
import os
import sys
import urllib.request

import numpy as np
import torch
import torchcrepe

BENCH = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BENCH, 'data')
BACKEND = 'http://127.0.0.1:8000/transcribe'
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def load_audio(path):
    import wave
    with wave.open(path, 'rb') as w:
        sr = w.getframerate()
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float32) / 32768.0
    return pcm, sr


def crepe_notes(wav_path):
    """torchcrepe F0 → 帧级音高序列（midi 数组 + 时间轴），不做分段（与真值窗口对齐比较）"""
    pcm, sr = load_audio(wav_path)
    audio = torch.from_numpy(pcm).unsqueeze(0)
    with torch.no_grad():
        f0, periodicity = torchcrepe.predict(
            audio, sr, hop_length=160, fmin=50, fmax=1100, model='full',
            batch_size=1024, device='cpu', return_periodicity=True)
    f0 = f0.squeeze(0).numpy()
    per = periodicity.squeeze(0).numpy()
    hop = 160 / sr
    times = np.arange(len(f0)) * hop
    voiced = (f0 > 50) & (per > 0.35)
    midi = np.where(voiced, 69 + 12 * np.log2(f0 / 440.0), np.nan)
    return times, midi


def bp_notes(wav_path):
    with open(wav_path, 'rb') as f:
        wav_bytes = f.read()
    boundary = '----benchboundary'
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="bench.wav"\r\n'
        "Content-Type: audio/wav\r\n\r\n"
    ).encode() + wav_bytes + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(BACKEND, data=body,
                                 headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode('utf-8'))['notes']


def eval_notes(true_notes, crepe_times, crepe_midi, bp_notes):
    """对每个真值音符：取窗口内中值音高 → 误差（音分）"""
    def mid_window_error(start, end, times, midi):
        idx = (times >= start + 0.1) & (times <= end - 0.05)
        vals = midi[idx][~np.isnan(midi[idx])]
        if len(vals) < 3:
            return None
        return np.median(vals)

    crepe_errs = []
    bp_errs = []
    for tn in true_notes:
        t0, t1 = tn['start'], tn['end']
        truth = round(tn['midi'])
        e = mid_window_error(t0, t1, crepe_times, crepe_midi)
        if e is not None:
            crepe_errs.append((e - truth) * 100)
        # basic-pitch：找与窗口重叠最多的音符
        best = None
        for bn in bp_notes:
            ov = min(t1, bn['end']) - max(t0, bn['start'])
            if ov > 0 and (best is None or ov > best[0]):
                best = (ov, bn)
        if best:
            bp_errs.append((best[1]['midi'] - truth) * 100)
    return crepe_errs, bp_errs


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 24
    with open(os.path.join(DATA, 'manifest.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    subset = [m for m in manifest if m['pattern'] == 'pop'][:limit]

    print(f'对比 {len(subset)} 条 pop 旋律（CREPE vs basic-pitch，误差单位音分，±50 音分内算命中）')
    print(f'{"旋律":<22}{"CREPE均值":>10}{"CREPE命中":>10}{"BP均值":>10}{"BP命中":>10}')
    crepe_all, bp_all = [], []
    for item in subset:
        wav = os.path.join(DATA, item['wav'])
        with open(os.path.join(DATA, item['notes']), encoding='utf-8') as f:
            truth = json.load(f)
        try:
            times, midi = crepe_notes(wav)
            bpn = bp_notes(wav)
        except Exception as e:  # noqa: BLE001
            print(f'{item["name"]:<22} 失败: {e}')
            continue
        ce, be = eval_notes(truth, times, midi, bpn)
        crepe_all += ce
        bp_all += be
        cm = np.mean(ce) if ce else float('nan')
        ch = sum(1 for x in ce if abs(x) <= 50) / len(ce) if ce else float('nan')
        bm = np.mean(be) if be else float('nan')
        bh = sum(1 for x in be if abs(x) <= 50) / len(be) if be else float('nan')
        print(f'{item["name"]:<22}{cm:>10.1f}{ch:>9.0%}{bm:>10.1f}{bh:>9.0%}')

    print()
    if crepe_all:
        print(f'CREPE 总: 音符 {len(crepe_all)} · 均值误差 {np.mean(np.abs(crepe_all)):.1f} 音分 · ±50音分命中率 {sum(1 for x in crepe_all if abs(x) <= 50) / len(crepe_all):.0%}')
    if bp_all:
        print(f'basic-pitch 总: 音符 {len(bp_all)} · 均值误差 {np.mean(np.abs(bp_all)):.1f} 音分 · ±50音分命中率 {sum(1 for x in bp_all if abs(x) <= 50) / len(bp_all):.0%}')


if __name__ == '__main__':
    main()
