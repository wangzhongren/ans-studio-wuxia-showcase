/*!
 * 江湖夜雨 · monsters-waves · director.js
 * 契约：docs/contracts/wuxia-rogue-architecture-v1.md §4.4 / §5
 * 公开：WG.monsters.Director = { update(dt, runTime, playerLevel), targetAlive, spawnRate,
 *        spawnBurst(n), reset(world), difficulty() }
 *
 * 职责（proposal §5.4 / §6.3）：
 *   - 同屏目标数按时间线性插值：0s=30 → 60s=75 → 180s=110 → 300s=200 → 420s=280，硬上限 300；
 *   - 生成速率 = 目标缺口 × 1.2/s（下限 1.6 / 上限 12）；每 60 s 一次 8 s 小高潮（×2）；
 *   - 生成位置：玩家屏外 240~360 px 环带（委托 MonsterSystem.chooseRingPoint，避开视野/障碍）；
 *   - 难度：HP/伤害随 runTime 每分钟 +2%（含 level:up 加成，总 +40% 封顶）；
 *           移速每分钟 +2 px/s（+14 封顶）；level:up 另加少量倍率；
 *   - 精英：60 s 起每 60 s 一只刀客（同屏上限 6）；450 s 血刀宗师登场一次（可延后版本）。
 * 依赖：只读 WG.monsters.MonsterSystem 公开 API、WG.core.Bus / CONFIG / Camera / Rng。
 * 边界：只写 src/monsters/；不直接改玩家 HP；无卡牌。
 */
