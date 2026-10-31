/*!
 * 江湖夜雨 · sects-progression · upgrades.js
 * 契约：docs/contracts/wuxia-rogue-v2-architecture-v1.md §4.8
 * 公开：WG.sects.UpgradePool = { offer(level, sectId, rng), apply(option), OPTIONS,
 *                                optionById(id), maxStacks(id) }
 *
 * 选项池（docs/proposals/wuxia-rogue-v2-proposal-v1.md §6.2）：
 *   - 通用 8 项：power/haste/swift/vigor/magnet/pierce/multi/reach，各上限 5 层；
 *   - 门派专属：剑宗 jz_combo/jz_aura、刀门 dm_cleave/dm_edge、医谷 yg_herb/yg_mend；
 *   - 绝学：Lv3 whirl、Lv5 swords、Lv8 twin（该等级保底选项）。
 *
 * 抽取规则（方案 §6.3，全部走调用方传入的种子 RNG）：
 *   1) 候选 = 未满层的通用 + 本门派未满层专属；
 *   2) 每级 3 个且不重复：1 个本门派专属 + 2 个通用（专属不可选时用通用补）；
 *   3) Lv3/5/8 第 1 个名额固定为该级绝学，其余 2 个从专属/通用抽取；
 *   4) 不足 3 个用未满层通用补，仍不足则少给（不重复填）。
 *
 * 本文件只做「选什么」；玩家属性写入与层数记录在 selection.js（唯一写入点）。
 * 选项为即时生效、选择后消失、不跨局留存，不存在抽选/收集式进程。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var sects = WG.sects = WG.sects || {};

  /* ------------------------------------------------------------------ *
   * 选项定义
   * effects 为「每层」效果描述，由 selection.js 统一解释并重算属性：
   *   *Mul    每层乘算；*Add 每层加算；flag 解锁标志位。
   * ------------------------------------------------------------------ */

  var OPTION_LIST = [
    /* ---------- 通用 8 项（上限 5 层） ---------- */
    {
      id: 'power', name: '锋锐', kind: 'common', maxStacks: 5, sect: null,
      desc: '攻击力 +15%',
      effects: { atkMul: 1.15 }
    },
    {
      id: 'haste', name: '疾风', kind: 'common', maxStacks: 5, sect: null,
      desc: '攻击间隔 -8%（下限 0.18 s）',
      effects: { atkIntervalMul: 0.92 }
    },
    {
      id: 'swift', name: '身法', kind: 'common', maxStacks: 5, sect: null,
      desc: '移速 +6%',
      effects: { speedMul: 1.06 }
    },
    {
      id: 'vigor', name: '铁骨', kind: 'common', maxStacks: 5, sect: null,
      desc: '最大 HP +15%，并回复 20',
      effects: { maxHpMul: 1.15, healOnPick: 20 }
    },
    {
      id: 'magnet', name: '牵引', kind: 'common', maxStacks: 5, sect: null,
      desc: '拾取/磁吸半径 +20%',
      effects: { pickupMul: 1.20, magnetMul: 1.20 }
    },
    {
      id: 'pierce', name: '透劲', kind: 'common', maxStacks: 5, sect: null,
      desc: '剑气穿透 +1',
      effects: { pierceAdd: 1 }
    },
    {
      id: 'multi', name: '分光', kind: 'common', maxStacks: 5, sect: null,
      desc: '剑气数量 +1（上限 3）',
      effects: { projectileAdd: 1, projectileCap: 3 }
    },
    {
      id: 'reach', name: '长虹', kind: 'common', maxStacks: 5, sect: null,
      desc: '剑气射程 +15%',
      effects: { rangeMul: 1.15 }
    },

    /* ---------- 剑宗专属 ---------- */
    {
      id: 'jz_combo', name: '连斩', kind: 'sect', maxStacks: 2, sect: 'jianzong',
      desc: '剑气数量 +1（上限 3，可叠 2 层）',
      effects: { projectileAdd: 1, projectileCap: 3 }
    },
    {
      id: 'jz_aura', name: '剑罡', kind: 'sect', maxStacks: 5, sect: 'jianzong',
      desc: '攻速 +10%，剑气飞行速度 +15%',
      effects: { atkSpeedMul: 1.10, projectileSpeedMul: 1.15 }
    },

    /* ---------- 刀门专属 ---------- */
    {
      id: 'dm_cleave', name: '裂空', kind: 'sect', maxStacks: 1, sect: 'daomen',
      desc: '每 4 s 自动一次范围斩（半径 120，200% 攻击力）',
      effects: { flag: 'cleave' }
    },
    {
      id: 'dm_edge', name: '刀魄', kind: 'sect', maxStacks: 5, sect: 'daomen',
      desc: '暴击伤害 +30%',
      effects: { critMultAdd: 0.30 }
    },

    /* ---------- 医谷专属 ---------- */
    {
      id: 'yg_herb', name: '药息', kind: 'sect', maxStacks: 5, sect: 'yigu',
      desc: '疗伤丹掉落率 +50%，拾取回复 +10',
      effects: { potionDropAdd: 0.50, potionHealAdd: 10 }
    },
    {
      id: 'yg_mend', name: '回春', kind: 'sect', maxStacks: 5, sect: 'yigu',
      desc: '受击减伤 +10%，每秒回血 +0.5',
      effects: { damageReductionAdd: 0.10, regenAdd: 0.5 }
    },

    /* ---------- 绝学（里程碑保底） ---------- */
    {
      id: 'whirl', name: '剑气回旋', kind: 'ultimate', maxStacks: 1, sect: null,
      desc: '半径 95，每 1.5 s 对周围敌人造成 18 伤害',
      effects: { flag: 'whirl' }
    },
    {
      id: 'swords', name: '万剑归宗', kind: 'ultimate', maxStacks: 1, sect: null,
      desc: '每 12 s 以半径 420 降下剑雨，造成 60 伤害',
      effects: { flag: 'swords' }
    },
    {
      id: 'twin', name: '双剑气', kind: 'ultimate', maxStacks: 1, sect: null,
      desc: '自动攻击额外 1 道剑气',
      effects: { twinProjectile: 1 }
    }
  ];

  var OPTIONS = Object.create(null);
  var UNIVERSAL_IDS = ['power', 'haste', 'swift', 'vigor', 'magnet', 'pierce', 'multi', 'reach'];
  var EXCLUSIVE_BY_SECT = {
    jianzong: ['jz_combo', 'jz_aura'],
    daomen: ['dm_cleave', 'dm_edge'],
    yigu: ['yg_herb', 'yg_mend']
  };
  var ULTIMATE_BY_LEVEL = { 3: 'whirl', 5: 'swords', 8: 'twin' };

  for (var oi = 0; oi < OPTION_LIST.length; oi++) {
    var def = OPTION_LIST[oi];
    OPTIONS[def.id] = def;
  }

  /* ------------------------------------------------------------------ *
   * 层数读取：唯一真源在 WG.sects.Selection.modifiers
   * ------------------------------------------------------------------ */

  function stacksOf(id) {
    var selection = sects.Selection;
    if (!selection) { return 0; }
    var table = null;
    if (typeof selection.stacks === 'function') {
      table = selection.stacks();
    } else if (selection.modifiers && typeof selection.modifiers === 'object') {
      table = selection.modifiers;
    }
    if (!table) { return 0; }
    var n = table[id];
    return (typeof n === 'number' && isFinite(n) && n > 0) ? n : 0;
  }

  function isAvailable(option) {
    if (!option) { return false; }
    var cap = (typeof option.maxStacks === 'number' && option.maxStacks > 0) ? option.maxStacks : 5;
    return stacksOf(option.id) < cap;
  }

  function randomIndex(rng, length) {
    if (!(length > 0)) { return -1; }
    if (rng && typeof rng.int === 'function') {
      var n = rng.int(0, length - 1);
      if (typeof n === 'number' && isFinite(n)) {
        n = Math.floor(n);
        if (n < 0) { n = 0; }
        if (n >= length) { n = length - 1; }
        return n;
      }
    }
    if (rng && typeof rng.next === 'function') {
      var v = rng.next();
      if (typeof v === 'number' && isFinite(v)) {
        var idx = Math.floor(v * length);
        if (idx < 0) { idx = 0; }
        if (idx >= length) { idx = length - 1; }
        return idx;
      }
    }
    return Math.floor(Math.random() * length);
  }

  /** 从候选 id 列表中随机取一个「未满层且未选中」的项。 */
  function pickOne(ids, rng, taken) {
    var pool = [];
    if (!ids) { return null; }
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (!id || taken[id]) { continue; }
      var option = OPTIONS[id];
      if (!option || !isAvailable(option)) { continue; }
      pool.push(id);
    }
    if (!pool.length) { return null; }
    var idx = randomIndex(rng, pool.length);
    return (idx >= 0) ? pool[idx] : null;
  }

  function toPublicOption(option) {
    return {
      id: option.id,
      name: option.name,
      desc: option.desc,
      kind: option.kind
    };
  }

  /* ------------------------------------------------------------------ *
   * 抽取：每级恰好 3 个（不足则少给），不重复，排除满层
   * ------------------------------------------------------------------ */

  /**
   * @param {number} level 本次升级后的等级（Lv2 起触发）
   * @param {string} sectId 当前门派 id
   * @param {{next:function, int?:function, pick?:function}} rng 本局种子 RNG
   * @returns {Array<{id:string,name:string,desc:string,kind:string}>}
   */
  function offer(level, sectId, rng) {
    var picked = [];
    var taken = Object.create(null);
    var lv = (typeof level === 'number' && isFinite(level)) ? Math.floor(level) : 0;

    // 3) Lv3/5/8：第 1 个名额固定为该级绝学（已满层则回退常规构成）
    var ultimateId = ULTIMATE_BY_LEVEL[lv] || null;
    if (ultimateId) {
      var ultimate = OPTIONS[ultimateId];
      if (ultimate && isAvailable(ultimate)) {
        picked.push(ultimateId);
        taken[ultimateId] = true;
      }
    }

    // 2) 1 个本门派专属（不可选时不强塞）
    var exclusiveIds = EXCLUSIVE_BY_SECT[sectId] || [];
    var exclusive = pickOne(exclusiveIds, rng, taken);
    if (exclusive) {
      picked.push(exclusive);
      taken[exclusive] = true;
    }

    // 2/4) 其余名额用通用项补足；仍不足则少给，绝不重复
    while (picked.length < 3) {
      var common = pickOne(UNIVERSAL_IDS, rng, taken);
      if (!common) { break; }
      picked.push(common);
      taken[common] = true;
    }

    var out = [];
    for (var i = 0; i < picked.length; i++) {
      out.push(toPublicOption(OPTIONS[picked[i]]));
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 应用：委托唯一属性写入点 Selection.choose
   * ------------------------------------------------------------------ */

  /**
   * 应用一个已选选项。属性写入、层数上限与事件均由 selection.js 负责。
   * @param {Object|string} option 选项对象（含 id）或选项 id
   * @returns {boolean} 是否成功应用
   */
  function apply(option) {
    var id = (typeof option === 'string') ? option : (option && option.id);
    if (!id) { return false; }
    var selection = sects.Selection;
    if (!selection || typeof selection.choose !== 'function') { return false; }
    return selection.choose(id) === true;
  }

  function optionById(id) {
    if (typeof id !== 'string') { return null; }
    return OPTIONS[id] || null;
  }

  function maxStacks(id) {
    var option = optionById(id);
    if (!option) { return 0; }
    return (typeof option.maxStacks === 'number' && option.maxStacks > 0) ? option.maxStacks : 5;
  }

  sects.UpgradePool = {
    offer: offer,
    apply: apply,
    OPTIONS: OPTIONS,
    optionById: optionById,
    maxStacks: maxStacks,
    universalIds: UNIVERSAL_IDS.slice(),
    exclusiveBySect: EXCLUSIVE_BY_SECT,
    ultimateByLevel: ULTIMATE_BY_LEVEL
  };

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
