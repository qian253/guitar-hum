# -*- coding: utf-8 -*-
"""chord_lib.py — 吉他和弦指法库（v2.23.0）
放后端的原因：①和弦库会持续扩充(进阶指法/转位/七和弦)而不用发版前端；
②前端零后端时使用内置精简版回退,两者字段一致。
数据格式(6弦→1弦):
  frets: 品位数组, null=不弹/闷音, 0=空弦, n=按第 n 品
  fingers: 推荐手指(1食指~4小指), 0=无
  barre: 横按品位(0=无横按)
  hard: 是否对新手偏难(横按等)
"""
CHORD_LIB = {
    # ---- C 调家族(开放,新手友好) ----
    "C":  {"frets": [None, 3, 2, 0, 1, 0], "fingers": [0, 3, 2, 0, 1, 0], "barre": 0, "hard": False},
    "Dm": {"frets": [None, None, 0, 2, 3, 1], "fingers": [0, 0, 0, 2, 3, 1], "barre": 0, "hard": False},
    "Em": {"frets": [0, 2, 2, 0, 0, 0], "fingers": [0, 2, 3, 0, 0, 0], "barre": 0, "hard": False},
    "G":  {"frets": [3, 2, 0, 0, 0, 3], "fingers": [3, 2, 0, 0, 0, 4], "barre": 0, "hard": False},
    "Am": {"frets": [None, 0, 2, 2, 1, 0], "fingers": [0, 0, 2, 3, 1, 0], "barre": 0, "hard": False},
    # ---- G 调家族(开放) ----
    "D":  {"frets": [None, None, 0, 2, 3, 2], "fingers": [0, 0, 0, 1, 3, 2], "barre": 0, "hard": False},
    "E":  {"frets": [0, 2, 2, 1, 0, 0], "fingers": [0, 2, 3, 1, 0, 0], "barre": 0, "hard": False},
    "A":  {"frets": [None, 0, 2, 2, 2, 0], "fingers": [0, 0, 1, 2, 3, 0], "barre": 0, "hard": False},
    # ---- 稍好按的横按(进阶,先只上这两个) ----
    "F":  {"frets": [1, 3, 3, 2, 1, 1], "fingers": [1, 3, 4, 2, 1, 1], "barre": 1, "hard": True},
    "Bm": {"frets": [None, 2, 4, 4, 3, 2], "fingers": [0, 1, 3, 4, 2, 1], "barre": 2, "hard": True},
    # ---- 常用七和弦(开放,点缀用) ----
    "E7": {"frets": [0, 2, 0, 1, 0, 0], "fingers": [0, 2, 0, 1, 0, 0], "barre": 0, "hard": False},
    "G7": {"frets": [3, 2, 0, 0, 0, 1], "fingers": [3, 2, 0, 0, 0, 1], "barre": 0, "hard": False},
}

VERSION = 1
