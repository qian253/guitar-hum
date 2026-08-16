# -*- coding: utf-8 -*-
"""rhythm_lib.py — 右手节奏型库（v2.23.0）
按情绪分两组:「嗨一点」(扫弦/律动) 与「情歌」(分解/舒缓)。
前端每次结果只推荐 3 个:大调 2 嗨+1 情歌,小调 1 嗨+2 情歌。
字段: id/name/type('strum'|'pluck')/strings(分解弦序)/pattern(图示)/desc/beats(每小节拍数)
"""
RHYTHM_LIB = {
    "嗨一点": [
        {"id": "pop-strum", "name": "流行扫弦", "type": "strum", "strings": [],
         "pattern": "↓ ↓↑ ↑↓↑", "desc": "弹唱最常用,欢快带感", "beats": 4},
        {"id": "root-strum", "name": "根音+扫弦", "type": "strum", "strings": [],
         "pattern": "根 ↓ 根 ↓", "desc": "一拍根音一拍扫,稳又嗨", "beats": 4},
        {"id": "palm-strum", "name": "闷音扫弦", "type": "strum", "strings": [],
         "pattern": "↓↑ 闷↓↑ 闷", "desc": "手掌轻压琴桥,节奏感强", "beats": 4},
        {"id": "rock-8th", "name": "八分扫弦", "type": "strum", "strings": [],
         "pattern": "↓↑↓↑ ↓↑↓↑", "desc": "摇滚/民谣快歌首选", "beats": 4},
    ],
    "情歌": [
        {"id": "5323", "name": "5323 分解", "type": "pluck", "strings": [5, 3, 2, 3],
         "pattern": "5 3 2 3", "desc": "最温柔的分解,慢歌万能", "beats": 4},
        {"id": "5321", "name": "5321 分解", "type": "pluck", "strings": [5, 3, 2, 1],
         "pattern": "5 3 2 1", "desc": "分解到高音,清澈透亮", "beats": 4},
        {"id": "4321", "name": "4321 分解", "type": "pluck", "strings": [4, 3, 2, 1],
         "pattern": "4 3 2 1", "desc": "从四弦起,中音区更暖", "beats": 4},
        {"id": "waltz", "name": "三拍子", "type": "pluck", "strings": [5, 3, 2],
         "pattern": "5 3 2", "desc": "华尔兹感,适合圆舞曲风", "beats": 3},
    ],
}

VERSION = 1
