#!/usr/bin/env node
/**
 * 质检独立静态扫描（wuxia-rogue 最终验收辅助）
 * 只读项目文件、不写盘；输出 JSON 供验收报告引用。
 * 用法：node docs/verification/ac-scan.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TEXT_EXT = new Set(['.js', '.html', '.css', '.md', '.svg', '.json', '.cmd', '.txt', '.yaml', '.yml']);

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === '.ans' || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
}
const all = [];
walk(ROOT, all);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// 1) index.html 脚本清单：存在性 + node --check 语法
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
const scriptChecks = srcs.map((s) => {
  const p = path.join(ROOT, s);
  const exists = fs.existsSync(p);
  let syntax = 'skipped';
  if (exists) {
    const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
    syntax = r.status === 0 ? 'ok' : ('FAIL: ' + (r.stderr || '').split('\n')[0]);
  }
  return { src: s, exists, syntax };
});

// 2) 全部 JS 语法（src/ 与 tests/）
const jsFiles = all.filter((p) => p.endsWith('.js')).map(rel);
const jsSyntax = jsFiles.map((f) => {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
  return { file: f, syntax: r.status === 0 ? 'ok' : ('FAIL: ' + (r.stderr || '').split('\n')[0]) };
});

// 3) AC-7 卡牌禁词扫描（运行时与界面相关文件）
const CARD_TERMS = ['抽牌', '出牌', '手牌', '牌组', '构筑', '卡牌', '卡面', '三选一', '弃牌', '牌堆', '卡池', '抽卡', '牌库', '发牌'];
const EN_TERMS = [/\bcard\b/i, /\bcards\b/i, /\bdeck\b/i, /\bgacha\b/i, /\bhand\b/i, /\bdraw\s*pile\b/i];
const scanRoots = ['src', 'styles', 'assets', 'tests'];
const scanFiles = all.filter((p) => {
  const r = rel(p);
  return TEXT_EXT.has(path.extname(p).toLowerCase()) &&
    (scanRoots.some((d) => r.startsWith(d + '/')) || r === 'index.html' || r === 'run.cmd');
});
const hits = [];
for (const f of scanFiles) {
  const r = rel(f);
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const t of CARD_TERMS) if (line.includes(t)) hits.push({ file: r, line: i + 1, term: t, text: line.trim().slice(0, 160) });
    for (const re of EN_TERMS) if (re.test(line)) hits.push({ file: r, line: i + 1, term: String(re), text: line.trim().slice(0, 160) });
  });
}

// 4) 外部资源 / 网络依赖
const external = [];
for (const f of scanFiles) {
  const r = rel(f);
  const txt = fs.readFileSync(f, 'utf8');
  if (/<(script|link|img)[^>]+(src|href)="https?:\/\//i.test(txt)) external.push({ file: r, kind: 'remote-url-in-markup' });
  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/.test(txt)) external.push({ file: r, kind: 'network-api' });
}

// 5) 元数据 sidecar 清单（P0 证据自洽检查用）
const sidecars = all.filter((p) => p.endsWith('.meta.json')).map(rel);

// 6) 关键文件存在性
const keyFiles = ['index.html', 'run.cmd', 'styles/theme.css', 'assets/README.md'];
const keyExists = keyFiles.map((f) => ({ file: f, exists: fs.existsSync(path.join(ROOT, f)) }));

const result = {
  scannedAt: new Date().toISOString(),
  indexHtml: { scriptCount: srcs.length, scripts: scriptChecks, missing: scriptChecks.filter((s) => !s.exists).map((s) => s.src), syntaxFail: scriptChecks.filter((s) => s.syntax.startsWith('FAIL')).map((s) => s.src) },
  jsFiles: { count: jsFiles.length, syntaxFail: jsSyntax.filter((j) => j.syntax.startsWith('FAIL')) },
  ac7: { filesScanned: scanFiles.length, cardTermHits: hits.length, hits: hits.slice(0, 50) },
  external: { count: external.length, items: external },
  sidecars: { count: sidecars.length, files: sidecars },
  keyFiles: keyExists
};
console.log(JSON.stringify(result, null, 2));
