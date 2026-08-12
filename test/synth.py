#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""synth.py — 生成"绝对确定频率"的测试 WAV（纯正弦 + 极轻包络 + 轻微泛音）
用于离线自测 DSP 管线：YIN 音高检测 -> 分段 -> 调性识别。

关键：频率必须精确等于期望 MIDI 对应的频率，否则测的是合成器不是检测器。

用法: python synth.py <output.wav> --key D --mode major --melody "0 4 5 7 9 7 5 4 0"
  旋律用相对首调唱名度数（0=do 1=re 2=mi 3=fa 4=sol 5=la 6=si）
"""
import math, struct, wave, sys, argparse

SR = 44100
MAJOR_DEG = [0, 2, 4, 5, 7, 9, 11]
MINOR_DEG = [0, 2, 3, 5, 7, 8, 10]

def midi_to_freq(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)

def render_note(t0, dur, midi, out, amp=0.5, harmonics=(0.2, 0.1, 0.05)):
    """渲染一个纯正弦音符（确定性频率，无滑音、无跑音）。
    harmonics 为可选轻微泛音（不影响基频检测）。"""
    freq = midi_to_freq(midi)
    ns = int(dur * SR)
    phase = 0.0
    for i in range(ns):
        # 包络：20ms 起音 + 80ms 释放（避免方波毛刺，不影响频率）
        attack = min(1.0, i / (0.02 * SR))
        release = min(1.0, max(0.0, (ns - i) / (0.08 * SR)))
        env = attack * release
        s = math.sin(phase)
        # 泛音与基频相位对齐（简化：泛音相位用整倍数）
        s += harmonics[0] * math.sin(2 * phase)
        s += harmonics[1] * math.sin(3 * phase)
        s += harmonics[2] * math.sin(4 * phase)
        phase += 2 * math.pi * freq / SR
        out.append(amp * env * s)
    return t0 + dur

def render_pause(t0, dur, out):
    ns = int(dur * SR)
    for _ in range(ns):
        out.append(0.0)
    return t0 + dur

def build(root_midi, mode, melody, note_len=0.4, pause=0.06):
    deg_semitone = MAJOR_DEG if mode == 'major' else MINOR_DEG
    samples = []
    t = 0.0
    for deg in melody:
        semis = deg_semitone[deg % 7] + (deg // 7) * 12
        note_midi = root_midi + semis
        t = render_note(t, note_len, note_midi, samples)
        t = render_pause(t, pause, samples)
    return samples

def write_wav(path, samples):
    peak = max(abs(s) for s in samples) or 1.0
    data = b''
    for s in samples:
        v = int(max(-1, min(1, s / peak)) * 32767)
        data += struct.pack('<h', v)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--key', default='D', help='主音音名 C/C#/Db/...')
    ap.add_argument('--mode', default='major', choices=['major', 'minor'])
    ap.add_argument('--melody', default='0 4 5 7 9 7 5 4 0', help='首调度数序列')
    ap.add_argument('--root-octave', type=int, default=4)
    ap.add_argument('--note-len', type=float, default=0.4)
    ap.add_argument('--pause', type=float, default=0.06)
    args = ap.parse_args()

    pc_map = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
              'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8,
              'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
    pc = pc_map[args.key]
    root_midi = 12 * (args.root_octave + 1) + pc
    melody = [int(x) for x in args.melody.split()]
    samples = build(root_midi, args.mode, melody,
                    note_len=args.note_len, pause=args.pause)
    write_wav(args.out, samples)
    print(f"wrote {args.out}: key={args.key}(pc{pc}) mode={args.mode} "
          f"melody={melody} dur={len(samples)/SR:.2f}s")

if __name__ == '__main__':
    main()
