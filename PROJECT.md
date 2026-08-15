# 唱一句 · 定调子 —— 项目档案

> 本文件是项目的「记忆锚点」。新窗口/新会话先读这个，就能无缝接手，不必翻历史对话。
> 最后更新：2026-08-15（v2.11.9）

---

## 一、这是什么

一个**吉他新手定调器**（网页 App）：对着麦克风哼一句副歌，立刻告诉你——

1. **是什么调**（B 小调 / C 大调…），带证据链
2. **do / la 在吉他上的位置**（几弦几品 + 指板图）
3. **怎么弹**（变调夹夹几品 + C/G 调指法，新手友好）
4. **和弦走向**（根据你哼的旋律实时配和弦 + 常用走向模板）
5. **节奏型**（5323/5321/根音+扫弦，可试听）
6. **简谱**（逐音对应，可点击试听）

**核心卖点**：纯本地运行、不上传声音（可选高精度后端）、零门槛。

- 线上地址：`https://qian253.github.io/guitar-hum/`
- GitHub 仓库：`qian253/guitar-hum`（分支 main，GitHub Pages 自动部署）
- 本地代码：`C:\Users\keyou\hum-key\`

---

## 二、技术架构（当前 v2.11.9）

```
录音(15s，ScriptProcessor 2048；可「再哼一段」多段补充≤5段，合并重判)
  → 转录（二选一，自动降级）
      ├─ 高精度：basic-pitch 后端（ONNX ICASSP 2022 模型）
      └─ 快速：YIN(CMNDF) + 滞回分段 + 八度修正
  → 定调（两步，主音与调式解耦）
      ├─ 第1步 锁主音：12 根音打分（K-S相关 + 音阶成员 + 重心音 + 音级分布 + 吉他偏好，取大小调较高分）
      └─ 第2步 定调式：主音锁定后，只在「同主音大小调」二选一（大三度 vs 小三度 + 大三和弦 vs 小三和弦 + 导音）
  → 吉他映射（do位置/变调夹/和弦走向/节奏型/简谱）
  → 展示（玻璃拟态 UI，三屏转场 + 标签页 + 触觉反馈；小调默认谱面记法「D大调（B小调）」，可切专业模式）
