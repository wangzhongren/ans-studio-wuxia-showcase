/*!
 * 江湖夜雨 · monsters-waves · ai.js
 * 契约：docs/contracts/wuxia-rogue-architecture-v1.md §4.4 / §5
 * 公开：WG.monsters.MonsterSystem = { update(dt, world), pool, byId(id), count,
 *        spawn(type, x, y, mods), spawnBurst(n), render(ctx, alpha), reset(world) }
 *
 * 行为：追击（游侠）/ 远程（弓手）/ 冲锋（刀客、血刀宗师）。
 * 事件：
 *   - 监听 'damage' {targetId, amount} → 扣怪物 HP；
 *   - HP 归零 → emit('monster:killed', {id,x,y,type,xp,elite}) → 归还对象池；
 *   - 攻击 → emit('player:hurt', {amount, damage, hp, maxHp})，绝不直接改玩家 HP。
 * 池：WG.core.Pool 预分配 300 槽；本模块自管 active/free 以支持单只归还；
 *     count 为存活数，硬上限 300（超出不再生成）。
 * 边界：只写 src/monsters/；跨模块只经 WG.core.Bus 与只读 WG.combat.player。
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
  function typesApi() {
    return monsters.types || null;
  }
  function emit(type, payload) {
    var c = core();
    if (c && c.Bus && typeof c.Bus.emit === 'function') {
      try { c.Bus.emit(type, payload); } catch (e) { /* 总线故障不影响模拟 */ }
    }
  }
  function on(type, fn) {
    var c = core();
    if (c && c.Bus && typeof c.Bus.on === 'function') {
      try { c.Bus.on(type, fn); return true; } catch (e) { return false; }
    }
    return false;
  }

  function capMonsters() {
    var conf = cfg().monsters || {};
    var cap = num(conf.cap, 300);
    return Math.max(1, Math.floor(cap));
  }

  /* ------------------------------------------------------------------ *
   * 对象池：core.Pool 预分配 + 自管 active/free（支持单只归还）
   * ------------------------------------------------------------------ */

  function makeMonster() {
    return {
      id: 0, type: '', behavior: 'chase', template: null,
      x: 0, y: 0, vx: 0, vy: 0, r: 14, radius: 14,
      hp: 1, maxHp: 1, baseHp: 1,
      speed: 0, baseSpeed: 0,
      damage: 0, baseDamage: 0,
      atkInterval: 1, atkTimer: 0, xp: 0,
      elite: false, color: '#c96f5a',
      alive: false, dead: false, _released: false,
      facing: 1, state: 'chase', stateTimer: 0,
      chargeVx: 0, chargeVy: 0, chargeHit: false,
      flash: 0, strafe: 1,
      age: 0, animPhase: 0, atkAnim: 0, atkLunge: false,
      kbTime: 0, kbX: 0, kbY: 0,
      pendingHit: false, pendingTimer: 0,
      isMonster: true
    };
  }

  function resetMonster(m) {
    m.id = 0;
    m.type = '';
    m.behavior = 'chase';
    m.template = null;
    m.x = 0; m.y = 0; m.vx = 0; m.vy = 0;
    m.r = 14; m.radius = 14;
    m.hp = 1; m.maxHp = 1; m.baseHp = 1;
    m.speed = 0; m.baseSpeed = 0;
    m.damage = 0; m.baseDamage = 0;
    m.atkInterval = 1; m.atkTimer = 0; m.xp = 0;
    m.elite = false; m.color = '#c96f5a';
    m.alive = false; m.dead = false; m._released = false;
    m.facing = 1; m.state = 'chase'; m.stateTimer = 0;
    m.chargeVx = 0; m.chargeVy = 0; m.chargeHit = false;
    m.flash = 0; m.strafe = 1;
    m.age = 0; m.animPhase = 0; m.atkAnim = 0; m.atkLunge = false;
    m.kbTime = 0; m.kbX = 0; m.kbY = 0;
    m.pendingHit = false; m.pendingTimer = 0;
    m.isMonster = true;
  }

  function createPool(cap) {
    var c = core();
    var storage = null;
    if (c && typeof c.Pool === 'function') {
      try { storage = new c.Pool(cap, makeMonster, resetMonster); } catch (e) { storage = null; }
    }

    var active = [];
    var free = [];
    var total = 0;

    function acquire() {
      var m;
      if (free.length) {
        m = free.pop();
        resetMonster(m);
      } else if (total < cap) {
        m = storage ? storage.spawn() : makeMonster();
        total++;
        resetMonster(m);
      } else {
        return null; // 硬上限：不再生成
      }
      active.push(m);
      return m;
    }

    function release(m) {
      if (!m || m._released) { return; }
      m._released = true;
      m.alive = false;
      m.dead = true;
      m.pendingHit = false; // 归还对象池：取消待结算，避免死后伤害
      m.pendingTimer = 0;
      for (var i = active.length - 1; i >= 0; i--) {
        if (active[i] === m) {
          active[i] = active[active.length - 1];
          active.pop();
          break;
        }
      }
      free.push(m);
    }

    return {
      capacity: cap,
      get count() { return active.length; },
      get items() { return active; },
      forEach: function (fn) {
        for (var i = 0; i < active.length; i++) { fn(active[i], i); }
      },
      spawn: acquire,
      release: release,
      releaseAll: function () {
        for (var i = 0; i < active.length; i++) {
          active[i].alive = false;
          active[i].dead = true;
          active[i]._released = true;
          active[i].pendingHit = false;
          active[i].pendingTimer = 0;
          free.push(active[i]);
        }
        active.length = 0;
        // 注意：不调用 storage.releaseAll()。core.Pool 的 spawn 会环形复用最旧槽位，
        // 若把存储池整体释放再重新 spawn，会覆盖仍在 active 的引用；本模块以 free 栈
        // 回收对象，存储池只负责首次预分配，因此这里保持其槽位状态不变。
      }
    };
  }

  var pool = createPool(capMonsters());
  var byId = Object.create(null);
  var nextId = 0;
  var bound = false;
  var currentWorld = null;
  var lastLevel = 1;
  // 程序化动效统一时钟（固定步长累计；暂停时随 update 冻结）
  var animClock = 0;

  /* ------------------------------------------------------------------ *
   * 敌方箭矢（弓手远程投射物，独立小池，上限 200）
   * ------------------------------------------------------------------ */

  function arrowCap() {
    var pools = cfg().pools || {};
    return Math.max(1, Math.floor(num(pools.enemyProjectiles, 200)));
  }

  var arrows = [];

  function recycleArrow(a) {
    a.active = false;
    a.x = 0; a.y = 0; a.vx = 0; a.vy = 0;
    a.damage = 0; a.life = 0; a.r = 4;
  }

  function spawnArrow(x, y, vx, vy, damage) {
    var a = null;
    if (arrows.length >= arrowCap()) {
      a = arrows.shift(); // 复用最旧
    } else {
      a = { active: false, x: 0, y: 0, vx: 0, vy: 0, r: 4, damage: 0, life: 0 };
    }
    a.active = true;
    a.x = x; a.y = y;
    a.vx = vx; a.vy = vy;
    a.r = 4;
    a.damage = damage;
    a.life = 2.2;
    arrows.push(a);
    return a;
  }

  function updateArrows(dt, player) {
    if (!player) { return; }
    var pr = num(player.r, 14);
    for (var i = arrows.length - 1; i >= 0; i--) {
      var a = arrows[i];
      if (!a.active) { arrows.splice(i, 1); continue; }
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.life -= dt;
      var dx = player.x - a.x;
      var dy = player.y - a.y;
      var rr = a.r + pr;
      if (dx * dx + dy * dy <= rr * rr) {
        emitHurt(a.damage, player);
        recycleArrow(a);
        arrows.splice(i, 1);
        continue;
      }
      if (a.life <= 0) {
        recycleArrow(a);
        arrows.splice(i, 1);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 伤害与死亡
   * ------------------------------------------------------------------ */

  function emitHurt(amount, player) {
    // combat 的 Player 以 amount/damage 扣血，再回发 {hp,maxHp}；本模块绝不改玩家 HP。
    var dmg = Math.max(0, num(amount, 0));
    if (dmg <= 0) { return; }
    var p = player || (WG.combat && WG.combat.player);
    emit('player:hurt', {
      amount: dmg,
      damage: dmg,
      hp: p ? p.hp : 0,
      maxHp: p ? p.maxHp : 0
    });
  }

  function onDamage(payload) {
    if (!payload) { return; }
    var id = payload.targetId;
    if (id === null || typeof id === 'undefined') { return; }
    var m = byId[id];
    if (!m || !m.alive) { return; }
    var amount = num(payload.amount, 0);
    if (amount <= 0) { return; }
    m.hp -= amount;
    m.flash = num((cfg().fx || {}).hitFlash, 0.08);
    applyKnockback(m, payload);
    if (m.hp <= 0) { kill(m); }
  }

  /**
   * 受击击退：记录背离伤害来源的视觉偏移（约 6px / 100ms）。
   * 只改渲染偏移，不移动实际坐标，因此不会打断 AI / 穿墙 / 越界。
   */
  function applyKnockback(m, payload) {
    var sx = num(payload && payload.x, NaN);
    var sy = num(payload && payload.y, NaN);
    if (!isFinite(sx) || !isFinite(sy)) {
      var p = WG.combat && WG.combat.player;
      if (p) { sx = num(p.x, NaN); sy = num(p.y, NaN); }
    }
    var dx = 0;
    var dy = 0;
    var d = 0;
    if (isFinite(sx) && isFinite(sy)) {
      dx = m.x - sx;
      dy = m.y - sy;
      d = Math.sqrt(dx * dx + dy * dy);
    }
    if (!(d > 1e-6)) { dx = -m.facing; dy = 0; d = 1; }
    m.kbX = (dx / d) * MOTION.knockbackDist;
    m.kbY = (dy / d) * MOTION.knockbackDist;
    m.kbTime = MOTION.knockbackDur;
  }

  function kill(m) {
    if (!m || !m.alive) { return; }
    m.hp = 0;
    m.pendingHit = false; // 命中帧前死亡：取消待结算伤害
    m.pendingTimer = 0;
    emit('monster:killed', {
      id: m.id,
      x: m.x,
      y: m.y,
      type: m.type,
      xp: m.xp,
      elite: !!m.elite
    });
    delete byId[m.id];
    pool.release(m);
  }

  /* ------------------------------------------------------------------ *
   * 生成
   * ------------------------------------------------------------------ */

  /**
   * @param {string} type 模板 id（支持别名）
   * @param {number} x
   * @param {number} y
   * @param {{hpMul?:number,damageMul?:number,speedBonus?:number,elite?:boolean}} [mods]
   * @returns {Object|null}
   */
  function spawn(type, x, y, mods) {
    var api = typesApi();
    var t = api ? api.get(type) : null;
    if (!t) { return null; }
    if (pool.count >= pool.capacity) { return null; }

    var m = pool.spawn();
    if (!m) { return null; }

    var hpMul = Math.max(0.1, num(mods && mods.hpMul, 1));
    var dmgMul = Math.max(0.1, num(mods && mods.damageMul, 1));
    var speedBonus = num(mods && mods.speedBonus, 0);

    m.id = ++nextId;
    m.type = t.id;
    m.template = t;
    m.behavior = t.behavior;
    m.x = num(x, 0);
    m.y = num(y, 0);
    m.r = t.radius;
    m.radius = t.radius;
    m.baseHp = t.hp;
    m.hp = Math.round(t.hp * hpMul);
    m.maxHp = m.hp;
    m.baseSpeed = t.speed;
    m.speed = Math.max(1, t.speed + speedBonus);
    m.baseDamage = t.damage;
    m.damage = Math.max(1, Math.round(t.damage * dmgMul * 10) / 10);
    m.atkInterval = t.atkInterval;
    m.atkTimer = 0;
    m.xp = t.xp;
    m.elite = t.elite || !!(mods && mods.elite);
    m.color = t.color;
    m.alive = true;
    m.dead = false;
    m._released = false;
    m.state = 'chase';
    m.stateTimer = 0;
    m.flash = 0;
    m.age = 0;
    m.animPhase = (m.id % 8) * 0.7853981634; // 确定性相位，避免同相位齐步走
    m.atkAnim = 0;
    m.atkLunge = false;
    m.kbTime = 0;
    m.kbX = 0;
    m.kbY = 0;
    m.pendingHit = false;
    m.pendingTimer = 0;
    // 确定性横移方向（同 seed 同行为；不额外消耗 RNG）
    m.strafe = (m.id % 2 === 0) ? 1 : -1;
    m.isMonster = true;

    byId[m.id] = m;
    return m;
  }

  /* ------------------------------------------------------------------ *
   * 移动与行为
   * ------------------------------------------------------------------ */

  function obstaclesOf(world) {
    if (!world) { return null; }
    var raw = world.obstacles || world.OBSTACLES || world.walls || null;
    if (!raw) { return null; }
    if (Array.isArray(raw)) { return raw; }
    if (Array.isArray(raw.items)) { return raw.items; }
    return null;
  }

  function blocked(x, y, r, list) {
    if (!list) { return false; }
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o) { continue; }
      var or = num(o.r, num(o.radius, 0));
      if (or <= 0) { continue; }
      var dx = x - num(o.x, 0);
      var dy = y - num(o.y, 0);
      var rr = r + or;
      if (dx * dx + dy * dy < rr * rr) { return true; }
    }
    return false;
  }

  function clampWorld(m, world) {
    var conf = cfg();
    var w = num(world && world.width, num((conf.world || {}).width, 3840));
    var h = num(world && world.height, num((conf.world || {}).height, 2160));
    var margin = num((conf.world || {}).margin, 40);
    m.x = Math.min(Math.max(m.x, margin + m.r), w - margin - m.r);
    m.y = Math.min(Math.max(m.y, margin + m.r), h - margin - m.r);
  }

  /** 轴分离移动（撞障碍时只停一个轴，贴墙可滑动） */
  function moveBy(m, dx, dy, world) {
    var list = obstaclesOf(world);
    if (dx) {
      var nx = m.x + dx;
      if (!blocked(nx, m.y, m.r, list)) { m.x = nx; }
    }
    if (dy) {
      var ny = m.y + dy;
      if (!blocked(m.x, ny, m.r, list)) { m.y = ny; }
    }
    clampWorld(m, world);
  }

  function moveToward(m, tx, ty, dt, speed, stopDist, world) {
    var dx = tx - m.x;
    var dy = ty - m.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= stopDist || dist < 1e-6) { return dist; }
    m.facing = dx >= 0 ? 1 : -1;
    var step = speed * dt;
    if (step > dist - stopDist) { step = dist - stopDist; }
    moveBy(m, (dx / dist) * step, (dy / dist) * step, world);
    return dist;
  }

  function moveAway(m, tx, ty, dt, speed, world) {
    var dx = m.x - tx;
    var dy = m.y - ty;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-6) { dx = 1; dy = 0; dist = 1; }
    var step = speed * dt;
    moveBy(m, (dx / dist) * step, (dy / dist) * step, world);
  }

  function contactRange(m, player) {
    return m.r + num(player.r, 14) + 2;
  }

  function updateChase(m, dt, player, world) {
    if (!player) { return; }
    var dist = moveToward(m, player.x, player.y, dt, m.speed, contactRange(m, player) * 0.8, world);
    m.atkTimer -= dt;
    if (m.atkTimer <= 0 && dist <= contactRange(m, player) + 2) {
      startAttackAnim(m, true);
      // 命中帧结算：攻击开始只登记待结算，前摇期间不扣血；
      // 由 updateMonster 在前摇结束（扑击起始）同一帧 emitHurt。
      m.pendingHit = true;
      m.pendingTimer = MOTION.attackWindup;
      m.atkTimer = Math.max(0.1, m.atkInterval);
    }
    if (m.atkTimer < 0) { m.atkTimer = 0; }
  }

  function updateRanged(m, dt, player, world) {
    if (!player) { return; }
    var t = m.template || {};
    var keep = num(t.keepDistance, 260);
    var dx = player.x - m.x;
    var dy = player.y - m.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    m.facing = dx >= 0 ? 1 : -1;

    if (dist > keep + 24) {
      moveToward(m, player.x, player.y, dt, m.speed, keep, world);
    } else if (dist < keep - 32) {
      moveAway(m, player.x, player.y, dt, m.speed, world);
    } else if (dist > 1e-6) {
      // 保持距离时缓慢横移，避免站桩
      var px = -(dy / dist) * m.strafe;
      var py = (dx / dist) * m.strafe;
      moveBy(m, px * m.speed * 0.35 * dt, py * m.speed * 0.35 * dt, world);
    }

    m.atkTimer -= dt;
    if (m.atkTimer <= 0 && dist <= keep + 90 && dist > 1) {
      var speed = num((m.template || {}).arrowSpeed, 300);
      var nx = dx / dist;
      var ny = dy / dist;
      startAttackAnim(m, false); // 远程只做前摇姿态，不强制位移
      spawnArrow(m.x + nx * (m.r + 3), m.y + ny * (m.r + 3), nx * speed, ny * speed, m.damage);
      m.atkTimer = Math.max(0.2, m.atkInterval);
    }
    if (m.atkTimer < 0) { m.atkTimer = 0; }
  }

  function updateCharge(m, dt, player, world) {
    if (!player) { return; }
    var t = m.template || {};

    if (m.state === 'windup') {
      m.stateTimer -= dt;
      m.flash = Math.max(m.flash, 0);
      if (m.stateTimer <= 0) {
        var dx = player.x - m.x;
        var dy = player.y - m.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
        var cs = num(t.chargeSpeed, 640);
        m.chargeVx = (dx / d) * cs;
        m.chargeVy = (dy / d) * cs;
        m.state = 'charge';
        m.stateTimer = Math.max(0.08, num(t.chargeDistance, 220) / cs);
        m.chargeHit = false;
      }
      return;
    }

    if (m.state === 'charge') {
      moveBy(m, m.chargeVx * dt, m.chargeVy * dt, world);
      m.stateTimer -= dt;
      var pdx = player.x - m.x;
      var pdy = player.y - m.y;
      var rr = contactRange(m, player);
      if (!m.chargeHit && pdx * pdx + pdy * pdy <= rr * rr) {
        emitHurt(m.damage, player);
        m.chargeHit = true;
      }
      if (m.stateTimer <= 0) {
        m.state = 'recover';
        m.stateTimer = 0.25;
      }
      return;
    }

    if (m.state === 'recover') {
      m.stateTimer -= dt;
      if (m.stateTimer <= 0) { m.state = 'chase'; }
      return;
    }

    // chase
    var dist = moveToward(m, player.x, player.y, dt, m.speed, contactRange(m, player), world);
    m.atkTimer -= dt;
    if (m.atkTimer <= 0 && dist <= 320) {
      m.state = 'windup';
      m.stateTimer = Math.max(0.1, num(t.chargeWindup, 0.6));
      m.atkTimer = Math.max(0.5, m.atkInterval);
      startAttackAnim(m, false); // 冲锋前摇只做姿态；真实扑击由 charge 位移体现
    }
    if (m.atkTimer < 0) { m.atkTimer = 0; }
  }

  function updateMonster(m, dt, player, world) {
    if (m.flash > 0) {
      m.flash -= dt;
      if (m.flash < 0) { m.flash = 0; }
    }
    // 动效计时：只驱动绘制姿态，不影响 AI 决策
    m.age += dt;
    if (m.atkAnim > 0) {
      m.atkAnim -= dt;
      if (m.atkAnim < 0) { m.atkAnim = 0; }
    }
    if (m.kbTime > 0) {
      m.kbTime -= dt;
      if (m.kbTime < 0) { m.kbTime = 0; }
    }
    if (m.pendingTimer > 0) {
      m.pendingTimer -= dt;
      if (m.pendingTimer < 0) { m.pendingTimer = 0; }
    }
    // 近战命中帧结算：与扑击起始（前摇结束）同一帧；怪物已死/玩家死亡则丢弃。
    if (m.pendingHit) {
      if (!player || player.dead) {
        m.pendingHit = false;
        m.pendingTimer = 0;
      } else if (m.atkAnim <= MOTION.attackLunge + 1e-6) {
        m.pendingHit = false;
        m.pendingTimer = 0;
        emitHurt(m.damage, player);
      }
    }
    if (!player || player.dead) { return; }

    switch (m.behavior) {
      case 'ranged': updateRanged(m, dt, player, world); break;
      case 'charge': updateCharge(m, dt, player, world); break;
      default: updateChase(m, dt, player, world); break;
    }
  }

  /* ------------------------------------------------------------------ *
   * 刷怪点辅助（屏外 240~360 px 环带；供 spawnBurst 使用）
   * ------------------------------------------------------------------ */

  function resolveRng(world) {
    if (world && world.rng && typeof world.rng.next === 'function') { return world.rng; }
    var c = core();
    if (c && typeof c.Rng === 'function') { return c.Rng(0x9e3779b9); }
    return { next: Math.random, range: function (a, b) { return a + (b - a) * Math.random(); } };
  }

  function viewRect(world) {
    var c = core();
    var conf = cfg();
    var cam = c && c.Camera;
    var vw = num((conf.viewport || {}).width, 1280);
    var vh = num((conf.viewport || {}).height, 720);
    if (cam && typeof cam.x === 'number' && typeof cam.w === 'number') {
      return { x: cam.x, y: cam.y, w: cam.w, h: cam.h };
    }
    var p = (world && world.player) || (WG.combat && WG.combat.player);
    if (p) {
      return { x: p.x - vw / 2, y: p.y - vh / 2, w: vw, h: vh };
    }
    return { x: 0, y: 0, w: vw, h: vh };
  }

  /** 从点 (px,py) 沿单位方向到视口矩形的出射距离；点已在矩形外返回 0 */
  function rayBoxExit(px, py, dx, dy, x1, y1, x2, y2) {
    if (px < x1 || px > x2 || py < y1 || py > y2) { return 0; }
    var tx = dx > 0 ? (x2 - px) / dx : (dx < 0 ? (x1 - px) / dx : Infinity);
    var ty = dy > 0 ? (y2 - py) / dy : (dy < 0 ? (y1 - py) / dy : Infinity);
    var t = Math.min(tx, ty);
    return (isFinite(t) && t > 0) ? t : 0;
  }

  /**
   * 在屏幕外 240~360 px 环带取点（沿随机方向越过视口边界后再外扩），
   * 保证不贴脸刷怪；越界或撞障碍时重试，失败返回 null。
   * @returns {{x:number,y:number}|null}
   */
  function chooseRingPoint(world) {
    var conf = cfg();
    var mc = conf.monsters || {};
    var rMin = num(mc.spawnRingMin, 240);
    var rMax = num(mc.spawnRingMax, 360);
    var p = (world && world.player) || (WG.combat && WG.combat.player);
    if (!p) { return null; }
    var rng = resolveRng(world);
    var view = viewRect(world);
    var x1 = view.x;
    var y1 = view.y;
    var x2 = view.x + view.w;
    var y2 = view.y + view.h;

    function rectDistance(px, py) {
      var rx = Math.max(x1 - px, 0, px - x2);
      var ry = Math.max(y1 - py, 0, py - y2);
      return Math.sqrt(rx * rx + ry * ry);
    }

    for (var attempt = 0; attempt < 24; attempt++) {
      var angle = rng.range(0, Math.PI * 2);
      var dirX = Math.cos(angle);
      var dirY = Math.sin(angle);
      var extra = rng.range(rMin, rMax);
      var exit = rayBoxExit(p.x, p.y, dirX, dirY, x1, y1, x2, y2);
      var dist = exit + extra; // 视口内 → 越过边界后再外扩 240~360 px
      var x = p.x + dirX * dist;
      var y = p.y + dirY * dist;

      var w = num(world && world.width, num((conf.world || {}).width, 3840));
      var h = num(world && world.height, num((conf.world || {}).height, 2160));
      var wm = num((conf.world || {}).margin, 40) + 8;
      if (x < wm || x > w - wm || y < wm || y > h - wm) { continue; }
      if (blocked(x, y, 18, obstaclesOf(world))) { continue; }

      // 双保险：距屏幕边缘 240~360 px（斜向取点时按欧氏距离校核）
      var edgeDist = rectDistance(x, y);
      if (edgeDist < rMin - 1 || edgeDist > rMax + 60) { continue; }
      return { x: x, y: y };
    }
    return null;
  }

  /**
   * 调试用：立即在屏外生成 n 只怪（供 WG.perf.spawnBurst / F5 压测）。
   * @param {number} n
   * @param {string} [type]
   * @returns {number} 实际生成数量
   */
  function spawnBurst(n, type) {
    var count = Math.max(0, Math.floor(num(n, 0)));
    var spawned = 0;
    var world = currentWorld;
    var api = typesApi();
    var kind = (api && api.get(type)) ? type : 'youxia';
    for (var i = 0; i < count; i++) {
      if (pool.count >= pool.capacity) { break; }
      var pt = chooseRingPoint(world);
      if (!pt) { break; }
      if (spawn(kind, pt.x, pt.y, null)) { spawned++; }
    }
    return spawned;
  }

  /* ------------------------------------------------------------------ *
   * 渲染（可选钩子；简单几何体，便于 F3 计数核对与 AC 观察）
   * ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ *
   * 美术资源映射（art-render bridge v1 §2/§3）：type → 资产 id；
   * 加载器 WG.fx.assets 缺失/返回 false 时安全回退几何绘制。
   * ------------------------------------------------------------------ */

  var ASSET_BY_TYPE = {
    youxia: 'monster-wanderer',
    archer: 'monster-bowman',
    daoke: 'monster-blade',
    bloodmaster: 'monster-blade'
  };

  // 复用的 draw 选项对象（bridge：调用方不得为此逐帧新建对象）
  var drawOpts = { flipX: false, alpha: 1, angle: 0, anchor: 'center', tint: null };

  function assetsApi() {
    var fx = WG.fx;
    var api = fx && fx.assets;
    return (api && typeof api.draw === 'function') ? api : null;
  }

  function assetIdFor(type) {
    return ASSET_BY_TYPE[type] || 'monster';
  }

  function tryDraw(api, ctx, id, x, y, w, h, opts) {
    try {
      return api.draw(ctx, id, x, y, w, h, opts) === true;
    } catch (e) {
      return false;
    }
  }

  /** 受击闪白强度 0..1（按 fx.hitFlash 缩短的 m.flash 归一化） */
  function flashRatio(m) {
    var hitFlash = num((cfg().fx || {}).hitFlash, 0.08);
    if (!(hitFlash > 0)) { hitFlash = 0.08; }
    var r = m.flash / hitFlash;
    if (r < 0) { r = 0; }
    if (r > 1) { r = 1; }
    return r;
  }

  /* ------------------------------------------------------------------ *
   * 程序化动效参数（motion-plan v1 §3 基线；只影响绘制变换）
   * ------------------------------------------------------------------ */
  var MOTION = {
    swayPeriod: 0.7,          // 700 ms 摇摆周期
    swayRate: Math.PI * 2 / 0.7,
    swayY: 4, swayX: 1.5,     // 追击：纵向 ±4px / 横向 ±1.5px
    rangedSwayY: 2.5, rangedSwayX: 1,
    chargeSwayY: 3, chargeSwayX: 1.2,
    attackWindup: 0.25,       // 前摇 250 ms（放大 1.06 + 后仰）
    attackLunge: 0.1,         // 扑击 100 ms
    attackLungeDist: 8,       // 扑击位移 8 px
    attackScale: 1.06,
    attackLean: 2,            // 前摇后仰约 2 px
    knockbackDist: 6,         // 受击击退 6 px
    knockbackDur: 0.1,        // 100 ms
    spawnDur: 0.18,           // 生成弹出 180 ms
    spawnFrom: 0.6,           // 0.6 → 1.0 ease-out
    shadowW: 0.55,            // 影子宽 ≈ 实体宽 × 0.55
    shadowH: 0.18,            // 影子高 ≈ 实体宽 × 0.18
    shadowAlpha: 0.25,
    shadowFootY: 0.42         // 影子中心相对贴图中心下移
  };

  function startAttackAnim(m, lunge) {
    m.atkAnim = MOTION.attackWindup + MOTION.attackLunge;
    m.atkLunge = !!lunge;
  }

  function motionDegraded() {
    var fx = WG.fx;
    var degrade = fx && fx.degrade;
    return !!(degrade && degrade.enabled);
  }

  /** 脚下椭圆影子：贴图之前；优先 ctx.ellipse，缺失时用缩放圆回退；无逐帧对象。 */
  function drawShadow(ctx, x, y, size) {
    var w = size * MOTION.shadowW;
    var h = size * MOTION.shadowH;
    if (!(w > 0) || !(h > 0)) { return; }
    var prevAlpha = (typeof ctx.globalAlpha === 'number') ? ctx.globalAlpha : 1;
    var prevFill = ctx.fillStyle;
    ctx.save();
    ctx.globalAlpha = prevAlpha * MOTION.shadowAlpha;
    ctx.fillStyle = '#000000';
    if (typeof ctx.ellipse === 'function') {
      ctx.beginPath();
      ctx.ellipse(x, y, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (typeof ctx.translate === 'function' && typeof ctx.scale === 'function') {
      ctx.translate(x, y);
      ctx.scale(1, h / w);
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // 极简 ctx 桩的 save/restore 可能不还原属性；真实 canvas 上为同值赋值，无副作用
    ctx.globalAlpha = prevAlpha;
    ctx.fillStyle = prevFill;
  }

  function render(ctx) {
    if (!ctx) { return; }
    var c = core();
    var cam = c && c.Camera;
    var conf = cfg();
    var margin = num((conf.fx || {}).cullMargin, 96);
    var vx = cam ? cam.x : -Infinity;
    var vy = cam ? cam.y : -Infinity;
    var vw = cam ? cam.w : Infinity;
    var vh = cam ? cam.h : Infinity;
    var api = assetsApi();

    var degrade = motionDegraded();

    for (var i = 0; i < pool.items.length; i++) {
      var m = pool.items[i];
      if (!m.alive) { continue; }
      if (m.x < vx - margin || m.x > vx + vw + margin ||
          m.y < vy - margin || m.y > vy + vh + margin) { continue; }

      // 基础尺寸约 m.r*3；宗师再放大 15% 以区分精英
      var baseSize = m.r * 3 * (m.type === 'bloodmaster' ? 1.15 : 1);

      // 生成缩放弹出：0.6→1.0，180 ms ease-out（降级关闭）
      var pop = 1;
      if (!degrade && m.age < MOTION.spawnDur) {
        var pk = m.age / MOTION.spawnDur;
        if (pk < 0) { pk = 0; }
        var pe = 1 - (1 - pk) * (1 - pk);
        pop = MOTION.spawnFrom + (1 - MOTION.spawnFrom) * pe;
      }

      // 移动摇摆：约 700 ms 周期，按行为区分幅度（降级关闭）
      var swayX = 0;
      var swayY = 0;
      if (!degrade) {
        var ampY = MOTION.swayY;
        var ampX = MOTION.swayX;
        if (m.behavior === 'ranged') {
          ampY = MOTION.rangedSwayY; ampX = MOTION.rangedSwayX;
        } else if (m.behavior === 'charge') {
          ampY = MOTION.chargeSwayY; ampX = MOTION.chargeSwayX;
        }
        var swayPhase = animClock * MOTION.swayRate + m.animPhase;
        swayY = Math.sin(swayPhase) * ampY;
        swayX = Math.cos(swayPhase) * ampX;
      }

      // 攻击前摇 250 ms（放大 1.06 + 后仰 2px）→ 扑击 8px / 100 ms
      var atkScale = 1;
      var lungeX = 0;
      if (m.atkAnim > 0) {
        var atkTotal = MOTION.attackWindup + MOTION.attackLunge;
        var elapsed = atkTotal - m.atkAnim;
        if (elapsed < 0) { elapsed = 0; }
        if (elapsed < MOTION.attackWindup) {
          var wk = elapsed / MOTION.attackWindup;
          if (!degrade) { atkScale = 1 + (MOTION.attackScale - 1) * wk; }
          lungeX = -MOTION.attackLean * wk; // 后仰
        } else {
          var lk = (elapsed - MOTION.attackWindup) / MOTION.attackLunge;
          if (lk > 1) { lk = 1; }
          if (!degrade) { atkScale = 1 + (MOTION.attackScale - 1) * (1 - lk); }
          if (m.atkLunge) { lungeX = MOTION.attackLungeDist * (1 - lk); }
        }
        lungeX *= (m.facing < 0 ? -1 : 1);
      }

      // 受击击退：6px / 100ms，视觉偏移（实际坐标与碰撞不变）
      var kbX = 0;
      var kbY = 0;
      if (m.kbTime > 0) {
        var kk = m.kbTime / MOTION.knockbackDur;
        var ke = kk * kk;
        kbX = m.kbX * ke;
        kbY = m.kbY * ke;
      }

      var scale = pop * atkScale;
      var size = baseSize * scale;
      var drawX = m.x + swayX + lungeX + kbX;
      var drawY = m.y + swayY + kbY;

      // 脚下影子：贴图之前绘制，宽≈实体宽×0.55、高×0.18、alpha 0.25（降级保留，成本一次 fill）
      drawShadow(ctx, m.x + swayX, m.y + baseSize * MOTION.shadowFootY, baseSize * pop);

      var drew = false;
      if (api) {
        drawOpts.flipX = m.facing < 0;
        drawOpts.alpha = 1;
        drawOpts.angle = 0;
        drawOpts.anchor = 'center';
        drawOpts.tint = null;
        drew = tryDraw(api, ctx, assetIdFor(m.type), drawX, drawY, size, size, drawOpts);
      }

      if (!drew) {
        ctx.beginPath();
        ctx.arc(drawX, drawY, m.r * scale, 0, Math.PI * 2);
        ctx.fillStyle = m.color;
        ctx.fill();
      }

      // 受击闪白：图片与几何两条路径都叠加半透明白色高亮
      if (m.flash > 0) {
        ctx.save();
        ctx.globalAlpha = 0.2 + 0.6 * flashRatio(m);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(drawX, drawY, drew ? size * 0.5 : m.r * scale + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 精英/宗师金色描边
      if (m.elite) {
        ctx.beginPath();
        ctx.arc(drawX, drawY, drew ? size * 0.5 + 2 : m.r * scale + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 215, 94, 0.75)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // 箭矢：优先 sword-qi 贴图并按速度方向旋转；不可用回退白圆
    for (var a = 0; a < arrows.length; a++) {
      var ar = arrows[a];
      if (!ar.active) { continue; }
      var arrowSize = ar.r * 4;
      var arrowDrew = false;
      if (api) {
        drawOpts.flipX = false;
        drawOpts.alpha = 1;
        drawOpts.angle = Math.atan2(ar.vy, ar.vx);
        drawOpts.anchor = 'center';
        drawOpts.tint = null;
        arrowDrew = tryDraw(api, ctx, 'sword-qi', ar.x, ar.y, arrowSize, arrowSize, drawOpts);
      }
      if (!arrowDrew) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ar.x, ar.y, ar.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 公开系统
   * ------------------------------------------------------------------ */

  var MonsterSystem = {
    pool: pool,

    get count() { return pool.count; },

    byId: function (id) {
      if (id === null || typeof id === 'undefined') { return null; }
      return byId[id] || null;
    },

    spawn: spawn,
    spawnBurst: spawnBurst,
    chooseRingPoint: chooseRingPoint,

    update: function (dt, world) {
      var step = num(dt, 0);
      if (step <= 0) { return; }
      animClock += step;
      if (world) { currentWorld = world; }
      if (!bound) {
        bound = true;
        on('damage', onDamage);
      }

      var w = world || currentWorld;
      var player = (w && w.player) || (WG.combat && WG.combat.player) || null;

      updateArrows(step, player);

      var list = pool.items;
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (!m || !m.alive) { continue; }
        updateMonster(m, step, player, w);
      }

      // 记录玩家等级，仅供调试/导演读取（Director 也会收到 playerLevel）
      if (player && player.stats && typeof player.stats.level === 'number') {
        lastLevel = player.stats.level;
      }
    },

    render: render,

    /** 只读调试快照（不暴露内部对象引用） */
    stats: function () {
      return {
        count: pool.count,
        cap: pool.capacity,
        arrows: arrows.length,
        lastLevel: lastLevel
      };
    },

    reset: function (world) {
      // 清空全部怪物与箭矢，供重开一局
      for (var id in byId) {
        if (Object.prototype.hasOwnProperty.call(byId, id)) { delete byId[id]; }
      }
      pool.releaseAll();
      for (var i = 0; i < arrows.length; i++) { recycleArrow(arrows[i]); }
      arrows.length = 0;
      nextId = 0;
      lastLevel = 1;
      animClock = 0;
      if (world) { currentWorld = world; }
    }
  };

  monsters.MonsterSystem = MonsterSystem;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
