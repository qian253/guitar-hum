# basic-pitch-server（方案 B）

用 Spotify basic-pitch 模型做哼唱 → 高精度 MIDI 转录的后端，供「唱一句·定调子」前端可选接入。

## 本地跑

```bash
cd basic-pitch-server
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

首次 `pip install basic-pitch` 会下载 ICASSP 2022 模型（约 17MB）。

## 部署到 Render / Railway

> ⚠️ **Python 版本务必用 3.11**（已加 `runtime.txt` 锁定）。basic-pitch 的依赖在 Python 3.12 上会因 `distutils` 被移除而编译失败。

**Render**：
1. 新建 Web Service，仓库指向本项目，根目录填 `basic-pitch-server`。
2. Build command：`pip install -r requirements.txt`
3. Start command：`uvicorn main:app --host 0.0.0.0 --port $PORT`
4. 部署完成后得到 `https://xxx.onrender.com`。

**Railway**：同理，Start command 用 `uvicorn main:app --host 0.0.0.0 --port $PORT`。

> 注意：免费实例冷启动较慢（模型加载需数秒），首次请求可能超时，可先访问 `/health` 预热。

## API

### `GET /health`
返回 `{"ok": true}`。

### `POST /transcribe`
`multipart/form-data`，字段名 `file`，上传 wav/mp3/ogg 音频。

返回：
```json
{
  "notes": [
    {"midi": 59, "start": 0.12, "end": 0.55, "dur": 0.43},
    {"midi": 62, "start": 0.55, "end": 1.02, "dur": 0.47}
  ],
  "key": {"key": "B小调", "mode": "minor", "rootPC": 11, "confidence": 0.62}
}
```

## 前端怎么接

前端录音得到 Float32Array PCM 后，编码成 WAV 上传即可。核心是：

```js
// 1) Float32 PCM → 16bit WAV blob
function pcmToWavBlob(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

// 2) 上传
const fd = new FormData();
fd.append("file", pcmToWavBlob(pcm, sampleRate), "hum.wav");
const res = await fetch("https://你的服务/transcribe", { method: "POST", body: fd });
const { notes, key } = await res.json();
// 把 notes 交给前端的 KeyDetect.detectKey + renderResult 即可
```

> 说明：本后端只做「转录」（basic-pitch 强项），最终调性仍由前端已有的 K-S + 多级裁判判定，
> 这样既拿到 basic-pitch 的转录精度，又保留了你已经调好的定调逻辑。