```

### 定调算法（本轮重构后的核心，别改回旧逻辑）

- **先锁主音，再定调式**：这是关键。旧逻辑是「24 候选(12根音×大小调)联合打分 + 关系大小调互相翻转」，导致主音被关系大小调拉走，出现「主音对但调式错」的矛盾。
- **主音证据**（模式无关）：K-S 相关、音阶成员、重心音（权重 = 时长 × 振幅/节拍强度，basic-pitch 有振幅时生效，否则纯时长）、音级分布、吉他偏好。
- **调式证据**（主音锁定后）：大三度(主音+4)时长 vs 小三度(主音+3)时长、大三和弦(0,4,7) vs 小三和弦(0,3,7)骨架权重、导音(主音-1→主音)半音解决次数。**小调必须明显占优(×1.25)才判小调**，否则按流行歌先验判大调。
- **关键权重常量**（`key.js`）：SCALE_BONUS=0.20、GUITAR_BIAS=0.02、CENTROID_WEIGHT=0.04、DOMINANT_WEIGHT=0.04、ENDING_MAX_MULT=1.5、confidence=margin/0.18。
- **结束音已降权**：不再一票否决，仅当「结束音>0.5s + 尾静音≥0.3s + 全曲>5s + 非跨次累计」才×1.5。
- **多段合并**（v2.10.0「再哼一段」）：每段单独定调保存，合并所有段音符后以 `noEndingBoost:true` 重判（多段时任何一段的结束音都不加权）；结果页显示每段倾向、一致性警告、置信度变化（综合N段，从X%→Y%）。
- **重心/音级分布权重保持 0.04 不动**：2026-08-14 实验扫过 0.04→0.12，全部判例都能过，但权重越大「矛盾输入」置信度越虚高（0.26→0.48），同调合并的提升又不依赖它（0.70→0.91→1.00 靠 K-S+音阶成员），故维持 0.04，靠振幅加权重心提质。
- **K-S profile 对比结论（v2.11.0 基准实测）**：在 168 条合成基准（24 调×7 模式：音阶/琶音/流行/跑音/非主音结尾/极短4音/经过音）上，K-S 1982 与 Albrecht-Shanahan **完全持平**（均 92.9%、主音 100%），Temperley 明显更差（78%）→ **不换 profile**。当前唯一系统性弱点：**不含三音的极短旋律（如 1-5-1-5）调式不可判定**（主音仍 100% 对），属信息论边界而非算法缺陷。e2e（WAV→basic-pitch→定调）24/24 全对。
- **基准 harness（v2.11.0 新增）**：`test/bench/`（gen_dataset.py 生成 168 条合成旋律 + run_detect.js 跑真实 detectKey + score.py 用 mir_eval 评分；数据不入库，`python test/bench/gen_dataset.py && python test/bench/score.py` 一键复现）。以后改定调算法前先跑它。
- **Essentia 参与投票（v2.11.0）**：单段时 Essentia KeyExtractor 结果参与置信度调整——一致 +0.08、关系大小调 +0.02、冲突 ×0.8（`applyEssentiaVote` 纯函数，verify-essentia-vote.js 覆盖）；多段合并时 essentia 只看到最后一段，仅展示不投票。
- **显示模式**（v2.10.0）：小调默认「谱面记法」显示关系大调+真实调性（如 B 小调 → 大字「D 大调（B 小调）」+ 徽章「谱面记法 · 真实调性 B 小调」），「专业模式」按钮切回真实调性（localStorage 持久化）。capo/简谱/do位置等身体渲染始终按真实调性。
- **证据链输出**：重心音、时长最长音级、结束音(权重倍率)、大三度/小三度时长、三和弦权重、导音次数、候选主音得分明细。

### 音频系统

- **首选**：Tone.js `Sampler`，FluidR3 采样**多源自动回退**（v2.10.1）：gleitz.github.io → jsdelivr gh → gcore → fastly，按序尝试、成功主机被记住复用，国内手机网络也能加载到真实采样。
- **release 0.6s**（v2.10.1，原 1.4s）：旋律回放每个音不再拖 1.4 秒尾巴糊成一团，简谱/听旋律能清楚分辨每个音。
- **v2.11.8 「听旋律」改为离线预渲染缓冲（终极方案）**：不再有任何实时触发——整条旋律在 JS 里离线合成成一个波形缓冲（`renderMelodyBuffer`：K-S 逐音渲染、真实起音/时值/力度、软削波），一次 `source.start()` 播完。没有定时器竞态、没有节点生命周期、没有调度——只剩 Web Audio 最基础的「播一个缓冲」。**新增 `verify-melody-buffer.js`：样本级断言每个音的时窗都有能量、间隙静音、峰值有界、重音还原、极短音不丢**——「只剩最后一个音」在交付前被机器拦截。verify-replay.js 已删除（被取代）。
- **降级**：Karplus-Strong 拨弦物理建模（零采样、不依赖网络）。**v2.11.6 起主用 AudioWorklet 版**（`ks-pluck` 处理器，Blob URL 内联加载）：循环缓冲内做 `y=0.5(b[i]+b[i-1])` 两点平均 + 阻尼 0.996 + 包络，纯数学、所有系数 ≤1——**任何环境都不可能自激、不受 DelayNode 量化影响、采样级音准**。DelayNode 版仅作老浏览器降级。环外 +3dB@7kHz 提亮，默认音量 0.65。
- **v2.11.7 常驻节点 + 消息触发（修生命周期竞态）**：v2.11.6 每音新建 AudioWorkletNode 仍出现「只剩最后一个音」→ 改为**一个常驻节点 + `port.postMessage` 触发音符**，声部数组在处理器内管理（自动回收），无每音创建/参数/断连。新增 `test/verify-ks-processor.js`：提取真实处理器代码在 Node 里仿真音频线程——5 音全部产生能量（rms 0.02~0.03、峰值 0.3~0.71 有界）+ 复音混音验证。
- **v2.11.6 根因复盘（重要教训）**：Chrome 的 DelayNode 有 128 样本（一个渲染量子）的最小延迟——「单样本延迟」两点平均在 Chrome 里变成梳状滤波器（多数音高被杀死、个别音高落在峰值上「炸」出来）；node-web-audio-api 无此量化所以复现环境测不出来。**以后做物理建模：环路滤波一律进 AudioWorklet，别用 DelayNode/Biquad 节点搭反馈环**（biquad 在个别实现里还会失稳爆炸）。
- **v2.11.5 回放报告 + 去掉无谓等待**：「听旋律」不再 `waitSampler(2000)`（旋律走 K-S 与采样器无关，白等 2 秒）；结果页新增回放报告行——演奏完显示「回放完成 · 触发 N/N ✓」，若触发数不足则显示警告文案，用户可直接看到并反馈。
- **v2.11.4 听旋律固定走 K-S 专用通道**：采样器在用户浏览器里「连续多音触发只剩最后一个音」（单音点按正常、复现环境正常，环境相关无法远程修），且三次回归采样器路径均复现该现象 → 「听旋律」永久使用 K-S（`playMelodyNote`，全环境可靠、实测全部音发声）；采样器保留给简谱点按/和弦走向/节奏型。**重音还原**：basic-pitch 振幅 → 力度，快速模式无振幅时从**录音 PCM 按每音 [start,end] 窗口算 RMS** → 力度（两种模式都有强弱还原）。
- **v2.10.2 提亮**：采样器末端加 Tone.Filter 高频提升 +4dB@10kHz（FluidR3 GM 音源偏暗）；实测采样文件为 128kbps/44.1kHz/立体声、时长约 1.2s，码率正常，闷是 GM 音色特性而非编码缺陷。
- **v2.10.3 致命 bug 修复（音高低 2~3 八度）**：Tone.js v14 的 `triggerAttackRelease` 把纯数字按**赫兹**解释（`FrequencyClass.defaultUnits="hz"`，查证 Sampler.ts 源码），直接传 MIDI 数字（如 60）会被当成 60Hz ≈ MIDI 34，整条旋律低 2~3 个八度、糊成低音隆隆声——这是「又闷、听不出旋律」的真正根因。修复：`playNote` 先 `freq = 440×2^((midi-69)/12)` 转频率再传，同时浮点 midi 的音分偏移得以保留。
- **v2.10.3 节奏高还原演奏**：「听旋律」按转录的真实起音时间/时值逐音演奏（不再等速念谱），力度跟随哼唱响度（basic-pitch 振幅归一化），简谱高亮跟随真实起音；简谱数字横向间距按音长拉伸（节奏可视化）。
- **v2.11.2 修复「电流声」——K-S 反馈环路数值失稳爆炸**：用户反馈旋律回放是电流声。复现环境实测（node-web-audio-api 隔离测量）：**biquad 低通放进 K-S 反馈环会导致环路失稳，能量指数爆炸到 rms≈3.7e21（满幅噪声=电流声）**。修复：换回**经典 Karplus-Strong 结构**——周期延迟 + 两点平均滤波 `0.5(x + x·z⁻¹)`（任意频率增益 ≤1，数学上不可能自激）+ 阻尼 0.985。实测新环路峰值 rms=0.055 有界、频谱平坦度 0.31（乐音感）。教训：噪声激励的物理建模环路里**不能放会改变相位的 biquad**；复现脚本已改为「隔离上下文 + 平坦度 + 有界性」三项指标自动检测。
- **v2.11.1 旋律回放改走 K-S 专用通道**：用户三次反馈「听旋律只播最后一个音」——用 Node + node-web-audio-api 跑**真实 Tone.js 音频引擎复现**（`test/tone-repro/repro.mjs`）：核心调度逻辑两条路径都验证 5/5 发声、RMS 连续，问题定位为浏览器环境相关（采样器依赖 37 个网络采样 + Tone 状态机，在部分浏览器静默）。修复：`playMelodyNote` 直接 Karplus-Strong（只用核心 Web Audio API，全环境可靠），采样器保留给简谱点按/和弦/节奏。诊断面板新增「最近回放」行（触发 N/总数 + 路径），下次出问题直接报数字。
- **v2.10.4 修复「只播最后一个音」**：v2.10.3 把整段旋律一次性预调度到几秒之后（Tone.now()+onset），预调度被静默导致只有最后音发声。改为**逐音 setTimeout 在真实起音时刻触发**（每次只短程调度 ~20ms），节奏不变、不再预调度；`stopAllTones` 顺带取消未触发的旋律定时器（防新旧回放叠加）。新增 `test/verify-replay.js`：从 index.html 提取真实 replayMelody 在模拟时钟下运行，断言不丢音、起音时刻=真实节奏、短程调度、音长不压下一音、响度→力度、浮点 midi 保留。
- **v2.10.3 音量**：采样器 -3→-1dB、K-S 默认 0.5→0.65、velByPitch 0.82→0.9、节奏/走向/扫弦力度整体上调。
- **关键修复**：所有播放函数 `await ensureAudioStarted()`（同时唤醒 Tone + 原生 AudioContext，**必须在用户手势内**）；`waitSampler()` 最多等 2 秒（之前 6 秒导致国内用户感觉「没声音」）；调度时间早于 currentTime 时立即发声。
- **测试声音按钮**：录音屏，点击立即用 Karplus-Strong 发声（不等采样），并显示 Tone.Master 音量/静音诊断。

---

## 三、文件结构

```
hum-key/
├── index.html            ★ 主程序（自包含，内含内联的 dsp/key/guitar-map 逻辑）
├── dsp.js                 YIN 音高检测 + 分段 + 八度修正（纯函数，测试用）
├── key.js                 定调（K-S + 重心/音级分布 + decideMode，纯函数，测试用）
├── guitar-map.js          24 调数据表（do位置/变调夹/和弦，测试用）
├── 启动.bat               一键启动 App（选2起本地服务器 :8017）
├── server.mjs             极简静态服务器（可选）
├── basic-pitch-server/    高精度后端（FastAPI + basic-pitch）
│   ├── main.py            /transcribe 接口（返回音符+调性），已加 CORS
│   ├── requirements.txt
│   ├── runtime.txt        锁定 Python 3.11（部署用）
│   ├── 启动后端.bat        本地一键启动（用 venv，:8000）
│   ├── venv/              已建好的 Python 3.9 虚拟环境（basic-pitch 已装好）
│   └── README.md
└── test/
    ├── test.js            语法检查 + 模块行为测试
    ├── e2e.js             端到端（合成5调：D/G/C大调 + Am/Em小调）
    ├── verify-new.js      简谱/指法/和弦命名/变调夹映射
    ├── verify-ending.js   结束音不主导（4场景）
    ├── verify-chords.js   旋律驱动和弦（harmonizeMelody）
    ├── verify-merge.js    多段补充哼唱合并（同调提升/不同调降置信）
    ├── verify-melody-buffer.js 听旋律预渲染缓冲（逐音能量/间隙/有界/重音）
    ├── verify-ks-processor.js  AudioWorklet 处理器仿真（每音能量/有界）
    ├── verify-essentia-vote.js  Essentia 投票（一致/关系调/冲突）
    └── bench/             基准 harness（24调×7模式合成集 + mir_eval 评分）
