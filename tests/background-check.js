/*!
 * 江湖夜雨 · tests/background-check.js
 * 无头回归：验证 core/main.js 的
 *   1) canvas 后备尺寸 = CONFIG.viewport(1280×720)，Camera.w/h 同步；
 *   2) renderFrame 在 Camera.apply 之后绘制世界底色/瓦片/网格/边界；
 *   3) 背景绘制 save/restore 配平，且不修改任何对局状态。
 * 运行：node tests/background-check.js
 */
(function () {
  'use strict';

  if (typeof require !== 'function') {
    console.log('[background-check] 仅支持 Node。');
    return;
  }

  var path = require('path');
  var passed = 0;
  var failed = 0;

  function ok(cond, label, extra) {
    if (cond) {
      passed++;
      console.log('  ✓ ' + label);
    } else {
      failed++;
      console.log('  ✗ ' + label + (extra ? '  → ' + extra : ''));
    }
  }

  function eq(actual, expected, label) {
    ok(actual === expected, label, 'got ' + actual + ', want ' + expected);
  }

  /* ---------- 假 DOM / Canvas 2D ---------- */

  var callLog = [];
  var seq = 0;
  var ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    setTransform: function () { callLog.push({ op: 'setTransform', seq: seq++ }); },
    clearRect: function (x, y, w, h) {
      callLog.push({ op: 'clearRect', x: x, y: y, w: w, h: h, seq: seq++ });
    },
    save: function () { callLog.push({ op: 'save', seq: seq++ }); },
    restore: function () { callLog.push({ op: 'restore', seq: seq++ }); },
    translate: function (x, y) { callLog.push({ op: 'translate', x: x, y: y, seq: seq++ }); },
    fillRect: function (x, y, w, h) {
      callLog.push({
        op: 'fillRect', x: x, y: y, w: w, h: h,
        fillStyle: this.fillStyle, alpha: this.globalAlpha, seq: seq++
      });
    },
    beginPath: function () { callLog.push({ op: 'beginPath', seq: seq++ }); },
    moveTo: function (x, y) { callLog.push({ op: 'moveTo', x: x, y: y, seq: seq++ }); },
    lineTo: function (x, y) { callLog.push({ op: 'lineTo', x: x, y: y, seq: seq++ }); },
    stroke: function () {
      callLog.push({
        op: 'stroke', strokeStyle: this.strokeStyle,
        lineWidth: this.lineWidth, alpha: this.globalAlpha, seq: seq++
      });
    },
    strokeRect: function (x, y, w, h) {
      callLog.push({
        op: 'strokeRect', x: x, y: y, w: w, h: h,
        strokeStyle: this.strokeStyle, lineWidth: this.lineWidth,
        alpha: this.globalAlpha, seq: seq++
      });
    }
  };

  var canvas = {
    width: 300,
    height: 150,
    getContext: function (kind) {
      ok(kind === '2d', 'canvas.getContext("2d") 被调用');
      return ctx;
    }
  };

  globalThis.document = {
    readyState: 'complete',
    documentElement: {},
    getElementById: function (id) { return id === 'game' ? canvas : null; },
    addEventListener: function () {}
  };

  var cssMap = {
    '--color-night-800': 'rgb(1, 2, 3)',
    '--color-night-700': 'rgb(4, 5, 6)',
    '--color-mist-400': 'rgb(7, 8, 9)',
    '--color-mist-300': 'rgb(10, 11, 12)',
    '--color-gold-400': 'rgb(13, 14, 15)',
    '--color-ink-500': 'rgb(16, 17, 18)'
  };
  globalThis.getComputedStyle = function () {
    return {
      getPropertyValue: function (name) { return cssMap[name] || ''; }
    };
  };

  globalThis.addEventListener = function () {};
  var rafCb = null;
  globalThis.requestAnimationFrame = function (cb) { rafCb = cb; return 1; };
  globalThis.cancelAnimationFrame = function () {};

  /* ---------- 按 core 加载顺序执行（main 在 document 就绪时自动 boot） ---------- */

  var root = path.join(__dirname, '..');
  var files = ['config.js', 'rng.js', 'pool.js', 'spatial-hash.js', 'input.js', 'camera.js', 'bus.js', 'loop.js', 'main.js'];
  try {
    for (var i = 0; i < files.length; i++) {
      require(path.join(root, 'src', 'core', files[i]));
    }
  } catch (err) {
    console.error('[background-check] 加载失败：' + err.message);
    process.exitCode = 1;
    return;
  }

  var WG = globalThis.WG;
  var core = WG.core;
  console.log('background-check: core/main.js canvas + world background');

  eq(canvas.width, 1280, 'canvas.width = CONFIG.viewport.width');
  eq(canvas.height, 720, 'canvas.height = CONFIG.viewport.height');
  eq(core.Camera.w, 1280, 'Camera.w 同步 1280');
  eq(core.Camera.h, 720, 'Camera.h 同步 720');

  var world = core.boot();
  eq(world.state, 'title', 'boot 后为 title 状态');
  var stateBefore = world.state;
  var runBefore = world.runTime;
  var killsBefore = world.kills;

  ok(typeof rafCb === 'function', 'Loop.start 注册了首帧回调');
  if (typeof rafCb === 'function') {
    var firstFrame = rafCb;
    firstFrame(16);
  }

  var clear = null;
  var translate = null;
  var baseFill = null;
  var tileFill = null;
  var strokeRects = [];
  var strokes = [];
  var saves = 0;
  var restores = 0;

  for (var c = 0; c < callLog.length; c++) {
    var item = callLog[c];
    if (item.op === 'clearRect' && !clear) clear = item;
    if (item.op === 'translate' && !translate) translate = item;
    if (item.op === 'fillRect' && !baseFill) baseFill = item;
    if (item.op === 'fillRect' && item.alpha === 0.5 && !tileFill) tileFill = item;
    if (item.op === 'strokeRect') strokeRects.push(item);
    if (item.op === 'stroke') strokes.push(item);
    if (item.op === 'save') saves++;
    if (item.op === 'restore') restores++;
  }

  eq(clear && clear.w, 1280, 'clearRect 使用 1280 宽度');
  eq(clear && clear.h, 720, 'clearRect 使用 720 高度');

  ok(!!translate, 'Camera.apply 执行了 translate');
  ok(!!baseFill, '绘制了世界底色');
  ok(!!tileFill, '绘制了棋盘瓦片（半透明 tile）');
  ok(translate && baseFill && translate.seq < baseFill.seq,
    '背景在 Camera.apply 之后绘制（translate 先于底色）');

  if (baseFill) {
    eq(baseFill.fillStyle, 'rgb(1, 2, 3)', '底色复用 CSS --color-night-800');
    eq(baseFill.x, 1280, '可见区域 left = 相机 x（世界居中）');
    eq(baseFill.y, 720, '可见区域 top = 相机 y');
    eq(baseFill.w, 1280, '仅绘制视口宽度');
    eq(baseFill.h, 720, '仅绘制视口高度');
  }
  if (tileFill) {
    eq(tileFill.fillStyle, 'rgb(4, 5, 6)', '瓦片复用 CSS --color-night-700');
  }

  ok(strokes.length >= 2, '细/粗网格各一次 stroke', 'strokes=' + strokes.length);
  ok(strokeRects.length >= 2, '外沿暗线 + margin 鎏金边界', 'strokeRect=' + strokeRects.length);
  if (strokeRects.length >= 2) {
    eq(strokeRects[0].strokeStyle, 'rgb(16, 17, 18)', '外沿使用 --color-ink-500');
    eq(strokeRects[1].strokeStyle, 'rgb(13, 14, 15)', '可玩边界使用 --color-gold-400');
    eq(strokeRects[1].x, core.CONFIG.world.margin + 0.5, '边界位于 world.margin');
  }

  eq(saves, restores, 'ctx.save/restore 配平', 'save=' + saves + ', restore=' + restores);
  eq(world.state, stateBefore, '背景绘制不改变 world.state');
  eq(world.runTime, runBefore, '背景绘制不改变 runTime');
  eq(world.kills, killsBefore, '背景绘制不改变 kills');

  /* ---------- 相机移动：地面/网格随世界坐标滚动 ---------- */

  var firstFrameLen = callLog.length;
  core.Camera.x = 1400; // 模拟玩家移动后的相机位置（标题态不会被 update 覆盖）
  ok(typeof rafCb === 'function', '第二帧回调仍已注册');
  if (typeof rafCb === 'function') { rafCb(32); }

  var secondBase = null;
  for (var c2 = firstFrameLen; c2 < callLog.length; c2++) {
    var item2 = callLog[c2];
    if (item2.op === 'fillRect' && item2.alpha === 1) { secondBase = item2; break; }
  }
  ok(!!secondBase, '相机移动后仍绘制世界底色');
  if (secondBase) {
    eq(secondBase.x, 1400, '底色 left 跟随 Camera.x（地图滚动参照）');
  }

  core.Loop.stop();

  console.log('');
  console.log('background-check: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) { process.exitCode = 1; }
})();
