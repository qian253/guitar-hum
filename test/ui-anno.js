/* ================================================================
 * 主音标注模式（v2.16.3）：自建「哼唱→真实主音」实测数据集
 * 用法：诊断面板开启标注模式 → 选好这句要唱的调 → 哼 → 结果自动保存标注；
 *       攒够 20 首后点「导出标注数据 JSON」，把文件发给开发者做失分分析。
 * ================================================================ */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function annoGet(key, def) { try { var v = JSON.parse(localStorage.getItem(key)); return v != null ? v : def; } catch (e) { return def; } }
  function annoSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  function ensureUI() {
    if ($('annoBox')) return;
    var panel = $('diagPanel');
    if (!panel) return;
    var box = document.createElement('div');
    box.id = 'annoBox';
    box.style.cssText = 'margin-top:10px;border-top:2px dashed #E4CDB4;padding-top:8px;';
    var div = document.createElement('div');
    div.innerHTML =
      '<div style="font-size:12px;color:#8A766C;font-weight:700;margin-bottom:6px;">🎯 主音标注模式（自建实测数据）</div>' +
      '<div style="margin-bottom:6px;font-size:12.5px;"><input type="checkbox" id="annoOn" style="vertical-align:-2px;"> <label for="annoOn">开启：哼之前选好真实调</label></div>' +
      '<select id="annoKey" style="width:100%;padding:7px;border-radius:8px;border:2px solid #F0E2D2;background:#FFF;font-size:13px;margin-bottom:6px;"></select>' +
      '<button id="annoPlay" style="width:100%;min-height:36px;padding:6px;font-size:12.5px;border:2px solid #F0E2D2;border-radius:10px;background:#FFF;color:#5A4A42;font-weight:700;cursor:pointer;margin-bottom:6px;">▶ 听示范音阶（先听再跟唱，校准音高）</button>' +
      '<div style="font-size:12px;color:#8A766C;margin-bottom:6px;">已标注：<b id="annoCount">0</b> 首</div>' +
      '<button id="annoExport" style="width:100%;min-height:36px;padding:6px;font-size:12.5px;border:2px solid #F0E2D2;border-radius:10px;background:#FFF;color:#5A4A42;font-weight:700;cursor:pointer;">⬇ 导出标注数据 JSON</button>' +
      '<div id="annoStatus" style="font-size:11.5px;color:#4E9B6E;margin-top:4px;min-height:14px;"></div>';
    box.appendChild(div);
    panel.appendChild(box);

    var NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    var sel = $('annoKey');
    var opts = '';
    for (var r = 0; r < 12; r++) {
      opts += '<option value="' + r + ':major">' + NAMES[r] + ' 大调</option>';
      opts += '<option value="' + r + ':minor">' + NAMES[r] + ' 小调</option>';
    }
    sel.innerHTML = opts;
    try { sel.value = localStorage.getItem('hkAnnoKey') || '0:major'; } catch (e) {}

    // 听示范：弹一遍该调音阶（do re mi fa sol la ti do），新手先校准音高再哼
    $('annoPlay').addEventListener('click', function () {
      if (typeof playTone !== 'function') { $('annoStatus').textContent = '音频引擎未就绪'; return; }
      var root = parseInt(sel.value.split(':')[0], 10) || 0;
      var semi = [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0];
      var base = 60 + root; if (base > 66) base -= 12;
      semi.forEach(function (s, i) { setTimeout(function () { playTone(base + s, 0.4); }, i * 380); });
      $('annoStatus').textContent = '♪ 正在播放 ' + selectedKeyText() + ' 音阶，跟着唱准再哼';
    });

    $('annoOn').addEventListener('change', function () {
      try { localStorage.setItem('hkAnnoOn', this.checked ? '1' : '0'); } catch (e) {}
      refreshHint();
    });
    $('annoKey').addEventListener('change', function () {
      try { localStorage.setItem('hkAnnoKey', this.value); } catch (e) {}
      refreshHint();
    });
    $('annoExport').addEventListener('click', exportData);
    $('annoCount').textContent = annoGet('hkAnnotations', []).length;
    if (localStorage.getItem('hkAnnoOn') === '1') $('annoOn').checked = true;
    refreshHint();
  }

  function annoOn() {
    try { return localStorage.getItem('hkAnnoOn') === '1'; } catch (e) { return false; }
  }
  function selectedKeyText() {
    var v = '0:major';
    try { v = localStorage.getItem('hkAnnoKey') || '0:major'; } catch (e) {}
    var parts = v.split(':');
    var NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    return NAMES[parseInt(parts[0], 10) || 0] + (parts[1] === 'minor' ? ' 小调' : ' 大调');
  }
  function refreshHint() {
    var h = $('recHint');
    if (!h) return;
    if (annoOn()) h.textContent = '🎯 标注模式：先点「▶ 听示范」听「' + selectedKeyText() + '」音阶，跟着唱准后按住哼唱';
    else if (h.dataset.annoHint) { h.textContent = '按住哼唱，松开自动分析'; delete h.dataset.annoHint; }
    if (annoOn()) h.dataset.annoHint = '1';
  }

  function exportData() {
    var list = annoGet('hkAnnotations', []);
    if (!list.length) { var st = $('annoStatus'); if (st) st.textContent = '还没有标注数据，先哼几首吧'; return; }
    var blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '哼唱标注数据.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 5000);
    var st = $('annoStatus');
    if (st) st.textContent = '已导出 ' + list.length + ' 首，把 JSON 文件发给开发者';
  }

  // 结果屏出现 → 标注模式开启时保存一条标注
  (function () {
    var target = $('screenResult');
    if (!target) return;
    var obs = new MutationObserver(function () {
      if (!target.classList.contains('on')) return;
      if (!annoOn()) return;
      setTimeout(function () {
        try {
          var keyEl = $('keyBig'), badgeEl = $('modeBadge'), confEl = $('confPct');
          var evEl = $('relHint'), jpEl = $('jianpuLine');
          if (!keyEl) return;
          var v = '0:major';
          try { v = localStorage.getItem('hkAnnoKey') || '0:major'; } catch (e) {}
          var parts = v.split(':');
          var item = {
            truth: { root: parseInt(parts[0], 10) || 0, mode: parts[1] === 'minor' ? 'minor' : 'major' },
            detected: { keyName: keyEl.textContent.trim(), badge: badgeEl ? badgeEl.textContent.trim() : '', confidence: confEl ? confEl.textContent.trim() : '' },
            evidence: evEl ? evEl.textContent.trim().replace(/\s+/g, ' ') : '',
            jianpu: jpEl ? jpEl.textContent.trim().replace(/\s+/g, '') : '',
            // v2.17.1：附带原始音符序列与显示模式，供离线精确复现（此前只有派生字符串，无法精确分析）
            notes: (typeof state !== 'undefined' && state.accNotes ? state.accNotes.slice(-80).map(function (n) { return { m: +(+n.midi).toFixed(2), d: +(n.dur || 0.25).toFixed(2), s: +(n.start || 0).toFixed(2) }; }) : []),
            displayPro: typeof displayPro !== 'undefined' ? !!displayPro : false,
            ts: Date.now()
          };
          var list = annoGet('hkAnnotations', []);
          list.push(item);
          if (list.length > 200) list = list.slice(-200);
          annoSet('hkAnnotations', list);
          var cnt = $('annoCount');
          if (cnt) cnt.textContent = list.length;
          var st = $('annoStatus');
          if (st) st.textContent = '已保存第 ' + list.length + ' 首 ✓（满 20 首可导出）';
        } catch (e) {}
      }, 200);
    });
    obs.observe(target, { attributes: true, attributeFilter: ['class'] });
  })();

  ensureUI();
})();
