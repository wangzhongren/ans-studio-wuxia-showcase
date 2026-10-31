/*!
 * 江湖夜雨 · visual-fx · particles.js
 * 契约：docs/contracts/wuxia-rogue-v2-architecture-v1.md §4.6 / §5.3 / §8
 * 公开：WG.fx.particles → { burst(x,y,color,n), update(dt), render(ctx,alpha), count, cap, reset() }
 *
 * 职责：
 *  - 固定容量对象池（上限 CONFIG.pools.particles = 600），启动时一次性预分配；
 *    满时环形复用最旧槽位，绝不逐帧新建对象。
 *  - 只读订阅：monster:killed（死亡血雾/碎屑）、level:up（升级金环）、
 *    ability:unlock（解锁提示粒子）、loot:picked（拾取微光）。
 *  - 降级（WG.fx.degrade.enabled）开启时停止生成粒子（血雾粒子关闭），
 *    由 screen-fx 的 FPS<50 持续 2s 自动开启。
 *  - 表现层只读：不修改玩法状态、不发玩法事件；坐标绘制在世界空间（相机变换已由 main 施加）。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var fx = WG.fx = WG.fx || {};

  var CONFIG = (WG.core && WG.core.CONFIG) || {};
  var FX_CFG = CONFIG.fx || {};
  var POOL_CFG = CONFIG.pools || {};

  var CAP = Math.max(1, Math.floor(POOL_CFG.particles || 600));
  var BLOOD_COUNT = Math.max(1, Math.floor(FX_CFG.bloodParticles || 6));
  var CULL = Math.max(0, FX_CFG.cullMargin || 96);

  var COLORS = {
    blood: '#b8453c',
    bloodDark: '#7d2a24',
    bloodBright: '#e46b5e',
    gold: '#e8c37a',
    goldBright: '#f5d99c',
    jade: '#4fd1a5',
    jadeBright: '#7de3c0',
    sword: '#bfe9ff',
    silver: '#c9d4dc',
    paper: '#f6f2e8'
  };

  /* ------------------------------------------------------------------ *
   * 固定容量池（预分配；环形复用最旧）
   * ------------------------------------------------------------------ */
  var items = new Array(CAP);
  var head = 0;
  var live = 0;
  var clock = 0;

  function makeParticle() {
    return {
      alive: false,
      x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 1,
      size: 2, color: '#ffffff', alpha0: 1,
      gravity: 0, drag: 0
    };
  }

  for (var i = 0; i < CAP; i++) {
    items[i] = makeParticle();
  }

  function slot() {
    var p = items[head];
    head = (head + 1) % CAP;
    if (!p.alive) { live++; }
    p.alive = true;
    return p;
  }

  /** 生成单颗粒子（内部；调用方保证容量/降级已判断） */
  function emit(x, y, vx, vy, life, size, color, alpha0, gravity, drag) {
    var p = slot();
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.maxLife = life > 0 ? life : 0.3;
    p.life = p.maxLife;
    p.size = size > 0 ? size : 2;
    p.color = color;
    p.alpha0 = alpha0 > 0 ? alpha0 : 1;
    p.gravity = gravity || 0;
    p.drag = drag || 0;
    return p;
  }

  /* ------------------------------------------------------------------ *
   * 只读协作：降级状态 / 玩家位置 / 相机范围
   * ------------------------------------------------------------------ */
  function degraded() {
    var d = fx.degrade;
    return !!(d && d.enabled);
  }

  var POS = { x: 0, y: 0 };

  /** 只读玩家位置（WG.combat.player 公开单例）；缺失时退回相机中心。 */
  function playerPos() {
    var combat = WG.combat;
    var player = combat && combat.player;
    if (player && typeof player.x === 'number' && typeof player.y === 'number') {
      POS.x = player.x;
      POS.y = player.y;
      return POS;
    }
    var cam = WG.core && WG.core.Camera;
    if (cam && typeof cam.x === 'number' && typeof cam.y === 'number') {
      POS.x = cam.x + cam.w * 0.5;
      POS.y = cam.y + cam.h * 0.5;
    } else {
      POS.x = CONFIG.world ? CONFIG.world.width * 0.5 : 0;
      POS.y = CONFIG.world ? CONFIG.world.height * 0.5 : 0;
    }
    return POS;
  }

  /* ------------------------------------------------------------------ *
   * 公开：burst(x,y,color,n)
   * ------------------------------------------------------------------ */
  function burst(x, y, color, n) {
    if (degraded()) { return 0; }
    var px = num(x, 0);
    var py = num(y, 0);
    var count = Math.floor(num(n, 8));
    if (count < 1) { count = 1; }
    if (count > 48) { count = 48; }

    var tint = typeof color === 'string' && color ? color : COLORS.gold;
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 40 + Math.random() * 150;
      var life = 0.3 + Math.random() * 0.35;
      var size = 1.5 + Math.random() * 2.5;
      emit(
        px, py,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        life, size, tint,
        0.55 + Math.random() * 0.45,
        210, 2.2
      );
    }
    return count;
  }

  /* ------------------------------------------------------------------ *
   * 事件表现（只读订阅）
   * ------------------------------------------------------------------ */
  function typeColor(type) {
    switch (type) {
      case 'boss': return COLORS.gold;
      case 'daoke':
      case 'blade':
      case 'bladeMaster':
      case 'bloodmaster': return COLORS.bloodDark;
      case 'archer': return COLORS.sword;
      default: return COLORS.blood;
    }
  }

  function isEliteType(type) {
    return type === 'boss' || type === 'daoke' || type === 'blade' ||
      type === 'bladeMaster' || type === 'bloodmaster' || type === 'elite';
  }

  /** monster:killed → 血雾 + 碎屑（降级时不生成）。 */
  function onMonsterKilled(payload) {
    if (!payload || degraded()) { return; }
    var x = num(payload.x, NaN);
    var y = num(payload.y, NaN);
    if (!isFinite(x) || !isFinite(y)) { return; }

    var type = payload.type || '';
    var elite = isEliteType(type);
    var bloodN = type === 'boss' ? BLOOD_COUNT * 2 : BLOOD_COUNT;

    // 血雾：低透明度、向外扩散、缓慢上浮后下坠
    for (var b = 0; b < bloodN; b++) {
      var ba = Math.random() * Math.PI * 2;
      var bs = 18 + Math.random() * 90;
      emit(
        x + (Math.random() - 0.5) * 6,
        y + (Math.random() - 0.5) * 6,
        Math.cos(ba) * bs,
        Math.sin(ba) * bs - 20,
        0.32 + Math.random() * 0.38,
        2 + Math.random() * 4,
        Math.random() < 0.35 ? COLORS.bloodBright : COLORS.blood,
        0.35 + Math.random() * 0.3,
        150, 2.6
      );
    }

    // 碎屑：类型色，快速外抛
    var shards = elite ? 7 : 3;
    var tint = typeColor(type);
    for (var s = 0; s < shards; s++) {
      var sa = Math.random() * Math.PI * 2;
      var ss = 90 + Math.random() * 170;
      emit(
        x, y,
        Math.cos(sa) * ss,
        Math.sin(sa) * ss,
        0.2 + Math.random() * 0.28,
        1.2 + Math.random() * 2,
        tint,
        0.9,
        320, 1.6
      );
    }
  }

  /** level:up → 玩家脚下金/玉两色环状提示粒子。 */
  function onLevelUp(payload) {
    if (degraded()) { return; }
    var pos = playerPos();
    var ring = 18;
    for (var i = 0; i < ring; i++) {
      var a = (i / ring) * Math.PI * 2;
      var speed = 80 + Math.random() * 60;
      emit(
        pos.x, pos.y,
        Math.cos(a) * speed,
        Math.sin(a) * speed - 30,
        0.5 + Math.random() * 0.35,
        1.8 + Math.random() * 1.8,
        (i % 3 === 0) ? COLORS.jadeBright : COLORS.goldBright,
        0.9,
        -40, 2.0
      );
    }
    // 少量上浮微光（不看 payload.level，只作提示）
    for (var k = 0; k < 4; k++) {
      emit(
        pos.x + (Math.random() - 0.5) * 26,
        pos.y + (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 26,
        -50 - Math.random() * 50,
        0.55 + Math.random() * 0.3,
        1.4 + Math.random() * 1.4,
        COLORS.paper,
        0.75,
        -20, 1.2
      );
    }
  }

  /** ability:unlock → 按技能配色的提示粒子。 */
  function onAbilityUnlock(payload) {
    if (!payload || degraded()) { return; }
    var id = payload.id !== undefined ? payload.id : payload.abilityId;
    var tint = COLORS.goldBright;
    if (id === 'swordRain') { tint = COLORS.sword; }
    else if (id === 'whirl') { tint = COLORS.jadeBright; }
    else if (id === 'doubleQi') { tint = COLORS.goldBright; }

    var pos = playerPos();
    var n = 16;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      var speed = 100 + Math.random() * 90;
      emit(
        pos.x, pos.y,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        0.45 + Math.random() * 0.35,
        1.8 + Math.random() * 2,
        tint,
        0.95,
        60, 2.4
      );
    }
  }

  /** loot:picked → 玩家位置的小微光（数量少，避免高掉落率下刷屏）。 */
  function onLootPicked(payload) {
    if (!payload || degraded()) { return; }
    var pos = playerPos();
    var tint = payload.kind === 'silver' || payload.kind === 'coin'
      ? COLORS.goldBright
      : (payload.kind === 'potion' || payload.kind === 'heal' ? COLORS.jadeBright : COLORS.sword);
    for (var i = 0; i < 3; i++) {
      var a = Math.random() * Math.PI * 2;
      var speed = 24 + Math.random() * 46;
      emit(
        pos.x + (Math.random() - 0.5) * 8,
        pos.y + (Math.random() - 0.5) * 8,
        Math.cos(a) * speed,
        Math.sin(a) * speed - 30,
        0.28 + Math.random() * 0.22,
        1.2 + Math.random() * 1.4,
        tint,
        0.8,
        40, 1.8
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * 固定步长更新
   * ------------------------------------------------------------------ */
  function update(dt) {
    var step = num(dt, 1 / 60);
    if (step <= 0) { return; }
    // 降级：清空已有粒子，仅保留伤害数字（AC-8）
    if (degraded()) {
      if (live > 0) { reset(); }
      return;
    }
    clock += step;

    for (var i = 0; i < CAP; i++) {
      var p = items[i];
      if (!p.alive) { continue; }

      p.life -= step;
      if (p.life <= 0) {
        p.alive = false;
        live--;
        continue;
      }

      p.vy += p.gravity * step;
      if (p.drag > 0) {
        var damp = 1 - p.drag * step;
        if (damp < 0) { damp = 0; }
        p.vx *= damp;
        p.vy *= damp;
      }
      p.x += p.vx * step;
      p.y += p.vy * step;
    }
  }

  /* ------------------------------------------------------------------ *
   * 渲染（main 已施加相机变换；此处只画世界坐标）
   * ------------------------------------------------------------------ */
  function render(ctx, alpha) {
    if (!ctx || degraded()) { return; }

    var cam = WG.core && WG.core.Camera;
    var x0 = -Infinity, x1 = Infinity, y0 = -Infinity, y1 = Infinity;
    if (cam && cam.w > 0 && cam.h > 0) {
      x0 = cam.x - CULL;
      x1 = cam.x + cam.w + CULL;
      y0 = cam.y - CULL;
      y1 = cam.y + cam.h + CULL;
    }

    var prevAlpha = (typeof ctx.globalAlpha === 'number') ? ctx.globalAlpha : 1;

    for (var i = 0; i < CAP; i++) {
      var p = items[i];
      if (!p.alive) { continue; }
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) { continue; }

      var t = p.life / p.maxLife;
      if (t > 1) { t = 1; }
      var a = p.alpha0 * (t < 0.5 ? t * 2 : 1);
      if (a <= 0.01) { continue; }

      var size = p.size * (0.35 + 0.65 * t);
      if (size < 0.6) { size = 0.6; }

      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - size * 0.5, p.y - size * 0.5, size, size);
    }

    ctx.globalAlpha = prevAlpha;
  }

  /* ------------------------------------------------------------------ *
   * 清空 / 降级恢复
   * ------------------------------------------------------------------ */
  function reset() {
    for (var i = 0; i < CAP; i++) {
      items[i].alive = false;
    }
    live = 0;
    head = 0;
  }

  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  /* ------------------------------------------------------------------ *
   * 事件绑定（只读订阅；ui:start / ui:restart 仅做清场）
   * ------------------------------------------------------------------ */
  function bind(type, fn) {
    var bus = WG.core && WG.core.Bus;
    if (bus && typeof bus.on === 'function') {
      bus.on(type, fn);
    }
  }

  bind('monster:killed', onMonsterKilled);
  bind('level:up', onLevelUp);
  bind('ability:unlock', onAbilityUnlock);
  bind('loot:picked', onLootPicked);
  bind('ui:start', reset);
  bind('ui:restart', reset);

  /* ------------------------------------------------------------------ *
   * 公开契约
   * ------------------------------------------------------------------ */
  var particles = {
    burst: burst,
    update: update,
    render: render,
    reset: reset
  };

  Object.defineProperty(particles, 'count', {
    enumerable: true,
    get: function () { return live; }
  });
  Object.defineProperty(particles, 'cap', {
    enumerable: true,
    get: function () { return CAP; }
  });

  fx.particles = particles;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
