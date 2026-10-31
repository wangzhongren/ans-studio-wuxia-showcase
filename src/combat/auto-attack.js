/**
 * 江湖夜雨 · combat-player / 自动攻击与技能执行
 *
 * 契约：docs/contracts/wuxia-rogue-v2-architecture-v1.md §4.3、§5
 * 公开：WG.combat.CombatSystem
 * 依赖：WG.core.SpatialHash（索敌/命中查询）、WG.core.Bus（事件）、
 *       WG.core.Pool（剑气对象池）；缺失时全部降级为内置实现。
 *
 * 交互：
 * - 命中统一 emit('damage', { targetId, amount, crit, x, y })，由 monsters 扣血；
 *   本模块绝不直接修改怪物数据。crit 由 stats.critRate 掷骰、命中时按
 *   stats.critMult 放大，骰子走 world.rng（与 ?seed= 同一条可复现序列）。
 * - v2 技能由 sects 的 'choice:pick' 解锁（不再订阅 ability:unlock）：
 *   dm_cleave 裂空（4s/半径120/200% 攻击）、whirl 剑气回旋（1.5s/95/18）、
 *   swords 万剑归宗（12s/420/60）、twin 双剑气（自动攻击额外 1 道）。
 *   技能伤害同样走 'damage' 事件，表现由 fx 订阅。
 */
