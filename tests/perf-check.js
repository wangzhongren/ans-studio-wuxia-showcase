/*!
 * 江湖夜雨 · perf-harness · tests/perf-check.js
 * 无头自检（Node）：不加载 DOM/画面，用桩验证 tests/perf.js 的公开契约。
 * 覆盖：stats 字段与实时性、对象计数形态（number/getter/count()）、
 *       spawnBurst 上限与未开局保护、fastForward 时间/补怪、F3/F4/F5 边沿、
 *       overlay 在 #hud-debug 上的安全构建与显隐。
 *
 * 运行：node tests/perf-check.js
 */
(function () {
  'use strict';

  if (typeof require !== 'function') {
    console.log('[perf-check] 仅支持 Node。');
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

  /* ---------- 桩：只提供 tests/perf.js 的公开依赖 ---------- */

  var keyHandlers = [];
  globalThis.addEventListener = function (type, fn) {
    if (type === 'keydown') { keyHandlers.push(fn); }
  };

  try {
    require(path.join(__dirname, '..', 'src', 'core', 'config.js'));
  } catch (err) {
    console.error('[perf-check] 缺少 src/core/config.js：' + err.message);
    process.exitCode = 1;
    return;
  }

  var WG = globalThis.WG = globalThis.WG || {};
  var core = WG.core;
  if (!core || !core.CONFIG) {
    console.error('[perf-check] WG.core.CONFIG 未导出。');
    process.exitCode = 1;
    return;
  }

  var world = {
    state: 'title',
    runTime: 0,
    remaining: core.CONFIG.run.duration,
    seed: 7,
    timescale: 1
  };

  core.Loop = {
    frameStats: {
      fps: 58.2,
      frameMs: 17.2,
      simMs: 1.8,
      renderMs: 3.2,
      steps: 1,
      p95Sim: 2.4,
      p95Render: 4.1,
      frames: 900,
      alpha: 0.4
    }
  };
  core.boot = function () { return world; };

  var burstCalls = [];

  var monsterSystem = {
    count: 12,
    spawnBurst: function (n) {
      burstCalls.push(n);
      monsterSystem.count += n;
      return n;
    }
  };

  WG.monsters = {
    MonsterSystem: monsterSystem,
    Director: {
      spawnBurst: function (n) { return monsterSystem.spawnBurst(n); }
    }
  };

  WG.loot = {
    LootSystem: {
      count: function () { return 3; }
    }
  };

  WG.fx = {
    particles: { count: 6 },
    numbers: { count: 2 },
    degrade: { enabled: false }
  };

  WG.combat = {
    /* 构造器形态（当前 main.js 直接赋值）；没有实例 → projectilePool 缺失 */
    CombatSystem: function CombatSystem() {},
    player: {
      hp: 90,
      maxHp: 100,
      stats: {
        level: 3,
        xp: 40,
        xpNext: 64,
        atk: 16,
        atkInterval: 0.51,
        pickupRadius: 34,
        magnetRadius: 84
      }
    }
  };

  /* ---------- 加载被测文件 ---------- */

  try {
    require(path.join(__dirname, 'perf.js'));
  } catch (err) {
    console.error('[perf-check] tests/perf.js 加载失败：' + err.message);
    process.exitCode = 1;
    return;
  }

  var perf = WG.perf;
  console.log('perf-check: tests/perf.js');

  ok(!!perf, 'WG.perf 已定义');
  ok(!!perf && !!perf.overlay, 'WG.perf.overlay 存在');
  ok(!!perf && typeof perf.fastForward === 'function', 'WG.perf.fastForward 是函数');
  ok(!!perf && typeof perf.spawnBurst === 'function', 'WG.perf.spawnBurst 是函数');
  ok(keyHandlers.length === 1, '注册了 1 个 window keydown 监听');

  /* ---------- stats ---------- */

  var s1 = perf.stats;
  eq(s1.fps, 58.2, 'stats.fps 来自 Loop.frameStats');
  eq(s1.p95Sim, 2.4, 'stats.p95Sim');
  eq(s1.p95Render, 4.1, 'stats.p95Render');
  eq(s1.entities.monsters, 12, 'entities.monsters（count getter）');
  eq(s1.entities.projectiles, 0, 'entities.projectiles（无实例时安全为 0）');
  eq(s1.entities.drops, 3, 'entities.drops（count() 方法）');
  eq(s1.entities.particles, 6, 'entities.particles（count getter）');
  eq(s1.entities.numbers, 2, 'entities.numbers（count getter）');
  eq(s1.degraded, false, 'stats.degraded 关闭');

  monsterSystem.count = 20;
  WG.fx.degrade.enabled = true;
  var s2 = perf.stats;
  eq(s2.entities.monsters, 20, 'stats 为实时视图（怪物数刷新）');
  eq(s2.degraded, true, 'stats 为实时视图（降级状态刷新）');
  ok(s2 === perf.stats, 'stats 返回稳定对象（原地更新，便于叠层复用）');

  /* ---------- spawnBurst ---------- */

  world.state = 'title';
  eq(perf.spawnBurst(5), 0, '非对局状态 spawnBurst 返回 0 且不生成');
  eq(burstCalls.length, 0, '非对局状态未调用模块接口');

  world.state = 'playing';
  eq(perf.spawnBurst(0), 0, 'spawnBurst(0) 返回 0');
  eq(perf.spawnBurst(7), 7, 'spawnBurst(7) 返回实际生成数');
  eq(monsterSystem.count, 27, '怪物计数累加');
  eq(burstCalls[burstCalls.length - 1], 7, '调用公开 Director.spawnBurst(7)');

  var beforeClamp = burstCalls.length;
  eq(perf.spawnBurst(9999), core.CONFIG.monsters.cap, 'spawnBurst 上限钳制到 CONFIG.monsters.cap');
  eq(burstCalls[beforeClamp], core.CONFIG.monsters.cap, '模块收到钳制后的数量');

  /* ---------- fastForward ---------- */

  world.runTime = 0;
  world.remaining = core.CONFIG.run.duration;
  monsterSystem.count = 12;
  burstCalls.length = 0;

  eq(perf.fastForward(330), true, 'fastForward(330) 生效');
  eq(world.runTime, 330, '对局时间推进到 330s（5:30）');
  eq(world.remaining, core.CONFIG.run.duration - 330, 'remaining 同步');
  eq(burstCalls.length, 1, '按导演目标补怪一次');
  eq(burstCalls[0], 208, '330s 目标约 220，缺口 208（12→220）');
  eq(monsterSystem.count, 220, '补怪后同屏 220');

  eq(perf.fastForward(9999), true, 'fastForward 超界仍返回 true');
  eq(world.runTime, core.CONFIG.run.duration, '时间钳制到单局时长 480');
  eq(world.remaining, 0, 'remaining 不为负');

  world.state = 'title';
  eq(perf.fastForward(330), false, '非对局状态 fastForward 返回 false');
  world.state = 'playing';

  /* ---------- F3 / F4 / F5 ---------- */

  var fakeDoc = (function makeDoc() {
    function makeEl(tag) {
      return {
        tagName: tag,
        className: '',
        textContent: '',
        hidden: false,
        children: [],
        appendChild: function (child) { this.children.push(child); }
      };
    }
    var container = makeEl('div');
    container.id = 'hud-debug';
    container.hidden = true;
    return {
      container: container,
      getElementById: function (id) { return id === 'hud-debug' ? container : null; },
      createElement: makeEl
    };
  })();

  globalThis.document = fakeDoc;

  function press(code, extra) {
    var ev = { code: code, preventDefault: function () {} };
    if (extra) {
      for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) { ev[k] = extra[k]; } }
    }
    for (var i = 0; i < keyHandlers.length; i++) { keyHandlers[i](ev); }
  }

  var container = fakeDoc.container;
  press('F3');
  eq(perf.overlay.enabled, true, 'F3 打开叠层');
  eq(container.hidden, false, 'F3 取消 #hud-debug 的 hidden');
  ok(container.children.length === 38, '#hud-debug 生成 19 行 × 2 列', 'children=' + container.children.length);

  var keys = [];
  var vals = [];
  for (var ci = 0; ci < container.children.length; ci++) {
    (ci % 2 === 0 ? keys : vals).push(container.children[ci].textContent);
  }
  eq(keys[0], 'FPS', '首行键名为 FPS');
  ok(vals.indexOf('Lv.3 40/64') >= 0, 'F3 显示等级/经验');
  ok(vals.indexOf('16.0 / 0.51s') >= 0, 'F3 显示攻击力/攻速（AC-5）');
  ok(vals.indexOf('34 / 84') >= 0, 'F3 显示拾取/磁吸半径（AC-5）');
  ok(vals.indexOf('90.0/100.0') >= 0, 'F3 显示 HP');

  press('F3', { repeat: true });
  eq(perf.overlay.enabled, true, 'e.repeat 不重复切换');

  world.runTime = 0;
  monsterSystem.count = 12;
  burstCalls.length = 0;
  press('F4');
  eq(world.runTime, 330, 'F4 快进到 330s');
  ok(burstCalls.length === 1, 'F4 触发一次目标补怪');

  burstCalls.length = 0;
  press('F5');
  eq(burstCalls.length, 1, 'F5 触发一次怪潮');
  eq(burstCalls[0], 120, 'F5 请求 120 只');

  press('F4', { ctrlKey: true });
  eq(world.runTime, 330, 'Ctrl+F4 不触发快进');

  press('F3');
  eq(perf.overlay.enabled, false, '再次 F3 关闭叠层');
  eq(container.hidden, true, '关闭时恢复 hidden');

  /* DOM 缺失时安全跳过 */
  fakeDoc.getElementById = function () { return null; };
  var threw = false;
  try {
    perf.overlay.show();
    perf.overlay.render();
  } catch (err) {
    threw = true;
  }
  ok(!threw, '缺少 #hud-debug 时 overlay 安全跳过（不抛错）');

  console.log('');
  console.log('perf-check: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) { process.exitCode = 1; }
})();
