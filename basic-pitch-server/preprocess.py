# -*- coding: utf-8 -*-
"""preprocess.py — 后端音频预处理（v2.19.0 模块1）
位于 basic-pitch 转录之前，对所有上传音频统一做：
  1) 解码为单声道 22050Hz（basic-pitch 内部采样率，避免二次重采样误差）
  2) 去直流分量（DC 偏移会让起始瞬态失真）
  3) 高通滤波 70Hz（滤低频嗡声/空调电机声/电流哼声；70Hz 低于人声最低基频 G2≈98Hz，不伤哼唱）
  4) 峰值归一化到 0.85（与基准合成器一致，过小/过大录音都能稳定转录）
  5) 轻量噪声门限（-48dBFS 以下置零，抑制背景噪声对 onset 检测的干扰）

纯函数 + 可调参数；解码失败（如损坏文件）时返回 None，调用方回退原字节交给 basic-pitch 自处理。
"""
from __future__ import annotations

import io
import wave

import numpy as np
from scipy.signal import butter, sosfiltfilt

TARGET_SR = 22050      # basic-pitch 内部采样率
HP_CUTOFF_HZ = 70.0    # 高通截止频率（低于人声最低基频 G2≈98Hz；98Hz 处仅衰减 ~1dB）
PEAK_LEVEL = 0.85      # 峰值归一化目标
NOISE_GATE_DBFS = -48.0  # 轻量噪声门限（dBFS）
HIGHPASS_ORDER = 4     # 4 阶（filtfilt 等效 8 阶）：50Hz 嗡声衰减 >20dB，人声基频不受影响


def _highpass(x, sr, cutoff=HP_CUTOFF_HZ):
    sos = butter(HIGHPASS_ORDER, cutoff / (sr / 2), btype="highpass", output="sos")
    return sosfiltfilt(sos, x).astype(np.float32)


def preprocess_bytes(data: bytes):
    """输入原始音频字节（wav/mp3/ogg 等），返回 (float32 单声道 22050Hz, 采样率)。
    解码失败返回 None（调用方回退未处理的原始字节）。"""
    try:
        import librosa
        x, sr = librosa.load(io.BytesIO(data), sr=TARGET_SR, mono=True)
    except Exception:
        try:
            import soundfile as sf
            x, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
            x = x.mean(axis=1)
            if sr != TARGET_SR:
                import librosa
                x = librosa.resample(x, orig_sr=sr, target_sr=TARGET_SR)
                sr = TARGET_SR
        except Exception:
            return None

    if x is None or len(x) < sr * 0.2:
        return None

    # 1) 去直流
    x = x - float(np.mean(x))
    # 2) 高通 70Hz（滤嗡声；纯哼唱没有 <70Hz 的基频）
    x = _highpass(x, sr)
    # 3) 峰值归一化
    peak = float(np.max(np.abs(x)))
    if peak > 1e-6:
        x = x * (PEAK_LEVEL / peak)
    # 4) 轻量噪声门限
    gate = 10 ** (NOISE_GATE_DBFS / 20) * PEAK_LEVEL
    x = np.where(np.abs(x) < gate, 0.0, x).astype(np.float32)
    return x, sr


def pcm_to_wav_bytes(x, sr):
    """float32 单声道 → 16bit WAV 字节（basic-pitch 接受文件路径，写临时文件用）"""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sr))
        w.writeframes((np.clip(x, -1.0, 1.0) * 32767).astype("<i2").tobytes())
    return buf.getvalue()
