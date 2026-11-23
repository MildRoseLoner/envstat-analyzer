// 验证 Markdown 导出：拦截 Blob，检查生成内容的结构与关键数值
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  console.log('本测试需要 jsdom：先在项目根目录执行 npm install --no-save jsdom');
  process.exit(0);
}
const PAGE = 'D:/硕/人工智能基础与应用/env-analyzer/index.html';

(async () => {
  const dom = await JSDOM.fromFile(PAGE, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    url: 'file:///' + PAGE.replace(/\\/g, '/')
  });
  const { window } = dom;
  await new Promise(r => window.addEventListener('load', r));
  await new Promise(r => setTimeout(r, 500));

  let captured = null, name = null;
  window.URL.createObjectURL = b => { captured = b; return 'blob:test'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { name = this.download; };

  const sel = window.document.getElementById('datasetSelect');
  sel.value = 'water';
  sel.dispatchEvent(new window.Event('change'));
  await new Promise(r => setTimeout(r, 200));

  window.document.getElementById('btnExport2').dispatchEvent(new window.Event('click'));
  await new Promise(r => setTimeout(r, 100));

  if (!captured) { console.error('未捕获到导出的 Blob'); process.exit(1); }
  const text = await captured.text();
  console.log('下载文件名:', name);
  console.log('字符数:', text.length);
  console.log('---- 前 45 行 ----');
  console.log(text.split('\n').slice(0, 45).join('\n'));
  console.log('---- 检查 ----');
  ['## 一、数据概览', '## 二、描述统计', '## 四、组间比较', '## 六、分析结论'].forEach(h => {
    console.log((text.includes(h) ? 'OK  ' : '缺失') + ' ' + h);
  });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
