/*!
 * 江湖夜雨 · hud-ui · hud.js
 * 契约：docs/contracts/wuxia-rogue-v2-architecture-v1.md §4.7 / §5.4（AC-4 / AC-5 / AC-9 / AC-10）
 * 公开：WG.ui.HUD → { render(state) }；WG.ui.hud 为 v1 兼容别名
 *
 * 职责：
 *  - 复用 index.html 已有 HUD 容器，显示倒计时、气血、等级、经验、击杀、拾取、银两、门派。
 *  - 只读：state（core/main 汇总的 uiState）、WG.combat.player / player.stats 与
 *    WG.sects.Selection.current()（只读兜底）；不写玩家/怪物/掉落/成长状态，不发玩法事件。
 *  - 所有 DOM 文本/进度条都做变化检测：值不变不写 DOM（避免逐帧无谓写入）。
 *  - F3 调试叠层仅负责 #hud-debug 容器的显示/隐藏与内容承载；
 *    可见性读取 WG.perf.overlay，数据读取 WG.perf.stats；perf 未就绪时安全隐藏/跳过。
 *  - 无任何抽选/收集式界面（AC-7 / AC-12）。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var ui = WG.ui = WG.ui || {};
  var CONFIG = (WG.core && WG.core.CONFIG) || {};
  var doc = (typeof root.document !== 'undefined') ? root.document : null;

  var els = null;

  // 变化检测缓存：-1 / '' 表示尚未写入
  var cache = {
    timeSec: -1,
    hp: -1,
    hpMax: -1,
    level: -1,
    xp: -1,
    xpNext: -1,
    kills: -1,
    picks: -1,
    coins: -1,
    sect: '',
    hpFill: '',
    xpFill: '',
    warning: null
  };

  var debugTick = 0;
  var debugVisible = false;
  var debugInit = false;
  var debugText = '';

  /* ------------------------------------------------------------------ *
   * DOM 取用
   * ------------------------------------------------------------------ */
  function byId(id) {
    return doc ? doc.getElementById(id) : null;
  }

  function ensureEls() {
    if (!doc) { return null; }
    if (els && els.hud) { return els; }
    els = {
      hud: byId('hud'),
      time: byId('hud-time'),
      level: byId('hud-level'),
      xp: byId('hud-xp'),
      xpFill: byId('hud-xp-fill'),
      hp: byId('hud-hp'),
      hpMax: byId('hud-hp-max'),
      hpFill: byId('hud-hp-fill'),
      kills: byId('hud-kills'),
      picks: byId('hud-picks'),
      silver: byId('hud-silver'),
      debug: byId('hud-debug'),
      sect: byId('hud-sect'),
      sectName: byId('hud-sect-name')
    };
    ensureSectEl(els);
    return els;
  }

  /** 门派展示：优先复用 index.html 的节点；缺失时在 HUD 内安全补一个。 */
  function ensureSectEl(e) {
    if (!doc || !e || (e.sect && e.sectName)) { return; }
    if (!e.hud || typeof doc.createElement !== 'function') { return; }

    if (!e.sect) {
      e.sect = doc.createElement('div');
      e.sect.id = 'hud-sect';
      e.sect.className = 'hud-panel hud-sect';
      var top = byId('hud-top') || (e.hud.getElementsByClassName && e.hud.getElementsByClassName('hud__top')[0]);
      if (top) { top.appendChild(e.sect); } else { e.hud.appendChild(e.sect); }
    }
    if (!e.sectName) {
      var label = doc.createElement('span');
      label.className = 'hud-label';
      label.textContent = '门派';
      e.sect.appendChild(label);

      e.sectName = doc.createElement('span');
      e.sectName.id = 'hud-sect-name';
      e.sectName.className = 'hud-value hud-value--sm hud-value--gold';
      e.sectName.textContent = '未入门';
      e.sect.appendChild(e.sectName);
    }
  }

  /* ------------------------------------------------------------------ *
   * 数值/格式化工具
   * ------------------------------------------------------------------ */
  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  function pickNum(a, b, c, fallback) {
    if (typeof a === 'number' && isFinite(a)) { return a; }
    if (typeof b === 'number' && isFinite(b)) { return b; }
    if (typeof c === 'number' && isFinite(c)) { return c; }
    return fallback;
  }

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function formatCountdown(seconds) {
    var s = Math.max(0, Math.ceil(num(seconds, 0)));
    var m = Math.floor(s / 60);
    return pad2(m) + ':' + pad2(s % 60);
  }

  function percent(part, whole) {
    if (!(whole > 0)) { return 0; }
    var p = (part / whole) * 100;
    if (!isFinite(p)) { return 0; }
    if (p < 0) { return 0; }
    if (p > 100) { return 100; }
    return Math.round(p * 10) / 10;
  }

  function sectNameFrom(state) {
    if (state && typeof state.sectName === 'string' && state.sectName) {
      return state.sectName;
    }

    var id = state && (state.sectId || state.sect);
    var current = null;
    var selection = WG.sects && WG.sects.Selection;
    if (selection && typeof selection.current === 'function') {
      try { current = selection.current(); } catch (e) { current = null; }
    }

    if (current && typeof current === 'object') {
      if (current.name) { return current.name; }
      if (current.id && !id) { id = current.id; }
    } else if (typeof current === 'string' && !id) {
      id = current;
    }

    if (id && typeof id === 'object') {
      if (id.name) { return id.name; }
      id = id.id || '';
    }

    var defs = WG.sects && WG.sects.DEFS;
    if (id && defs) {
      if (Object.prototype.toString.call(defs) === '[object Array]') {
        for (var i = 0; i < defs.length; i++) {
          if (defs[i] && (defs[i].id === id || defs[i].name === id)) {
            return defs[i].name || id;
          }
        }
      } else if (defs[id]) {
        return defs[id].name || id;
      }
    }
    return id ? String(id) : '未入门';
  }

  function setText(el, value) {
    if (!el) { return; }
    if (el.textContent !== value) { el.textContent = value; }
  }

  function setFill(el, value, cacheKey) {
    if (!el || !el.style || typeof el.style.setProperty !== 'function') { return; }
    if (cache[cacheKey] === value) { return; }
    cache[cacheKey] = value;
    el.style.setProperty('--hud-bar-fill', value);
  }

  function toggleClass(el, name, on) {
    if (!el || !el.classList) { return; }
    if (on) {
      if (!el.classList.contains(name)) { el.classList.add(name); }
    } else if (el.classList.contains(name)) {
      el.classList.remove(name);
    }
  }

  /* ------------------------------------------------------------------ *
   * F3 调试叠层（容器由 UI 负责，开关与数据由 WG.perf 提供）
   * ------------------------------------------------------------------ */
  function perfOverlayVisible(state) {
    var perf = WG.perf;
    if (!perf) { return false; }
    var overlay = perf.overlay;
    if (!overlay) {
      // perf 尚无 overlay 时，?debug=1 且 stats 可用则显示（只读展示）
      return !!(state && state.debug && perf.stats);
    }
    if (typeof overlay === 'boolean') { return overlay; }

    var keys = ['visible', 'enabled', 'active', 'open', 'shown'];
    for (var i = 0; i < keys.length; i++) {
      if (typeof overlay[keys[i]] === 'boolean') { return overlay[keys[i]]; }
    }
    if (typeof overlay.isVisible === 'function') {
      try { return !!overlay.isVisible(); } catch (e) { /* 忽略 */ }
    }
    return false;
  }

  function fmt(v, digits) {
    var n = num(v, NaN);
    if (!isFinite(n)) { return '-'; }
    if (digits > 0) { return n.toFixed(digits); }
    return String(Math.round(n));
  }

  function buildDebugText(state) {
    var perf = WG.perf;
    var s = perf && perf.stats;
    if (!s) { return 'F3 调试\nperf.stats 未就绪'; }

    var e = s.entities || {};
    var degraded = (typeof s.degraded === 'boolean')
      ? s.degraded
      : !!(WG.fx && WG.fx.degrade && WG.fx.degrade.enabled);

    return [
      'FPS        ' + fmt(s.fps, 1),
      '帧耗时     ' + fmt(s.frameMs, 1) + ' ms',
      '模拟 p95   ' + fmt(s.p95Sim, 1) + ' ms',
      '渲染 p95   ' + fmt(s.p95Render, 1) + ' ms',
      '怪/剑/掉落 ' + fmt(e.monsters, 0) + ' / ' + fmt(e.projectiles, 0) + ' / ' + fmt(e.drops, 0),
      '粒子/数字  ' + fmt(e.particles, 0) + ' / ' + fmt(e.numbers, 0),
      '降级       ' + (degraded ? '开' : '关'),
      '种子/倍速  ' + fmt(state && state.seed, 0) + ' / ' + fmt(state && state.timescale, 1) + 'x'
    ].join('\n');
  }

  function updateDebug(state) {
    var el = els && els.debug;
    if (!el) { return; }

    var visible = perfOverlayVisible(state);
    var force = false;

    if (!debugInit || visible !== debugVisible) {
      debugInit = true;
      debugVisible = visible;
      force = true;
      if (typeof el.hidden === 'boolean') { el.hidden = !visible; }
    }
    if (!visible) { return; }

    debugTick++;
    if (!force && debugTick % 15 !== 0) { return; }

    var text = buildDebugText(state);
    if (text !== debugText) {
      debugText = text;
      setText(el, text);
    }
  }

  /* ------------------------------------------------------------------ *
   * 公开：render(state)
   * ------------------------------------------------------------------ */
  function render(state) {
    if (!state) { return; }
    var e = ensureEls();
    if (!e) { return; }

    // 只读兜底：玩家实体与 player.stats（combat 拥有，UI 不写）
    var player = WG.combat && WG.combat.player;
    var stats = player && player.stats;

    var maxHp = pickNum(
      state.maxHp,
      player && player.maxHp,
      stats && stats.maxHp,
      num(CONFIG.player && CONFIG.player.maxHp, 100)
    );
    var hp = pickNum(state.hp, player && player.hp, null, maxHp);
    if (hp > maxHp) { hp = maxHp; }
    if (hp < 0) { hp = 0; }

    var level = pickNum(state.level, stats && stats.level, null, 1);
    var xp = pickNum(state.xp, stats && stats.xp, null, 0);
    var xpNext = pickNum(
      state.xpNext,
      stats && stats.xpNext,
      null,
      num(CONFIG.progression && CONFIG.progression.xpBase, 40)
    );

    var remaining = num(state.remaining, NaN);
    if (!isFinite(remaining)) {
      var duration = num(CONFIG.run && CONFIG.run.duration, 480);
      remaining = duration - num(state.runTime, 0);
    }

    // 倒计时（按整秒变化检测）
    var timeSec = Math.max(0, Math.ceil(remaining));
    if (timeSec !== cache.timeSec) {
      cache.timeSec = timeSec;
      setText(e.time, formatCountdown(timeSec));
      var warning = timeSec <= 60 && timeSec > 0;
      if (warning !== cache.warning) {
        cache.warning = warning;
        toggleClass(e.time, 'hud-timer--warning', warning);
      }
    }

    // 气血
    var hpInt = Math.max(0, Math.round(hp));
    var maxInt = Math.max(1, Math.round(maxHp));
    if (hpInt !== cache.hp || maxInt !== cache.hpMax) {
      cache.hp = hpInt;
      cache.hpMax = maxInt;
      setText(e.hp, String(hpInt));
      setText(e.hpMax, String(maxInt));
      setFill(e.hpFill, percent(hpInt, maxInt).toFixed(1) + '%', 'hpFill');
    }

    // 等级 / 经验
    var levelInt = Math.max(1, Math.round(level));
    var xpInt = Math.max(0, Math.round(xp));
    var xpNextInt = Math.max(0, Math.round(xpNext));
    if (levelInt !== cache.level || xpInt !== cache.xp || xpNextInt !== cache.xpNext) {
      cache.level = levelInt;
      cache.xp = xpInt;
      cache.xpNext = xpNextInt;
      setText(e.level, String(levelInt));
      setText(e.xp, xpNextInt > 0 ? xpInt + ' / ' + xpNextInt : '已满级');
      var xpPct = xpNextInt > 0 ? percent(xpInt, xpNextInt) : 100;
      setFill(e.xpFill, xpPct.toFixed(1) + '%', 'xpFill');
    }

    // 计数
    var kills = Math.max(0, Math.round(pickNum(state.kills, null, null, 0)));
    var picks = Math.max(0, Math.round(pickNum(state.picked, state.picks, null, 0)));
    var coins = Math.max(0, Math.round(pickNum(state.coins, state.silver, null, 0)));
    if (kills !== cache.kills) { cache.kills = kills; setText(e.kills, String(kills)); }
    if (picks !== cache.picks) { cache.picks = picks; setText(e.picks, String(picks)); }
    if (coins !== cache.coins) { cache.coins = coins; setText(e.silver, String(coins)); }

    // 门派（只读：state / WG.sects.Selection.current / DEFS）
    var sectName = sectNameFrom(state);
    if (sectName !== cache.sect) {
      cache.sect = sectName;
      setText(e.sectName, sectName);
    }

    // F3 容器（数据来自 WG.perf）
    updateDebug(state);
  }

  /* ------------------------------------------------------------------ *
   * 公开契约
   * ------------------------------------------------------------------ */
  var HUD = {
    render: render
  };

  ui.HUD = HUD;
  ui.hud = HUD;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
