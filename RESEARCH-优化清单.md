# 调式识别精度 · 调研与优化清单

> 2026-08-14 整理，2026-08-14 晚更新（v2.11.0 已落地 P0-1/P0-2，P1-1 有结论）。
> 上游参考：v2.11.0 代码现状（key.js / dsp.js / basic-pitch-server / index.html 内联版）。

---

## 一、开源方案调研（按与我们场景的适配度排序）

### A. 评估与基准（改造算法前必须先有尺子）

| 项目 | 说明 | 对我们的价值 |
|---|---|---|
| [mir_eval](https://github.com/craffel/mir_eval) | MIR 标准评估库，含 key 指标（MIREX weighted score 等） | **最高价值**：给现有定调管线建自动化评分，每次改算法前先测 |
| [GiantSteps](https://github.com/GiantSteps/giantsteps-key-dataset) | 带调性标注的 EDM 数据集（MIREX 基准常用） | 真实音频测试集来源 |
| 我们自己合成 24 调旋律集 | e2e.js 已有 5 调合成器 | 扩到 24 调 × 多旋律变体，作回归基准 |

### B. 同类型算法（K-S 家族，可对照参考实现与 profile）

| 项目 | 说明 | 对我们的价值 |
|---|---|---|
| [libkeyfinder](https://github.com/mixxxdj/libkeyfinder) | Mixxx DJ 软件内置的调性检测库（C++，chroma+K-S 变体，全球 DJ 用了十几年） | 参考它的 chroma 预处理和 profile 选择；有 [Rust 绑定](https://github.com/evanpurkhiser/libkeyfinder-sys) |
| [Essentia KeyExtractor](https://essentia.upf.edu/) | **我们已加载但只做展示** | 升级为参与投票（见优化 P0-2） |
| [music-key-finder (Corentin-Lcs)](https://github.com/Corentin-Lcs/music-key-finder) | K-S 教学级实现 | 对照我们的实现做 sanity check |
| [bpm-detector (libraz)](https://github.com/libraz/bpm-detector) | BPM+调性一体小工具 | 参考简单管线的写法 |

### C. 神经方法（音频级，可在 basic-pitch 后端跑）

| 项目 | 说明 | 对我们的价值 |
|---|---|---|
| [madmom.features.key](https://madmom.readthedocs.io/en/v0.16.1/modules/features/key.html) | CNNKeyRecognitionProcessor，深度学习调性识别（完整歌曲音频训练），Python 推理 | 后端加一个裁判，与 K-S/Essentia 投票 |
| [madmom-infer](https://github.com/openmirlab/madmom-infer) | madmom 的纯 numpy 推理版（免 Cython 编译，部署友好） | 免编译，更适合 Render/本地 venv |
| [Masked Contrastive Pre-Training for Key Detection (arXiv)](https://arxivlens.com/paperview/details/masked-contrastive-pre-training-improves-music-audio-key-detection-8182-877ac5a2) | 最新研究方向的代表（自监督预训练） | 了解前沿；重，不建议直接上 |

### D. Claude Code skill

- 现有官方 skill 列表（dataviz / update-config / loop 等）**没有音频/MIR 类 skill**。
- 建议**自建一个 skill**（如 `key-eval`）：封装「合成测试集 → mir_eval 评分 → 报告」，以后每次改定调算法自动跑基准。我可以帮你建。

---

## 二、当前产品配置（v2.10.4 现状）

### 转录层
| 项 | 当前配置 |
|---|---|
| 高精度 | basic-pitch 后端（ONNX ICASSP 2022，venv Py3.9，:8000，`/transcribe` 返回音符+调性+振幅），前端自动探测 health |
| 快速降级 | YIN（CMNDF，阈值 0.20，50Hz~1100Hz）+ 滞回分段（0.7/0.4 半音、80/120ms）+ 孤立八度尖峰修正 + 音分中位数补偿（±50 clamp） |
| 简谱转录 | JIANPU_OPTS 更灵敏参数（leaveCents 0.5 / mergeSlop 0.05） |

### 定调层（key.js detectKey）
| 项 | 当前配置 |
|---|---|
| 主音锁定 | 12 根音打分：K-S 相关 + 音阶成员(×0.20) + 重心音(×0.04，权重=时长×振幅) + 音级分布(×0.04) + 吉他偏好(×0.02) |
| 调式判定 | 主音锁定后同主音大小调二选一：大三度/小三度时长、三和弦骨架、导音次数；小调须明显占优(×1.25) |
| K-S profile | Krumhansl & Schmuckler 1982（均值归一） |
| 结束音 | 门控加权 ×1.5（仅完整终止）；多段合并时 noEndingBoost |
| 置信度 | confidence = margin/0.18；短片段封顶 0.7、调式模糊封顶 0.6 |
| 多段 | 补充哼唱 ≤5 段合并重判，每段单独定调展示倾向 |
| 跨校验 | Essentia KeyExtractor **仅展示一致/不一致，不参与打分** |
| 展示 | top2 候选 + 谱面/专业双模式 |

### 测试
test.js / e2e.js / verify-ending.js / verify-chords.js / verify-merge.js / verify-replay.js，共 6 套全绿。

---

## 三、可优化清单（按性价比排序）

### P0 —— 先建尺子，再谈精度（✅ 0-1、0-2 已落地 v2.11.0）

| # | 优化 | 改动位置 | 预期收益 | 成本/风险 | 状态 |
|---|---|---|---|---|---|
| 0-1 | **基准评测 harness**：24 调 × 7 模式 = 168 条合成集 + mir_eval 评分 + 一键脚本 | `test/bench/`（gen_dataset.py / run_detect.js / score.py） | 从此每次改算法有量化依据 | 低 | ✅ 已做 |
| 0-2 | **Essentia 参与投票**：一致 +0.08 / 关系调 +0.02 / 冲突 ×0.8（仅单段；`applyEssentiaVote` 纯函数 + verify-essentia-vote.js） | finalizeNotes + relHint 展示 | 零新增成本拿第二意见 | 低 | ✅ 已做 |

### P1 —— 多裁判与 profile 升级

| # | 优化 | 改动位置 | 预期收益 | 成本/风险 | 状态 |
|---|---|---|---|---|---|
| 1-1 | **profile 对比选优** | key.js 常量 + 基准脚本 | 文献表明差异可达 5-10% | 低 | ✅ 有结论：**不换**。K-S1982 与 Albrecht-Shanahan 在 168 条基准上完全持平（92.9%/主音100%），Temperley 78% 更差。唯一弱点=无三音的极短旋律（信息论不可分） |
| 1-2 | **后端多算法仲裁**：madmom(-infer) CNN key 与 libkeyfinder 结果随 /transcribe 返回，前端投票 | basic-pitch-server | 音级+音频级多视角 | 中 | ⏳ 待做 |
| 1-3 | **后端结果与前端定调解耦对比**：main.py 的 Python 版 K-S 结果做一致性统计，冲突时降置信度 | main.py + 前端 | 低成本交叉验证 | 低 | ⏳ 待做 |

### P2 —— 更高阶（收益递减，谨慎）

| # | 优化 | 改动位置 | 预期收益 | 成本/风险 |
|---|---|---|---|---|
| 2-1 | 神经方法（madmom CNN / KeyNet 类）接入后端作为裁判 | basic-pitch-server | 全曲音频训练，对哼唱短句未必更强 | 高；需 ONNX 转换/依赖 |
| 2-2 | 置信度校准：用基准集拟合 confidence→正确率映射，让「62%」就是真实正确率 | key.js + 基准 | 展示更可信 | 中 |
| 2-3 | 权重自动标定：在基准集上 grid search（此前只用手工 6 判例扫过 0.04~0.12） | 基准脚本 → key.js | 把 0.04 之类的手拍值换成数据驱动 | 中；需防过拟合基准集 |

### 明确不做
- 换掉「先锁主音再定调式」两步架构（PROJECT.md 已注：别改回旧逻辑）。
- 结束音一票否决（已废弃）。
- 单文件 HTML 架构不动（React 重写另议）。

---

## 四、下一步建议

1. ✅ P0-1、P0-2 已落地（v2.11.0）；P1-1 有结论（不换 profile）。
2. 下一步做 **P1-3**（后端 K-S 一致性降置信度，成本最低）→ **P1-2**（madmom CNN 接入后端）。
3. 基准复现：`python test/bench/gen_dataset.py && python test/bench/score.py krumhansl`（数据目录已被 .gitignore）。
