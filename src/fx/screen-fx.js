/*!
 * 江湖夜雨 · visual-fx · screen-fx.js
 * 契约：docs/contracts/wuxia-rogue-v2-architecture-v1.md §4.6 / §5.3 / §8
 * 公开：
 *   WG.fx.assets   → { draw(ctx,id,x,y,w,h,opts), get(id), ready(id), preload(idOrIds) }
 *   WG.fx.screen   → { shake(amp,dur), flash(alpha), swordRain(x,y,r),
 *                      update(dt), render(ctx,alpha,world), reset() }
 *   WG.fx.degrade  → { enabled, set(on), fps, lowTime }
 *   WG.fx.render(ctx, alpha, world)  ← main.js 的组合根绘制钩子
 *
 * 职责：
 *  - 共享图片加载器：generated webp → placeholder svg → missing，静默回退；
 *    预分配/缓存 Image，不逐帧新建对象，缺图/无 drawImage 时返回 false。
 *  - 震屏统一走 WG.core.Camera.shake（core 公开契约）；降级时关闭。
 *  - damage 命中火花（普通/暴击配色）、monster:killed 碎裂/消散环，
 *    均使用预分配固定槽位并环形复用；降级时关闭新增装饰。
 *  - 受击红闪（player:hurt）、击杀轻微震动（monster:killed）、
 *    技能解锁/万剑释放剑雨（ability:unlock + 万剑伤害特征识别）。
 *  - choice:pick → whirl 回旋环（半径 95）、dm_cleave 裂空斩（半径 120）、
 *    swords 万剑剑雨（半径 420）；其它选项仅播放轻量粒子提示。
 *    全部使用预分配槽位/现有对象池，不新建逐事件对象；降级时关闭。
 *  - 自动降级：FPS < CONFIG.fx.degradeFps(50) 持续 CONFIG.fx.degradeSeconds(2) 秒
 *    自动开启；开启后关闭震屏、剑雨细节与红闪，仅保留伤害数字（AC-8）。
 *  - 表现层只读：不修改玩法状态、不发玩法事件；剑雨/闪光对象全部预分配。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var fx = WG.fx = WG.fx || {};

  var CONFIG = (WG.core && WG.core.CONFIG) || {};
  var FX_CFG = CONFIG.fx || {};
  var ABILITIES = CONFIG.abilities || {};
  var VIEW = CONFIG.viewport || {};

  var DEGRADE_FPS = num(FX_CFG.degradeFps, 50);
  var DEGRADE_SECONDS = num(FX_CFG.degradeSeconds, 2);
  var CULL = Math.max(0, num(FX_CFG.cullMargin, 96));

  var COLOR_BLOOD = '#d3564a';
  var COLOR_SWORD = '#bfe9ff';
  var COLOR_GOLD = '#f5d99c';
  var COLOR_JADE = '#7de3c0';
  var CLEAVE_RADIUS = 120; // proposal §6.2 裂空半径（CONFIG 未列，表现侧只读兜底）
  var WHIRL_RADIUS = 95;   // proposal §6.2 剑气回旋半径

  var clock = 0;

  /* ------------------------------------------------------------------ *
   * 共享图片加载器（WG.fx.assets）
   * - 同一 id 只创建一个 Image；generated → placeholder → missing。
   * - 所有失败静默处理；无 Image / 无 drawImage 时安全返回 false。
   * - draw 只读取调用方 opts，不创建临时对象；内部 save/restore。
   * ------------------------------------------------------------------ */
  var ASSET_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
  var ASSET_LIMIT = 64;
  var ASSET_GENERATED = 'assets/generated/';
  var ASSET_PLACEHOLDER = 'assets/placeholder-';
  var assetCache = Object.create(null);
  var assetCacheCount = 0;

  function isDrawableImage(img) {
    return !!(img && img.complete === true &&
      typeof img.naturalWidth === 'number' && img.naturalWidth > 0);
  }

  function markAssetMissing(rec) {
    rec.state = 'missing';
    rec.img = null;
    rec.stage = 2;
  }

  function startAsset(rec) {
    if (rec.state !== 'idle') { return; }
    var ImageCtor = root.Image;
    if (typeof ImageCtor !== 'function') {
      markAssetMissing(rec);
      return;
    }

    rec.state = 'loading';
    var img;
    try {
      img = new ImageCtor();
    } catch (e) {
      markAssetMissing(rec);
      return;
    }
    rec.img = img;

    function fail() {
      if (rec.state !== 'loading') { return; }
      if (rec.stage === 0) {
        rec.stage = 1;
        try {
          img.src = ASSET_PLACEHOLDER + rec.id + '.svg';
        } catch (e) {
          markAssetMissing(rec);
        }
        return;
      }
      markAssetMissing(rec);
    }

    img.onload = function () {
      if (rec.state !== 'loading') { return; }
      if (isDrawableImage(img)) {
        rec.state = 'ready';
        rec.stage = 2;
      } else {
        fail();
      }
    };
    img.onerror = fail;

    try {
      img.src = ASSET_GENERATED + rec.id + '.webp';
    } catch (e) {
      fail();
    }
    // 某些实现会在设置 src 时同步触发 onload；这里补一次兜底判断。
    if (rec.state === 'loading' && isDrawableImage(img)) {
      rec.state = 'ready';
      rec.stage = 2;
    }
  }

  function assetRecord(id) {
    if (typeof id !== 'string' || !ASSET_ID_RE.test(id)) { return null; }
    var rec = assetCache[id];
    if (!rec) {
      if (assetCacheCount >= ASSET_LIMIT) { return null; }
      rec = { id: id, state: 'idle', img: null, stage: 0 };
      assetCache[id] = rec;
      assetCacheCount++;
    }
    if (rec.state === 'idle') { startAsset(rec); }
    return rec;
  }

  function assetGet(id) {
    var rec = assetRecord(id);
    if (!rec || rec.state !== 'ready' || !isDrawableImage(rec.img)) { return null; }
    return rec.img;
  }

  function assetReady(id) {
    return !!assetGet(id);
  }

  function assetPreload(idOrIds) {
    try {
      if (Object.prototype.toString.call(idOrIds) === '[object Array]') {
        for (var i = 0; i < idOrIds.length; i++) { assetRecord(idOrIds[i]); }
      } else {
        assetRecord(idOrIds);
      }
    } catch (e) {
      // 预加载绝不能打断调用方（输入/渲染/加载流程）。
    }
  }

  function clamp01(value) {
    var n = num(value, 1);
    if (n < 0) { return 0; }
    if (n > 1) { return 1; }
    return n;
  }

  function assetDraw(ctx, id, x, y, w, h, opts) {
    if (!ctx || typeof ctx.drawImage !== 'function') {
      assetRecord(id);
      return false;
    }
    var rec = assetRecord(id);
    if (!rec || rec.state !== 'ready' || !isDrawableImage(rec.img)) { return false; }

    var px = num(x, NaN);
    var py = num(y, NaN);
    var dw = num(w, NaN);
    var dh = num(h, NaN);
    if (!isFinite(px) || !isFinite(py) || !isFinite(dw) || !isFinite(dh) ||
        dw <= 0 || dh <= 0) {
      return false;
    }

    var o = (opts && typeof opts === 'object') ? opts : null;
    var alpha = o ? clamp01(num(o.alpha, 1)) : 1;
    var angle = o ? num(o.angle, 0) : 0;
    var flipX = !!(o && o.flipX);
    var bottom = !!(o && o.anchor === 'bottom');
    var flash = !!(o && o.tint === 'flash');
    var prevAlpha = (typeof ctx.globalAlpha === 'number') ? ctx.globalAlpha : 1;
    var saved = false;
    var drawn = false;

    try {
      if (typeof ctx.save === 'function') {
        ctx.save();
        saved = true;
      }
      ctx.globalAlpha = prevAlpha * alpha;

      if ((angle !== 0 || flipX || bottom) && typeof ctx.translate === 'function') {
        ctx.translate(px, py);
        if (angle !== 0 && typeof ctx.rotate === 'function') { ctx.rotate(angle); }
        if (flipX && typeof ctx.scale === 'function') { ctx.scale(-1, 1); }
        ctx.drawImage(rec.img, -dw * 0.5, bottom ? -dh : -dh * 0.5, dw, dh);
      } else {
        ctx.drawImage(rec.img, px - dw * 0.5, bottom ? py - dh : py - dh * 0.5, dw, dh);
      }
      drawn = true;
    } catch (e) {
      drawn = false;
    } finally {
      if (saved) {
        try { ctx.restore(); } catch (e) { /* 恢复失败不抛出 */ }
      }
    }

    // 受击闪白：用低透明度白色圆近似，不要求修改图片像素。
    if (drawn && flash) {
      var flashSaved = false;
      try {
        if (typeof ctx.save === 'function') {
          ctx.save();
          flashSaved = true;
        }
        ctx.globalAlpha = prevAlpha * alpha * 0.32;
        ctx.fillStyle = '#ffffff';
        var cx = px;
        var cy = py - (bottom ? dh * 0.5 : 0);
        var radius = Math.min(dw, dh) * 0.38;
        if (typeof ctx.beginPath === 'function' && typeof ctx.arc === 'function' &&
            typeof ctx.fill === 'function') {
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
        } else if (typeof ctx.fillRect === 'function') {
          ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
        }
      } catch (e) {
        // 闪白是装饰，失败不影响 draw 的成功返回。
      } finally {
        if (flashSaved) {
          try { ctx.restore(); } catch (e) { /* 忽略 */ }
        }
      }
    }

    return drawn;
  }

  var assets = {
    draw: assetDraw,
    get: assetGet,
    ready: assetReady,
    preload: assetPreload
  };

  fx.assets = assets;

  /* ------------------------------------------------------------------ *
   * 降级状态（WG.fx.degrade）
   * ------------------------------------------------------------------ */
  var degrade = {
    enabled: false,
    fps: 0,
    lowTime: 0,
    set: setDegrade
  };

  function setDegrade(on) {
    var next = !!on;
    degrade.enabled = next;
    degrade.lowTime = 0;
    if (next) {
      clearTransient();
      // 立即清空已有粒子（同模块公开 API），确保降级后仅保留伤害数字
      if (fx.particles && typeof fx.particles.reset === 'function') {
        fx.particles.reset();
      }
    }
    return next;
  }

  function readFps() {
    var perf = WG.perf;
    var stats = perf && perf.stats;
    if (stats && typeof stats.fps === 'number' && stats.fps > 0) { return stats.fps; }
    var core = WG.core;
    var loop = core && core.Loop;
    if (loop && loop.frameStats && typeof loop.frameStats.fps === 'number') {
      return loop.frameStats.fps;
    }
    return 0;
  }

  function updateDegrade(dt) {
    var fps = readFps();
    degrade.fps = fps;
    if (!(fps > 0)) {
      degrade.lowTime = 0;
      return;
    }
    if (fps < DEGRADE_FPS) {
      degrade.lowTime += dt;
      if (degrade.lowTime >= DEGRADE_SECONDS && !degrade.enabled) {
        setDegrade(true);
      }
    } else {
      degrade.lowTime = 0;
    }
  }

  /* ------------------------------------------------------------------ *
   * 震屏（Camera.shake）
   * ------------------------------------------------------------------ */
  function shake(amp, dur) {
    if (degrade.enabled) { return false; }
    var a = num(amp, 0);
    if (!(a > 0)) { return false; }
    if (a > 20) { a = 20; }
    var d = num(dur, (CONFIG.camera && CONFIG.camera.shakeDur) || 0.25);
    var cam = WG.core && WG.core.Camera;
    if (cam && typeof cam.shake === 'function') {
      cam.shake(a, d);
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * 受击红闪（屏幕空间覆盖层；预分配，无逐帧对象）
   * ------------------------------------------------------------------ */
  var FLASH_DURATION = 0.3;
  var flashBase = 0;
  var flashTime = 0;

  function flash(alpha) {
    if (degrade.enabled) { return false; }
    var a = num(alpha, 0.25);
    if (!(a > 0)) { return false; }
    if (a > 0.6) { a = 0.6; }
    flashBase = a;
    flashTime = FLASH_DURATION;
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 剑雨：固定容量雨滴（预分配，满时环形复用最旧）
   * ------------------------------------------------------------------ */
  var RAIN_CAP = 56;
  var drops = new Array(RAIN_CAP);
  var dropHead = 0;
  var rainLive = 0;

  function makeDrop() {
    return { alive: false, x: 0, y: 0, vx: 0, vy: 0, len: 24, life: 0, maxLife: 1 };
  }

  for (var i = 0; i < RAIN_CAP; i++) {
    drops[i] = makeDrop();
  }

  function dropSlot() {
    var d = drops[dropHead];
    dropHead = (dropHead + 1) % RAIN_CAP;
    if (!d.alive) { rainLive++; }
    d.alive = true;
    return d;
  }

  var ring = {
    active: false,
    x: 0, y: 0, r: 0,
    t: 0, dur: 0.5,
    color: COLOR_SWORD
  };

  // 裂空斩：预分配单个弧光槽位；满时复用，不逐事件新建对象。
  var slash = {
    active: false,
    x: 0, y: 0, r: CLEAVE_RADIUS,
    t: 0, dur: 0.32,
    angle: 0
  };

  /* ------------------------------------------------------------------ *
   * damage 命中火花：固定 32 槽，满时环形复用最旧
   * ------------------------------------------------------------------ */
  var SPARK_CAP = 32;
  var sparks = new Array(SPARK_CAP);
  var sparkHead = 0;
  var sparkLive = 0;

  function makeSpark() {
    return {
      active: false,
      x: 0, y: 0,
      t: 0, dur: 0.16,
      angle: 0,
      crit: false
    };
  }

  for (var si = 0; si < SPARK_CAP; si++) {
    sparks[si] = makeSpark();
  }

  function sparkSlot() {
    var s = sparks[sparkHead];
    sparkHead = (sparkHead + 1) % SPARK_CAP;
    if (!s.active) { sparkLive++; }
    s.active = true;
    return s;
  }

  function spawnSpark(x, y, crit) {
    if (degrade.enabled) { return 0; }
    var px = num(x, NaN);
    var py = num(y, NaN);
    if (!isFinite(px) || !isFinite(py) || !inView(px, py)) { return 0; }

    var s = sparkSlot();
    s.x = px;
    s.y = py;
    s.t = 0;
    s.dur = crit ? 0.22 : 0.15;
    s.angle = Math.random() * Math.PI * 2;
    s.crit = !!crit;
    return 1;
  }

  function updateSparks(dt) {
    for (var i = 0; i < SPARK_CAP; i++) {
      var s = sparks[i];
      if (!s.active) { continue; }
      s.t += dt;
      if (s.t >= s.dur) {
        s.active = false;
        sparkLive--;
      }
    }
  }

  function clearSparks() {
    for (var i = 0; i < SPARK_CAP; i++) { sparks[i].active = false; }
    sparkLive = 0;
    sparkHead = 0;
  }

  function renderSparks(ctx, x0, x1, y0, y1) {
    if (sparkLive <= 0) { return; }
    ctx.save();
    ctx.lineCap = 'round';
    for (var i = 0; i < SPARK_CAP; i++) {
      var s = sparks[i];
      if (!s.active) { continue; }
      if (s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) { continue; }

      var k = s.t / s.dur;
      if (k >= 1) { continue; }
      var radius = (s.crit ? 12 : 7) * (0.45 + 0.8 * k);
      var alpha = (1 - k) * (s.crit ? 0.95 : 0.72);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = s.crit ? COLOR_GOLD : COLOR_SWORD;
      ctx.lineWidth = s.crit ? 2 : 1.3;
      ctx.beginPath();
      for (var r = 0; r < 3; r++) {
        var a = s.angle + r * 2.0943951023931953;
        var inner = radius * 0.28;
        var outer = radius * (1 - r * 0.12);
        ctx.moveTo(s.x + Math.cos(a) * inner, s.y + Math.sin(a) * inner);
        ctx.lineTo(s.x + Math.cos(a) * outer, s.y + Math.sin(a) * outer);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   * monster:killed 碎裂/消散环：固定 16 槽，满时环形复用最旧
   * ------------------------------------------------------------------ */
  var DISSOLVE_CAP = 16;
  var dissolves = new Array(DISSOLVE_CAP);
  var dissolveHead = 0;
  var dissolveLive = 0;

  function makeDissolve() {
    return {
      active: false,
      x: 0, y: 0,
      t: 0, dur: 0.32,
      angle: 0,
      tier: 0,
      color: COLOR_BLOOD
    };
  }

  for (var di = 0; di < DISSOLVE_CAP; di++) {
    dissolves[di] = makeDissolve();
  }

  function dissolveSlot() {
    var d = dissolves[dissolveHead];
    dissolveHead = (dissolveHead + 1) % DISSOLVE_CAP;
    if (!d.active) { dissolveLive++; }
    d.active = true;
    return d;
  }

  function killTier(type) {
    if (type === 'boss') { return 2; }
    if (type === 'elite' || type === 'daoke' || type === 'blade' ||
        type === 'bladeMaster' || type === 'bloodmaster') {
      return 1;
    }
    return 0;
  }

  function killColor(type) {
    if (type === 'boss') { return COLOR_GOLD; }
    if (type === 'bloodmaster' || type === 'blade' || type === 'bladeMaster') {
      return COLOR_BLOOD;
    }
    if (type === 'archer') { return COLOR_SWORD; }
    return '#d3564a';
  }

  function spawnDissolve(x, y, type) {
    if (degrade.enabled) { return 0; }
    var px = num(x, NaN);
    var py = num(y, NaN);
    if (!isFinite(px) || !isFinite(py)) { return 0; }

    var tier = killTier(type || '');
    var d = dissolveSlot();
    d.x = px;
    d.y = py;
    d.t = 0;
    d.dur = tier === 2 ? 0.58 : (tier === 1 ? 0.46 : 0.34);
    d.angle = Math.random() * Math.PI * 2;
    d.tier = tier;
    d.color = killColor(type || '');
    return 1;
  }

  function updateDissolves(dt) {
    for (var i = 0; i < DISSOLVE_CAP; i++) {
      var d = dissolves[i];
      if (!d.active) { continue; }
      d.t += dt;
      if (d.t >= d.dur) {
        d.active = false;
        dissolveLive--;
      }
    }
  }

  function clearDissolves() {
    for (var i = 0; i < DISSOLVE_CAP; i++) { dissolves[i].active = false; }
    dissolveLive = 0;
    dissolveHead = 0;
  }

  function renderDissolves(ctx, x0, x1, y0, y1) {
    if (dissolveLive <= 0) { return; }
    ctx.save();
    for (var i = 0; i < DISSOLVE_CAP; i++) {
      var d = dissolves[i];
      if (!d.active) { continue; }
      if (d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1) { continue; }

      var k = d.t / d.dur;
      if (k >= 1) { continue; }
      var base = d.tier === 2 ? 24 : (d.tier === 1 ? 18 : 13);
      var grow = d.tier === 2 ? 46 : (d.tier === 1 ? 32 : 21);
      var radius = base + grow * k;
      var alpha = (d.tier === 2 ? 0.82 : (d.tier === 1 ? 0.66 : 0.5)) * (1 - k);

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = d.color;
      ctx.lineWidth = d.tier === 2 ? 3 : 2;
      ctx.beginPath();
      ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      // 碎裂线：普通 4 条，精英 6 条，宗师 8 条。
      var rays = d.tier === 2 ? 8 : (d.tier === 1 ? 6 : 4);
      ctx.globalAlpha = alpha * 0.8;
      ctx.lineWidth = d.tier === 2 ? 2.2 : 1.5;
      ctx.beginPath();
      for (var r = 0; r < rays; r++) {
        var a = d.angle + (r / rays) * Math.PI * 2;
        var inner = radius * 0.35;
        var outer = radius * (0.92 + (r % 2) * 0.14);
        ctx.moveTo(d.x + Math.cos(a) * inner, d.y + Math.sin(a) * inner);
        ctx.lineTo(d.x + Math.cos(a) * outer, d.y + Math.sin(a) * outer);
      }
      ctx.stroke();

      if (d.tier > 0) {
        ctx.globalAlpha = alpha * 0.45;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(d.x, d.y, radius * 0.62, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** 播放一次环形光效（whirl / 剑雨共用预分配 ring 槽位）。 */
  function ringWave(x, y, r, dur, color) {
    if (degrade.enabled) { return 0; }
    var px = num(x, NaN);
    var py = num(y, NaN);
    if (!isFinite(px) || !isFinite(py)) { return 0; }

    var radius = num(r, WHIRL_RADIUS);
    if (radius < 20) { radius = 20; }
    if (radius > 1200) { radius = 1200; }

    ring.active = true;
    ring.x = px;
    ring.y = py;
    ring.r = radius;
    ring.t = 0;
    ring.dur = Math.max(0.1, num(dur, 0.55));
    ring.color = color || COLOR_JADE;
    return radius;
  }

  /** 播放一次裂空弧光（半径 120）。 */
  function cleaveSlash(x, y, r) {
    if (degrade.enabled) { return 0; }
    var px = num(x, NaN);
    var py = num(y, NaN);
    if (!isFinite(px) || !isFinite(py)) { return 0; }

    var radius = num(r, CLEAVE_RADIUS);
    if (radius < 40) { radius = 40; }
    if (radius > 600) { radius = 600; }

    slash.active = true;
    slash.x = px;
    slash.y = py;
    slash.r = radius;
    slash.t = 0;
    slash.dur = 0.32;
    slash.angle = Math.random() * Math.PI * 2;
    return radius;
  }

  /** 通过公开 API 生成轻量粒子提示；粒子池满时由 burst 环形复用。 */
  function burstAt(x, y, color, n) {
    var particles = fx.particles;
    if (!particles || typeof particles.burst !== 'function') { return 0; }
    return particles.burst(x, y, color, n);
  }

  function abilityRadius() {
    var sr = ABILITIES.swordRain;
    return num(sr && sr.radius, 420);
  }

  /**
   * 剑雨表现。
   * @param {number} x 中心
   * @param {number} y 中心
   * @param {number} [r] 半径（默认 CONFIG.abilities.swordRain.radius）
   * @returns {number} 生成的雨滴数
   */
  function swordRain(x, y, r) {
    if (degrade.enabled) { return 0; }
    var px = num(x, NaN);
    var py = num(y, NaN);
    if (!isFinite(px) || !isFinite(py)) { return 0; }

    var radius = num(r, abilityRadius());
    if (radius < 80) { radius = 80; }
    if (radius > 1200) { radius = 1200; }

    var count = 18 + Math.floor(radius / 14);
    if (count > RAIN_CAP) { count = RAIN_CAP; }
    if (count < 6) { count = 6; }

    for (var k = 0; k < count; k++) {
      var angle = Math.random() * Math.PI * 2;
      var dist = Math.sqrt(Math.random()) * radius * 0.95;
      var tx = px + Math.cos(angle) * dist;
      var ty = py + Math.sin(angle) * dist;
      var startY = ty - radius * (0.45 + Math.random() * 0.55);

      var d = dropSlot();
      d.x = tx + (Math.random() - 0.5) * 12;
      d.y = startY;
      d.vx = (Math.random() - 0.5) * 36;
      d.vy = 900 + Math.random() * 620;
      d.len = 20 + Math.random() * 24;
      d.maxLife = 0.55 + Math.random() * 0.35;
      d.life = d.maxLife;
    }

    ringWave(px, py, radius, 0.5, COLOR_SWORD);

    shake(2.2, 0.2);
    return count;
  }

  function clearRain() {
    for (var j = 0; j < RAIN_CAP; j++) {
      drops[j].alive = false;
    }
    rainLive = 0;
    dropHead = 0;
    ring.active = false;
    ring.t = 0;
  }

  function updateRain(dt) {
    for (var j = 0; j < RAIN_CAP; j++) {
      var d = drops[j];
      if (!d.alive) { continue; }
      d.life -= dt;
      if (d.life <= 0) {
        d.alive = false;
        rainLive--;
        continue;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
    }
    if (ring.active) {
      ring.t += dt;
      if (ring.t >= ring.dur) { ring.active = false; }
    }
  }

  /* ------------------------------------------------------------------ *
   * 只读协作：玩家位置 / 视口判断
   * ------------------------------------------------------------------ */
  var POS = { x: 0, y: 0 };

  function playerPos() {
    var combat = WG.combat;
    var player = combat && combat.player;
    if (player && typeof player.x === 'number' && typeof player.y === 'number') {
      POS.x = player.x;
      POS.y = player.y;
      return POS;
    }
    var cam = WG.core && WG.core.Camera;
    if (cam && typeof cam.x === 'number' && typeof cam.y === 'number') {
      POS.x = cam.x + cam.w * 0.5;
      POS.y = cam.y + cam.h * 0.5;
    } else {
      POS.x = num(VIEW.width, 1280) * 0.5;
      POS.y = num(VIEW.height, 720) * 0.5;
    }
    return POS;
  }

  function inView(x, y) {
    var cam = WG.core && WG.core.Camera;
    if (!cam || !(cam.w > 0) || !(cam.h > 0)) { return true; }
    return x >= cam.x - CULL && x <= cam.x + cam.w + CULL &&
      y >= cam.y - CULL && y <= cam.y + cam.h + CULL;
  }

  /* ------------------------------------------------------------------ *
   * 事件表现（只读订阅）
   * ------------------------------------------------------------------ */
  var killShakeCooldown = 0;

  function onMonsterKilled(payload) {
    if (!payload || degrade.enabled) { return; }
    var x = num(payload.x, NaN);
    var y = num(payload.y, NaN);
    if (!isFinite(x) || !isFinite(y) || !inView(x, y)) { return; }

    var type = payload.type || '';
    spawnDissolve(x, y, type);

    if (killShakeCooldown > 0) { return; }
    var amp = 1.2;
    var dur = 0.1;
    if (type === 'boss') { amp = 5; dur = 0.24; killShakeCooldown = 0.2; }
    else if (type === 'daoke' || type === 'blade' || type === 'bladeMaster' || type === 'bloodmaster') {
      amp = 2.4; dur = 0.14; killShakeCooldown = 0.14;
    } else {
      killShakeCooldown = 0.1;
    }
    shake(amp, dur);
  }

  var lastHp = -1;
  var lastMaxHp = 0;

  function onPlayerHurt(payload) {
    if (!payload || degrade.enabled) { return; }
    var maxHp = num(payload.maxHp, num(lastMaxHp, CONFIG.player ? CONFIG.player.maxHp : 100));
    var hp = num(payload.hp, maxHp);

    var frac = 0;
    if (lastHp >= 0 && lastMaxHp > 0 && hp < lastHp) {
      frac = (lastHp - hp) / Math.max(1, lastMaxHp);
    }
    lastHp = hp;
    lastMaxHp = maxHp;

    var a = 0.16 + Math.min(0.34, frac * 0.8);
    flash(a);
  }

  function normalizeAbility(raw) {
    if (raw === null || typeof raw === 'undefined') { return null; }
    var key = String(raw).toLowerCase().replace(/[\s_-]/g, '');
    if (key === 'swordrain' || key === 'wanjian' || key === '万剑归宗' || key === '万剑') {
      return 'swordRain';
    }
    if (key === 'whirl' || key === 'whirlwind' || key === '剑气回旋' || key === '回旋') {
      return 'whirl';
    }
    if (key === 'doubleqi' || key === '双剑气') { return 'doubleQi'; }
    return null;
  }

  function onAbilityUnlock(payload) {
    if (!payload || degrade.enabled) { return; }
    var id = normalizeAbility(payload.id !== undefined ? payload.id : payload.abilityId);
    if (id !== 'swordRain') { return; }
    var pos = playerPos();
    swordRain(pos.x, pos.y, abilityRadius());
  }

  /** choice:pick 的技能 id 归一化：whirl / dm_cleave / swords。 */
  function normalizeChoiceSkill(raw) {
    if (raw === null || raw === undefined) { return ''; }
    var key = String(raw).toLowerCase().replace(/[\s_-]/g, '');
    if (key === 'whirl' || key === 'whirlwind' || key === '剑气回旋' || key === '回旋') {
      return 'whirl';
    }
    if (key === 'dmcleave' || key === 'cleave' || key === '裂空') {
      return 'cleave';
    }
    if (key === 'swords' || key === 'swordrain' || key === 'wanjian' ||
        key === '万剑归宗' || key === '万剑') {
      return 'swords';
    }
    return '';
  }

  /**
   * 升级三选一确认后的技能视觉反馈（只读事件，不写玩法状态）。
   * whirl：半径 95 回旋环 + 玉色光点；dm_cleave：半径 120 弧光 + 金色碎光；
   * swords：半径 420 剑雨；其余选项仅 6 颗轻量光点。
   */
  function onChoicePick(payload) {
    if (!payload || degrade.enabled) { return; }
    var raw = payload.optionId !== undefined ? payload.optionId : payload.id;
    if (raw === undefined || raw === null || raw === '') { return; }

    try {
      var kind = normalizeChoiceSkill(raw);
      var pos = playerPos();

      if (kind === 'whirl') {
        ringWave(pos.x, pos.y, WHIRL_RADIUS, 0.55, COLOR_JADE);
        burstAt(pos.x, pos.y, COLOR_JADE, 16);
        shake(1.2, 0.12);
        return;
      }
      if (kind === 'cleave') {
        cleaveSlash(pos.x, pos.y, CLEAVE_RADIUS);
        burstAt(pos.x, pos.y, COLOR_GOLD, 20);
        shake(2.2, 0.14);
        return;
      }
      if (kind === 'swords') {
        // 同一时刻若 combat 立即产生 60 点伤害特征，避免重复触发第二份剑雨。
        lastRainCast = clock;
        swordRain(pos.x, pos.y, abilityRadius());
        burstAt(pos.x, pos.y, COLOR_SWORD, 12);
        return;
      }

      // 其它升级选项（通用/门派被动）：轻量光点提示，不阻塞、不写状态。
      burstAt(pos.x, pos.y, COLOR_GOLD, 6);
    } catch (e) {
      // 表现失败不得影响 choice:pick 的玩法链路（暂停/属性应用）。
    }
  }

  /*
   * 万剑的周期性释放没有独立事件（combat 约定「表现由 fx 订阅 damage」）；
   * 这里用伤害特征做只读识别：短窗口内 ≥3 次 60 点命中（swordRain.damage）
   * 视为一次万剑释放，在命中点均值处播剑雨。也兼容未来 payload 携带 abilityId。
   */
  var SWORD_WINDOW = 0.2;
  var swordWindowStart = -1;
  var swordHits = 0;
  var swordSumX = 0;
  var swordSumY = 0;
  var lastRainCast = -100;

  function triggerRain(x, y) {
    if (degrade.enabled) { return 0; }
    if (clock - lastRainCast < 1) { return 0; }
    lastRainCast = clock;
    return swordRain(x, y, abilityRadius());
  }

  function onDamage(payload) {
    if (!payload) { return; }

    var sparkX = num(payload.x, NaN);
    var sparkY = num(payload.y, NaN);
    if (isFinite(sparkX) && isFinite(sparkY)) {
      spawnSpark(sparkX, sparkY, !!(payload.crit || payload.critical ||
        payload.kind === 'crit'));
    }

    var hint = payload.abilityId || payload.ability || payload.source;
    if (hint && /sword/i.test(String(hint))) {
      var pos = playerPos();
      var hx = num(payload.x, pos.x);
      var hy = num(payload.y, pos.y);
      triggerRain(hx, hy);
      return;
    }

    var amount = num(payload.amount, num(payload.damage, NaN));
    if (!isFinite(amount)) { return; }
    var swordDamage = num(ABILITIES.swordRain && ABILITIES.swordRain.damage, 60);
    if (amount < swordDamage - 1 || amount > swordDamage + 1) { return; }

    var x = num(payload.x, NaN);
    var y = num(payload.y, NaN);
    if (!isFinite(x) || !isFinite(y)) { return; }

    if (swordWindowStart < 0 || clock - swordWindowStart > SWORD_WINDOW) {
      swordWindowStart = clock;
      swordHits = 0;
      swordSumX = 0;
      swordSumY = 0;
    }
    swordHits++;
    swordSumX += x;
    swordSumY += y;

    if (swordHits >= 3) {
      var cx = swordSumX / swordHits;
      var cy = swordSumY / swordHits;
      swordWindowStart = -1;
      swordHits = 0;
      triggerRain(cx, cy);
    }
  }

  /* ------------------------------------------------------------------ *
   * 固定步长更新
   * ------------------------------------------------------------------ */
  function update(dt) {
    var step = num(dt, 1 / 60);
    if (step <= 0) { return; }
    clock += step;

    if (killShakeCooldown > 0) {
      killShakeCooldown -= step;
      if (killShakeCooldown < 0) { killShakeCooldown = 0; }
    }
    if (flashTime > 0) {
      flashTime -= step;
      if (flashTime < 0) { flashTime = 0; }
    }
    if (slash.active) {
      slash.t += step;
      if (slash.t >= slash.dur) {
        slash.active = false;
        slash.t = 0;
      }
    }
    updateSparks(step);
    updateDissolves(step);
    updateRain(step);
    updateDegrade(step);
  }

  /* ------------------------------------------------------------------ *
   * 渲染：世界层（剑雨）+ 屏幕层（受击红闪）
   * main 已在 Camera.apply 之后调用 fx.render，因此世界层直接按世界坐标画。
   * ------------------------------------------------------------------ */
  function renderWorld(ctx) {
    if (!ctx || degrade.enabled) { return; }

    var cam = WG.core && WG.core.Camera;
    var x0 = -Infinity, x1 = Infinity, y0 = -Infinity, y1 = Infinity;
    if (cam && cam.w > 0 && cam.h > 0) {
      x0 = cam.x - CULL;
      x1 = cam.x + cam.w + CULL;
      y0 = cam.y - CULL;
      y1 = cam.y + cam.h + CULL;
    }

    if (slash.active) {
      var sk = slash.t / slash.dur;
      if (sk > 1) { sk = 1; }
      var sr = slash.r * (0.72 + 0.28 * sk);
      var sa = 0.62 * (1 - sk);
      if (sa > 0.01) {
        ctx.save();
        ctx.globalAlpha = sa;
        ctx.strokeStyle = COLOR_GOLD;
        ctx.lineWidth = 2 + 8 * (1 - sk);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(slash.x, slash.y, sr, slash.angle - 0.55, slash.angle + 0.55);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (ring.active) {
      var k = ring.t / ring.dur;
      if (k > 1) { k = 1; }
      var rr = ring.r * k;
      var ra = 0.42 * (1 - k);
      if (ra > 0.01) {
        ctx.save();
        ctx.globalAlpha = ra;
        ctx.strokeStyle = ring.color || COLOR_SWORD;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    renderSparks(ctx, x0, x1, y0, y1);
    renderDissolves(ctx, x0, x1, y0, y1);

    if (rainLive > 0) {
      ctx.save();
      ctx.globalAlpha = 0.78;
      ctx.strokeStyle = COLOR_SWORD;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var j = 0; j < RAIN_CAP; j++) {
        var d = drops[j];
        if (!d.alive) { continue; }
        if (d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1) { continue; }
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.vx * 0.014, d.y - d.len);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function renderOverlay(ctx, world) {
    if (!ctx) { return; }
    if (world && typeof world.state === 'string' && world.state !== 'playing') { return; }
    if (!(flashTime > 0) || degrade.enabled) { return; }

    var a = flashBase * (flashTime / FLASH_DURATION);
    if (a <= 0.002) { return; }

    var canvas = ctx.canvas;
    var w = (canvas && canvas.width) ? canvas.width : num(VIEW.width, 1280);
    var h = (canvas && canvas.height) ? canvas.height : num(VIEW.height, 720);

    ctx.save();
    // 覆盖层用屏幕坐标：临时清掉相机平移（main 会在之后 restore）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = a;
    ctx.fillStyle = COLOR_BLOOD;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function render(ctx, alpha, world) {
    renderWorld(ctx);
    renderOverlay(ctx, world);
  }

  /* ------------------------------------------------------------------ *
   * 清场
   * ------------------------------------------------------------------ */
  function clearTransient() {
    flashBase = 0;
    flashTime = 0;
    killShakeCooldown = 0;
    lastHp = -1;
    lastMaxHp = 0;
    swordWindowStart = -1;
    swordHits = 0;
    swordSumX = 0;
    swordSumY = 0;
    lastRainCast = -100;
    clearRain();
    clearSparks();
    clearDissolves();
    slash.active = false;
    slash.t = 0;
    ring.color = COLOR_SWORD;
  }

  function reset() {
    clock = 0;
    clearTransient();
  }

  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  /* ------------------------------------------------------------------ *
   * 事件绑定（只读订阅；ui:start / ui:restart 仅做清场）
   * ------------------------------------------------------------------ */
  function bind(type, fn) {
    var bus = WG.core && WG.core.Bus;
    if (bus && typeof bus.on === 'function') {
      bus.on(type, fn);
    }
  }

  bind('player:hurt', onPlayerHurt);
  bind('monster:killed', onMonsterKilled);
  bind('ability:unlock', onAbilityUnlock);
  bind('damage', onDamage);
  bind('choice:pick', onChoicePick);
  bind('ui:start', reset);
  bind('ui:restart', reset);

  /* ------------------------------------------------------------------ *
   * 公开契约
   * ------------------------------------------------------------------ */
  var screen = {
    shake: shake,
    flash: flash,
    swordRain: swordRain,
    update: update,
    render: render,
    reset: reset
  };

  Object.defineProperty(screen, 'rainCount', {
    enumerable: true,
    get: function () { return rainLive; }
  });
  Object.defineProperty(screen, 'sparkCount', {
    enumerable: true,
    get: function () { return sparkLive; }
  });
  Object.defineProperty(screen, 'dissolveCount', {
    enumerable: true,
    get: function () { return dissolveLive; }
  });

  fx.screen = screen;
  fx.degrade = degrade;
  fx.render = render;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
