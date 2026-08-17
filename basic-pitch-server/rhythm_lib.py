# -*- coding: utf-8 -*-
"""rhythm_lib.py — 右手节奏型库（v2.32 扩到 30 种）
记谱约定:根=和弦根音弦;下/上/闷/切=扫弦方向(与播放器逐拍严格对应)。
按情绪分两组:「嗨一点」(扫弦/律动) 与「情歌」(分解/抒情)。
前端每次结果推荐 3 个:大调 2 嗨+1 情歌,小调 1 嗨+2 情歌;「换一批」轮换。
"""
RHYTHM_LIB = {
    "嗨一点": [
        {"id": "pop-strum", "name": "流行扫弦", "type": "strum", "strings": [], "pattern": "下 下上 上下上 下", "desc": "弹唱万能,欢快带感", "beats": 4},
        {"id": "slow-rock", "name": "慢摇滚", "type": "strum", "strings": [], "pattern": "下 上下上 下上下 下", "desc": "经典慢摇,情绪推进", "beats": 4},
        {"id": "chop-strum", "name": "切音扫弦", "type": "strum", "strings": [], "pattern": "下切 上切 下切 上切", "desc": "手掌切音,节奏感爆棚", "beats": 4},
        {"id": "rock-8th", "name": "摇滚八分", "type": "strum", "strings": [], "pattern": "下上 下上 下上 下上", "desc": "摇滚/快歌首选", "beats": 4},
        {"id": "country", "name": "乡村根扫", "type": "strum", "strings": [], "pattern": "根 下 根 下", "desc": "根音+扫弦,轻快摇摆", "beats": 4},
        {"id": "folk-16", "name": "民谣十六分", "type": "strum", "strings": [], "pattern": "下上下上 下上下上 下上下上 下上下上", "desc": "密集十六分,民谣快歌", "beats": 4},
        {"id": "sync-heavy", "name": "重扫切分", "type": "strum", "strings": [], "pattern": "下 下上 下 上切", "desc": "切分重音,很带感", "beats": 4},
        {"id": "funk", "name": "放克闷扫", "type": "strum", "strings": [], "pattern": "闷上 下 闷上 下", "desc": "闷音律动,复古放克", "beats": 4},
        {"id": "march", "name": "进行曲感", "type": "strum", "strings": [], "pattern": "下 下 下 下上", "desc": "坚定有力", "beats": 4},
        {"id": "waltz-fast", "name": "三拍子舞曲", "type": "strum", "strings": [], "pattern": "下 下上 下", "desc": "3/4 华尔兹,转圈感", "beats": 3},
        {"id": "reggae", "name": "雷鬼反拍", "type": "strum", "strings": [], "pattern": "闷 下 闷 下", "desc": "反拍律动,慵懒摇摆", "beats": 4},
        {"id": "power", "name": "强力扫弦", "type": "strum", "strings": [], "pattern": "下 下 闷下 下", "desc": "力量型副歌", "beats": 4},
        {"id": "folk-fast", "name": "民谣快歌", "type": "strum", "strings": [], "pattern": "下 下 上 下上", "desc": "简单有力的快歌", "beats": 4},
        {"id": "sync-slow", "name": "切分慢摇", "type": "strum", "strings": [], "pattern": "下 闷 下上 闷", "desc": "切分+闷音,高级感", "beats": 4},
        {"id": "party", "name": "派对扫弦", "type": "strum", "strings": [], "pattern": "下上 下 下上 下", "desc": "聚会气氛组", "beats": 4},
    ],
    "情歌": [
        {"id": "gen323", "name": "根三二三", "type": "pluck", "strings": [], "pattern": "根 3 2 3", "desc": "最温柔的基础分解", "beats": 4},
        {"id": "gen321", "name": "根三二一", "type": "pluck", "strings": [], "pattern": "根 3 2 1", "desc": "分解到高音,清澈透亮", "beats": 4},
        {"id": "gen32313", "name": "根三二三一三", "type": "pluck", "strings": [], "pattern": "根 3 2 3 1 3", "desc": "6/8 流动感,适合慢歌", "beats": 6},
        {"id": "arpeggio-up", "name": "琶音上行", "type": "pluck", "strings": [], "pattern": "根 2 3 1", "desc": "层层上行,情绪上扬", "beats": 4},
        {"id": "arpeggio-down", "name": "琶音下行", "type": "pluck", "strings": [], "pattern": "根 1 2 3", "desc": "缓缓下行,安静收尾", "beats": 4},
        {"id": "eight-pluck", "name": "八分分解", "type": "pluck", "strings": [], "pattern": "根 3 2 3 1 3 2 3", "desc": "八分音符流动", "beats": 4},
        {"id": "double-stop", "name": "双音分解", "type": "pluck", "strings": [], "pattern": "根2 根3 根2 根3", "desc": "双音和声,更丰满", "beats": 4},
        {"id": "waltz-pluck", "name": "三拍子分解", "type": "pluck", "strings": [], "pattern": "根 3 2", "desc": "3/4 华尔兹分解", "beats": 3},
        {"id": "waltz-lyric", "name": "三拍子抒情", "type": "pluck", "strings": [], "pattern": "根 2 1", "desc": "抒情华尔兹", "beats": 3},
        {"id": "finger-roll", "name": "轮指分解", "type": "pluck", "strings": [], "pattern": "3 2 1 2 3 2 1 2", "desc": "轮指流畅,像流水", "beats": 4},
        {"id": "bass-line", "name": "低音线条", "type": "pluck", "strings": [], "pattern": "根 2 3 5 3 2", "desc": "6/8 低音旋律线", "beats": 6},
        {"id": "thumb-2", "name": "拇指二指法", "type": "pluck", "strings": [], "pattern": "根 2 3 1 2 3", "desc": "6/8 经典指弹", "beats": 6},
        {"id": "harmonic-ish", "name": "轻透分解", "type": "pluck", "strings": [], "pattern": "3 1 2 1", "desc": "高音区轻透", "beats": 4},
        {"id": "waltz-root", "name": "圆舞曲", "type": "pluck", "strings": [], "pattern": "根 3 2", "desc": "三拍子圆舞曲", "beats": 3},
        {"id": "gen4321", "name": "根四三二一", "type": "pluck", "strings": [], "pattern": "根 4 3 2 1", "desc": "五连分解,柔和铺陈", "beats": 4},
    ],
}

VERSION = 2
