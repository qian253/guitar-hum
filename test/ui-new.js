/* ================================================================
 * 手绘治愈风 UI 层（v2.14.0）：底部导航 / 调调猫 / 音准闯关 / 历史收藏墙
 * 与旧逻辑完全解耦：不改任何既有函数，只观察 DOM 变化 + 读写 localStorage。
 * ================================================================ */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 手绘小元素散布 ---------- */
  (function () {
    var layer = $('doodleLayer');
    if (!layer) return;
    var items = ['🎵', '🌸', '⭐', '🐾', '🌼', '🎶', '✿', '♫'];
    var seeds = 14;
    for (var i = 0; i < seeds; i++) {
      var s = document.createElement('span');
      s.className = 'doodle' + (i % 2 ? ' d2' : '');
      s.textContent = items[i % items.length];
      s.style.left = ((i * 37 + 11) % 100) + '%';
      s.style.top = ((i * 53 + 23) % 92) + '%';
      s.style.animationDelay = (i * 0.7) + 's';
      s.style.animationDuration = (7 + (i % 5)) + 's';
      layer.appendChild(s);
    }
  })();

  /* ---------- 调调猫（音乐猫：耳机 + 音符尾巴 + 表情变化） ---------- */
  var CAT_EXPR = {
    normal: {
      eyes: '<circle cx="34" cy="40" r="3.2" fill="#5A4A42"/><circle cx="54" cy="40" r="3.2" fill="#5A4A42"/>',
      mouth: '<path d="M41 47 q3 3 6 0" stroke="#5A4A42" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
      arms: '<path d="M26 66 q-3 4 -6 2" stroke="#F0B79A" stroke-width="4.5" fill="none" stroke-linecap="round"/><path d="M62 66 q3 4 6 2" stroke="#F0B79A" stroke-width="4.5" fill="none" stroke-linecap="round"/>'
    },
    happy: {
      eyes: '<path d="M30 40 q4 -5 8 0" stroke="#5A4A42" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M50 40 q4 -5 8 0" stroke="#5A4A42" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
      mouth: '<path d="M40 46 q4 5 8 0 q-4 4 -8 0" fill="#F47C7C"/>',
      arms: '<path d="M26 66 q-3 4 -6 2" stroke="#F0B79A" stroke-width="4.5" fill="none" stroke-linecap="round"/><path d="M62 66 q3 4 6 2" stroke="#F0B79A" stroke-width="4.5" fill="none" stroke-linecap="round"/>'
    },
    cheer: {
      eyes: '<path d="M30 40 q4 -5 8 0" stroke="#5A4A42" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M50 40 q4 -5 8 0" stroke="#5A4A42" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
      mouth: '<ellipse cx="44" cy="48" rx="4.5" ry="5.5" fill="#F47C7C"/>',
      arms: '<path d="M22 58 q-8 -8 -6 -18" stroke="#F0B79A" stroke-width="4.5" fill="none" stroke-linecap="round"/><path d="M66 58 q8 -8 6 -18" stroke="#F0B79A" stroke-width="4.5" fill="none" stroke-linecap="round"/>'
    }
  };
  function catSvg(expr) {
    var e = CAT_EXPR[expr] || CAT_EXPR.normal;
    return '<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">' +
      // 音符尾巴
      '<path d="M66 86 q10 -6 6 -20 q-2 8 -8 10 q-1 8 -8 10" fill="#8A75D8"/>' +
      // 身体
      '<ellipse cx="44" cy="66" rx="22" ry="17" fill="#FFC9A8"/>' +
      e.arms +
      // 头
      '<ellipse cx="44" cy="36" rx="24" ry="21" fill="#FFC9A8"/>' +
      // 耳朵
      '<path d="M24 24 q-4 -16 6 -14 q14 -4 12 12 z" fill="#FFC9A8"/><path d="M26 22 q0 -8 4 -9 q8 -3 8 7 z" fill="#F7A8A0"/>' +
      '<path d="M64 24 q4 -16 -6 -14 q-14 -4 -12 12 z" fill="#FFC9A8"/><path d="M62 22 q0 -8 -4 -9 q-8 -3 -8 7 z" fill="#F7A8A0"/>' +
      // 耳机（音乐猫标志）
      '<path d="M20 34 a24 24 0 0 1 48 0" stroke="#8A75D8" stroke-width="5" fill="none" stroke-linecap="round"/>' +
      '<rect x="17" y="30" width="8" height="12" rx="4" fill="#8A75D8"/><rect x="63" y="30" width="8" height="12" rx="4" fill="#8A75D8"/>' +
      // 脸
      e.eyes + e.mouth +
      '<circle cx="29" cy="46" r="3.5" fill="#FBA8A0" opacity="0.7"/><circle cx="59" cy="46" r="3.5" fill="#FBA8A0" opacity="0.7"/>' +
      // 胡子
      '<path d="M26 44 h-8 M26 48 h-7" stroke="#5A4A42" stroke-width="1.4" stroke-linecap="round" opacity="0.6"/>' +
      '<path d="M62 44 h8 M62 48 h7" stroke="#5A4A42" stroke-width="1.4" stroke-linecap="round" opacity="0.6"/>' +
      // 漂浮音符
      '<text x="78" y="16" font-size="14" fill="#FF8A7A">♪</text>' +
      '<text x="6" y="58" font-size="12" fill="#A8E6CF">♫</text>' +
      '</svg>';
  }
  var catHideTimer = null;
  function showCat(msg, expr, stayMs) {
    var buddy = $('catBuddy');
    if (!buddy) return;
    var bubble = $('catBubble');
    var svgBox = $('catSvg');
    bubble.textContent = msg;
    svgBox.innerHTML = catSvg(expr || 'normal');
    buddy.classList.add('show');
    buddy.classList.toggle('jump', expr === 'normal');
    buddy.classList.toggle('cheer', expr === 'cheer');
    if (catHideTimer) clearTimeout(catHideTimer);
    if (stayMs !== 0) catHideTimer = setTimeout(hideCat, stayMs || 5000);
  }
  function hideCat() {
    var buddy = $('catBuddy');
    if (buddy) buddy.classList.remove('show', 'jump', 'cheer');
  }
  $('catBuddy').addEventListener('click', hideCat);

  /* ---------- 底部导航 ---------- */
  var NAV_TITLES = { record: '🎵 哼调', result: '🎶 最近结果', practice: '🎮 音准闯关', mine: '🐱 我的' };
  var currentView = 'record';
  var lastFlowScreen = 'screenRecord'; // 测调流程当前停留的屏
  function switchView(name) {
    currentView = name;
    var screens = document.querySelectorAll('.screen');
    var anyOn = false;
    for (var i = 0; i < screens.length; i++) { if (screens[i].classList.contains('on')) { anyOn = true; break; } }
    if (name === 'record') {
      // 回到测调：恢复流程屏
      if (!anyOn) {
        var el = $(lastFlowScreen) || $('screenRecord');
        if (el) el.classList.add('on');
      }
    } else {
      for (var j = 0; j < screens.length; j++) { if (screens[j].classList.contains('on')) { lastFlowScreen = screens[j].id; screens[j].classList.remove('on'); } }
    }
    var views = document.querySelectorAll('.view');
    for (var k = 0; k < views.length; k++) views[k].classList.remove('on');
    if (name !== 'record') {
      var v = $('view' + name.charAt(0).toUpperCase() + name.slice(1));
      if (v) v.classList.add('on');
      if (name === 'result') renderResultView();
      if (name === 'mine') renderMine();
      if (name === 'practice') renderPractice();
    }
    var items = document.querySelectorAll('.nav-item');
    for (var m = 0; m < items.length; m++) items[m].classList.toggle('on', items[m].dataset.view === name);
    var tb = $('tbTitle');
    if (tb) tb.textContent = NAV_TITLES[name] || NAV_TITLES.record;
    hideCat();
  }
  var navItems = document.querySelectorAll('.nav-item');
  for (var ni = 0; ni < navItems.length; ni++) {
    (function (item) { item.addEventListener('click', function () { switchView(item.dataset.view); }); })(navItems[ni]);
  }
  // 齿轮 → 打开诊断面板
  $('tbGear').addEventListener('click', function () {
    var p = $('diagPanel');
    if (p) p.classList.toggle('show');
  });
  // 记录流程屏（旧 showScreen 只在三屏间切换，这里监听谁当前显示）
  (function () {
    var obs = new MutationObserver(function () {
      var screens = document.querySelectorAll('.screen');
      for (var i = 0; i < screens.length; i++) {
        if (screens[i].classList.contains('on')) { lastFlowScreen = screens[i].id; break; }
      }
    });
    obs.observe(document.getElementById('app'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  })();

  /* ---------- 历史 / 结果快照 ---------- */
  function hkGet(key, def) { try { var v = JSON.parse(localStorage.getItem(key)); return v || def; } catch (e) { return def; } }
  function hkSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  var lastSnapshot = hkGet('hkLastResult', null);
  function saveHistory(keyName, badge, conf, capoHtml, jianpuHtml, toneMapHtml, ts) {
    var h = hkGet('hkHistory', []);
    h.unshift({ keyName: keyName, badge: badge, conf: conf, ts: ts || Date.now() });
    h = h.slice(0, 30);
    hkSet('hkHistory', h);
    lastSnapshot = { keyName: keyName, badge: badge, conf: conf, capo: capoHtml, jianpu: jianpuHtml, toneMap: toneMapHtml, ts: Date.now() };
    hkSet('hkLastResult', lastSnapshot);
    var flowers = Math.floor(h.length / 3);
    hkSet('hkFlowers', flowers);
  }
  // 结果屏出现 → 调调猫出场 + 存历史
  (function () {
    var target = $('screenResult');
    if (!target) return;
    var obs = new MutationObserver(function () {
      if (!target.classList.contains('on')) return;
      setTimeout(function () {
        try {
          var keyEl = $('keyBig'), badgeEl = $('modeBadge'), confEl = $('confPct');
          var capoEl = $('capoHighlight'), jianpuEl = $('jianpuLine'), toneEl = $('toneMap');
          if (!keyEl) return;
          var keyName = keyEl.textContent.trim();
          var badge = badgeEl ? badgeEl.textContent.trim() : '';
          var conf = confEl ? confEl.textContent.trim() : '';
          var isMinor = /小调/.test(keyName) || /小调/.test(badge);
          var letter = keyName.replace(/[大调小调（）()\s]/g, '');
          if (isMinor) showCat('喵～这是 ' + letter + ' 小调！有点忧伤，但很温柔哦～', 'happy', 6000);
          else showCat('喵～这是 ' + letter + ' 大调！听起来好明亮，像太阳晒过的毛毯～', 'happy', 6000);
          saveHistory(keyName, badge, conf,
            capoEl ? capoEl.innerHTML : '',
            jianpuEl ? jianpuEl.innerHTML : '',
            toneEl ? toneEl.innerHTML : '');
          var h = hkGet('hkHistory', []);
          if (h.length % 3 === 0) {
            setTimeout(function () { showCat('喵！你已经测了 ' + h.length + ' 次调啦，送你一朵小花 🌼', 'cheer', 6000); }, 2200);
          }
        } catch (e) {}
      }, 150);
    });
    obs.observe(target, { attributes: true, attributeFilter: ['class'] });
  })();
  // 分析屏出现 → 调调猫跳跃等待
  (function () {
    var target = $('screenAnalyze');
    if (!target) return;
    var obs = new MutationObserver(function () {
      if (target.classList.contains('on')) showCat('让调调猫竖起耳朵听听喵～', 'normal', 0);
      else hideCat();
    });
    obs.observe(target, { attributes: true, attributeFilter: ['class'] });
  })();

  function renderResultView() {
    var box = $('viewResultContent');
    if (!box) return;
    if (!lastSnapshot) {
      box.innerHTML = '<div class="empty-state"><div class="es-ic">🎤</div><div class="es-t">还没有测过调哦～</div><div style="margin-top:8px;font-size:13px;color:var(--muted)">去「测调」页按住哼一句吧</div></div>';
      return;
    }
    box.innerHTML =
      '<div class="card result-hero">' +
      '<div class="key-line"><span class="key-big">' + lastSnapshot.keyName + '</span>' +
      '<span class="mode-badge">' + lastSnapshot.badge + '</span></div>' +
      '<div class="capo-highlight">' + (lastSnapshot.capo || '') + '</div>' +
      '<div class="conf"><span>信心</span><span style="font-weight:800">' + (lastSnapshot.conf || '') + '</span></div>' +
      '<div class="tone-map">' + (lastSnapshot.toneMap || '') + '</div>' +
      '</div>' +
      '<div class="card" style="margin-top:12px"><div class="card-title">简谱</div><div class="jianpu-line">' + (lastSnapshot.jianpu || '—') + '</div></div>';
  }

  /* ---------- 练习页：音准闯关 ---------- */
  var LEVEL_NOTES = [60, 62, 64, 65, 67, 69, 71, 72]; // C4 D4 E4 F4 G4 A4 B4 C5
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var ANIMALS = ['🐶', '🐰', '🐻', '🐧', '🦊', '🐼', '🦉', '🐳'];
  var ANIMAL_NAMES = ['小狗', '小兔', '小熊', '小企鹅', '小狐狸', '小熊猫', '猫头鹰', '小鲸鱼'];
  function midiName(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + Math.floor(m / 12 - 1); }
  var practice = hkGet('hkPractice', { done: [], unlocked: [] });
  var curLevel = 0;

  function renderWall(el) {
    if (!el) return;
    el.innerHTML = '';
    for (var i = 0; i < ANIMALS.length; i++) {
      var d = document.createElement('div');
      d.className = 'wall-item' + (practice.unlocked.indexOf(i) >= 0 ? ' unlocked' : '');
      d.title = ANIMAL_NAMES[i] + (practice.unlocked.indexOf(i) >= 0 ? '（已解锁）' : '（闯关解锁）');
      d.textContent = ANIMALS[i];
      el.appendChild(d);
    }
  }
  function renderPractice() {
    var road = $('road');
    if (!road) return;
    road.innerHTML = '<div class="road-line"></div>';
    var curIdx = practice.done.length; // 当前关 = 已过关数
    for (var i = 0; i < LEVEL_NOTES.length; i++) {
      var node = document.createElement('div');
      node.className = 'level-node' + (i < practice.done.length ? ' done' : '') + (i === curIdx ? ' current' : '');
      node.textContent = (i + 1);
      if (i < practice.done.length && practice.unlocked.indexOf(i) >= 0) {
        var ic = document.createElement('span');
        ic.className = 'ln-ic';
        ic.textContent = ANIMALS[i];
        node.appendChild(ic);
      }
      (function (lv) {
        node.addEventListener('click', function () {
          if (lv > practice.done.length) return; // 只能进当前关或已过关
          enterLevel(lv);
        });
      })(i);
      road.appendChild(node);
    }
    var lt = $('levelTag');
    if (lt) lt.textContent = '第 ' + (curIdx + 1) + ' 关';
    renderWall($('wall'));
    var wt = $('wallTag');
    if (wt) wt.textContent = practice.unlocked.length + '/' + ANIMALS.length;
  }

  /* ---- 关卡内 ---- */
  var prState = { holding: false, stream: null, ctx: null, proc: null, pitchHist: [], hitMs: 0, lastT: 0, done: false };
  function enterLevel(lv) {
    curLevel = lv;
    var view = $('viewPractice');
    var old = $('practiceLevelBox');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'practiceLevelBox';
    box.className = 'card practice-card';
    box.style.marginTop = '12px';
    var target = LEVEL_NOTES[lv];
    box.innerHTML =
      '<div class="card-title">🎯 第 ' + (lv + 1) + ' 关 · 唱准这个音</div>' +
      '<div class="target-note">' + midiName(target) + '</div>' +
      '<div class="target-sub">对着麦克风平稳地唱「啊——」，音高线落在绿色区间就成功</div>' +
      '<canvas id="pitchCanvas" width="320" height="110"></canvas>' +
      '<button class="practice-mic" id="practiceMicBtn">🎤<span>按住唱歌</span></button>' +
      '<div class="practice-fb" id="practiceFb">准备…</div>';
    view.appendChild(box);
    drawPitch([], target);
    var btn = $('practiceMicBtn');
    btn.addEventListener('touchstart', function (e) { e.preventDefault(); prStart(); }, { passive: false });
    btn.addEventListener('mousedown', prStart);
    btn.addEventListener('touchend', prEnd, { passive: false });
    btn.addEventListener('touchcancel', prEnd);
    btn.addEventListener('mouseup', prEnd);
    btn.addEventListener('mouseleave', prEnd);
  }
  function prStart() {
    if (prState.holding || prState.done) return;
    prState.holding = true;
    var btn = $('practiceMicBtn');
    if (btn) { btn.classList.add('holding'); btn.querySelector('span').textContent = '松开完成'; }
    var fb = $('practiceFb');
    if (fb) fb.textContent = '正在听…';
    prState.pitchHist = []; prState.hitMs = 0; prState.lastT = performance.now();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { prFail('浏览器不支持麦克风'); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    prState.ctx = new AC();
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      prState.stream = stream;
      if (prState.ctx.state === 'suspended') prState.ctx.resume();
      var src = prState.ctx.createMediaStreamSource(stream);
      var proc = prState.ctx.createScriptProcessor(2048, 1, 1);
      prState.proc = proc;
      proc.onaudioprocess = function (e) {
        if (!prState.holding || prState.done) return;
        var input = e.inputBuffer.getChannelData(0);
        var r = window.DSP.yinPitchFrame(input, prState.ctx.sampleRate);
        if (!r) return;
        var now = performance.now();
        var dt = now - prState.lastT;
        prState.lastT = now;
        prState.pitchHist.push(r.pitch);
        if (prState.pitchHist.length > 90) prState.pitchHist.shift();
        var target = LEVEL_NOTES[curLevel];
        var diff = r.pitch - target;
        var fb = $('practiceFb');
        if (Math.abs(diff) <= 0.5) {
          prState.hitMs += dt;
          if (fb) fb.textContent = '对啦！保持住～（' + Math.round(prState.hitMs / 100) / 10 + 's / 1.2s）';
          if (prState.hitMs >= 1200) prSuccess();
        } else {
          prState.hitMs = Math.max(0, prState.hitMs - dt * 0.5);
          if (fb) fb.textContent = diff < 0 ? '偏低一点点，往上够一够～' : '偏高啦，松一点～';
        }
        drawPitch(prState.pitchHist, target);
      };
      src.connect(proc);
      proc.connect(prState.ctx.destination);
    }).catch(function () { prFail('麦克风不可用'); });
  }
  function prEnd() {
    prState.holding = false;
    var btn = $('practiceMicBtn');
    if (btn) { btn.classList.remove('holding'); btn.querySelector('span').textContent = '按住唱歌'; }
    if (prState.done) return;
    if (prState.hitMs < 1200) {
      showCat('没关系，再试一次喵～', 'normal', 3500);
      var fb = $('practiceFb');
      if (fb) fb.textContent = '差一点点，再来一次！';
    }
    prCleanup();
  }
  function prSuccess() {
    prState.done = true;
    prCleanup();
    var btn = $('practiceMicBtn');
    if (btn) btn.querySelector('span').textContent = '已通过 🎉';
    var fb = $('practiceFb');
    if (fb) fb.textContent = '太棒了！第 ' + (curLevel + 1) + ' 关通过！';
    if (practice.done.indexOf(curLevel) < 0) practice.done.push(curLevel);
    if (practice.unlocked.indexOf(curLevel) < 0) practice.unlocked.push(curLevel);
    hkSet('hkPractice', practice);
    burstFlowers();
    showCat('太棒啦！唱得真准喵！解锁新伙伴 ' + ANIMALS[curLevel] + ' ' + ANIMAL_NAMES[curLevel] + '！', 'cheer', 5000);
    setTimeout(function () {
      renderPractice();
      var box = $('practiceLevelBox');
      if (box) box.remove();
    }, 1600);
  }
  function prCleanup() {
    try { if (prState.proc) prState.proc.disconnect(); } catch (e) {}
    try { if (prState.stream) prState.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { if (prState.ctx && prState.ctx.state !== 'closed') prState.ctx.close(); } catch (e) {}
    prState.proc = null; prState.stream = null; prState.ctx = null;
  }
  function prFail(msg) {
    prCleanup();
    var fb = $('practiceFb');
    if (fb) fb.textContent = msg;
    showCat('没关系，再试一次喵～', 'normal', 3500);
  }
  function drawPitch(hist, target) {
    var c = $('pitchCanvas');
    if (!c) return;
    var ctx = c.getContext('2d');
    var W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    // 目标带（±50 音分 → 像素）
    var centsPerPx = 5;
    var midY = H / 2;
    var bandH = 100 / centsPerPx;
    ctx.fillStyle = 'rgba(111,201,143,0.18)';
    ctx.fillRect(0, midY - bandH / 2, W, bandH);
    ctx.strokeStyle = 'rgba(111,201,143,0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
    ctx.setLineDash([]);
    if (!hist || hist.length < 2) return;
    var n = hist.length;
    ctx.strokeStyle = '#FF8A7A';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var x = (i / 89) * W;
      var y = midY - ((hist[i] - target) * 100) / centsPerPx;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /* 花朵/星星绽放 */
  function burstFlowers() {
    var items = ['🌸', '⭐', '🌼', '🎵', '✿'];
    for (var i = 0; i < 14; i++) {
      var el = document.createElement('span');
      el.className = 'burst-item';
      el.textContent = items[i % items.length];
      el.style.left = (window.innerWidth / 2 - 12) + 'px';
      el.style.top = (window.innerHeight / 2 - 12) + 'px';
      var ang = (i / 14) * Math.PI * 2;
      el.style.setProperty('--bx', (Math.cos(ang) * (70 + Math.random() * 60)) + 'px');
      el.style.setProperty('--by', (Math.sin(ang) * (70 + Math.random() * 60)) + 'px');
      el.style.setProperty('--br', ((Math.random() - 0.5) * 200) + 'deg');
      document.body.appendChild(el);
      (function (node) { setTimeout(function () { node.remove(); }, 950); })(el);
    }
  }

  /* ---------- 我的页 ---------- */
  function renderMine() {
    renderWall($('wallMine'));
    var list = $('historyList');
    if (!list) return;
    var h = hkGet('hkHistory', []);
    if (!h.length) { list.innerHTML = '<div class="empty-state"><div class="es-ic">📒</div><div class="es-t">还没有记录</div></div>'; }
    else {
      list.innerHTML = h.map(function (it) {
        var d = new Date(it.ts);
        return '<div class="history-item"><div class="hi-key">' + it.keyName + '</div><div class="hi-meta">' + it.badge + ' · 信心 ' + it.conf + ' · ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') + '</div></div>';
      }).join('');
    }
    var pro = localStorage.getItem('hkDisplayPro') === '1';
    var sp = $('setProVal');
    if (sp) sp.textContent = pro ? '开' : '关';
    var flowers = hkGet('hkFlowers', 0);
    if (flowers > 0) {
      var wallHead = document.querySelector('#viewMine .card .card-title');
      // 在墙标题处显示小花
      var wt = $('wallMine');
      if (wt && wt.parentElement) {
        var ft = wt.parentElement.querySelector('.flower-count');
        if (!ft) {
          ft = document.createElement('span');
          ft.className = 'flower-count';
          ft.style.cssText = 'float:right;font-size:12px;color:#D98A3D;font-weight:800';
          wt.parentElement.querySelector('.card-title').appendChild(ft);
        }
        ft.textContent = '🌼×' + flowers;
      }
    }
    var sel = $('setTimbreSel');
    if (sel) sel.value = (window.__curTimbre || 'nylon');
  }
  // 设置行交互
  (function () {
    var sp = $('setProVal');
    if (sp && sp.parentElement) {
      sp.parentElement.style.cursor = 'pointer';
      sp.parentElement.addEventListener('click', function () {
        var on = localStorage.getItem('hkDisplayPro') === '1';
        localStorage.setItem('hkDisplayPro', on ? '0' : '1');
        sp.textContent = on ? '关' : '开';
        // 触发旧逻辑重渲染（结果页按钮若存在）
        var btn = $('proToggleBtn');
        if (btn && btn.style.display !== 'none') btn.click();
      });
    }
    var sel = $('setTimbreSel');
    if (sel) {
      sel.addEventListener('change', function () {
        var btns = document.querySelectorAll('.timbre-btn');
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].dataset.timbre === sel.value) { btns[i].click(); break; }
        }
        window.__curTimbre = sel.value;
      });
    }
  })();

  /* ---------- 首次进入：测调页顶栏标题 ---------- */
  switchView('record');
  renderPractice();
  renderMine();
})();
