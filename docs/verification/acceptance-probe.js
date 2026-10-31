#!/usr/bin/env node
/**
 * 质检独立验收探针（只读加载 src/**，不修改任何模块源码）
 * 目标：
 *   T1 重开（ui:restart）后成长/掉落是否复位（AC-8 可复现性）
 *   T2 完整一局 8:00 是否正常结算（AC-8 完整流程）
 *   T3 结算界面 R 重开后 state 是否回到 playing
 * 用法：node docs/verification/acceptance-probe.js
 * 输出 JSON；不写盘。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT_ORDER = [
  'src/core/config.js', 'src/core/rng.js', 'src/core/pool.js', 'src/core/spatial-hash.js',
  'src/core/input.js', 'src/core/camera.js', 'src/core/bus.js', 'src/core/loop.js',
  'src/loot/tables.js', 'src/loot/progression.js', 'src/loot/pickup.js',
  'src/combat/player.js', 'src/combat/auto-attack.js',
  'src/monsters/types.js', 'src/monsters/ai.js', 'src/monsters/director.js',
  'src/fx/particles.js', 'src/fx/damage-numbers.js', 'src/fx/screen-fx.js',
  'src/ui/hud.js', 'src/ui/screens.js', 'src/core/main.js', 'tests/perf.js'
];

/* ---------------- 最小假 DOM（同 tests/integration-check.js 思路） ---------------- */
const ctx = {
  canvas: null, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '',
  textAlign: '', textBaseline: '', lineJoin: '',
  setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {},
  fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
  arc() {}, fill() {}, stroke() {}, fillText() {}, strokeText() {},
  measureText(t) { return { width: String(t).length * 7 }; }
};

function classListFor(el) {
  return {
    contains(n) { return el._classes.indexOf(n) !== -1; },
    add(n) { if (el._classes.indexOf(n) === -1) el._classes.push(n); },
    remove(n) { const i = el._classes.indexOf(n); if (i !== -1) el._classes.splice(i, 1); }
  };
}
function matches(el, sel) {
  const attr = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel);
  if (attr) return el.attributes[attr[1]] === attr[2];
  if (sel[0] === '.') return el._classes.indexOf(sel.slice(1)) !== -1;
  if (sel[0] === '#') return el.id === sel.slice(1);
  return el.tagName.toLowerCase() === sel.toLowerCase();
}
function querySelector(el, sel) {
  for (const child of el.children) {
    if (matches(child, sel)) return child;
    const nested = querySelector(child, sel);
    if (nested) return nested;
  }
  return null;
}
function textOf(el) {
  let out = el._text || '';
  for (const c of el.children) out += textOf(c);
  return out;
}
class Element {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.attributes = Object.create(null);
    this._classes = [];
    this._text = '';
    this._listeners = Object.create(null);
    this.id = '';
    this.hidden = false;
    this.parentNode = null;
    const props = Object.create(null);
    this.style = {
      setProperty(n, v) { props[n] = String(v); },
      getPropertyValue(n) { return props[n] || ''; },
      removeProperty(n) { delete props[n]; }
    };
    this.classList = classListFor(this);
  }
  get className() { return this._classes.join(' '); }
  set className(v) { this._classes = String(v || '').split(/\s+/).filter(Boolean); }
  get textContent() { return textOf(this); }
  set textContent(v) { this._text = String(v == null ? '' : v); this.children.length = 0; }
  get firstChild() { return this.children.length ? this.children[0] : null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  setAttribute(n, v) { this.attributes[n] = String(v); if (n === 'id') this.id = String(v); }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n) ? this.attributes[n] : null; }
  querySelector(sel) { return querySelector(this, sel); }
  addEventListener(t, fn) { (this._listeners[t] || (this._listeners[t] = [])).push(fn); }
  removeEventListener() {}
}

const byId = Object.create(null);
function addEl(id, tag) { const el = new Element(tag || 'div'); el.id = id; byId[id] = el; return el; }
const canvas = addEl('game', 'canvas');
canvas.width = 300; canvas.height = 150;
canvas.getContext = (k) => (k === '2d' ? ctx : null);
ctx.canvas = canvas;
for (const id of ['hud', 'hud-time', 'hud-level', 'hud-xp', 'hud-xp-fill', 'hud-hp', 'hud-hp-max',
  'hud-hp-fill', 'hud-kills', 'hud-picks', 'hud-silver', 'hud-debug']) addEl(id, 'span');