```

> ⚠️ `index.html` 里的内联 JS 与 `dsp.js`/`key.js`/`guitar-map.js` 是**同一份逻辑的两份拷贝**，改算法时**必须两边同步**，否则测试和线上不一致。

---

## 四、basic-pitch 后端（高精度模式）

- **本地已跑通**（最重要）：`basic-pitch-server/venv/` 已装好全部依赖（Python 3.9 + basic-pitch 0.4.0 + onnxruntime）。
- **启动**：双击 `basic-pitch-server/启动后端.bat`，跑在 `http://127.0.0.1:8000`。
- **App 接入**：诊断面板填后端地址，或**自动探测**（App 启动时自动 fetch `127.0.0.1:8000/health`，通了就自动启用）。结果页右上角显示「高精度/快速模式」。
- **验证过**：合成 B-D-F# 三音 → basic-pitch 准确检测 → 判 B 小调 conf=1.0。
- **坑**：basic-pitch 在 **Python 3.12 装不上**（distutils 被移除），务必用 3.9~3.11。PyPI 上 Python 版 basic-pitch 最新就是 **0.4.0**（1.0.1 是 npm 的 JS 版，别搞混）。
- **note_events 是元组列表** `(start, end, pitch_midi, amplitude, pitch_bends)`，不是对象（main.py 已处理）。

