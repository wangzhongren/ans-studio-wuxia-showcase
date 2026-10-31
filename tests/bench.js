/*!
 * 江湖夜雨 · perf-harness · tests/bench.js
 * Node 纯逻辑基准（无 DOM / 无渲染 / 无浏览器全局）：
 *   - 1000 帧固定步长 dt = 1/60 的模拟热路径采样（另加 120 帧预热）
 *   - 300 怪移动 + 空间哈希重建/查询 + 200 剑气 + 150 掉落 + 600 粒子 + 64 伤害数字 + 对象池周转
 *   - 输出 p50 / p95 / max / avg 与 CONFIG.perf.simP95Ms 对照
 *
 * 说明：这是 Node 下的 CPU 回归基线，不代表浏览器帧率；浏览器验收看 F3 叠层与 tests/bench.md。
 * 依赖：src/core/{config,rng,pool,spatial-hash,bus}.js；缺失时打印原因并以退出码 1 结束。
 */
(function () {
  'use strict';

  if (typeof require !== 'function' || typeof module === 'undefined') {
    console.log('[bench] 本文件是 Node 纯逻辑基准；浏览器请用 F3 叠层与 tests/bench.md 手工验收。');
    return;
  }

  var path = require('path');

  var CORE_FILES = ['config.js', 'rng.js', 'pool.js', 'spatial-hash.js', 'bus.js'];
  var loadErrors = [];
  for (var f = 0; f < CORE_FILES.length; f++) {
    var rel = path.join(__dirname, '..', 'src', 'core', CORE_FILES[f]);
    try {
      require(rel);
    } catch (err) {
      loadErrors.push(CORE_FILES[f] + ': ' + (err && err.message ? err.message : String(err)));
    }
  }

  var core = (typeof globalThis !== 'undefined' && globalThis.WG && globalThis.WG.core) || null;
  if (loadErrors.length || !core || !core.CONFIG || !core.Rng || !core.Pool || !core.SpatialHash) {
    console.error('[bench] 无法运行：核心脚本缺失或未导出 WG.core。');
    if (loadErrors.length) {
      for (var e = 0; e < loadErrors.length; e++) { console.error('  - ' + loadErrors[e]); }
    } else {
      console.error('  - 已加载文件但 globalThis.WG.core 不完整（需要 CONFIG/Rng/Pool/SpatialHash）。');
    }
    console.error('[bench] 请在项目根目录执行：node tests/bench.js');
    process.exitCode = 1;
    return;
  }

  var CONFIG = core.CONFIG;
  var DT = CONFIG.sim.dt;
  var FRAMES = 1000;
  var WARMUP = 120;
  var SEED = 20261031;

  var caps = CONFIG.pools;
  var MONSTERS = caps.monsters;
  var PROJECTILES = caps.projectiles;
  var DROPS = caps.drops;
  var PARTICLES = caps.particles;
  var NUMBERS = caps.damageNumbers;

  var rng = core.Rng(SEED);
  var hash = core.SpatialHash(CONFIG.spatialHash.cellSize);

  var worldW = CONFIG.world.width;
  var worldH = CONFIG.world.height;
  var player = {
    x: worldW * 0.5,
    y: worldH * 0.5,
    speed: CONFIG.player.speed,
    detectRadius: CONFIG.player.detectRadius
  };

  /* ---------- 对象池：工厂 + 复位（稳态不分配） ---------- */

  function makeMonster() {
    return {
      x: 0, y: 0, hp: 0, speed: 0, radius: 14,
      type: 'youxia', alive: false, t: 0
    };
  }

  function resetMonster(m) {
    var ang = rng.range(0, Math.PI * 2);
    var dist = rng.range(CONFIG.monsters.spawnRingMin, CONFIG.monsters.spawnRingMax);
    m.x = player.x + Math.cos(ang) * dist;
    m.y = player.y + Math.sin(ang) * dist;
    m.hp = CONFIG.monsters.types.youxia.hp;
    m.speed = CONFIG.monsters.types.youxia.speed + rng.range(-6, 6);
    m.radius = CONFIG.monsters.types.youxia.radius;
    m.type = 'youxia';
    m.alive = true;
    m.t = 0;
    return m;
  }

  function makeProjectile() {
    return { x: 0, y: 0, vx: 0, vy: 0, life: 0, radius: 8, active: false };
  }

  function resetProjectile(p) {
    var ang = rng.range(0, Math.PI * 2);
    p.x = player.x + Math.cos(ang) * 12;
    p.y = player.y + Math.sin(ang) * 12;
    p.vx = Math.cos(ang) * CONFIG.player.projectile.speed;
    p.vy = Math.sin(ang) * CONFIG.player.projectile.speed;
    p.life = CONFIG.player.projectile.range / CONFIG.player.projectile.speed;
    p.radius = CONFIG.player.projectile.radius;
    p.active = true;
    return p;
  }

  function makeDrop() {
    return { x: 0, y: 0, vx: 0, vy: 0, life: 0, active: false };
  }

  function resetDrop(d) {
    var ang = rng.range(0, Math.PI * 2);
    var dist = rng.range(20, 320);
    d.x = player.x + Math.cos(ang) * dist;
    d.y = player.y + Math.sin(ang) * dist;
    d.vx = rng.range(-30, 30);
    d.vy = rng.range(-30, 30);
    d.life = 12;
    d.active = true;
    return d;
  }

  function makeParticle() {
    return { x: 0, y: 0, vx: 0, vy: 0, life: 0, active: false };
  }

  function resetParticle(p) {
    p.x = player.x + rng.range(-64, 64);
    p.y = player.y + rng.range(-64, 64);
    p.vx = rng.range(-120, 120);
    p.vy = rng.range(-120, 120);
    p.life = rng.range(0.2, 0.8);
    p.active = true;
    return p;
  }

  function makeNumber() {
    return { x: 0, y: 0, vy: 0, life: 0, active: false };
  }

  function resetNumber(n) {
    n.x = player.x + rng.range(-40, 40);
    n.y = player.y + rng.range(-40, 40);
    n.vy = -40;
    n.life = 0.6;
    n.active = true;
    return n;
  }

  var monsterPool = core.Pool(MONSTERS, makeMonster, resetMonster);
  var projectilePool = core.Pool(PROJECTILES, makeProjectile, resetProjectile);
  var dropPool = core.Pool(DROPS, makeDrop, resetDrop);
  var particlePool = core.Pool(PARTICLES, makeParticle, resetParticle);
  var numberPool = core.Pool(NUMBERS, makeNumber, resetNumber);

  /* Pool 首次 spawn 走工厂，未必执行 reset；显式铺满并初始化，保证基线满载 */
  for (var mi = 0; mi < MONSTERS; mi++) { monsterPool.spawn(); }
  for (var pi = 0; pi < PROJECTILES; pi++) { projectilePool.spawn(); }
  for (var di = 0; di < DROPS; di++) { dropPool.spawn(); }
  for (var pai = 0; pai < PARTICLES; pai++) { particlePool.spawn(); }
  for (var ni = 0; ni < NUMBERS; ni++) { numberPool.spawn(); }

  monsterPool.forEach(resetMonster);
  projectilePool.forEach(resetProjectile);
  dropPool.forEach(resetDrop);
  particlePool.forEach(resetParticle);
  numberPool.forEach(resetNumber);

  /* 事件总线：每帧少量事件，验证监听分发开销 */
  var bus = core.Bus;
  var busHits = 0;
  bus.on('bench:tick', function () { busHits++; });

  /* ---------- 单帧模拟（全部使用池内对象，不新建对象） ---------- */

  var queryOut = [];
  var MONSTER_QUERY_R2 = 48 * 48;
  var PROJECTILE_QUERY_R2 = 12 * 12;

  function step() {
    var i, list;

    /* 刷怪导演的稳态周转：满池时环形复用最旧槽位（只 reset，不分配） */
    monsterPool.spawn();
    monsterPool.spawn();
    projectilePool.spawn();
    dropPool.spawn();
    for (i = 0; i < 10; i++) { particlePool.spawn(); }
    numberPool.spawn();

    /* 重建空间哈希（300 怪 + 150 掉落） */
    hash.clear();
    monsterPool.forEach(function (m) { hash.insert(m); });
    dropPool.forEach(function (d) { hash.insert(d); });

    /* 怪物 AI：朝玩家移动 + 邻居分离（每个怪一次哈希查询） */
    monsterPool.forEach(function (m) {
      var dx = player.x - m.x;
      var dy = player.y - m.y;
      var d2 = dx * dx + dy * dy;
      if (d2 > 1) {
        var inv = 1 / Math.sqrt(d2);
        m.x += dx * inv * m.speed * DT;
        m.y += dy * inv * m.speed * DT;
      }
      m.t += DT;

      hash.queryCircle(m.x, m.y, 24, queryOut);
      var maxPush = Math.min(queryOut.length, 4);
      for (var k = 0; k < maxPush; k++) {
        var o = queryOut[k];
        if (o === m || o.active === false) { continue; }
        var ox = m.x - o.x;
        var oy = m.y - o.y;
        var od2 = ox * ox + oy * oy;
        if (od2 > 0 && od2 < MONSTER_QUERY_R2) {
          var push = (24 - Math.sqrt(od2)) * 0.02;
          m.x -= ox * push;
          m.y -= oy * push;
        }
      }
    });

    /* 剑气：移动 + 生命周期 + 命中查询 */
    projectilePool.forEach(function (p) {
      if (p.active === false) { return; }
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      p.life -= DT;
      if (p.life <= 0 || p.x < -64 || p.y < -64 || p.x > worldW + 64 || p.y > worldH + 64) {
        p.active = false;
        return;
      }
      hash.queryCircle(p.x, p.y, 12, queryOut);
      for (var k = 0; k < queryOut.length; k++) {
        var target = queryOut[k];
        if (target.active === false) { continue; }
        var hx = target.x - p.x;
        var hy = target.y - p.y;
        if (hx * hx + hy * hy < PROJECTILE_QUERY_R2) { break; }
      }
    });

    /* 掉落：磁吸 → 玩家 */
    dropPool.forEach(function (d) {
      if (d.active === false) { return; }
      var dx = player.x - d.x;
      var dy = player.y - d.y;
      var d2 = dx * dx + dy * dy;
      if (d2 < CONFIG.player.magnetRadius * CONFIG.player.magnetRadius && d2 > 1) {
        var inv = 1 / Math.sqrt(d2);
        d.x += dx * inv * CONFIG.player.magnetSpeed * DT;
        d.y += dy * inv * CONFIG.player.magnetSpeed * DT;
      }
      d.life -= DT;
      if (d.life <= 0) { d.active = false; }
    });

    /* 粒子 */
    particlePool.forEach(function (p) {
      if (p.active === false) { return; }
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= DT;
      if (p.life <= 0) { p.active = false; }
    });

    /* 伤害数字 */
    numberPool.forEach(function (n) {
      if (n.active === false) { return; }
      n.y += n.vy * DT;
      n.life -= DT;
      if (n.life <= 0) { n.active = false; }
    });

    /* 事件 + RNG 热路径 */
    bus.emit('bench:tick', DT);
    for (i = 0; i < 40; i++) { rng.next(); }
  }

  /* ---------- 计时 ---------- */

  var now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  for (var w = 0; w < WARMUP; w++) { step(); }

  var samples = new Float64Array(FRAMES);
  var total = 0;
  var overallStart = now();
  for (var frame = 0; frame < FRAMES; frame++) {
    var t0 = now();
    step();
    var elapsed = now() - t0;
    samples[frame] = elapsed;
    total += elapsed;
  }
  var wall = now() - overallStart;

  var sorted = Array.prototype.slice.call(samples).sort(function (a, b) { return a - b; });
  function percentile(p) {
    var idx = Math.ceil(p * sorted.length) - 1;
    if (idx < 0) { idx = 0; }
    if (idx >= sorted.length) { idx = sorted.length - 1; }
    return sorted[idx];
  }

  var p50 = percentile(0.5);
  var p95 = percentile(0.95);
  var p99 = percentile(0.99);
  var max = sorted[sorted.length - 1];
  var avg = total / FRAMES;
  var budget = CONFIG.perf.simP95Ms;

  function ms(v) {
    return (Math.round(v * 1000) / 1000).toFixed(3) + ' ms';
  }

  console.log('');
  console.log('江湖夜雨 · core bench（Node 纯逻辑，无 DOM）');
  console.log('seed=' + SEED + '  frames=' + FRAMES + '  warmup=' + WARMUP + '  dt=1/60');
  console.log('entities: monsters=' + MONSTERS
    + ' projectiles=' + PROJECTILES
    + ' drops=' + DROPS
    + ' particles=' + PARTICLES
    + ' numbers=' + NUMBERS
    + ' (pool caps)');
  console.log('sim/frame: p50=' + ms(p50)
    + '  p95=' + ms(p95)
    + '  p99=' + ms(p99)
    + '  max=' + ms(max)
    + '  avg=' + ms(avg));
  console.log('total=' + ms(wall) + '  busHits=' + busHits);
  console.log('budget: CONFIG.perf.simP95Ms=' + budget + ' ms → '
    + (p95 <= budget ? 'PASS' : 'OVER BUDGET')
    + '（仅 Node 回归基线，不代表浏览器帧率）');
  console.log('');
})();
