// 无头 DOM 冒烟测试：用 jsdom 真实执行页面脚本，检查渲染结果与交互
const path = require('path');
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  console.log('本测试需要 jsdom：先在项目根目录执行 npm install --no-save jsdom');
  process.exit(0);
}

const PAGE = 'D:/硕/人工智能基础与应用/env-analyzer/index.html';
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
vc.on('warn', (...a) => { /* 忽略 CSS 解析告警 */ });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const dom = await JSDOM.fromFile(PAGE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: 'file://' + PAGE.replace(/\\/g, '/')
  });
  const { window } = dom;
  const doc = window.document;
  await new Promise(res => window.addEventListener('load', res));
  await sleep(600);

  const $ = id => doc.getElementById(id);
  const txt = id => ($(id) ? $(id).textContent.trim().replace(/\s+/g, ' ') : '<缺失>');
  const svgCount = () => doc.querySelectorAll('svg.chart-svg').length;

  console.log('== 首屏（空气质量）==');
  console.log('KPI 卡片数:', doc.querySelectorAll('.kpi').length);
  console.log('KPI 内容:', [...doc.querySelectorAll('.kpi')].map(k => k.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  console.log('图表数量:', svgCount());
  console.log('质量表行数:', doc.querySelectorAll('#qualityTable tbody tr').length);
  console.log('描述统计格数:', doc.querySelectorAll('#descStats .stat-cell').length);
  console.log('回归表行数:', doc.querySelectorAll('#regTable tbody tr').length);
  console.log('组间表行数:', doc.querySelectorAll('#groupTable tbody tr').length);
  console.log('相关对行数:', doc.querySelectorAll('#corrList tbody tr').length);
  console.log('结论段落数:', doc.querySelectorAll('#insightBody .insight').length);
  console.log('结论首段:', txt('insightBody').slice(0, 160), '...');
  console.log('空图占位:', doc.querySelectorAll('.chart-empty').length);

  // 切换数据集：水质
  console.log('\n== 切换到河段水质 ==');
  const sel = $('datasetSelect');
  sel.value = 'water';
  sel.dispatchEvent(new window.Event('change'));
  await sleep(200);
  console.log('KPI:', [...doc.querySelectorAll('.kpi')].map(k => k.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  console.log('组间检验 chip:', txt('groupChips'));
  console.log('组间表:', doc.querySelectorAll('#groupTable tbody tr').length, '行');
  console.log('趋势图存在:', !!doc.querySelector('#trendChart svg'));
  console.log('空图占位:', doc.querySelectorAll('.chart-empty').length);

  // 切换数据集：工艺
  console.log('\n== 切换到工艺对比 ==');
  sel.value = 'process';
  sel.dispatchEvent(new window.Event('change'));
  await sleep(200);
  console.log('KPI:', [...doc.querySelectorAll('.kpi')].map(k => k.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  console.log('组间 chip:', txt('groupChips'));
  console.log('趋势区提示:', txt('trendChart').slice(0, 60));
  console.log('空图占位:', doc.querySelectorAll('.chart-empty').length);

  // 改分析变量
  console.log('\n== 切换分析变量为 出水COD ==');
  const col = $('colSelect');
  col.value = '出水COD';
  col.dispatchEvent(new window.Event('change'));
  await sleep(150);
  console.log('分布卡标题:', txt('descVarName'));
  console.log('描述统计 n:', doc.querySelector('#descStats .stat-cell .s-value').textContent);

  // 分组切换为派生季节（水质数据集有日期）
  sel.value = 'air';
  sel.dispatchEvent(new window.Event('change'));
  await sleep(200);
  console.log('\n== 空气质量数据 · 分组选项 ==');
  console.log([...doc.querySelectorAll('#groupSelect option')].map(o => o.value + ':' + o.textContent).join(' , '));
  const grp = $('groupSelect');
  grp.value = '__season';
  grp.dispatchEvent(new window.Event('change'));
  await sleep(200);
  console.log('按季节分组 chip:', txt('groupChips'));
  console.log('结论段数:', doc.querySelectorAll('#insightBody .insight').length);

  // CSV 导入
  console.log('\n== CSV 导入 ==');
  $('btnPaste').dispatchEvent(new window.Event('click'));
  $('pasteBox').value = '断面,氨氮,总磷\n上游,3.21,0.18\n中游,5.04,0.26\n上游,3.55,0.19\n中游,4.87,0.24\n下游,4.10,0.21\n下游,4.42,0.23';
  $('btnParsePaste').dispatchEvent(new window.Event('click'));
  await sleep(250);
  console.log('数据集说明:', txt('datasetDesc'));
  console.log('KPI:', [...doc.querySelectorAll('.kpi')].map(k => k.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  console.log('组间 chip:', txt('groupChips'));

  console.log('\n== 控制台错误 ==');
  console.log(errors.length ? errors.join('\n') : '无');
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('测试崩了:', e); process.exit(2); });