(function (root) {
  'use strict';

  if (!root) { return; }

  var WG = root.WG || (root.WG = {});
  var monsters = WG.monsters || (WG.monsters = {});

  function core() { return WG.core || null; }
  function cfg() {
    var c = core();
    return (c && c.CONFIG) || {};
  }
  function num(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }
  function busOn(type, fn) {
    var c = core();
    if (c && c.Bus && typeof c.Bus.on === 'function') {
      try { c.Bus.on(type, fn); return true; } catch (e) { return false; }
    }
    return false;
  }
  function system() {
    var ms = monsters.MonsterSystem;
    return (ms && typeof ms.spawn === 'function') ? ms : null;
  }

  /* 提案 §6.3 基线（CONFIG 缺失时兜底） */
  var FALLBACK_TARGETS = [
    [0, 30],
    [60, 75],
    [180, 110],
    [300, 200],
    [420, 280]
  ];

  function directorCfg() {
    var mc = cfg().monsters || {};
    var dc = cfg().director || {};
    var pools = cfg().pools || {};
    return {
      cap: Math.max(1, Math.floor(num(mc.cap, num(pools.monsters, 300)))),
      ringMin: num(mc.spawnRingMin, 240),
      ringMax: num(mc.spawnRingMax, 360),
      hpPerMin: num(mc.hpGrowthPerMin, 0.02),
      dmgPerMin: num(mc.damageGrowthPerMin, 0.02),
      growthCap: num(mc.growthCap, 0.4),
      speedPerMin: num(mc.speedGrowthPerMin, 2),
      speedCap: num(mc.speedGrowthCap, 14),
      eliteCap: Math.floor(num(mc.eliteCap, 6)),
      targets: Array.isArray(dc.targets) && dc.targets.length ? dc.targets : FALLBACK_TARGETS,
      spawnFactor: num(dc.spawnFactor, 1.2),
      spawnRateMin: num(dc.spawnRateMin, 1.6),
      spawnRateMax: num(dc.spawnRateMax, 12),
      climaxEvery: Math.max(1, num(dc.climaxEvery, 60)),
      climaxDuration: num(dc.climaxDuration, 8),
      climaxMultiplier: num(dc.climaxMultiplier, 2),
      eliteEvery: Math.max(1, num(dc.eliteEvery, 60)),
      bossTime: num((cfg().run || {}).bossTime, 450)
    };
  }

  /** 按 [秒, 目标数] 锚点线性插值；端点外取边界值 */
  function targetAt(time, points) {
    var t = Math.max(0, num(time, 0));
    if (!points || !points.length) { return 30; }
    if (t <= points[0][0]) { return points[0][1]; }
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1];
      var b = points[i];
      if (t <= b[0]) {
        var span = b[0] - a[0];
        if (span <= 0) { return b[1]; }
        var k = (t - a[0]) / span;
        return a[1] + (b[1] - a[1]) * k;
      }
    }
    return points[points.length - 1][1];
  }

  function resolveRng(world) {
    if (world && world.rng && typeof world.rng.next === 'function') { return world.rng; }
    var key = 'monstersDirectorRng';
    if (!resolveRng._rng) {
      var c = core();
      resolveRng._rng = (c && typeof c.Rng === 'function')
        ? c.Rng(0x1d872b41)
        : { next: Math.random, range: function (a, b) { return a + (b - a) * Math.random(); } };
    }
    return resolveRng._rng;
  }

  var state = {
    world: null,
    targetAlive: 30,
    spawnRate: 1.6,
    spawnAcc: 0,
    nextEliteAt: 60,
    eliteAlive: 0,
    climaxActive: false,
    bossSpawned: false,
    level: 1,
    levelBonus: 0,
    bound: false,
    lastSpawned: 0
  };

  function onLevelUp(payload) {
    var level = payload && num(payload.level, NaN);
    if (!isFinite(level) || level < 1) { level = state.level + 1; }
    state.level = level;
    // 每级 +1% HP/伤害（与时间成长合并后仍受 +40% 总封顶约束）
    state.levelBonus = Math.min(0.2, (level - 1) * 0.01);
  }

  function ensureBound() {
    if (state.bound) { return; }
    state.bound = true;
    busOn('level:up', onLevelUp);
  }

  function difficulty(level) {
    var conf = directorCfg();
    var t = (state.world && typeof state.world.runTime === 'number') ? state.world.runTime : 0;
    var lv = num(level, state.level);
    if (lv > state.level) {
      state.level = lv;
      state.levelBonus = Math.min(0.2, (lv - 1) * 0.01);
    }
    var minutes = Math.max(0, t) / 60;
    var timeHp = Math.min(conf.growthCap, minutes * conf.hpPerMin);
    var timeDmg = Math.min(conf.growthCap, minutes * conf.dmgPerMin);
    var levelBonus = state.levelBonus;
    var hpMul = 1 + Math.min(conf.growthCap, timeHp + levelBonus);
    var damageMul = 1 + Math.min(conf.growthCap, timeDmg + levelBonus);
    var speedBonus = Math.min(conf.speedCap, minutes * conf.speedPerMin + (lv - 1) * 0.3);
    return { hpMul: hpMul, damageMul: damageMul, speedBonus: speedBonus };
  }

  /**
   * 刷怪主循环（组合根每帧在 MonsterSystem.update 之后调用）。
   * @param {number} dt 固定步长
   * @param {number} runTime 对局秒数
   * @param {number} playerLevel 玩家等级（与 level:up 事件共同决定难度）
   */
  function update(dt, runTime, playerLevel) {
    ensureBound();
    var step = num(dt, 0);
    if (step <= 0) { return; }

    var ms = system();
    if (!ms) { return; }

    var conf = directorCfg();
    var t = Math.max(0, num(runTime, 0));
    var level = num(playerLevel, state.level);

    // 1) 同屏目标数
    var wanted = Math.min(conf.cap, targetAt(t, conf.targets));
    state.targetAlive = Math.round(wanted);

    // 2) 小高潮（每 60 s 触发一次，持续 8 s，速率 ×2）
    var cycle = Math.floor(t / conf.climaxEvery);
    var inCycle = t - cycle * conf.climaxEvery;
    state.climaxActive = cycle >= 1 && inCycle < conf.climaxDuration;

    // 3) 生成速率：目标缺口 × 1.2/s，限幅后再乘小高潮系数
    var alive = ms.count;
    var gap = Math.max(0, state.targetAlive - alive);
    var rate = gap * conf.spawnFactor;
    if (rate < conf.spawnRateMin) { rate = conf.spawnRateMin; }
    if (rate > conf.spawnRateMax) { rate = conf.spawnRateMax; }
    if (state.climaxActive) { rate *= conf.climaxMultiplier; }
    state.spawnRate = rate;

    // 4) 按速率补怪（低于目标且未到硬上限）
    var mods = difficulty(level);
    var world = state.world;
    if (alive < state.targetAlive && alive < conf.cap) {
      state.spawnAcc += rate * step;
      var guard = 0;
      while (state.spawnAcc >= 1 && guard < 12) {
        guard++;
        if (ms.count >= state.targetAlive || ms.count >= conf.cap) { break; }
        var pt = (typeof ms.chooseRingPoint === 'function') ? ms.chooseRingPoint(world) : null;
        if (!pt) { state.spawnAcc = Math.min(state.spawnAcc, 1); break; }
        var type = pickType(t, resolveRng(world));
        var spawned = ms.spawn(type, pt.x, pt.y, mods);
        if (!spawned) { break; }
        state.spawnAcc -= 1;
        state.lastSpawned++;
      }
      if (state.spawnAcc > 60) { state.spawnAcc = 60; }
    } else {
      // 已达标：不补怪，同时清掉积压，避免目标回落瞬间爆量
      state.spawnAcc = 0;
    }

    // 5) 精英（刀客）：60 s 起每 60 s 一只，同屏上限 6
    state.eliteAlive = countElites(ms);
    if (t >= state.nextEliteAt && t >= 60 && state.eliteAlive < conf.eliteCap) {
      var ept = (typeof ms.chooseRingPoint === 'function') ? ms.chooseRingPoint(world) : null;
      if (ept && ms.spawn('daoke', ept.x, ept.y, mods)) {
        state.nextEliteAt += conf.eliteEvery;
      }
    }

    // 6) 血刀宗师：450 s 登场一次（可选 Boss；不影响通关判定）
    if (!state.bossSpawned && t >= conf.bossTime) {
      var bpt = (typeof ms.chooseRingPoint === 'function') ? ms.chooseRingPoint(world) : null;
      if (bpt && ms.spawn('bloodmaster', bpt.x, bpt.y, mods)) {
        state.bossSpawned = true;
      }
    }
  }

  function pickType(t, rng) {
    if (t < 60) { return 'youxia'; }
    // 弓手占比随对局推进略增（25% → 45%）
    var archerChance = Math.min(0.45, 0.25 + (t - 60) / 1200);
    return (rng.next() < archerChance) ? 'archer' : 'youxia';
  }

  function countElites(ms) {
    var n = 0;
    if (!ms || !ms.pool || typeof ms.pool.forEach !== 'function') { return 0; }
    ms.pool.forEach(function (m) {
      if (m && m.alive && (m.type === 'daoke' || m.type === 'bloodmaster')) { n++; }
    });
    return n;
  }

  /** 调试用：委托 MonsterSystem 在屏外批量生成（供 WG.perf.spawnBurst / F5） */
  function spawnBurst(n, type) {
    var ms = system();
    if (!ms || typeof ms.spawnBurst !== 'function') { return 0; }
    return ms.spawnBurst(n, type);
  }

  function reset(world) {
    ensureBound();
    state.world = world || null;
    state.spawnAcc = 0;
    state.nextEliteAt = 60;
    state.eliteAlive = 0;
    state.climaxActive = false;
    state.bossSpawned = false;
    state.level = 1;
    state.levelBonus = 0;
    state.lastSpawned = 0;
    state.targetAlive = 30;
    state.spawnRate = directorCfg().spawnRateMin;
    resolveRng._rng = null;
  }

  var Director = {
    get targetAlive() { return state.targetAlive; },
    get spawnRate() { return state.spawnRate; },
    update: update,
    spawnBurst: spawnBurst,
    reset: reset,
    difficulty: difficulty,
    /** 只读调试快照 */
    stats: function () {
      return {
        targetAlive: state.targetAlive,
        spawnRate: state.spawnRate,
        eliteAlive: state.eliteAlive,
        climax: state.climaxActive,
        bossSpawned: state.bossSpawned,
        level: state.level,
        spawned: state.lastSpawned
      };
    }
  };

  monsters.Director = Director;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