(function (root) {
  'use strict';
  if (!root) { return; }

  var WG = root.WG || (root.WG = {});
  var combat = WG.combat || (WG.combat = {});

  /* ------------------------------------------------------------------ *
   * 基础设施
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
    var groups = [c, c.player, c.combat, c.COMBAT];
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

  /** 读取嵌套的 CONFIG.player.projectile.*；缺失时回退到调用方默认值。 */
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

  function busEmit(type, payload) {
    var c = core();
    if (c && c.Bus && typeof c.Bus.emit === 'function') {
      try { c.Bus.emit(type, payload); } catch (e) { /* 总线故障不影响模拟 */ }
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

  /** Loop 暂停或世界不在 playing 时，技能计时/索敌/投射物不推进。 */
  function simulationPaused(world) {
    var c = core();
    if (c && c.Loop && c.Loop.paused) { return true; }
    if (world && typeof world.state === 'string' && world.state !== 'playing') { return true; }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * 对象池：优先用 WG.core.Pool，缺失时内置同 API 的兜底池
   * ------------------------------------------------------------------ */

  function makeProjectile() {
    return {
      active: false,
      x: 0, y: 0, vx: 0, vy: 0, r: 6,
      damage: 0,
      life: 0,
      range: 0,
      traveled: 0,
      hitsLeft: 0,
      pierce: 0,
      angle: 0,
      hitIds: []
    };
  }

  function resetProjectile(p) {
    p.active = false;
    p.x = 0;
    p.y = 0;
    p.vx = 0;
    p.vy = 0;
    p.damage = 0;
    p.life = 0;
    p.range = 0;
    p.traveled = 0;
    p.hitsLeft = 0;
    p.pierce = 0;
    p.angle = 0;
    if (p.hitIds) { p.hitIds.length = 0; } else { p.hitIds = []; }
  }

  function fallbackPool(cap, factory, reset) {
    var items = [];
    var cursor = 0;
    return {
      count: 0,
      spawn: function () {
        var item;
        if (items.length < cap) {
          item = factory();
          items.push(item);
          this.count = items.length;
        } else {
          item = items[cursor % cap];
          cursor += 1;
        }
        if (reset) { reset(item); }
        return item;
      },
      forEach: function (fn) {
        for (var i = 0; i < items.length; i++) { fn(items[i], i); }
      },
      releaseAll: function () {
        for (var i = 0; i < items.length; i++) {
          if (reset) { reset(items[i]); }
        }
        items.length = 0;
        cursor = 0;
        this.count = 0;
      }
    };
  }

  function createPool(cap, factory, reset) {
    var c = core();
    if (c && typeof c.Pool === 'function') {
      try { return new c.Pool(cap, factory, reset); } catch (e) { /* 兜底 */ }
    }
    return fallbackPool(cap, factory, reset);
  }

  /* ------------------------------------------------------------------ *
   * 空间查询（SpatialHash 公开契约，缺失时防御性回退到怪物池）
   * ------------------------------------------------------------------ */

  function resolveHash(world) {
    if (world) {
      var worldCandidates = [world.spatialHash, world.hash, world.spatial];
      for (var i = 0; i < worldCandidates.length; i++) {
        var wh = worldCandidates[i];
        if (wh && typeof wh.queryCircle === 'function') { return wh; }
      }
    }
    var c = core();
    if (c) {
      var coreCandidates = [c.spatialHash, c.hash];
      for (var j = 0; j < coreCandidates.length; j++) {
        var ch = coreCandidates[j];
        if (ch && typeof ch.queryCircle === 'function') { return ch; }
      }
      // 某些组合根可能把单例方法挂在构造器上。
      if (c.SpatialHash && typeof c.SpatialHash.queryCircle === 'function') { return c.SpatialHash; }
    }
    return null;
  }

  /**
   * @returns {Array|null} null 表示查询不可用（应回退）；[] 表示确实没有结果。
   */
  function queryCircle(hash, x, y, radius) {
    if (!hash) { return null; }
    var out = [];
    try {
      var res = hash.queryCircle(x, y, radius, out);
      if (res && typeof res.length === 'number') { return res; }
      return out;
    } catch (e) {
      return null;
    }
  }

  function monstersFromWorld(world) {
    if (!world) { return null; }
    var monsters = world.monsters;
    if (!monsters) { return null; }
    if (Array.isArray(monsters)) { return monsters; }
    if (Array.isArray(monsters.items)) { return monsters.items; }
    var pool = monsters.pool;
    if (pool) {
      if (Array.isArray(pool)) { return pool; }
      if (Array.isArray(pool.items)) { return pool.items; }
      if (typeof pool.forEach === 'function') {
        var collected = [];
        try {
          pool.forEach(function (m) { if (m) { collected.push(m); } });
          return collected;
        } catch (e) { return null; }
      }
    }
    return null;
  }

  var DROP_KINDS = { xp: 1, exp: 1, gold: 1, silver: 1, potion: 1, heal: 1 };

  function isMonster(entity) {
    if (!entity || entity === combat.player) { return false; }
    if (entity.alive === false || entity.dead === true) { return false; }
    if (typeof entity.hp === 'number' && entity.hp <= 0) { return false; }
    if (entity.isDrop === true) { return false; }
    if (typeof entity.kind === 'string' && DROP_KINDS[entity.kind]) { return false; }
    if (entity.isMonster === true) { return true; }
    if (typeof entity.hp === 'number') { return true; }
    if (typeof entity.type === 'string' || entity.monsterType) { return true; }
    // 空间哈希里的实体默认视为怪物（掉落物已在上面按 kind 排除）。
    return entity.id !== undefined && entity.id !== null;
  }

  function entityRadius(entity) {
    return num(entity.r, num(entity.radius, 14));
  }

  function monsterId(entity) {
    if (!entity) { return null; }
    if (entity.id !== undefined && entity.id !== null) { return entity.id; }
    if (entity.uid !== undefined && entity.uid !== null) { return entity.uid; }
    if (entity.monsterId !== undefined && entity.monsterId !== null) { return entity.monsterId; }
    return null;
  }

  function queryMonsters(world, x, y, radius, exclude) {
    var hash = resolveHash(world);
    var list = hash ? queryCircle(hash, x, y, radius) : null;

    // 哈希缺失或尚未重建时回退到怪物池，保证 core 未就绪也能防御性运行。
    if (list === null || list.length === 0) {
      var fallback = monstersFromWorld(world);
      if (fallback) { list = fallback; }
    }
    if (!list) { return []; }

    var result = [];
    var radiusSq = radius * radius;
    for (var i = 0; i < list.length; i++) {
      var entity = list[i];
      if (!entity || entity === exclude || !isMonster(entity)) { continue; }
      var dx = num(entity.x, 0) - x;
      var dy = num(entity.y, 0) - y;
      if (dx * dx + dy * dy > radiusSq) { continue; }
      result.push(entity);
    }
    return result;
  }

  function nearestMonster(world, x, y, radius, exclude) {
    var list = queryMonsters(world, x, y, radius, exclude);
    var best = null;
    var bestDistSq = Infinity;
    for (var i = 0; i < list.length; i++) {
      var entity = list[i];
      var dx = num(entity.x, 0) - x;
      var dy = num(entity.y, 0) - y;
      var distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = entity;
      }
    }
    return best;
  }

  function withinDropRange(player, target, dropRadius) {
    if (!target || !isMonster(target)) { return false; }
    var dx = num(target.x, 0) - player.x;
    var dy = num(target.y, 0) - player.y;
    return dx * dx + dy * dy <= dropRadius * dropRadius;
  }

  /* ------------------------------------------------------------------ *
   * 技能：v2 由 sects choice:pick 解锁，数值优先读 loot tables（若提供），
   * 否则用方案 §6.4 基线
   * ------------------------------------------------------------------ */

  var ABILITY_FALLBACKS = {
    cleave: { radius: 120, damage: 0, interval: 4, mult: 2 },
    whirlwind: { radius: 95, damage: 18, interval: 1.5 },
    swordRain: { radius: 420, damage: 60, interval: 12 }
  };

  /**
   * v2 choice 选项 id → 内部技能键。
   * dm_cleave=裂空、whirl=剑气回旋、swords=万剑归宗、twin=双剑气。
   * 重复/别名统一收敛，确保不会重复叠加。
   */
  function normalizeChoice(rawId) {
    if (rawId === null || typeof rawId === 'undefined') { return null; }
    var key = String(rawId).toLowerCase().replace(/[\s_-]/g, '');
    if (key === 'dmcleave' || key === 'cleave' || key === '裂空') {
      return 'cleave';
    }
    if (key === 'whirl' || key === 'whirlwind' || key === 'swirl' || key === 'swordwhirl' ||
        key === '剑气回旋' || key === '回旋') {
      return 'whirlwind';
    }
    if (key === 'swords' || key === 'swordrain' || key === 'wanjian' || key === 'swordrainfall' ||
        key === '万剑归宗' || key === '万剑') {
      return 'swordRain';
    }
    if (key === 'twin' || key === 'twinqi' || key === 'doubleshot' || key === 'doubleqi' ||
        key === '双剑气') {
      return 'twin';
    }
    return null;
  }

  function normalizeAbility(rawId) {
    var id = normalizeChoice(rawId);
    return id === 'twin' ? null : id;
  }

  function abilityEntries() {
    var loot = WG.loot;
    var tables = loot && loot.tables;
    if (!tables) { return []; }

    var sources = [
      tables.ABILITIES, tables.abilities,
      tables.SKILLS, tables.skills,
      tables.SKILL_TABLE, tables.skillTable,
      tables.MILESTONES, tables.milestones,
      tables.ABILITY_TABLE, tables.abilityTable
    ];

    var entries = [];
    for (var i = 0; i < sources.length; i++) {
      var source = sources[i];
      if (!source) { continue; }
      if (Array.isArray(source)) {
        for (var a = 0; a < source.length; a++) {
          if (source[a] && typeof source[a] === 'object') { entries.push(source[a]); }
        }
      } else if (typeof source === 'object') {
        for (var key in source) {
          if (!Object.prototype.hasOwnProperty.call(source, key)) { continue; }
          var entry = source[key];
          if (entry && typeof entry === 'object') {
            if (entry.id === undefined) {
              // 不污染 loot 的表对象：只读拷贝需要的字段。
              entries.push({
                id: key,
                radius: entry.radius,
                damage: entry.damage,
                interval: entry.interval,
                cooldown: entry.cooldown,
                cd: entry.cd
              });
            } else {
              entries.push(entry);
            }
          }
        }
      }
    }
    return entries;
  }

  function abilityConfig(id) {
    var base = ABILITY_FALLBACKS[id];
    var radius = base ? base.radius : 0;
    var damage = base ? base.damage : 0;
    var interval = base ? base.interval : 1;
    var mult = base && typeof base.mult === 'number' ? base.mult : 2;

    var entries = abilityEntries();
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var entryId = normalizeAbility(entry.id !== undefined ? entry.id : entry.name);
      if (entryId !== id) { continue; }
      if (typeof entry.radius === 'number' && isFinite(entry.radius)) { radius = entry.radius; }
      if (typeof entry.damage === 'number' && isFinite(entry.damage)) { damage = entry.damage; }
      var cooldown = entry.interval;
      if (typeof cooldown !== 'number') { cooldown = entry.cooldown; }
      if (typeof cooldown !== 'number') { cooldown = entry.cd; }
      if (typeof cooldown === 'number' && isFinite(cooldown)) { interval = cooldown; }
      if (typeof entry.damageMul === 'number' && isFinite(entry.damageMul)) {
        mult = entry.damageMul;
      }
      break;
    }

    return {
      radius: Math.max(1, radius),
      damage: Math.max(0, damage),
      interval: Math.max(0.1, interval),
      mult: Math.max(0, mult)
    };
  }

  /* ------------------------------------------------------------------ *
   * CombatSystem
   * ------------------------------------------------------------------ */

  /**
   * @constructor
   * @param {{player?:Object}} [options] 也可直接传入玩家实例
   */
  function CombatSystem(options) {
    var opts = options || {};
    var directPlayer = null;
    if (opts && typeof opts.x === 'number' && opts.stats) {
      directPlayer = opts;
      opts = {};
    }

    this.player = opts.player || directPlayer || combat.player || null;

    this.target = null;
    this.attackTimer = 0;
    this.retargetTimer = 0;
    this.retargetInterval = Math.max(0.01, cfgNum(['retargetInterval', 'TARGET_REFRESH'], 0.1));
    this.acquireRadius = cfgNum(['acquireRadius', 'ATTACK_ACQUIRE_RADIUS'], 170);
    this.dropRadius = cfgNum(['dropRadius', 'TARGET_DROP_RADIUS'], 220);

    var cap = Math.floor(cfgNum(['projectileCap', 'MAX_PROJECTILES'], 200));
    if (!(cap > 0)) { cap = 200; }
    this.projectilePool = createPool(cap, makeProjectile, resetProjectile);

    var cleave = abilityConfig('cleave');
    var whirlwind = abilityConfig('whirlwind');
    var swordRain = abilityConfig('swordRain');
    this.abilities = {
      cleave: {
        id: 'cleave',
        choiceId: 'dm_cleave',
        unlocked: false,
        timer: 0,
        radius: cleave.radius,
        damage: cleave.damage,
        mult: cleave.mult,
        interval: cleave.interval
      },
      whirlwind: {
        id: 'whirlwind',
        choiceId: 'whirl',
        unlocked: false,
        timer: 0,
        radius: whirlwind.radius,
        damage: whirlwind.damage,
        interval: whirlwind.interval
      },
      swordRain: {
        id: 'swordRain',
        choiceId: 'swords',
        unlocked: false,
        timer: 0,
        radius: swordRain.radius,
        damage: swordRain.damage,
        interval: swordRain.interval
      }
    };

    /* twin 为被动：布尔标志，重复选择不叠加额外剑气。 */
    this.twin = false;

    this.lastAbility = null;
    this.lastChoice = null;
    this.world = null;

    // 渲染动画相位（仅为绘制服务，不参与玩法判定）
    this.whirlPhase = 0;
    this.swordRainFlash = 0;
    this.swordRainX = 0;
    this.swordRainY = 0;
    this.swordRainRadius = 0;
    this.cleaveFlash = 0;
    this.cleaveX = 0;
    this.cleaveY = 0;
    this.cleaveRadius = 0;

    /* 程序化动效状态（仅绘制）：攻击前冲、武器挥动、冲刺残影生成间隔。 */
    this.attackAnimTimer = 0;
    this.weaponSwingTimer = 0;
    this.attackDirX = 0;
    this.attackDirY = 0;
    this.dashSpawnTimer = 0;

    this._onChoicePickHandler = null;
    this._bindBus();
  }

  CombatSystem.prototype._bindBus = function () {
    var self = this;
    // v2：ability:unlock 已停用，成长改由 sects 的 choice:pick 承接。
    this._onChoicePickHandler = function (payload) {
      self._onChoicePick(payload);
    };
    busOn('choice:pick', this._onChoicePickHandler);
  };

  CombatSystem.prototype.destroy = function () {
    if (this._onChoicePickHandler) {
      busOff('choice:pick', this._onChoicePickHandler);
      this._onChoicePickHandler = null;
    }
    if (this.projectilePool && typeof this.projectilePool.releaseAll === 'function') {
      this.projectilePool.releaseAll();
    }
    this.target = null;
  };

  CombatSystem.prototype._resolvePlayer = function () {
    if (this.player) { return this.player; }
    if (combat.player) { this.player = combat.player; }
    return this.player;
  };

  /* v2 choice 字段探测：sects 可直接写 stats 标志，也可维护 modifiers。 */
  var CHOICE_STAT_KEYS = {
    cleave: ['dm_cleave', 'dmCleave', 'cleave', 'cleaveUnlocked', 'ability_dm_cleave'],
    whirlwind: ['whirl', 'whirlUnlocked', 'whirlwind', 'ability_whirl'],
    swordRain: ['swords', 'swordRain', 'swordsUnlocked', 'ability_swords'],
    twin: ['twin', 'twinQi', 'doubleShot', 'doubleQi', 'ability_twin']
  };

  function truthyFlag(value) {
    if (value === true) { return true; }
    return typeof value === 'number' && isFinite(value) && value > 0;
  }

  function statsHasChoice(stats, keys, canonical) {
    if (!stats || typeof stats !== 'object') { return false; }
    var i;
    for (i = 0; i < keys.length; i++) {
      if (truthyFlag(stats[keys[i]])) { return true; }
    }
    var bags = [stats.abilities, stats.unlocked, stats.choices];
    for (var b = 0; b < bags.length; b++) {
      var bag = bags[b];
      if (!bag) { continue; }
      if (Array.isArray(bag)) {
        for (i = 0; i < bag.length; i++) {
          if (normalizeChoice(bag[i]) === canonical) { return true; }
        }
      } else if (typeof bag === 'object') {
        if (truthyFlag(bag[canonical])) { return true; }
        for (i = 0; i < keys.length; i++) {
          if (truthyFlag(bag[keys[i]])) { return true; }
        }
      }
    }
    return false;
  }

  function selectionHasChoice(canonical) {
    var sects = WG.sects;
    var selection = sects && sects.Selection;
    var modifiers = selection && selection.modifiers;
    if (!modifiers || typeof modifiers !== 'object') { return false; }
    for (var key in modifiers) {
      if (!Object.prototype.hasOwnProperty.call(modifiers, key)) { continue; }
      if (normalizeChoice(key) === canonical && truthyFlag(modifiers[key])) {
        return true;
      }
    }
    return false;
  }

  /**
   * 处理 sects 的 choice:pick。重复选择同一技能不会重置计时或重复叠加。
   * @param {string} rawId optionId
   * @param {Object} [payload]
   * @returns {Object|boolean|null}
   */
  CombatSystem.prototype.applyChoice = function (rawId, payload) {
    var id = normalizeChoice(rawId);
    if (!id) { return null; }
    var level = payload && typeof payload.level === 'number' && isFinite(payload.level)
      ? payload.level : null;

    if (id === 'twin') {
      if (!this.twin) {
        this.twin = true;
        this.lastChoice = { id: 'twin', level: level };
      }
      return this.twin;
    }

    var ability = this.abilities[id];
    if (!ability) { return null; }
    if (!ability.unlocked) {
      var conf = abilityConfig(id);
      ability.radius = conf.radius;
      ability.damage = conf.damage;
      ability.interval = conf.interval;
      if (id === 'cleave') { ability.mult = conf.mult; }
      ability.timer = ability.interval;
      ability.unlocked = true;
      this.lastChoice = { id: ability.choiceId || id, level: level };
    }
    return ability;
  };

  CombatSystem.prototype._onChoicePick = function (payload) {
    if (!payload) { return; }
    var rawId = payload.optionId;
    if (rawId === undefined || rawId === null) { rawId = payload.id; }
    if (rawId === undefined || rawId === null) { rawId = payload.abilityId; }
    this.applyChoice(rawId, payload);
  };

  /** 兼容旧调用：能力 id 也走同一幂等入口。 */
  CombatSystem.prototype.unlockAbility = function (rawId) {
    return this.applyChoice(rawId, null);
  };

  /**
   * 读取 sects 写入 stats/modifiers 的标志；即使 choice:pick 丢失也能补齐。
   * 每帧只读、仅在未解锁时触发，幂等且不重复叠加。
   */
  CombatSystem.prototype._syncChoiceFlags = function (player) {
    var stats = player && player.stats;
    if (!stats && !(WG.sects && WG.sects.Selection)) { return; }

    var ids = ['cleave', 'whirlwind', 'swordRain', 'twin'];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (id === 'twin') {
        if (this.twin) { continue; }
      } else if (this.abilities[id] && this.abilities[id].unlocked) {
        continue;
      }
      var keys = CHOICE_STAT_KEYS[id];
      if (statsHasChoice(stats, keys, id) || selectionHasChoice(id)) {
        this.applyChoice(id, null);
      }
    }
  };

  /**
   * 每帧驱动：索敌 → 发射 → 剑气推进/命中 → 技能计时。
   * @param {number} dt
   * @param {Object} [world]
   */
  CombatSystem.prototype.update = function (dt, world) {
    dt = num(dt, 1 / 60);
    if (dt <= 0) { return; }

    var player = this._resolvePlayer();
    if (!player) { return; }
    if (world) { this.world = world; }
    var activeWorld = world || this.world || null;

    // v2：即使 choice:pick 丢失，也从 sects 写入的 stats/modifiers 补齐技能。
    this._syncChoiceFlags(player);

    // 暂停（升级三选一）或非 playing：计时/索敌/投射物都不推进。
    if (simulationPaused(activeWorld)) { return; }

    // 表现相位（只影响绘制，不参与判定）
    this.whirlPhase += dt * 3.2;
    if (this.whirlPhase > Math.PI * 2) { this.whirlPhase -= Math.PI * 2; }
    if (this.swordRainFlash > 0) {
      this.swordRainFlash -= dt;
      if (this.swordRainFlash < 0) { this.swordRainFlash = 0; }
    }
    if (this.cleaveFlash > 0) {
      this.cleaveFlash -= dt;
      if (this.cleaveFlash < 0) { this.cleaveFlash = 0; }
    }
    if (this.attackAnimTimer > 0) {
      this.attackAnimTimer -= dt;
      if (this.attackAnimTimer < 0) { this.attackAnimTimer = 0; }
    }
    if (this.weaponSwingTimer > 0) {
      this.weaponSwingTimer -= dt;
      if (this.weaponSwingTimer < 0) { this.weaponSwingTimer = 0; }
    }

    // 冲刺残影：仅在未降级时按固定间隔写入模块级槽位；寿命随 dt 衰减。
    if (player.dashTimer > 0 && decorEnabled()) {
      this.dashSpawnTimer -= dt;
      var spawned = 0;
      while (this.dashSpawnTimer <= 0 && spawned < AFTERIMAGE_CAP) {
        spawnAfterimage(player);
        this.dashSpawnTimer += AFTERIMAGE_INTERVAL;
        spawned += 1;
      }
    } else {
      this.dashSpawnTimer = 0;
    }
    updateAfterimages(dt);

    if (player.dead) {
      this.target = null;
    } else {
      this.updateTargeting(dt, player, activeWorld);
      this.updateAttack(dt, player, activeWorld);
      this.updateAbilities(dt, player, activeWorld);
    }

    this.updateProjectiles(dt, activeWorld);
  };

  CombatSystem.prototype.updateTargeting = function (dt, player, world) {
    // 目标存活且仍在 220 px 内则保持锁定，否则重选。
    if (this.target && (!isMonster(this.target) || !withinDropRange(player, this.target, this.dropRadius))) {
      this.target = null;
      this.retargetTimer = 0;
    }
    if (this.target) { return; }

    this.retargetTimer -= dt;
    if (this.retargetTimer > 0) { return; }

    this.target = nearestMonster(world, player.x, player.y, this.acquireRadius, player);
    this.retargetTimer = this.retargetInterval;
  };

  CombatSystem.prototype.updateAttack = function (dt, player, world) {
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      if (this.attackTimer < 0) { this.attackTimer = 0; }
    }
    if (this.attackTimer > 0) { return; }
    if (!this.target || !isMonster(this.target)) { return; }

    this.fire(player, this.target, world);

    var interval = num(player.stats && player.stats.atkInterval, cfgNum(['playerAtkInterval', 'ATK_INTERVAL'], 0.55));
    if (interval < 0.05) { interval = 0.05; }
    this.attackTimer = interval;
  };

  /**
   * 发射剑气（projectileCount 发，间隔 18°）；伤害只经 'damage' 事件。
   * @returns {number} 实际发射数量
   */
  CombatSystem.prototype.fire = function (player, target, world) {
    if (!player || !target) { return 0; }

    var stats = player.stats || {};
    var count = Math.max(1, Math.floor(num(stats.projectileCount, 1)));
    if (this.twin) {
      // sects 的 recompute 会把双剑气折算进 projectileCount（+1；基线 ≥1 ⇒ ≥2）。
      // 若 stats.twin 存在但数量仍停在基线（≤1），或 stats 完全没有该标志
      //（例如直接 choice:pick 的独立用法），这里补 1 道；已折算时不重复叠加。
      var statsTwin = truthyFlag(stats.twin);
      var statsCount = num(stats.projectileCount, 0);
      if (!statsTwin || statsCount <= 1) { count += 1; }
    }
    var baseAngle = Math.atan2(num(target.y, 0) - player.y, num(target.x, 0) - player.x);
    var spread = cfgNum(['projectileSpread', 'PROJECTILE_SPREAD'], 18) * Math.PI / 180;
    var speed = Math.max(1, num(stats.projectileSpeed, cfgProjectile('speed', 620)));
    var range = num(stats.range, cfgNum(['projectileRange', 'PROJECTILE_RANGE'], 340));
    var damage = num(stats.atk, cfgNum(['playerAtk', 'PLAYER_ATK'], 12));
    var radius = cfgNum(['projectileRadius', 'PROJECTILE_RADIUS'], cfgProjectile('radius', 6));
    var pierce = Math.max(0, Math.floor(num(stats.pierce, cfgProjectile('pierce', 1))));
    var life = range / speed;

    var fired = 0;
    for (var i = 0; i < count; i++) {
      var angle = baseAngle + (i - (count - 1) / 2) * spread;
      var p = this.projectilePool.spawn();
      if (!p) { continue; }

      var cos = Math.cos(angle);
      var sin = Math.sin(angle);
      var offset = num(player.r, 14) + radius + 2;

      p.active = true;
      p.x = player.x + cos * offset;
      p.y = player.y + sin * offset;
      p.vx = cos * speed;
      p.vy = sin * speed;
      p.r = radius;
      p.damage = damage;
      p.life = life;
      p.range = range;
      p.traveled = 0;
      p.pierce = pierce;
      p.hitsLeft = 1 + pierce; // “穿透 1 个目标” = 可命中 2 个目标
      p.angle = angle;
      if (p.hitIds) { p.hitIds.length = 0; } else { p.hitIds = []; }
      fired += 1;
    }

    player.facingX = Math.cos(baseAngle);
    player.facingY = Math.sin(baseAngle);
    if (fired > 0) {
      // 攻击动效：60ms 前冲后回收；武器挥动 140ms。只影响绘制。
      this.attackAnimTimer = ATTACK_MOTION_TIME;
      this.weaponSwingTimer = WEAPON_SWING_TIME;
      this.attackDirX = Math.cos(baseAngle);
      this.attackDirY = Math.sin(baseAngle);
    }
    return fired;
  };

  CombatSystem.prototype.updateProjectiles = function (dt, world) {
    var self = this;
    var activeWorld = world || this.world || null;

    this.projectilePool.forEach(function (p) {
      if (!p || !p.active) { return; }

      var dx = p.vx * dt;
      var dy = p.vy * dt;
      p.x += dx;
      p.y += dy;
      p.traveled += Math.sqrt(dx * dx + dy * dy);
      p.life -= dt;

      if (p.life <= 0 || p.traveled >= p.range) {
        p.active = false;
        return;
      }

      self.hitTest(p, activeWorld);
      if (p.hitsLeft <= 0) { p.active = false; }
    });
  };

  /**
   * 剑气与怪物圆形碰撞：命中后发 'damage' 事件（不直接改怪物数据）。
   * 无参调用时对全部活跃剑气做一次判定。
   * @param {Object} [projectile]
   * @param {Object} [world]
   * @returns {boolean} 本帧是否发生命中
   */
  CombatSystem.prototype.hitTest = function (projectile, world) {
    var self = this;
    var activeWorld = world || this.world || null;

    if (!projectile) {
      var anyHit = false;
      this.projectilePool.forEach(function (p) {
        if (p && p.active && self.hitTest(p, activeWorld)) { anyHit = true; }
      });
      return anyHit;
    }

    var p = projectile;
    if (!p.active) { return false; }

    var hash = resolveHash(activeWorld);
    var candidates = null;
    if (hash) {
      candidates = queryCircle(hash, p.x, p.y, (p.r || 6) + 64);
    }
    if (candidates === null || candidates.length === 0) {
      candidates = monstersFromWorld(activeWorld);
    }
    if (!candidates) { return false; }

    var hitAny = false;
    for (var i = 0; i < candidates.length; i++) {
      var monster = candidates[i];
      if (!monster || !isMonster(monster)) { continue; }

      var id = monsterId(monster);
      if (id === null) { continue; }
      if (p.hitIds && p.hitIds.indexOf(id) !== -1) { continue; }

      var dx = num(monster.x, 0) - p.x;
      var dy = num(monster.y, 0) - p.y;
      var rr = (p.r || 6) + entityRadius(monster);
      if (dx * dx + dy * dy > rr * rr) { continue; }

      emitDamage(id, p.damage, p.x, p.y, activeWorld);
      if (!p.hitIds) { p.hitIds = []; }
      p.hitIds.push(id);
      p.hitsLeft -= 1;
      hitAny = true;
      if (p.hitsLeft <= 0) { break; }
    }
    return hitAny;
  };

  CombatSystem.prototype.updateAbilities = function (dt, player, world) {
    var ids = ['cleave', 'whirlwind', 'swordRain'];
    for (var i = 0; i < ids.length; i++) {
      var ability = this.abilities[ids[i]];
      if (!ability || !ability.unlocked) { continue; }

      ability.timer -= dt;
      if (ability.timer > 0) { continue; }

      ability.timer += ability.interval;
      if (ability.timer <= 0) { ability.timer = ability.interval; }

      this.castAbility(ability, player, world);
    }
  };

  /**
   * 范围技能：对半径内全部存活怪各发一次 'damage'。
   * cleave 按 200% 攻击力结算，其余技能读自身 damage。
   * @returns {number} 命中数量
   */
  CombatSystem.prototype.castAbility = function (ability, player, world) {
    if (!ability || !player) { return 0; }
    var stats = player.stats || {};
    var damage = ability.id === 'cleave'
      ? Math.max(0, num(stats.atk, 0) * num(ability.mult, 2))
      : ability.damage;
    var targets = queryMonsters(world, player.x, player.y, ability.radius, player);

    for (var i = 0; i < targets.length; i++) {
      var monster = targets[i];
      var id = monsterId(monster);
      if (id === null) { continue; }
      emitDamage(id, damage, num(monster.x, player.x), num(monster.y, player.y), world);
    }

    // 万剑：短暂的全屏剑雨主体环（细节特效仍由 fx 负责，不新增跨模块事件）
    if (ability.id === 'swordRain') {
      this.swordRainFlash = 0.35;
      this.swordRainX = player.x;
      this.swordRainY = player.y;
      this.swordRainRadius = ability.radius;
    }
    // 裂空：半径 120 的斩击环
    if (ability.id === 'cleave') {
      this.cleaveFlash = 0.25;
      this.cleaveX = player.x;
      this.cleaveY = player.y;
      this.cleaveRadius = ability.radius;
    }

    // 只读记录，供调试/工装查看；不新增跨模块事件。
    this.lastAbility = {
      id: ability.id,
      x: player.x,
      y: player.y,
      radius: ability.radius,
      damage: damage,
      hits: targets.length
    };
    return targets.length;
  };

  /* ------------------------------------------------------------------ *
   * 渲染（main 已施加相机变换；此处只画世界坐标）
   * 固定复用模块级绘制状态与回调，避免逐帧新建对象。
   * ------------------------------------------------------------------ */

  var RENDER = {
    ctx: null,
    assets: null,
    decor: true,
    hasCam: false,
    x0: 0, x1: 0, y0: 0, y1: 0
  };

  /* 复用给 WG.fx.assets.draw 的 opts，避免逐帧新建对象（bridge §1.5/§3）。 */
  var PLAYER_DRAW_OPTS = { flipX: false, alpha: 1, anchor: 'center' };
  var SWORD_DRAW_OPTS = { angle: 0, alpha: 1, anchor: 'center' };
  var WEAPON_DRAW_OPTS = { flipX: false, alpha: 1, anchor: 'center', angle: 0 };
  var AFTERIMAGE_OPTS = { flipX: false, alpha: 1, anchor: 'center' };

  /* 程序化动效参数（motion-plan §3）；全部由绘制变换推导，不写玩法数值。 */
  var TWO_PI = Math.PI * 2;
  var MOTION_BOB_HEIGHT = 3;
  var MOTION_BOB_PERIOD = 0.9;
  var MOTION_BREATH_HEIGHT = 1.5;
  var MOTION_BREATH_PERIOD = 2.6;
  var ATTACK_LUNGE_DISTANCE = 6;
  var ATTACK_LUNGE_TIME = 0.06;
  var ATTACK_MOTION_TIME = 0.18;
  var WEAPON_SWING_TIME = 0.14;
  var WEAPON_SWING_MAX = 35 * Math.PI / 180;
  var HURT_RECOIL_DISTANCE = 5;
  var HURT_RECOIL_TIME = 0.09; // 与 player.js 保持一致
  var AFTERIMAGE_CAP = 6;
  var AFTERIMAGE_LIFE = 0.16;
  var AFTERIMAGE_INTERVAL = 0.03;

  /* 冲刺残影：模块级预分配槽位，环形复用；不逐帧 new。 */
  var AFTERIMAGES = new Array(AFTERIMAGE_CAP);
  var afterimageCursor = 0;
  for (var ai0 = 0; ai0 < AFTERIMAGE_CAP; ai0++) {
    AFTERIMAGES[ai0] = { active: false, x: 0, y: 0, life: 0, flipX: false };
  }

  /* 门派 → 武器贴图（bridge §2）；未识别的门派按剑处理。 */
  var WEAPON_BY_SECT = {
    jianzong: 'weapon-sword',
    daomen: 'weapon-blade',
    yigu: 'weapon-needle'
  };
  var SECT_STAT_FIELDS = ['sectId', 'sect', 'sectKey', 'school', 'faction'];

  /** 门派值可为字符串或 {id}/{sectId}/{key}；统一成小写 id，不写回任何状态。 */
  function sectIdOf(value) {
    var raw = null;
    if (typeof value === 'string') {
      raw = value;
    } else if (value && typeof value === 'object') {
      raw = value.id;
      if (typeof raw !== 'string') { raw = value.sectId; }
      if (typeof raw !== 'string') { raw = value.key; }
    }
    return (typeof raw === 'string' && raw) ? raw.toLowerCase() : '';
  }

  /**
   * 只读门派：优先 sects 公开 current()，缺失时读 player.stats 既有门派字段。
   * 不修改选择状态与 stats。
   */
  function readSectId(player) {
    var sects = WG.sects;
    var selection = sects && sects.Selection;
    if (selection && typeof selection.current === 'function') {
      try {
        var current = sectIdOf(selection.current());
        if (current) { return current; }
      } catch (e) { /* 回退 stats 字段 */ }
    }
    var stats = player && player.stats;
    if (stats && typeof stats === 'object') {
      for (var i = 0; i < SECT_STAT_FIELDS.length; i++) {
        var id = sectIdOf(stats[SECT_STAT_FIELDS[i]]);
        if (id) { return id; }
      }
    }
    return '';
  }

  function weaponForSect(sectId) {
    return WEAPON_BY_SECT[sectId] || 'weapon-sword';
  }

  /** 调共享加载器；缺图/未就绪/抛错一律返回 false，由调用方回退。 */
  function drawAsset(ctx, id, x, y, w, h, opts) {
    var assets = RENDER.assets;
    if (!assets) { return false; }
    try {
      return assets.draw(ctx, id, x, y, w, h, opts) === true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 武器图层：弟子贴图之后叠加，位于朝向一侧（约 r*0.95），尺寸约 r*1.5，
   * 按 facingX 翻转、不旋转。针缺省回退剑；两者都不可用返回 false 走几何短剑。
   * 降级时仍保留（核心可辨识元素）。
   */
  function drawWeaponLayer(ctx, player, px, py, pr, fx, fy, swingAngle) {
    if (!RENDER.assets) { return false; }
    var weaponId = weaponForSect(readSectId(player));
    var size = pr * 1.5;
    var wx = px + fx * pr * 0.95;
    var wy = py + fy * pr * 0.95;

    WEAPON_DRAW_OPTS.flipX = num(player.facingX, 1) < 0;
    WEAPON_DRAW_OPTS.alpha = 1;
    WEAPON_DRAW_OPTS.angle = num(swingAngle, 0);
    ctx.globalAlpha = 1;

    if (drawAsset(ctx, weaponId, wx, wy, size, size, WEAPON_DRAW_OPTS)) {
      return true;
    }
    if (weaponId === 'weapon-needle' &&
        drawAsset(ctx, 'weapon-sword', wx, wy, size, size, WEAPON_DRAW_OPTS)) {
      return true;
    }
    return false;
  }

  /** 武器贴图完全不可用时的几何短剑（沿用原渲染线条）。 */
  function drawWeaponFallback(ctx, px, py, pr, fx, fy) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#e8c37a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px + fx * (pr + 2), py + fy * (pr + 2));
    ctx.lineTo(px + fx * (pr + 13), py + fy * (pr + 13));
    ctx.stroke();
  }

  /** 移动浮动 / 待机呼吸；固定周期由 motionTime 推导。 */
  function motionBob(player) {
    var moving = !!player.moving;
    var period = moving ? MOTION_BOB_PERIOD : MOTION_BREATH_PERIOD;
    var amp = moving ? MOTION_BOB_HEIGHT : MOTION_BREATH_HEIGHT;
    return Math.sin(num(player.motionTime, 0) * TWO_PI / period) * amp;
  }

  /** 攻击前冲 60ms 后 120ms 回收，总 180ms。 */
  function attackLungeOffset(timer) {
    var t = num(timer, 0);
    if (!(t > 0)) { return 0; }
    var elapsed = ATTACK_MOTION_TIME - t;
    if (elapsed < 0) { elapsed = 0; }
    if (elapsed < ATTACK_LUNGE_TIME) {
      return ATTACK_LUNGE_DISTANCE * (elapsed / ATTACK_LUNGE_TIME);
    }
    var back = (elapsed - ATTACK_LUNGE_TIME) /
      (ATTACK_MOTION_TIME - ATTACK_LUNGE_TIME);
    if (back < 0) { back = 0; }
    if (back > 1) { back = 1; }
    return ATTACK_LUNGE_DISTANCE * (1 - back);
  }

  /** 武器挥动：-35° → +35°，140ms。 */
  function weaponSwingAngle(timer) {
    var t = num(timer, 0);
    if (!(t > 0)) { return 0; }
    var elapsed = WEAPON_SWING_TIME - t;
    var phase = elapsed / WEAPON_SWING_TIME;
    if (phase < 0) { phase = 0; }
    if (phase > 1) { phase = 1; }
    return -WEAPON_SWING_MAX + phase * WEAPON_SWING_MAX * 2;
  }

  /** 受击后退 5px / 90ms 衰减。 */
  function hurtRecoilOffset(player) {
    var t = num(player.hurtTimer, 0);
    if (!(t > 0)) { return 0; }
    var elapsed = HURT_RECOIL_TIME - t;
    var phase = elapsed / HURT_RECOIL_TIME;
    if (phase < 0) { phase = 0; }
    if (phase > 1) { phase = 1; }
    return HURT_RECOIL_DISTANCE * (1 - phase);
  }

  /** 脚下椭圆影子：宽≈实体宽×0.55、高≈实体宽×0.18、alpha≈0.25。 */
  function drawPlayerShadow(ctx, x, y, r) {
    var radiusX = r * 0.55;
    var radiusY = r * 0.18;
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(x, y + r * 0.82, radiusX, radiusY, 0, 0, TWO_PI);
    } else {
      // 无 ellipse 的老环境退化为圆，仍保持有界与不抛错。
      ctx.arc(x, y + r * 0.82, radiusX, 0, TWO_PI);
    }
    ctx.fill();
  }

  function spawnAfterimage(player) {
    var slot = AFTERIMAGES[afterimageCursor];
    afterimageCursor = (afterimageCursor + 1) % AFTERIMAGE_CAP;
    slot.active = true;
    slot.x = num(player.x, 0);
    slot.y = num(player.y, 0);
    slot.life = AFTERIMAGE_LIFE;
    slot.flipX = num(player.facingX, 1) < 0;
  }

  function updateAfterimages(dt) {
    for (var i = 0; i < AFTERIMAGE_CAP; i++) {
      var slot = AFTERIMAGES[i];
      if (!slot.active) { continue; }
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.life = 0;
        slot.active = false;
      }
    }
  }

  function resetAfterimages() {
    for (var i = 0; i < AFTERIMAGE_CAP; i++) {
      AFTERIMAGES[i].active = false;
      AFTERIMAGES[i].life = 0;
    }
    afterimageCursor = 0;
  }

  /** 残影 alpha 0.35→0；有玩家贴图用贴图，缺图用半透明圆。降级关闭。 */
  function drawAfterimages(ctx, player) {
    if (!RENDER.decor) { return; }
    var r = num(player.r, 14);
    var size = r * 3.4;
    for (var i = 0; i < AFTERIMAGE_CAP; i++) {
      var slot = AFTERIMAGES[i];
      if (!slot.active || !(slot.life > 0)) { continue; }
      var alpha = 0.35 * (slot.life / AFTERIMAGE_LIFE);
      if (alpha <= 0) { continue; }
      AFTERIMAGE_OPTS.flipX = slot.flipX;
      AFTERIMAGE_OPTS.alpha = alpha;
      ctx.globalAlpha = alpha;
      if (!drawAsset(ctx, 'player', slot.x, slot.y, size, size, AFTERIMAGE_OPTS)) {
        ctx.fillStyle = '#bfe9ff';
        ctx.beginPath();
        ctx.arc(slot.x, slot.y, r * 0.9, 0, TWO_PI);
        ctx.fill();
      }
    }
  }

  /** 只调用共享加载器；未实现/未就绪时返回 null（调用方回退几何）。 */
  function fxAssets() {
    var fx = WG.fx;
    var assets = fx && fx.assets;
    return (assets && typeof assets.draw === 'function') ? assets : null;
  }

  /** 降级开启时关闭装饰性拖尾（bridge §1.6）；贴图/几何仍绘制。 */
  function decorEnabled() {
    var fx = WG.fx;
    var degrade = fx && fx.degrade;
    return !(degrade && degrade.enabled);
  }

  function cullRadius(x, y, r) {
    if (!RENDER.hasCam) { return false; }
    return x + r < RENDER.x0 || x - r > RENDER.x1 || y + r < RENDER.y0 || y - r > RENDER.y1;
  }

  /**
   * 剑气拖尾：3 段半透明菱形，沿速度反方向、越远越淡、尺寸略缩。
   * 全程只用数字与复用局部变量，不新建对象。
   */
  function drawProjectileTrail(ctx, p, ux, uy, r) {
    ctx.fillStyle = '#bfe9ff';
    for (var i = 3; i >= 1; i--) {
      var scale = 1 - i * 0.18;
      var halfLen = r * 1.6 * scale;
      var halfWid = r * 0.55 * scale;
      var dist = (r * 1.5 + 4) * i;
      var tx = p.x - ux * dist;
      var ty = p.y - uy * dist;
      ctx.globalAlpha = 0.26 * (1 - (i - 1) * 0.32);
      ctx.beginPath();
      ctx.moveTo(tx + ux * halfLen, ty + uy * halfLen);
      ctx.lineTo(tx - uy * halfWid, ty + ux * halfWid);
      ctx.lineTo(tx - ux * halfLen, ty - uy * halfLen);
      ctx.lineTo(tx + uy * halfWid, ty - ux * halfWid);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawProjectile(p) {
    if (!p || !p.active) { return; }
    if (cullRadius(p.x, p.y, 18)) { return; }

    var ctx = RENDER.ctx;
    var angle = num(p.angle, 0);
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    var r = num(p.r, 6);

    // 拖尾沿实际速度反方向；速度缺失时退回角度方向。
    var ux = cos;
    var uy = sin;
    var vx = num(p.vx, 0);
    var vy = num(p.vy, 0);
    var vlen = Math.sqrt(vx * vx + vy * vy);
    if (vlen > 1e-6) { ux = vx / vlen; uy = vy / vlen; }

    if (RENDER.decor) { drawProjectileTrail(ctx, p, ux, uy, r); }

    // 优先贴图（按 p.angle 旋转）；返回 false 时回退几何，缺图不抛错。
    var drawn = false;
    var assets = RENDER.assets;
    if (assets) {
      var w = Math.max(20, r * 4);
      var h = Math.max(9, w * 0.44);
      SWORD_DRAW_OPTS.angle = angle;
      SWORD_DRAW_OPTS.alpha = 0.95;
      ctx.globalAlpha = 1;
      try {
        drawn = assets.draw(ctx, 'sword-qi', p.x, p.y, w, h, SWORD_DRAW_OPTS) === true;
      } catch (e) {
        drawn = false;
      }
    }
    if (drawn) { return; }

    // 回退：细长菱形 + 高亮剑尖
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#bfe9ff';
    ctx.beginPath();
    ctx.moveTo(p.x + cos * 12, p.y + sin * 12);
    ctx.lineTo(p.x - cos * 7 - sin * 3.5, p.y - sin * 7 + cos * 3.5);
    ctx.lineTo(p.x - cos * 3, p.y - sin * 3);
    ctx.lineTo(p.x - cos * 7 + sin * 3.5, p.y - sin * 7 - cos * 3.5);
    ctx.closePath();
    ctx.fill();

    // 高亮剑尖
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#f2fcff';
    ctx.beginPath();
    ctx.arc(p.x + cos * 5, p.y + sin * 5, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * 可选渲染钩子（core/main.js 在相机变换后调用）。
   * 绘制玩家主体/朝向、剑气、回旋光环与万剑主体环；细节特效仍归 fx。
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} alpha
   */
  CombatSystem.prototype.render = function (ctx, alpha) {
    if (!ctx || typeof ctx.beginPath !== 'function') { return; }

    var player = this._resolvePlayer();
    var c = core();
    var cam = c && c.Camera;
    var conf = cfg();

    if (cam && typeof cam.x === 'number' && typeof cam.w === 'number' &&
        typeof cam.h === 'number' && cam.w > 0 && cam.h > 0) {
      var margin = num((conf.fx || {}).cullMargin, 96);
      RENDER.hasCam = true;
      RENDER.x0 = cam.x - margin;
      RENDER.x1 = cam.x + cam.w + margin;
      RENDER.y0 = cam.y - margin;
      RENDER.y1 = cam.y + cam.h + margin;
    } else {
      RENDER.hasCam = false;
    }

    // 每帧只解析一次共享加载器/降级标志；未实现时保持 null 走几何回退。
    RENDER.assets = fxAssets();
    RENDER.decor = decorEnabled();

    ctx.save();
    var prevAlpha = (typeof ctx.globalAlpha === 'number') ? ctx.globalAlpha : 1;

    if (player && this.abilities.whirlwind.unlocked) {
      this._renderWhirl(ctx, player);
    }
    if (this.swordRainFlash > 0) {
      this._renderSwordRain(ctx);
    }
    if (this.cleaveFlash > 0) {
      this._renderCleave(ctx);
    }
    if (player && !player.dead) {
      this._renderPlayer(ctx, player);
    }

    RENDER.ctx = ctx;
    this.projectilePool.forEach(drawProjectile);
    RENDER.ctx = null;

    ctx.globalAlpha = prevAlpha;
    ctx.restore();
  };

  CombatSystem.prototype._renderPlayer = function (ctx, player) {
    var px = num(player.x, 0);
    var py = num(player.y, 0);
    var pr = num(player.r, 14);
    if (cullRadius(px, py, pr + 24)) { return; }

    var fx = num(player.facingX, 1);
    var fy = num(player.facingY, 0);
    var len = Math.sqrt(fx * fx + fy * fy);
    if (!(len > 1e-6)) { fx = 1; fy = 0; len = 1; }
    fx /= len;
    fy /= len;

    // 动效只改变绘制位置/角度：浮动、呼吸、倾斜、攻击前冲、受击后退。
    var bob = RENDER.decor ? motionBob(player) : 0;
    var tilt = RENDER.decor ? num(player.motionTilt, 0) : 0;
    var lunge = attackLungeOffset(this.attackAnimTimer);
    var lx = num(this.attackDirX, 0) * lunge;
    var ly = num(this.attackDirY, 0) * lunge;
    var recoil = hurtRecoilOffset(player);
    var hx = num(player.hurtDirX, 0) * recoil;
    var hy = num(player.hurtDirY, 0) * recoil;
    var visX = px + lx + hx;
    var visY = py + bob + ly + hy;

    // 影子先画、跟随玩家位置；残影在身体之前。
    drawPlayerShadow(ctx, px, py, pr);
    drawAfterimages(ctx, player);

    // 无敌外环
    if (player.invuln > 0) {
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = '#9fe3ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(visX, visY, pr + 4, 0, TWO_PI);
      ctx.stroke();
    }

    // 倾斜绕身体中心旋转；翻转仍只走 flipX，不改变绘制中心。
    var tilted = false;
    if (tilt && typeof ctx.translate === 'function' && typeof ctx.rotate === 'function') {
      ctx.save();
      ctx.translate(visX, visY);
      ctx.rotate(tilt);
      ctx.translate(-visX, -visY);
      tilted = true;
    }

    // 优先贴图：anchor center、尺寸按半径、按 facingX 水平翻转。
    // 加载器返回 false（未就绪/缺图）时回退下方既有几何，不抛错。
    var drawn = false;
    var assets = RENDER.assets;
    if (assets) {
      var size = pr * 3.4;
      PLAYER_DRAW_OPTS.flipX = num(player.facingX, 1) < 0;
      PLAYER_DRAW_OPTS.alpha = 1;
      ctx.globalAlpha = 1;
      drawn = drawAsset(ctx, 'player', visX, visY, size, size, PLAYER_DRAW_OPTS);
    }

    if (!drawn) {
      // 身体（武侠色几何体）
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e9dcc0';
      ctx.strokeStyle = '#5a2d29';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(visX, visY, pr, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();

      // 发髻/内环
      ctx.fillStyle = '#3b3b46';
      ctx.beginPath();
      ctx.arc(visX, visY, pr * 0.46, 0, TWO_PI);
      ctx.fill();
    }

    // 受击白闪（降级也保留）：90ms 内从 0.35 淡出。
    if (player.hurtTimer > 0) {
      var flash = num(player.hurtTimer, 0) / HURT_RECOIL_TIME;
      if (flash > 1) { flash = 1; }
      if (flash > 0) {
        ctx.globalAlpha = 0.35 * flash;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(visX, visY, pr * 1.05, 0, TWO_PI);
        ctx.fill();
      }
    }

    // 武器图层：门派贴图 + 挥动角度；针→剑→几何短剑。
    var swing = weaponSwingAngle(this.weaponSwingTimer);
    if (!drawWeaponLayer(ctx, player, visX, visY, pr, fx, fy, swing)) {
      drawWeaponFallback(ctx, visX, visY, pr, fx, fy);
    }

    if (tilted) { ctx.restore(); }
  };

  CombatSystem.prototype._renderWhirl = function (ctx, player) {
    var ability = this.abilities.whirlwind;
    var px = num(player.x, 0);
    var py = num(player.y, 0);
    var radius = num(ability.radius, 95);
    if (cullRadius(px, py, radius + 6)) { return; }

    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#4fd1a5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = '#7de3c0';
    ctx.lineWidth = 4;
    var phase = num(this.whirlPhase, 0);
    for (var k = 0; k < 3; k++) {
      var start = phase + k * (Math.PI * 2 / 3);
      ctx.beginPath();
      ctx.arc(px, py, radius, start, start + 0.9);
      ctx.stroke();
    }
  };

  CombatSystem.prototype._renderSwordRain = function (ctx) {
    var radius = num(this.swordRainRadius, 0);
    if (!(radius > 0)) { return; }
    if (cullRadius(this.swordRainX, this.swordRainY, radius)) { return; }

    var t = this.swordRainFlash / 0.35;
    if (t > 1) { t = 1; }
    if (t < 0) { t = 0; }

    ctx.globalAlpha = 0.16 * t;
    ctx.fillStyle = '#bfe9ff';
    ctx.beginPath();
    ctx.arc(this.swordRainX, this.swordRainY, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.55 * t;
    ctx.strokeStyle = '#e6f7ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.swordRainX, this.swordRainY, radius * (1 - 0.12 * (1 - t)), 0, Math.PI * 2);
    ctx.stroke();
  };

  CombatSystem.prototype._renderCleave = function (ctx) {
    var radius = num(this.cleaveRadius, 0);
    if (!(radius > 0)) { return; }
    if (cullRadius(this.cleaveX, this.cleaveY, radius)) { return; }

    var t = this.cleaveFlash / 0.25;
    if (t > 1) { t = 1; }
    if (t < 0) { t = 0; }

    ctx.globalAlpha = 0.18 * t;
    ctx.fillStyle = '#ffbf7a';
    ctx.beginPath();
    ctx.arc(this.cleaveX, this.cleaveY, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.7 * t;
    ctx.strokeStyle = '#ffd9a8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.cleaveX, this.cleaveY, radius * (0.82 + 0.18 * t), 0, Math.PI * 2);
    ctx.stroke();
  };

  /**
   * 重开一局：清空剑气与锁定目标（技能解锁/成长由 loot 状态决定，不在此回退）。
   */
  CombatSystem.prototype.reset = function (world) {
    if (world) {
      this.world = world;
      if (world.player) { this.player = world.player; }
    }
    if (!this.player) { this.player = combat.player || null; }

    this.target = null;
    this.attackTimer = 0;
    this.retargetTimer = 0;
    this.whirlPhase = 0;
    this.swordRainFlash = 0;
    this.swordRainRadius = 0;
    this.swordRainX = 0;
    this.swordRainY = 0;
    this.cleaveFlash = 0;
    this.cleaveRadius = 0;
    this.cleaveX = 0;
    this.cleaveY = 0;
    this.attackAnimTimer = 0;
    this.weaponSwingTimer = 0;
    this.attackDirX = 0;
    this.attackDirY = 0;
    this.dashSpawnTimer = 0;
    this.lastAbility = null;
    this.lastChoice = null;
    this.twin = false;

    resetAfterimages();

    if (this.projectilePool && typeof this.projectilePool.releaseAll === 'function') {
      this.projectilePool.releaseAll();
    }

    // v2：重开一局清空 choice 技能；新一局由 sects 重新写入。
    var ids = ['cleave', 'whirlwind', 'swordRain'];
    for (var i = 0; i < ids.length; i++) {
      var ability = this.abilities[ids[i]];
      if (ability) {
        ability.unlocked = false;
        ability.timer = 0;
      }
    }
    return this;
  };

  /* ------------------------------------------------------------------ *
   * 伤害事件（唯一命中出口）：按当前 stats.critRate/critMult 掷骰
   * ------------------------------------------------------------------ */

  var FALLBACK_RNG = null;
  var FALLBACK_RNG_SEED = null;

  /**
   * 优先使用 world.rng（与 ?seed= 同一条可复现序列）；
   * 无 world 的单元测试用固定种子兜底，避免 Math.random 破坏可复现性。
   */
  function rngFor(world) {
    if (world && world.rng && typeof world.rng.next === 'function') {
      return world.rng;
    }
    var c = core();
    var seed = (world && typeof world.seed === 'number' && isFinite(world.seed))
      ? (world.seed >>> 0)
      : 0x9e3779b9;
    if (!FALLBACK_RNG || FALLBACK_RNG_SEED !== seed) {
      FALLBACK_RNG = (c && typeof c.Rng === 'function')
        ? c.Rng(seed)
        : { next: Math.random };
      FALLBACK_RNG_SEED = seed;
    }
    return FALLBACK_RNG;
  }

  function combatStats(world) {
    var player = world && world.player;
    if (!player) { player = combat.player; }
    return (player && player.stats) || {};
  }

  function emitDamage(targetId, amount, x, y, world) {
    var base = num(amount, 0);
    if (!(base > 0)) { return; }

    var stats = combatStats(world);
    var rate = num(stats.critRate, 0);
    if (!isFinite(rate) || rate < 0) { rate = 0; }
    if (rate > 1) { rate = 1; }

    var crit = false;
    if (rate > 0) {
      var rng = rngFor(world);
      if (rng && typeof rng.next === 'function') {
        crit = rng.next() < rate;
      }
    }

    var finalAmount = base;
    if (crit) {
      var mult = num(stats.critMult, 1.5);
      if (!isFinite(mult) || mult < 0) { mult = 1.5; }
      finalAmount = base * mult;
    }

    busEmit('damage', {
      targetId: targetId,
      amount: finalAmount,
      crit: crit,
      x: x,
      y: y
    });
  }

  /* ------------------------------------------------------------------ *
   * 公开契约
   *
   * core/main.js 以「对象」方式使用 WG.combat.CombatSystem：
   *   world.combat = WG.combat.CombatSystem;
   *   call(world.combat, 'update' / 'render', ...)
   * 因此在加载时创建默认单例，并在构造器上暴露同名静态入口（同时保留
   * `new WG.combat.CombatSystem(...)` 供独立测试/工具使用）。
   * ------------------------------------------------------------------ */

  var defaultSystem = new CombatSystem(null);

  CombatSystem.update = function (dt, world) { return defaultSystem.update(dt, world); };
  CombatSystem.render = function (ctx, alpha) { return defaultSystem.render(ctx, alpha); };
  CombatSystem.hitTest = function (projectile, world) { return defaultSystem.hitTest(projectile, world); };
  CombatSystem.fire = function (player, target, world) { return defaultSystem.fire(player, target, world); };
  CombatSystem.castAbility = function (ability, player, world) { return defaultSystem.castAbility(ability, player, world); };
  CombatSystem.unlockAbility = function (rawId) { return defaultSystem.unlockAbility(rawId); };
  CombatSystem.applyChoice = function (rawId, payload) { return defaultSystem.applyChoice(rawId, payload); };
  CombatSystem.reset = function (world) { return defaultSystem.reset(world); };
  CombatSystem.destroy = function () { return defaultSystem.destroy(); };

  Object.defineProperty(CombatSystem, 'projectilePool', {
    enumerable: true,
    get: function () { return defaultSystem.projectilePool; }
  });
  Object.defineProperty(CombatSystem, 'abilities', {
    enumerable: true,
    get: function () { return defaultSystem.abilities; }
  });
  Object.defineProperty(CombatSystem, 'lastAbility', {
    enumerable: true,
    get: function () { return defaultSystem.lastAbility; }
  });
  Object.defineProperty(CombatSystem, 'target', {
    enumerable: true,
    get: function () { return defaultSystem.target; },
    set: function (value) { defaultSystem.target = value; }
  });
  Object.defineProperty(CombatSystem, 'player', {
    enumerable: true,
    get: function () { return defaultSystem.player; },
    set: function (value) { defaultSystem.player = value; }
  });

  combat.CombatSystem = CombatSystem;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