---

## 五、关键环境信息

- **portable node**：`/c/Users/keyou/.tools/node-v20.15.0-win-x64/node.exe`（系统 PATH 里没有 node，测试要用这个绝对路径）。
- **Python**：系统默认 3.12（装不了 basic-pitch），但 `py -3.9` / `py -3.8` 可用。
- **跑测试**：
  ```bash
  cd /c/Users/keyou/hum-key
  /c/Users/keyou/.tools/node-v20.15.0-win-x64/node.exe test/test.js
  /c/Users/keyou/.tools/node-v20.15.0-win-x64/node.exe test/e2e.js
  /c/Users/keyou/.tools/node-v20.15.0-win-x64/node.exe test/verify-ending.js
  /c/Users/keyou/.tools/node-v20.15.0-win-x64/node.exe test/verify-chords.js
  ```
- **无浏览器/麦克风**：本环境无法真机测声音和哼唱，音频逻辑只能靠代码审查 + 合成音频测定调。

---

## 六、已修的 bug 清单（别重复踩）

1. 终点一票否决（结束音≥300ms=主音就硬判）→ 移除，改门控弱加权。
2. 「默认偏大调」偏见（关系大小调模糊时硬掰大调）→ 保持原判。
3. **主音/调式互相拉扯**（关系大小调翻转改主音）→ 重构为「先锁主音再定调式」。
4. Tone.start() 不 await（fire-and-forget 导致无声）→ async ensureAudioStarted。
5. 采样加载 6 秒才降级（国内用户以为没声音）→ 2 秒 + Karplus-Strong 立即发声。
6. note_events 元组 vs 对象（后端报错）→ 兼容处理。
7. pkg_resources 缺失（setuptools 82 移除）→ 装 setuptools<81。
8. CORS 缺失（前端跨域调后端失败）→ 加 CORSMiddleware。

