/**
 * 江湖夜雨 · combat-player / 玩家实体
 *
 * 契约：docs/contracts/wuxia-rogue-v2-architecture-v1.md §4.3、§5
 * 公开：WG.combat.Player、WG.combat.player（单例，供 UI 只读）
 * 边界：只写 src/combat/；跨模块只经 WG.core.* 公开契约与 WG.core.Bus 事件。
 *
 * 说明：
 * - v2 玩家成长字段（atk/atkInterval/maxHp/speed/regen/critRate/critMult/
 *   damageReduction/pierce/projectileSpeed/potion* 等）的唯一写入点是
 *   sects-progression 的 WG.sects.Selection；本模块只读消费，不写回成长数值。
 * - 本模块持有位置/HP/闪身/回血计时；stats.maxHp 变化由 _syncStats 镜像到实体上限。
 * - 受伤来源：monsters 发 'player:hurt'（带 amount/damage）；本模块按
 *   stats.damageReduction 减伤后扣 HP，再回发 'player:hurt'（只带 hp/maxHp，
 *   不带 amount），因此不会形成扣血回环。
 * - 兼容：'level:up' 只镜像 stats.level 供 HUD 只读；任何成长数值都由 sects 重算，
 *   本模块不写回 atk/atkInterval/maxHp/critRate 等成长字段。
 */
