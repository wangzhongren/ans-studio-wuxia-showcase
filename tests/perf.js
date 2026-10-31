/*!
 * 江湖夜雨 · perf-harness · tests/perf.js
 * 契约：docs/contracts/wuxia-rogue-v2-architecture-v1.md §4.2（WG.perf）
 *   WG.perf.overlay        F3 开关的 DOM 叠层（容器 #hud-debug；未就绪安全跳过）
 *   WG.perf.stats          { fps, p95Sim, p95Render, entities:{monsters,projectiles,drops,particles,numbers}, degraded }
 *   WG.perf.fastForward(t) 仅调试：把对局时间推进到 t 秒（F4 = 330s）
 *   WG.perf.spawnBurst(n)  仅调试：在屏外批量生成 n 只怪（F5 = 120）
 *
 * 依赖（全部为公开契约 / 只读）：
 *   WG.core.Loop.frameStats、WG.core.boot() 返回的 world（state/runTime/seed/timescale）
 *   WG.monsters.Director.spawnBurst(n)（缺失时回退 MonsterSystem.spawnBurst）
 *   各模块公开 count（MonsterSystem/LootSystem/fx.particles/fx.numbers；combat.projectilePool）
 *   WG.fx.degrade.enabled
 *
 * 约束：
 *   - 只在显式按键 / 显式 API 调用时快进或刷怪；正式流程不自动触发。
 *   - 不写任何玩法模块内部状态；fwd 只改 main 拥有的 world.runTime/remaining，
 *     刷怪只调用公开批量生成接口。
 *   - 本文件不在 architecture §3.2 的 26 个固定脚本内；需 index.html 在
 *     src/core/main.js 之后追加一行 <script defer src="tests/perf.js"></script>。
 *   - v2 语义：仅 world.state === 'playing' 视为对局中；Loop.paused（升级三选一）
 *     时 F4/F5 仍是显式调试动作，普通帧循环不会自动快进或生成怪。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var perf = WG.perf = WG.perf || {};

  // 幂等：防止 index.html 重复引入导致键盘监听叠加、F3 切换两次
  if (perf.__harnessLoaded) { return; }
  perf.__harnessLoaded = true;

  /* 调试常量（契约 §6.3：F4→5:30，F5→120 只） */
  var FAST_FORWARD_SECONDS = 330;
  var BURST_COUNT = 120;
  var OVERLAY_INTERVAL_MS = 250;

  /* 提案 §6.3 基线（CONFIG 缺失时兜底） */
  var FALLBACK_TARGETS = [
    [0, 30],
    [60, 75],
    [180, 110],
    [300, 200],
    [420, 280]
  ];

  function core() {
    return WG.core || null;
  }

  function config() {
    var c = core();
    return (c && c.CONFIG) || {};
  }

  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  /* ------------------------------------------------------------------ *
   * 统计（原地更新；stats 通过 getter 读取时保持实时）
   * ------------------------------------------------------------------ */

  var stats = {
    fps: 0,
    p95Sim: 0,
    p95Render: 0,
    entities: {
      monsters: 0,
      projectiles: 0,
      drops: 0,
      particles: 0,
      numbers: 0
    },
    degraded: false
  };

  /** 兼容「number / getter / count() 方法」三种公开计数形态 */
  function toCount(source) {
    if (source === null || typeof source === 'undefined') { return 0; }
    if (typeof source === 'number') { return isFinite(source) ? source : 0; }
    if (typeof source === 'function') {
      try { return toCount(source.call(source)); } catch (e) { return 0; }
    }
    if (typeof source === 'object') {
      var c = source.count;
      if (typeof c === 'number') { return isFinite(c) ? c : 0; }
      if (typeof c === 'function') {
        try { return toCount(c.call(source)); } catch (e) { return 0; }
      }
    }
    return 0;
  }

  function refreshStats() {
    var c = core();
    var loop = c && c.Loop;
    var fs = loop && loop.frameStats;

    stats.fps = num(fs && fs.fps, 0);
    stats.p95Sim = num(fs && fs.p95Sim, 0);
    stats.p95Render = num(fs && fs.p95Render, 0);

    var e = stats.entities;

    var monsters = WG.monsters;
    e.monsters = toCount(monsters && monsters.MonsterSystem);

    var combat = WG.combat;
    var cs = combat && (combat.combatSystem || combat.CombatSystem);
    var projectilePool = cs && cs.projectilePool;
    if (!projectilePool && combat) { projectilePool = combat.projectilePool; }
    e.projectiles = toCount(projectilePool);

    var loot = WG.loot;
    e.drops = toCount(loot && loot.LootSystem);

    var fx = WG.fx;
    e.particles = toCount(fx && fx.particles);
    e.numbers = toCount(fx && fx.numbers);

    stats.degraded = !!(fx && fx.degrade && fx.degrade.enabled);
    return stats;
  }

  /* ------------------------------------------------------------------ *
   * world / 调试动作
   * ------------------------------------------------------------------ */

  var worldCache = null;

  function getWorld() {
    if (worldCache) { return worldCache; }
    var c = core();
    if (c && typeof c.boot === 'function') {
      try { worldCache = c.boot(); } catch (e) { worldCache = null; }
    }
    return worldCache;
  }

  function isPlaying(world) {
    return !!world && world.state === 'playing';
  }

  function targetAliveAt(sec) {
    var dc = config().director || {};
    var pts = Array.isArray(dc.targets) && dc.targets.length ? dc.targets : FALLBACK_TARGETS;
    var t = Math.max(0, num(sec, 0));
    if (t <= pts[0][0]) { return pts[0][1]; }
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1];
      var b = pts[i];
      if (t <= b[0]) {
        var span = b[0] - a[0];
        if (span <= 0) { return b[1]; }
        return a[1] + (b[1] - a[1]) * ((t - a[0]) / span);
      }
    }
    return pts[pts.length - 1][1];
  }

  var warnedNoBurst = false;

  /**
   * 仅调试：立即在屏外批量生成 n 只怪。
   * 优先调用 WG.monsters.Director.spawnBurst(n)；缺失时回退 MonsterSystem.spawnBurst。
   * @param {number} n
   * @returns {number} 实际生成数量（模块未就绪/未开始对局时为 0）
   */
  function spawnBurst(n) {
    var world = getWorld();
    if (!isPlaying(world)) { return 0; }

    var wanted = Math.floor(num(n, 0));
    if (!(wanted > 0)) { return 0; }
    var cap = num((config().monsters || {}).cap, 300);
    if (wanted > cap) { wanted = cap; }

    var monsters = WG.monsters;
    var director = monsters && monsters.Director;
    var system = monsters && monsters.MonsterSystem;
    var api = null;
    if (director && typeof director.spawnBurst === 'function') { api = director; }
    else if (system && typeof system.spawnBurst === 'function') { api = system; }

    if (!api) {
      if (!warnedNoBurst && typeof console !== 'undefined' && console.warn) {
        console.warn('[WG.perf] spawnBurst: WG.monsters.Director.spawnBurst(n) 未提供，已跳过（调试功能不可用）');
      }
      warnedNoBurst = true;
      return 0;
    }

    try {
      var spawned = api.spawnBurst(wanted);
      refreshStats();
      return typeof spawned === 'number' ? spawned : wanted;
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[WG.perf] spawnBurst 调用失败：', err);
      }
      return 0;
    }
  }

  /**
   * 仅调试：把对局时间推进到 t 秒（F4 用 330s），并按导演目标用公开批量接口补齐怪潮。
   * 注意：只快进「时间 + 怪物数量」；玩家等级/经验属于 loot 所有，不由工装伪造。
   * @param {number} t
   * @returns {boolean} 是否生效（对局未开始返回 false）
   */
  function fastForward(t) {
    var world = getWorld();
    if (!isPlaying(world)) { return false; }

    var sec = Number(t);
    if (!isFinite(sec)) { return false; }

    var duration = num((config().run || {}).duration, 480);
    if (sec < 0) { sec = 0; }
    if (sec > duration) { sec = duration; }

    world.runTime = sec;
    world.remaining = Math.max(0, duration - sec);

    // 调试便捷：按 CONFIG §6.3 曲线把同屏怪补到当前时间目标（只调用公开批量生成接口）
    var alive = toCount(WG.monsters && WG.monsters.MonsterSystem);
    var deficit = Math.floor(targetAliveAt(sec) - alive);
    if (deficit > 0) { spawnBurst(deficit); }

    refreshStats();
    return true;
  }

  /* ------------------------------------------------------------------ *
   * F3 叠层（#hud-debug；DOM 未就绪时安全跳过）
   * ------------------------------------------------------------------ */

  var ROWS = [
    ['fps', 'FPS'],
    ['frame', '帧耗时'],
    ['p95sim', '模拟 p95'],
    ['p95render', '渲染 p95'],
    ['stage', '阶段'],
    ['steps', '补步'],
    ['monsters', '怪物'],
    ['projectiles', '剑气'],
    ['drops', '掉落'],
    ['particles', '粒子'],
    ['numbers', '数字'],
    ['level', '等级'],
    ['atk', '攻击'],
    ['pickup', '拾取'],
    ['hp', 'HP'],
    ['degraded', '降级'],
    ['run', '对局'],
    ['seed', '种子'],
    ['action', '操作']
  ];

  var containerRef = null;
  var rowVals = null;
  var lastAction = '';

  function getDebugEl() {
    var doc = root.document;
    if (!doc || typeof doc.getElementById !== 'function') { return null; }
    return doc.getElementById('hud-debug');
  }

  function buildRows(el) {
    var doc = root.document;
    rowVals = null;
    if (!doc || typeof doc.createElement !== 'function') { return; }

    el.textContent = '';
    var vals = {};
    for (var i = 0; i < ROWS.length; i++) {
      var key = doc.createElement('span');
      key.className = 'hud-debug__key';
      key.textContent = ROWS[i][1];

      var val = doc.createElement('span');
      val.className = 'hud-debug__val';
      val.textContent = '-';

      el.appendChild(key);
      el.appendChild(val);
      vals[ROWS[i][0]] = val;
    }
    rowVals = vals;
  }

  function setVal(id, text, warn, bad) {
    if (!rowVals) { return; }
    var el = rowVals[id];
    if (!el) { return; }
    if (el.textContent !== text) { el.textContent = text; }
    var cls = 'hud-debug__val';
    if (warn) { cls += ' hud-debug__val--warn'; }
    if (bad) { cls += ' hud-debug__val--bad'; }
    if (el.className !== cls) { el.className = cls; }
  }

  function fmt1(v) {
    return (Math.round(v * 10) / 10).toFixed(1);
  }

  function fmt2(v) {
    return (Math.round(v * 100) / 100).toFixed(2);
  }

  function fmtTime(sec) {
    var s = Math.max(0, Math.floor(num(sec, 0)));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }

  function renderOverlay() {
    if (!overlay.enabled) { return; }
    var el = getDebugEl();
    if (!el) { return; }

    refreshStats();

    if (el !== containerRef || !rowVals || !el.firstChild) {
      containerRef = el;
      buildRows(el);
    }

    var world = getWorld();
    var c = core();
    var fs = (c && c.Loop && c.Loop.frameStats) || {};
    var e = stats.entities;
    var combat = WG.combat;
    var player = combat && combat.player;
    var ps = player && player.stats;

    var lines = null;
    if (!rowVals) {
      // 极端降级：没有 createElement 时用纯文本
      lines = [
        'FPS ' + fmt1(stats.fps),
        'frame ' + fmt2(fs.frameMs) + ' ms',
        'sim p95 ' + fmt2(stats.p95Sim) + ' ms',
        'render p95 ' + fmt2(stats.p95Render) + ' ms',
        'sim/render ' + fmt2(fs.simMs) + '/' + fmt2(fs.renderMs) + ' ms',
        'steps ' + num(fs.steps, 0),
        'monsters ' + e.monsters,
        'projectiles ' + e.projectiles,
        'drops ' + e.drops,
        'particles ' + e.particles,
        'numbers ' + e.numbers,
        'level ' + (ps ? ('Lv.' + num(ps.level, 1) + ' ' + num(ps.xp, 0) + '/' + num(ps.xpNext, 0)) : '-'),
        'atk ' + (ps ? (fmt1(num(ps.atk, 0)) + ' / ' + fmt2(num(ps.atkInterval, 0)) + 's') : '-'),
        'pickup ' + (ps ? (num(ps.pickupRadius, 0) + ' / ' + num(ps.magnetRadius, 0)) : '-'),
        'hp ' + (player ? (fmt1(num(player.hp, 0)) + '/' + fmt1(num(player.maxHp, 0))) : '-'),
        'degraded ' + (stats.degraded ? 'on' : 'off'),
        'run ' + (world ? (world.state + ' ' + fmtTime(world.runTime)) : '-'),
        'seed ' + (world && typeof world.seed === 'number' ? world.seed : '-'),
        'action ' + (lastAction || '-')
      ];
      el.textContent = lines.join('\n');
    } else {
      setVal('fps', fmt1(stats.fps), false, stats.fps > 0 && stats.fps < num((config().perf || {}).minFps, 45));
      setVal('frame', fmt2(fs.frameMs) + ' ms');
      setVal('p95sim', fmt2(stats.p95Sim) + ' ms', false,
        stats.p95Sim > num((config().perf || {}).simP95Ms, 6));
      setVal('p95render', fmt2(stats.p95Render) + ' ms', false,
        stats.p95Render > num((config().perf || {}).renderP95Ms, 8));
      setVal('stage', 'sim ' + fmt2(fs.simMs) + ' / draw ' + fmt2(fs.renderMs) + ' ms');
      setVal('steps', String(num(fs.steps, 0)));
      setVal('monsters', String(e.monsters));
      setVal('projectiles', String(e.projectiles));
      setVal('drops', String(e.drops));
      setVal('particles', String(e.particles));
      setVal('numbers', String(e.numbers));
      setVal('level', ps ? ('Lv.' + num(ps.level, 1) + ' ' + num(ps.xp, 0) + '/' + num(ps.xpNext, 0)) : '-');
      setVal('atk', ps ? (fmt1(num(ps.atk, 0)) + ' / ' + fmt2(num(ps.atkInterval, 0)) + 's') : '-');
      setVal('pickup', ps ? (num(ps.pickupRadius, 0) + ' / ' + num(ps.magnetRadius, 0)) : '-');
      setVal('hp', player ? (fmt1(num(player.hp, 0)) + '/' + fmt1(num(player.maxHp, 0))) : '-',
        false, !!player && num(player.hp, 1) <= 0);
      setVal('degraded', stats.degraded ? '开' : '关', stats.degraded);
      setVal('run', world ? (world.state + ' ' + fmtTime(world.runTime)) : '-');
      setVal('seed', world && typeof world.seed === 'number' ? String(world.seed) : '-');
      setVal('action', lastAction || '-');
    }

    el.hidden = false;
  }

  function note(text) {
    lastAction = text || '';
    if (overlay.enabled) { renderOverlay(); }
  }

  function applyOverlayVisibility() {
    var el = getDebugEl();
    if (el) { el.hidden = !overlay.enabled; }
    if (overlay.enabled) { renderOverlay(); }
  }

  var overlay = {
    enabled: false,
    toggle: function () {
      overlay.enabled = !overlay.enabled;
      applyOverlayVisibility();
      return overlay.enabled;
    },
    show: function () {
      overlay.enabled = true;
      applyOverlayVisibility();
      return true;
    },
    hide: function () {
      overlay.enabled = false;
      applyOverlayVisibility();
      return false;
    },
    render: renderOverlay
  };

  /* ------------------------------------------------------------------ *
   * 键盘：F3 叠层 / F4 快进 330s / F5 120 只怪潮
   * 自有 keydown（不受 Loop 的 Input 边沿清理影响）；仅显式按键触发。
   * ------------------------------------------------------------------ */

  function onKeyDown(e) {
    if (!e || e.repeat) { return; }
    if (e.ctrlKey || e.metaKey || e.altKey) { return; }
    var code = e.code || e.key;
    if (code !== 'F3' && code !== 'F4' && code !== 'F5') { return; }
    if (typeof e.preventDefault === 'function') { e.preventDefault(); }

    if (code === 'F3') {
      overlay.toggle();
    } else if (code === 'F4') {
      var ok = fastForward(FAST_FORWARD_SECONDS);
      note(ok ? ('F4 快进到 ' + fmtTime(FAST_FORWARD_SECONDS)) : 'F4 跳过（对局未开始）');
    } else if (code === 'F5') {
      var spawned = spawnBurst(BURST_COUNT);
      note(spawned > 0 ? ('F5 怪潮 +' + spawned) : 'F5 跳过（对局未开始/怪物模块未就绪）');
    }
  }

  /* ------------------------------------------------------------------ *
   * 公开与装载
   * ------------------------------------------------------------------ */

  perf.overlay = overlay;
  perf.fastForward = fastForward;
  perf.spawnBurst = spawnBurst;

  // stats 为实时视图：每次读取刷新 fps/p95/实体计数/降级，避免调用方拿到陈旧值
  try {
    Object.defineProperty(perf, 'stats', {
      enumerable: true,
      configurable: true,
      get: function () { return refreshStats(); }
    });
  } catch (e) {
    perf.stats = stats;
  }

  if (typeof root.addEventListener === 'function') {
    root.addEventListener('keydown', onKeyDown, false);
  }

  if (typeof root.document !== 'undefined' && typeof root.setInterval === 'function') {
    root.setInterval(function () {
      if (overlay.enabled) { renderOverlay(); }
    }, OVERLAY_INTERVAL_MS);
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
