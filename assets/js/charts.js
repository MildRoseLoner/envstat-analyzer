/*!
 * EnvCharts —— 纯手写 SVG 图表
 * 不依赖任何图表库：折线、柱状、散点（含拟合线）、直方图、箱线图、相关矩阵热力图。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EnvCharts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PALETTE = ['#0f766e', '#b45309', '#1d4ed8', '#9333ea', '#be123c', '#0891b2', '#4d7c0f'];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtNum(v, d) {
    if (!isFinite(v)) return '—';
    if (d === undefined) d = Math.abs(v) >= 100 ? 0 : 1;
    var abs = Math.abs(v);
    if (abs !== 0 && (abs < 0.01 || abs >= 1e5)) return v.toExponential(1);
    return (+v.toFixed(d)).toString();
  }

  // 生成好看的刻度
  function niceScale(min, max, count) {
    count = count || 5;
    if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
    if (min === max) { min -= 1; max += 1; }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log(span / count) / Math.LN10));
    var err = span / count / step;
    if (err >= 7.5) step *= 10;
    else if (err >= 3.5) step *= 5;
    else if (err >= 1.5) step *= 2;
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = lo; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
    return { min: lo, max: hi, ticks: ticks, step: step };
  }

  // 按容器实际宽度渲染，避免 SVG 被等比缩放后字号过小
  function hostWidth(host, fallback) {
    var w = host && host.clientWidth;
    return (w && w > 240) ? Math.round(w) : fallback;
  }

  function svgOpen(W, H, label) {
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
      '" class="chart-svg" role="img" aria-label="' + esc(label || '图表') +
      '" preserveAspectRatio="xMidYMid meet">';
  }

  // 刻度文字：自动取最少的小数位，避免 0.25 被写成 0.3
  function fmtTick(v) {
    if (!isFinite(v)) return '—';
    for (var k = 0; k <= 3; k++) {
      var p = Math.pow(10, k);
      if (Math.abs(v * p - Math.round(v * p)) < 1e-9) return v.toFixed(k);
    }
    return fmtNum(v);
  }

  function grid(m, iw, ih, ys, xs) {
    var g = '';
    ys.ticks.forEach(function (t) {
      // 注意：必须加上顶部边距 m.t，否则网格线与数据整体错位
      var y = m.t + ih - (t - ys.min) / (ys.max - ys.min) * ih;
      g += '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (m.l + iw) +
        '" y2="' + y.toFixed(1) + '" stroke="#eef2f0" stroke-width="1"/>';
      g += '<text x="' + (m.l - 8) + '" y="' + (y + 4).toFixed(1) +
        '" text-anchor="end" class="tick">' + fmtTick(t) + '</text>';
    });
    if (xs) {
      xs.forEach(function (x) {
        g += '<line x1="' + x.pos.toFixed(1) + '" y1="' + m.t + '" x2="' + x.pos.toFixed(1) +
          '" y2="' + (m.t + ih) + '" stroke="#f4f7f5" stroke-width="1"/>';
        g += '<text x="' + x.pos.toFixed(1) + '" y="' + (m.t + ih + 18) +
          '" text-anchor="middle" class="tick">' + esc(x.label) + '</text>';
      });
    }
    return g;
  }

  function yAxisTitle(m, ih, text) {
    if (!text) return '';
    return '<text x="' + (m.l - 40) + '" y="' + (m.t + ih / 2) + '" class="axis-title" ' +
      'transform="rotate(-90 ' + (m.l - 40) + ' ' + (m.t + ih / 2) + ')" text-anchor="middle">' +
      esc(text) + '</text>';
  }

  /* ---------------- 折线图 ---------------- */
  function line(host, opt) {
    var W = opt.width || hostWidth(host, 780), H = opt.height || 300;
    var m = { t: 22, r: 18, b: 40, l: 58 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var series = opt.series || [];
    var labels = opt.labels || [];
    var all = [];
    series.forEach(function (s) { all = all.concat(s.values.filter(isFinite)); });
    if (!all.length) { host.innerHTML = empty('暂无可绘制的数据'); return; }
    var ys = niceScale(Math.min.apply(null, all), Math.max.apply(null, all), 5);
    var n = labels.length;
    function xAt(i) { return m.l + (n > 1 ? i / (n - 1) : 0.5) * iw; }
    function yAt(v) { return m.t + ih - (v - ys.min) / (ys.max - ys.min) * ih; }

    var step = Math.max(1, Math.ceil(n / 8));
    var xs = [];
    for (var i = 0; i < n; i += step) xs.push({ pos: xAt(i), label: labels[i] });

    var s = svgOpen(W, H, opt.title || '折线图');
    s += '<defs><linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + (opt.color || PALETTE[0]) + '" stop-opacity="0.18"/>' +
      '<stop offset="100%" stop-color="' + (opt.color || PALETTE[0]) + '" stop-opacity="0.01"/>' +
      '</linearGradient></defs>';
    s += grid(m, iw, ih, ys, xs);
    s += yAxisTitle(m, ih, opt.yLabel);

    // 阈值参考线（标签在折线之后单独绘制，避免被数据线穿过）
    var thrLabel = '';
    if (opt.threshold !== undefined && opt.threshold !== null) {
      var ty = yAt(opt.threshold);
      s += '<line x1="' + m.l + '" y1="' + ty.toFixed(1) + '" x2="' + (m.l + iw) + '" y2="' +
        ty.toFixed(1) + '" stroke="#be123c" stroke-width="1.2" stroke-dasharray="5 4" opacity="0.7"/>';
      var lbl = String(opt.thresholdLabel || '');
      if (lbl) {
        var lw = 0;
        for (var ci = 0; ci < lbl.length; ci++) {
          lw += /[\u4e00-\u9fa5\uff00-\uffef]/.test(lbl[ci]) ? 10.2 : 5.9;
        }
        var bx = Math.max(m.l, m.l + iw - lw - 12);
        thrLabel = '<rect x="' + bx.toFixed(1) + '" y="' + (ty - 19).toFixed(1) + '" width="' +
          (lw + 10).toFixed(1) + '" height="15" rx="4" fill="#fcfefd" fill-opacity="0.95" ' +
          'stroke="#f1dfe4" stroke-width="0.8"/>' +
          '<text x="' + (bx + lw + 4).toFixed(1) + '" y="' + (ty - 7.5).toFixed(1) +
          '" text-anchor="end" class="ref-line">' + esc(lbl) + '</text>';
      }
    }

    series.forEach(function (se, si) {
      var color = se.color || (si === 0 ? (opt.color || PALETTE[0]) : PALETTE[si]);
      var d = '', area = '', started = false;
      var pts = [];
      for (var k = 0; k < n; k++) {
        var v = se.values[k];
        if (!isFinite(v)) { started = false; continue; }
        var px = xAt(k), py = yAt(v);
        pts.push({ x: px, y: py, v: v, i: k });
        d += (started ? ' L' : ' M') + px.toFixed(1) + ' ' + py.toFixed(1);
        started = true;
      }
      if (opt.fill && si === 0) {
        area = '<path d="' + d + ' L' + xAt(n - 1).toFixed(1) + ' ' + (m.t + ih) + ' L' +
          xAt(0).toFixed(1) + ' ' + (m.t + ih) + ' Z" fill="url(#lg1)"/>';
      }
      s += area;
      s += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" ' +
        'stroke-linejoin="round" stroke-linecap="round"/>';
      // 数据点（点数少时才画，避免糊成一片）
      if (n <= 40) {
        pts.forEach(function (p) {
          s += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3" fill="#fff" ' +
            'stroke="' + color + '" stroke-width="1.8"><title>' + esc(labels[p.i] + '：' +
              fmtNum(p.v, 2)) + '</title></circle>';
        });
      } else {
        // 稀疏抽样保留提示
        pts.filter(function (_, idx) { return idx % 7 === 0; }).forEach(function (p) {
          s += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="6" fill="transparent">' +
            '<title>' + esc(labels[p.i] + '：' + fmtNum(p.v, 2)) + '</title></circle>';
        });
      }
      if (se.name && series.length > 1) {
        s += '<text x="' + (m.l + 6 + si * 110) + '" y="' + (m.t - 6) + '" class="legend" ' +
          'fill="' + color + '">■ ' + esc(se.name) + '</text>';
      }
    });
    s += thrLabel;
    s += '</svg>';
    host.innerHTML = s;
  }

  /* ---------------- 柱状图 ---------------- */
  function bar(host, opt) {
    var W = opt.width || hostWidth(host, 780), H = opt.height || 280;
    var m = { t: 22, r: 18, b: 46, l: 58 };
    var labels = opt.labels || [], values = opt.values || [];
    if (!values.length) { host.innerHTML = empty('暂无可绘制的数据'); return; }
    var iw = W - m.l - m.r;
    var slotW = iw / values.length;
    // 标签放不下时改为斜排，避免互相压盖
    var rotate = labels.some(function (l) {
      return String(l).length * 6.4 > slotW * 0.95;
    });
    if (rotate) m.b = 72;
    var ih = H - m.t - m.b;
    // 标签过密时按步长抽样显示，保证可读
    var minLabelW = rotate ? 46 : 58;
    var labelStep = Math.max(1, Math.ceil(minLabelW / slotW));
    var ys = niceScale(Math.min(0, Math.min.apply(null, values)), Math.max(0, Math.max.apply(null, values)), 5);
    var bw = iw / values.length;
    var barW = Math.max(6, bw * 0.62);

    var s = svgOpen(W, H, opt.title || '柱状图');
    s += grid(m, iw, ih, ys, null);
    s += yAxisTitle(m, ih, opt.yLabel);
    var zeroY = m.t + ih - (0 - ys.min) / (ys.max - ys.min) * ih;
    values.forEach(function (v, i) {
      var x = m.l + bw * i + (bw - barW) / 2;
      var y = m.t + ih - (v - ys.min) / (ys.max - ys.min) * ih;
      var h = Math.abs(zeroY - y);
      var color = opt.colors ? opt.colors[i] : (opt.color || PALETTE[0]);
      s += '<rect x="' + x.toFixed(1) + '" y="' + Math.min(y, zeroY).toFixed(1) + '" width="' +
        barW.toFixed(1) + '" height="' + Math.max(1, h).toFixed(1) + '" rx="4" fill="' + color +
        '" opacity="0.88"><title>' + esc(labels[i] + '：' + fmtNum(v, 2)) + '</title></rect>';
      if (i % labelStep === 0) {
        if (rotate) {
          var lx = (x + barW / 2).toFixed(1), ly = (m.t + ih + 14).toFixed(1);
          s += '<text x="' + lx + '" y="' + ly + '" text-anchor="end" class="tick" ' +
            'transform="rotate(-40 ' + lx + ' ' + ly + ')">' + esc(labels[i]) + '</text>';
        } else {
          s += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (m.t + ih + 18) +
            '" text-anchor="middle" class="tick">' + esc(labels[i]) + '</text>';
        }
      }
      if (values.length <= 14) {
        s += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' +
          (Math.min(y, zeroY) - 6).toFixed(1) + '" text-anchor="middle" class="bar-value">' +
          fmtNum(v, 1) + '</text>';
      }
    });
    s += '</svg>';
    host.innerHTML = s;
  }

  /* ---------------- 散点图 + 拟合线 ---------------- */
  function scatter(host, opt) {
    var W = opt.width || hostWidth(host, 780), H = opt.height || 340;
    var m = { t: 22, r: 22, b: 48, l: 62 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var pts = opt.points || [];
    if (pts.length < 2) { host.innerHTML = empty('有效点不足，无法绘图'); return; }
    var xs0 = pts.map(function (p) { return p.x; });
    var ys0 = pts.map(function (p) { return p.y; });
    var xsc = niceScale(Math.min.apply(null, xs0), Math.max.apply(null, xs0), 6);
    var ysc = niceScale(Math.min.apply(null, ys0), Math.max.apply(null, ys0), 5);
    function X(v) { return m.l + (v - xsc.min) / (xsc.max - xsc.min) * iw; }
    function Y(v) { return m.t + ih - (v - ysc.min) / (ysc.max - ysc.min) * ih; }

    var s = svgOpen(W, H, opt.title || '散点图');
    s += grid(m, iw, ih, ysc, null);
    // x 轴刻度
    xsc.ticks.forEach(function (t) {
      var x = X(t);
      s += '<text x="' + x.toFixed(1) + '" y="' + (m.t + ih + 18) +
        '" text-anchor="middle" class="tick">' + fmtNum(t) + '</text>';
    });
    s += yAxisTitle(m, ih, opt.yLabel);
    s += '<text x="' + (m.l + iw / 2) + '" y="' + (H - 6) +
      '" text-anchor="middle" class="axis-title">' + esc(opt.xLabel || '') + '</text>';

    if (opt.line && isFinite(opt.line.slope)) {
      var x1 = xsc.min, x2 = xsc.max;
      var y1 = opt.line.intercept + opt.line.slope * x1;
      var y2 = opt.line.intercept + opt.line.slope * x2;
      s += '<line x1="' + X(x1).toFixed(1) + '" y1="' + Y(y1).toFixed(1) + '" x2="' +
        X(x2).toFixed(1) + '" y2="' + Y(y2).toFixed(1) + '" stroke="#b45309" stroke-width="2" ' +
        'stroke-dasharray="7 5" opacity="0.9"/>';
    }
    pts.forEach(function (p) {
      s += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="4.2" ' +
        'fill="' + (opt.color || PALETTE[2]) + '" fill-opacity="0.55" stroke="#fff" stroke-width="0.9">' +
        '<title>' + esc((p.label ? p.label + '　' : '') + fmtNum(p.x, 2) + ' , ' + fmtNum(p.y, 2)) +
        '</title></circle>';
    });
    s += '</svg>';
    host.innerHTML = s;
  }

  /* ---------------- 直方图 ---------------- */
  function histogram(host, opt) {
    var W = opt.width || hostWidth(host, 780), H = opt.height || 280;
    var m = { t: 22, r: 18, b: 46, l: 58 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var v = (opt.values || []).filter(isFinite);
    if (v.length < 3) { host.innerHTML = empty('有效观测不足，无法绘制分布'); return; }
    var bins = opt.bins || Math.max(6, Math.ceil(Math.sqrt(v.length)) + 2);
    var min = Math.min.apply(null, v), max = Math.max.apply(null, v);
    var w = (max - min) / bins || 1;
    var counts = new Array(bins).fill(0);
    v.forEach(function (x) {
      var k = Math.min(bins - 1, Math.floor((x - min) / w));
      counts[k]++;
    });
    var ysc = niceScale(0, Math.max.apply(null, counts), 4);
    var bw = iw / bins;
    var s = svgOpen(W, H, opt.title || '直方图');
    s += grid(m, iw, ih, ysc, null);
    s += yAxisTitle(m, ih, '频数');
    counts.forEach(function (c, i) {
      var y = m.t + ih - c / ysc.max * ih;
      var x = m.l + bw * i;
      s += '<rect x="' + (x + 1.5).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' +
        (bw - 3).toFixed(1) + '" height="' + (m.t + ih - y).toFixed(1) + '" rx="2.5" fill="' +
        (opt.color || PALETTE[0]) + '" opacity="0.72"><title>' +
        esc(fmtNum(min + i * w, 2) + ' ~ ' + fmtNum(min + (i + 1) * w, 2) + '：' + c + ' 个') +
        '</title></rect>';
    });
    // x 轴端点标注
    [0, 0.5, 1].forEach(function (f) {
      var val = min + (max - min) * f;
      s += '<text x="' + (m.l + iw * f).toFixed(1) + '" y="' + (m.t + ih + 18) +
        '" text-anchor="middle" class="tick">' + fmtNum(val, 1) + '</text>';
    });
    s += '<text x="' + (m.l + iw / 2) + '" y="' + (H - 6) +
      '" text-anchor="middle" class="axis-title">' + esc(opt.xLabel || '') + '</text>';
    s += '</svg>';
    host.innerHTML = s;
  }

  /* ---------------- 箱线图 ---------------- */
  function box(host, opt) {
    var W = opt.width || hostWidth(host, 780), H = opt.height || 300;
    var m = { t: 22, r: 18, b: 46, l: 62 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var groups = (opt.groups || []).filter(function (g) { return g.stats && g.stats.n > 1; });
    if (!groups.length) { host.innerHTML = empty('分组有效观测不足'); return; }
    var all = [];
    groups.forEach(function (g) { all.push(g.stats.min, g.stats.max); });
    var ysc = niceScale(Math.min.apply(null, all), Math.max.apply(null, all), 5);
    function Y(v) { return m.t + ih - (v - ysc.min) / (ysc.max - ysc.min) * ih; }
    var slot = iw / groups.length;

    var s = svgOpen(W, H, opt.title || '箱线图');
    s += grid(m, iw, ih, ysc, null);
    s += yAxisTitle(m, ih, opt.yLabel);
    groups.forEach(function (g, i) {
      var st = g.stats;
      var color = PALETTE[i % PALETTE.length];
      var cx = m.l + slot * i + slot / 2;
      var bw = Math.min(64, slot * 0.5);
      var lo = Math.max(st.min, st.lowerFence);
      var hi = Math.min(st.max, st.upperFence);
      // 须线
      s += '<line x1="' + cx + '" y1="' + Y(hi).toFixed(1) + '" x2="' + cx + '" y2="' +
        Y(lo).toFixed(1) + '" stroke="' + color + '" stroke-width="1.4"/>';
      s += '<line x1="' + (cx - 14) + '" y1="' + Y(hi).toFixed(1) + '" x2="' + (cx + 14) +
        '" y2="' + Y(hi).toFixed(1) + '" stroke="' + color + '" stroke-width="1.4"/>';
      s += '<line x1="' + (cx - 14) + '" y1="' + Y(lo).toFixed(1) + '" x2="' + (cx + 14) +
        '" y2="' + Y(lo).toFixed(1) + '" stroke="' + color + '" stroke-width="1.4"/>';
      // 箱体
      s += '<rect x="' + (cx - bw / 2) + '" y="' + Y(st.q3).toFixed(1) + '" width="' + bw +
        '" height="' + Math.max(2, Y(st.q1) - Y(st.q3)).toFixed(1) + '" rx="4" fill="' + color +
        '" fill-opacity="0.18" stroke="' + color + '" stroke-width="1.4"><title>' +
        esc(g.label + '：n=' + st.n + '，中位数 ' + fmtNum(st.median, 2)) + '</title></rect>';
      // 中位数
      s += '<line x1="' + (cx - bw / 2) + '" y1="' + Y(st.median).toFixed(1) + '" x2="' +
        (cx + bw / 2) + '" y2="' + Y(st.median).toFixed(1) + '" stroke="' + color +
        '" stroke-width="2.6"/>';
      // 均值
      s += '<circle cx="' + cx + '" cy="' + Y(st.mean).toFixed(1) + '" r="3" fill="#fff" stroke="' +
        color + '" stroke-width="1.6"><title>均值 ' + esc(fmtNum(st.mean, 2)) + '</title></circle>';
      // 异常值
      (g.outliers || []).forEach(function (o) {
        s += '<circle cx="' + cx + '" cy="' + Y(o).toFixed(1) + '" r="2.8" fill="none" stroke="' +
          color + '" stroke-width="1.2" opacity="0.8"/>';
      });
      s += '<text x="' + cx + '" y="' + (m.t + ih + 18) + '" text-anchor="middle" class="tick">' +
        esc(g.label) + '</text>';
    });
    s += '</svg>';
    host.innerHTML = s;
  }

  /* ---------------- 相关矩阵热力图 ---------------- */
  function heatmap(host, opt) {
    var labels = opt.labels || [];
    var mat = opt.matrix || [];
    var n = labels.length;
    if (n < 2) { host.innerHTML = empty('数值变量少于 2 个，无法计算相关矩阵'); return; }
    var availW = opt.width || hostWidth(host, 620);
    var left = 92, top = 76;
    var cell = Math.min(64, Math.max(26, (availW - left - 18) / n));
    var W = Math.round(left + cell * n + 18), H = Math.round(top + cell * n + 12);
    function color(r) {
      if (!isFinite(r)) return '#f3f5f4';
      var a = Math.min(1, Math.abs(r));
      return r >= 0
        ? 'rgba(15,118,110,' + (0.08 + 0.82 * a) + ')'
        : 'rgba(190,18,60,' + (0.08 + 0.82 * a) + ')';
    }
    var s = svgOpen(W, H, '相关系数矩阵');
    labels.forEach(function (lb, i) {
      s += '<text x="' + (left - 10) + '" y="' + (top + cell * i + cell / 2 + 4) +
        '" text-anchor="end" class="tick">' + esc(lb) + '</text>';
      s += '<text x="' + (left + cell * i + cell / 2) + '" y="' + (top - 8) +
        '" text-anchor="start" transform="rotate(-42 ' + (left + cell * i + cell / 2) + ' ' +
        (top - 8) + ')" class="tick">' + esc(lb) + '</text>';
      for (var j = 0; j < n; j++) {
        var r = mat[i][j];
        s += '<rect x="' + (left + cell * j) + '" y="' + (top + cell * i) + '" width="' + cell +
          '" height="' + cell + '" fill="' + color(r) + '" stroke="#fff" stroke-width="1.5"><title>' +
          esc(lb + ' ~ ' + labels[j] + '：r = ' + (isFinite(r) ? r.toFixed(3) : '—')) + '</title></rect>';
        if (cell >= 40) {
          s += '<text x="' + (left + cell * j + cell / 2) + '" y="' + (top + cell * i + cell / 2 + 4) +
            '" text-anchor="middle" class="cell-text" fill="' + (Math.abs(r) > 0.6 ? '#fff' : '#25403a') +
            '">' + (isFinite(r) ? r.toFixed(2) : '—') + '</text>';
        }
      }
    });
    s += '</svg>';
    host.innerHTML = s;
  }

  /* ---------------- 经验分布函数（ECDF）与正态参照 ---------------- */
  function ecdf(host, opt) {
    var W = opt.width || hostWidth(host, 780), H = opt.height || 280;
    var m = { t: 22, r: 18, b: 46, l: 58 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var v = (opt.values || []).filter(isFinite).slice().sort(function (a, b) { return a - b; });
    if (v.length < 3) { host.innerHTML = empty('有效观测不足'); return; }
    var n = v.length;
    var xsc = niceScale(v[0], v[n - 1], 5);
    function X(x) { return m.l + (x - xsc.min) / (xsc.max - xsc.min) * iw; }
    function Y(p) { return m.t + ih - p * ih; }

    var s = svgOpen(W, H, opt.title || '经验分布函数');
    s += grid(m, iw, ih, { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] }, null);
    xsc.ticks.forEach(function (t) {
      s += '<text x="' + X(t).toFixed(1) + '" y="' + (m.t + ih + 18) +
        '" text-anchor="middle" class="tick">' + fmtNum(t) + '</text>';
    });
    s += yAxisTitle(m, ih, '累积概率');
    s += '<text x="' + (m.l + iw / 2) + '" y="' + (H - 6) +
      '" text-anchor="middle" class="axis-title">' + esc(opt.xLabel || '') + '</text>';

    // 经验分布阶梯线
    var d = 'M' + X(v[0]).toFixed(1) + ' ' + Y(0).toFixed(1);
    for (var i = 0; i < n; i++) {
      var p = (i + 1) / n;
      d += ' L' + X(v[i]).toFixed(1) + ' ' + Y(i / n).toFixed(1) +
        ' L' + X(v[i]).toFixed(1) + ' ' + Y(p).toFixed(1);
    }
    s += '<path d="' + d + '" fill="none" stroke="' + (opt.color || PALETTE[0]) +
      '" stroke-width="2"/>';

    // 正态参照（同均值同标准差）
    if (opt.normalParams && isFinite(opt.normalParams.mean)) {
      var mu = opt.normalParams.mean, sg = opt.normalParams.sd;
      var dn = '', first = true;
      for (var k = 0; k <= 100; k++) {
        var xv = xsc.min + (xsc.max - xsc.min) * k / 100;
        var z = (xv - mu) / sg;
        var pp = 0.5 * (1 + erf(z / Math.SQRT2));
        dn += (first ? 'M' : ' L') + X(xv).toFixed(1) + ' ' + Y(pp).toFixed(1);
        first = false;
      }
      s += '<path d="' + dn + '" fill="none" stroke="#b45309" stroke-width="1.6" ' +
        'stroke-dasharray="6 4" opacity="0.85"/>';
      s += '<text x="' + (m.l + iw - 4) + '" y="' + (m.t + 14) +
        '" text-anchor="end" class="legend" fill="#b45309">— — 正态参照</text>';
    }
    s += '</svg>';
    host.innerHTML = s;
  }

  function erf(x) {
    // Abramowitz & Stegun 7.1.26
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
      0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sign * y;
  }

  function empty(msg) {
    return '<div class="chart-empty">' + esc(msg) + '</div>';
  }

  return {
    line: line, bar: bar, scatter: scatter, histogram: histogram,
    box: box, heatmap: heatmap, ecdf: ecdf,
    niceScale: niceScale, palette: PALETTE
  };
});
