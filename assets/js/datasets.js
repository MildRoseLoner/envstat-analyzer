/*!
 * 内置样例数据集
 * ------------------------------------------------------------------
 * 说明：以下数据为“按公开监测统计特征构造的示例数据”，用于演示分析流程，
 * 并非真实站点的逐日/逐月原始记录，引用时请勿当作实测值使用。
 * 生成过程使用固定随机种子，因此每次打开得到的数据完全一致，便于复核。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EnvData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------- 确定性伪随机（mulberry32） ---------- */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Box-Muller 标准正态
  function normal(rand) {
    var u = rand() || 1e-9, v = rand() || 1e-9;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function round(v, d) {
    var p = Math.pow(10, d);
    return Math.round(v * p) / p;
  }

  /* ---------- 空气质量分指数 IAQI（HJ 633-2012） ---------- */
  var BREAK = {
    pm25: [[0, 35, 75, 115, 150, 250, 350, 500], [0, 50, 100, 150, 200, 300, 400, 500]],
    pm10: [[0, 50, 150, 250, 350, 420, 500, 600], [0, 50, 100, 150, 200, 300, 400, 500]],
    so2: [[0, 50, 150, 475, 800, 1600, 2100, 2620], [0, 50, 100, 150, 200, 300, 400, 500]],
    no2: [[0, 40, 80, 180, 280, 565, 750, 940], [0, 50, 100, 150, 200, 300, 400, 500]],
    co: [[0, 2, 4, 14, 24, 36, 48, 60], [0, 50, 100, 150, 200, 300, 400, 500]],
    o3: [[0, 100, 160, 215, 265, 800, 1000, 1200], [0, 50, 100, 150, 200, 300, 400, 500]]
  };

  function iaqi(kind, c) {
    var b = BREAK[kind], bp = b[0], ia = b[1];
    if (c <= bp[0]) return 0;
    for (var i = 1; i < bp.length; i++) {
      if (c <= bp[i]) {
        return Math.round((ia[i] - ia[i - 1]) / (bp[i] - bp[i - 1]) * (c - bp[i - 1]) + ia[i - 1]);
      }
    }
    return 500;
  }

  function aqiOf(pm25, pm10, so2, no2, co, o3) {
    return Math.max(
      iaqi('pm25', pm25), iaqi('pm10', pm10), iaqi('so2', so2),
      iaqi('no2', no2), iaqi('co', co), iaqi('o3', o3)
    );
  }

  /* ---------- 数据集 1：空气质量 ---------- */
  function buildAir() {
    var rand = rng(20240101);
    var rows = [];
    var start = Date.UTC(2024, 0, 1);
    var noise = 0;
    for (var d = 0; d < 366; d++) {
      var dt = new Date(start + d * 86400000);
      var doy = d + 1;
      // 冬季高、夏季低的季节项（1 月中旬达峰）
      var season = Math.cos(2 * Math.PI * (doy - 15) / 366);
      // AR(1) 天气扰动：污染过程有持续性
      noise = 0.72 * noise + 1.05 * normal(rand);
      var washout = rand() < 0.16 ? -0.9 * Math.abs(normal(rand)) : 0; // 降水清除
      var pm25 = 40 + 19 * season + 10 * noise + 8 * washout;
      // 冬季偶发重污染过程
      if (season > 0.55 && rand() < 0.07) pm25 += 45 + 55 * rand();
      pm25 = Math.max(4, Math.min(310, pm25));
      var pm10 = pm25 * 1.58 + 12 + 9 * Math.abs(normal(rand));
      var so2 = 7.2 + 2.6 * season + 1.5 * Math.abs(normal(rand));
      var no2 = 31 + 11 * season + 6 * Math.abs(normal(rand));
      var co = 0.72 + 0.30 * season + 0.12 * Math.abs(normal(rand));
      var o3 = 78 - 34 * season + 14 * Math.abs(normal(rand)) + (season < -0.4 ? 12 : 0);
      o3 = Math.max(12, o3);
      rows.push({
        '日期': dt.toISOString().slice(0, 10),
        'PM2.5': round(pm25, 1),
        'PM10': round(pm10, 1),
        'SO2': round(so2, 1),
        'NO2': round(no2, 1),
        'CO': round(co, 2),
        'O3': round(o3, 1),
        'AQI': aqiOf(pm25, pm10, so2, no2, co, o3)
      });
    }
    return rows;
  }

  /* ---------- 数据集 2：河段水质 ---------- */
  function buildWater() {
    var rand = rng(20230915);
    var rows = [];
    var sections = [
      { name: '上游·对照断面', base: 1.0 },
      { name: '中游·排污口下游', base: 1.32 },
      { name: '下游·恢复断面', base: 1.14 }
    ];
    var periods = [
      { name: '治理前', nh3: 4.85, cod: 6.4 },
      { name: '治理后', nh3: 2.31, cod: 4.9 }
    ];
    for (var s = 0; s < sections.length; s++) {
      for (var p = 0; p < periods.length; p++) {
        for (var m = 1; m <= 12; m++) {
          // 枯水期（11-3 月）浓度偏高，丰水期稀释
          var dry = (m <= 3 || m >= 11) ? 1.18 : (m >= 6 && m <= 8 ? 0.86 : 1.0);
          var sec = sections[s], per = periods[p];
          var nh3n = per.nh3 * sec.base * dry + 0.85 * normal(rand);
          var cod = per.cod * (0.82 + 0.26 * sec.base) * dry + 1.05 * normal(rand);
          var tp = 0.19 * sec.base * dry + 0.03 * normal(rand);
          var dox = 7.6 - 0.55 * (nh3n - 2) + 0.35 * normal(rand);
          var ph = 7.35 + 0.16 * normal(rand);
          rows.push({
            '采样月份': '2023-' + (m < 10 ? '0' + m : m) + (p === 1 ? '' : '') ,
            '断面': sec.name,
            '时期': per.name,
            '氨氮': round(Math.max(0.15, nh3n), 2),
            '高锰酸盐指数': round(Math.max(0.8, cod), 2),
            '总磷': round(Math.max(0.01, tp), 3),
            '溶解氧': round(Math.max(3.2, Math.min(11, dox)), 2),
            'pH': round(ph, 2)
          });
        }
      }
    }
    // 治理后数据落在 2024 年，避免月份重复造成误读
    rows.forEach(function (r, i) {
      if (r['时期'] === '治理后') {
        r['采样月份'] = r['采样月份'].replace('2023', '2024');
      }
      r._i = i;
    });
    return rows;
  }

  /* ---------- 数据集 3：三种工艺去除率 ---------- */
  function buildProcess() {
    var rand = rng(555123);
    var rows = [];
    var crafts = [
      { name: '人工湿地', eff: 77.6, sd: 5.0, din: 240 },
      { name: '曝气生物滤池', eff: 85.2, sd: 5.6, din: 260 },
      { name: 'A²O 活性污泥', eff: 89.8, sd: 6.1, din: 255 }
    ];
    for (var c = 0; c < crafts.length; c++) {
      for (var b = 1; b <= 12; b++) {
        var cr = crafts[c];
        var din = cr.din + 18 * normal(rand);
        var eff = cr.eff + cr.sd * normal(rand);
        eff = Math.max(55, Math.min(98.5, eff));
        var dout = din * (1 - eff / 100);
        rows.push({
          '工艺': cr.name,
          '批次': 'B' + (b < 10 ? '0' + b : b),
          '进水COD': round(din, 1),
          '出水COD': round(dout, 1),
          '去除率': round(eff, 2)
        });
      }
    }
    return rows;
  }

  /* ---------- 元信息 ---------- */
  var DATASETS = [
    {
      id: 'air',
      name: '杭州市某国控站点空气质量（2024 年逐日）',
      short: '空气质量·逐日',
      desc: '国控站点 6 项污染物日均浓度与 AQI，覆盖完整一年，含冬季污染过程与夏季臭氧高值。',
      rows: buildAir(),
      columns: [
        { key: '日期', type: 'date' },
        { key: 'PM2.5', type: 'number', unit: 'μg/m³' },
        { key: 'PM10', type: 'number', unit: 'μg/m³' },
        { key: 'SO2', type: 'number', unit: 'μg/m³' },
        { key: 'NO2', type: 'number', unit: 'μg/m³' },
        { key: 'CO', type: 'number', unit: 'mg/m³' },
        { key: 'O3', type: 'number', unit: 'μg/m³' },
        { key: 'AQI', type: 'number', unit: '无量纲' }
      ]
    },
    {
      id: 'water',
      name: '某河段治理前后水质监测（3 断面 × 24 月）',
      short: '河段水质·治理前后',
      desc: '上游对照、中游排污口下游、下游恢复三个断面，在治理前后各 12 个月的月度监测值。',
      rows: buildWater(),
      columns: [
        { key: '采样月份', type: 'date' },
        { key: '断面', type: 'category' },
        { key: '时期', type: 'category' },
        { key: '氨氮', type: 'number', unit: 'mg/L' },
        { key: '高锰酸盐指数', type: 'number', unit: 'mg/L' },
        { key: '总磷', type: 'number', unit: 'mg/L' },
        { key: '溶解氧', type: 'number', unit: 'mg/L' },
        { key: 'pH', type: 'number', unit: '无量纲' }
      ]
    },
    {
      id: 'process',
      name: '三种处理工艺 COD 去除效果对比（每工艺 12 批次）',
      short: '工艺对比·去除率',
      desc: '人工湿地、曝气生物滤池、A²O 活性污泥三种工艺各 12 个批次的进出水 COD 与去除率。',
      rows: buildProcess(),
      columns: [
        { key: '工艺', type: 'category' },
        { key: '批次', type: 'category' },
        { key: '进水COD', type: 'number', unit: 'mg/L' },
        { key: '出水COD', type: 'number', unit: 'mg/L' },
        { key: '去除率', type: 'number', unit: '%' }
      ]
    }
  ];

  function get(id) {
    for (var i = 0; i < DATASETS.length; i++) {
      if (DATASETS[i].id === id) return DATASETS[i];
    }
    return DATASETS[0];
  }

  return { datasets: DATASETS, get: get, iaqi: iaqi };
});
