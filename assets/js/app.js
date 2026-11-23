/*!
 * EnvStat · 应用主逻辑
 * 负责：数据装载与类型推断、分析编排、界面渲染、结论生成、导出
 */
(function () {
  'use strict';

  var S = window.EnvStats, C = window.EnvCharts, D = window.EnvData;
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var state = { name: '', rows: [], cols: [], cfg: {}, R: {}, insight: { html: '', text: '' } };

  /* =========================================================
   * 1. 工具函数
   * ======================================================= */

  var DATE_RE = /^(\d{4})[-/年.](\d{1,2})(?:[-/月.](\d{1,2}))?/;

  function isDateLike(v) {
    return typeof v === 'string' && DATE_RE.test(v.trim());
  }

  function toNum(v) {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return NaN;
    var s = v.replace(/[,，\s%]/g, '');
    if (!s) return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function monthOf(v) {
    var m = DATE_RE.exec(String(v || '').trim());
    return m ? +m[2] : NaN;
  }

  function dateLabel(v) {
    var m = DATE_RE.exec(String(v || '').trim());
    if (!m) return String(v || '');
    return m[3] ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2)
      : m[1] + '-' + ('0' + m[2]).slice(-2);
  }

  function numericKeys() {
    return state.cols.filter(function (c) { return c.type === 'number'; }).map(function (c) { return c.key; });
  }
  function categoryKeys() {
    return state.cols.filter(function (c) { return c.type === 'category'; }).map(function (c) { return c.key; });
  }
  function dateKeys() {
    return state.cols.filter(function (c) { return c.type === 'date'; }).map(function (c) { return c.key; });
  }
  function unitOf(key) {
    var c = state.cols.filter(function (x) { return x.key === key; })[0];
    return c && c.unit ? c.unit : '';
  }
  function valuesOf(key) {
    return state.rows.map(function (r) { return r[key]; }).map(function (v) {
      return typeof v === 'number' ? v : toNum(v);
    });
  }
  function rawOf(key) {
    return state.rows.map(function (r) { return r[key]; });
  }

  function chips(host, list) {
    host.innerHTML = list.filter(function (c) { return c && c.text; }).map(function (c) {
      return '<span class="chip ' + (c.tone || '') + '">' + esc(c.text) + '</span>';
    }).join('');
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  /* =========================================================
   * 2. 数据装载
   * ======================================================= */

  function loadDataset(ds) {
    state.name = ds.name;
    state.rows = ds.rows;
    state.cols = ds.columns;
    $('datasetDesc').innerHTML = esc(ds.desc || '') +
      '<br><span style="color:#8a9a92">' + ds.rows.length + ' 行 × ' + ds.columns.length + ' 列</span>';
    pickDefaults();
    syncSelects();
    analyze();
  }

  function pickDefaults() {
    var nums = numericKeys(), cats = categoryKeys(), dates = dateKeys();
    var cfg = { test: 'welch' };
    // 优先把“去除率/效率”这类结果型指标作为默认分析变量
    var ratioCols = nums.filter(function (k) {
      var c = state.cols.filter(function (x) { return x.key === k; })[0];
      return (c && c.unit === '%') || /去除率|效率|达标率/.test(k);
    });
    cfg.col = ratioCols[0] || nums[0] || null;
    cfg.x = nums[0] || null;
    cfg.y = nums[1] || nums[0] || null;
    cfg.date = dates[0] || null;
    // 分组默认：优先 2 水平（可直接做 t 检验），其次 3~8 水平（方差分析）
    var best = null, bestScore = 99;
    cats.forEach(function (k) {
      var levels = uniqueLevels(k).length;
      var score = levels === 2 ? 0 : (levels >= 3 && levels <= 8 ? 1 : 3);
      if (score < bestScore) { bestScore = score; best = k; }
    });
    cfg.group = best || (cfg.date ? '__season' : null);
    state.cfg = cfg;
  }

  function uniqueLevels(key) {
    var seen = [], map = {};
    state.rows.forEach(function (r) {
      var v = String(r[key] === null || r[key] === undefined ? '' : r[key]);
      if (!map[v]) { map[v] = 1; seen.push(v); }
    });
    return seen;
  }

  function syncSelects() {
    var nums = numericKeys(), dates = dateKeys();
    var optNum = nums.map(function (k) {
      return '<option value="' + esc(k) + '">' + esc(k) + (unitOf(k) ? '（' + esc(unitOf(k)) + '）' : '') + '</option>';
    }).join('');

    $('colSelect').innerHTML = optNum;
    $('xSelect').innerHTML = optNum;
    $('ySelect').innerHTML = optNum;

    var gOpts = categoryKeys().map(function (k) {
      return '<option value="' + esc(k) + '">' + esc(k) + '</option>';
    });
    if (dates.length) {
      gOpts.push('<option value="__season">（派生）按季节分组</option>');
      gOpts.push('<option value="__month">（派生）按月份分组</option>');
    }
    $('groupSelect').innerHTML = gOpts.length ? gOpts.join('') : '<option value="">（无可用分组变量）</option>';

    $('dateSelect').innerHTML = dates.length
      ? dates.map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + '</option>'; }).join('')
      : '<option value="">（无时间列）</option>';

    var cfg = state.cfg;
    if (cfg.col) $('colSelect').value = cfg.col;
    if (cfg.x) $('xSelect').value = cfg.x;
    if (cfg.y) $('ySelect').value = cfg.y;
    if (cfg.group) $('groupSelect').value = cfg.group;
    if (cfg.date) $('dateSelect').value = cfg.date;
    $('testSelect').value = cfg.test || 'welch';
  }

  /* =========================================================
   * 3. 分析编排
   * ======================================================= */

  function analyze() {
    var cfg = state.cfg, rows = state.rows, cols = state.cols;
    var R = { n: rows.length, cols: cols.length, numeric: numericKeys(), unit: unitOf(cfg.col) };

    /* 数据质量 */
    R.quality = cols.map(function (c) {
      var vals = rawOf(c.key);
      var filled = vals.filter(function (v) {
        return v !== '' && v !== null && v !== undefined && !(typeof v === 'number' && !isFinite(v));
      });
      var missing = rows.length - filled.length;
      var outliers = 0;
      if (c.type === 'number') {
        var d = S.describe(vals.map(toNum));
        outliers = vals.map(toNum).filter(function (v) {
          return isFinite(v) && (v < d.lowerFence || v > d.upperFence);
        }).length;
      }
      return { key: c.key, type: c.type, filled: filled.length, missing: missing, outliers: outliers };
    });
    var totalCells = rows.length * cols.length;
    var totalMissing = R.quality.reduce(function (s, q) { return s + q.missing; }, 0);
    R.completeness = totalCells ? 1 - totalMissing / totalCells : 1;
    R.totalMissing = totalMissing;
    R.totalOutliers = R.quality.reduce(function (s, q) { return s + q.outliers; }, 0);

    /* 时间跨度 */
    if (cfg.date) {
      var ds = rawOf(cfg.date).filter(isDateLike).map(dateLabel).sort();
      R.timeSpan = ds.length ? ds[0] + ' ~ ' + ds[ds.length - 1] : '—';
    } else R.timeSpan = '—';

    /* 分布 */
    R.desc = S.describe(valuesOf(cfg.col));
    R.jb = S.jarqueBera(valuesOf(cfg.col));

    /* 相关矩阵 */
    var corrCols = R.numeric.slice(0, 8);
    var matrix = corrCols.map(function (a) {
      return corrCols.map(function (b) {
        if (a === b) return 1;
        return S.pearson(valuesOf(a), valuesOf(b)).r;
      });
    });
    R.corr = { labels: corrCols, matrix: matrix };
    var pairList = [];
    for (var i = 0; i < corrCols.length; i++) {
      for (var j = i + 1; j < corrCols.length; j++) {
        var pr = S.pearson(valuesOf(corrCols[i]), valuesOf(corrCols[j]));
        if (isFinite(pr.r)) {
          pairList.push({ a: corrCols[i], b: corrCols[j], r: pr.r, p: pr.p, n: pr.n });
        }
      }
    }
    pairList.sort(function (u, v) { return Math.abs(v.r) - Math.abs(u.r); });
    R.pairs = pairList;

    /* 回归 */
    if (cfg.x && cfg.y && cfg.x !== cfg.y) {
      R.pearson = S.pearson(valuesOf(cfg.x), valuesOf(cfg.y));
      R.reg = S.linreg(valuesOf(cfg.x), valuesOf(cfg.y));
      R.scatterPoints = state.rows.map(function (r) {
        var xv = toNum(r[cfg.x]), yv = toNum(r[cfg.y]);
        return isFinite(xv) && isFinite(yv) ? { x: xv, y: yv } : null;
      }).filter(Boolean);
    } else {
      R.pearson = { r: NaN, p: NaN, n: 0 };
      R.reg = { slope: NaN };
      R.scatterPoints = [];
    }

    /* 组间比较 */
    R.group = analyzeGroups();

    /* 时间趋势 */
    R.trend = analyzeTrend();

    state.R = R;
    state.insight = buildInsight(R);
    renderAll();
  }

  function groupTitle(key) {
    if (key === '__season') return '季节';
    if (key === '__month') return '月份';
    return key;
  }

  function groupLabelOf(row, key) {
    if (key === '__season') {
      var m = monthOf(row[state.cfg.date]);
      if (!isFinite(m)) return '未知';
      return (m === 12 || m <= 2) ? '冬季' : (m <= 5 ? '春季' : (m <= 8 ? '夏季' : '秋季'));
    }
    if (key === '__month') {
      var mm = monthOf(row[state.cfg.date]);
      return isFinite(mm) ? mm + ' 月' : '未知';
    }
    var v = row[key];
    return (v === '' || v === null || v === undefined) ? '（空值）' : String(v);
  }

  function analyzeGroups() {
    var cfg = state.cfg;
    if (!cfg.group) return { ok: false, reason: '当前数据没有可用的分类变量，可在数据中加入分组列后重试。' };
    var order = [], map = {};
    state.rows.forEach(function (r) {
      var lb = groupLabelOf(r, cfg.group);
      if (!map[lb]) { map[lb] = []; order.push(lb); }
      map[lb].push(toNum(r[cfg.col]));
    });
    var groups = order.map(function (lb) {
      var d = S.describe(map[lb]);
      return { label: lb, values: map[lb].filter(isFinite), stats: d };
    }).filter(function (g) { return g.values.length >= 2; });

    if (groups.length < 2) {
      return { ok: false, reason: '分组后的有效观测不足（至少需要 2 个组、每组 2 个观测）。' };
    }
    // 组数过多时保留样本量最大的 8 组
    if (groups.length > 8) {
      groups.sort(function (a, b) { return b.values.length - a.values.length; });
      groups = groups.slice(0, 8);
      groups.forEach(function (g) { g.stats.outliers = outliersOf(g.values, g.stats); });
    }
    groups.forEach(function (g) { g.stats.outliers = outliersOf(g.values, g.stats); });

    var result = { ok: true, key: cfg.group, label: groupTitle(cfg.group), varName: cfg.col, groups: groups, unit: unitOf(cfg.col) };
    if (groups.length === 2) {
      result.kind = 't';
      result.t = S.tTest(groups[0].values, groups[1].values, cfg.test !== 'student');
    } else {
      result.kind = 'anova';
      result.a = S.anova(groups.map(function (g) { return { label: g.label, values: g.values }; }));
    }
    return result;
  }

  function outliersOf(vals, d) {
    return vals.filter(function (v) { return isFinite(v) && (v < d.lowerFence || v > d.upperFence); });
  }

  function analyzeTrend() {
    var cfg = state.cfg, R = {};
    if (!cfg.date) return { ok: false, reason: '当前数据没有可识别的时间列。' };
    var pairs = state.rows.map(function (r) {
      var v = toNum(r[cfg.col]);
      return { d: dateLabel(r[cfg.date]), m: monthOf(r[cfg.date]), key: dateKey(r[cfg.date]), v: v };
    }).filter(function (p) { return isFinite(p.v) && isFinite(p.key); });

    if (pairs.length < 4) return { ok: false, reason: '时间列可解析的记录不足 4 条。' };

    pairs.sort(function (a, b) { return a.key - b.key; });
    R.labels = pairs.map(function (p) { return p.d; });
    R.values = pairs.map(function (p) { return p.v; });

    // 月度聚合
    var mMap = {}, mOrder = [];
    pairs.forEach(function (p) {
      var mk = String(p.key).slice(0, 6);
      if (!mMap[mk]) { mMap[mk] = { sum: 0, n: 0, label: mk.slice(0, 4) + '-' + mk.slice(4, 6) }; mOrder.push(mk); }
      mMap[mk].sum += p.v; mMap[mk].n++;
    });
    R.monthLabels = mOrder.map(function (k) { return mMap[k].label; });
    R.monthValues = mOrder.map(function (k) { return mMap[k].sum / mMap[k].n; });

    // 月度均值序列做 MK（避免逐日自相关导致 p 值过于乐观）
    R.mk = R.monthValues.length >= 4 ? S.mannKendall(R.monthValues) : S.mannKendall(R.values);
    R.mkOn = R.monthValues.length >= 4 ? 'monthly' : 'raw';

    // 峰谷月
    if (R.monthValues.length >= 3) {
      var maxI = 0, minI = 0;
      R.monthValues.forEach(function (v, i) {
        if (v > R.monthValues[maxI]) maxI = i;
        if (v < R.monthValues[minI]) minI = i;
      });
      R.peak = { label: R.monthLabels[maxI], value: R.monthValues[maxI] };
      R.trough = { label: R.monthLabels[minI], value: R.monthValues[minI] };
    }
    R.ok = true;
    return R;
  }

  function dateKey(v) {
    var m = DATE_RE.exec(String(v || '').trim());
    if (!m) return NaN;
    var y = +m[1], mo = +m[2], d = m[3] ? +m[3] : 1;
    return y * 10000 + mo * 100 + d;
  }

  /* 环境标准参考线（仅用于图示，不参与检验） */
  var LIMITS = {
    'PM2.5': { v: 75, label: 'GB 3095 二级日均 75' },
    'PM10': { v: 150, label: 'GB 3095 二级日均 150' },
    'SO2': { v: 150, label: 'GB 3095 二级日均 150' },
    'NO2': { v: 80, label: 'GB 3095 二级日均 80' },
    'CO': { v: 4, label: 'GB 3095 二级日均 4' },
    'O3': { v: 160, label: 'GB 3095 二级日最大8h 160' },
    '氨氮': { v: 1.0, label: 'GB 3838 Ⅲ类 1.0' },
    '高锰酸盐指数': { v: 6, label: 'GB 3838 Ⅲ类 6' },
    '总磷': { v: 0.2, label: 'GB 3838 Ⅲ类 0.2' }
  };

  /* =========================================================
   * 4. 渲染
   * ======================================================= */

  function renderAll() {
    renderKpis();
    renderQuality();
    renderDesc();
    renderCorr();
    renderReg();
    renderGroup();
    renderTrend();
    renderInsight();
  }

  function renderKpis() {
    var R = state.R;
    var items = [
      { label: '样本量', value: R.n, sub: '条记录' },
      { label: '数值变量', value: R.numeric.length, sub: '参与统计分析' },
      { label: '数据完整率', value: (R.completeness * 100).toFixed(1) + '%', sub: R.totalMissing ? '缺失 ' + R.totalMissing + ' 个' : '无缺失值' },
      { label: '时间跨度', value: R.timeSpan === '—' ? '—' : R.timeSpan.split(' ~ ')[0], sub: R.timeSpan === '—' ? '无时间列' : '至 ' + R.timeSpan.split(' ~ ')[1] },
      { label: '异常值', value: R.totalOutliers, sub: 'IQR 1.5 倍准则' }
    ];
    $('kpis').innerHTML = items.map(function (it) {
      return '<div class="kpi"><div class="k-label">' + esc(it.label) + '</div>' +
        '<div class="k-value">' + esc(it.value) + '</div>' +
        '<div class="k-sub">' + esc(it.sub) + '</div></div>';
    }).join('');
  }

  function renderQuality() {
    var R = state.R;
    var rows = R.quality.map(function (q) {
      var typeName = q.type === 'number' ? '数值' : (q.type === 'date' ? '时间' : '分类');
      return '<tr><td>' + esc(q.key) + '</td><td>' + typeName + '</td>' +
        '<td class="num">' + q.filled + '</td>' +
        '<td class="num">' + (q.missing ? '<span style="color:#b45309">' + q.missing + '</span>' : 0) + '</td>' +
        '<td class="num">' + (q.outliers ? q.outliers : '—') + '</td></tr>';
    }).join('');
    $('qualityTable').innerHTML =
      '<thead><tr><th>变量</th><th>类型</th><th>有效值</th><th>缺失</th><th>异常值</th></tr></thead><tbody>' +
      rows + '</tbody>';

    chips($('qualityChips'), [
      { text: R.completeness === 1 ? '无缺失值' : '完整率 ' + (R.completeness * 100).toFixed(1) + '%', tone: R.completeness > 0.98 ? 'ok' : 'warn' },
      { text: '数值变量 ' + R.numeric.length + ' 个' },
      { text: '分类变量 ' + categoryKeys().length + ' 个' },
      { text: '异常值 ' + R.totalOutliers + ' 个', tone: R.totalOutliers ? 'warn' : 'ok' }
    ]);

    $('qualityNote').innerHTML = '异常值按 <b>Q1 − 1.5×IQR ~ Q3 + 1.5×IQR</b> 判定，仅作数据检查提示，' +
      '不代表该值一定错误——环境监测中的高值往往正是污染过程的真实反映，剔除前需要回到采样记录核对。';
  }

  function renderDesc() {
    var R = state.R, cfg = state.cfg, d = R.desc, u = R.unit ? ' ' + R.unit : '';
    $('descVarName').textContent = cfg.col || '—';
    if (!d.n) {
      $('descStats').innerHTML = '<div class="chart-empty">该变量没有有效观测</div>';
      return;
    }
    var normal = R.jb.p >= 0.05;
    var cells = [
      ['样本量 n', d.n],
      ['均值', S.fmt(d.mean)],
      ['标准差', S.fmt(d.sd)],
      ['变异系数', S.fmt(d.cv * 100, 1) + '%'],
      ['中位数', S.fmt(d.median)],
      ['四分位距', S.fmt(d.iqr)],
      ['最小值', S.fmt(d.min)],
      ['最大值', S.fmt(d.max)],
      ['偏度', S.fmt(d.skew)],
      ['峰度', S.fmt(d.kurt)],
      ['JB 检验 p', S.fmtP(R.jb.p)]
    ];
    $('descStats').innerHTML = cells.map(function (c) {
      return '<div class="stat-cell"><div class="s-label">' + esc(c[0]) + '</div>' +
        '<div class="s-value">' + esc(c[1]) + '</div></div>';
    }).join('');

    chips($('descChips'), [
      { text: normal ? '不能拒绝正态分布' : '偏离正态分布', tone: normal ? 'ok' : 'warn' },
      { text: '偏度 ' + S.fmt(d.skew) + '（' + skewWord(d.skew) + '）' },
      { text: '变异系数 ' + S.fmt(d.cv * 100, 1) + '%（' + dispWord(d.cv) + '）' }
    ]);

    C.histogram($('histChart'), {
      values: valuesOf(cfg.col), xLabel: cfg.col + (u ? '（' + u.trim() + '）' : ''), title: cfg.col + ' 分布直方图'
    });
    C.ecdf($('ecdfChart'), {
      values: valuesOf(cfg.col), xLabel: cfg.col,
      normalParams: { mean: d.mean, sd: d.sd }, title: cfg.col + ' 经验分布'
    });
  }

  function skewWord(s) {
    if (!isFinite(s)) return '—';
    if (Math.abs(s) < 0.3) return '近似对称';
    return s > 0 ? '右偏，存在高值尾部' : '左偏，存在低值尾部';
  }
  function dispWord(cv) {
    if (!isFinite(cv)) return '—';
    if (cv < 0.15) return '数据集中';
    if (cv < 0.3) return '中等波动';
    return '波动较大';
  }
  function rWord(r) {
    var a = Math.abs(r);
    if (a < 0.3) return '弱';
    if (a < 0.6) return '中等';
    if (a < 0.8) return '较强';
    return '强';
  }
  function dWord(d) {
    var a = Math.abs(d);
    if (a < 0.2) return '很小';
    if (a < 0.5) return '小';
    if (a < 0.8) return '中等';
    return '大';
  }
  function etaWord(e) {
    if (e < 0.01) return '极小';
    if (e < 0.06) return '较小';
    if (e < 0.14) return '中等';
    return '较大';
  }

  function renderCorr() {
    var R = state.R;
    if (R.corr.labels.length < 2) {
      $('corrChart').innerHTML = '<div class="chart-empty">数值变量少于 2 个，无法计算相关矩阵</div>';
      $('corrList').innerHTML = '';
      chips($('corrChips'), []);
      return;
    }
    C.heatmap($('corrChart'), { labels: R.corr.labels, matrix: R.corr.matrix });
    var top = R.pairs.slice(0, 6);
    if (!top.length) {
      $('corrList').innerHTML = '<div class="chart-empty">没有可计算的相关对</div>';
    } else {
      var rows = top.map(function (p) {
        var sig = p.p < 0.05;
        return '<tr><td>' + esc(p.a) + ' × ' + esc(p.b) + '</td>' +
          '<td class="num ' + (sig ? 'sig' : 'ns') + '">' + p.r.toFixed(3) + '</td>' +
          '<td class="num">' + S.fmtP(p.p) + ' ' + S.stars(p.p) + '</td>' +
          '<td class="num">' + p.n + '</td></tr>';
      }).join('');
      $('corrList').innerHTML =
        '<div class="table-wrap"><table class="data"><thead><tr><th>变量对</th><th>r</th><th>p</th><th>n</th></tr></thead><tbody>' +
        rows + '</tbody></table></div>' +
        '<p class="footnote">按 |r| 排序取前 6 对。显著性标记：*** p&lt;0.001，** p&lt;0.01，* p&lt;0.05。</p>';
    }
    var first = R.pairs[0];
    chips($('corrChips'), first ? [
      { text: '最强：' + first.a + ' ~ ' + first.b + ' r=' + first.r.toFixed(2), tone: Math.abs(first.r) > 0.6 ? 'ok' : '' },
      { text: '显著变量对 ' + R.pairs.filter(function (p) { return p.p < 0.05; }).length + ' / ' + R.pairs.length }
    ] : []);
  }

  function renderReg() {
    var R = state.R, cfg = state.cfg;
    $('regTitle').textContent = (cfg.x || '—') + ' → ' + (cfg.y || '—');
    if (!R.reg || !isFinite(R.reg.slope)) {
      $('regChart').innerHTML = '<div class="chart-empty">请选择两个不同的数值变量</div>';
      $('regTable').innerHTML = '';
      $('regText').innerHTML = '';
      chips($('regChips'), []);
      return;
    }
    C.scatter($('regChart'), {
      points: R.scatterPoints.slice(0, 1200),
      line: R.reg,
      xLabel: cfg.x, yLabel: cfg.y, title: cfg.x + ' 与 ' + cfg.y + ' 的散点与拟合线'
    });

    var rows = [
      ['斜率 b', S.fmt(R.reg.slope, 4), '95% CI [' + S.fmt(R.reg.slopeCi[0], 4) + ', ' + S.fmt(R.reg.slopeCi[1], 4) + ']'],
      ['斜率的 t 值', S.fmt(R.reg.t, 3), 'df = ' + R.reg.df],
      ['显著性 p', S.fmtP(R.reg.p) + ' ' + S.stars(R.reg.p), R.reg.p < 0.05 ? '显著' : '不显著'],
      ['截距 a', S.fmt(R.reg.intercept, 4), '—'],
      ['决定系数 R²', S.fmt(R.reg.r2, 4), '解释 ' + S.fmt(R.reg.r2 * 100, 1) + '% 的变异'],
      ['残差标准误', S.fmt(R.reg.residualSe, 3), 'n = ' + R.reg.n]
    ];
    $('regTable').innerHTML = '<thead><tr><th>指标</th><th>取值</th><th>说明</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td class="num">' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>';
      }).join('') + '</tbody>';

    var ux = unitOf(cfg.x), uy = unitOf(cfg.y);
    var sigTxt = R.reg.p < 0.05
      ? '回归关系在 0.05 水平上显著'
      : '回归关系未达显著水平（p = ' + S.fmtP(R.reg.p) + '），斜率不能被可靠地认为异于 0';
    $('regText').innerHTML = '<h4>结果解读</h4><p>' +
      '拟合方程为 <b>' + esc(cfg.y) + ' = ' + S.fmt(R.reg.intercept, 3) +
      (R.reg.slope >= 0 ? ' + ' : ' − ') + S.fmt(Math.abs(R.reg.slope), 3) + ' × ' + esc(cfg.x) + '</b>。' +
      '即 ' + esc(cfg.x) + ' 每增加 1 ' + esc(ux || '单位') + '，' + esc(cfg.y) + ' 平均' +
      (R.reg.slope >= 0 ? '上升' : '下降') + ' <b>' + S.fmt(Math.abs(R.reg.slope), 3) + ' ' + esc(uy || '单位') + '</b>。' +
      esc(sigTxt) + '；R² = ' + S.fmt(R.reg.r2, 3) + '，说明 ' + esc(cfg.x) + ' 可解释 ' + esc(cfg.y) +
      ' 约 ' + S.fmt(R.reg.r2 * 100, 1) + '% 的变异。</p>' +
      '<p style="font-size:12.5px;color:#6f8078">注意：回归显著只说明线性关联成立，不能据此推断因果；' +
      '若残差存在明显异方差或非线性，需改用加权最小二乘或非线性模型。</p>';

    chips($('regChips'), [
      { text: 'R² = ' + S.fmt(R.reg.r2, 3) },
      { text: 'p ' + (R.reg.p < 0.001 ? '< 0.001' : '= ' + S.fmtP(R.reg.p)), tone: R.reg.p < 0.05 ? 'ok' : 'warn' },
      { text: 'n = ' + R.reg.n }
    ]);
  }

  function renderGroup() {
    var G = state.R.group, cfg = state.cfg;
    if (!G.ok) {
      $('groupChart').innerHTML = '<div class="chart-empty">' + esc(G.reason) + '</div>';
      $('groupTable').innerHTML = '';
      $('groupText').innerHTML = '';
      chips($('groupChips'), []);
      return;
    }
    C.box($('groupChart'), {
      groups: G.groups.map(function (g) { return { label: g.label, stats: g.stats, outliers: g.stats.outliers }; }),
      yLabel: cfg.col, title: '按「' + G.label + '」分组的 ' + cfg.col + ' 箱线图'
    });

    var tableHtml = '';
    if (G.kind === 't') {
      var t = G.t, g1 = G.groups[0], g2 = G.groups[1];
      tableHtml = '<thead><tr><th>组别</th><th>n</th><th>均值</th><th>标准差</th></tr></thead><tbody>' +
        [g1, g2].map(function (g) {
          return '<tr><td>' + esc(g.label) + '</td><td class="num">' + g.stats.n + '</td>' +
            '<td class="num">' + S.fmt(g.stats.mean) + '</td><td class="num">' + S.fmt(g.stats.sd) + '</td></tr>';
        }).join('') +
        '<tr><td colspan="4" style="background:#fafcfb;font-weight:600">' + esc(t.test) + '</td></tr>' +
        '<tr><td>t / df</td><td class="num" colspan="3">' + S.fmt(t.t, 3) + ' / ' + S.fmt(t.df, 2) + '</td></tr>' +
        '<tr><td>p 值</td><td class="num ' + (t.p < 0.05 ? 'sig' : 'ns') + '" colspan="3">' + S.fmtP(t.p) + ' ' + S.stars(t.p) + '</td></tr>' +
        '<tr><td>均值差（95% CI）</td><td class="num" colspan="3">' + S.fmt(t.diff, 3) + ' [' + S.fmt(t.ci[0], 3) + ', ' + S.fmt(t.ci[1], 3) + ']</td></tr>' +
        '<tr><td>Cohen\'s d</td><td class="num" colspan="3">' + S.fmt(t.cohenD, 3) + '（' + dWord(t.cohenD) + '效应）</td></tr>' +
        '</tbody>';
    } else {
      var a = G.a;
      tableHtml = '<thead><tr><th>组别</th><th>n</th><th>均值</th><th>标准差</th></tr></thead><tbody>' +
        a.groups.map(function (g) {
          return '<tr><td>' + esc(g.label) + '</td><td class="num">' + g.n + '</td>' +
            '<td class="num">' + S.fmt(g.mean) + '</td><td class="num">' + S.fmt(g.sd) + '</td></tr>';
        }).join('') +
        '<tr><td colspan="4" style="background:#fafcfb;font-weight:600">单因素方差分析</td></tr>' +
        '<tr><td>F(df1, df2)</td><td class="num" colspan="3">' + S.fmt(a.F, 3) + ' (' + a.dfB + ', ' + a.dfW + ')</td></tr>' +
        '<tr><td>p 值</td><td class="num ' + (a.p < 0.05 ? 'sig' : 'ns') + '" colspan="3">' + S.fmtP(a.p) + ' ' + S.stars(a.p) + '</td></tr>' +
        '<tr><td>η²（组间方差占比）</td><td class="num" colspan="3">' + S.fmt(a.eta2, 3) + '（' + etaWord(a.eta2) + '）</td></tr>' +
        '</tbody>';
    }
    $('groupTable').innerHTML = tableHtml;

    var txt;
    if (G.kind === 't') {
      var tt = G.t;
      var gA = G.groups[0], gB = G.groups[1];
      txt = '<h4>结果解读</h4><p>' +
        '按「' + esc(G.label) + '」分为两组后，<b>' + esc(gA.label) + '</b> 的 ' + esc(cfg.col) + ' 均值为 ' +
        S.fmt(gA.stats.mean) + '，<b>' + esc(gB.label) + '</b> 为 ' + S.fmt(gB.stats.mean) + '，' +
        '均值差 ' + S.fmt(tt.diff, 3) + '（95% CI ' + S.fmt(tt.ci[0], 3) + ' ~ ' + S.fmt(tt.ci[1], 3) + '）。' +
        (tt.p < 0.05
          ? '<b>差异具有统计学意义</b>（p ' + (tt.p < 0.001 ? '< 0.001' : '= ' + S.fmtP(tt.p)) + '），效应量 Cohen\'s d = ' +
            S.fmt(tt.cohenD, 2) + '，属' + dWord(tt.cohenD) + '效应。'
          : '差异<b>未达显著水平</b>（p = ' + S.fmtP(tt.p) + '），现有样本不足以认为两组存在真实差异。') +
        '</p>';
    } else {
      var aa = G.a;
      txt = '<h4>结果解读</h4><p>' +
        G.groups.length + ' 个组别的 ' + esc(cfg.col) + ' 经单因素方差分析，F(' + aa.dfB + ', ' + aa.dfW + ') = ' +
        S.fmt(aa.F, 2) + '，p ' + (aa.p < 0.001 ? '< 0.001' : '= ' + S.fmtP(aa.p)) + '，' +
        (aa.p < 0.05
          ? '<b>组间差异具有统计学意义</b>，分组变量可解释约 ' + S.fmt(aa.eta2 * 100, 1) + '% 的总变异（η² = ' + S.fmt(aa.eta2, 3) + '）。'
          : '<b>组间差异未达显著水平</b>，尚不能认为不同组别的' + esc(cfg.col) + '存在系统差异。') +
        '</p>' +
        (aa.p < 0.05 ? '<p style="font-size:12.5px;color:#6f8078">方差分析只回答“是否至少有两组不同”，' +
          '若要指出具体是哪两组存在差异，需要进一步做事后多重比较（如 Tukey HSD 或 Bonferroni 校正），' +
          '否则连续两两 t 检验会抬高第一类错误率。</p>' : '');
    }
    $('groupText').innerHTML = txt;

    chips($('groupChips'), [
      { text: G.kind === 't' ? '两独立样本 t 检验' : '单因素方差分析' },
      { text: G.groups.length + ' 组 / n = ' + G.groups.reduce(function (s, g) { return s + g.stats.n; }, 0) },
      { text: G.kind === 't' ? 'p ' + (G.t.p < 0.001 ? '< 0.001' : '= ' + S.fmtP(G.t.p)) : 'p ' + (G.a.p < 0.001 ? '< 0.001' : '= ' + S.fmtP(G.a.p)),
        tone: (G.kind === 't' ? G.t.p : G.a.p) < 0.05 ? 'ok' : 'warn' }
    ]);
  }

  function renderTrend() {
    var T = state.R.trend, cfg = state.cfg;
    if (!T.ok) {
      $('trendChart').innerHTML = '<div class="chart-empty">' + esc(T.reason) + '</div>';
      $('monthChart').innerHTML = '';
      $('trendText').innerHTML = '';
      if ($('trendDetail')) $('trendDetail').style.display = 'none';
      chips($('trendChips'), []);
      return;
    }
    if ($('trendDetail')) $('trendDetail').style.display = '';
    var lim = LIMITS[cfg.col];
    C.line($('trendChart'), {
      labels: T.labels, series: [{ values: T.values, name: cfg.col }],
      yLabel: cfg.col, fill: true, title: cfg.col + ' 逐期变化',
      threshold: lim ? lim.v : undefined,
      thresholdLabel: lim ? lim.label : ''
    });
    C.bar($('monthChart'), {
      labels: T.monthLabels, values: T.monthValues, yLabel: '月度均值',
      title: cfg.col + ' 月度均值'
    });

    var mk = T.mk;
    var trendTone = mk.p < 0.05 ? 'ok' : '';
    chips($('trendChips'), [
      { text: mk.trend, tone: trendTone },
      { text: 'MK Z = ' + S.fmt(mk.z, 2) + '，p ' + (mk.p < 0.001 ? '< 0.001' : '= ' + S.fmtP(mk.p)) },
      { text: 'Sen 斜率 ' + S.fmt(mk.senSlope, 3) + ' / 期' }
    ]);

    var body = '<h4>结果解读</h4><p>' +
      '对' + (T.mkOn === 'monthly' ? '月度均值序列' : '原始序列') + '做 Mann-Kendall 趋势检验：S = ' + mk.S +
      '，Z = ' + S.fmt(mk.z, 2) + '，p ' + (mk.p < 0.001 ? '< 0.001' : '= ' + S.fmtP(mk.p)) + '，' +
      (mk.p < 0.05
        ? '<b>存在' + (mk.senSlope > 0 ? '显著上升' : '显著下降') + '趋势</b>，Sen 斜率为 ' + S.fmt(mk.senSlope, 3) + ' / 期。'
        : '<b>未检出显著单调趋势</b>，短期波动掩盖了长期方向。') +
      '</p>';
    if (T.peak && T.trough) {
      body += '<p>月度均值最高出现在 <b>' + esc(T.peak.label) + '</b>（' + S.fmt(T.peak.value, 2) + '），' +
        '最低在 <b>' + esc(T.trough.label) + '</b>（' + S.fmt(T.trough.value, 2) + '），' +
        '峰谷比约 ' + S.fmt(T.peak.value / (T.trough.value || NaN), 2) + ' 倍，呈明显的季节起伏。</p>';
    }
    body += '<p style="font-size:12.5px;color:#6f8078">Mann-Kendall 为秩检验，不要求数据服从正态分布，' +
      '但对序列自相关敏感；这里改用月度均值以降低自相关影响。若数据包含多个断面或分组，' +
      '趋势会被混合平均掩盖，建议先按分组筛选再看。</p>';
    $('trendText').innerHTML = body;
  }

  /* =========================================================
   * 5. 结论生成
   * ======================================================= */

  function buildInsight(R) {
    var cfg = state.cfg, d = R.desc, items = [], textParts = [];

    function add(h, ps) {
      items.push({ h: h, ps: ps });
      ps.forEach(function (p) { textParts.push(p.replace(/<[^>]+>/g, '')); });
    }

    /* 概况 */
    var s1 = '本次分析针对「' + state.name + '」，共 ' + R.n + ' 条记录、' + R.cols + ' 个字段，其中数值变量 ' +
      R.numeric.length + ' 个。' + (R.timeSpan !== '—' ? '时间覆盖 ' + R.timeSpan + '。' : '') +
      '数据完整率 ' + (R.completeness * 100).toFixed(1) + '%' +
      (R.totalMissing ? '，存在 ' + R.totalMissing + ' 个缺失单元格' : '，无缺失值') + '。';
    var s2 = '';
    if (d.n) {
      s2 = '以 <b>' + esc(cfg.col) + '</b> 为例：均值 ' + S.fmt(d.mean) + (R.unit ? ' ' + R.unit : '') +
        '，中位数 ' + S.fmt(d.median) + '，标准差 ' + S.fmt(d.sd) +
        '，变异系数 ' + S.fmt(d.cv * 100, 1) + '%，属于' + dispWord(d.cv) + '的数据；' +
        '偏度 ' + S.fmt(d.skew) + '，' + skewWord(d.skew) + '。' +
        'Jarque-Bera 检验 p ' + (R.jb.p < 0.001 ? '< 0.001' : '= ' + S.fmtP(R.jb.p)) + '，' +
        (R.jb.p >= 0.05
          ? '在 0.05 水平上不能拒绝正态分布，可使用参数方法。'
          : '拒绝了正态性假设，说明分布存在偏态或离群值，解释均值时应同时报告中位数。');
    }
    add('一、数据与分布', [s1, s2].filter(Boolean));

    /* 相关与回归 */
    var corrPs = [];
    if (R.pairs.length) {
      var p1 = R.pairs[0];
      corrPs.push('在 ' + R.numeric.length + ' 个数值变量之间，相关性最强的是 <b>' + esc(p1.a) + '</b> 与 <b>' +
        esc(p1.b) + '</b>（r = ' + p1.r.toFixed(3) + '，p ' + (p1.p < 0.001 ? '< 0.001' : '= ' + S.fmtP(p1.p)) + '），' +
        '属' + rWord(p1.r) + (p1.r > 0 ? '正' : '负') + '相关。');
      var sigPairs = R.pairs.filter(function (p) { return p.p < 0.05; }).length;
      corrPs.push('共检验 ' + R.pairs.length + ' 个变量对，其中 ' + sigPairs + ' 对在 0.05 水平上显著。');
    }
    if (R.reg && isFinite(R.reg.slope)) {
      corrPs.push('回归结果表明：' + esc(cfg.x) + ' 每增加 1 ' + esc(unitOf(cfg.x) || '单位') + '，' +
        esc(cfg.y) + ' 平均' + (R.reg.slope >= 0 ? '上升' : '下降') + ' ' +
        S.fmt(Math.abs(R.reg.slope), 3) + ' ' + esc(unitOf(cfg.y) || '单位') +
        '（R² = ' + S.fmt(R.reg.r2, 3) + '，p ' + (R.reg.p < 0.001 ? '< 0.001' : '= ' + S.fmtP(R.reg.p)) + '）。' +
        (R.reg.p < 0.05 ? '' : '该关系未达显著，只能作为探索性线索。'));
    }
    if (corrPs.length) add('二、变量之间的关系', corrPs);

    /* 组间 */
    var G = R.group;
    if (G.ok) {
      var gs = G.groups.map(function (g) {
        return esc(g.label) + '（n=' + g.stats.n + '，均值 ' + S.fmt(g.stats.mean, 2) + '）';
      }).join('、');
      var gtxt;
      if (G.kind === 't') {
        gtxt = '按「' + esc(G.label) + '」分组后，两组分别为 ' + gs + '。' + G.t.test + ' 结果 t = ' +
          S.fmt(G.t.t, 2) + '，df = ' + S.fmt(G.t.df, 1) + '，p ' +
          (G.t.p < 0.001 ? '< 0.001' : '= ' + S.fmtP(G.t.p)) + '，' +
          (G.t.p < 0.05 ? '<b>差异显著</b>，均值差 ' + S.fmt(G.t.diff, 3) + '（Cohen\'s d = ' + S.fmt(G.t.cohenD, 2) + '，' + dWord(G.t.cohenD) + '效应）。'
            : '<b>差异不显著</b>，样本量或组内波动可能掩盖了真实差异。');
      } else {
        gtxt = '按「' + esc(G.label) + '」分为 ' + G.groups.length + ' 组：' + gs + '。单因素方差分析 F(' +
          G.a.dfB + ', ' + G.a.dfW + ') = ' + S.fmt(G.a.F, 2) + '，p ' +
          (G.a.p < 0.001 ? '< 0.001' : '= ' + S.fmtP(G.a.p)) + '，' +
          (G.a.p < 0.05 ? '<b>组间差异显著</b>，分组可解释 ' + S.fmt(G.a.eta2 * 100, 1) + '% 的总变异。'
            : '<b>组间差异不显著</b>，尚不能认为各组水平存在系统差别。');
      }
      add('三、组间差异', [gtxt]);
    }

    /* 趋势 */
    if (R.trend.ok) {
      var T = R.trend;
      var tTxt = '对' + (T.mkOn === 'monthly' ? '月度均值' : '原始序列') + '做 Mann-Kendall 检验，Z = ' +
        S.fmt(T.mk.z, 2) + '，p ' + (T.mk.p < 0.001 ? '< 0.001' : '= ' + S.fmtP(T.mk.p)) + '，结论为<b>' +
        T.mk.trend + '</b>，Sen 斜率 ' + S.fmt(T.mk.senSlope, 3) + ' / 期。';
      if (T.peak && T.trough) {
        tTxt += '月度均值最高为 ' + T.peak.label + '（' + S.fmt(T.peak.value, 2) + '），最低为 ' +
          T.trough.label + '（' + S.fmt(T.trough.value, 2) + '），季节起伏明显。';
      }
      add('四、时间变化', [tTxt]);
    }

    /* 方法说明与局限 */
    var method = '以上统计均基于当前所选样本实时计算：描述统计用样本标准差（n−1），分位数用线性插值，' +
      '两样本检验采用' + (cfg.test === 'student' ? 'Student t 检验' : ' Welch 校正') +
      (R.numeric.length > 1 ? '，多组比较采用单因素方差分析' : '') + '，趋势检验采用带结值修正的 Mann-Kendall 法。';
    var limit = '需要提醒的是：统计显著只表示“差异不太可能仅由抽样波动造成”，并不等于因果成立；' +
      '样例数据为演示用构造数据，若要用于环境质量评价，还应结合采样规范、检出限、标准限值以及同期气象水文条件综合判断。';
    add('五、方法与局限', [method, limit]);

    var html = items.map(function (it) {
      return '<div class="insight"><h4>' + esc(it.h) + '</h4>' +
        it.ps.map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div>';
    }).join('') +
      '<span class="src">生成方式：本地规则引擎（统计量 → 结构化叙述），' +
      '未经过大模型改写；点击右上角「AI 深度解读」可切换为大模型表述。</span>';

    return { html: html, text: textParts.join('\n\n') };
  }

  function renderInsight() {
    $('insightBody').innerHTML = state.insight.html;
  }

  /* =========================================================
   * 6. 导出
   * ======================================================= */

  function pText(p) {
    return p < 0.001 ? 'p < 0.001' : 'p = ' + S.fmtP(p);
  }

  function buildMarkdown() {
    var R = state.R, cfg = state.cfg, lines = [];
    lines.push('# ' + state.name + ' · 统计分析报告');
    lines.push('');
    lines.push('> 由 EnvStat 自动生成　' + new Date().toLocaleString('zh-CN'));
    lines.push('');
    lines.push('## 一、数据概览');
    lines.push('');
    lines.push('| 项目 | 数值 |');
    lines.push('| --- | --- |');
    lines.push('| 记录数 | ' + R.n + ' |');
    lines.push('| 字段数 | ' + R.cols + ' |');
    lines.push('| 数值变量 | ' + R.numeric.length + ' |');
    lines.push('| 数据完整率 | ' + (R.completeness * 100).toFixed(1) + '% |');
    lines.push('| 时间跨度 | ' + R.timeSpan + ' |');
    lines.push('');
    lines.push('## 二、描述统计（' + cfg.col + '）');
    lines.push('');
    var d = R.desc;
    lines.push('| 指标 | 取值 |');
    lines.push('| --- | --- |');
    [['样本量', d.n], ['均值', S.fmt(d.mean)], ['标准差', S.fmt(d.sd)],
     ['变异系数', S.fmt(d.cv * 100, 1) + '%'], ['中位数', S.fmt(d.median)],
     ['最小值', S.fmt(d.min)], ['最大值', S.fmt(d.max)],
     ['偏度', S.fmt(d.skew)], ['峰度', S.fmt(d.kurt)],
     ['JB 检验 p', S.fmtP(R.jb.p)]].forEach(function (r) {
      lines.push('| ' + r[0] + ' | ' + r[1] + ' |');
    });
    lines.push('');
    if (R.reg && isFinite(R.reg.slope)) {
      lines.push('## 三、回归分析（' + cfg.x + ' → ' + cfg.y + '）');
      lines.push('');
      lines.push('- 方程：' + cfg.y + ' = ' + S.fmt(R.reg.intercept, 4) + ' + ' + S.fmt(R.reg.slope, 4) + ' × ' + cfg.x);
      lines.push('- R² = ' + S.fmt(R.reg.r2, 4) + '，F 检验 ' + pText(R.reg.p));
      lines.push('- 斜率 95% CI：[' + S.fmt(R.reg.slopeCi[0], 4) + ', ' + S.fmt(R.reg.slopeCi[1], 4) + ']');
      lines.push('');
    }
    if (R.group.ok) {
      lines.push('## 四、组间比较（按「' + (R.group.label || R.group.key) + '」）');
      lines.push('');
      R.group.groups.forEach(function (g) {
        lines.push('- ' + g.label + '：n = ' + g.stats.n + '，均值 ' + S.fmt(g.stats.mean) + '，标准差 ' + S.fmt(g.stats.sd));
      });
      lines.push('');
      if (R.group.kind === 't') {
        lines.push('检验：' + R.group.t.test + '，t = ' + S.fmt(R.group.t.t, 3) + '，df = ' + S.fmt(R.group.t.df, 2) +
          '，' + pText(R.group.t.p) + '，Cohen\'s d = ' + S.fmt(R.group.t.cohenD, 2));
      } else {
        lines.push('检验：单因素方差分析，F(' + R.group.a.dfB + ', ' + R.group.a.dfW + ') = ' +
          S.fmt(R.group.a.F, 3) + '，' + pText(R.group.a.p) + '，η² = ' + S.fmt(R.group.a.eta2, 3));
      }
      lines.push('');
    }
    if (R.trend.ok) {
      lines.push('## 五、趋势检验');
      lines.push('');
      lines.push('- Mann-Kendall：S = ' + R.trend.mk.S + '，Z = ' + S.fmt(R.trend.mk.z, 3) +
        '，' + pText(R.trend.mk.p) + '，结论：' + R.trend.mk.trend);
      lines.push('- Sen 斜率：' + S.fmt(R.trend.mk.senSlope, 4) + ' / 期');
      lines.push('');
    }
    lines.push('## 六、分析结论');
    lines.push('');
    lines.push(state.insight.text);
    lines.push('');
    lines.push('---');
    lines.push('说明：内置数据为示例数据，结论仅反映所选样本。');
    return lines.join('\n');
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/markdown') + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function exportMarkdown() {
    var name = state.name.replace(/[\\/:*?"<>|（）()×\s]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    download('EnvStat-分析报告-' + name + '.md', buildMarkdown());
    toast('已导出 Markdown 报告');
  }

  /* =========================================================
   * 7. CSV 解析与导入
   * ======================================================= */

  function parseDelimited(text) {
    text = text.replace(/^\uFEFF/, '');
    var firstLine = text.split(/\r\n|\n|\r/)[0] || '';
    var dComma = (firstLine.match(/,/g) || []).length;
    var dTab = (firstLine.match(/\t/g) || []).length;
    var dSemi = (firstLine.match(/;/g) || []).length;
    var delim = dTab >= dComma && dTab >= dSemi ? '\t' : (dSemi > dComma ? ';' : ',');

    var rows = [], row = [], field = '', inQuote = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuote) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuote = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuote = true;
      } else if (ch === delim) {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(function (v) { return String(v).trim() !== ''; })) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(function (v) { return String(v).trim() !== ''; })) rows.push(row);
    return rows;
  }

  function importText(text, name) {
    var table = parseDelimited(text);
    if (table.length < 2) { toast('数据行不足，至少需要表头 + 1 行数据'); return; }
    var header = table[0].map(function (h, i) {
      var s = String(h).trim().replace(/\s+/g, '_');
      return s || ('列' + (i + 1));
    });
    // 去重
    var seen = {};
    header = header.map(function (h) {
      if (seen[h]) { seen[h]++; return h + '_' + seen[h]; }
      seen[h] = 1; return h;
    });

    var rows = [];
    for (var r = 1; r < table.length; r++) {
      var obj = {};
      var hasValue = false;
      for (var c = 0; c < header.length; c++) {
        var v = table[r][c] === undefined ? '' : String(table[r][c]).trim();
        if (v !== '') hasValue = true;
        obj[header[c]] = v;
      }
      if (hasValue) rows.push(obj);
    }
    if (!rows.length) { toast('没有解析到有效数据行'); return; }

    // 类型推断 + 数值转换
    var columns = header.map(function (key) {
      var vals = rows.map(function (o) { return o[key]; }).filter(function (v) { return v !== ''; });
      var numOk = vals.filter(function (v) { return isFinite(toNum(v)); }).length;
      var dateOk = vals.filter(isDateLike).length;
      var type = 'category';
      if (vals.length && numOk / vals.length >= 0.9) type = 'number';
      else if (vals.length && dateOk / vals.length >= 0.9) type = 'date';
      return { key: key, type: type };
    });

    columns.forEach(function (col) {
      if (col.type !== 'number') return;
      rows.forEach(function (o) {
        var n = toNum(o[col.key]);
        o[col.key] = isFinite(n) ? n : null;
      });
    });

    var numericCount = columns.filter(function (c) { return c.type === 'number'; }).length;
    if (!numericCount) { toast('未识别到数值列，请检查表头与数据格式'); return; }

    loadDataset({
      id: 'custom', name: name || '自定义数据', rows: rows, columns: columns,
      desc: '自定义导入数据，已自动识别 ' + numericCount + ' 个数值列。'
    });
    toast('已导入 ' + rows.length + ' 行 × ' + columns.length + ' 列');
  }

  /* =========================================================
   * 8. AI 解读（可选调用大模型）
   * ======================================================= */

  function llmConfig() {
    try {
      return JSON.parse(localStorage.getItem('envstat.llm') || '{}');
    } catch (e) { return {}; }
  }

  function factsForLLM() {
    var R = state.R, cfg = state.cfg;
    var f = [];
    f.push('数据集：' + state.name + '；样本量 ' + R.n + '；数值变量 ' + R.numeric.length + ' 个；完整率 ' + (R.completeness * 100).toFixed(1) + '%。');
    f.push('当前变量 ' + cfg.col + '：均值 ' + S.fmt(R.desc.mean) + '，标准差 ' + S.fmt(R.desc.sd) +
      '，中位数 ' + S.fmt(R.desc.median) + '，偏度 ' + S.fmt(R.desc.skew) + '，JB 检验 p=' + S.fmtP(R.jb.p) + '。');
    if (R.pairs.length) {
      var p = R.pairs[0];
      f.push('最强相关：' + p.a + ' 与 ' + p.b + '，r=' + p.r.toFixed(3) + '，p=' + S.fmtP(p.p) + '。');
    }
    if (R.reg && isFinite(R.reg.slope)) {
      f.push('回归 ' + cfg.y + ' ~ ' + cfg.x + '：斜率 ' + S.fmt(R.reg.slope, 4) + '，R²=' + S.fmt(R.reg.r2, 3) + '，p=' + S.fmtP(R.reg.p) + '。');
    }
    if (R.group.ok) {
      if (R.group.kind === 't') {
        f.push('按' + R.group.key + '分两组：均值差 ' + S.fmt(R.group.t.diff, 3) + '，t=' + S.fmt(R.group.t.t, 2) +
          '，p=' + S.fmtP(R.group.t.p) + '，Cohen d=' + S.fmt(R.group.t.cohenD, 2) + '。');
      } else {
        f.push('按' + R.group.key + '分' + R.group.groups.length + '组：F=' + S.fmt(R.group.a.F, 2) +
          '，p=' + S.fmtP(R.group.a.p) + '，eta²=' + S.fmt(R.group.a.eta2, 3) + '。');
      }
    }
    if (R.trend.ok) {
      f.push('Mann-Kendall 趋势：Z=' + S.fmt(R.trend.mk.z, 2) + '，p=' + S.fmtP(R.trend.mk.p) +
        '，Sen 斜率 ' + S.fmt(R.trend.mk.senSlope, 3) + '。');
    }
    return f.join('\n');
  }

  function callLLM() {
    var cfg = llmConfig();
    if (!cfg.key || !cfg.model) {
      toast('未配置模型接口，已使用本地规则引擎');
      renderInsight();
      return;
    }
    var btn = $('btnAi');
    btn.disabled = true;
    btn.textContent = '解读中…';
    var base = (cfg.base || 'https://api.openai.com/v1').replace(/\/+$/, '');
    fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: '你是环境监测数据分析助手。请基于用户给出的事实清单，写一段 300 字以内的中文分析结论。' +
              '要求：只使用清单中出现的数字，不得编造；先讲结论再讲依据；指出至少一条局限；不要使用 Markdown 标题。'
          },
          { role: 'user', content: factsForLLM() }
        ]
      })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      var txt = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
      if (!txt) throw new Error('返回内容为空');
      $('insightBody').innerHTML =
        '<div class="insight"><h4>AI 解读（大模型生成）</h4><p>' + esc(txt).replace(/\n+/g, '</p><p>') + '</p></div>' +
        '<div class="insight"><h4>本地规则引擎结论（对照）</h4></div>' + state.insight.html +
        '<span class="src">大模型输出可能存在表述偏差，数字请以本页计算结果为准。</span>';
      toast('已由大模型重新解读');
    }).catch(function (err) {
      toast('调用失败（' + err.message + '），已回退本地规则引擎');
      renderInsight();
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'AI 深度解读';
    });
  }

  /* =========================================================
   * 9. 事件绑定与启动
   * ======================================================= */

  function bind() {
    var dsSelect = $('datasetSelect');
    dsSelect.innerHTML = D.datasets.map(function (d) {
      return '<option value="' + d.id + '">' + esc(d.short || d.name) + '</option>';
    }).join('');
    dsSelect.addEventListener('change', function () { loadDataset(D.get(this.value)); });

    $('colSelect').addEventListener('change', function () { state.cfg.col = this.value; analyze(); });
    $('xSelect').addEventListener('change', function () { state.cfg.x = this.value; analyze(); });
    $('ySelect').addEventListener('change', function () { state.cfg.y = this.value; analyze(); });
    $('groupSelect').addEventListener('change', function () { state.cfg.group = this.value || null; analyze(); });
    $('dateSelect').addEventListener('change', function () { state.cfg.date = this.value || null; analyze(); });
    $('testSelect').addEventListener('change', function () { state.cfg.test = this.value; analyze(); });

    $('btnExport').addEventListener('click', exportMarkdown);
    $('btnExport2').addEventListener('click', exportMarkdown);
    $('btnPrint').addEventListener('click', function () { window.print(); });
    $('btnCopy').addEventListener('click', function () {
      var txt = state.insight.text;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast('结论已复制'); },
          function () { fallbackCopy(txt); });
      } else fallbackCopy(txt);
    });
    $('btnAi').addEventListener('click', callLLM);

    // 模型设置
    var cfg = llmConfig();
    $('llmBase').value = cfg.base || '';
    $('llmModel').value = cfg.model || '';
    $('llmKey').value = cfg.key || '';
    $('btnSaveLlm').addEventListener('click', function () {
      localStorage.setItem('envstat.llm', JSON.stringify({
        base: $('llmBase').value.trim(),
        model: $('llmModel').value.trim(),
        key: $('llmKey').value.trim()
      }));
      toast('设置已保存到本机浏览器');
    });

    // 窗口尺寸变化时按新宽度重绘（图表按容器宽度 1:1 渲染）
    var rz = null;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(renderAll, 180);
    });

    // 上传
    var drop = $('dropZone'), fileInput = $('fileInput');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f);
    });
    fileInput.addEventListener('change', function () {
      if (this.files && this.files[0]) readFile(this.files[0]);
    });

    $('btnPaste').addEventListener('click', function () {
      $('pasteWrap').classList.toggle('hidden');
    });
    $('btnParsePaste').addEventListener('click', function () {
      var t = $('pasteBox').value.trim();
      if (t.length < 8) { toast('请先粘贴表格数据'); return; }
      importText(t, '粘贴数据');
    });
  }

  function readFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      importText(String(reader.result), file.name.replace(/\.[^.]+$/, ''));
    };
    reader.onerror = function () { toast('文件读取失败'); };
    reader.readAsText(file, 'UTF-8');
  }

  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('结论已复制'); }
    catch (e) { toast('复制失败，请手动选择文本'); }
    ta.remove();
  }

  bind();
  loadDataset(D.datasets[0]);
})();
