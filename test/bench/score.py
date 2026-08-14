#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""score.py — 基准评分
1) note 级：把 96 条合成旋律的音符喂给真实 key.js detectKey（可换 profile），
   用 mir_eval.key 标准指标 + 自定指标评分
2) e2e 级：WAV → 本地 basic-pitch 后端 /transcribe → detectKey → 评分（走真实产品链路）
用法: python score.py [profile=krumhansl] [--e2e-pattern pop]
"""
import json
import os
import subprocess
import sys
import urllib.request

import mir_eval.key

NODE = r"C:\Users\keyou\.tools\node-v20.15.0-win-x64\node.exe"
BENCH = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BENCH, "data")
RUNNER = os.path.join(BENCH, "run_detect.js")
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
BACKEND = "http://127.0.0.1:8000/transcribe"


def key_str(root, mode):
    return NOTE_NAMES[root] + " " + mode


def detect_notes(notes, profile):
    """喂音符 JSON 给真实 detectKey，返回 (rootPC, mode, confidence)"""
    p = subprocess.run(
        [NODE, RUNNER, profile],
        input=json.dumps(notes), capture_output=True, text=True, encoding="utf-8",
    )
    if p.returncode != 0:
        return None
    out = json.loads(p.stdout.strip())
    if not out:
        return None
    return out["rootPC"], out["mode"], out["confidence"]


def rel_key(root, mode):
    """关系大小调"""
    if mode == "minor":
        return (root + 3) % 12, "major"
    return (root + 9) % 12, "minor"


def evaluate(refs, ests, label):
    n = len(refs)
    exact = sum(1 for r, e in zip(refs, ests) if e is not None and e[0] == r[0] and e[1] == r[1])
    tonic = sum(1 for r, e in zip(refs, ests) if e is not None and e[0] == r[0])
    mode_ok = sum(1 for r, e in zip(refs, ests) if e is not None and e[1] == r[1])
    rel = sum(1 for r, e in zip(refs, ests) if e is not None and rel_key(r[0], r[1]) == (e[0], e[1]))
    # mir_eval.key 标准加权分（本版本接口为单条 key 字符串，逐条评分取平均）
    ws_sum = 0.0
    for r, e in zip(refs, ests):
        ws_sum += mir_eval.key.evaluate(key_str(r[0], r[1]), key_str(e[0], e[1]) if e else "X other")["Weighted Score"]
    ws = ws_sum / n
    print(f"  [{label}] n={n}")
    print(f"    mir_eval 加权分: {ws:.3f}  精确: {exact}/{n} ({exact/n*100:.1f}%)  "
          f"主音对: {tonic}/{n} ({tonic/n*100:.1f}%)  调式对: {mode_ok}/{n} ({mode_ok/n*100:.1f}%)  "
          f"关系调混淆: {rel}/{n}")
    # 按模式细分
    for mode in ("major", "minor"):
        idx = [i for i, r in enumerate(refs) if r[1] == mode]
        ok = sum(1 for i in idx if ests[i] is not None and ests[i][0] == refs[i][0] and ests[i][1] == refs[i][1])
        print(f"      {mode:>5} 精确: {ok}/{len(idx)} ({ok/len(idx)*100:.1f}%)")
    return ws


def main():
    profile = sys.argv[1] if len(sys.argv) > 1 else "krumhansl"
    note_only = "--note-only" in sys.argv
    with open(os.path.join(DATA, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)

    print(f"=== note 级基准（profile={profile}，96 条）===")
    refs, ests = [], []
    for item in manifest:
        with open(os.path.join(DATA, item["notes"]), encoding="utf-8") as f:
            notes = json.load(f)
        est = detect_notes(notes, profile)
        refs.append((item["root"], item["mode"]))
        ests.append(est)
    evaluate(refs, ests, "note 级")

    # 按模式分 profile 细分
    for pat in ("scale", "arpeggio", "pop", "offtune", "nontonic_end", "short", "chromatic"):
        idx = [i for i, item in enumerate(manifest) if item["pattern"] == pat]
        evaluate([refs[i] for i in idx], [ests[i] for i in idx], f"note 级 · {pat}")

    if note_only:
        return

    print("\n=== e2e 基准（WAV → basic-pitch 后端 → detectKey，pop 模式 24 条）===")
    refs2, ests2 = [], []
    for item in manifest:
        if item["pattern"] != "pop":
            continue
        wav_path = os.path.join(DATA, item["wav"])
        with open(wav_path, "rb") as f:
            wav_bytes = f.read()
        boundary = "----benchboundary"
        body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="file"; filename="bench.wav"\r\n'
            "Content-Type: audio/wav\r\n\r\n"
        ).encode() + wav_bytes + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(
            BACKEND, data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            est = detect_notes(data["notes"], profile)
        except Exception as e:  # noqa: BLE001
            print(f"  e2e 失败 {item['name']}: {e}")
            est = None
        refs2.append((item["root"], item["mode"]))
        ests2.append(est)
        print(f"  {item['name']}: 真实 {key_str(item['root'], item['mode'])}"
              + (f" → {key_str(est[0], est[1])} (conf {est[2]:.2f})" if est else " → 转录失败"))
    evaluate(refs2, ests2, "e2e")


if __name__ == "__main__":
    main()
