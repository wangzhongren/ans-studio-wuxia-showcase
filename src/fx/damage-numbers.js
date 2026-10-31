/*!
 * 江湖夜雨 · visual-fx · damage-numbers.js
 * 契约：docs/contracts/wuxia-rogue-v2-architecture-v1.md §4.6 / §5.3 / §8
 * 公开：WG.fx.numbers → { damageNumber(x,y,value,kind), update(dt), render(ctx,alpha), count, cap, reset() }
 *
 * 职责：
 *  - 固定容量对象池（上限 CONFIG.pools.damageNumbers = 64），预分配 + 环形复用最旧。
 *  - 只读订阅 damage 事件；普通/暴击用字号、颜色区分（payload.crit 或 kind='crit'）。
 *  - 降级模式下保留伤害数字（仅保留伤害数字，保障 AC-8 下仍有命中反馈）。
 *  - 表现层只读：不修改玩法状态、不发玩法事件。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var fx = WG.fx = WG.fx || {};

  var CONFIG = (WG.core && WG.core.CONFIG) || {};
  var POOL_CFG = CONFIG.pools || {};
  var FX_CFG = CONFIG.fx || {};

  var CAP = Math.max(1, Math.floor(POOL_CFG.damageNumbers || 64));
  var CULL = Math.max(0, FX_CFG.cullMargin || 96);

  var FONT_NORMAL = '600 15px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
  var FONT_CRIT = '700 24px "STKaiti", "KaiTi", "Songti SC", "SimSun", serif';
  var COLOR_NORMAL = '#f6f2e8';
  var COLOR_CRIT = '#f5d99c';
  var OUTLINE = 'rgba(7, 10, 15, 0.82)';

  var LIFE_NORMAL = 0.7;
  var LIFE_CRIT = 0.95;
  var RISE_SPEED = 58;

  /* ------------------------------------------------------------------ *
   * 固定容量池
   * ------------------------------------------------------------------ */
  var items = new Array(CAP);
  var head = 0;
  var live = 0;

  function makeNumber() {
    return {
      alive: false,
      x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 1,
      crit: false,
      text: '0',
      font: FONT_NORMAL,
      color: COLOR_NORMAL
    };
  }

  for (var i = 0; i < CAP; i++) {
    items[i] = makeNumber();
  }

  function slot() {
    var n = items[head];
    head = (head + 1) % CAP;
    if (!n.alive) { live++; }
    n.alive = true;
    return n;
  }

  /* ------------------------------------------------------------------ *
   * 公开：damageNumber(x,y,value,kind)
   * ------------------------------------------------------------------ */
  function damageNumber(x, y, value, kind) {
    var px = num(x, NaN);
    var py = num(y, NaN);
    var amount = num(value, NaN);
    if (!isFinite(px) || !isFinite(py) || !isFinite(amount)) { return null; }

    var rounded = Math.round(amount);
    if (rounded < 0) { rounded = 0; }
    var crit = (kind === 'crit' || kind === 'critical' || kind === true);

    var n = slot();
    n.x = px + (Math.random() - 0.5) * 16;
    n.y = py - 10 + (Math.random() - 0.5) * 6;
    n.vx = (Math.random() - 0.5) * 18;
    n.vy = -RISE_SPEED;
    n.maxLife = crit ? LIFE_CRIT : LIFE_NORMAL;
    n.life = n.maxLife;
    n.crit = crit;
    n.text = String(rounded);
    n.font = crit ? FONT_CRIT : FONT_NORMAL;
    n.color = crit ? COLOR_CRIT : COLOR_NORMAL;
    return n;
  }

  /* ------------------------------------------------------------------ *
   * 只读订阅：damage
   * ------------------------------------------------------------------ */
  function onDamage(payload) {
    if (!payload) { return; }
    var amount = num(payload.amount, num(payload.damage, NaN));
    if (!isFinite(amount)) { return; }
    damageNumber(payload.x, payload.y, amount, payload.crit ? 'crit' : 'normal');
  }

  /* ------------------------------------------------------------------ *
   * 固定步长更新
   * ------------------------------------------------------------------ */
  function update(dt) {
    var step = num(dt, 1 / 60);
    if (step <= 0) { return; }

    for (var i = 0; i < CAP; i++) {
      var n = items[i];
      if (!n.alive) { continue; }

      n.life -= step;
      if (n.life <= 0) {
        n.alive = false;
        live--;
        continue;
      }

      // 上浮逐渐减速，轻微横向漂移
      n.vy += 46 * step;
      n.vx *= (1 - 0.8 * step);
      n.x += n.vx * step;
      n.y += n.vy * step;
    }
  }

  /* ------------------------------------------------------------------ *
   * 渲染（main 已施加相机变换；世界坐标）
   * ------------------------------------------------------------------ */
  function render(ctx, alpha) {
    if (!ctx) { return; }

    var cam = WG.core && WG.core.Camera;
    var x0 = -Infinity, x1 = Infinity, y0 = -Infinity, y1 = Infinity;
    if (cam && cam.w > 0 && cam.h > 0) {
      x0 = cam.x - CULL;
      x1 = cam.x + cam.w + CULL;
      y0 = cam.y - CULL;
      y1 = cam.y + cam.h + CULL;
    }

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    var lastFont = '';
    for (var i = 0; i < CAP; i++) {
      var n = items[i];
      if (!n.alive) { continue; }
      if (n.x < x0 || n.x > x1 || n.y < y0 || n.y > y1) { continue; }

      var t = n.life / n.maxLife;
      if (t > 1) { t = 1; }
      // 前 25% 保持全亮，后段淡出
      var a = t > 0.25 ? 1 : (t / 0.25);
      if (a <= 0.01) { continue; }

      if (n.font !== lastFont) {
        ctx.font = n.font;
        lastFont = n.font;
      }

      ctx.globalAlpha = a;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = n.crit ? 4 : 3;
      ctx.strokeText(n.text, n.x, n.y);
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, n.x, n.y);
    }

    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   * 清空
   * ------------------------------------------------------------------ */
  function reset() {
    for (var i = 0; i < CAP; i++) {
      items[i].alive = false;
    }
    live = 0;
    head = 0;
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

  bind('damage', onDamage);
  bind('ui:start', reset);
  bind('ui:restart', reset);

  /* ------------------------------------------------------------------ *
   * 公开契约
   * ------------------------------------------------------------------ */
  var numbers = {
    damageNumber: damageNumber,
    update: update,
    render: render,
    reset: reset
  };

  Object.defineProperty(numbers, 'count', {
    enumerable: true,
    get: function () { return live; }
  });
  Object.defineProperty(numbers, 'cap', {
    enumerable: true,
    get: function () { return CAP; }
  });

  fx.numbers = numbers;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
