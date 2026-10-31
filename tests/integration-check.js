/*!
 * 江湖夜雨 · tests/integration-check.js（v2）
 * 无头集成回归：按架构 §3.2 的 26 个固定脚本 + tests/perf.js 顺序加载，
 * 用自建 window / document / canvas / 2D context / 键盘事件桩跑完 v2 全链路：
 *   boot→title→sect→playing→choice（三选一暂停/恢复）→result（胜/负）→重开复位。
 *
 * 运行：node tests/integration-check.js
 *
 * 约束：
 *  - 只读加载 src/**，不修改任何模块；
 *  - 不引入 npm 依赖；
 *  - 发现集成问题只记录「文件 + 症状 + 最小复现」，不在测试里改写产品状态来掩盖；
 *    产品侧失败在输出中以 [产品] 标注，并在报告中列给运营转派属主。
 */
(function () {
  'use strict';

  if (typeof require !== 'function') {
    console.log('[integration-check] 仅支持 Node。');
    return;
  }

  var fs = require('fs');
  var path = require('path');

  var passed = 0;
  var failed = 0;
  var productFailures = [];
  var uncaught = [];
  var consoleErrors = [];
  var FAIL_ONLY = process.argv.indexOf('--failures') !== -1;

  function ok(cond, label, extra) {
    if (cond) {
      passed++;
      if (!FAIL_ONLY) { console.log('  ✓ ' + label); }
    } else {
      failed++;
      if (/\[产品\]/.test(label)) {
        productFailures.push(label + (extra ? ' → ' + extra : ''));
      }
      console.log('  ✗ ' + label + (extra ? '  → ' + extra : ''));
    }
  }

  function eq(actual, expected, label) {
    ok(actual === expected, label, 'got ' + String(actual) + ', want ' + String(expected));
  }

  function approx(actual, expected, label, epsilon) {
    var e = (typeof epsilon === 'number') ? epsilon : 1e-6;
    ok(typeof actual === 'number' && isFinite(actual) &&
      Math.abs(actual - expected) <= e,
      label, 'got ' + String(actual) + ', want ' + String(expected));
  }

  function phase(label, fn) {
    console.log('\n[' + label + ']');
    try {
      fn();
    } catch (err) {
      failed++;
      console.log('  ✗ [phase] ' + label + ' 抛出异常 → ' +
        (err && err.message ? err.message : err));
      uncaught.push(err);
    }
  }

  /* ---------- 架构 §3.2 的 26 个固定脚本 ---------- */

  var SRC_ORDER = [
    'src/core/config.js',
    'src/core/rng.js',
    'src/core/pool.js',
    'src/core/spatial-hash.js',
    'src/core/input.js',
    'src/core/camera.js',
    'src/core/bus.js',
    'src/core/loop.js',
    'src/loot/tables.js',
    'src/loot/progression.js',
    'src/loot/pickup.js',
    'src/sects/defs.js',
    'src/sects/upgrades.js',
    'src/sects/selection.js',
    'src/combat/player.js',
    'src/combat/auto-attack.js',
    'src/monsters/types.js',
    'src/monsters/ai.js',
    'src/monsters/director.js',
    'src/fx/particles.js',
    'src/fx/damage-numbers.js',
    'src/fx/screen-fx.js',
    'src/ui/hud.js',
    'src/ui/screens.js',
    'src/ui/overlays.js',
    'src/core/main.js'
  ];

  var PERF_SCRIPT = 'tests/perf.js';
  var LOAD_ORDER = SRC_ORDER.concat([PERF_SCRIPT]);

  var root = path.join(__dirname, '..');

  var origError = console.error;
  process.on('uncaughtException', function (err) {
    uncaught.push(err);
    console.log('  ✗ 未捕获异常 → ' + (err && err.stack ? err.stack : err));
  });

  // 捕获模块/循环内的 console.error（Loop 会吞掉 update/render 异常并记录）
  console.error = function () {
    var args = Array.prototype.slice.call(arguments);
    var msg = args.map(function (v) {
      return (v && v.stack) ? v.stack : String(v);
    }).join(' ');
    consoleErrors.push(msg);
    origError.apply(console, args);
  };

  /* ---------- 假 DOM / Canvas ---------- */

  var opLog = [];
  var logEnabled = true;
  var seq = 0;

  // 美术渲染桥计数（不依赖 opLog 开关；供加载链/回退桥断言使用）
  var renderSpy = {
    drawImage: 0,
    arc: 0,
    fill: 0,
    stroke: 0,
    moveTo: 0,
    rotate: 0,
    scale: 0,
    byId: Object.create(null),
    lastSrc: ''
  };

  function log(op, extra) {
    if (!logEnabled) { return; }
    var item = { op: op, seq: seq++ };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) { item[k] = extra[k]; }
      }
    }
    opLog.push(item);
  }

  var ctx = {
    canvas: null,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineJoin: 'miter',
    setTransform: function () { log('setTransform'); },
    clearRect: function (x, y, w, h) { log('clearRect', { x: x, y: y, w: w, h: h }); },
    save: function () { log('save'); },
    restore: function () { log('restore'); },
    translate: function (x, y) { log('translate', { x: x, y: y }); },
    fillRect: function (x, y, w, h) {
      log('fillRect', {
        x: x, y: y, w: w, h: h,
        fillStyle: this.fillStyle,
        alpha: this.globalAlpha
      });
    },
    strokeRect: function (x, y, w, h) {
      log('strokeRect', {
        x: x, y: y, w: w, h: h,
        strokeStyle: this.strokeStyle,
        lineWidth: this.lineWidth,
        alpha: this.globalAlpha
      });
    },
    beginPath: function () { log('beginPath'); },
    closePath: function () {},
    moveTo: function () { renderSpy.moveTo++; },
    lineTo: function () {},
    arc: function () { renderSpy.arc++; },
    fill: function () { renderSpy.fill++; },
    stroke: function () { renderSpy.stroke++; },
    rotate: function (angle) { renderSpy.rotate++; log('rotate', { angle: angle }); },
    scale: function (sx, sy) { renderSpy.scale++; log('scale', { sx: sx, sy: sy }); },
    drawImage: function (img, x, y, w, h) {
      renderSpy.drawImage++;
      var src = '';
      try { src = String((img && img.src) || ''); } catch (e) { src = ''; }
      renderSpy.lastSrc = src;
      var id = assetIdFromSrc(src);
      if (id) { renderSpy.byId[id] = (renderSpy.byId[id] || 0) + 1; }
      log('drawImage', { x: x, y: y, w: w, h: h, src: src });
    },
    fillText: function () {},
    strokeText: function () {},
    measureText: function (text) { return { width: String(text).length * 7 }; }
  };

  function classListFor(el) {
    return {
      contains: function (name) { return el._classes.indexOf(name) !== -1; },
      add: function (name) {
        if (el._classes.indexOf(name) === -1) { el._classes.push(name); }
      },
      remove: function (name) {
        var i = el._classes.indexOf(name);
        if (i !== -1) { el._classes.splice(i, 1); }
      },
      toggle: function (name) {
        if (this.contains(name)) { this.remove(name); return false; }
        this.add(name); return true;
      }
    };
  }

  function matches(el, selector) {
    var attr = /^\[([\w-]+)="([^"]*)"\]$/.exec(selector);
    if (attr) { return el.attributes[attr[1]] === attr[2]; }
    if (selector.charAt(0) === '.') { return el._classes.indexOf(selector.slice(1)) !== -1; }
    if (selector.charAt(0) === '#') { return el.id === selector.slice(1); }
    return el.tagName.toLowerCase() === selector.toLowerCase();
  }

  function querySelector(el, selector) {
    for (var i = 0; i < el.children.length; i++) {
      var child = el.children[i];
      if (matches(child, selector)) { return child; }
      var nested = querySelector(child, selector);
      if (nested) { return nested; }
    }
    return null;
  }

  function textOf(el) {
    if (el._text) { return el._text; }
    var out = '';
    for (var i = 0; i < el.children.length; i++) {
      out += textOf(el.children[i]);
    }
    return out;
  }

  function Element(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.attributes = Object.create(null);
    this._classes = [];
    this._text = '';
    this._listeners = Object.create(null);
    this.id = '';
    this.hidden = false;
    this.parentNode = null;

    var props = Object.create(null);
    this.style = {
      setProperty: function (name, value) { props[name] = String(value); },
      getPropertyValue: function (name) { return props[name] || ''; },
      removeProperty: function (name) { delete props[name]; }
    };
    this.classList = classListFor(this);
  }

  Object.defineProperty(Element.prototype, 'className', {
    get: function () { return this._classes.join(' '); },
    set: function (value) {
      this._classes = String(value || '').split(/\s+/).filter(function (s) { return s; });
    }
  });

  Object.defineProperty(Element.prototype, 'textContent', {
    get: function () { return textOf(this); },
    set: function (value) {
      this._text = String(value === null || value === undefined ? '' : value);
      this.children.length = 0;
    }
  });

  Object.defineProperty(Element.prototype, 'firstChild', {
    get: function () { return this.children.length ? this.children[0] : null; }
  });

  Element.prototype.appendChild = function (child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  };
  Element.prototype.removeChild = function (child) {
    var i = this.children.indexOf(child);
    if (i !== -1) { this.children.splice(i, 1); }
    if (child) { child.parentNode = null; }
    return child;
  };
  Element.prototype.setAttribute = function (name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') { this.id = String(value); }
  };
  Element.prototype.getAttribute = function (name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name] : null;
  };
  Element.prototype.querySelector = function (selector) {
    return querySelector(this, selector);
  };
  Element.prototype.addEventListener = function (type, fn) {
    if (!this._listeners[type]) { this._listeners[type] = []; }
    this._listeners[type].push(fn);
  };
  Element.prototype.removeEventListener = function (type, fn) {
    var list = this._listeners[type];
    if (!list) { return; }
    var i = list.indexOf(fn);
    if (i !== -1) { list.splice(i, 1); }
  };

  var elementsById = Object.create(null);

  function addElement(id, tag) {
    var el = new Element(tag || 'div');
    el.id = id;
    elementsById[id] = el;
    return el;
  }

  var canvas = addElement('game', 'canvas');
  canvas.width = 300;
  canvas.height = 150;
  canvas.getContext = function (kind) {
    if (kind !== '2d') { return null; }
    return ctx;
  };
  ctx.canvas = canvas;

  /* ---------- 假 Image：可控 generated → placeholder → missing 加载链 ---------- */
  var fakeImageModes = Object.create(null);
  var fakeImageInstances = [];
  var fakeImageById = Object.create(null);

  function assetIdFromSrc(src) {
    var m = /^assets\/(?:generated\/|placeholder-)([A-Za-z0-9_-]+)\.(?:webp|svg)$/.exec(String(src));
    return m ? m[1] : null;
  }

  function FakeImage() {
    this.complete = false;
    this.naturalWidth = 0;
    this.onload = null;
    this.onerror = null;
    this._src = '';
    this.srcHistory = [];
    fakeImageInstances.push(this);
  }

  Object.defineProperty(FakeImage.prototype, 'src', {
    get: function () { return this._src; },
    set: function (value) {
      var src = String(value);
      this._src = src;
      this.srcHistory.push(src);

      var id = assetIdFromSrc(src);
      if (id && !fakeImageById[id]) { fakeImageById[id] = this; }
      var mode = (id && fakeImageModes[id]) || 'success';
      var placeholder = src.indexOf('assets/placeholder-') === 0;

      if (mode === 'success' || (mode === 'fallback' && placeholder)) {
        this.complete = true;
        this.naturalWidth = 32;
        if (typeof this.onload === 'function') { this.onload(); }
        return;
      }

      this.complete = false;
      this.naturalWidth = 0;
      if (typeof this.onerror === 'function') { this.onerror(); }
    }
  });

  FakeImage.setMode = function (id, mode) {
    fakeImageModes[id] = mode;
  };
  FakeImage.get = function (id) { return fakeImageById[id] || null; };
  FakeImage.instancesFor = function (id) {
    var out = [];
    for (var i = 0; i < fakeImageInstances.length; i++) {
      var img = fakeImageInstances[i];
      if (img.srcHistory.length && assetIdFromSrc(img.srcHistory[0]) === id) {
        out.push(img);
      }
    }
    return out;
  };
  FakeImage.setDrawable = function (id, on) {
    var img = fakeImageById[id];
    if (!img) { return false; }
    img.complete = !!on;
    img.naturalWidth = on ? 32 : 0;
    return true;
  };

  globalThis.Image = FakeImage;

  addElement('hud', 'div');
  var hudTime = addElement('hud-time', 'span');
  hudTime.textContent = '08:00';
  var hudLevel = addElement('hud-level', 'span');
  hudLevel.textContent = '1';
  var hudXp = addElement('hud-xp', 'span');
  hudXp.textContent = '0 / 40';
  addElement('hud-xp-fill', 'span');
  var hudHp = addElement('hud-hp', 'span');
  hudHp.textContent = '100';
  var hudHpMax = addElement('hud-hp-max', 'span');
  hudHpMax.textContent = '100';
  addElement('hud-hp-fill', 'span');
  addElement('hud-kills', 'span');
  addElement('hud-picks', 'span');
  addElement('hud-silver', 'span');
  var hudDebug = addElement('hud-debug', 'div');
  hudDebug.hidden = true;
  addElement('screen-root', 'div');
  addElement('overlay-root', 'div');

  var winListeners = Object.create(null);
  var docListeners = Object.create(null);

  function addTo(map, type, fn) {
    if (!map[type]) { map[type] = []; }
    if (map[type].indexOf(fn) === -1) { map[type].push(fn); }
  }

  var documentStub = {
    readyState: 'complete',
    documentElement: new Element('html'),
    head: new Element('head'),
    body: new Element('body'),
    getElementById: function (id) { return elementsById[id] || null; },
    createElement: function (tag) { return new Element(tag); },
    addEventListener: function (type, fn) { addTo(docListeners, type, fn); },
    removeEventListener: function (type, fn) {
      var list = docListeners[type];
      if (!list) { return; }
      var i = list.indexOf(fn);
      if (i !== -1) { list.splice(i, 1); }
    }
  };

  globalThis.window = globalThis;
  globalThis.document = documentStub;
  globalThis.location = undefined;
  globalThis.getComputedStyle = function () {
    return { getPropertyValue: function () { return ''; } };
  };
  globalThis.addEventListener = function (type, fn) { addTo(winListeners, type, fn); };
  globalThis.removeEventListener = function (type, fn) {
    var list = winListeners[type];
    if (!list) { return; }
    var i = list.indexOf(fn);
    if (i !== -1) { list.splice(i, 1); }
  };

  var rafCb = null;
  var rafId = 0;
  var nowMs = 0;
  globalThis.requestAnimationFrame = function (cb) {
    rafCb = cb;
    rafId += 1;
    return rafId;
  };
  globalThis.cancelAnimationFrame = function () { rafCb = null; };

  // tests/perf.js 在 document 存在时会 setInterval，桩掉以免进程挂起
  globalThis.setInterval = function () { return 0; };
  globalThis.clearInterval = function () {};

  function fireKey(type, code, key) {
    var event = {
      type: type,
      code: code,
      key: key || code,
      repeat: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault: function () {}
    };
    var i;
    var win = winListeners[type] ? winListeners[type].slice() : [];
    for (i = 0; i < win.length; i++) { win[i](event); }
    var doc = docListeners[type] ? docListeners[type].slice() : [];
    for (i = 0; i < doc.length; i++) { doc[i](event); }
  }

  function tick(dtMs) {
    if (typeof rafCb !== 'function') { return false; }
    var cb = rafCb;
    rafCb = null;
    nowMs += (typeof dtMs === 'number' ? dtMs : 17);
    cb(nowMs);
    return true;
  }

  function runTicks(n, dtMs) {
    for (var i = 0; i < n; i++) {
      if (!tick(dtMs)) { return false; }
    }
    return true;
  }

  /* ---------- 静态校验 index.html 脚本表 ---------- */

  console.log('integration-check (v2): 26 src scripts + tests/perf.js · fake DOM · full flow');

  var indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var actualOrder = [];
  var re = /<script\b[^>]*\bsrc="([^"]+)"/g;
  var m;
  while ((m = re.exec(indexHtml)) !== null) {
    var src = m[1].replace(/^\.\//, '');
    if (src.indexOf('src/') === 0 || src.indexOf('tests/') === 0) {
      actualOrder.push(src);
    }
  }

  var actualSrc = actualOrder.filter(function (s) { return s.indexOf('src/') === 0; });
  var srcMatches = actualSrc.length === SRC_ORDER.length;
  if (srcMatches) {
    for (var oi = 0; oi < SRC_ORDER.length; oi++) {
      if (actualSrc[oi] !== SRC_ORDER[oi]) { srcMatches = false; break; }
    }
  }
  ok(srcMatches, 'index.html 的 26 个 src 脚本与架构 §3.2 逐项一致',
    srcMatches ? '' : ('actual=' + actualSrc.join(',')));

  var perfAppended = actualOrder.length === SRC_ORDER.length + 1 &&
    actualOrder[actualOrder.length - 1] === PERF_SCRIPT;
  ok(actualOrder.length === SRC_ORDER.length || perfAppended,
    'index.html 允许 perf.js 作为第 27 项追加（不得插在 main 之前）',
    'count=' + actualOrder.length + ', last=' + actualOrder[actualOrder.length - 1]);
  if (actualOrder.length > SRC_ORDER.length) {
    eq(actualOrder[SRC_ORDER.length], PERF_SCRIPT,
      'index.html 第 27 项恰为 tests/perf.js');
  }

  var loadErrors = [];
  try {
    for (var fi = 0; fi < LOAD_ORDER.length; fi++) {
      require(path.join(root, LOAD_ORDER[fi]));
    }
  } catch (err) {
    loadErrors.push(err);
  }
  ok(loadErrors.length === 0, '26 个 src 脚本 + tests/perf.js 按序加载无异常',
    loadErrors.length ? String(loadErrors[0] && loadErrors[0].stack) : '');

  var WG = globalThis.WG || {};
  var core = WG.core || null;
  var world = null;

  /* ---------- 事件采集 ---------- */

  var ev = {
    damage: [], killed: [], drop: [], picked: [], levelUp: [],
    sect: [], offer: [], pick: [], hurt: [], dead: [], result: []
  };

  function listen(type, bucket) {
    if (!core || !core.Bus) { return; }
    core.Bus.on(type, function (payload) {
      bucket.push(payload || {});
    });
  }
  listen('damage', ev.damage);
  listen('monster:killed', ev.killed);
  listen('loot:drop', ev.drop);
  listen('loot:picked', ev.picked);
  listen('level:up', ev.levelUp);
  listen('sect:selected', ev.sect);
  listen('choice:offer', ev.offer);
  listen('choice:pick', ev.pick);
  listen('player:hurt', ev.hurt);
  listen('player:dead', ev.dead);
  listen('run:result', ev.result);

  function last(arr) { return arr.length ? arr[arr.length - 1] : null; }

  function findRef(name) {
    var screenRoot = elementsById['screen-root'];
    if (!screenRoot) { return null; }
    return screenRoot.querySelector('[data-ref="' + name + '"]');
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function formatDuration(seconds) {
    var s = Math.max(0, Math.floor(Number(seconds) || 0));
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }

  var STAT_KEYS = [
    'atk', 'atkInterval', 'maxHp', 'speed', 'regen',
    'critRate', 'critMult', 'damageReduction'
  ];

  function snapshotStats(player) {
    var out = {};
    var st = (player && player.stats) || {};
    for (var i = 0; i < STAT_KEYS.length; i++) {
      out[STAT_KEYS[i]] = st[STAT_KEYS[i]];
    }
    ['projectileCount', 'range', 'pickupRadius', 'magnetRadius',
      'pierce', 'projectileSpeed', 'potionDropMult', 'potionHealBonus'].forEach(function (k) {
      out[k] = st[k];
    });
    return out;
  }

  function statsChanged(before, after) {
    for (var k in before) {
      if (Object.prototype.hasOwnProperty.call(before, k) && before[k] !== after[k]) {
        return k;
      }
    }
    return null;
  }

  function checkSectStats(id) {
    var def = WG.sects.DEFS[id];
    var init = def.init;
    var player = world.player;
    var st = player.stats;
    for (var i = 0; i < STAT_KEYS.length; i++) {
      var key = STAT_KEYS[i];
      approx(st[key], init[key], '门派 ' + id + ' 写入 stats.' + key);
    }
    approx(player.maxHp, init.maxHp, '门派 ' + id + ' 同步 player.maxHp');
    approx(player.hp, init.maxHp, '门派 ' + id + ' 开局回满 player.hp');
    ok(typeof st.critRate === 'number' && typeof st.critMult === 'number',
      '门派 ' + id + ' stats 含 critRate/critMult');
  }

  function switchSect(id) {
    var before = ev.sect.length;
    var result = WG.sects.Selection.selectSect(id);
    ok(result === true, 'Selection.selectSect(' + id + ') 返回 true');
    ok(ev.sect.length > before, 'selectSect 发出 sect:selected');
    var payload = last(ev.sect);
    eq(payload && payload.sectId, id, 'sect:selected 载荷 sectId=' + id);
    eq(WG.sects.Selection.current(), id, 'Selection.current()=' + id);
    eq(world.state, 'playing', '选定 ' + id + ' 后 world.state=playing');
    eq(WG.ui.ScreenFlow.current(), 'playing', '选定 ' + id + ' 后界面进入 playing');
    checkSectStats(id);
  }

  function drainOffers(limit) {
    var guard = 0;
    while (core.Loop.paused && guard < (limit || 4)) {
      guard++;
      var offer = WG.sects.Selection.pendingOffer();
      if (!offer || !offer.options || !offer.options.length) { break; }
      WG.sects.Selection.choose(offer.options[0].id);
    }
    return guard;
  }

  function optionCounts(options) {
    var counts = { common: 0, sect: 0, ultimate: 0 };
    for (var i = 0; i < options.length; i++) {
      var kind = options[i] && options[i].kind;
      if (counts[kind] !== undefined) { counts[kind]++; }
    }
    return counts;
  }

  /* ---------- 1) 命名空间 / 公开 API / boot ---------- */

  phase('命名空间与 boot', function () {
    var ns = ['core', 'combat', 'monsters', 'loot', 'sects', 'fx', 'ui', 'perf'];
    for (var i = 0; i < ns.length; i++) {
      ok(WG[ns[i]] && typeof WG[ns[i]] === 'object', 'WG.' + ns[i] + ' 存在');
    }

    ok(core && typeof core === 'object', 'WG.core 存在');
    var coreApis = ['CONFIG', 'Rng', 'Pool', 'SpatialHash', 'Input', 'Camera', 'Bus', 'Loop', 'boot'];
    for (var c = 0; c < coreApis.length; c++) {
      ok(core && core[coreApis[c]] !== undefined, 'WG.core.' + coreApis[c] + ' 可用');
    }

    var combat = WG.combat || {};
    ok(combat.Player && combat.player && combat.CombatSystem,
      'WG.combat.{Player,player,CombatSystem} 可用');
    var monsters = WG.monsters || {};
    ok(monsters.types && monsters.MonsterSystem && monsters.Director,
      'WG.monsters.{types,MonsterSystem,Director} 可用');
    var loot = WG.loot || {};
    ok(loot.tables && loot.Progression && loot.LootSystem,
      'WG.loot.{tables,Progression,LootSystem} 可用');
    var sects = WG.sects || {};
    ok(sects.DEFS && sects.UpgradePool && sects.Selection,
      'WG.sects.{DEFS,UpgradePool,Selection} 可用');
    var fx = WG.fx || {};
    ok(fx.particles && fx.numbers && fx.screen && fx.degrade && typeof fx.render === 'function',
      'WG.fx.{particles,numbers,screen,degrade,render} 可用');
    var ui = WG.ui || {};
    ok(ui.HUD && typeof ui.HUD.render === 'function', '契约 WG.ui.HUD.render 可用');
    ok(ui.hud && ui.hud === ui.HUD, 'v1 别名 WG.ui.hud === WG.ui.HUD');
    ok(ui.ScreenFlow && typeof ui.ScreenFlow.go === 'function' &&
      typeof ui.ScreenFlow.current === 'function' &&
      typeof ui.ScreenFlow.bindInput === 'function',
      'WG.ui.ScreenFlow.{go,current,bindInput} 可用');
    ok(ui.Overlays && typeof ui.Overlays.showSect === 'function' &&
      typeof ui.Overlays.showChoice === 'function' &&
      typeof ui.Overlays.hide === 'function',
      'WG.ui.Overlays 公开 API 可用');
    ok(typeof ui.score === 'function', 'WG.ui.score 纯函数可用');
    var perf = WG.perf || {};
    ok(perf.overlay && typeof perf.fastForward === 'function' &&
      typeof perf.spawnBurst === 'function',
      'WG.perf.{overlay,fastForward,spawnBurst} 可用');
    ok(perf.stats && typeof perf.stats === 'object', 'WG.perf.stats 可用');

    world = core.boot();
    ok(!!world, 'core.boot() 返回 world');
    ok(world.combat && world.monsters && world.loot && world.director && world.player,
      'world.combat/monsters/loot/director/player 非空');
    eq(world.state, 'title', 'boot 后 world.state=title');
    eq(ui.ScreenFlow.current(), 'title', 'boot 后界面状态 title');
    ok(canvas.width === 1280 && canvas.height === 720,
      'canvas 后备尺寸 1280×720', canvas.width + '×' + canvas.height);
    ok(typeof rafCb === 'function', 'Loop.start 已注册首帧回调');
  });

  /* ---------- 2) 开局：Enter → sect（不进入 playing）→ 选门派 ---------- */

  phase('开局与门派选择', function () {
    ok(!!world, 'world 已创建');
    if (!world) { return; }

    fireKey('keydown', 'Enter', 'Enter');
    fireKey('keyup', 'Enter', 'Enter');

    eq(WG.ui.ScreenFlow.current(), 'sect', '标题页 Enter → 门派页');
    eq(world.state, 'title', '门派页尚未开始对局（state=title）');
    ok(!WG.ui.Overlays.isOpen(), '门派页不是覆盖层，Overlays 未打开');

    switchSect('jianzong');

    var count = ev.sect.length;
    var again = WG.sects.Selection.selectSect('jianzong');
    ok(again === true, '重复 selectSect 同门派返回 true');
    eq(ev.sect.length, count, '重复 selectSect 同门派不重复发 sect:selected');
    eq(world.state, 'playing', '重复 selectSect 后仍在 playing');
  });

  /* ---------- 3) 三门派数值与提案 §5.1 一致 ---------- */

  phase('三门派数值', function () {
    if (!world) { return; }

    var defs = WG.sects.DEFS;
    approx(defs.jianzong.init.atk, 10, 'DEFS 剑宗 atk=10');
    approx(defs.jianzong.init.atkInterval, 0.42, 'DEFS 剑宗 atkInterval=0.42');
    approx(defs.jianzong.init.maxHp, 100, 'DEFS 剑宗 maxHp=100');
    approx(defs.jianzong.init.speed, 230, 'DEFS 剑宗 speed=230');
    approx(defs.daomen.init.atk, 18, 'DEFS 刀门 atk=18');
    approx(defs.daomen.init.atkInterval, 0.70, 'DEFS 刀门 atkInterval=0.70');
    approx(defs.daomen.init.maxHp, 110, 'DEFS 刀门 maxHp=110');
    approx(defs.daomen.init.speed, 215, 'DEFS 刀门 speed=215');
    approx(defs.daomen.init.critRate, 0.10, 'DEFS 刀门 critRate=0.10');
    approx(defs.daomen.init.critMult, 1.6, 'DEFS 刀门 critMult=1.6');
    approx(defs.yigu.init.atk, 9, 'DEFS 医谷 atk=9');
    approx(defs.yigu.init.atkInterval, 0.60, 'DEFS 医谷 atkInterval=0.60');
    approx(defs.yigu.init.maxHp, 140, 'DEFS 医谷 maxHp=140');
    approx(defs.yigu.init.speed, 205, 'DEFS 医谷 speed=205');
    approx(defs.yigu.init.regen, 1.5, 'DEFS 医谷 regen=1.5');
    approx(defs.yigu.init.damageReduction, 0.05, 'DEFS 医谷 damageReduction=0.05');

    switchSect('daomen');
    switchSect('yigu');
    switchSect('jianzong');
  });

  /* ---------- 4) 移动 / 相机 / 世界背景 ---------- */

  phase('移动与背景', function () {
    if (!world || world.state !== 'playing') { return; }
    drainOffers();

    var player = world.player;
    var cam = core.Camera;
    var beforeX = player.x;
    var beforeCamX = cam.x;

    opLog.length = 0;
    logEnabled = true;

    fireKey('keydown', 'KeyD', 'd');
    runTicks(61, 17); // 首帧只做时间基准，随后约 60 个固定步
    fireKey('keyup', 'KeyD', 'd');

    var dx = player.x - beforeX;
    ok(dx > 100, 'KeyD 60 帧后玩家 x 增加 > 100px', 'dx=' + dx.toFixed(1));
    var camDelta = cam.x - beforeCamX;
    ok(camDelta > 20, '相机跟随玩家（Camera.x 增加 > 20px）', 'dCam=' + camDelta.toFixed(1));

    var clear = null;
    var translate = null;
    var baseFill = null;
    var badLarge = [];
    var saves = 0;
    var restores = 0;

    for (var i = 0; i < opLog.length; i++) {
      var op = opLog[i];
      if (op.op === 'clearRect' && !clear) { clear = op; }
      if (op.op === 'translate' && !translate) { translate = op; }
      if (op.op === 'save') { saves++; }
      if (op.op === 'restore') { restores++; }
      if (op.op === 'fillRect') {
        if (!baseFill && op.w > 600 && op.h > 300) { baseFill = op; }
        if (op.w > 200 || op.h > 200) {
          if (op.x < 0 || op.y < 0 ||
              op.x + op.w > world.width + 0.5 ||
              op.y + op.h > world.height + 0.5) {
            badLarge.push(op);
          }
        }
      }
    }

    eq(clear && clear.w, 1280, 'clearRect 使用视口宽度 1280');
    eq(clear && clear.h, 720, 'clearRect 使用视口高度 720');
    ok(!!translate, 'Camera.apply 执行了 translate');
    ok(!!baseFill && translate && translate.seq < baseFill.seq,
      '世界背景在 Camera.apply 之后绘制');
    ok(!!baseFill, '绘制了可见世界底色（大块 fillRect）');
    if (baseFill) {
      ok(baseFill.x >= 0 && baseFill.y >= 0 &&
        baseFill.x + baseFill.w <= world.width + 0.5 &&
        baseFill.y + baseFill.h <= world.height + 0.5,
        '世界背景不越出 world 边界',
        'rect=' + baseFill.x + ',' + baseFill.y + ',' + baseFill.w + ',' + baseFill.h);
    }
    ok(badLarge.length === 0, '大块 fillRect 均在世界边界内', 'bad=' + badLarge.length);
    eq(saves, restores, '渲染帧 ctx.save/restore 配平', 'save=' + saves + ', restore=' + restores);

    logEnabled = false;
    opLog.length = 0;
  });

  /* ---------- 5) 自动攻击：damage / crit / monster:killed ---------- */

  phase('自动攻击与击杀', function () {
    if (!world || world.state !== 'playing') { return; }
    drainOffers();
    var player = world.player;
    var st = player.stats;

    ok(typeof st.critRate === 'number' && typeof st.critMult === 'number',
      'player.stats 含 critRate/critMult');

    var monster = world.monsters.spawn('youxia', player.x + 150, player.y, null);
    ok(!!monster, '在玩家 150px 内生成游侠');
    if (!monster) { return; }
    var targetId = monster.id;
    monster.speed = 0;
    if (Object.prototype.hasOwnProperty.call(monster, 'baseSpeed')) {
      monster.baseSpeed = 0;
    }

    var damageBefore = ev.damage.length;
    var killedBefore = ev.killed.length;
    runTicks(240, 17); // 约 4 秒

    var newDamage = ev.damage.slice(damageBefore);
    ok(newDamage.length > 0, '自动攻击产生 damage 事件', 'damage=' + newDamage.length);
    var critOk = true;
    var hitOur = false;
    for (var i = 0; i < newDamage.length; i++) {
      var d = newDamage[i];
      if (typeof d.crit !== 'boolean') { critOk = false; }
      if (!(typeof d.amount === 'number' && d.amount > 0)) { critOk = false; }
      if (d.targetId === targetId) { hitOur = true; }
    }
    ok(critOk, 'damage 载荷均含 crit(boolean) 与 amount>0');
    ok(hitOur, 'damage 命中本次生成的游侠', 'targetId=' + targetId);

    var killed = null;
    for (var k = killedBefore; k < ev.killed.length; k++) {
      if (ev.killed[k] && ev.killed[k].id === targetId) { killed = ev.killed[k]; break; }
    }
    ok(!!killed, '怪物被击杀并发出 monster:killed', 'killed=' + (ev.killed.length - killedBefore));
    if (killed) {
      ok(typeof killed.x === 'number' && typeof killed.y === 'number' &&
        typeof killed.type === 'string',
        'monster:killed 载荷含 x/y/type');
    }
    eq(world.monsters.byId(targetId), null, '死亡怪物已从 byId 释放');
  });

  /* ---------- 6) 掉落 → 拾取 → 经验 ---------- */

  phase('掉落与拾取', function () {
    if (!world || world.state !== 'playing') { return; }
    drainOffers();

    var loot = world.loot;
    var prog = WG.loot.Progression;
    var player = world.player;

    ok(ev.drop.length > 0, '击杀产生 loot:drop 事件', 'drops=' + ev.drop.length);
    ok(loot.count() > 0, 'LootSystem.count > 0', 'count=' + loot.count());

    var xpDrop = null;
    if (loot.pool && typeof loot.pool.forEach === 'function') {
      loot.pool.forEach(function (drop) {
        if (!xpDrop && drop && drop.kind === 'xp') { xpDrop = drop; }
      });
    }
    ok(!!xpDrop, '存在经验珠掉落');
    if (!xpDrop) { return; }

    var pickedBefore = ev.picked.length;
    var worldPickedBefore = world.picked;
    var xpBefore = prog.xp;
    var levelBefore = prog.level;

    player.x = xpDrop.x;
    player.y = xpDrop.y;
    runTicks(50, 17);
    drainOffers();

    ok(ev.picked.length > pickedBefore, '拾取发出 loot:picked',
      'pickedEvents=' + (ev.picked.length - pickedBefore));
    ok(world.picked > worldPickedBefore, 'world.picked 增加',
      worldPickedBefore + ' → ' + world.picked);
    ok(prog.xp > xpBefore || prog.level > levelBefore, '经验值/等级增加',
      'Lv' + prog.level + ' xp=' + prog.xp);

    // 契约 §4.3 player.stats 含 xp/xpNext，HUD 也直接读它；这里核对同步。
    if (prog.xp === 0) { prog.addXp(5); } // 不足升级，制造可观察的经验差
    runTicks(2, 17);

    ok(player.stats.xp === prog.xp,
      '[产品] player.stats.xp 与 Progression.xp 同步',
      'stats.xp=' + player.stats.xp + ', Progression.xp=' + prog.xp);
    ok(String(hudXp.textContent) === (prog.xp + ' / ' + prog.xpNext),
      '[产品] HUD #hud-xp 显示当前经验',
      'hud=' + hudXp.textContent + ', want=' + prog.xp + ' / ' + prog.xpNext);
  });

  require('./art-render-check.js')({
    phase: phase,
    ok: ok,
    eq: eq,
    world: world,
    ctx: ctx,
    renderSpy: renderSpy,
    FakeImage: FakeImage,
    fakeImageInstances: fakeImageInstances,
    WG: WG,
    core: core,
    fs: fs,
    path: path,
    root: root,
    indexHtml: indexHtml,
    actualOrder: actualOrder,
    SRC_ORDER: SRC_ORDER,
    PERF_SCRIPT: PERF_SCRIPT,
    LOAD_ORDER: LOAD_ORDER
  });

  /* ---------- 7) 升级三选一：offer 3 项 / 暂停 / 选择 / 恢复 / 即时生效 ---------- */

  var chosenIds = [];

  phase('升级三选一', function () {
    if (!world || world.state !== 'playing') { return; }
    drainOffers();

    var prog = WG.loot.Progression;
    var selection = WG.sects.Selection;
    var pool = WG.sects.UpgradePool;

    function checkOfferContent(level) {
      var offer = last(ev.offer);
      ok(!!offer, 'Lv' + level + ' 发出 choice:offer');
      eq(offer && offer.level, level, 'choice:offer.level=' + level);
      ok(Array.isArray(offer && offer.options), 'choice:offer.options 为数组');
      var options = (offer && offer.options) || [];
      eq(options.length, 3, 'Lv' + level + ' 恰好 3 个选项（无重复、数量恰好）');
      var seen = {};
      var unique = true;
      for (var i = 0; i < options.length; i++) {
        var id = options[i] && options[i].id;
        if (!id || seen[id]) { unique = false; }
        seen[id] = true;
        ok(!!(options[i] && options[i].name) && typeof options[i].desc === 'string',
          'Lv' + level + ' 选项 ' + (id || i) + ' 含 name/desc');
      }
      ok(unique, 'Lv' + level + ' 选项 id 不重复');
      var counts = optionCounts(options);
      if (level === 3 || level === 5 || level === 8) {
        var expect = level === 3 ? 'whirl' : (level === 5 ? 'swords' : 'twin');
        eq(options[0] && options[0].kind, 'ultimate',
          'Lv' + level + ' 首名额为绝学');
        eq(options[0] && options[0].id, expect,
          'Lv' + level + ' 首个绝学 = ' + expect);
        eq(counts.sect, 1, 'Lv' + level + ' 含 1 个门派专属');
        eq(counts.common, 1, 'Lv' + level + ' 含 1 个通用（绝学占 1 名额）');
      } else {
        eq(counts.sect, 1, 'Lv' + level + ' 含 1 个门派专属');
        eq(counts.common, 2, 'Lv' + level + ' 含 2 个通用');
        eq(counts.ultimate, 0, 'Lv' + level + ' 非里程碑不含绝学');
      }
      return options;
    }

    function levelOnce(expectedLevel) {
      var need = prog.xpNext - prog.xp;
      ok(need > 0, 'Lv' + expectedLevel + ' 前经验差 > 0', 'need=' + need);
      var upBefore = ev.levelUp.length;
      var offerBefore = ev.offer.length;
      var pickBefore = ev.pick.length;

      prog.addXp(need);

      eq(prog.level, expectedLevel, '升级到 Lv' + expectedLevel);
      ok(ev.levelUp.length > upBefore, 'Lv' + expectedLevel + ' 发出 level:up');
      eq(last(ev.levelUp) && last(ev.levelUp).level, expectedLevel,
        'level:up 载荷 {level:' + expectedLevel + '}');
      ok(core.Loop.paused === true, 'Lv' + expectedLevel + ' 三选一期间 Loop.paused=true');
      eq(world.state, 'playing', 'Lv' + expectedLevel + ' 三选一时 world 仍为 playing');
      ok(ev.offer.length > offerBefore, 'Lv' + expectedLevel + ' 产生新的 choice:offer');

      var options = checkOfferContent(expectedLevel);
      var chosen = options[0];
      var stackBefore = selection.stacks()[chosen.id] || 0;
      var player = world.player;
      var st = player.stats || {};
      var before = snapshotStats(player);
      var flagsBefore = {
        whirl: !!st.whirl, swords: !!st.swords, twin: !!st.twin, cleave: !!st.cleave
      };

      var applied = selection.choose(chosen.id);
      ok(applied === true, 'Selection.choose(' + chosen.id + ') 成功');
      ok(ev.pick.length > pickBefore, '选择后发出 choice:pick');
      eq(last(ev.pick) && last(ev.pick).optionId, chosen.id,
        'choice:pick.optionId=' + chosen.id);
      eq(last(ev.pick) && last(ev.pick).level, expectedLevel,
        'choice:pick.level=' + expectedLevel);
      ok(core.Loop.paused === false, '选择后 Loop.paused=false（立即恢复）');
      ok(!WG.ui.Overlays.isOpen(), '选择后覆盖层关闭');
      eq(selection.stacks()[chosen.id], stackBefore + 1,
        '已选选项层数递增（' + chosen.id + '）');

      var after = snapshotStats(player);
      var changed = statsChanged(before, after);
      if (!changed) {
        var st2 = player.stats || {};
        var flagNow = {
          whirl: !!st2.whirl, swords: !!st2.swords, twin: !!st2.twin, cleave: !!st2.cleave
        };
        for (var fk in flagsBefore) {
          if (flagsBefore[fk] !== flagNow[fk]) { changed = 'flag:' + fk; break; }
        }
      }
      ok(!!changed, '选择后属性立即变化（' + chosen.id + '）', 'changed=' + String(changed));
      return chosen.id;
    }

    var start = prog.level;
    if (start < 8) {
      chosenIds.push(levelOnce(start + 1));
      for (var lv = start + 2; lv <= 8; lv++) {
        chosenIds.push(levelOnce(lv));
      }
    }
    eq(prog.level, 8, '连续升级到 Lv8');
    ok(selection.selected().length === chosenIds.length,
      'Selection.selected() 记录全部选择', selection.selected().length + ' vs ' + chosenIds.length);

    var st = world.player.stats || {};
    if (chosenIds.indexOf('whirl') !== -1) { eq(st.whirl, true, 'whirl 绝学标志已写入 stats'); }
    if (chosenIds.indexOf('swords') !== -1) { eq(st.swords, true, 'swords 绝学标志已写入 stats'); }
    if (chosenIds.indexOf('twin') !== -1) { eq(st.twin, true, 'twin 绝学标志已写入 stats'); }

    // 升级后等级镜像（player 订阅 level:up）
    eq(world.player.stats.level, prog.level, 'player.stats.level 跟随 level:up',
      world.player.stats.level + ' vs ' + prog.level);
  });

  /* ---------- 8) 结算（8:00 存活 → win） ---------- */

  phase('结算评分（win）', function () {
    if (!world || world.state !== 'playing') { return; }
    drainOffers();

    var player = world.player;
    var duration = core.CONFIG.run.duration;
    world.runTime = duration - 0.01;
    world.remaining = duration - world.runTime;

    var resultBefore = ev.result.length;
    runTicks(2, 17);

    ok(ev.result.length > resultBefore, '到达 8:00 发出 run:result');
    eq(world.state, 'over', '到达 8:00 后 world.state=over');
    eq(world.outcome, 'win', 'win 结算 world.outcome=win');

    var r = last(ev.result);
    ok(!!r, 'run:result 载荷存在');
    if (!r) { return; }
    eq(r.outcome, 'win', 'run:result.outcome=win');
    ok(r.stats && typeof r.stats === 'object', 'run:result.stats 存在');
    eq(r.stats.outcome, 'win', 'stats.outcome=win');
    eq(r.stats.runTime, world.runTime, 'stats.runTime 与本局计时一致');
    eq(r.stats.kills, world.kills, 'stats.kills 与 world.kills 一致');
    eq(r.stats.picks, world.picked, 'stats.picks 与 world.picked 一致');
    eq(r.stats.silver, world.coins, 'stats.silver 与 world.coins 一致');
    eq(r.stats.level, player.stats.level, 'stats.level 与 player.stats.level 一致');
    eq(r.stats.atk, player.stats.atk, 'stats.atk 与 player.stats.atk 一致');

    var scored = WG.ui.score(r.stats);
    eq(r.score, scored.score, 'run:result.score 与 WG.ui.score 一致');
    eq(r.grade, scored.grade, 'run:result.grade 与 WG.ui.score 一致');
    eq(WG.ui.ScreenFlow.current(), 'result', '结算后界面进入 result');

    // 评分阈值抽查（方案 §7.2：S≥2000 / A≥1500 / B≥900 / C<900）
    var c0 = WG.ui.score({ kills: 0, picks: 0, level: 0, silver: 0, runTime: 0 });
    eq(c0.score, 0, 'ui.score 空统计 = 0');
    eq(c0.grade, 'C', 'ui.score 0 分 = C');
    var b = WG.ui.score({ kills: 450, picks: 0, level: 0, silver: 0, runTime: 0 });
    eq(b.score, 900, 'ui.score 450 杀 = 900');
    eq(b.grade, 'B', 'ui.score 900 分 = B');
    var a = WG.ui.score({ kills: 750, picks: 0, level: 0, silver: 0, runTime: 0 });
    eq(a.score, 1500, 'ui.score 750 杀 = 1500');
    eq(a.grade, 'A', 'ui.score 1500 分 = A');
    var s = WG.ui.score({ kills: 1000, picks: 0, level: 0, silver: 0, runTime: 0 });
    eq(s.score, 2000, 'ui.score 1000 杀 = 2000');
    eq(s.grade, 'S', 'ui.score 2000 分 = S');

    // 结算页直出同一统计对象（AC-10 抽查）
    eq(findRef('result-time') && findRef('result-time').textContent,
      formatDuration(r.stats.runTime), '结算页存活时间与 stats 一致');
    eq(findRef('result-level') && findRef('result-level').textContent,
      String(Math.round(r.stats.level)), '结算页等级与 stats 一致');
    eq(findRef('result-kills') && findRef('result-kills').textContent,
      String(Math.round(r.stats.kills)), '结算页击杀与 stats 一致');
    eq(findRef('result-picks') && findRef('result-picks').textContent,
      String(Math.round(r.stats.picks)), '结算页拾取与 stats 一致');
    eq(findRef('result-silver') && findRef('result-silver').textContent,
      String(Math.round(r.stats.silver)), '结算页银两与 stats 一致');
    eq(findRef('result-atk') && findRef('result-atk').textContent,
      String(Math.round(r.stats.atk)), '结算页最终攻击力与 stats 一致');
    var scoreText = findRef('result-score') ? String(findRef('result-score').textContent) : '';
    ok(scoreText.indexOf(String(Math.round(r.score * 10) / 10)) !== -1,
      '结算页评分与 run:result.score 一致', scoreText);
    eq(findRef('result-badge') && findRef('result-badge').textContent, r.grade,
      '结算页等级徽章 = ' + r.grade);
  });

  /* ---------- 9) 结算 → 门派页 → 同门派再次开局 ---------- */

  phase('结算后再次开局', function () {
    if (!world) { return; }

    fireKey('keydown', 'KeyR', 'r');
    fireKey('keyup', 'KeyR', 'r');
    eq(WG.ui.ScreenFlow.current(), 'sect', '结算页按 R → 门派页');
    eq(world.state, 'over', '门派页时旧对局仍为 over，等待确认门派');

    fireKey('keydown', 'Enter', 'Enter');
    fireKey('keyup', 'Enter', 'Enter');

    ok(world.state === 'playing',
      '[产品] 结算后经门派页确认同门派可再次开局',
      'state=' + world.state + ', sect=' + WG.sects.Selection.current());

    // 不掩盖缺陷：用公开的 v1 兼容入口继续后续用例
    core.Bus.emit('ui:restart', { source: 'integration-check' });
    eq(world.state, 'playing', 'ui:restart 公开入口可重新开局');
    eq(WG.ui.ScreenFlow.current(), 'playing', 'ui:restart 后界面 playing');
  });

  /* ---------- 10) 重开复位（等级/经验/掉落/门派/属性/seed 序列） ---------- */

  phase('重开复位', function () {
    if (!world || world.state !== 'playing') { return; }
    drainOffers();

    var prog = WG.loot.Progression;
    var sel = WG.sects.Selection;
    var loot = world.loot;
    var player = world.player;

    function quickLevel(expected) {
      var need = prog.xpNext - prog.xp;
      prog.addXp(need);
      eq(prog.level, expected, '重开前升级到 Lv' + expected);
      ok(core.Loop.paused === true, '重开前 Lv' + expected + ' 触发暂停');
      var offer = last(ev.offer);
      ok(!!offer && offer.options && offer.options.length === 3,
        '重开前 Lv' + expected + ' 三选一 3 项');
      if (offer && offer.options && offer.options.length) {
        sel.choose(offer.options[0].id);
      }
      ok(core.Loop.paused === false, '重开前选择后恢复');
    }

    quickLevel(2);
    quickLevel(3);
    eq(prog.level, 3, '重开前已到 Lv3');
    ok(Object.keys(sel.modifiers).length > 0, '重开前已有已选成长');

    var drop = loot.dropAt(player.x + 500, player.y, 'xp', 6);
    ok(!!drop, '重开前可放置掉落');
    ok(loot.count() >= 1, '重开前掉落池非空');

    function sampleSilver(originX) {
      var out = [];
      for (var i = 0; i < 8; i++) {
        var d = loot.dropAt(originX + i * 11, 3000, 'silver');
        out.push(d ? d.amount : null);
      }
      return out;
    }

    var seqA = sampleSilver(2400);
    var seedBefore = world.seed;

    world.kills = 7;
    world.picked = 5;
    world.coins = 42;
    world.runTime = 123.5;

    core.Bus.emit('ui:restart', { source: 'integration-check' });

    eq(world.state, 'playing', '重开后 state=playing');
    eq(WG.ui.ScreenFlow.current(), 'playing', '重开后界面 playing');
    eq(world.runTime, 0, '重开后 runTime 归零');
    eq(world.kills, 0, '重开后 world.kills=0');
    eq(world.picked, 0, '重开后 world.picked=0');
    eq(world.coins, 0, '重开后 world.coins=0');
    eq(prog.level, 1, '重开后 Progression.level=1');
    eq(prog.xp, 0, '重开后 Progression.xp=0');
    eq(prog.xpNext, 40, '重开后 xpNext=40');
    eq(player.stats.xp, 0, '重开后 player.stats.xp=0');
    ok(player.stats.level === 1,
      '[产品] 重开后 player.stats.level=1',
      'stats.level=' + player.stats.level + ', Progression.level=' + prog.level);
    eq(loot.count(), 0, '重开后 LootSystem.count()=0');
    eq(world.monsters.count, 0, '重开后怪物清空');
    eq(sel.current(), 'jianzong', '重开后重新应用当前门派（剑宗）');
    approx(world.seed, seedBefore, '重开保留同一 world.seed');
    checkSectStats('jianzong');

    var seqB = sampleSilver(2400);
    ok(seqA.length === 8 && seqA.join(',') === seqB.join(','),
      '同 seed 重开后银两掉落序列一致',
      seqA.join(',') + ' vs ' + seqB.join(','));

    var rngA = [world.rng.next(), world.rng.next(), world.rng.next()];
    core.Bus.emit('ui:restart', { source: 'integration-check' });
    var rngB = [world.rng.next(), world.rng.next(), world.rng.next()];
    ok(rngA.join(',') === rngB.join(','), '同 seed 重开后 world.rng 序列一致',
      rngA.join(',') + ' vs ' + rngB.join(','));

    core.Bus.emit('ui:restart', { source: 'integration-check' });
    eq(world.state, 'playing', '清场重开后仍在 playing');

    runTicks(2, 17);
    eq(String(hudLevel.textContent), '1',
      '[产品] 重开后 HUD #hud-level 显示 Lv1',
      'hud=' + hudLevel.textContent + ', Progression.level=' + prog.level);
  });

  /* ---------- 11) 死亡结算 ---------- */

  phase('结算评分（dead）', function () {
    if (!world || world.state !== 'playing') {
      core.Bus.emit('ui:restart', { source: 'integration-check' });
    }
    drainOffers();

    var player = world.player;
    player.hp = player.maxHp;

    var deadBefore = ev.dead.length;
    var resultBefore = ev.result.length;
    var dealt = player.takeDamage(999999);

    ok(dealt > 0, 'player.takeDamage 实际扣血', dealt);
    ok(ev.dead.length > deadBefore, 'HP 归零发出 player:dead');
    eq(world.state, 'over', '死亡后 world.state=over');
    eq(world.outcome, 'dead', '死亡结算 world.outcome=dead');

    var r = last(ev.result);
    ok(ev.result.length > resultBefore && !!r, '死亡发出 run:result');
    if (!r) { return; }
    eq(r.outcome, 'dead', 'run:result.outcome=dead');
    eq(r.stats.outcome, 'dead', 'stats.outcome=dead');
    eq(r.stats.runTime, world.runTime, '死亡 stats.runTime 与本局计时一致');
    eq(r.stats.kills, world.kills, '死亡 stats.kills 一致');
    eq(r.stats.picks, world.picked, '死亡 stats.picks 一致');
    eq(r.stats.silver, world.coins, '死亡 stats.silver 一致');
    eq(r.stats.level, player.stats.level, '死亡 stats.level 与玩家一致');
    var scored = WG.ui.score(r.stats);
    eq(r.score, scored.score, '死亡 run:result.score 与 WG.ui.score 一致');
    eq(r.grade, scored.grade, '死亡 run:result.grade 与 WG.ui.score 一致');
    eq(WG.ui.ScreenFlow.current(), 'result', '死亡后界面进入 result');
  });

  /* ---------- 12) 重置 API：Selection / Progression / LootSystem ---------- */

  phase('重置 API', function () {
    if (!world) { return; }
    var prog = WG.loot.Progression;
    var sel = WG.sects.Selection;
    var loot = world.loot;

    // over 状态下升级：main 不暂停（应屏息等待再次开局），仍应发 level:up
    var upBefore = ev.levelUp.length;
    prog.addXp(prog.xpNext - prog.xp);
    eq(prog.level, 2, '重置前 Progression 到 Lv2');
    ok(ev.levelUp.length > upBefore, 'over 状态仍收到 level:up');
    ok(core.Loop.paused === false, 'over 状态 choice:offer 不暂停 Loop');
    ok(WG.ui.Overlays.isOpen(), 'over 状态覆盖层仍呈现选项');

    var drop = loot.dropAt(3000, 3000, 'xp', 6);
    ok(!!drop && loot.count() > 0, '重置前掉落池非空');

    sel.reset(world);
    eq(sel.current(), null, 'Selection.reset 清空门派');
    eq(Object.keys(sel.modifiers).length, 0, 'Selection.reset 清空已选成长');
    eq(sel.pendingOffer(), null, 'Selection.reset 清空待选项');
    ok(sel.selected().length === 0, 'Selection.reset 清空已选记录');

    prog.reset(world);
    eq(prog.level, 1, 'Progression.reset 等级=1');
    eq(prog.xp, 0, 'Progression.reset 经验=0');

    loot.reset(world);
    eq(loot.count(), 0, 'LootSystem.reset 清空掉落');
    eq(prog.level, 1, 'LootSystem.reset 同时复位 Progression');

    WG.ui.Overlays.hide();
    ok(!WG.ui.Overlays.isOpen(), '可关闭残留覆盖层');

    core.Bus.emit('ui:restart', { source: 'integration-check' });
    eq(world.state, 'playing', '重置后 ui:restart 进入 playing');
    eq(WG.ui.ScreenFlow.current(), 'playing', '重置后界面 playing');
    eq(sel.current(), 'jianzong', '重置后重新应用剑宗');
    checkSectStats('jianzong');
  });

  /* ---------- 13) F3 叠层 / F4 快进 / F5 怪潮 ---------- */

  phase('F3 / F4 / F5', function () {
    if (!world || world.state !== 'playing') { return; }
    drainOffers();
    var perf = WG.perf;
    var cap = core.CONFIG.monsters.cap;

    fireKey('keydown', 'F3', 'F3');
    fireKey('keyup', 'F3', 'F3');
    eq(perf.overlay.enabled, true, 'F3 打开 perf overlay');
    runTicks(1, 17);
    eq(hudDebug.hidden, false, '#hud-debug 取消 hidden');
    var debugText = String(hudDebug.textContent || '');
    ok(debugText.length > 0, '#hud-debug 有内容', 'len=' + debugText.length);
    ok(debugText.indexOf('FPS') !== -1, '#hud-debug 含 FPS 字段');

    var ff = perf.fastForward(330);
    eq(ff, true, 'WG.perf.fastForward(330) 生效');
    eq(world.runTime, 330, 'fastForward 后 world.runTime=330');

    runTicks(12, 17);
    ok(world.director.targetAlive >= 200, 'Director 目标同屏数 ≥ 200',
      world.director.targetAlive);
    ok(world.director.targetAlive <= cap, 'Director 目标不超过硬上限 300',
      world.director.targetAlive);
    ok(world.monsters.count >= 200, '同屏怪物 ≥ 200', 'count=' + world.monsters.count);
    ok(world.monsters.count <= cap, '同屏怪物不超过 300', 'count=' + world.monsters.count);
    eq(WG.monsters.MonsterSystem.stats().cap, cap, 'MonsterSystem 容量 = 300');
    eq(perf.stats.entities.monsters, world.monsters.count,
      'WG.perf.stats 怪物计数与 MonsterSystem 一致');

    var burst = perf.spawnBurst(1000);
    ok(typeof burst === 'number' && isFinite(burst), 'spawnBurst 返回数值', burst);
    ok(world.monsters.count <= cap, 'spawnBurst(1000) 后仍不超过 300',
      'count=' + world.monsters.count);

    fireKey('keydown', 'F3', 'F3');
    fireKey('keyup', 'F3', 'F3');
    eq(perf.overlay.enabled, false, '再次 F3 关闭 perf overlay');
  });

  /* ---------- 14) AC-7：index.html + src/ui 静态禁词扫描 ---------- */

  phase('AC-7 静态扫描', function () {
    var forbidden = ['抽牌', '手牌', '牌组', '构筑', '三选一', '卡面'];

    function englishHits(text) {
      var hits = [];
      var reEn = /(card|deck|hand)/gi;
      var mm;
      while ((mm = reEn.exec(text)) !== null) {
        var word = mm[0].toLowerCase();
        var start = mm.index;
        var end = start + mm[0].length;
        var after = text.slice(end, end + 10).toLowerCase();
        if (word === 'hand') {
          // 排除 handler/handled/handles/handling/handoff/handshake 等非卡牌语义
          if (/^(ler|lers|led|les|ling|off|shake|book|y|held|made|craft)/.test(after)) {
            continue;
          }
        }
        var line = text.slice(0, start).split('\n').length;
        hits.push(word + '@line' + line);
      }
      return hits;
    }

    var files = ['index.html'];
    var uiDir = path.join(root, 'src', 'ui');
    var uiFiles = fs.readdirSync(uiDir).filter(function (f) { return /\.js$/.test(f); });
    for (var i = 0; i < uiFiles.length; i++) {
      files.push(path.join('src', 'ui', uiFiles[i]));
    }

    var hits = [];
    for (var f = 0; f < files.length; f++) {
      var text = fs.readFileSync(path.join(root, files[f]), 'utf8');
      for (var t = 0; t < forbidden.length; t++) {
        if (text.indexOf(forbidden[t]) !== -1) {
          hits.push(files[f] + ':' + forbidden[t]);
        }
      }
      var en = englishHits(text);
      for (var e = 0; e < en.length; e++) {
        hits.push(files[f] + ':' + en[e]);
      }
    }

    eq(uiFiles.length, 3, '扫描 src/ui 下全部 3 个脚本');
    ok(hits.length === 0, 'AC-7：index.html 与 src/ui 无卡牌禁词/命名', hits.join(', '));
  });

  /* ---------- 15) 错误检查 ---------- */

  phase('错误检查', function () {
    ok(consoleErrors.length === 0, '无 console.error（含 Loop 捕获的 update/render 异常）',
      consoleErrors.slice(0, 3).join(' | '));
    ok(uncaught.length === 0, '无未捕获异常', uncaught.length + ' 个');
  });

  if (core && core.Loop && typeof core.Loop.stop === 'function') {
    core.Loop.stop();
  }

  console.log('');
  if (productFailures.length) {
    console.log('产品缺陷候选（' + productFailures.length + ' 项，需运营转派属主）：');
    for (var p = 0; p < productFailures.length; p++) {
      console.log('  - ' + productFailures[p]);
    }
    console.log('');
  }
  console.log('integration-check: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    process.exitCode = 1;
  }
})();
