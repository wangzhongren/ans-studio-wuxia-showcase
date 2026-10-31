/*!
 * 江湖夜雨 · sects-progression · selection.js
 * 契约：docs/contracts/wuxia-rogue-v2-architecture-v1.md §4.8 / §5.1 / §5.4
 * 公开：WG.sects.Selection = { selectSect(id), current(), choose(optionId),
 *                              modifiers, stacks(), reset(world) }
 *
 * 职责与边界：
 *   - 本模块是玩家「成长属性」的唯一写入点：门派初始属性 + 升级选项效果
 *     统一由 recompute() 基于 defs.init + CONFIG 基准重算后写入 WG.combat.player.stats；
 *   - 不写等级/经验（归 loot）、不写位置/计时（归 combat）；仅在门派落定时同步
 *     player.maxHp / player.hp 与 vigor 的即时回复（combat 公开字段/方法）；
 *   - 事件：selectSect → 'sect:selected' {sectId}；
 *            level:up → UpgradePool.offer → 'choice:offer' {level, options[3]}；
 *            choose → 应用效果 → 'choice:pick' {optionId, level}；
 *   - 不调用 Loop.pause/resume（由 main 订阅 choice:offer/pick 负责），
 *     未选择前绝不自动替选；连续升级时依次排队，逐级呈现。
 *
 * 成长字段清单（写入 stats）：
 *   atk, atkInterval, maxHp, speed, regen, critRate, critMult, damageReduction,
 *   projectileCount, range, pickupRadius, magnetRadius,
 *   pierce, projectileSpeed, potionDropMult, potionHealBonus,
 *   以及绝学/技能标志位 whirl, swords, twin, cleave。
 *   不写 level / xp / xpNext（归 loot）。
 *
 * 非抽选式：选项即时出现、选择即生效并消失，不跨局留存、不进入任何收集池。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var sects = WG.sects = WG.sects || {};

  var PROJECTILE_CAP = 3;   // 方案 §6.2：分光/连斩的剑气数量上限
  var ATK_INTERVAL_MIN = 0.18; // 方案 §6.2：疾风的攻速下限
  var DAMAGE_REDUCTION_CAP = 0.80;

  /* ------------------------------------------------------------------ *
   * 模块状态（本模块独占）
   * ------------------------------------------------------------------ */

  var modifiers = Object.create(null); // optionId -> 已叠层数（对外只读用）
  var state = {
    sectId: null,
    level: 1,
    currentOffer: null,   // { level, options }
    queue: [],           // 连续升级时暂存的等级，逐级呈现
    rng: null,
    world: null,
    pending: false,      // combat.player 尚未就绪时待补应用
    pendingTimer: null,
    picks: []            // 已选记录 [{id, level}]
  };

  /* ------------------------------------------------------------------ *
   * 基础设施（core / combat 缺失时全部降级，不抛异常）
   * ------------------------------------------------------------------ */

  function core() {
    return WG.core || null;
  }

  function cfg() {
    var c = core();
    return (c && c.CONFIG) || {};
  }

  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  function round4(v) {
    if (!isFinite(v)) { return 0; }
    return Math.round(v * 10000) / 10000;
  }

  function emit(type, payload) {
    var c = core();
    var bus = c && c.Bus;
    if (bus && typeof bus.emit === 'function') {
      try { bus.emit(type, payload); } catch (e) { /* 总线故障不打断升级流程 */ }
    }
  }

  /** 当前玩家单例（combat 未就绪时返回 null，不缓存引用）。 */
  function player() {
    var combat = WG.combat;
    var p = combat && combat.player;
    return (p && typeof p === 'object') ? p : null;
  }

  /* ------------------------------------------------------------------ *
   * 基准值：CONFIG 是数值唯一来源；核心缺失时用方案基线兜底
   * ------------------------------------------------------------------ */

  function baseConfig() {
    var c = cfg();
    var p = (c && c.player) || {};
    var projectile = p.projectile || {};
    return {
      projectileCount: num(p.projectileCount, 1),
      range: num(projectile.range, num(p.range, 340)),
      pickupRadius: num(p.pickupRadius, 30),
      magnetRadius: num(p.magnetRadius, 80),
      pierce: num(projectile.pierce, 1),
      projectileSpeed: num(projectile.speed, 620)
    };
  }

  /* ------------------------------------------------------------------ *
   * 属性重算：defs.init + CONFIG 基准 + 已叠层效果（唯一写入点）
   * ------------------------------------------------------------------ */

  function aggregateModifiers() {
    var m = {
      atkMul: 1,
      atkIntervalMul: 1,
      atkSpeedMul: 1,
      speedMul: 1,
      maxHpMul: 1,
      pickupMul: 1,
      magnetMul: 1,
      rangeMul: 1,
      projectileSpeedMul: 1,
      pierceAdd: 0,
      projectileAdd: 0,
      critMultAdd: 0,
      potionDropAdd: 0,
      potionHealAdd: 0,
      damageReductionAdd: 0,
      regenAdd: 0,
      twin: 0,
      flags: Object.create(null)
    };

    var pool = sects.UpgradePool;
    var options = pool && pool.OPTIONS;
    if (!options) { return m; }

    for (var id in modifiers) {
      if (!Object.prototype.hasOwnProperty.call(modifiers, id)) { continue; }
      var n = modifiers[id];
      if (typeof n !== 'number' || !isFinite(n) || n <= 0) { continue; }
      var option = options[id];
      var eff = option && option.effects;
      if (!eff) { continue; }

      if (eff.atkMul) { m.atkMul *= Math.pow(eff.atkMul, n); }
      if (eff.atkIntervalMul) { m.atkIntervalMul *= Math.pow(eff.atkIntervalMul, n); }
      if (eff.atkSpeedMul) { m.atkSpeedMul *= Math.pow(eff.atkSpeedMul, n); }
      if (eff.speedMul) { m.speedMul *= Math.pow(eff.speedMul, n); }
      if (eff.maxHpMul) { m.maxHpMul *= Math.pow(eff.maxHpMul, n); }
      if (eff.pickupMul) { m.pickupMul *= Math.pow(eff.pickupMul, n); }
      if (eff.magnetMul) { m.magnetMul *= Math.pow(eff.magnetMul, n); }
      if (eff.rangeMul) { m.rangeMul *= Math.pow(eff.rangeMul, n); }
      if (eff.projectileSpeedMul) { m.projectileSpeedMul *= Math.pow(eff.projectileSpeedMul, n); }
      if (eff.pierceAdd) { m.pierceAdd += eff.pierceAdd * n; }
      if (eff.projectileAdd) { m.projectileAdd += eff.projectileAdd * n; }
      if (eff.critMultAdd) { m.critMultAdd += eff.critMultAdd * n; }
      if (eff.potionDropAdd) { m.potionDropAdd += eff.potionDropAdd * n; }
      if (eff.potionHealAdd) { m.potionHealAdd += eff.potionHealAdd * n; }
      if (eff.damageReductionAdd) { m.damageReductionAdd += eff.damageReductionAdd * n; }
      if (eff.regenAdd) { m.regenAdd += eff.regenAdd * n; }
      if (eff.twinProjectile) { m.twin += eff.twinProjectile * n; }
      if (eff.flag) { m.flags[eff.flag] = true; }
    }
    return m;
  }

  /**
   * 基于门派基准重算全部成长字段并写入 player.stats。
   * 幂等：同一组门派/层数/等级得到同一组数值，避免增量叠加漂移。
   */
  function recompute() {
    var p = player();
    var def = sects.DEFS && sects.DEFS[state.sectId];
    if (!p || !def) { return false; }
    if (!p.stats || typeof p.stats !== 'object') { p.stats = {}; }

    var st = p.stats;
    var init = def.init || {};
    var base = baseConfig();
    var m = aggregateModifiers();

    // 剑宗被动：每 3 级额外 +5% 攻速（累积）
    var passiveIntervalMul = 1;
    if (def.passive && def.passive.kind === 'attackSpeedPer3Levels') {
      var steps = Math.floor(state.level / 3);
      if (steps > 0) {
        passiveIntervalMul = 1 / Math.pow(1 + num(def.passive.per3Levels, 0.05), steps);
      }
    }

    var atkInterval = num(init.atkInterval, 0.55) * m.atkIntervalMul *
      passiveIntervalMul / m.atkSpeedMul;
    if (atkInterval < ATK_INTERVAL_MIN) { atkInterval = ATK_INTERVAL_MIN; }

    st.atk = round4(num(init.atk, 12) * m.atkMul);
    st.atkInterval = round4(atkInterval);
    st.maxHp = round4(num(init.maxHp, 100) * m.maxHpMul);
    st.speed = round4(num(init.speed, 220) * m.speedMul);
    st.regen = round4(num(init.regen, 0) + m.regenAdd);
    st.critRate = round4(num(init.critRate, 0));
    st.critMult = round4(num(init.critMult, 1.5) + m.critMultAdd);
    st.damageReduction = round4(Math.min(
      DAMAGE_REDUCTION_CAP,
      Math.max(0, num(init.damageReduction, 0) + m.damageReductionAdd)
    ));

    st.pickupRadius = round4(base.pickupRadius * m.pickupMul);
    st.magnetRadius = round4(base.magnetRadius * m.magnetMul);
    st.range = round4(base.range * m.rangeMul);
    st.pierce = round4(base.pierce + m.pierceAdd);
    st.projectileSpeed = round4(base.projectileSpeed * m.projectileSpeedMul);
    st.projectileCount = Math.min(PROJECTILE_CAP, base.projectileCount + m.projectileAdd) + m.twin;

    st.potionDropMult = round4(1 + m.potionDropAdd);
    st.potionHealBonus = round4(m.potionHealAdd);

    // 绝学/技能标志位：供 combat / fx 只读
    st.whirl = !!m.flags.whirl;
    st.swords = !!m.flags.swords;
    st.cleave = !!m.flags.cleave;
    st.twin = m.twin > 0;

    // maxHp 由 combat 持有：成长值变化时同步，并钳制当前 HP 上限
    p.maxHp = st.maxHp;
    if (typeof p.hp === 'number' && p.hp > p.maxHp) { p.hp = p.maxHp; }
    return true;
  }

  /* ------------------------------------------------------------------ *
   * RNG：reset(world) 保存本局种子 RNG，后续抽取全部走它
   * ------------------------------------------------------------------ */

  function resolveRng(world) {
    if (world && world.rng && typeof world.rng.next === 'function') {
      return world.rng;
    }
    var c = core();
    if (world && typeof world.seed === 'number' && isFinite(world.seed) &&
        c && typeof c.Rng === 'function') {
      return c.Rng(world.seed >>> 0);
    }
    return null;
  }

  function ensureRng() {
    if (state.rng && typeof state.rng.next === 'function') { return state.rng; }
    if (state.world) {
      var fromWorld = resolveRng(state.world);
      if (fromWorld) {
        state.rng = fromWorld;
        return state.rng;
      }
    }
    var c = core();
    if (c && typeof c.Rng === 'function') {
      // 未经过 reset 的兜底序列：固定种子，保证仍可复现
      state.rng = c.Rng(0x5eed1234 >>> 0);
      return state.rng;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 玩家未就绪时的安全补应用（有限次重试，不阻塞流程）
   * ------------------------------------------------------------------ */

  function applyPending() {
    if (!state.sectId) {
      state.pending = false;
      return;
    }
    var p = player();
    if (!p) { return; }
    state.pending = false;
    recompute();
  }

  function schedulePendingRetry() {
    if (state.pendingTimer || typeof setTimeout !== 'function') { return; }
    var tries = 0;
    function retry() {
      state.pendingTimer = null;
      if (!state.pending) { return; }
      if (player()) {
        applyPending();
        return;
      }
      if (tries >= 10) { return; }
      tries += 1;
      state.pendingTimer = setTimeout(retry, 16);
    }
    state.pendingTimer = setTimeout(retry, 0);
  }

  /* ------------------------------------------------------------------ *
   * 公开 API
   * ------------------------------------------------------------------ */

  /** 当前门派 id（无门派时 null）。 */
  function current() {
    return state.sectId;
  }

  /** 已叠层数表（optionId -> 层数）。 */
  function stacks() {
    return modifiers;
  }

  /**
   * 新局复位：清空门派 / 已选选项 / 层数 / 待呈现队列，并保存本局 RNG。
   * 只动本模块状态与 RNG 引用，不重置 world 的其它状态。
   * @param {Object} [world] 组合根在 resetRunState 中传入
   */
  function reset(world) {
    for (var id in modifiers) {
      if (Object.prototype.hasOwnProperty.call(modifiers, id)) { delete modifiers[id]; }
    }
    state.sectId = null;
    state.level = 1;
    state.currentOffer = null;
    state.queue.length = 0;
    state.picks.length = 0;
    state.pending = false;
    if (state.pendingTimer) {
      if (typeof clearTimeout === 'function') { clearTimeout(state.pendingTimer); }
      state.pendingTimer = null;
    }
    if (world) {
      state.world = world;
      state.rng = resolveRng(world);
    }
    return true;
  }

  /**
   * 选定门派：首次/切换门派时应用初始属性到 WG.combat.player.stats，并同步 maxHp/hp。
   * 事件：仅首次选择或切换门派时发 'sect:selected' {sectId}（main.beginRun 据此开局）；
   *       同门派重复确认不发事件，重开由 UI 侧发 ui:restart 解决。
   * 幂等：同门派重复调用返回 true，不重算成长、不重复叠加、不回满 HP、不清已选层数。
   * @param {string} id jianzong | daomen | yigu
   * @returns {boolean}
   */
  function selectSect(id) {
    var def = sects.DEFS && sects.DEFS[id];
    if (!def) { return false; }

    var changed = (state.sectId !== id);
    var p = player();

    if (changed) {
      // 切换门派时清空上一门派的已选成长，基于基准重新开始
      for (var key in modifiers) {
        if (Object.prototype.hasOwnProperty.call(modifiers, key)) { delete modifiers[key]; }
      }
      state.sectId = id;
      state.currentOffer = null;
      state.queue.length = 0;
      state.picks.length = 0;

      if (p) {
        recompute();
        // 门派落定时与初始气血对齐（HP 归 combat，这里只做开局同步）
        p.maxHp = round4(num(def.init.maxHp, 100));
        p.hp = p.maxHp;
      } else {
        state.pending = true;
        schedulePendingRetry();
      }
    } else if (!p) {
      // 同门派重复确认：属性保持幂等，仅在玩家尚未就绪时记下待补应用
      state.pending = true;
      schedulePendingRetry();
    }

    // 仅首次选择或切换门派发事件；同门派重复确认保持幂等（不发事件、不触碰 stats/HP/成长）。
    // 同门派重开由 UI 侧发 ui:restart 触发 main.beginRun，不经 selectSect 发事件。
    if (changed) {
      emit('sect:selected', { sectId: id });
    }
    return true;
  }

  /**
   * 应用一个已选选项：记录层数 → 重算属性 → 发 choice:pick。
   * 未选择前不会被调用；同一选项达到上限后拒绝继续应用。
   * @param {string} optionId
   * @returns {boolean}
   */
  function choose(optionId) {
    if (typeof optionId !== 'string' || !optionId) { return false; }
    var pool = sects.UpgradePool;
    var option = pool && typeof pool.optionById === 'function' ? pool.optionById(optionId) : null;
    if (!option) { return false; }
    if (!state.sectId) { return false; }
    if (option.sect && option.sect !== state.sectId) { return false; }

    // 有未决呈现时，只能选本次呈现的选项（不自动替选）
    if (state.currentOffer) {
      var offered = false;
      var options = state.currentOffer.options || [];
      for (var i = 0; i < options.length; i++) {
        if (options[i] && options[i].id === optionId) { offered = true; break; }
      }
      if (!offered) { return false; }
    }

    var cap = (typeof option.maxStacks === 'number' && option.maxStacks > 0) ? option.maxStacks : 5;
    var cur = (typeof modifiers[optionId] === 'number') ? modifiers[optionId] : 0;
    if (cur >= cap) { return false; }

    modifiers[optionId] = cur + 1;
    var level = state.currentOffer ? state.currentOffer.level : state.level;
    state.picks.push({ id: optionId, level: level });

    var p = player();
    if (p) {
      recompute();
      // vigor 的即时回复（每选一次 20，不随层数倍增）
      var eff = option.effects || {};
      if (eff.healOnPick && typeof p.heal === 'function') {
        p.heal(eff.healOnPick);
      } else if (eff.healOnPick && typeof p.hp === 'number' && typeof p.maxHp === 'number') {
        p.hp = Math.min(p.maxHp, p.hp + eff.healOnPick);
      }
    } else {
      state.pending = true;
      schedulePendingRetry();
    }

    emit('choice:pick', { optionId: optionId, level: level });

    state.currentOffer = null;
    if (state.queue.length > 0) {
      var nextLevel = state.queue.shift();
      presentOffer(nextLevel);
    }
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 升级事件接线：level:up → offer → choice:offer（不自行暂停/替选）
   * ------------------------------------------------------------------ */

  function presentOffer(level) {
    if (!state.sectId) { return; }
    var pool = sects.UpgradePool;
    if (!pool || typeof pool.offer !== 'function') { return; }

    var options = null;
    try {
      options = pool.offer(level, state.sectId, ensureRng());
    } catch (e) {
      options = null;
    }
    if (!options || options.length === 0) {
      state.currentOffer = null;
      return;
    }

    state.currentOffer = { level: level, options: options };
    emit('choice:offer', { level: level, options: options });
  }

  function onLevelUp(payload) {
    var level = (payload && typeof payload.level === 'number' && isFinite(payload.level))
      ? Math.floor(payload.level)
      : (state.level + 1);
    if (level > state.level) { state.level = level; }

    if (!state.sectId) { return; }

    // 剑宗被动等随等级变化的数值重算（不会自动选择任何选项）
    if (player()) {
      recompute();
    } else {
      state.pending = true;
      schedulePendingRetry();
    }

    // 连续升级：已有未决呈现时排队，避免覆盖与自动替选
    if (state.currentOffer) {
      state.queue.push(level);
      return;
    }
    presentOffer(level);
  }

  function bindBus() {
    var c = core();
    var bus = c && c.Bus;
    if (!bus || typeof bus.on !== 'function') { return; }
    bus.on('level:up', onLevelUp);
  }

  /* ------------------------------------------------------------------ *
   * 公开对象
   * ------------------------------------------------------------------ */

  var Selection = {
    selectSect: selectSect,
    current: current,
    choose: choose,
    reset: reset,
    stacks: stacks,
    modifiers: modifiers,
    selected: function () { return state.picks.slice(); },
    pendingOffer: function () { return state.currentOffer; }
  };

  sects.Selection = Selection;

  bindBus();

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