byId['hud-debug'].hidden = true;

const winListeners = Object.create(null);
const docListeners = Object.create(null);
function addTo(map, t, fn) { (map[t] || (map[t] = [])).push(fn); }
const documentStub = {
  readyState: 'complete',
  documentElement: new Element('html'),
  body: new Element('body'),
  getElementById: (id) => byId[id] || null,
  createElement: (tag) => new Element(tag),
  addEventListener(t, fn) { addTo(docListeners, t, fn); },
  removeEventListener() {}
};
globalThis.window = globalThis;
globalThis.document = documentStub;
globalThis.location = undefined;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.addEventListener = (t, fn) => addTo(winListeners, t, fn);
globalThis.removeEventListener = () => {};
let rafCb = null; let rafId = 0; let nowMs = 0;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return ++rafId; };
globalThis.cancelAnimationFrame = () => { rafCb = null; };
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

function fireKey(type, code, key) {
  const ev = { type, code, key: key || code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} };
  for (const fn of (winListeners[type] || []).slice()) fn(ev);
  for (const fn of (docListeners[type] || []).slice()) fn(ev);
}
function tick(dtMs) {
  if (typeof rafCb !== 'function') return false;
  const cb = rafCb; rafCb = null; nowMs += (dtMs || 17); cb(nowMs); return true;
}

/* ---------------- 加载 ---------------- */
const loadErrors = [];
for (const f of SCRIPT_ORDER) {
  try { require(path.join(ROOT, f)); } catch (e) { loadErrors.push(f + ': ' + e.message); }
}
const WG = globalThis.WG;
const out = { loadErrors, t1: null, t2: null, t3: null };

function probe() {
  const world = WG.core.boot();
  const P = WG.loot.Progression;
  const L = WG.loot.LootSystem;

  // 开局
  fireKey('keydown', 'Enter', 'Enter'); fireKey('keyup', 'Enter', 'Enter');
  tick(17);
  const stateAfterStart = world.state;

  // 触发升级
  const beforeLevel = P.level;
  P.addXp(40);
  const afterLevel = P.level;
  const playerStatsLevel = WG.combat.player.stats.level;

  // 在远处放一个掉落（不会被拾取）
  L.dropAt(100, 100, 'xp', 6);
  const lootBeforeRestart = L.count();

  // 第一次重开
  fireKey('keydown', 'KeyR', 'r'); // 结算态才响应 R；这里用公开事件更贴近流程
  WG.core.Bus.emit('ui:restart', { source: 'acceptance-probe' });
  tick(17);

  out.t1 = {
    stateAfterStart,
    beforeLevel,
    afterLevel,
    playerStatsLevelAfterLevelUp: playerStatsLevel,
    lootBeforeRestart,
    // 重开后应复位为 Lv1 / 掉落清空
    progressionLevelAfterRestart: P.level,
    playerStatsLevelAfterRestart: WG.combat.player.stats.level,
    lootCountAfterRestart: L.count(),
    worldRunTimeAfterRestart: world.runTime,
    unlocksAfterRestart: P.unlockList()
  };

  // T2：完整一局（把 runTime 推到 8:00 前一刻，跑一帧触发通关结算）
  world.runTime = 479.99;
  world.remaining = 0.01;
  tick(17); // 触发至少一个固定步
  tick(17);
  const resultScreen = documentStub.body.querySelector('[data-screen="result"]');
  const resultDoc = resultScreen ? textOf(resultScreen) : '';
  out.t2 = {
    stateAfterDuration: world.state,
    outcome: world.outcome,
    runTime: world.runTime,
    kills: world.kills,
    resultTextHasWin: /血月退散/.test(resultDoc),
    resultTextSample: resultDoc.slice(0, 120)
  };

  // T3：结算态按 R 重开
  fireKey('keydown', 'KeyR', 'r'); fireKey('keyup', 'KeyR', 'r');
  tick(17);
  out.t3 = {
    stateAfterR: world.state,
    progressionLevelAfterR: P.level,
    playerStatsLevelAfterR: (WG.combat.player && WG.combat.player.stats) ? WG.combat.player.stats.level : null
  };

  if (WG.core.Loop && WG.core.Loop.stop) WG.core.Loop.stop();
}

try { probe(); } catch (e) { out.error = e && e.stack ? e.stack : String(e); }
console.log(JSON.stringify(out, null, 2));
