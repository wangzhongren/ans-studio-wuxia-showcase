/*!
 * 江湖夜雨 · sects-progression · self-check.js（离线自检，不参与运行时）
 * 运行：node src/sects/self-check.js
 * 说明：本文件不由 index.html 加载、不被任何 WG.* 引用；
 *       仅用 Node 验证 defs/upgrades/selection 的数值、抽取规则、事件与写入字段。
 */
(function () {
  'use strict';

  var path = require('path');
  var fs = require('fs');

  require(path.join(__dirname, '..', 'core', 'rng.js'));
  require(path.join(__dirname, '..', 'core', 'bus.js'));

  var WG = globalThis.WG;
  var core = WG.core;

  // 最小玩家桩：只提供 stats / maxHp / hp / heal（combat 真实实现由 combat-player 负责）
  var fakePlayer = {
    x: 0,
    y: 0,
    r: 14,
    hp: 100,
    maxHp: 100,
    dead: false,
    stats: {
      atk: 12,
      atkInterval: 0.55,
      projectileCount: 1,
      range: 340,
      speed: 220,
      pickupRadius: 30,
      magnetRadius: 80,
      level: 1,
      xp: 0,
      xpNext: 40
    },
    heal: function (n) {
      var healed = Math.min(this.maxHp - this.hp, n);
      if (healed > 0) { this.hp += healed; }
      return healed;
    }
  };
  WG.combat = { player: fakePlayer };

  require(path.join(__dirname, 'defs.js'));
  require(path.join(__dirname, 'upgrades.js'));
  require(path.join(__dirname, 'selection.js'));

  var sects = WG.sects;
  var S = sects.Selection;
  var U = sects.UpgradePool;
  var Bus = core.Bus;

  var passed = 0;
  var failed = 0;

  function ok(cond, label, extra) {
    if (cond) {
      passed += 1;
      console.log('  PASS ' + label);
    } else {
      failed += 1;
      console.log('  FAIL ' + label + (extra ? '  -> ' + extra : ''));
    }
  }

  function eq(actual, expected, label) {
    ok(actual === expected, label, 'got ' + actual + ', want ' + expected);
  }

  function near(actual, expected, label, tol) {
    var t = (typeof tol === 'number') ? tol : 1e-6;
    ok(typeof actual === 'number' && Math.abs(actual - expected) <= t,
      label, 'got ' + actual + ', want ~' + expected);
  }

  function mkWorld(seed) {
    return { seed: seed, rng: core.Rng(seed) };
  }

  function selectedIds(offer) {
    var out = [];
    if (!offer) { return out; }
    for (var i = 0; i < offer.options.length; i++) { out.push(offer.options[i].id); }
    return out;
  }

  function selectedKinds(offer) {
    var out = [];
    if (!offer) { return out; }
    for (var i = 0; i < offer.options.length; i++) { out.push(offer.options[i].kind); }
    return out;
  }

  var offerEvents = [];
  var pickEvents = [];
  var sectEvents = [];
  Bus.on('choice:offer', function (p) { offerEvents.push(p); });
  Bus.on('choice:pick', function (p) { pickEvents.push(p); });
  Bus.on('sect:selected', function (p) { sectEvents.push(p); });

  /* ------------------------------------------------------------------ *
   * 1) 三门派初始属性对照 proposal §5.1
   * ------------------------------------------------------------------ */
  console.log('\n[1] 三门派初始属性');
  var EXPECTED = {
    jianzong: { atk: 10, atkInterval: 0.42, maxHp: 100, speed: 230, regen: 0, critRate: 0, critMult: 1.5, damageReduction: 0 },
    daomen: { atk: 18, atkInterval: 0.70, maxHp: 110, speed: 215, regen: 0, critRate: 0.10, critMult: 1.6, damageReduction: 0 },
    yigu: { atk: 9, atkInterval: 0.60, maxHp: 140, speed: 205, regen: 1.5, critRate: 0, critMult: 1.5, damageReduction: 0.05 }
  };
  var sectIds = ['jianzong', 'daomen', 'yigu'];
  for (var si = 0; si < sectIds.length; si++) {
    var sid = sectIds[si];
    var def = sects.DEFS[sid];
    ok(!!def, 'DEFS.' + sid + ' 存在');
    var exp = EXPECTED[sid];
    S.reset(mkWorld(1234));
    S.selectSect(sid);
    var st = fakePlayer.stats;
    eq(st.atk, exp.atk, sid + '.atk');
    near(st.atkInterval, exp.atkInterval, sid + '.atkInterval');
    eq(st.maxHp, exp.maxHp, sid + '.maxHp');
    eq(st.speed, exp.speed, sid + '.speed');
    eq(st.regen, exp.regen, sid + '.regen');
    eq(st.critRate, exp.critRate, sid + '.critRate');
    eq(st.critMult, exp.critMult, sid + '.critMult');
    eq(st.damageReduction, exp.damageReduction, sid + '.damageReduction');
    eq(fakePlayer.maxHp, exp.maxHp, sid + ' player.maxHp 同步');
    eq(fakePlayer.hp, exp.maxHp, sid + ' player.hp 开局回满');
    eq(S.current(), sid, sid + ' current()');
    ok(Array.isArray(def.exclusive) && def.exclusive.length === 2, sid + ' 两个专属选项');
  }

  /* ------------------------------------------------------------------ *
   * 2) Lv2 构成：1 专属 + 2 通用，且不重复；事件载荷正确
   * ------------------------------------------------------------------ */
  console.log('\n[2] 升级选项构成与事件');
  S.reset(mkWorld(1234));
  S.selectSect('daomen');
  offerEvents.length = 0;
  Bus.emit('level:up', { level: 2 });
  var off2 = S.pendingOffer();
  ok(!!off2, 'level:up 后产生待选呈现');
  eq(offerEvents.length, 1, '发出 1 次 choice:offer');
  eq(off2.options.length, 3, 'Lv2 恰好 3 个选项');
  eq(selectedKinds(off2).filter(function (k) { return k === 'sect'; }).length, 1, 'Lv2 含 1 个门派专属');
  eq(selectedKinds(off2).filter(function (k) { return k === 'common'; }).length, 2, 'Lv2 含 2 个通用');
  var ids2 = selectedIds(off2);
  eq(ids2.length, new Set(ids2).size, 'Lv2 选项不重复');
  ok(offerEvents[0].level === 2 && offerEvents[0].options.length === 3, 'choice:offer 载荷 {level,options}');
  pickEvents.length = 0;
  ok(S.choose(ids2[0]) === true, 'choose 应用第一个选项');
  eq(pickEvents.length, 1, '发出 1 次 choice:pick');
  eq(pickEvents[0].optionId, ids2[0], 'choice:pick.optionId 正确');
  eq(pickEvents[0].level, 2, 'choice:pick.level 正确');
  ok(S.choose(ids2[0]) === false, '同一呈现已被消费后不能重复选');

  /* ------------------------------------------------------------------ *
   * 3) Lv3/5/8 第 1 个名额固定绝学；同 seed 序列可复现
   * ------------------------------------------------------------------ */
  console.log('\n[3] 绝学保底与确定性');
  function simulate(seed, sectId, upTo) {
    S.reset(mkWorld(seed));
    S.selectSect(sectId);
    var rows = [];
    for (var lv = 2; lv <= upTo; lv++) {
      Bus.emit('level:up', { level: lv });
      var offer = S.pendingOffer();
      if (!offer) { rows.push({ level: lv, ids: [], kinds: [] }); continue; }
      var ids = selectedIds(offer);
      rows.push({ level: lv, ids: ids, kinds: selectedKinds(offer) });
      S.choose(ids[0]); // 模拟玩家每次选第一个（模块本身不会自动选）
    }
    return rows;
  }

  var rowsA = simulate(1234, 'daomen', 10);
  var rowsB = simulate(1234, 'daomen', 10);
  eq(JSON.stringify(rowsA), JSON.stringify(rowsB), '同 seed 两次抽取序列完全一致');

  function firstId(rows, level) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].level === level) { return rows[i].ids[0] || null; }
    }
    return null;
  }
  eq(firstId(rowsA, 3), 'whirl', 'Lv3 首位 = whirl');
  eq(firstId(rowsA, 5), 'swords', 'Lv5 首位 = swords');
  eq(firstId(rowsA, 8), 'twin', 'Lv8 首位 = twin');
  for (var ri = 0; ri < rowsA.length; ri++) {
    var row = rowsA[ri];
    eq(row.ids.length, new Set(row.ids).size, 'Lv' + row.level + ' 不重复');
    ok(row.ids.length <= 3, 'Lv' + row.level + ' 不超过 3 个');
  }

  console.log('\n  seed=1234 抽取序列（模拟每级选第一个）：');
  for (var pi = 0; pi < rowsA.length; pi++) {
    console.log('    Lv' + rowsA[pi].level + '  ' + rowsA[pi].ids.join(', ') +
      '  [' + rowsA[pi].kinds.join(',') + ']');
  }

  // 绝学标志位写入 stats
  eq(fakePlayer.stats.whirl, true, 'whirl 标志位写入 stats');
  eq(fakePlayer.stats.swords, true, 'swords 标志位写入 stats');
  eq(fakePlayer.stats.twin, true, 'twin 标志位写入 stats');
  ok(fakePlayer.stats.projectileCount >= 2, 'twin 使剑气数量 +1', 'count=' + fakePlayer.stats.projectileCount);

  /* ------------------------------------------------------------------ *
   * 4) 排除满层 + 上限防重复
   * ------------------------------------------------------------------ */
  console.log('\n[4] 满层排除与上限');
  S.reset(mkWorld(9));
  S.selectSect('jianzong');
  var applied = 0;
  for (var ci = 0; ci < 8; ci++) { if (S.choose('power')) { applied += 1; } }
  eq(applied, 5, 'power 最多应用 5 层');
  eq(S.modifiers.power, 5, 'modifiers.power = 5');
  var fullRng = core.Rng(42);
  var leaked = false;
  for (var fl = 2; fl <= 12; fl++) {
    var offerLv = U.offer(fl, 'jianzong', fullRng);
    for (var fi = 0; fi < offerLv.length; fi++) {
      if (offerLv[fi].id === 'power') { leaked = true; }
    }
  }
  ok(!leaked, '满层 power 不再出现在任何升级选项中');

  S.reset(mkWorld(10));
  S.selectSect('jianzong');
  eq(S.choose('jz_combo'), true, 'jz_combo 第 1 层');
  eq(S.choose('jz_combo'), true, 'jz_combo 第 2 层');
  eq(S.choose('jz_combo'), false, 'jz_combo 上限 2 层');
  eq(S.choose('jz_aura'), true, 'jz_aura 可叠');
  eq(S.choose('dm_cleave'), false, '跨门派专属不可选');

  /* ------------------------------------------------------------------ *
   * 5) 剑宗「每 3 级 +5% 攻速」被动
   * ------------------------------------------------------------------ */
  console.log('\n[5] 剑宗被动');
  S.reset(mkWorld(1234));
  S.selectSect('jianzong');
  near(fakePlayer.stats.atkInterval, 0.42, 'Lv1 间隔 0.42');
  Bus.emit('level:up', { level: 3 });
  near(fakePlayer.stats.atkInterval, 0.4, 'Lv3 间隔 0.42/1.05=0.4', 1e-4);
  Bus.emit('level:up', { level: 6 });
  near(fakePlayer.stats.atkInterval, 0.380952, 'Lv6 间隔 0.42/1.05^2（落盘保留 4 位小数）', 1e-4);

  /* ------------------------------------------------------------------ *
   * 6) 通用/专属/绝学效果写入字段
   * ------------------------------------------------------------------ */
  console.log('\n[6] 效果与字段');
  S.reset(mkWorld(2024));
  S.selectSect('yigu');
  eq(fakePlayer.stats.damageReduction, 0.05, '医谷初始减伤 0.05');
  eq(S.choose('yg_herb'), true, 'yg_herb 应用');
  near(fakePlayer.stats.potionDropMult, 1.5, 'yg_herb 掉落倍率 1.5');
  near(fakePlayer.stats.potionHealBonus, 10, 'yg_herb 回复加成 10');
  eq(S.choose('yg_mend'), true, 'yg_mend 应用');
  near(fakePlayer.stats.damageReduction, 0.15, 'yg_mend 减伤 0.05+0.10');
  near(fakePlayer.stats.regen, 2.0, 'yg_mend 回血 1.5+0.5');

  fakePlayer.hp = 50;
  eq(S.choose('vigor'), true, 'vigor 应用');
  near(fakePlayer.stats.maxHp, 161, 'vigor maxHp 140*1.15');
  eq(fakePlayer.maxHp, 161, 'player.maxHp 同步 161');
  eq(fakePlayer.hp, 70, 'vigor 即时回复 20（50->70）');

  eq(S.choose('magnet'), true, 'magnet 应用');
  near(fakePlayer.stats.pickupRadius, 36, 'magnet 拾取半径 30*1.2');
  near(fakePlayer.stats.magnetRadius, 96, 'magnet 磁吸半径 80*1.2');
  eq(S.choose('reach'), true, 'reach 应用');
  near(fakePlayer.stats.range, 391, 'reach 射程 340*1.15');
  eq(S.choose('pierce'), true, 'pierce 应用');
  near(fakePlayer.stats.pierce, 2, 'pierce 1+1');
  eq(S.choose('jz_aura'), false, '医谷不能选剑宗专属');

  S.reset(mkWorld(2025));
  S.selectSect('jianzong');
  eq(S.choose('jz_aura'), true, 'jz_aura 应用');
  near(fakePlayer.stats.atkInterval, 0.3818, '剑罡攻速 +10%', 1e-3);
  near(fakePlayer.stats.projectileSpeed, 713, '剑罡飞行速度 620*1.15');
  S.reset(mkWorld(2026));
  S.selectSect('daomen');
  eq(S.choose('dm_cleave'), true, 'dm_cleave 应用');
  eq(fakePlayer.stats.cleave, true, 'cleave 标志位写入');
  eq(S.choose('dm_edge'), true, 'dm_edge 应用');
  near(fakePlayer.stats.critMult, 1.9, '刀魄暴击伤害 1.6+0.3');

  /* ------------------------------------------------------------------ *
   * 7) 幂等 / reset / 未选择不自动替选
   * ------------------------------------------------------------------ */
  console.log('\n[7] 幂等与复位');
  sectEvents.length = 0;
  S.reset(mkWorld(7));
  S.selectSect('yigu');
  eq(S.choose('yg_herb'), true, '同门派重开前先叠 1 层成长');
  fakePlayer.hp = 50;
  var snap = JSON.stringify(fakePlayer.stats);
  var modSnap = S.modifiers.yg_herb;
  S.selectSect('yigu');
  eq(JSON.stringify(fakePlayer.stats), snap, '重复 selectSect 属性不变');
  eq(fakePlayer.hp, 50, '重复 selectSect 不回满 HP');
  eq(S.modifiers.yg_herb, modSnap, '重复 selectSect 不重置已选成长');
  eq(S.current(), 'yigu', 'current() 仍为 yigu');
  eq(sectEvents.length, 1, '同门派重复 selectSect 不发 sect:selected');
  eq(sectEvents[0].sectId, 'yigu', 'sect:selected 载荷 sectId 正确');

  // 严格幂等：同门派在任何 world 状态下都不发事件、不改属性；切换门派必发
  var worldPlaying = mkWorld(7);
  worldPlaying.state = 'playing';
  S.reset(worldPlaying);
  sectEvents.length = 0;
  S.selectSect('yigu');
  eq(sectEvents.length, 1, '首次选择发 sect:selected');
  var playingStats = JSON.stringify(fakePlayer.stats);
  S.selectSect('yigu');
  eq(sectEvents.length, 1, 'playing 中同门派重复确认不发事件');
  eq(JSON.stringify(fakePlayer.stats), playingStats, 'playing 中重复确认属性不变');
  S.selectSect('daomen');
  eq(sectEvents.length, 2, 'playing 中切换门派发 sect:selected');

  var worldOver = mkWorld(7);
  worldOver.state = 'over';
  S.reset(worldOver);
  sectEvents.length = 0;
  S.selectSect('yigu');
  S.selectSect('yigu');
  eq(sectEvents.length, 1, 'over 中同门派确认不发事件（重开由 UI ui:restart 负责）');
  eq(S.current(), 'yigu', '结算后确认门派保持 yigu');

  S.reset(mkWorld(7));
  eq(S.current(), null, 'reset 后无门派');
  eq(Object.keys(S.modifiers).length, 0, 'reset 后层数清空');

  S.reset(mkWorld(8));
  S.selectSect('daomen');
  Bus.emit('level:up', { level: 2 });
  var pending = S.pendingOffer();
  ok(!!pending, '升级后等待玩家选择');
  var statsBefore = JSON.stringify(fakePlayer.stats);
  eq(JSON.stringify(fakePlayer.stats), statsBefore, '未选择前不自动应用任何选项');
  eq(S.choose('not-an-option'), false, '非法选项被拒绝');

  /* ------------------------------------------------------------------ *
   * 8) 连续升级排队，逐级呈现
   * ------------------------------------------------------------------ */
  console.log('\n[8] 连续升级排队');
  S.reset(mkWorld(77));
  S.selectSect('daomen');
  offerEvents.length = 0;
  Bus.emit('level:up', { level: 2 });
  Bus.emit('level:up', { level: 3 });
  Bus.emit('level:up', { level: 4 });
  eq(offerEvents.length, 1, '连续升级只呈现第一级');
  var lv2 = S.pendingOffer();
  S.choose(lv2.options[0].id);
  eq(offerEvents.length, 2, '选择后呈现下一级');
  eq(S.pendingOffer().level, 3, '第二个呈现为 Lv3');
  S.choose(S.pendingOffer().options[0].id);
  eq(S.pendingOffer().level, 4, '第三个呈现为 Lv4');

  /* ------------------------------------------------------------------ *
   * 9) 静态口径扫描（本模块三文件）
   * ------------------------------------------------------------------ */
  console.log('\n[9] 静态口径扫描');
  var files = ['defs.js', 'upgrades.js', 'selection.js'];
  var forbiddenLatin = ['c' + 'ard', 'd' + 'eck', 'h' + 'and'];
  var forbiddenCn = [
    String.fromCharCode(0x62BD, 0x724C),
    String.fromCharCode(0x624B, 0x724C),
    String.fromCharCode(0x724C, 0x7EC4),
    String.fromCharCode(0x5F03, 0x724C, 0x5806),
    String.fromCharCode(0x6784, 0x7B51),
    String.fromCharCode(0x5361, 0x9762),
    String.fromCharCode(0x5361, 0x724C)
  ];
  var hits = [];
  for (var fi2 = 0; fi2 < files.length; fi2++) {
    var text = fs.readFileSync(path.join(__dirname, files[fi2]), 'utf8');
    var lower = text.toLowerCase();
    for (var li = 0; li < forbiddenLatin.length; li++) {
      if (lower.indexOf(forbiddenLatin[li]) !== -1) {
        hits.push(files[fi2] + ':' + forbiddenLatin[li]);
      }
    }
    for (var ci2 = 0; ci2 < forbiddenCn.length; ci2++) {
      if (text.indexOf(forbiddenCn[ci2]) !== -1) {
        hits.push(files[fi2] + ':' + forbiddenCn[ci2]);
      }
    }
  }
  eq(hits.length, 0, '三文件无抽选/收集式命名', hits.join(','));

  /* ------------------------------------------------------------------ *
   * 汇总
   * ------------------------------------------------------------------ */
  console.log('\nself-check: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) { process.exitCode = 1; }
})();
