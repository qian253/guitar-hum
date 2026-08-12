/* ============================================================
 * guitar-map.js — 吉他映射数据层（纯数据，无依赖，浏览器/测试共用）
 *
 * 约定：
 *  - 弦号：1弦 = 最细高音弦（E4），6弦 = 最粗低音弦（E2）——中文吉他习惯
 *  - 空弦音（MIDI）：6弦E2=40, 5弦A2=45, 4弦D3=50, 3弦G3=55, 2弦B3=59, 1弦E4=64
 *  - 品位 = 该弦上 do（主音）所在品数，0 = 空弦
 *  - 表键 = 主音 pitch class（0=C, 1=C#/Db, ..., 9=A, ...）——与大/小调统一
 *  - doPositions[].midi 为已验证的真实音高（fret = MIDI − 空弦MIDI，已逐项核对）
 * ============================================================ */

(function (global) {
  'use strict';

  // 空弦：弦号(1高E..6低E) -> MIDI
  var OPEN_MIDI = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };
  // 各弦上每个品对应的 MIDI（0..12 品），供指板图/do 定位计算
  var FRETBOARD = {};
  for (var s = 1; s <= 6; s++) {
    FRETBOARD[s] = [];
    for (var f = 0; f <= 12; f++) {
      FRETBOARD[s].push(OPEN_MIDI[s] + f);
    }
  }

  var MAJOR = {
    0: { // C
      key: 'C大调',
      doPositions: [
        { pos: '5弦3品', label: '低音 do', midi: 48 },
        { pos: '2弦1品', label: 'do', midi: 60 },
        { pos: '1弦8品', label: '高音 do', midi: 72 }
      ],
      playLike: { open: true, label: 'C 大调开放和弦（不夹变调夹）' },
      commonChords: ['C', 'Dm', 'Em', 'F', 'G', 'Am'],
      note: 'F 大横按是唯一难点，先弹 Fmaj7 过渡；C→G 转换只动两根手指。'
    },
    1: { // Db
      key: 'Db大调',
      doPositions: [
        { pos: '5弦4品', label: '低音 do', midi: 49 },
        { pos: '2弦2品', label: 'do', midi: 61 },
        { pos: '1弦9品', label: '高音 do', midi: 73 }
      ],
      playLike: { open: false, label: 'C', capo: 1 },
      commonChords: ['Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm'],
      note: '直接弹 C 调指法夹 1 品即可，不用记新和弦。'
    },
    2: { // D
      key: 'D大调',
      doPositions: [
        { pos: '4弦空弦', label: '低音 do', midi: 50 },
        { pos: '2弦3品', label: 'do', midi: 62 },
        { pos: '1弦10品', label: '高音 do', midi: 74 }
      ],
      playLike: { open: true, label: 'D 大调开放和弦（不夹变调夹）' },
      commonChords: ['D', 'Em', 'F#m', 'G', 'A', 'Bm'],
      note: 'Em→G 只差一根手指，是 D 调最常练的转换；F#m 用横按 2 品。'
    },
    3: { // Eb
      key: 'Eb大调',
      doPositions: [
        { pos: '4弦1品', label: '低音 do', midi: 51 },
        { pos: '2弦4品', label: 'do', midi: 63 },
        { pos: '1弦11品', label: '高音 do', midi: 75 }
      ],
      playLike: { open: false, label: 'D', capo: 1 },
      commonChords: ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm'],
      note: '弹 D 调指法夹 1 品最顺手，指法同 D 调；Bb 是唯一横按。'
    },
    4: { // E
      key: 'E大调',
      doPositions: [
        { pos: '6弦空弦', label: '低音 do', midi: 40 },
        { pos: '4弦2品', label: 'do', midi: 52 },
        { pos: '1弦空弦', label: '高音 do', midi: 64 }
      ],
      playLike: { open: true, label: 'E 大调开放和弦（不夹变调夹）' },
      commonChords: ['E', 'F#m', 'G#m', 'A', 'B', 'C#m'],
      note: 'E、A、B 三个开放和弦能弹大量歌曲；B 可先弹 B7 简化。'
    },
    5: { // F
      key: 'F大调',
      doPositions: [
        { pos: '6弦1品', label: '低音 do', midi: 41 },
        { pos: '4弦3品', label: 'do', midi: 53 },
        { pos: '1弦1品', label: '高音 do', midi: 65 }
      ],
      playLike: { open: true, label: 'F 大调开放和弦（不夹变调夹）' },
      commonChords: ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm'],
      note: 'F 大横按第 1 品是核心，Bb 需小横按；可先用 Fmaj7 过渡。'
    },
    6: { // F#
      key: 'F#大调',
      doPositions: [
        { pos: '6弦2品', label: '低音 do', midi: 42 },
        { pos: '4弦4品', label: 'do', midi: 54 },
        { pos: '1弦2品', label: '高音 do', midi: 66 }
      ],
      playLike: { open: false, label: 'E', capo: 2 },
      commonChords: ['F#', 'G#m', 'A#m', 'B', 'C#', 'D#m'],
      note: '基本全是横按，用 E 调指法夹 2 品最省力，指法与 E 调相同。'
    },
    7: { // G
      key: 'G大调',
      doPositions: [
        { pos: '6弦3品', label: '低音 do', midi: 43 },
        { pos: '3弦空弦', label: 'do', midi: 55 },
        { pos: '1弦3品', label: '高音 do', midi: 67 }
      ],
      playLike: { open: true, label: 'G 大调开放和弦（不夹变调夹）' },
      commonChords: ['G', 'Am', 'Bm', 'C', 'D', 'Em'],
      note: '吉他最顺手的大调之一；Bm 用 Bm7 简化。'
    },
    8: { // Ab
      key: 'Ab大调',
      doPositions: [
        { pos: '6弦4品', label: '低音 do', midi: 44 },
        { pos: '3弦1品', label: 'do', midi: 56 },
        { pos: '1弦4品', label: '高音 do', midi: 68 }
      ],
      playLike: { open: false, label: 'G', capo: 1 },
      commonChords: ['Ab', 'Bbm', 'Cm', 'Db', 'Eb', 'Fm'],
      note: '常记作 G#；弹 G 调指法夹 1 品即可。'
    },
    9: { // A
      key: 'A大调',
      doPositions: [
        { pos: '5弦空弦', label: '低音 do', midi: 45 },
        { pos: '3弦2品', label: 'do', midi: 57 },
        { pos: '1弦5品', label: '高音 do', midi: 69 }
      ],
      playLike: { open: true, label: 'A 大调开放和弦（不夹变调夹）' },
      commonChords: ['A', 'Bm', 'C#m', 'D', 'E', 'F#m'],
      note: 'C#m、F#m 需横按；想轻松可弹 G 调指法夹 2 品。'
    },
    10: { // Bb
      key: 'Bb大调',
      doPositions: [
        { pos: '5弦1品', label: '低音 do', midi: 46 },
        { pos: '3弦3品', label: 'do', midi: 58 },
        { pos: '1弦6品', label: '高音 do', midi: 70 }
      ],
      playLike: { open: false, label: 'A', capo: 1 },
      commonChords: ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm'],
      note: '多为横按；弹 A 调指法夹 1 品最轻松。'
    },
    11: { // B
      key: 'B大调',
      doPositions: [
        { pos: '5弦2品', label: '低音 do', midi: 47 },
        { pos: '2弦空弦', label: 'do', midi: 59 },
        { pos: '1弦7品', label: '高音 do', midi: 71 }
      ],
      playLike: { open: false, label: 'A', capo: 2 },
      commonChords: ['B', 'C#m', 'D#m', 'E', 'F#', 'G#m'],
      note: '几乎全是横按；弹 A 调指法夹 2 品，实际弹唱常用。'
    }
  };

  var MINOR = {
    0: { // Cm
      key: 'Cm小调',
      relativeMajor: 'Eb 大调',
      doPositions: [
        { pos: '5弦3品', label: '低音 do', midi: 48 },
        { pos: '3弦5品', label: 'do', midi: 60 },
        { pos: '1弦8品', label: '高音 do', midi: 72 }
      ],
      playLike: { open: false, label: 'Em', capo: 3 },
      commonChords: ['Cm', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb', '属和弦用 G'],
      note: 'Cm 是横按和弦，弹 Em 调指法夹 3 品更轻松。'
    },
    1: { // C#m
      key: 'C#m小调',
      relativeMajor: 'E 大调',
      doPositions: [
        { pos: '5弦4品', label: '低音 do', midi: 49 },
        { pos: '2弦2品', label: 'do', midi: 61 },
        { pos: '1弦9品', label: '高音 do', midi: 73 }
      ],
      playLike: { open: false, label: 'Am', capo: 4 },
      commonChords: ['C#m', 'E', 'F#m', 'G#m', 'A', 'B', '属和弦用 G#'],
      note: 'C#m 是横按（Am 型第 4 品），新手可移调或用 Am 调夹 4 品。'
    },
    2: { // Dm
      key: 'Dm小调',
      relativeMajor: 'F 大调',
      doPositions: [
        { pos: '4弦空弦', label: '低音 do', midi: 50 },
        { pos: '2弦3品', label: 'do', midi: 62 },
        { pos: '1弦10品', label: '高音 do', midi: 74 }
      ],
      playLike: { open: true, label: 'Dm 小调开放和弦（不夹变调夹）' },
      commonChords: ['Dm', 'F', 'Gm', 'Am', 'Bb', 'C', '属和弦用 A'],
      note: 'Dm 是开放和弦，与 F 调同音阶；Bb 是唯一横按。'
    },
    3: { // Ebm
      key: 'Ebm小调',
      relativeMajor: 'Gb 大调',
      doPositions: [
        { pos: '4弦1品', label: '低音 do', midi: 51 },
        { pos: '2弦4品', label: 'do', midi: 63 },
        { pos: '1弦11品', label: '高音 do', midi: 75 }
      ],
      playLike: { open: false, label: 'Dm', capo: 1 },
      commonChords: ['Ebm', 'Gb', 'Abm', 'Bbm', 'B(即Cb)', 'Db', '属和弦用 Bb'],
      note: '弹 Dm 调指法夹 1 品，指法同 Dm 调。'
    },
    4: { // Em
      key: 'Em小调',
      relativeMajor: 'G 大调',
      doPositions: [
        { pos: '6弦空弦', label: '低音 do', midi: 40 },
        { pos: '4弦2品', label: 'do', midi: 52 },
        { pos: '1弦空弦', label: '高音 do', midi: 64 }
      ],
      playLike: { open: true, label: 'Em 小调开放和弦（不夹变调夹）' },
      commonChords: ['Em', 'G', 'Am', 'Bm', 'C', 'D', '属和弦用 B'],
      note: '全是开放和弦；Em→G 只差一根手指，Bm 可用 Bm7。'
    },
    5: { // Fm
      key: 'Fm小调',
      relativeMajor: 'Ab 大调',
      doPositions: [
        { pos: '6弦1品', label: '低音 do', midi: 41 },
        { pos: '4弦3品', label: 'do', midi: 53 },
        { pos: '1弦1品', label: '高音 do', midi: 65 }
      ],
      playLike: { open: false, label: 'Em', capo: 1 },
      commonChords: ['Fm', 'Ab', 'Bbm', 'Cm', 'Db', 'Eb', '属和弦用 C'],
      note: 'F 与 Fm 只差 3 弦 1 品；弹 Em 调指法夹 1 品最轻松。'
    },
    6: { // F#m
      key: 'F#m小调',
      relativeMajor: 'A 大调',
      doPositions: [
        { pos: '6弦2品', label: '低音 do', midi: 42 },
        { pos: '4弦4品', label: 'do', midi: 54 },
        { pos: '1弦2品', label: '高音 do', midi: 66 }
      ],
      playLike: { open: false, label: 'Em', capo: 2 },
      commonChords: ['F#m', 'A', 'Bm', 'C#m', 'D', 'E', '属和弦用 C#'],
      note: '弹 Em 调指法夹 2 品，指法与 Em 调相同、整体高两品。'
    },
    7: { // Gm
      key: 'Gm小调',
      relativeMajor: 'Bb 大调',
      doPositions: [
        { pos: '6弦3品', label: '低音 do', midi: 43 },
        { pos: '3弦空弦', label: 'do', midi: 55 },
        { pos: '1弦3品', label: '高音 do', midi: 67 }
      ],
      playLike: { open: false, label: 'Em', capo: 3 },
      commonChords: ['Gm', 'Bb', 'Cm', 'Dm', 'Eb', 'F', '属和弦用 D'],
      note: 'Gm 是横按（Fm 型第 3 品）；弹 Em 调指法夹 3 品。'
    },
    8: { // G#m
      key: 'G#m小调',
      relativeMajor: 'B 大调',
      doPositions: [
        { pos: '6弦4品', label: '低音 do', midi: 44 },
        { pos: '3弦1品', label: 'do', midi: 56 },
        { pos: '1弦4品', label: '高音 do', midi: 68 }
      ],
      playLike: { open: false, label: 'Em', capo: 4 },
      commonChords: ['G#m', 'B', 'C#m', 'D#m', 'E', 'F#', '属和弦用 D#'],
      note: '常记作 Abm；弹 Em 调指法夹 4 品。'
    },
    9: { // Am
      key: 'Am小调',
      relativeMajor: 'C 大调',
      doPositions: [
        { pos: '5弦空弦', label: '低音 do', midi: 45 },
        { pos: '3弦2品', label: 'do', midi: 57 },
        { pos: '1弦5品', label: '高音 do', midi: 69 }
      ],
      playLike: { open: true, label: 'Am 小调开放和弦（不夹变调夹）' },
      commonChords: ['Am', 'C', 'Dm', 'Em', 'F', 'G', '属和弦用 E'],
      note: '全开放和弦，与 C 调同音阶，最易上手；E 作属和弦制造终止感。'
    },
    10: { // Bbm
      key: 'Bbm小调',
      relativeMajor: 'Db 大调',
      doPositions: [
        { pos: '5弦1品', label: '低音 do', midi: 46 },
        { pos: '3弦3品', label: 'do', midi: 58 },
        { pos: '1弦6品', label: '高音 do', midi: 70 }
      ],
      playLike: { open: false, label: 'Am', capo: 1 },
      commonChords: ['Bbm', 'Db', 'Ebm', 'Fm', 'Gb', 'Ab', '属和弦用 F'],
      note: '弹 Am 调指法夹 1 品，避免一上来就按大横按。'
    },
    11: { // Bm
      key: 'Bm小调',
      relativeMajor: 'D 大调',
      doPositions: [
        { pos: '5弦2品', label: '低音 do', midi: 47 },
        { pos: '2弦空弦', label: 'do', midi: 59 },
        { pos: '1弦7品', label: '高音 do', midi: 71 }
      ],
      playLike: { open: false, label: 'Am', capo: 2 },
      commonChords: ['Bm', 'D', 'Em', 'F#m', 'G', 'A', '属和弦用 F#'],
      note: 'Bm 是横按和弦，可先弹 Am 调指法夹 2 品。'
    }
  };

  // 音名工具
  function midiName(m) {
    var names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return names[m % 12] + String(Math.floor(m / 12) - 1);
  }

  global.GuitarMap = {
    OPEN_MIDI: OPEN_MIDI,
    FRETBOARD: FRETBOARD,
    MAJOR: MAJOR,
    MINOR: MINOR,
    majorName: function (pc) { return MAJOR[((pc % 12) + 12) % 12].key; },
    minorName: function (pc) { return MINOR[((pc % 12) + 12) % 12].key; },
    midiName: midiName
  };
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
