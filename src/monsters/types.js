/*!
 * 江湖夜雨 · monsters-waves · types.js
 * 契约：docs/contracts/wuxia-rogue-architecture-v1.md §4.4
 * 公开：WG.monsters.types（游侠/弓手/刀客/血刀宗师模板）
 * 数值源：WG.core.CONFIG.monsters.types（proposal §6.2），缺省时用本文件基线兜底。
 * 加载顺序：index.html 中位于 src/monsters/ 第一个（core 之后、loot/combat 之后）。
 *
 * 设计：模板只读冻结；行为由 ai.js 按 template.behavior 分派。
 * 无卡牌元素；本文件不写任何他人模块状态。
 */
(function (root) {
  'use strict';

  if (!root) { return; }

  var WG = root.WG || (root.WG = {});
  var monsters = WG.monsters || (WG.monsters = {});

  function core() { return WG.core || null; }

  function cfgGroup() {
    var c = core();
    var cfg = (c && c.CONFIG) || {};
    return cfg.monsters || {};
  }

  function num(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }

  function pick(src, key, fallback) {
    if (src && typeof src[key] === 'number' && isFinite(src[key])) { return src[key]; }
    return fallback;
  }

  /* 方案 §6.2 基线（core 未加载时的兜底值） */
  var BASELINE = {
    youxia: {
      name: '游侠', behavior: 'chase',
      hp: 30, speed: 72, damage: 6, atkInterval: 1.0, radius: 14, xp: 6,
      color: '#c96f5a'
    },
    archer: {
      name: '弓手', behavior: 'ranged',
      hp: 22, speed: 58, damage: 5, atkInterval: 1.8, radius: 13, xp: 8,
      arrowSpeed: 300, keepDistance: 260, color: '#7fae6a'
    },
    daoke: {
      name: '刀客', behavior: 'charge',
      hp: 180, speed: 62, damage: 12, atkInterval: 3.0, radius: 20, xp: 40,
      chargeWindup: 0.6, chargeDistance: 220, chargeSpeed: 640, color: '#b08bd6'
    },
    bloodmaster: {
      name: '血刀宗师', behavior: 'charge',
      hp: 3000, speed: 50, damage: 20, atkInterval: 2.5, radius: 36, xp: 0,
      chargeWindup: 0.8, chargeDistance: 300, chargeSpeed: 560, color: '#d63b3b'
    }
  };

  /* 类型别名：兼容 loot tables 的 ranger/blade/boss 命名 */
  var ALIASES = {
    ranger: 'youxia',
    youxia: 'youxia',
    archer: 'archer',
    blade: 'daoke',
    daoke: 'daoke',
    blademaster: 'bloodmaster',
    bloodmaster: 'bloodmaster',
    boss: 'bloodmaster'
  };

  function normalize(type) {
    if (type === null || typeof type === 'undefined') { return null; }
    var key = String(type).toLowerCase().replace(/[\s_-]/g, '');
    return ALIASES[key] || null;
  }

  function build(id) {
    var base = BASELINE[id];
    if (!base) { return null; }
    var conf = (cfgGroup().types || {})[id] || {};
    var t = {
      id: id,
      name: base.name,
      behavior: base.behavior,
      hp: pick(conf, 'hp', base.hp),
      speed: pick(conf, 'speed', base.speed),
      damage: pick(conf, 'damage', base.damage),
      atkInterval: pick(conf, 'atkInterval', base.atkInterval),
      radius: pick(conf, 'radius', base.radius),
      xp: pick(conf, 'xp', base.xp),
      color: base.color,
      elite: (id === 'daoke' || id === 'bloodmaster')
    };
    if (id === 'archer') {
      t.arrowSpeed = pick(conf, 'arrowSpeed', base.arrowSpeed);
      t.keepDistance = pick(conf, 'keepDistance', base.keepDistance);
    }
    if (id === 'daoke' || id === 'bloodmaster') {
      t.chargeWindup = pick(conf, 'chargeWindup', base.chargeWindup);
      t.chargeDistance = pick(conf, 'chargeDistance', base.chargeDistance);
      t.chargeSpeed = pick(conf, 'chargeSpeed', base.chargeSpeed);
    }
    return Object.freeze(t);
  }

  var types = {
    youxia: build('youxia'),
    archer: build('archer'),
    daoke: build('daoke'),
    bloodmaster: build('bloodmaster'),
    /** 普通怪生成顺序（按出现时间：0s 游侠，60s 弓手，刀客单独精英投放） */
    normalOrder: Object.freeze(['youxia', 'archer']),
    /** 精英类型 */
    eliteTypes: Object.freeze(['daoke', 'bloodmaster']),
    aliases: Object.freeze(ALIASES),
    normalize: normalize,
    /**
     * 取模板（支持别名）；未知类型返回 null。
     * @param {string} type
     * @returns {Object|null}
     */
    get: function (type) {
      var id = normalize(type);
      return id ? types[id] : null;
    },
    isElite: function (type) {
      var id = normalize(type);
      return id === 'daoke' || id === 'bloodmaster';
    }
  };

  Object.freeze(types);
  monsters.types = types;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
