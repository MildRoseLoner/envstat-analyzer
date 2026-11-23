/**
 * 通过 Chrome DevTools Protocol 驱动无头浏览器截图
 * 用法：node tests/screenshot.js <url> <输出png> [宽] [视口高] [--full]
 * 同时收集页面控制台报错与未捕获异常，便于发现真实浏览器中的运行时问题。
 */
const fs = require('fs');
const http = require('http');

const URL_ARG = process.argv[2];
const OUT = process.argv[3];
const WIDTH = +(process.argv[4] || 1500);
const HEIGHT = +(process.argv[5] || 1200);
const FULL = process.argv.includes('--full');
const PORT = 9333;

function req(method, path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    r.on('error', reject);
    r.end();
  });
}

(async () => {
  const created = JSON.parse(await req('PUT', '/json/new?' + encodeURIComponent(URL_ARG)));
  const ws = new WebSocket(created.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const issues = [];

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      issues.push('未捕获异常: ' + (d.exception && d.exception.description || d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      issues.push('console.' + msg.params.type + ': ' +
        msg.params.args.map(a => a.value || a.description || '').join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      issues.push('日志错误: ' + msg.params.entry.text);
    }
  };

  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false
  });

  await new Promise(r => setTimeout(r, 1800));

  // 可选：截图前在页面里执行一段脚本（例如切换数据集）
  const evalIdx = process.argv.indexOf('--eval');
  if (evalIdx > -1 && process.argv[evalIdx + 1]) {
    await send('Runtime.evaluate', { expression: process.argv[evalIdx + 1], awaitPromise: true });
    await new Promise(r => setTimeout(r, 500));
  }

  const size = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({h: Math.ceil(document.documentElement.scrollHeight), w: Math.ceil(document.documentElement.scrollWidth)})',
    returnByValue: true
  });
  const { h } = JSON.parse(size.result.value);
  let shotH = FULL ? Math.min(h, 12000) : HEIGHT;
  let clipX = 0, clipY = 0, clipW = WIDTH;

  // 可选：只截某个元素（传入 CSS 选择器）
  const selIdx = process.argv.indexOf('--selector');
  if (selIdx > -1 && process.argv[selIdx + 1]) {
    const rect = await send('Runtime.evaluate', {
      expression: 'JSON.stringify((function(){var e=document.querySelector(' +
        JSON.stringify(process.argv[selIdx + 1]) +
        '); if(!e) return null; var r=e.getBoundingClientRect(); return {x:r.x+window.scrollX,y:r.y+window.scrollY,w:Math.ceil(r.width),h:Math.ceil(r.height)};})())',
      returnByValue: true
    });
    const r = JSON.parse(rect.result.value || 'null');
    if (!r) { console.error('未找到元素'); process.exit(1); }
    clipX = Math.max(0, Math.floor(r.x) - 8);
    clipY = Math.max(0, Math.floor(r.y) - 8);
    clipW = r.w + 16;
    shotH = r.h + 16;
  }

  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: clipX, y: clipY, width: clipW, height: shotH, scale: 1 }
  });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));

  console.log(JSON.stringify({ out: OUT, width: clipW, height: shotH, docHeight: h, issues }, null, 2));
  await req('GET', '/json/close/' + created.id);
  ws.close();
  process.exit(0);
})().catch(e => { console.error('截图失败:', e.message); process.exit(1); });
