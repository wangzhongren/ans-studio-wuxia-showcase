/*!
 * 江湖夜雨 · core-runtime · main.js（组合根，最后加载）
 * 契约：WG.core.boot(options) → 装配世界/系统并启动 Loop
 * 职责（architecture §4.1 / §5.1）：
 *   - 解析 URL 参数 ?seed= / ?timescale= / ?debug=1；
 *   - 创建世界（CONFIG 尺寸、RNG、Bus、SpatialHash、相机）；
 *   - 按 architecture §5.1 的固定步长帧序驱动：
 *     player.move → Camera.update → SpatialHash 重建 → combat → monsters → loot → director → fx；
 *   - boot 将 canvas 后备缓冲固定为 CONFIG.viewport（1280×720），Camera 视口同步；
 *   - 渲染阶段负责清屏、相机变换、世界地面/网格/边界、模块绘制钩子与 HUD；
 *   - 维护对局计时/胜负/统计（core 拥有「对局计时/胜负」状态）。
 * 防御性装配：所有上层模块（combat/monsters/loot/fx/ui）都做 typeof 可选挂载；
 *   未就绪时安全跳过，不因 ReferenceError 崩溃。core 不读取任何上层 _internal。
 * 跨模块通信只走 WG.core.Bus。v2 界面状态机（title→sect→playing⇄choice→result）
 * 由 WG.ui.ScreenFlow 持有；main 只按事件切换：sect:selected / choice:offer /
 * choice:pick / run:result，并保留 ui:start / ui:restart 的 v1 兼容入口。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var core = WG.core = WG.core || {};

  var CONFIG = core.CONFIG;
  var Rng = core.Rng;
  var SpatialHash = core.SpatialHash;
  var Input = core.Input;
  var Camera = core.Camera;
  var Bus = core.Bus;
  var Loop = core.Loop;

  var world = null;
  var context = null;
  var canvasEl = null;
  var booted = false;

  // 复用的世界中心目标（无玩家时相机看向地图中心）
  var CENTER = { x: CONFIG.world.width / 2, y: CONFIG.world.height / 2 };

  // 复用的结算对象与 HUD 状态对象（避免逐帧分配）
  var result = {
    outcome: 'win',
    runTime: 0,
    kills: 0,
    picked: 0,
    coins: 0,
    level: 1,
    atk: CONFIG.player.atk
  };

  var uiState = {
    state: 'title',
    runTime: 0,
    remaining: CONFIG.run.duration,
    level: 1,
    xp: 0,
    xpNext: CONFIG.progression.xpBase,
    hp: CONFIG.player.maxHp,
    maxHp: CONFIG.player.maxHp,
    kills: 0,
    picked: 0,
    coins: 0,
    fps: 0,
    debug: false,
    seed: 0,
    timescale: 1
  };

  /* ---------- 世界背景（夜色瓦片 + 网格 + 边界） ---------- */

  // 128 px 与空间哈希同格；仅绘制视口覆盖的格，避免整图绘制
  var BG_CELL = CONFIG.spatialHash.cellSize;
  var bgPalette = {
    base: '#0b0f16',      // styles/theme.css --color-night-800
    tile: '#111825',      // --color-night-700
    minor: '#5d6f80',     // --color-mist-400
    major: '#8fa3b0',     // --color-mist-300
    edge: '#e8c37a',      // --color-gold-400
    edgeDark: '#1f2a3a'   // --color-ink-500
  };

  /** 启动时读一次 CSS 变量（只读，不逐帧调用）；失败时回退到夜色常量 */
  function cssColor(name, fallback) {
    if (typeof root.document === 'undefined' || typeof root.getComputedStyle !== 'function') {
      return fallback;
    }
    try {
      var docEl = root.document.documentElement;
      if (!docEl) return fallback;
      var value = root.getComputedStyle(docEl).getPropertyValue(name);
      if (typeof value === 'string' && value.trim()) return value.trim();
    } catch (e) { /* 非浏览器/样式未就绪 */ }
    return fallback;
  }

  function initBackgroundPalette() {
    bgPalette.base = cssColor('--color-night-800', bgPalette.base);
    bgPalette.tile = cssColor('--color-night-700', bgPalette.tile);
    bgPalette.minor = cssColor('--color-mist-400', bgPalette.minor);
    bgPalette.major = cssColor('--color-mist-300', bgPalette.major);
    bgPalette.edge = cssColor('--color-gold-400', bgPalette.edge);
    bgPalette.edgeDark = cssColor('--color-ink-500', bgPalette.edgeDark);
  }

  /* ---------- 工具 ---------- */

  function ns(name) {
    var m = WG[name];
    return (m && typeof m === 'object') ? m : null;
  }

  function call(obj, method, a, b, c) {
    if (!obj) return;
    var fn = obj[method];
    if (typeof fn === 'function') fn.call(obj, a, b, c);
  }

  function safeCall(obj, method, a, b, c) {
    if (!obj) return undefined;
    var fn = obj[method];
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.call(obj, a, b, c);
    } catch (e) {
      return undefined;
    }
  }

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  function parseUrl() {
    var out = { seed: null, timescale: 1, debug: false };
    if (typeof root.location === 'undefined' || !root.location || !root.location.search) return out;

    var search = root.location.search;
    var query = search.charAt(0) === '?' ? search.slice(1) : search;
    var parts = query.split('&');
    for (var i = 0; i < parts.length; i++) {
      var pair = parts[i].split('=');
      var key = safeDecode(pair[0] || '');
      var value = safeDecode(pair[1] || '');
      if (key === 'seed') {
        if (/^-?\d+$/.test(value)) out.seed = parseInt(value, 10) >>> 0;
      } else if (key === 'timescale') {
        var ts = parseFloat(value);
        if (isFinite(ts) && ts >= 1 && ts <= 8) out.timescale = ts;
      } else if (key === 'debug') {
        out.debug = (value === '1');
      }
    }
    return out;
  }

  function uiApi() {
    return ns('ui');
  }

  /** v2：WG.ui.ScreenFlow.go(name)；未就绪返回 null（v1 兼容回退 screens）。 */
  function screenFlow() {
    var ui = uiApi();
    var flow = ui && ui.ScreenFlow;
    if (!flow || typeof flow.go !== 'function') return null;
    return flow;
  }

  /** v1：WG.ui.screens（标题/结算简单界面）。 */
  function uiScreens() {
    var ui = uiApi();
    if (!ui) return null;
    var screens = ui.screens;
    if (!screens || typeof screens.showTitle !== 'function') return null;
    return screens;
  }

  /** v2：门派选择系统；未就绪返回 null。 */
  function selection() {
    var sects = ns('sects');
    var sel = sects && sects.Selection;
    if (!sel || typeof sel !== 'object') return null;
    return sel;
  }

  /** 读取当前门派 id（Selection.current() 允许字符串或 {id}）。 */
  function currentSectId() {
    var sel = selection();
    if (!sel) return null;
    if (typeof sel.current === 'function') {
      var c = safeCall(sel, 'current');
      if (typeof c === 'string' && c) return c;
      if (c && typeof c.id === 'string' && c.id) return c.id;
    }
    if (typeof sel.sectId === 'string' && sel.sectId) return sel.sectId;
    return null;
  }

  /** 切换界面（v2 ScreenFlow 优先；缺失时回退 v1 screens）。 */
  function goScreen(name) {
    var flow = screenFlow();
    if (flow) {
      safeCall(flow, 'go', name);
      return true;
    }
    var screens = uiScreens();
    if (!screens) return false;
    if (name === 'title') {
      safeCall(screens, 'showTitle');
      return true;
    }
    if (name === 'playing') {
      safeCall(screens, 'hide');
      return true;
    }
    if (name === 'result') {
      safeCall(screens, 'showResult', result);
      return true;
    }
    return false;
  }

  /** 隐藏界面覆盖层（v2 Overlays 与 v1 screens 均做可选保护）。 */
  function hideScreenLayers() {
    var ui = uiApi();
    if (!ui) return;
    if (ui.Overlays && typeof ui.Overlays.hide === 'function') {
      safeCall(ui.Overlays, 'hide');
    }
    if (ui.screens && typeof ui.screens.hide === 'function') {
      safeCall(ui.screens, 'hide');
    }
  }

  /** 读取（不缓存引用）当前已加载的上层系统；模块未就绪则为 null */
  function refreshSystems(w) {
    var combat = ns('combat');
    var monsters = ns('monsters');
    var loot = ns('loot');

    w.combat = (combat && combat.CombatSystem) || null;
    w.player = (combat && combat.player) || null;
    w.monsters = (monsters && monsters.MonsterSystem) || null;
    w.director = (monsters && monsters.Director) || null;
    w.loot = (loot && loot.LootSystem) || null;
  }

  /* ---------- 世界与流程 ---------- */

  function createWorld(opts, url) {
    var seed = null;
    if (typeof opts.seed === 'number' && isFinite(opts.seed)) seed = opts.seed >>> 0;
    else if (url.seed !== null) seed = url.seed;
    else seed = Date.now() >>> 0;

    var timescale = 1;
    if (typeof opts.timescale === 'number' && isFinite(opts.timescale) &&
        opts.timescale >= 1 && opts.timescale <= 8) {
      timescale = opts.timescale;
    } else {
      timescale = url.timescale;
    }

    var w = {
      // 世界尺寸 / 数值源
      width: CONFIG.world.width,
      height: CONFIG.world.height,
      config: CONFIG,

      // 核心服务
      rng: Rng(seed),
      seed: seed,
      bus: Bus,
      input: Input,
      camera: Camera,
      hash: SpatialHash(CONFIG.spatialHash.cellSize),

      // 对局状态（core/main 拥有）
      state: 'title', // title | playing | over
      outcome: null, // win | dead
      runTime: 0,
      remaining: CONFIG.run.duration,
      kills: 0,
      picked: 0,
      coins: 0,
      debug: !!(opts.debug || url.debug),
      timescale: timescale,

      // 上层系统引用（可能为 null）
      player: null,
      combat: null,
      monsters: null,
      loot: null,
      director: null,

      // 无玩家时相机目标
      focus: CENTER
    };

    refreshSystems(w);
    return w;
  }

  function resetOptionalSystems() {
    // v1/v2 通用：仅调用上层公开的 reset；缺失时安全跳过。
    if (world.player && typeof world.player.reset === 'function') world.player.reset(world);
    if (world.combat && typeof world.combat.reset === 'function') world.combat.reset(world);
    if (world.monsters && typeof world.monsters.reset === 'function') world.monsters.reset(world);
    if (world.director && typeof world.director.reset === 'function') world.director.reset(world);
    if (world.loot && typeof world.loot.reset === 'function') world.loot.reset(world);

    // v2 契约：Progression / LootSystem / Selection 各自提供 reset。
    var loot = ns('loot');
    if (loot && loot.Progression && typeof loot.Progression.reset === 'function') {
      loot.Progression.reset(world);
    }

    var sects = ns('sects');
    var sel = sects && sects.Selection;
    if (sel && typeof sel.reset === 'function') {
      safeCall(sel, 'reset', world);
    }

    // CombatSystem 单例可能不是 world.combat（防御性补一次）。
    var combat = ns('combat');
    var cs = combat && combat.CombatSystem;
    if (cs && cs !== world.combat && typeof cs.reset === 'function') {
      cs.reset(world);
    }
  }

  /** 复用于开始/重开的对局复位；不判断来源状态（由调用方决定语义）。 */
  function resetRunState() {
    if (!world) return;

    if (!world.combat && !world.monsters && !world.loot) refreshSystems(world);

    world.state = 'playing';
    world.outcome = null;
    world.runTime = 0;
    world.remaining = CONFIG.run.duration;
    world.kills = 0;
    world.picked = 0;
    world.coins = 0;
    world.hash.clear();

    // 同 seed 重开：复位随机序列（上层每次从 world.rng 取随机数）
    world.rng = Rng(world.seed);

    resetOptionalSystems();

    Camera.update(world.player || world.focus, 0, world);
  }

  // 门派切换/复位期间抑制 sect:selected 重入（Selection.reset 可能清空当前门派，
  // 此时需要在复位后重新 selectSect；该调用会再次发事件，必须忽略）。
  var sectTransition = false;

  /**
   * 新局入口：全量复位 → （必要时）恢复门派 → 隐藏覆盖层 → 进入 playing。
   * @param {string|null} preferredSectId
   */
  function beginRun(preferredSectId) {
    if (!world) return;

    if (Loop && typeof Loop.resume === 'function') {
      // 清掉可能残留的升级暂停
      try { Loop.resume(); } catch (e) { /* 忽略 */ }
    }

    var sel = selection();
    var desired = preferredSectId || currentSectId();

    resetRunState();

    // Selection.reset() 若清空门派，则按复位前记录重新应用初始属性。
    if (desired && sel && typeof sel.selectSect === 'function' && currentSectId() !== desired) {
      var wasTransition = sectTransition;
      sectTransition = true;
      try { safeCall(sel, 'selectSect', desired); } finally { sectTransition = wasTransition; }
    }

    hideScreenLayers();
    goScreen('playing');
  }

  /** v1 兼容：对局中 ui:start 不复位；title/over 时开始新局（默认剑宗）。 */
  function onUiStart() {
    if (!world || world.state === 'playing') return;

    var sel = selection();
    var id = currentSectId();

    if (!id && sel && typeof sel.selectSect === 'function') {
      safeCall(sel, 'selectSect', 'jianzong');
      if (world.state === 'playing') return; // sect:selected 已完成开局
      id = 'jianzong';
    }

    beginRun(id);
  }

  /** v1 兼容 / 结算 R：用当前门派复位重开（无门派时回落默认剑宗）。 */
  function onUiRestart() {
    if (!world) return;
    var sel = selection();
    beginRun(currentSectId() || (sel ? 'jianzong' : null));
  }

  /** v2：选定门派 → 复位本局并进入战斗。 */
  function onSectSelected(payload) {
    if (!world || sectTransition) return;
    var sectId = payload && typeof payload.sectId === 'string' ? payload.sectId : null;
    sectTransition = true;
    try {
      beginRun(sectId);
    } finally {
      sectTransition = false;
    }
  }

  function onChoiceOffer() {
    if (!world || world.state !== 'playing') return;
    if (Loop && typeof Loop.pause === 'function') {
      try { Loop.pause(); } catch (e) { /* 忽略 */ }
    }
  }

  function onChoicePick() {
    if (Loop && typeof Loop.resume === 'function') {
      try { Loop.resume(); } catch (e) { /* 忽略 */ }
    }
  }

  /** 方案 v2 §6.2：评分纯函数；WG.ui.score 不可用时按同公式内置兜底。 */
  function scoreOf(stats) {
    var ui = uiApi();
    if (ui && typeof ui.score === 'function') {
      var scored = safeCall(ui, 'score', stats);
      if (scored && typeof scored === 'object' &&
          typeof scored.score === 'number' && isFinite(scored.score) &&
          typeof scored.grade === 'string' && scored.grade) {
        return { score: scored.score, grade: scored.grade };
      }
    }

    var score = stats.kills * 2 + stats.picks * 1 + stats.level * 100 +
      stats.silver * 2 + stats.runTime * 0.5;
    var grade = score >= 2000 ? 'S' : (score >= 1500 ? 'A' : (score >= 900 ? 'B' : 'C'));
    return { score: score, grade: grade };
  }

  function finishRun(outcome) {
    if (!world || world.state !== 'playing') return;
    world.state = 'over';
    world.outcome = outcome;

    var player = world.player;
    var stats = player && player.stats;

    result.outcome = outcome;
    result.runTime = world.runTime;
    result.kills = world.kills;
    result.picked = world.picked;
    result.coins = world.coins;
    result.level = (stats && stats.level) || 1;
    result.atk = (stats && stats.atk) || CONFIG.player.atk;

    // v2 结算统计对象（同一对象用于评分与 run:result，保证数值一致）
    var runStats = {
      outcome: outcome,
      runTime: result.runTime,
      level: result.level,
      kills: result.kills,
      picks: result.picked,
      silver: result.coins,
      atk: result.atk
    };
    var scored = scoreOf(runStats);

    // v1 兼容事件
    if (outcome === 'win') {
      Bus.emit('run:win', {
        runTime: world.runTime,
        kills: world.kills,
        level: result.level
      });
    }

    Bus.emit('run:result', {
      outcome: outcome,
      stats: runStats,
      score: scored.score,
      grade: scored.grade
    });

    // v2 状态机优先；v1 screens 回退由 goScreen 内部处理
    goScreen('result');
  }

  /* ---------- Bus 订阅（core 只需统计与胜负） ---------- */

  function onMonsterKilled() {
    if (world && world.state === 'playing') world.kills++;
  }

  function onLootPicked(payload) {
    if (!world || world.state !== 'playing' || !payload) return;
    world.picked++;
    if (payload.kind === 'coin' || payload.kind === 'silver') {
      var n = payload.amount | 0;
      if (n > 0) world.coins += n;
    }
  }

  function onPlayerDead() {
    if (world && world.state === 'playing') finishRun('dead');
  }

  function bindBus() {
    Bus.on('monster:killed', onMonsterKilled);
    Bus.on('loot:picked', onLootPicked);
    Bus.on('player:dead', onPlayerDead);
    // v1 兼容入口
    Bus.on('ui:start', onUiStart);
    Bus.on('ui:restart', onUiRestart);

    // v2 状态机接线
    Bus.on('sect:selected', onSectSelected);
    Bus.on('choice:offer', onChoiceOffer);
    Bus.on('choice:pick', onChoicePick);
  }

  /* ---------- 固定步长更新 ---------- */

  // 空间哈希重建用的固定回调（避免逐帧闭包分配）
  function insertEntity(e) {
    if (!e) return;
    if (e.alive === false || e.dead === true) return;
    world.hash.insert(e);
  }

  /**
   * 重建怪物/掉落空间索引（architecture §5.1 帧序：Camera.update 之后、CombatSystem.update 之前）。
   * 通过公开契约的 pool.forEach 读取，不触碰任何模块内部状态；未就绪的安全跳过。
   */
  function rebuildHash() {
    world.hash.clear();
    var monsters = world.monsters;
    if (monsters && monsters.pool && typeof monsters.pool.forEach === 'function') {
      monsters.pool.forEach(insertEntity);
    }
    var loot = world.loot;
    if (loot && loot.pool && typeof loot.pool.forEach === 'function') {
      loot.pool.forEach(insertEntity);
    }
  }

  function step(dt) {
    if (!world) return;

    var state = world.state;
    if (state !== 'playing') {
      // 标题/结算/门派选择：只渲染不推进。
      // 仅在 v2 ScreenFlow 未就绪时保留 v1 键盘兜底（有状态机时由 UI 接管）。
      if (!screenFlow()) {
        if (state === 'title') {
          if (Input.keyPressed('Enter')) onUiStart();
        } else if (state === 'over') {
          if (Input.keyPressed('KeyR')) onUiRestart();
        }
      }
      return;
    }

    world.runTime += dt;
    world.remaining = CONFIG.run.duration - world.runTime;
    if (world.remaining < 0) world.remaining = 0;

    var player = world.player;

    // 1) 玩家移动（architecture §5.1：Input.axis → Player.move）
    //    Player.prototype.update 已别名为 move；缺失 update 时回退 move。
    //    player 未就绪时安全跳过，相机仍按 focus 更新。
    if (player) {
      if (typeof player.update === 'function') {
        player.update(dt, world);
      } else {
        call(player, 'move', dt, world);
      }
    }
    if (world.state !== 'playing') return;

    // 2) 相机跟随（在玩家移动之后）
    Camera.update(player || world.focus, dt, world);

    // 3) 空间哈希重建（玩家已移动；索敌/命中前使用最新位置）
    rebuildHash();

    // 4) 战斗（索敌、发射、命中 → emit 'damage'）
    call(world.combat, 'update', dt, world);
    if (world.state !== 'playing') return;

    // 5) 怪物 AI / 受伤 / 死亡
    call(world.monsters, 'update', dt, world);
    if (world.state !== 'playing') return;

    // 6) 掉落、磁吸、拾取、经验/升级（升级会触发 choice:offer → Loop.pause）
    call(world.loot, 'update', dt, player);
    if (world.state !== 'playing') return;
    // 暂停当帧不再推进导演/FX/胜负；渲染仍在 Loop 中继续。
    if (Loop && Loop.paused) return;

    // 7) 刷怪导演
    if (world.director) {
      var level = (player && player.stats && player.stats.level) || 1;
      call(world.director, 'update', dt, world.runTime, level);
    }

    // 8) 表现层计时（可选钩子；表现模块自行决定是否实现）
    var fx = ns('fx');
    if (fx) {
      call(fx.particles, 'update', dt);
      call(fx.numbers, 'update', dt);
      call(fx.screen, 'update', dt);
    }

    // 9) 通关判定（8:00 存活；暂停时不结算）
    if (world.state === 'playing' && !(Loop && Loop.paused) &&
        world.runTime >= CONFIG.run.duration) {
      finishRun('win');
    }
  }

  /* ---------- 渲染 ---------- */

  function syncUiState() {
    var player = world.player;
    var stats = player && player.stats;

    uiState.state = world.state;
    uiState.runTime = world.runTime;
    uiState.remaining = world.remaining;
    uiState.level = (stats && stats.level) || 1;
    uiState.xp = (stats && stats.xp) || 0;
    uiState.xpNext = (stats && stats.xpNext) || CONFIG.progression.xpBase;
    uiState.maxHp = (player && player.maxHp) || (stats && stats.maxHp) || CONFIG.player.maxHp;
    uiState.hp = (player && typeof player.hp === 'number') ? player.hp : uiState.maxHp;
    uiState.kills = world.kills;
    uiState.picked = world.picked;
    uiState.coins = world.coins;
    uiState.fps = Loop.frameStats.fps;
    uiState.debug = world.debug;
    uiState.seed = world.seed;
    uiState.timescale = world.timescale;
  }

  function callHud() {
    var ui = ns('ui');
    if (!ui) return;
    // 契约 §4.7 公开名为 WG.ui.HUD；当前实现暴露 WG.ui.hud（v1 别名），两者都接受。
    var hud = ui.HUD || ui.hud;
    if (!hud || typeof hud.render !== 'function') return;
    syncUiState();
    hud.render(uiState);
  }

  /**
   * 绘制世界地面：夜色底 + 128px 棋盘瓦片 + 细/粗网格 + 世界边界。
   * 在 Camera.apply 之后调用，坐标为世界坐标；只遍历视口覆盖的格，
   * 无数组分配；ctx.save/restore 配平，不改任何玩法状态。
   */
  function drawWorldBackground(ctx) {
    if (!ctx || !world) return;

    var cam = Camera;
    var worldW = (typeof world.width === 'number' && world.width > 0) ? world.width : CONFIG.world.width;
    var worldH = (typeof world.height === 'number' && world.height > 0) ? world.height : CONFIG.world.height;
    var viewW = (cam && typeof cam.w === 'number' && cam.w > 0) ? cam.w : CONFIG.viewport.width;
    var viewH = (cam && typeof cam.h === 'number' && cam.h > 0) ? cam.h : CONFIG.viewport.height;
    var viewX = (cam && typeof cam.x === 'number' ? cam.x : 0) +
      (cam && typeof cam.shakeX === 'number' ? cam.shakeX : 0);
    var viewY = (cam && typeof cam.y === 'number' ? cam.y : 0) +
      (cam && typeof cam.shakeY === 'number' ? cam.shakeY : 0);

    var left = Math.max(0, viewX);
    var top = Math.max(0, viewY);
    var right = Math.min(worldW, viewX + viewW);
    var bottom = Math.min(worldH, viewY + viewH);
    if (right <= left || bottom <= top) return;

    var cell = BG_CELL;
    var gx0 = Math.max(0, Math.floor(left / cell));
    var gy0 = Math.max(0, Math.floor(top / cell));
    var gx1 = Math.min(Math.ceil(worldW / cell) - 1, Math.floor((right - 0.001) / cell));
    var gy1 = Math.min(Math.ceil(worldH / cell) - 1, Math.floor((bottom - 0.001) / cell));
    var margin = CONFIG.world.margin;
    var gx, gy, x, y, w, h;

    ctx.save();
    ctx.globalAlpha = 1;

    // 1) 可见区域底色（其余由 CSS --color-canvas-bg 兜底）
    ctx.fillStyle = bgPalette.base;
    ctx.fillRect(left, top, right - left, bottom - top);

    // 2) 棋盘瓦片：只填充奇数格，一半绘制调用；底色已是偶数格
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = bgPalette.tile;
    for (gy = gy0; gy <= gy1; gy++) {
      for (gx = gx0; gx <= gx1; gx++) {
        if (((gx + gy) & 1) === 0) continue;
        x = gx * cell;
        y = gy * cell;
        w = Math.min(cell, worldW - x);
        h = Math.min(cell, worldH - y);
        if (w > 0 && h > 0) ctx.fillRect(x, y, w, h);
      }
    }

    // 3) 细网格（每格；跳过 4 格主线与世界边界）
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = bgPalette.minor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (gx = gx0; gx <= gx1 + 1; gx++) {
      if ((gx & 3) === 0) continue;
      x = gx * cell;
      if (x <= 0 || x >= worldW) continue;
      ctx.moveTo(x + 0.5, top);
      ctx.lineTo(x + 0.5, bottom);
    }
    for (gy = gy0; gy <= gy1 + 1; gy++) {
      if ((gy & 3) === 0) continue;
      y = gy * cell;
      if (y <= 0 || y >= worldH) continue;
      ctx.moveTo(left, y + 0.5);
      ctx.lineTo(right, y + 0.5);
    }
    ctx.stroke();

    // 4) 粗网格（每 4 格），提供大块滚动参照
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = bgPalette.major;
    ctx.beginPath();
    for (gx = gx0; gx <= gx1 + 1; gx++) {
      if ((gx & 3) !== 0) continue;
      x = gx * cell;
      if (x <= 0 || x >= worldW) continue;
      ctx.moveTo(x + 0.5, top);
      ctx.lineTo(x + 0.5, bottom);
    }
    for (gy = gy0; gy <= gy1 + 1; gy++) {
      if ((gy & 3) !== 0) continue;
      y = gy * cell;
      if (y <= 0 || y >= worldH) continue;
      ctx.moveTo(left, y + 0.5);
      ctx.lineTo(right, y + 0.5);
    }
    ctx.stroke();

    // 5) 世界边界：外沿暗线 + 可玩区域（margin）鎏金线
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = bgPalette.edgeDark;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, worldW - 4, worldH - 4);

    if (margin > 0 && worldW > margin * 2 && worldH > margin * 2) {
      ctx.globalAlpha = 0.38;
      ctx.strokeStyle = bgPalette.edge;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        margin + 0.5,
        margin + 0.5,
        worldW - margin * 2 - 1,
        worldH - margin * 2 - 1
      );
    } else {
      ctx.globalAlpha = 0.38;
      ctx.strokeStyle = bgPalette.edge;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, worldW - 2, worldH - 2);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function renderFrame(alpha) {
    if (!world) return;

    var ctx = context;
    if (!ctx) {
      callHud();
      return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CONFIG.viewport.width, CONFIG.viewport.height);

    // 世界层绘制：先铺 core 负责的地面/瓦片/边界，再交给上层公开 render 钩子
    Camera.apply(ctx);
    drawWorldBackground(ctx);
    call(world.monsters, 'render', ctx, alpha);
    call(world.loot, 'render', ctx, alpha);
    call(world.combat, 'render', ctx, alpha);

    var fx = ns('fx');
    if (fx) {
      call(fx.particles, 'render', ctx, alpha);
      call(fx.numbers, 'render', ctx, alpha);
      if (typeof fx.render === 'function') fx.render(ctx, alpha, world);
    }
    ctx.restore();

    callHud();
  }

  /* ---------- 启动 ---------- */

  function bindCanvasFallback() {
    // 仅在 v2 ScreenFlow / v1 screens 都未接管时，用点击画布作为开始/重开的兜底
    if (typeof root.document === 'undefined') return;
    if (screenFlow() || uiScreens()) return;
    var target = canvasEl || root;
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener('pointerdown', function () {
      if (!world) return;
      if (world.state === 'title') onUiStart();
      else if (world.state === 'over') onUiRestart();
    }, false);
  }

  /**
   * 固定后备缓冲为 CONFIG.viewport（1280×720）；CSS 负责铺满。
   * 同步 Camera 的视口尺寸，使相机钳制/剔除与后备缓冲一致。
   */
  function configureCanvasSize() {
    Camera.w = CONFIG.viewport.width;
    Camera.h = CONFIG.viewport.height;

    if (!canvasEl) return;
    var w = CONFIG.viewport.width | 0;
    var h = CONFIG.viewport.height | 0;
    if (canvasEl.width !== w) canvasEl.width = w;
    if (canvasEl.height !== h) canvasEl.height = h;
  }

  function boot(options) {
    if (booted && world) return world;

    var opts = options || {};
    var url = parseUrl();
    world = createWorld(opts, url);

    Loop.timeScale = world.timescale;

    canvasEl = opts.canvas || null;
    if (!canvasEl && typeof root.document !== 'undefined') {
      canvasEl = root.document.getElementById('game');
    }

    // 先定后备尺寸，再取 context（设置 width/height 会重置 2D 状态）
    configureCanvasSize();
    if (canvasEl && typeof canvasEl.getContext === 'function') {
      context = canvasEl.getContext('2d');
    }
    initBackgroundPalette();

    bindBus();
    Camera.update(world.player || world.focus, 0, world);

    // v2：先启动循环，再让界面状态机进入 title（架构 §5.1）。
    Loop.start(step, renderFrame);

    var flow = screenFlow();
    if (flow) {
      safeCall(flow, 'bindInput');
      safeCall(flow, 'go', 'title');
    } else {
      var screens = uiScreens();
      if (screens) {
        // v1 回退：标题态由 screens 接管
        call(screens, 'showTitle');
        call(screens, 'bindInput');
      }
      bindCanvasFallback();
    }

    booted = true;
    return world;
  }

  core.boot = boot;

  // 组合根预加载：defer 脚本执行时 DOM 已解析
  if (typeof root.document !== 'undefined') {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', function () { boot(); }, false);
    } else {
      boot();
    }
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
