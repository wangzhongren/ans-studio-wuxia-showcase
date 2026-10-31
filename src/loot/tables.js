/* 江湖夜雨 · loot-progression 数值表（v2）
 * 架构契约 v2 §4.5 / 方案 v2 §3 S4-S5
 * 公开：WG.loot.tables = { XP_CURVE, DROP_TABLE, PICKUP, xpToNext, xpForLevel }
 * 仅含掉落表、经验曲线与拾取参数；不含自动成长表、成长数值与里程碑技能。
 * 成长属性只由 sects-progression（WG.sects.Selection）写入，本模块只读。
 * 经典脚本（非 ES module），挂载 WG.loot.tables；无卡牌元素。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var loot = WG.loot = WG.loot || {};

  /* ------------------------------------------------------------------ *
   * 1. 经验曲线（方案 §5.6 / §6.4）
   *    基线：需求(L→L+1) = 40 + 24*(L-1)
   *    §6.4 累计锚点：Lv2=40，Lv3=104，Lv5=296，Lv8=824，Lv12=2024
   *    锚点之间的等级按“匀速补足”校正，保证累计值与方案表逐项一致。
   *    requirements[L] = 从 L 升到 L+1 所需 XP；cumulative[L] = 从 1 级累计到 L 级所需 XP。
   * ------------------------------------------------------------------ */
  var XP_CURVE = Object.freeze({
    maxLevel: 12,
    formula: '40 + 24*(L-1)，并按 §6.4 累计锚点校正',
    requirements: Object.freeze([
      0,    /* L0 占位 */
      40,   /* 1→2 */
      64,   /* 2→3  (累计 104) */
      88,   /* 3→4 */
      104,  /* 4→5  (累计 296) */
      144,  /* 5→6 */
      176,  /* 6→7 */
      208,  /* 7→8  (累计 824) */
      264,  /* 8→9 */
      288,  /* 9→10 */
      312,  /* 10→11 */
      336,  /* 11→12 (累计 2024) */
      0     /* L12 满级 */
    ]),
    cumulative: Object.freeze([
      0,    /* L0 */
      0,    /* L1 */
      40,   /* L2 */
      104,  /* L3 */
      192,  /* L4 */
      296,  /* L5 */
      440,  /* L6 */
      616,  /* L7 */
      824,  /* L8 */
      1088, /* L9 */
      1376, /* L10 */
      1688, /* L11 */
      2024  /* L12 */
    ]),
    anchors: Object.freeze({ 2: 40, 3: 104, 5: 296, 8: 824, 12: 2024 })
  });

  /* ------------------------------------------------------------------ *
   * 2. 掉落表（方案 §5.5 / §6.2）
   *    击杀必掉经验珠（普通 6 XP / 精英 40 XP）；
   *    35% 银两 1~3（精英 100%）；
   *    8% 疗伤丹回复 25 HP（精英 30%）。
   *    potionDropMult / potionHealBonus 为 sects 写入的只读加法字段，
   *    由 LootSystem 读取时按默认值兜底（见 pickup.js），不在本表存储。
   * ------------------------------------------------------------------ */
  var DROP_TABLE = Object.freeze({
    xp: Object.freeze({
      kind: 'xp',
      always: true,
      amount: 6,
      eliteAmount: 40,
      color: '#7fe6ff',
      radius: 5
    }),
    silver: Object.freeze({
      kind: 'silver',
      chance: 0.35,
      eliteChance: 1,
      min: 1,
      max: 3,
      color: '#ffd75e',
      radius: 5
    }),
    potion: Object.freeze({
      kind: 'potion',
      chance: 0.08,
      eliteChance: 0.3,
      heal: 25,
      color: '#8bff9e',
      radius: 6
    }),
    /* 精英类型标识（monsters 事件 type 字段）；xp>=40 亦按精英兜底 */
    eliteTypes: Object.freeze(['blade', 'bladeMaster', 'bloodmaster', 'elite']),
    /* 事件未携带 xp 时按怪物类型的经验兜底（§6.2） */
    xpByType: Object.freeze({ ranger: 6, archer: 8, blade: 40 }),
    /* 对象池上限（架构 §7：掉落 150） */
    maxDrops: 150
  });

  /* ------------------------------------------------------------------ *
   * 3. 拾取与磁吸（方案 §5.5）
   *    仅作为玩家 stats 字段缺失时的兜底，不参与成长计算。
   * ------------------------------------------------------------------ */
  var PICKUP = Object.freeze({
    popDelay: 0.25,       /* 落地弹出动画期间不可拾取 */
    magnetSpeed: 260,     /* 磁吸飞行速度 px/s */
    pickupRadius: 30,     /* 玩家属性缺失时的兜底 */
    magnetRadius: 80
  });

  /* ------------------------------------------------------------------ *
   * 4. 只读辅助函数
   * ------------------------------------------------------------------ */
  function xpToNext(level) {
    var n = Math.floor(Number(level));
    if (!isFinite(n) || n < 1 || n >= XP_CURVE.maxLevel) return 0;
    return XP_CURVE.requirements[n] || 0;
  }

  function xpForLevel(level) {
    var n = Math.floor(Number(level));
    if (!isFinite(n) || n < 1) n = 1;
    if (n > XP_CURVE.maxLevel) n = XP_CURVE.maxLevel;
    return XP_CURVE.cumulative[n] || 0;
  }

  loot.tables = Object.freeze({
    XP_CURVE: XP_CURVE,
    DROP_TABLE: DROP_TABLE,
    PICKUP: PICKUP,
    xpToNext: xpToNext,
    xpForLevel: xpForLevel
  });
})(typeof window !== 'undefined' ? window : globalThis);