(function (root) {
  'use strict';
  if (!root) { return; }

  var WG = root.WG || (root.WG = {});
  var combat = WG.combat || (WG.combat = {});

  /* ------------------------------------------------------------------ *
   * 基础设施（core 未就绪时全部降级，不抛异常）
   * ------------------------------------------------------------------ */

  function core() {
    return WG.core || null;
  }

  function cfg() {
    var c = core();
    return (c && c.CONFIG) || {};
  }

  function num(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }

  function cfgNum(names, fallback) {
    var c = cfg();
    var groups = [c, c.player, c.PLAYER];
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      if (!group) { continue; }
      for (var i = 0; i < names.length; i++) {
        var v = group[names[i]];
        if (typeof v === 'number' && isFinite(v)) { return v; }
      }
    }
    return fallback;
  }

  /** 读取嵌套的 CONFIG.player.projectile.*（v1/v2 数值表）；缺失时回退。 */
  function cfgProjectile(name, fallback) {
    var c = cfg();
    var playerCfg = c && c.player;
    var projectile = playerCfg && playerCfg.projectile;
    if (projectile) {
      var v = projectile[name];
      if (typeof v === 'number' && isFinite(v)) { return v; }
    }
    return fallback;
  }

  /** 模拟是否推进：Loop 暂停或世界不在 playing 时，regen/计时不前进。 */
  function simulationPaused(world) {
    var c = core();
    if (c && c.Loop && c.Loop.paused) { return true; }
    if (world && typeof world.state === 'string' && world.state !== 'playing') { return true; }
    return false;
  }

  /** 初始经验需求：优先 loot tables.xpToNext(1)，其次 CONFIG.progression.xpBase，最后 40。 */
  function initialXpNext() {
    var loot = WG.loot;
    var tables = loot && loot.tables;
    if (tables && typeof tables.xpToNext === 'function') {
      try {
        var v = tables.xpToNext(1);
        if (typeof v === 'number' && isFinite(v) && v > 0) { return v; }
      } catch (e) { /* 回退 CONFIG */ }
    }
    var c = cfg();
    var progression = c && c.progression;
    var base = progression && progression.xpBase;
    if (typeof base === 'number' && isFinite(base) && base > 0) { return base; }
    return 40;
  }

  function busEmit(type, payload) {
    var c = core();
    if (c && c.Bus && typeof c.Bus.emit === 'function') {
      try { c.Bus.emit(type, payload); } catch (e) { /* 总线故障不影响走位 */ }
    }
  }

  function busOn(type, fn) {
    var c = core();
    if (c && c.Bus && typeof c.Bus.on === 'function') {
      try { c.Bus.on(type, fn); return true; } catch (e) { return false; }
    }
    return false;
  }

  function busOff(type, fn) {
    var c = core();
    if (c && c.Bus && typeof c.Bus.off === 'function') {
      try { c.Bus.off(type, fn); return true; } catch (e) { return false; }
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * 输入：优先 WG.core.Input 公开接口，缺失时用内置键盘兜底
   * ------------------------------------------------------------------ */

  var fallbackInput = null;

  function ensureFallbackInput() {
    if (fallbackInput) { return fallbackInput; }
    fallbackInput = { down: Object.create(null), dashQueued: false };
    if (typeof root.addEventListener === 'function') {
      root.addEventListener('keydown', function (e) {
        if (!e || !e.code) { return; }
        fallbackInput.down[e.code] = true;
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'Space') {
          fallbackInput.dashQueued = true;
        }
      }, false);
      root.addEventListener('keyup', function (e) {
        if (!e || !e.code) { return; }
        fallbackInput.down[e.code] = false;
      }, false);
      root.addEventListener('blur', function () {
        fallbackInput.down = Object.create(null);
        fallbackInput.dashQueued = false;
      }, false);
    }
    return fallbackInput;
  }

  function readAxis() {
    var c = core();
    var input = c && c.Input;
    if (input && typeof input.axis === 'function') {
      try {
        var axis = input.axis();
        if (axis && typeof axis === 'object') {
          return { x: num(axis.x, 0), y: num(axis.y, 0) };
        }
      } catch (e) { /* 落到内置键盘读取 */ }
    }
    var keys = ensureFallbackInput().down;
    var x = ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0);
    var y = ((keys.KeyS || keys.ArrowDown) ? 1 : 0) - ((keys.KeyW || keys.ArrowUp) ? 1 : 0);
    return { x: x, y: y };
  }

  function readDashPressed() {
    var c = core();
    var input = c && c.Input;
    if (input && typeof input.dashPressed === 'function') {
      try { return !!input.dashPressed(); } catch (e) { /* 落到内置键盘读取 */ }
    }
    var fallback = ensureFallbackInput();
    if (fallback.dashQueued) {
      fallback.dashQueued = false;
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * 世界/障碍：轴分离碰撞 + 世界钳制（不卡死）
   * ------------------------------------------------------------------ */

  function collectObstacles(world) {
    if (!world) { return null; }
    var raw = world.obstacles || world.OBSTACLES || world.walls || null;
    if (!raw) { return null; }
    if (Array.isArray(raw)) { return raw; }
    if (Array.isArray(raw.items)) { return raw.items; }
    if (Array.isArray(raw.list)) { return raw.list; }
    if (typeof raw.forEach === 'function') {
      var collected = [];
      try {
        raw.forEach(function (o) { if (o) { collected.push(o); } });
        return collected;
      } catch (e) { return null; }
    }
    return null;
  }

  function circleHit(px, py, pr, list) {
    if (!list) { return null; }
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o) { continue; }
      var or = num(o.r, num(o.radius, 0));
      if (or <= 0) { continue; }
      var dx = px - num(o.x, 0);
      var dy = py - num(o.y, 0);
      var rr = pr + or;
      if (dx * dx + dy * dy < rr * rr) { return o; }
    }
    return null;
  }

  function worldBounds(world) {
    var bounds = world && world.bounds;
    if (bounds && typeof bounds === 'object') {
      var bx1 = num(bounds.minX, NaN);
      var by1 = num(bounds.minY, NaN);
      var bx2 = num(bounds.maxX, NaN);
      var by2 = num(bounds.maxY, NaN);
      if (isFinite(bx1) && isFinite(by1) && isFinite(bx2) && isFinite(by2) && bx2 > bx1 && by2 > by1) {
        return { minX: bx1, minY: by1, maxX: bx2, maxY: by2 };
      }
    }
    var w = num(world && (world.width || world.worldWidth || world.w), cfgNum(['worldWidth', 'WORLD_WIDTH'], 3840));
    var h = num(world && (world.height || world.worldHeight || world.h), cfgNum(['worldHeight', 'WORLD_HEIGHT'], 2160));
    var margin = cfgNum(['worldMargin', 'WORLD_MARGIN'], 40);
    return { minX: margin, minY: margin, maxX: w - margin, maxY: h - margin };
  }

  function clampToWorld(player, world) {
    var b = worldBounds(world);
    var minX = b.minX + player.r;
    var maxX = b.maxX - player.r;
    var minY = b.minY + player.r;
    var maxY = b.maxY - player.r;
    if (minX > maxX) { minX = maxX = (b.minX + b.maxX) / 2; }
    if (minY > maxY) { minY = maxY = (b.minY + b.maxY) / 2; }
    player.x = Math.min(Math.max(player.x, minX), maxX);
    player.y = Math.min(Math.max(player.y, minY), maxY);
  }

  function movePlayer(player, dx, dy, world) {
    var obstacles = collectObstacles(world);

    // 轴分离：X 受阻只停 X，Y 仍可滑动，贴墙不卡死。
    if (dx) {
      var nx = player.x + dx;
      if (!circleHit(nx, player.y, player.r, obstacles)) { player.x = nx; }
    }
    if (dy) {
      var ny = player.y + dy;
      if (!circleHit(player.x, ny, player.r, obstacles)) { player.y = ny; }
    }

    clampToWorld(player, world);

    // 出生点嵌入障碍等极端情况：按最小平移推出，避免永久卡住。
    if (obstacles) {
      for (var iter = 0; iter < 2; iter++) {
        var hit = circleHit(player.x, player.y, player.r, obstacles);
        if (!hit) { break; }
        var or = num(hit.r, num(hit.radius, 0));
        var ddx = player.x - num(hit.x, 0);
        var ddy = player.y - num(hit.y, 0);
        var d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d < 1e-4) { ddx = 1; ddy = 0; d = 1; }
        var overlap = (player.r + or) - d;
        if (overlap > 0) {
          player.x += (ddx / d) * overlap;
          player.y += (ddy / d) * overlap;
        } else {
          break;
        }
      }
      clampToWorld(player, world);
    }
  }

  /* ------------------------------------------------------------------ *
   * 玩家
   * ------------------------------------------------------------------ */

  function defaultStats() {
    return {
      atk: cfgNum(['playerAtk', 'PLAYER_ATK'], 12),
      atkInterval: cfgNum(['playerAtkInterval', 'PLAYER_ATK_INTERVAL'], 0.55),
      projectileCount: cfgNum(['playerProjectileCount', 'PROJECTILE_COUNT'], 1),
      range: cfgNum(['projectileRange', 'PLAYER_RANGE', 'PLAYER_ATTACK_RANGE'], 340),
      speed: cfgNum(['playerSpeed', 'PLAYER_SPEED', 'moveSpeed'], 220),
      pickupRadius: cfgNum(['pickupRadius', 'PLAYER_PICKUP_RADIUS'], 30),
      magnetRadius: cfgNum(['magnetRadius', 'PLAYER_MAGNET_RADIUS'], 80),
      maxHp: cfgNum(['playerMaxHp', 'PLAYER_MAX_HP'], 100),
      level: 1,
      xp: 0,
      xpNext: cfgNum(['xpNext', 'XP_NEXT'], 40),

      /* v2 战斗结算字段（由 sects 写入，combat 只读） */
      critRate: cfgNum(['critRate', 'CRIT_RATE'], 0),
      critMult: cfgNum(['critMult', 'CRIT_MULT'], 1.5),
      damageReduction: cfgNum(['damageReduction', 'DAMAGE_REDUCTION'], 0),
      regen: cfgNum(['regen', 'REGEN'], 0),

      /* v2 只读加法字段：sects 写、combat/loot 读；缺失时用基线默认值 */
      pierce: cfgProjectile('pierce', 1),
      projectileSpeed: cfgProjectile('speed', 620),
      potionDropMult: cfgNum(['potionDropMult', 'POTION_DROP_MULT'], 1),
      potionHealBonus: cfgNum(['potionHealBonus', 'POTION_HEAL_BONUS'], 0)
    };
  }

  function isActivePlayer(self) {
    // 只让当前单例响应事件，避免重开时旧实例重复扣血/升级。
    return !combat.player || combat.player === self;
  }

  /* 程序化动效常量：只影响绘制，不参与移动/碰撞/数值。 */
  var MOTION_TILT_MAX = 3 * Math.PI / 180;
  var HURT_RECOIL_TIME = 0.09;
  var HURT_SOURCE = { x: 0, y: 0, found: false };

  /**
   * 事件不带攻击者坐标时，只读扫描怪物池找最近存活怪作为受击来源。
   * 复用 HURT_SOURCE，不分配对象。
   */
  function nearestThreat(world, px, py) {
    HURT_SOURCE.found = false;
    var monsters = world && world.monsters;
    var pool = monsters && monsters.pool;
    var items = null;
    if (Array.isArray(monsters)) {
      items = monsters;
    } else if (monsters && Array.isArray(monsters.items)) {
      items = monsters.items;
    } else if (pool && Array.isArray(pool.items)) {
      items = pool.items;
    }
    if (!items) { return HURT_SOURCE; }

    var bestSq = Infinity;
    for (var i = 0; i < items.length; i++) {
      var m = items[i];
      if (!m || m.alive === false || m.dead === true) { continue; }
      if (typeof m.hp === 'number' && m.hp <= 0) { continue; }
      var dx = num(m.x, 0) - px;
      var dy = num(m.y, 0) - py;
      var dsq = dx * dx + dy * dy;
      if (dsq < bestSq) {
        bestSq = dsq;
        HURT_SOURCE.x = num(m.x, 0);
        HURT_SOURCE.y = num(m.y, 0);
        HURT_SOURCE.found = true;
      }
    }
    return HURT_SOURCE;
  }

  /**
   * @constructor
   * @param {{x?:number,y?:number,r?:number,hp?:number}} [options]
   */
  function Player(options) {
    options = options || {};
    this.x = num(options.x, cfgNum(['playerStartX'], 1920));
    this.y = num(options.y, cfgNum(['playerStartY'], 1080));
    this.r = num(options.r, cfgNum(['playerRadius', 'PLAYER_RADIUS'], 14));

    this.baseMaxHp = cfgNum(['playerMaxHp', 'PLAYER_MAX_HP'], 100);
    this.stats = defaultStats();
    this.maxHp = num(this.stats.maxHp, this.baseMaxHp);
    if (!(this.maxHp > 0)) { this.maxHp = this.baseMaxHp; }
    this.hp = num(options.hp, this.maxHp);
    this.dead = false;

    /* 记录 stats.maxHp 的已消费值：sects 写 stats.maxHp 后由 combat 镜像到实体。 */
    this._statsMaxHpSeen = this.maxHp;

    this.facingX = 1;
    this.facingY = 0;

    this.dashDistance = cfgNum(['dashDistance', 'DASH_DISTANCE'], 120);
    this.dashDuration = cfgNum(['dashDuration', 'DASH_DURATION'], 0.16);
    this.dashCooldownTotal = cfgNum(['dashCooldown', 'DASH_COOLDOWN'], 1.6);
    this.dashInvulnTime = cfgNum(['dashInvuln', 'DASH_INVULN'], 0.18);

    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashDirX = 1;
    this.dashDirY = 0;
    this.invuln = 0;

    /* v2 每秒回血计时器（暂停/非 playing 不推进） */
    this.regenTimer = 0;

    /* 程序化动效状态：累计时间、水平速度、平滑倾斜、受击后退。仅绘制使用。 */
    this.motionTime = 0;
    this.motionVX = 0;
    this.motionTilt = 0;
    this.moving = false;
    this.hurtTimer = 0;
    this.hurtDirX = 0;
    this.hurtDirY = 0;

    this.elapsed = 0;
    this._elapsedFallback = 0;
    this.world = null;

    this._onHurtHandler = null;
    this._onLevelUpHandler = null;
    this._bindBus();
  }

  Player.prototype._bindBus = function () {
    var self = this;
    this._onHurtHandler = function (payload) { self._handleHurtEvent(payload); };
    this._onLevelUpHandler = function (payload) { self._handleLevelUp(payload); };
    busOn('player:hurt', this._onHurtHandler);
    busOn('level:up', this._onLevelUpHandler);
  };

  Player.prototype.destroy = function () {
    if (this._onHurtHandler) { busOff('player:hurt', this._onHurtHandler); }
    if (this._onLevelUpHandler) { busOff('level:up', this._onLevelUpHandler); }
    this._onHurtHandler = null;
    this._onLevelUpHandler = null;
  };

  /**
   * monsters 发来的受伤事件（带 amount 才扣血）；
   * 本模块回发的 {hp,maxHp} 不带 amount，因此不会被再次扣血。
   */
  Player.prototype._handleHurtEvent = function (payload) {
    if (!isActivePlayer(this) || this.dead || !payload) { return; }
    var amount = num(payload.amount, num(payload.damage, NaN));
    if (!isFinite(amount) || amount <= 0) { return; }
    var dealt = this.takeDamage(amount);
    // 只有真实扣血才后退；无敌期/归零伤害不抖。
    if (dealt > 0) { this._startHurtRecoil(payload); }
  };

  /** 受击后退方向：优先事件来源坐标，其次最近怪，最后取朝向反方向。 */
  Player.prototype._startHurtRecoil = function (payload) {
    var px = num(this.x, 0);
    var py = num(this.y, 0);
    var sx = payload ? num(payload.sourceX, num(payload.attackerX, num(payload.x, NaN))) : NaN;
    var sy = payload ? num(payload.sourceY, num(payload.attackerY, num(payload.y, NaN))) : NaN;
    var found = isFinite(sx) && isFinite(sy);
    if (!found) {
      var source = nearestThreat(this.world, px, py);
      if (source.found) {
        sx = source.x;
        sy = source.y;
        found = true;
      }
    }

    var dx = found ? (px - sx) : -num(this.facingX, 1);
    var dy = found ? (py - sy) : -num(this.facingY, 0);
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 1e-6)) { dx = -1; dy = 0; len = 1; }
    this.hurtDirX = dx / len;
    this.hurtDirY = dy / len;
    this.hurtTimer = HURT_RECOIL_TIME;
  };

  /** 倾斜平滑趋近水平速度方向；固定步长、无分配。 */
  Player.prototype._updateMotionTilt = function (dt) {
    var speed = num(this.stats && this.stats.speed, 220);
    var target = 0;
    if (speed > 0) {
      target = this.motionVX / speed;
      if (target > 1) { target = 1; }
      if (target < -1) { target = -1; }
      target *= MOTION_TILT_MAX;
    }
    var k = dt * 12;
    if (k > 1) { k = 1; }
    this.motionTilt += (target - this.motionTilt) * k;
  };

  /**
   * 消费 'level:up'：v2 的 level:up 只带 {level}（loot 不写属性、不发 ability:unlock）。
   * 本模块只镜像 stats.level 供 HUD 只读展示；成长字段由 sects 在 level:up 中重算，
   * combat 不写任何成长数值（交付计划 §3.1）。
   */
  Player.prototype._handleLevelUp = function (payload) {
    if (!isActivePlayer(this) || !payload) { return; }
    if (typeof payload.level === 'number' && isFinite(payload.level)) {
      this.stats.level = payload.level;
    }
  };

  /**
   * 消费 sects 写入 stats.maxHp 的变化：combat 只镜像上限，不改成长字段。
   * 上限变化只钳制当前 HP：门派开局的满血同步由 Selection.selectSect 完成，
   * 铁骨（vigor）的即时回复由 Selection.choose 调用 player.heal() 完成；
   * 本模块不额外补血，避免与 sects 的回复语义重复叠加。
   */
  Player.prototype._syncStats = function () {
    var stats = this.stats;
    if (!stats || typeof stats !== 'object') { return; }
    if (typeof this._statsMaxHpSeen !== 'number' || !isFinite(this._statsMaxHpSeen)) {
      this._statsMaxHpSeen = this.maxHp;
    }
    var nextMax = num(stats.maxHp, this.maxHp);
    if (nextMax > 0 && nextMax !== this._statsMaxHpSeen) {
      this.maxHp = nextMax;
      if (this.hp > this.maxHp) { this.hp = this.maxHp; }
      this._statsMaxHpSeen = nextMax;
    }
  };

  /**
   * v2 每秒回复：按 stats.regen 每秒回血，封顶 maxHp。
   * Loop.paused 或 world.state !== 'playing' 时完全不累计。
   */
  Player.prototype._updateRegen = function (dt, world) {
    if (this.dead) { return; }
    var regen = num(this.stats && this.stats.regen, 0);
    if (!(regen > 0)) {
      this.regenTimer = 0;
      return;
    }
    if (simulationPaused(world)) { return; }

    this.regenTimer += dt;
    if (this.regenTimer < 1) { return; }
    var ticks = Math.floor(this.regenTimer);
    this.regenTimer -= ticks;
    this.heal(regen * ticks);
  };

  /**
   * 扣血；先按 stats.damageReduction 减伤（下限 0），再扣 HP。
   * 无敌期（含闪身无敌）返回 0 且不发事件。
   * @param {number} amount
   * @returns {number} 实际扣除量
   */
  Player.prototype.takeDamage = function (amount) {
    var value = num(amount, 0);
    if (this.dead || value <= 0) { return 0; }
    if (this.invuln > 0) { return 0; }

    var reduction = num(this.stats && this.stats.damageReduction, 0);
    if (!isFinite(reduction) || reduction < 0) { reduction = 0; }
    if (reduction > 1) { reduction = 1; }

    var reduced = value * (1 - reduction);
    if (!isFinite(reduced) || reduced < 0) { reduced = 0; }

    var dealt = Math.min(this.hp, reduced);
    this.hp -= dealt;
    if (this.hp < 0) { this.hp = 0; }

    busEmit('player:hurt', { hp: this.hp, maxHp: this.maxHp });

    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this._emitDead();
    }
    return dealt;
  };

  /**
   * 回血（疗伤丹 / 升级回复 / regen）：封顶 maxHp，返回实际恢复量。
   * 不改事件契约：HP 由 UI 每帧只读，回血不发 player:hurt（避免误判为受伤）。
   * @param {number} amount
   * @returns {number} 实际恢复的 HP
   */
  Player.prototype.heal = function (amount) {
    var value = num(amount, 0);
    if (this.dead || value <= 0) { return 0; }
    this._syncStats();
    var maxHp = num(this.maxHp, 0);
    if (!(maxHp > 0) || this.hp >= maxHp) { return 0; }
    var healed = Math.min(maxHp - this.hp, value);
    this.hp += healed;
    return healed;
  };

  Player.prototype._emitDead = function () {
    var runTime = this.getRunTime();
    var kills = 0;
    if (this.world && typeof this.world.kills === 'number') {
      kills = this.world.kills;
    } else {
      var c = core();
      if (c && c.state && typeof c.state.kills === 'number') { kills = c.state.kills; }
    }
    busEmit('player:dead', { runTime: runTime, kills: kills });
  };

  Player.prototype.getRunTime = function () {
    var c = core();
    if (c && c.Loop && typeof c.Loop.simTime === 'number') { return c.Loop.simTime; }
    return this._elapsedFallback;
  };

  /**
   * 闪身：0.16 s 位移 120 px、冷却 1.6 s、无敌 0.18 s（v2 架构 §4.3）。
   * @param {number} [dirX]
   * @param {number} [dirY]
   * @returns {boolean} 是否成功触发
   */
  Player.prototype.dash = function (dirX, dirY) {
    if (this.dead || this.dashCooldown > 0 || this.dashTimer > 0) { return false; }

    var dx = num(dirX, NaN);
    var dy = num(dirY, NaN);
    if (!isFinite(dx) || !isFinite(dy) || (dx === 0 && dy === 0)) {
      var axis = readAxis();
      dx = axis.x;
      dy = axis.y;
    }
    if (!dx && !dy) {
      dx = this.facingX;
      dy = this.facingY;
    }

    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) { dx = 1; dy = 0; len = 1; }

    this.dashDirX = dx / len;
    this.dashDirY = dy / len;
    this.facingX = this.dashDirX;
    this.facingY = this.dashDirY;

    this.dashTimer = this.dashDuration;
    this.dashCooldown = this.dashCooldownTotal;
    this.invuln = Math.max(this.invuln, this.dashInvulnTime);
    return true;
  };

  /**
   * 驱动玩家（组合根按 §5.1 调用 Player.move）。
   * 顺序：计时器 → 闪身触发 → 位移（闪身/常规）。
   */
  Player.prototype.move = function (dt, world) {
    dt = num(dt, 1 / 60);
    if (dt <= 0) { return; }
    if (world) { this.world = world; }
    this._elapsedFallback += dt;

    // 动效累计时间与受击后退计时：固定步长推导，不参与玩法。
    this.motionTime += dt;
    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      if (this.hurtTimer < 0) { this.hurtTimer = 0; }
    }

    this._syncStats();
    this._updateRegen(dt, world);

    if (this.dashCooldown > 0) {
      this.dashCooldown -= dt;
      if (this.dashCooldown < 0) { this.dashCooldown = 0; }
    }
    if (this.invuln > 0) {
      this.invuln -= dt;
      if (this.invuln < 0) { this.invuln = 0; }
    }

    if (this.dead) {
      this.moving = false;
      this.motionVX = 0;
      this._updateMotionTilt(dt);
      return;
    }

    if (this.dashTimer <= 0 && readDashPressed()) {
      this.dash();
    }

    if (this.dashTimer > 0) {
      var dashSpeed = this.dashDuration > 0 ? (this.dashDistance / this.dashDuration) : 0;
      var step = dashSpeed * Math.min(dt, this.dashTimer);
      movePlayer(this, this.dashDirX * step, this.dashDirY * step, world);
      this.moving = true;
      this.motionVX = this.dashDirX * dashSpeed;
      this._updateMotionTilt(dt);
      this.dashTimer -= dt;
      if (this.dashTimer < 0) { this.dashTimer = 0; }
      return;
    }

    var axis = readAxis();
    var ax = num(axis.x, 0);
    var ay = num(axis.y, 0);
    var len = Math.sqrt(ax * ax + ay * ay);
    if (len < 1e-6) {
      this.moving = false;
      this.motionVX = 0;
      this._updateMotionTilt(dt);
      return;
    }

    // 斜向归一化，保证八向同速。
    ax /= len;
    ay /= len;
    this.facingX = ax;
    this.facingY = ay;

    var moveSpeed = num(this.stats.speed, cfgNum(['playerSpeed', 'PLAYER_SPEED'], 220));
    var dist = moveSpeed * dt;
    movePlayer(this, ax * dist, ay * dist, world);
    this.moving = true;
    this.motionVX = ax * moveSpeed;
    this._updateMotionTilt(dt);
  };

  // 框架 §5.1 使用 Player.move；同时提供 update 别名，便于组合根按系统惯例驱动。
  Player.prototype.update = Player.prototype.move;

  /**
   * 重开一局时复位位置/HP/计时器。成长属性由 loot 的 applyGrowth 负责，这里不触碰。
   * 组合根调用 `player.reset(world)`，因此首参也可能是世界对象（取世界中心出生）。
   */
  Player.prototype.reset = function (x, y) {
    var startX = x;
    var startY = y;
    if (x && typeof x === 'object') {
      var w = x;
      startX = num(w.width, cfgNum(['worldWidth', 'WORLD_WIDTH'], 3840)) / 2;
      startY = num(w.height, cfgNum(['worldHeight', 'WORLD_HEIGHT'], 2160)) / 2;
      this.world = w;
    }
    this.x = num(startX, cfgNum(['playerStartX'], 1920));
    this.y = num(startY, cfgNum(['playerStartY'], 1080));
    this.maxHp = Math.max(this.maxHp, this.baseMaxHp);
    this.hp = this.maxHp;
    this.dead = false;

    // v2：等级/经验归 loot；重开时把 stats 上的只读镜像归位，避免 HUD 残留旧等级。
    // 成长字段（atk/atkInterval/maxHp/speed/critRate...）仍由 sects 重算，不在此写。
    if (this.stats && typeof this.stats === 'object') {
      this.stats.level = 1;
      this.stats.xp = 0;
      this.stats.xpNext = initialXpNext();
    }

    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.invuln = 0;
    this.regenTimer = 0;
    this.facingX = 1;
    this.facingY = 0;
    this.motionTime = 0;
    this.motionVX = 0;
    this.motionTilt = 0;
    this.moving = false;
    this.hurtTimer = 0;
    this.hurtDirX = 0;
    this.hurtDirY = 0;
    this._elapsedFallback = 0;
    this._statsMaxHpSeen = num(this.stats && this.stats.maxHp, this.maxHp);
  };

  /* ------------------------------------------------------------------ *
   * 公开契约
   * ------------------------------------------------------------------ */

  combat.Player = Player;
  if (!combat.player) {
    combat.player = new Player();
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
