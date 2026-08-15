# -*- coding: utf-8 -*-
"""test_cleaner.py — 音符清洗器验收测试（v2.18.0）
1) 需求自验证样例：G3(80) #G3(90) A3(300) F3(100) G3(250) B3(400) → G3 A3 G3 B3
2) 边界用例：全长音、低置信度、半音对都长、连续毛刺、大跳真音、空/单音
3) 主音检测对比：清洗前后分别喂给 后端 detect_key 与 前端 key.js（node 跑真实产品定调器）

用法：cd basic-pitch-server && venv/Scripts/python.exe test_cleaner.py
"""
import json
import os
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from note_cleaner import clean_notes  # noqa: E402
from main import detect_key  # noqa: E402

NODE = r"C:\Users\keyou\.tools\node-v20.15.0-win-x64\node.exe"
RUNNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "bench", "run_detect.js")

MIDI = {"G3": 55, "G#3": 56, "A3": 57, "F3": 53, "B3": 59, "C4": 60, "D4": 62, "F#3": 54, "D#3": 51}

failures = 0


def ok(name, cond, extra=""):
    global failures
    print("  %s %s%s" % ("PASS" if cond else "FAIL", name, ("  " + extra) if extra else ""))
    if not cond:
        failures += 1


def mk(name, dur, start, conf=None, amp=0.5):
    n = {"midi": MIDI[name], "dur": dur, "start": start, "end": round(start + dur, 3), "amplitude": amp}
    if conf is not None:
        n["confidence"] = conf
    return n


def names(notes):
    n = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return [n[int(round(x["midi"])) % 12] + str(int(round(x["midi"])) // 12 - 1) for x in notes]


def frontend_detect(notes):
    """用真实产品定调器（key.js）跑主音检测"""
    body = [{"midi": n["midi"], "dur": n["dur"]} for n in notes]
    p = subprocess.run([NODE, RUNNER, "krumhansl"], input=json.dumps(body),
                       capture_output=True, text=True, encoding="utf-8")
    return json.loads(p.stdout.strip())


print("【1】需求自验证样例：G3(80) #G3(90) A3(300) F3(100) G3(250) B3(400) → G3 A3 G3 B3")
dirty = [mk("G3", 0.08, 0.00), mk("G#3", 0.09, 0.08), mk("A3", 0.30, 0.17),
         mk("F3", 0.10, 0.47), mk("G3", 0.25, 0.57), mk("B3", 0.40, 0.82)]
cleaned, report = clean_notes(dirty)
print("  原始:", names(dirty), "共", len(dirty), "个音")
for r in report["removed"]:
    print("  剔除:", r["reason"])
print("  清洗后:", names(cleaned))
ok("样例输出 == [G3, A3, G3, B3]", names(cleaned) == ["G3", "A3", "G3", "B3"], "实际 " + str(names(cleaned)))
ok("合并音 G3 时值=0.17s 且为起点音高", cleaned and cleaned[0]["dur"] == 0.17 and cleaned[0]["midi"] == MIDI["G3"])
ok("清洗报告含原始序列/剔除明细/参数", len(report["raw"]) == 6 and len(report["removed"]) == 2 and "params" in report)

print()
print("【2】边界用例")
# 全为长音 → 原样保留
long_notes = [mk("C4", 0.4, 0), mk("D4", 0.4, 0.4)]
c2, _ = clean_notes(long_notes)
ok("全长音不动", names(c2) == ["C4", "D4"])
# 半音对都 ≥120ms → 不合并
no_gliss = [mk("G3", 0.3, 0), mk("G#3", 0.4, 0.3)]
c3, _ = clean_notes(no_gliss)
ok("半音对都长不合并", names(c3) == ["G3", "G#3"])
# 极短音（<100ms）删除
short_note = [mk("C4", 0.09, 0), mk("D4", 0.3, 0.09)]
c4, _ = clean_notes(short_note)
ok("极短音删除", names(c4) == ["D4"])
# 低置信度（confidence 字段）
low_conf = [mk("C4", 0.3, 0, conf=1.0), mk("D4", 0.3, 0.3, conf=0.1)]
c5, _ = clean_notes(low_conf)
ok("低置信度删除（confidence 字段）", names(c5) == ["C4"])
# 低置信度（amplitude 代理）
low_amp = [mk("C4", 0.3, 0, amp=1.0), mk("D4", 0.3, 0.3, amp=0.05)]
c6, _ = clean_notes(low_amp)
ok("低置信度删除（amplitude 代理）", names(c6) == ["C4"])
# 连续毛刺（F3 与 D#3 间隔 2 半音不会触发滑音合并；D#3 先删、F3 随后被毛刺规则删）
spikes = [mk("A3", 0.2, 0), mk("F3", 0.11, 0.2), mk("D#3", 0.11, 0.31), mk("G3", 0.25, 0.42)]
c7, r7 = clean_notes(spikes)
ok("连续毛刺全部清除", names(c7) == ["A3", "G3"], str(names(c7)))
# 首尾音不受毛刺规则影响（无前音/后音可比）
edge = [mk("F3", 0.12, 0), mk("G3", 0.3, 0.12), mk("A3", 0.3, 0.42)]
c8, _ = clean_notes(edge)
ok("首尾音保留（毛刺规则跳过首尾）", names(c8) == ["F3", "G3", "A3"])
# 空输入 / 单音
c9, _ = clean_notes([])
ok("空输入安全", c9 == [])
c10, _ = clean_notes([mk("G3", 0.4, 0)])
ok("单音保留", len(c10) == 1)

print()
print("【3】主音检测对比（清洗前 vs 清洗后）")
print("  脏输入:", names(dirty))
print("  净输入:", names(cleaned))
bk_before = detect_key(dirty)
bk_after = detect_key(cleaned)
print("  后端 detect_key  清洗前: %s  清洗后: %s" % (bk_before["key"], bk_after["key"]))
fe_before = frontend_detect(dirty)
fe_after = frontend_detect(cleaned)
print("  前端 key.js     清洗前: %s (conf %s)  清洗后: %s (conf %s)" % (
    fe_before.get("keyName"), fe_before.get("confidence"), fe_after.get("keyName"), fe_after.get("confidence")))
ok("前端 key.js 清洗后判 G 大调（真实调）", fe_after.get("rootPC") == 7 and fe_after.get("mode") == "major",
   "实际 " + str(fe_after.get("keyName")))
ok("后端 detect_key 清洗前被脏音带偏、清洗后判对（B小调→G大调）",
   bk_before["rootPC"] != 7 and bk_after["rootPC"] == 7,
   "清洗前 " + str(bk_before["key"]) + " 清洗后 " + str(bk_after["key"]))
print("  说明：前端 key.js 靠 log 时长压缩对少量短毛刺本身有抗性（清洗前后都判 G 大调，")
print("        清洗后置信度更稳）；后端简易 K-S 与简谱/重心/配和弦等下游则直接被脏音带偏，")
print("        清洗器正是为「转录输出之后、一切分析之前」兜底。")

print()
if failures:
    print("✗ %d 项失败" % failures)
    sys.exit(1)
print("✓ 音符清洗器验收全部通过")