---

## 七、下一步 TODO / 优化项

- ✅【高价值，v2.9.0 已做】basic-pitch **振幅做「节拍强度」权重**：重心音 = 时长 × 相对响度。后端 `main.py` 输出 `amplitude`，前端 `transcribeBackend` 透传为 `amp`，`key.js`/内联 `detectKey` 的 `ampWeight()` 按均值归一化并夹到 [0.3, 2]（快速模式无振幅 → 退化为纯时长，混入的无振幅音符按中性权重）。
- ✅【高价值，v2.9.0 已做】展示**前两名候选调**：`detectKey` 返回 `top2`（第一名=检测结果，第二名=关系大小调，用 confidence 做百分比拆分），结果页新增 `.alt-hint` 行显示「大概率 B 小调（67%）· 也可能是 D 大调」。
- ✅【高价值，v2.10.0 已做】**多段补充哼唱**：结果页「再哼一段，提高准确率」按钮（最多 5 段），每段单独定调保存、合并后重判（多段时结束音不加权），显示每段倾向/一致性警告/置信度变化；「再测一次」完全清空。
- ✅【v2.10.0 已做】**大小调双显示模式**：小调默认谱面记法「D 大调（B 小调）」+ 专业模式按钮切真实调性（localStorage 持久化）；capo/简谱/do位置始终按真实调性渲染。
- ✅【v2.10.0 已做】音频加固：K-S 降级音量 0.25/0.3→0.4、采样器 -6dB→-3dB、调度时间过时立即发声；诊断面板加「后端」行。
- 【中】Essentia 从「仅展示一致/不一致」升级为「参与投票」。
- 【结论：不改】重心/音级分布权重 `CENTROID_WEIGHT=0.04`/`DOMINANT_WEIGHT=0.04` 维持不动——2026-08-14 实验：权重越大「矛盾输入」置信度越虚高（0.26→0.48），同调合并提升不依赖它（0.70→0.91 靠 K-S+音阶成员），详见「定调算法」一节。
- 【低】证据链里三度音名用了降号（A 大调的大三度显示 Db 而非 C#），是 SPELL 表的降号记法，属化妆问题。

---

## 八、部署

- **前端**：GitHub Pages（push 到 main 自动部署，约 1 分钟生效）。国内访问常被墙/慢，可本地 `启动.bat`。
- **后端**：Render/Railway（需外币卡，`runtime.txt` 已锁 Python 3.11）；或**本地 venv 跑**（免费、无需卡、国内无障碍）。

---

## 九、给新窗口的一句话

改算法前先看：`key.js` 的 `detectKey`（锁主音）+ `decideMode`（定调式）是当前核心；改完**必须同步到 index.html 内联版**并跑 `test/*.js` 全套回归。
