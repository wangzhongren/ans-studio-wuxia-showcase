/*!
 * 江湖夜雨 · perf-harness · tests/perf-integration-check.js
 * 无头集成自检：用**真实** core + monsters 模块（types/ai/director）验证
 * WG.perf.spawnBurst / fastForward 确实通过公开接口在屏外生成怪，而不是只靠桩。
 *
 * 运行：node tests/perf-integration-check.js
 */
(function () {
  'use strict';

  if (typeof require !== 'function') {
    console.log('[perf-integration-check] 仅支持 Node。');
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

  function load(rel) {
    require(path.join(__dirname, '..', rel));
  }

  try {
    load('src/core/config.js');
    load('src/core/rng.js');
    load('src/core/pool.js');
    load('src/core/spatial-hash.js');
    load('src/core/bus.js');
    load('src/monsters/types.js');
    load('src/monsters/ai.js');
    load('src/monsters/director.js');
  } catch (err) {
    console.error('[perf-integration-check] 模块加载失败：' + err.message);
    process.exitCode = 1;
    return;
  }

  var WG = globalThis.WG;
  var core = WG.core;
  var monsters = WG.monsters;

  if (!core || !core.CONFIG) {
    console.error('[perf-integration-check] WG.core.CONFIG 未导出。');
    process.exitCode = 1;
    return;
  }

  if (!monsters || !monsters.MonsterSystem || !monsters.Director || !monsters.types) {
    console.error('[perf-integration-check] monsters 模块不完整。');
    process.exitCode = 1;
    return;
  }

  var CONFIG = core.CONFIG;
  var world = {
    width: CONFIG.world.width,
    height: CONFIG.world.height,
    state: 'playing',
    runTime: 0,
    remaining: CONFIG.run.duration,
    seed: 7,
    timescale: 1,
    rng: core.Rng(7),
    player: {
      x: CONFIG.world.width / 2,
      y: CONFIG.world.height / 2,
      r: CONFIG.player.radius,
      radius: CONFIG.player.radius,
      hp: CONFIG.player.maxHp,
      maxHp: CONFIG.player.maxHp,
      dead: false,
      stats: {
        level: 1,
        xp: 0,
        xpNext: CONFIG.progression.xpBase,
        atk: CONFIG.player.atk,
        atkInterval: CONFIG.player.atkInterval,
        pickupRadius: CONFIG.player.pickupRadius,
        magnetRadius: CONFIG.player.magnetRadius
      }
    }
  };

  core.boot = function () { return world; };
  core.Loop = {
    frameStats: {
      fps: 60, frameMs: 16.6, simMs: 1.2, renderMs: 2.4,
      steps: 1, p95Sim: 1.8, p95Render: 3.0, frames: 60, alpha: 0
    }
  };

  /* perf.js 所需的只读计数桩（真实玩法层由其他属主负责） */
  WG.loot = { LootSystem: { count: function () { return 0; } } };
  WG.fx = {
    particles: { count: 0 },
    numbers: { count: 0 },
    degrade: { enabled: false }
  };
  WG.combat = { player: world.player }; // 无 CombatSystem 实例 → projectiles 安全为 0

  monsters.MonsterSystem.reset(world);
  monsters.Director.reset(world);

  try {
    load('tests/perf.js');
  } catch (err) {
    console.error('[perf-integration-check] tests/perf.js 加载失败：' + err.message);
    process.exitCode = 1;
    return;
  }

  var perf = WG.perf;
  var system = monsters.MonsterSystem;

  console.log('perf-integration-check: 真实 monsters + WG.perf');

  eq(system.count, 0, '初始怪物为 0');
  eq(perf.stats.entities.monsters, 0, 'perf.stats 读取真实 MonsterSystem.count');

  /* F5 等价调用：120 只屏外怪 */
  var spawned = perf.spawnBurst(120);
  eq(spawned, 120, 'spawnBurst(120) 用真实 Manager/Director 生成 120 只');
  eq(system.count, 120, 'MonsterSystem.count 变为 120');
  eq(perf.stats.entities.monsters, 120, 'perf.stats 同步为 120');

  /* 真实怪物位置：应位于玩家视口外 240~360 px 环带附近 */
  var outside = 0;
  system.pool.forEach(function (m) {
    var vx = world.player.x - CONFIG.viewport.width / 2;
    var vy = world.player.y - CONFIG.viewport.height / 2;
    var dx = Math.max(vx - m.x, 0, m.x - (vx + CONFIG.viewport.width));
    var dy = Math.max(vy - m.y, 0, m.y - (vy + CONFIG.viewport.height));
    if (Math.sqrt(dx * dx + dy * dy) >= CONFIG.monsters.spawnRingMin - 2) { outside++; }
  });
  eq(outside, 120, '120 只全部在视口外（≥ spawnRingMin-2）');

  /* F4 等价调用：330s，目标 ~220，从 120 补到 220（真实 chooseRingPoint） */
  var before = system.count;
  eq(perf.fastForward(330), true, 'fastForward(330) 生效');
  eq(world.runTime, 330, 'world.runTime === 330');
  eq(world.remaining, CONFIG.run.duration - 330, 'world.remaining === 150');
  ok(system.count >= 200 && system.count <= 220,
    '补怪后同屏进入 200~220（目标 220）', 'count=' + system.count + ', before=' + before);
  ok(system.count > before, 'fastForward 确实增加了真实怪物');

  /* 接近硬上限：再请求 120，只能补到 300 */
  var remainingRoom = CONFIG.monsters.cap - system.count;
  var extra = perf.spawnBurst(120);
  eq(system.count, CONFIG.monsters.cap, '第二次 spawnBurst 达到 300 硬上限');
  eq(extra, remainingRoom, '实际生成数受硬上限约束');

  var threw = false;
  try {
    monsters.MonsterSystem.update(1 / 60, world);
    monsters.Director.update(1 / 60, world.runTime, 1);
  } catch (err) {
    threw = true;
    console.error('    update 抛错：' + err.message);
  }
  ok(!threw, '300 怪下 MonsterSystem/Director.update 不抛错');
  eq(perf.stats.entities.monsters, 300, 'perf.stats 最终读数为 300');
  eq(perf.stats.entities.projectiles, 0, '无 CombatSystem 实例时剑气计数安全为 0');

  console.log('');
  console.log('perf-integration-check: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) { process.exitCode = 1; }
})();
