/*!
 * 江湖夜雨 · sects-progression · defs.js
 * 契约：docs/contracts/wuxia-rogue-v2-architecture-v1.md §4.8
 * 公开：WG.sects.DEFS = { jianzong, daomen, yigu }
 *   { id, name, desc, init:{atk,atkInterval,maxHp,speed,regen,critRate,critMult,damageReduction},
 *     exclusive:[optionId] }
 * 数值：docs/proposals/wuxia-rogue-v2-proposal-v1.md §5.1（严格采用）
 *   - 剑宗：atk 10 / interval 0.42 / HP 100 / speed 230；专属被动「每 3 级额外 +5% 攻速」
 *   - 刀门：atk 18 / interval 0.70 / HP 110 / speed 215；critRate 0.10、critMult 1.6
 *   - 医谷：atk 9  / interval 0.60 / HP 140 / speed 205；regen 1.5、damageReduction 0.05
 * 说明：
 *   - 这里的数值是门派「初始基准」，升级成长由 selection.js 基于该基准重算；
 *   - 未在方案中单列的门派 critRate/critMult/regen/damageReduction 取默认值
 *     （critRate 0、critMult 1.5、regen 0、damageReduction 0）。
 * 无抽选式玩法：仅描述门派与初始属性，不含任何随机抽取或收集逻辑。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var sects = WG.sects = WG.sects || {};

  var DEFS = {
    jianzong: {
      id: 'jianzong',
      name: '剑宗',
      role: '攻速',
      desc: '以快制敌：出手极快，每 3 级额外 +5% 攻速。',
      init: {
        atk: 10,
        atkInterval: 0.42,
        maxHp: 100,
        speed: 230,
        regen: 0,
        critRate: 0,
        critMult: 1.5,
        damageReduction: 0
      },
      exclusive: ['jz_combo', 'jz_aura'],
      exclusiveText: '每 3 级额外 +5% 攻速 · 连斩 / 剑罡',
      passive: {
        kind: 'attackSpeedPer3Levels',
        per3Levels: 0.05
      }
    },

    daomen: {
      id: 'daomen',
      name: '刀门',
      role: '爆发',
      desc: '一刀两断：单次伤害极高，暴击率 +10%，暴击伤害 ×1.6。',
      init: {
        atk: 18,
        atkInterval: 0.70,
        maxHp: 110,
        speed: 215,
        regen: 0,
        critRate: 0.10,
        critMult: 1.6,
        damageReduction: 0
      },
      exclusive: ['dm_cleave', 'dm_edge'],
      exclusiveText: '暴击率 +10% · 暴击伤害 ×1.6 · 裂空 / 刀魄',
      passive: {
        kind: 'crit',
        critRate: 0.10,
        critMult: 1.6
      }
    },

    yigu: {
      id: 'yigu',
      name: '医谷',
      role: '生存/回复',
      desc: '药石回春：气血厚实，每秒回血 1.5，受击减伤 5%。',
      init: {
        atk: 9,
        atkInterval: 0.60,
        maxHp: 140,
        speed: 205,
        regen: 1.5,
        critRate: 0,
        critMult: 1.5,
        damageReduction: 0.05
      },
      exclusive: ['yg_herb', 'yg_mend'],
      exclusiveText: '每秒回血 1.5 · 受击减伤 5% · 药息 / 回春',
      passive: {
        kind: 'regen',
        regen: 1.5,
        damageReduction: 0.05
      }
    }
  };

  // 固定展示顺序（界面卷轴按此顺序读取）
  var SECT_ORDER = ['jianzong', 'daomen', 'yigu'];

  /** @param {string} id @returns {Object|null} */
  function getDef(id) {
    if (typeof id !== 'string') { return null; }
    if (!Object.prototype.hasOwnProperty.call(DEFS, id)) { return null; }
    return DEFS[id];
  }

  sects.DEFS = DEFS;
  sects.SECT_ORDER = SECT_ORDER;
  sects.getDef = getDef;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
