/* ================================================================
 * 动态真手绘层（v2.14.1）：描边动画 / 纸张纹理 / 水彩色块 / 逐字显现 / 小花绽放
 * 纯装饰层：不碰任何业务逻辑，全部 pointer-events:none。
 * ================================================================ */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 纸张纹理 + 水彩色块层 ---------- */
  (function () {
    var tex = document.createElement('div');
    tex.id = 'paperTex';
    document.body.insertBefore(tex, document.body.firstChild);
    var wc = document.createElement('div');
    wc.id = 'watercolorLayer';
    for (var i = 1; i <= 4; i++) {
      var b = document.createElement('div');
      b.className = 'wc-blob wc-b' + i;
      wc.appendChild(b);
    }
    document.body.insertBefore(wc, document.body.firstChild);
  })();

  /* ---------- 手绘描边：wobbly 路径生成 ---------- */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function wobblyPath(w, h, seed) {
    var rnd = mulberry32(seed || 7);
    var j = Math.min(4, Math.max(1.5, Math.min(w, h) * 0.035)); // 抖动幅度
    var n = 12; // 每边采样点
    var pts = [];
    function edge(x0, y0, x1, y1) {
      for (var i = 0; i <= n; i++) {
        var t = i / n;
        var px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        // 垂直方向抖动
        var dx = x1 - x0, dy = y1 - y0;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var nx = -dy / len, ny = dx / len;
        var off = (rnd() - 0.5) * 2 * j;
        if (i === 0 || i === n) off *= 0.4;
        pts.push([px + nx * off, py + ny * off]);
      }
    }
    edge(2, 2, w - 2, 2);
    edge(w - 2, 2, w - 2, h - 2);
    edge(w - 2, h - 2, 2, h - 2);
    edge(2, h - 2, 2, 2);
    var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (var k = 1; k < pts.length; k++) d += 'L' + pts[k][0].toFixed(1) + ' ' + pts[k][1].toFixed(1);
    return d + 'Z';
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function applySketch(el) {
    if (!el || el.dataset.sketched) return;
    if (el.offsetWidth < 24 || el.offsetHeight < 24) return; // 太小不描
    el.dataset.sketched = '1';
    var w = el.offsetWidth, h = el.offsetHeight;
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'sketch-border');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    var shadow = document.createElementNS(SVGNS, 'path');
    shadow.setAttribute('class', 'sketch-shadow');
    shadow.setAttribute('d', wobblyPath(w, h, 11));
    svg.appendChild(shadow);
    var line = document.createElementNS(SVGNS, 'path');
    line.setAttribute('class', 'draw-line');
    line.setAttribute('d', wobblyPath(w, h, 7));
    svg.appendChild(line);
    try { line.style.setProperty('--len', line.getTotalLength()); } catch (e) {}
    el.appendChild(svg);
  }
  var SKETCH_SEL = '.card, .btn, .rhythm-item, .prog-slide, .history-item, .capo-highlight, .tone-map, .seg-summary, .alt-hint, .melody-chords, .settings-row, .quick-card';
  function sketchAll(root) {
    try {
      var els = (root || document).querySelectorAll(SKETCH_SEL);
      for (var i = 0; i < els.length; i++) applySketch(els[i]);
    } catch (e) {}
  }
  // 初始描边
  setTimeout(sketchAll, 150);
  // 之后新增的元素（结果渲染/切换页）也描边
  (function () {
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        for (var j = 0; j < muts[i].addedNodes.length; j++) {
          var nd = muts[i].addedNodes[j];
          if (nd.nodeType !== 1) continue;
          if (nd.matches && nd.matches(SKETCH_SEL)) applySketch(nd);
          else sketchAll(nd);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  })();
  window.addEventListener('resize', function () {
    // 旋转/缩放后重描（防抖）
    clearTimeout(window.__sketchRt);
    window.__sketchRt = setTimeout(function () {
      var olds = document.querySelectorAll('[data-sketched]');
      for (var i = 0; i < olds.length; i++) {
        var sv = olds[i].querySelector(':scope > .sketch-border');
        if (sv) sv.remove();
        delete olds[i].dataset.sketched;
      }
      sketchAll();
    }, 300);
  });

  /* ---------- 调性文字「被写出来」：逐字显现 ---------- */
  function charReveal(el) {
    if (!el || el.dataset.chared) return;
    el.dataset.chared = '1';
    try {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      var texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      var budget = 10; // 最多处理 10 个字符
      for (var i = 0; i < texts.length; i++) {
        var node = texts[i];
        var txt = node.nodeValue;
        if (!txt || !txt.trim()) continue;
        var frag = document.createDocumentFragment();
        for (var c = 0; c < txt.length && budget > 0; c++, budget--) {
          var sp = document.createElement('span');
          sp.className = 'ji-char';
          sp.style.animationDelay = (c * 0.07) + 's';
          sp.textContent = txt[c];
          frag.appendChild(sp);
        }
        if (budget <= 0 && c < txt.length) frag.appendChild(document.createTextNode(txt.slice(c)));
        node.parentNode.replaceChild(frag, node);
        if (budget <= 0) break;
      }
    } catch (e) {}
  }
  (function () {
    var el = $('keyBig');
    if (!el) return;
    var obs = new MutationObserver(function () {
      delete el.dataset.chared;
      charReveal(el);
    });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    charReveal(el);
  })();

  /* ---------- 调调猫：轮廓先描、再填充（后处理 SVG） ---------- */
  (function () {
    var box = $('catSvg');
    if (!box) return;
    var obs = new MutationObserver(function () {
      var svg = box.querySelector('svg');
      if (!svg) return;
      var shapes = svg.querySelectorAll('path, ellipse, circle, rect, text');
      for (var i = 0; i < shapes.length; i++) {
        var s = shapes[i];
        if (s.getAttribute('stroke') && s.tagName !== 'text') s.classList.add('cat-line');
        else if (s.tagName === 'text') s.classList.add('cat-late');
        else s.classList.add('cat-fill');
      }
    });
    obs.observe(box, { childList: true, subtree: true });
  })();

  /* ---------- 音准过关：手绘小花绽放（观察反馈文字触发） ---------- */
  function bloomFlower(x, y) {
    var colors = ['#FF8A7A', '#FFB39C', '#A8E6CF', '#D5C6F5', '#FFE29A'];
    for (var b = 0; b < 8; b++) {
      var el = document.createElement('span');
      el.className = 'burst-flower';
      el.style.left = (x + (Math.random() - 0.5) * 110) + 'px';
      el.style.top = (y + (Math.random() - 0.5) * 90) + 'px';
      el.style.animationDelay = (Math.random() * 0.25) + 's';
      var col = colors[b % colors.length];
      var petals = '';
      for (var p = 0; p < 5; p++) {
        var ang = (p / 5) * Math.PI * 2;
        var cx = 16 + Math.cos(ang) * 8, cy = 16 + Math.sin(ang) * 8;
        petals += '<ellipse class="petal p' + (p + 1) + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" rx="6.5" ry="10" stroke="' + col + '" stroke-width="2.4" fill="none" transform="rotate(' + (ang * 180 / Math.PI).toFixed(0) + ' ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')"/>';
      }
      el.innerHTML = '<svg width="32" height="32" viewBox="0 0 32 32">' + petals + '<circle class="center" cx="16" cy="16" r="3.5" fill="#FFE29A"/></svg>';
      document.body.appendChild(el);
      (function (node) { setTimeout(function () { node.remove(); }, 1500); })(el);
    }
  }
  (function () {
    var fb = $('practiceFb');
    if (!fb) return;
    var obs = new MutationObserver(function () {
      var t = fb.textContent || '';
      if (/太棒|通过|成功/.test(t)) {
        bloomFlower(window.innerWidth / 2, window.innerHeight / 2 - 60);
        if (window.__bloom) clearTimeout(window.__bloom);
        window.__bloom = setTimeout(function () {
          if (/太棒|通过|成功/.test(fb.textContent)) bloomFlower(window.innerWidth / 2, window.innerHeight / 2 - 60);
        }, 700);
      }
    });
    obs.observe(fb, { childList: true, characterData: true, subtree: true });
  })();
})();
