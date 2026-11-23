#!/usr/bin/env node
/**
 * 通过 GitHub REST API 发布到 GitHub Pages。
 *
 * 为什么不用 git push：本机到 github.com:443 不可达（DNS 污染 + 端口封锁），
 * 但 api.github.com 正常，且 GitHub 服务端会自己把仓库发布成 Pages，
 * 所以只要把文件以 Git Data API（blob/tree/commit/ref）写入仓库即可。
 *
 * 用法：
 *   GH_TOKEN=ghp_xxx node tools/gh-publish.mjs [repoName]
 *   可选环境变量：
 *     GH_OWNER   仓库所属用户/组织（默认取 token 对应用户）
 *     GH_PRIVATE 设为 1 则建私有库（私有库的 Pages 需付费计划，默认公开）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.github.com';
const TOKEN = process.env.GH_TOKEN || process.argv[3];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.argv[2] || process.env.GH_REPO || 'envstat-analyzer';
const PRIVATE = process.env.GH_PRIVATE === '1';

if (!TOKEN) {
  console.error('缺少 token：请设置环境变量 GH_TOKEN');
  process.exit(1);
}

// 只上传站点需要的文件，排除本地工具产物
const SKIP_DIRS = new Set(['.git', 'node_modules', '.workbuddy']);
const SKIP_FILES = new Set(['.DS_Store']);
const SKIP_EXT = ['.log'];

async function api(p, { method = 'GET', body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'envstat-publisher'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${method} ${p} -> ${res.status} ${data?.message || ''}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full, acc);
    } else {
      if (SKIP_FILES.has(name) || SKIP_EXT.includes(path.extname(name))) continue;
      acc.push({ rel, full, size: st.size });
    }
  }
  return acc;
}

async function main() {
  const me = await api('/user');
  const owner = process.env.GH_OWNER || me.login;
  console.log(`账号：${me.login}，目标仓库：${owner}/${REPO}`);

  // 1) 创建仓库（已存在则复用）
  let created = false;
  try {
    await api('/user/repos', {
      method: 'POST',
      body: {
        name: REPO,
        description: 'EnvStat · 环境监测数据智能分析器（描述统计 / 相关回归 / 显著性检验 / 趋势判断 / 结论生成）',
        homepage: '',
        private: PRIVATE,
        has_issues: false,
        has_wiki: false,
        has_projects: false,
        auto_init: false
      }
    });
    created = true;
    console.log('已创建仓库');
  } catch (e) {
    if (e.status === 422) console.log('仓库已存在，复用');
    else throw e;
  }

  // 1.5) 空仓库必须先有第一个提交，否则 Git Data API 建 blob 会返回 409
  try {
    await api(`/repos/${owner}/${REPO}/git/ref/heads/main`);
  } catch {
    console.log('空仓库，先建一个初始化提交');
    await api(`/repos/${owner}/${REPO}/contents/.gitkeep`, {
      method: 'PUT',
      body: {
        message: 'chore: 初始化仓库',
        content: Buffer.from('\n').toString('base64')
      }
    });
  }

  // 2) 逐个上传文件为 blob
  const files = walk(ROOT).filter((f) => f.size < 25 * 1024 * 1024);
  console.log(`待上传 ${files.length} 个文件`);
  const tree = [];
  for (const f of files) {
    const content = fs.readFileSync(f.full).toString('base64');
    const blob = await api(`/repos/${owner}/${REPO}/git/blobs`, {
      method: 'POST',
      body: { content, encoding: 'base64' }
    });
    tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 3) 生成 tree / commit / 分支引用
  const newTree = await api(`/repos/${owner}/${REPO}/git/trees`, {
    method: 'POST',
    body: { tree }
  });

  let parents = [];
  try {
    const ref = await api(`/repos/${owner}/${REPO}/git/ref/heads/main`);
    parents = [ref.object.sha];
  } catch { /* 空仓库，没有父提交 */ }

  const commit = await api(`/repos/${owner}/${REPO}/git/commits`, {
    method: 'POST',
    body: {
      message: 'feat: EnvStat 环境监测数据智能分析器（纯前端，零依赖，可直接部署 Pages）',
      tree: newTree.sha,
      parents
    }
  });

  if (parents.length) {
    await api(`/repos/${owner}/${REPO}/git/refs/heads/main`, {
      method: 'PATCH',
      body: { sha: commit.sha, force: false }
    });
  } else {
    await api(`/repos/${owner}/${REPO}/git/refs`, {
      method: 'POST',
      body: { ref: 'refs/heads/main', sha: commit.sha }
    });
  }
  console.log(`已提交 ${commit.sha.slice(0, 7)}，共 ${files.length} 个文件`);

  // 4) 开启 Pages（发布 main 分支根目录）
  let pages = null;
  try {
    pages = await api(`/repos/${owner}/${REPO}/pages`, {
      method: 'POST',
      body: { source: { branch: 'main', path: '/' } }
    });
    console.log('已开启 GitHub Pages');
  } catch (e) {
    if (e.status === 409) {
      pages = await api(`/repos/${owner}/${REPO}/pages`);
      console.log('Pages 已开启，沿用现有配置');
      // 触发一次重新构建，确保是最新提交
      try { await api(`/repos/${owner}/${REPO}/pages/builds`, { method: 'POST' }); } catch { /* 忽略 */ }
    } else if (e.status === 403 || e.status === 404) {
      console.log('无法自动开启 Pages（权限或计划限制），请在仓库 Settings → Pages 手动选择 main 分支根目录');
    } else {
      throw e;
    }
  }

  const url = pages?.html_url || `https://${owner}.github.io/${REPO}/`;
  console.log(`\n仓库地址：https://github.com/${owner}/${REPO}`);
  console.log(`在线地址：${url}`);

  // 5) 等构建完成
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 8000));
    try {
      const b = await api(`/repos/${owner}/${REPO}/pages/builds/latest`);
      console.log(`构建状态：${b.status}${b.error?.message ? ' - ' + b.error.message : ''}`);
      if (b.status === 'built') break;
      if (b.status === 'errored') break;
    } catch { console.log('构建状态暂不可查，继续等待'); }
  }
  console.log(JSON.stringify({ repo: `https://github.com/${owner}/${REPO}`, site: url, created }));
}

main().catch((e) => {
  console.error('发布失败：' + e.message);
  if (e.data) console.error(JSON.stringify(e.data).slice(0, 400));
  process.exit(1);
});
