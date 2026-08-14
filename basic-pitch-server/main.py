"""
basic-pitch-server — 后端转录服务（方案 B）

用 Spotify basic-pitch（Python 版，ICASSP 2022 模型）把哼唱音频转录成高精度
MIDI 音符，并用 Krumhansl-Schmuckler 特征 + 关系大小调裁判输出调性。

前端「唱一句·定调子」在零后端模式下仍用本地 YIN 转录；把前端指向本服务的
`POST /transcribe` 即可切换到 basic-pitch 转录（前端仍保留 K-S+多级裁判定调）。

部署（Render/Railway/本地）：
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8000
"""
import io
import math

import numpy as np
from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel

from basic_pitch.inference import predict
from basic_pitch import ICASSP_2022_MODEL_PATH
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="basic-pitch transcription")

# 允许前端（本地/任意域名）跨域调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# K-S 探测音评分（Krumhansl & Schmuckler 1982，归一化）
KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
SPELL = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_SCALE = {0, 2, 4, 5, 7, 9, 11}
MINOR_SCALE = {0, 2, 3, 5, 7, 8, 10}


def _norm(p):
    m = sum(p) / len(p)
    return [v / m for v in p]


MAJOR_PROF = _norm(KS_MAJOR)
MINOR_PROF = _norm(KS_MINOR)


def _pc(midi):
    return int(round(midi)) % 12


def _corr(x, y):
    n = len(x)
    sx = sum(x); sy = sum(y)
    sxy = sum(a * b for a, b in zip(x, y))
    sxx = sum(a * a for a in x); syy = sum(b * b for b in y)
    denom = math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy))
    return 0.0 if abs(denom) < 1e-12 else (n * sxy - sx * sy) / denom


def _shift(prof, root):
    return [prof[(i - root) % 12] for i in range(12)]


def detect_key(notes):
    """notes: [{midi, dur}] → 返回 {key, mode, rootPC, confidence}"""
    if len(notes) < 2:
        return {"key": None, "mode": None, "rootPC": None, "confidence": 0.0}

    hist = [0.5] * 12  # 平滑伪计数
    for n in notes:
        hist[_pc(n["midi"])] += n.get("dur", 0.25)

    # 落尾音权重
    last = _pc(notes[-1]["midi"])

    best = []
    for root in range(12):
        for mode, prof, scale in (("major", MAJOR_PROF, MAJOR_SCALE),
                                   ("minor", MINOR_PROF, MINOR_SCALE)):
            score = _corr(hist, _shift(prof, root))
            # 音阶成员 + 落尾音 + 关系大小调处理
            member = sum(hist[i] for i in range(12) if (i - root) % 12 in scale)
            score += 0.2 * (member / sum(hist))
            if last == root:
                score += 0.15
            best.append((score, mode, root))

    best.sort(reverse=True)
    score, mode, root = best[0]

    # 关系大小调裁判：若小调胜出，与其关系大调比较，落尾音落在谁主音上就归谁
    rel_mode = "major" if mode == "minor" else "minor"
    rel_root = (root + 3) % 12 if mode == "minor" else (root + 9) % 12
    if last == rel_root:
        mode, root = rel_mode, rel_root

    return {
        "key": SPELL[root] + ("小调" if mode == "minor" else "大调"),
        "mode": mode,
        "rootPC": root,
        "confidence": round(min(1.0, max(0.0, score - best[1][0]) / 0.15), 3),
    }


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/transcribe")
def transcribe(file: UploadFile = File(...)):
    """接收音频文件（wav/mp3/ogg），返回音符 + 调性"""
    try:
        data = file.file.read()
        if not data:
            raise HTTPException(400, "空文件")
        # basic-pitch 接受文件路径；这里把上传内容存到内存临时文件交给它
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        try:
            _model_output, _midi_data, note_events = predict(tmp_path)
        finally:
            os.unlink(tmp_path)

        notes = []
        for ev in note_events:
            # basic-pitch 返回 note_events 为元组列表：(start, end, pitch_midi, amplitude, pitch_bends)
            # amplitude = 节拍强度（响度），用于前端「重心音 = 时长 × 振幅」权重
            if isinstance(ev, (tuple, list)):
                start_t, end_t, pitch = ev[0], ev[1], ev[2]
                amplitude = float(ev[3]) if len(ev) > 3 else 0.0
            else:
                start_t = getattr(ev, "start_time_s", getattr(ev, "start", 0.0))
                end_t = getattr(ev, "end_time_s", getattr(ev, "end", 0.0))
                pitch = getattr(ev, "pitch_midi", getattr(ev, "pitch", 60))
                amplitude = getattr(ev, "amplitude", 0.0)
            notes.append({
                "midi": int(pitch),
                "start": round(float(start_t), 3),
                "end": round(float(end_t), 3),
                "dur": round(max(0.0, float(end_t) - float(start_t)), 3),
                "amplitude": round(float(amplitude), 4),
            })

        if not notes:
            raise HTTPException(422, "没转录出音符，音频可能太短或没声音")

        key = detect_key(notes)
        return {"notes": notes, "key": key}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"转录失败: {e}")
