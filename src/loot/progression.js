/* 江湖夜雨 · loot-progression 经验（v2）
 * 架构契约 v2 §4.5 / §5.3
 * 公开：WG.loot.Progression = { addXp(n), reset(world), level, xp, xpNext }
 * 监听：无（经验珠由 LootSystem 拾取后调用 addXp）
 * 发送：level:up {level}，每升一级一次；不自动加属性、不发送技能解锁事件。
 * 写回：只同步 player.stats 的 level/xp/xpNext（loot 所有的非成长字段，HUD 直接读）；
 *       不写 atk/atkInterval/maxHp/speed/critRate 等成长属性，成长由 sects 唯一写入。
 * 复位：reset(world) 回到 Lv1/0XP 并同步上述三个字段；不重置 HP/位置，不发事件。
 * 无卡牌：本模块只累计经验并发升级事件，不含抽牌/手牌/三选一。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var loot = WG.loot = WG.loot || {};
  var tables = loot.tables;
  if (!tables) {
    /* tables.js 必须先加载（index.html 固定顺序）；缺失时不冒险初始化。 */
    if (root.console && root.console.error) {
      root.console.error('[WG.loot.Progression] 缺少 WG.loot.tables，请检查脚本加载顺序');
    }
    return;
  }

  var XP = tables.XP_CURVE;

  /* 经验状态（本模块唯一所有者；等级只用于经验曲线与 level:up 事件） */
  var state = { level: 1, xp: 0 };

  /* ------------------------------------------------------------------ *
   * 玩家非成长字段同步
   * HUD / 存档直接读 player.stats.xp / xpNext / level；这三个字段归 loot。
   * 只写这三个字段，绝不触碰 atk/atkInterval/maxHp/speed/critRate 等成长属性。
   * 玩家对象不可得（标题界面/未装配/结构异常）时安全跳过。
   * ------------------------------------------------------------------ */
  function syncPlayerStats(player) {
    if (!player || typeof player !== 'object') return false;
    var stats = player.stats;
    if (!stats || typeof stats !== 'object') return false;
    try {
      stats.level = state.level;
      stats.xp = state.xp;
      stats.xpNext = tables.xpToNext(state.level);
      return true;
    } catch (err) {
      /* stats 被冻结等异常场景：保持本模块状态，不抛出中断主循环 */
      return false;
    }
  }

  function playerFromWorld(world) {
    if (!world || typeof world !== 'object') return null;
    if (world.player && typeof world.player === 'object') return world.player;
    var combat = world.combat;
    if (combat && combat.player && typeof combat.player === 'object') {
      return combat.player;
    }
    return null;
  }

  function activePlayer() {
    var combat = WG.combat;
    if (combat && combat.player && typeof combat.player === 'object') {
      return combat.player;
    }
    var core = WG.core;
    return playerFromWorld(core && core.world);
  }

  /* ------------------------------------------------------------------ *
   * 事件总线（只经 WG.core.Bus 跨模块通信）
   * ------------------------------------------------------------------ */
  function emit(type, payload) {
    var core = WG.core;
    var bus = core && core.Bus;
    if (bus && typeof bus.emit === 'function') {
      bus.emit(type, payload);
    }
  }

  /* ------------------------------------------------------------------ *
   * 经验结算：逐级扣除、逐级发 level:up {level}
   * ------------------------------------------------------------------ */
  function addXp(n, player) {
    var gain = Number(n);
    if (!isFinite(gain) || gain <= 0) return state.level;
    if (state.level >= XP.maxLevel) return state.level;

    state.xp += gain;

    while (state.level < XP.maxLevel) {
      var need = tables.xpToNext(state.level);
      if (need <= 0 || state.xp < need) break;

      state.xp -= need;
      state.level += 1;

      /* 先同步非成长字段，再发等级事件：订阅方读到的 xp/xpNext 与等级一致 */
      syncPlayerStats(player || activePlayer());

      /* v2：只发等级，不写属性、不发送技能解锁事件；成长由 sects 三选一承接 */
      emit('level:up', { level: state.level });
    }

    if (state.level >= XP.maxLevel) state.xp = 0;

    /* 未升级的经验变化同样要同步（HUD 直接读 player.stats.xp） */
    syncPlayerStats(player || activePlayer());
    return state.level;
  }

  /* ------------------------------------------------------------------ *
   * 重开复位（main startRun → resetOptionalSystems 调用）
   * 复位经验/等级并同步 player.stats 的 level/xp/xpNext；
   * HP/位置/成长属性归 combat 与 sects，不在此处改写，也不发事件。
   * ------------------------------------------------------------------ */
  function reset(world) {
    state.level = 1;
    state.xp = 0;
    syncPlayerStats(playerFromWorld(world) || activePlayer());
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 公开对象（level/xp/xpNext 用 getter 保持实时值）
   * ------------------------------------------------------------------ */
  var Progression = {};

  Object.defineProperty(Progression, 'level', {
    enumerable: true,
    get: function () { return state.level; }
  });
  Object.defineProperty(Progression, 'xp', {
    enumerable: true,
    get: function () { return state.xp; }
  });
  Object.defineProperty(Progression, 'xpNext', {
    enumerable: true,
    get: function () { return tables.xpToNext(state.level); }
  });

  Progression.addXp = addXp;
  Progression.reset = reset;

  loot.Progression = Progression;
})(typeof window !== 'undefined' ? window : globalThis);
