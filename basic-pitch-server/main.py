"""
basic-pitch-server — 后端转录服务（方案 B）

用 Spotify basic-pitch（Python 版，ICASSP 2022 模型）把哼唱音频转录成高精度
MIDI 音符，经清洗/八度修正后，由主音检测引擎（tonic_engine.py，v2.19.0）
输出主音与调性，并返回全链路诊断报告。

处理流水线（v2.19.0）：
  原始音频
    → 预处理 preprocess.py（解码 22050Hz 单声道 / 去直流 / 高通 70Hz /
       峰值归一化 0.85 / 轻量噪声门限 -48dBFS）
    → basic-pitch 转录（失败时尝试 torchcrepe 备选，再失败按原错误抛出）
    → 音符清洗 note_cleaner.py（滑音合并 / 极短音 / 跳跃毛刺，阈值自适应）
    → 八度修正 octave_fix.py（孤立八度跳变折回）
    → 主音检测 tonic_engine.py（两步锁根音→定大小调 + 动态权重 + 转调检测 + 和弦验证）

响应 JSON：
  { notes: 清洗+八度修正后的音符, key: 主音结果, clean_report, octave_report, tonic_report }

前端「唱一句·定调子」在零后端模式下仍用本地 YIN 转录；把前端指向本服务的
`POST /transcribe` 即可切换到 basic-pitch 转录（高精度模式采用后端 key 结果）。

部署（Render/Railway/本地）：
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8000
"""
import os
import tempfile

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

from basic_pitch.inference import predict
from note_cleaner import clean_notes
from octave_fix import fix_octave_errors
from preprocess import preprocess_bytes, pcm_to_wav_bytes
from tonic_engine import analyze_tonic
from dual_track import yin_track, verify_notes

app = FastAPI(title="basic-pitch transcription")

# 允许前端（本地/任意域名）跨域调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# basic-pitch 参数（哼唱场景：默认阈值即可；如需更灵敏可调低 onset_threshold）
BP_ONSET_THRESHOLD = float(os.environ.get("HK_BP_ONSET_THRESHOLD", "0.5"))
BP_FRAME_THRESHOLD = float(os.environ.get("HK_BP_FRAME_THRESHOLD", "0.3"))
BP_MIN_NOTE_LEN_MS = float(os.environ.get("HK_BP_MIN_NOTE_LEN", "127.70"))


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/chords")
def chords():
    """v2.23.0 吉他和弦指法库:前端每次加载时同步(失败则用内置精简版回退)"""
    from chord_lib import CHORD_LIB, VERSION
    return {"version": VERSION, "chords": CHORD_LIB}


@app.get("/rhythms")
def rhythms():
    """v2.23.0 右手节奏型库:按情绪分组(嗨一点/情歌),前端每次结果推荐 3 个"""
    from rhythm_lib import RHYTHM_LIB, VERSION
    return {"version": VERSION, "groups": RHYTHM_LIB}


def _transcribe(path):
    """basic-pitch 转录；失败时尝试 torchcrepe 备选（若环境已安装）。"""
    try:
        _mo, _md, note_events = predict(
            path,
            onset_threshold=BP_ONSET_THRESHOLD,
            frame_threshold=BP_FRAME_THRESHOLD,
            minimum_note_length=BP_MIN_NOTE_LEN_MS,
        )
        return note_events, "basic-pitch"
    except Exception:
        try:
            import torchcrepe  # noqa: F401  # 备选方案（v2.19.0 模块2）：CREPE
            import numpy as np
            import wave
            import torch
            with wave.open(path, "rb") as w:
                sr = w.getframerate()
                pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
            audio = torch.from_numpy(pcm).unsqueeze(0)
            with torch.no_grad():
                f0, per = torchcrepe.predict(audio, sr, hop_length=160, fmin=50, fmax=1100,
                                             model="full", batch_size=1024, device="cpu",
                                             return_periodicity=True)
            f0 = f0.squeeze(0).numpy()
            per = per.squeeze(0).numpy()
            hop = 160 / sr
            events = []
            cur, start_i = None, None
            for i in range(len(f0)):
                voiced = f0[i] > 50 and per[i] > 0.35
                if voiced and cur is None:
                    cur = float(f0[i])
                    start_i = i
                elif voiced and cur is not None:
                    cur = 0.7 * cur + 0.3 * float(f0[i])
                elif cur is not None:
                    midi = 69 + 12 * np.log2(cur / 440.0)
                    events.append((start_i * hop, (i + 1) * hop, midi, 1.0, []))
                    cur = None
            if cur is not None:
                midi = 69 + 12 * np.log2(cur / 440.0)
                events.append((start_i * hop, len(f0) * hop, midi, 1.0, []))
            return events, "torchcrepe"
        except Exception as e2:  # noqa: BLE001
            raise RuntimeError("basic-pitch 与 torchcrepe 备选均失败: %s" % e2)


