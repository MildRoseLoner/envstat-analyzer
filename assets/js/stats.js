/*!
 * EnvStats —— 面向环境监测数据的轻量统计引擎
 * 纯 JavaScript 实现，无第三方依赖，可在浏览器与 Node 中运行。
 * 覆盖：描述统计、正态性检验、Pearson 相关、一元线性回归、
 *       Welch / Student t 检验、单因素方差分析、Mann-Kendall 趋势检验。
 * 作者：王洛 · 《人工智能基础与应用》课程作品
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EnvStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------
   * 0. 特殊函数
   * ------------------------------------------------------------- */

  var LANCZOS = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];

  function logGamma(z) {
    if (z < 0.5) {
      return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    }
    z -= 1;
    var x = LANCZOS[0];
    for (var i = 1; i < 9; i++) x += LANCZOS[i] / (z + i);
    var t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  // 正则化不完全贝塔函数 I_x(a,b)：连分式展开（Numerical Recipes betacf）
  function betacf(a, b, x) {
    var MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  function ibeta(a, b, x) {
    if (!(x > 0)) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) +
      a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  // 标准正态分布累积分布函数
  function normalCdf(z) {
    var t = 1 / (1 + 0.2316419 * Math.abs(z));
    var d = 0.3989422804014327 * Math.exp(-z * z / 2);
    var p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 +
      t * (-1.821255978 + t * 1.330274429))));
    return z > 0 ? 1 - p : p;
  }

  // t 分布累积分布函数
  function tCdf(t, df) {
    var x = df / (df + t * t);
    var p = 0.5 * ibeta(df / 2, 0.5, x);
    return t > 0 ? 1 - p : p;
  }

  // F 分布累积分布函数
  function fCdf(f, d1, d2) {
    if (f <= 0) return 0;
    return ibeta(d1 / 2, d2 / 2, d1 * f / (d1 * f + d2));
  }

  // 卡方分布累积分布函数（正则化下不完全伽马函数）
  function chi2Cdf(x, df) {
    if (x <= 0) return 0;
    var a = df / 2, y = x / 2;
    var P;
    if (y < a + 1) {
      var ap = a, sum = 1 / a, del = sum;
      for (var n = 1; n < 500; n++) {
        ap += 1; del *= y / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
      }
      P = sum * Math.exp(-y + a * Math.log(y) - logGamma(a));
    } else {
      var b = y + 1 - a, c = 1e300, d = 1 / b, h = d;
      for (var i = 1; i < 500; i++) {
        var an = -i * (i - a);
        b += 2;
        d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
        c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
        d = 1 / d;
        var del2 = d * c;
        h *= del2;
        if (Math.abs(del2 - 1) < 1e-15) break;
      }
      var q = Math.exp(-y + a * Math.log(y) - logGamma(a)) * h;
      P = 1 - q;
    }
    return Math.min(1, Math.max(0, P));
  }

  // t 分布分位数（二分法求逆）
  function tQuantile(p, df) {
    var lo = -1e3, hi = 1e3;
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2;
      if (tCdf(mid, df) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* ---------------------------------------------------------------
   * 1. 基础描述统计
   * ------------------------------------------------------------- */

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function numsOf(arr) {
    return arr.filter(isNum);
  }

  // R type-7 分位数（与 numpy / pandas 默认一致）
  function quantile(sorted, p) {
    var n = sorted.length;
    if (!n) return NaN;
    if (n === 1) return sorted[0];
    var h = (n - 1) * p;
    var lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
  }

  function mean(a) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return a.length ? s / a.length : NaN;
  }

  // 样本方差（n-1）
  function variance(a) {
    var n = a.length;
    if (n < 2) return NaN;
    var m = mean(a), s = 0;
    for (var i = 0; i < n; i++) { var d = a[i] - m; s += d * d; }
    return s / (n - 1);
  }

  function sd(a) { return Math.sqrt(variance(a)); }

  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; });
    return quantile(s, 0.5);
  }

  function mode(a) {
    var m = new Map(), best = null, bestN = 0;
    a.forEach(function (v) {
      var k = String(v), n = (m.get(k) || 0) + 1;
      m.set(k, n);
      if (n > bestN) { bestN = n; best = v; }
    });
    return best;
  }

  /**
   * 描述性统计
   * @param {number[]} values 原始值（可含 null / NaN，自动剔除）
   */
  function describe(values) {
    var a = numsOf(values).slice().sort(function (x, y) { return x - y; });
    var n = a.length;
    if (!n) {
      return { n: 0, missing: values.length };
    }
    var m = mean(a);
    var v = variance(a);
    var s = Math.sqrt(v);
    // 矩（总体形式，与 scipy.stats.skew/kurtosis 默认 bias=True 一致）
    var m2 = 0, m3 = 0, m4 = 0;
    for (var i = 0; i < n; i++) {
      var d = a[i] - m, d2 = d * d;
      m2 += d2; m3 += d2 * d; m4 += d2 * d2;
    }
    m2 /= n; m3 /= n; m4 /= n;
    var skew = m2 > 0 ? m3 / Math.pow(m2, 1.5) : NaN;
    var kurt = m2 > 0 ? m4 / (m2 * m2) - 3 : NaN;
    var q1 = quantile(a, 0.25), q3 = quantile(a, 0.75);
    return {
      n: n,
      missing: values.length - n,
      mean: m,
      sd: s,
      variance: v,
      se: s / Math.sqrt(n),
      cv: m !== 0 ? s / Math.abs(m) : NaN,
      min: a[0],
      q1: q1,
      median: quantile(a, 0.5),
      q3: q3,
      max: a[n - 1],
      iqr: q3 - q1,
      range: a[n - 1] - a[0],
      skew: skew,
      kurt: kurt,
      lowerFence: q1 - 1.5 * (q3 - q1),
      upperFence: q3 + 1.5 * (q3 - q1)
    };
  }

  /**
   * Jarque-Bera 正态性检验
   * JB = n/6 * (S² + K²/4)，K 为超额峰度，统计量服从 χ²(2)
   */
  function jarqueBera(values) {
    var d = describe(values);
    if (d.n < 8) return { stat: NaN, p: NaN, n: d.n };
    var jb = d.n / 6 * (d.skew * d.skew + d.kurt * d.kurt / 4);
    return { stat: jb, p: 1 - chi2Cdf(jb, 2), n: d.n };
  }

  /* ---------------------------------------------------------------
   * 2. 相关与回归
   * ------------------------------------------------------------- */

  function pairs(x, y) {
    var px = [], py = [];
    for (var i = 0; i < x.length; i++) {
      if (isNum(x[i]) && isNum(y[i])) { px.push(x[i]); py.push(y[i]); }
    }
    return { x: px, y: py };
  }

  /**
   * Pearson 相关系数及显著性检验
   * t = r * sqrt((n-2)/(1-r²))，p 值双侧
   */
  function pearson(x, y) {
    var p = pairs(x, y), px = p.x, py = p.y, n = px.length;
    if (n < 3) return { r: NaN, p: NaN, n: n };
    var mx = mean(px), my = mean(py);
    var sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) {
      var dx = px[i] - mx, dy = py[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return { r: NaN, p: NaN, n: n };
    var r = sxy / Math.sqrt(sxx * syy);
    r = Math.max(-1, Math.min(1, r));
    var t = n > 2 ? r * Math.sqrt((n - 2) / (1 - r * r)) : NaN;
    var pv = isFinite(t) ? 2 * (1 - tCdf(Math.abs(t), n - 2)) : NaN;
    return { r: r, t: t, p: pv, n: n, r2: r * r };
  }

  /**
   * 一元线性回归 OLS：y = a + b·x
   * 返回斜率、截距、R²、斜率标准误、t 值与 p 值、残差标准误
   */
  function linreg(x, y) {
    var p = pairs(x, y), px = p.x, py = p.y, n = px.length;
    if (n < 3) return { n: n, slope: NaN, intercept: NaN, r2: NaN };
    var mx = mean(px), my = mean(py);
    var sxx = 0, sxy = 0, syy = 0;
    for (var i = 0; i < n; i++) {
      var dx = px[i] - mx, dy = py[i] - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    if (sxx === 0) return { n: n, slope: NaN, intercept: NaN, r2: NaN };
    var b = sxy / sxx, a = my - b * mx;
    var sse = 0, sst = 0;
    for (var j = 0; j < n; j++) {
      var fit = a + b * px[j];
      sse += (py[j] - fit) * (py[j] - fit);
      sst += (py[j] - my) * (py[j] - my);
    }
    var df = n - 2;
    var mse = sse / df;
    var seB = Math.sqrt(mse / sxx);
    var t = b / seB;
    var pv = 2 * (1 - tCdf(Math.abs(t), df));
    var tcrit = tQuantile(0.975, df);
    return {
      n: n, slope: b, intercept: a,
      r2: sst > 0 ? 1 - sse / sst : NaN,
      sse: sse, mse: mse, residualSe: Math.sqrt(mse),
      seSlope: seB,
      slopeCi: [b - tcrit * seB, b + tcrit * seB],
      t: t, p: pv, df: df,
      equation: 'y = ' + fmt(a, 3) + (b >= 0 ? ' + ' : ' − ') + fmt(Math.abs(b), 3) + '·x'
    };
  }

  /* ---------------------------------------------------------------
   * 3. 组间比较
   * ------------------------------------------------------------- */

  /**
   * 两独立样本 t 检验
   * @param {boolean} welch 默认 true，方差不齐时更稳健
   */
  function tTest(a, b, welch) {
    welch = welch !== false;
    var x = numsOf(a), y = numsOf(b);
    var n1 = x.length, n2 = y.length;
    if (n1 < 2 || n2 < 2) return { error: '每组至少需要 3 个有效观测' };
    var m1 = mean(x), m2 = mean(y);
    var v1 = variance(x), v2 = variance(y);
    var diff = m1 - m2;
    var se, df;
    if (welch) {
      var s1 = v1 / n1, s2 = v2 / n2;
      se = Math.sqrt(s1 + s2);
      df = (s1 + s2) * (s1 + s2) / (s1 * s1 / (n1 - 1) + s2 * s2 / (n2 - 1));
    } else {
      var sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
      se = Math.sqrt(sp2 * (1 / n1 + 1 / n2));
      df = n1 + n2 - 2;
    }
    var t = diff / se;
    var p = 2 * (1 - tCdf(Math.abs(t), df));
    var tcrit = tQuantile(0.975, df);
    var sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
    return {
      test: welch ? 'Welch t 检验' : 'Student t 检验',
      n1: n1, n2: n2, mean1: m1, mean2: m2, sd1: Math.sqrt(v1), sd2: Math.sqrt(v2),
      diff: diff, se: se, df: df, t: t, p: p,
      ci: [diff - tcrit * se, diff + tcrit * se],
      cohenD: diff / sp,
      tcrit: tcrit
    };
  }

  /**
   * 单因素方差分析
   * @param {Array<{label:string, values:number[]}>} groups
   */
  function anova(groups) {
    var gs = groups.map(function (g) {
      return { label: g.label, values: numsOf(g.values) };
    }).filter(function (g) { return g.values.length >= 2; });
    var k = gs.length;
    if (k < 2) return { error: '至少需要 2 个包含有效观测的分组' };
    var all = [];
    gs.forEach(function (g) { all = all.concat(g.values); });
    var N = all.length;
    var gm = mean(all);
    var ssb = 0, ssw = 0;
    gs.forEach(function (g) {
      var m = mean(g.values);
      ssb += g.values.length * (m - gm) * (m - gm);
      g.values.forEach(function (v) { ssw += (v - m) * (v - m); });
    });
    var dfB = k - 1, dfW = N - k;
    var msb = ssb / dfB, msw = ssw / dfW;
    var F = msb / msw;
    var p = 1 - fCdf(F, dfB, dfW);
    return {
      test: '单因素方差分析',
      k: k, N: N,
      ssb: ssb, ssw: ssw, sst: ssb + ssw,
      dfB: dfB, dfW: dfW,
      msb: msb, msw: msw,
      F: F, p: p,
      eta2: ssb / (ssb + ssw),
      groups: gs.map(function (g) {
        var d = describe(g.values);
        return {
          label: g.label, n: d.n, mean: d.mean, sd: d.sd,
          min: d.min, max: d.max, median: d.median
        };
      })
    };
  }

  /* ---------------------------------------------------------------
   * 4. 趋势检验
   * ------------------------------------------------------------- */

  /**
   * Mann-Kendall 趋势检验（含结值修正）+ Sen 斜率
   * @param {number[]} values 按时间顺序排列
   */
  function mannKendall(values) {
    var x = numsOf(values), n = x.length;
    if (n < 4) return { n: n, S: NaN, z: NaN, p: NaN };
    var S = 0;
    for (var i = 0; i < n - 1; i++) {
      for (var j = i + 1; j < n; j++) {
        S += Math.sign(x[j] - x[i]);
      }
    }
    // 结值分组
    var sorted = x.slice().sort(function (a, b) { return a - b; });
    var ties = [], run = 1;
    for (var m = 1; m < n; m++) {
      if (sorted[m] === sorted[m - 1]) run++;
      else { if (run > 1) ties.push(run); run = 1; }
    }
    if (run > 1) ties.push(run);
    var tieSum = ties.reduce(function (acc, t) { return acc + t * (t - 1) * (2 * t + 5); }, 0);
    var varS = (n * (n - 1) * (2 * n + 5) - tieSum) / 18;
    var z = S > 0 ? (S - 1) / Math.sqrt(varS) : (S < 0 ? (S + 1) / Math.sqrt(varS) : 0);
    var p = 2 * (1 - normalCdf(Math.abs(z)));
    // Sen 斜率（所有点对斜率的中位数）
    var slopes = [];
    for (var a = 0; a < n - 1; a++) {
      for (var b = a + 1; b < n; b++) {
        slopes.push((x[b] - x[a]) / (b - a));
      }
    }
    slopes.sort(function (u, v) { return u - v; });
    var sen = quantile(slopes, 0.5);
    return {
      n: n, S: S, varS: varS, z: z, p: p, senSlope: sen,
      trend: p < 0.05 ? (sen > 0 ? '显著上升' : (sen < 0 ? '显著下降' : '无显著趋势'))
        : '无显著趋势'
    };
  }

  /* ---------------------------------------------------------------
   * 5. 格式化辅助
   * ------------------------------------------------------------- */

  function fmt(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    digits = digits === undefined ? 2 : digits;
    var abs = Math.abs(v);
    if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return v.toExponential(2);
    return v.toFixed(digits);
  }

  function fmtP(p) {
    if (!isFinite(p)) return '—';
    if (p < 0.001) return '< 0.001';
    return p.toFixed(4);
  }

  function stars(p) {
    if (!isFinite(p)) return '';
    if (p < 0.001) return '***';
    if (p < 0.01) return '**';
    if (p < 0.05) return '*';
    return 'n.s.';
  }

  return {
    // 分布函数
    normalCdf: normalCdf, tCdf: tCdf, fCdf: fCdf, chi2Cdf: chi2Cdf,
    tQuantile: tQuantile, ibeta: ibeta, logGamma: logGamma,
    // 描述统计
    mean: mean, variance: variance, sd: sd, median: median, mode: mode,
    quantile: quantile, describe: describe, jarqueBera: jarqueBera,
    // 相关与回归
    pearson: pearson, linreg: linreg, pairs: pairs,
    // 检验
    tTest: tTest, anova: anova, mannKendall: mannKendall,
    // 工具
    isNum: isNum, numsOf: numsOf, fmt: fmt, fmtP: fmtP, stars: stars
  };
});