@app.post("/transcribe")
def transcribe(file: UploadFile = File(...)):
    """接收音频文件（wav/mp3/ogg），返回 音符 + 主音 + 全链路诊断报告"""
    try:
        data = file.file.read()
        if not data:
            raise HTTPException(400, "空文件")

        # ---- 模块1：预处理（解码/去直流/高通/归一化/噪声门限；失败回退原字节） ----
        pre = preprocess_bytes(data)
        import tempfile as _tmp  # noqa: F401
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            if pre is not None:
                tmp.write(pcm_to_wav_bytes(pre[0], pre[1]))
            else:
                tmp.write(data)
            tmp_path = tmp.name
        try:
            note_events, engine_used = _transcribe(tmp_path)
        finally:
            os.unlink(tmp_path)

        notes = []
        for ev in note_events:
            # basic-pitch / torchcrepe 返回元组列表：(start, end, pitch_midi, amplitude, pitch_bends)
            if isinstance(ev, (tuple, list)):
                start_t, end_t, pitch = ev[0], ev[1], ev[2]
                amplitude = float(ev[3]) if len(ev) > 3 else 0.0
                bends = [round(float(b), 2) for b in ev[4]] if len(ev) > 4 and ev[4] else []
            else:
                start_t = getattr(ev, "start_time_s", getattr(ev, "start", 0.0))
                end_t = getattr(ev, "end_time_s", getattr(ev, "end", 0.0))
                pitch = getattr(ev, "pitch_midi", getattr(ev, "pitch", 60))
                amplitude = getattr(ev, "amplitude", 0.0)
                bends = [round(float(b), 2) for b in (getattr(ev, "pitch_bends", None) or [])]
            notes.append({
                "midi": int(round(float(pitch))),
                "start": round(float(start_t), 3),
                "end": round(float(end_t), 3),
                "dur": round(max(0.0, float(end_t) - float(start_t)), 3),
                "amplitude": round(float(amplitude), 4),
                "pitch_bends": bends,
            })

        if not notes:
            raise HTTPException(422, "没转录出音符，音频可能太短或没声音")

        # ---- 模块3：音符清洗 ----
        notes, clean_report = clean_notes(notes)
        # ---- 模块2：八度修正 ----
        notes, octave_report = fix_octave_errors(notes)
        # ---- 模块2b(v2.24.0 P0)：双轨转录校验 —— basic-pitch 报的每个音,
        #      用 YIN 逐帧 F0 交叉确认(音高差≤1半音且窗内有声帧≥30%),
        #      否则判为气息毛刺/滑音伪影删除。让简谱干净、直方图不被污染。
        dual_report = {"skipped": True, "note": "双轨校验未执行(预处理音频不可用)"}
        if pre is not None:
            try:
                times, f0 = yin_track(pre[0], pre[1])
                notes, dual_report = verify_notes(notes, times, f0, audio=pre[0], sr=pre[1])
            except Exception as de:  # noqa: BLE001
                dual_report = {"skipped": True, "error": str(de)}

        # ---- 模块4/5/6：主音检测（两步锁根音→定大小调，含动态权重/转调/和弦验证） ----
        recording_dur = max(n.get("end", n.get("start", 0) + n.get("dur", 0.25)) for n in notes) if notes else 0.0
        tonic = analyze_tonic(notes, recording_dur=recording_dur)

        return {
            "notes": notes,
            "key": {"rootPC": tonic["rootPC"], "mode": tonic["mode"], "keyName": tonic["keyName"],
                    "confidence": tonic["confidence"], "evidence": tonic["evidence"], "top2": tonic["top2"]},
            "engine": engine_used,
            "clean_report": clean_report,
            "dual_report": dual_report,
            "octave_report": octave_report,
            "tonic_report": tonic["report"],
        }
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"转录失败: {e}")
