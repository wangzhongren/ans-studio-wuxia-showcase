/* 江湖夜雨 · loot-progression 掉落与拾取（v2）
 * 架构契约 v2 §4.5 / §5.1 / §5.2
 * 公开：WG.loot.LootSystem = { dropAt(x,y,type), update(dt,player), render(ctx,alpha), reset(world), pool, count() }
 * 监听：monster:killed → 死亡点掉落入池，并发 loot:drop {x,y,kind}
 * 拾取：距离 ≤ pickupRadius 或进入 magnetRadius 后磁吸；拾取发 loot:picked {kind,amount,total}
 *       经验珠调用 WG.loot.Progression.addXp；银两/疗伤丹按拾取事件结算。
 * 只读加法字段：potionDropMult 提升疗伤丹掉落率（默认 1）、
 *       potionHealBonus 提升拾取回复量（默认 0）；字段缺失/非法按默认值处理，绝不写入。
 * 本模块不写玩家成长属性；成长由 sects-progression 以三选一承接。
 * 渲染：main 已施加相机变换，render 只画世界坐标；三种掉落物优先用
 *       WG.fx.assets.draw(drop-xp/drop-silver/drop-potion) 贴图，缺图/未就绪时回退几何；
 *       支持 0.25s 弹出、磁吸提示与离屏剔除，不逐帧新建对象。
 * 复位：reset(world) 清空掉落/计数/计时，按 world.seed 重置掉落 RNG，并调用 Progression.reset。
 * 对象池上限 150（架构 §7）；无卡牌。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var loot = WG.loot = WG.loot || {};
  var tables = loot.tables;
  if (!tables) {
    if (root.console && root.console.error) {
      root.console.error('[WG.loot.LootSystem] 缺少 WG.loot.tables，请检查脚本加载顺序');
    }
    return;
  }

  var DROP = tables.DROP_TABLE;
  var PICKUP = tables.PICKUP;
  var CAP = DROP.maxDrops || 150;
  var bound = false;

  /* 渲染常量（模块级，避免逐帧分配） */
  var TAU = Math.PI * 2;
  var CULL_MARGIN = 96;      /* 离屏剔除余量（含弹出上浮） */
  var OUTLINE_ORB = '#12303d';
  var OUTLINE_GOLD = '#6b4a12';
  var OUTLINE_POTION = '#1c6b37';
  var CORK = '#0f3d21';
  var HIGHLIGHT = '#eaffff';

  /* 掉落物贴图：id 由美术桥 v1 §2 固定；加载器由 presentation-fx 提供。
   * opts 复用模块级对象，避免逐帧新建；缺图/未就绪时由 draw 返回 false 回退几何。 */
  var ASSET_IDS = { xp: 'drop-xp', silver: 'drop-silver', potion: 'drop-potion' };
  var ASSET_SIZE_MUL = 3.2;
  var ASSET_OPTS = { alpha: 1, anchor: 'center' };

  /* ------------------------------------------------------------------ *
   * 对象池：active 为当前掉落物，free 为复用栈；到上限复用最旧对象。
   * ------------------------------------------------------------------ */
  var active = [];
  var free = [];

  function acquire() {
    var o = free.pop();
    if (!o) {
      o = {
        kind: '',
        x: 0,
        y: 0,
        px: 0,
        py: 0,
        amount: 0,
        heal: 0,
        radius: 5,
        age: 0,
        magnet: false
      };
    }
    o.kind = '';
    o.x = 0;
    o.y = 0;
    o.px = 0;
    o.py = 0;
    o.amount = 0;
    o.heal = 0;
    o.radius = 5;
    o.age = 0;
    o.magnet = false;
    return o;
  }

  function recycle(o) {
    o.kind = '';
    o.magnet = false;
    free.push(o);
  }

  var pool = {
    capacity: CAP,
    forEach: function (fn) {
      for (var i = 0; i < active.length; i++) fn(active[i], i);
    }
  };
  Object.defineProperty(pool, 'count', {
    enumerable: true,
    get: function () { return active.length; }
  });
  Object.defineProperty(pool, 'items', {
    enumerable: true,
    get: function () { return active; }
  });

  /* ------------------------------------------------------------------ *
   * 掉落确定性随机：与 world.seed 绑定（AC-8 同 seed 可复现）
   * 实际种子 = ((world.seed >>> 0) ^ 0x5eed1234) >>> 0；world 缺失时用默认种子。
   * reset(world) 会重建 RNG，保证同一 seed 重开时掉落序列从头开始且一致。
   * ------------------------------------------------------------------ */
  var DEFAULT_SEED = 0x5eed1234;
  var rng = null;

  function resetRng(world) {
    var seed = DEFAULT_SEED;
    if (world && typeof world.seed === 'number' && isFinite(world.seed)) {
      seed = ((world.seed >>> 0) ^ DEFAULT_SEED) >>> 0;
    }

    var Rng = WG.core && WG.core.Rng;
    if (typeof Rng === 'function') {
      try { rng = Rng(seed); } catch (err) { rng = null; }
    } else {
      rng = null;
    }
    return seed;
  }

  function random() {
    if (!rng) resetRng(null);
    if (rng && typeof rng.next === 'function') return rng.next();
    return Math.random();
  }

  function randInt(min, max) {
    var lo = Math.ceil(min);
    var hi = Math.floor(max);
    return lo + Math.floor(random() * (hi - lo + 1));
  }

  /* ------------------------------------------------------------------ *
   * 事件
   * ------------------------------------------------------------------ */
  function bus() {
    var core = WG.core;
    return core && core.Bus ? core.Bus : null;
  }

  function emit(type, payload) {
    var b = bus();
    if (b && typeof b.emit === 'function') b.emit(type, payload);
  }

  /* 拾取统计（按 kind 累计数值，用于 loot:picked.total） */
  var counters = { picked: 0, xp: 0, silver: 0, potion: 0 };

  /* ------------------------------------------------------------------ *
   * 掉落
   * ------------------------------------------------------------------ */
  function dropAt(x, y, kind, amount) {
    var spec = DROP[kind];
    if (!spec) return null;

    var px = Number(x);
    var py = Number(y);
    if (!isFinite(px) || !isFinite(py)) return null;

    var o = acquire();
    o.kind = kind;
    o.x = px;
    o.y = py;
    o.px = px;
    o.py = py;
    o.radius = spec.radius || 5;

    if (kind === 'xp') {
      var xp = Number(amount);
      o.amount = isFinite(xp) && xp > 0 ? xp : spec.amount;
    } else if (kind === 'silver') {
      var silver = Number(amount);
      o.amount = isFinite(silver) && silver > 0
        ? Math.floor(silver)
        : randInt(spec.min, spec.max);
    } else if (kind === 'potion') {
      o.amount = spec.heal || 25;
      o.heal = o.amount;
    }

    if (active.length >= CAP) {
      var oldest = active.shift();
      recycle(oldest);
    }
    active.push(o);

    emit('loot:drop', { x: o.x, y: o.y, kind: o.kind });
    return o;
  }

  function isElite(payload) {
    if (payload.elite === true) return true;
    if (payload.type && DROP.eliteTypes.indexOf(payload.type) >= 0) return true;
    var xp = Number(payload.xp);
    return isFinite(xp) && xp >= 40;
  }

  function xpAmountFor(payload, elite) {
    var xp = Number(payload.xp);
    if (isFinite(xp) && xp > 0) return xp;
    if (payload.type) {
      var byType = DROP.xpByType[payload.type];
      if (typeof byType === 'number' && byType > 0) return byType;
    }
    return elite ? DROP.xp.eliteAmount : DROP.xp.amount;
  }

  function onMonsterKilled(payload) {
    if (!payload) return;
    var x = Number(payload.x);
    var y = Number(payload.y);
    if (!isFinite(x) || !isFinite(y)) return;

    var elite = isElite(payload);

    /* 必掉经验珠 */
    dropAt(x, y, 'xp', xpAmountFor(payload, elite));

    /* 银两：普通 35%，精英 100% */
    var silverChance = elite ? DROP.silver.eliteChance : DROP.silver.chance;
    if (random() < silverChance) {
      dropAt(x, y, 'silver');
    }

    /* 疗伤丹：普通 8%，精英 30%；potionDropMult（只读）按倍率提升，默认 1 */
    var potionChance = elite ? DROP.potion.eliteChance : DROP.potion.chance;
    var mult = statNumber(WG.combat && WG.combat.player, 'potionDropMult', 1);
    if (mult >= 0 && mult !== 1) potionChance *= mult;
    if (potionChance < 0) potionChance = 0;
    else if (potionChance > 1) potionChance = 1;
    /* 始终消耗一次随机数，保证同 seed 的随机序列稳定 */
    var potionRoll = random();
    if (potionRoll < potionChance) {
      dropAt(x, y, 'potion');
    }
  }

  /* ------------------------------------------------------------------ *
   * 拾取结算
   * ------------------------------------------------------------------ */
  function applyPotion(amount, player) {
    if (!amount || amount <= 0) return;
    var p = player || (WG.combat && WG.combat.player);
    if (!p) return;

    /* HP 归 combat 所有：只调用其公开 heal（若提供），不直接改写 hp。 */
    if (typeof p.heal === 'function') {
      p.heal(amount);
      return;
    }
    var Player = WG.combat && WG.combat.Player;
    if (Player && Player.prototype && typeof Player.prototype.heal === 'function') {
      Player.prototype.heal.call(p, amount);
    }
  }

  /* 疗伤丹拾取回复量 = 基础值 + 只读 potionHealBonus（默认 0，不写回） */
  function potionHealAmount(base, player) {
    var heal = Number(base);
    if (!isFinite(heal) || heal < 0) heal = DROP.potion.heal || 25;
    var bonus = statNumber(player, 'potionHealBonus', 0);
    var total = heal + bonus;
    return total > 0 ? total : 0;
  }

  function collect(o, player) {
    counters.picked += 1;

    var amount = o.kind === 'potion'
      ? potionHealAmount(o.amount, player)
      : o.amount;

    var total;
    if (o.kind === 'xp') {
      counters.xp += amount;
      total = counters.xp;
    } else if (o.kind === 'silver') {
      counters.silver += amount;
      total = counters.silver;
    } else {
      counters.potion += amount;
      total = counters.potion;
    }

    emit('loot:picked', { kind: o.kind, amount: amount, total: total });

    if (o.kind === 'xp') {
      var P = loot.Progression;
      if (P && typeof P.addXp === 'function') P.addXp(amount, player);
    } else if (o.kind === 'potion') {
      applyPotion(amount, player);
    }
  }

  /* ------------------------------------------------------------------ *
   * 每帧更新：弹出延迟 → 拾取半径 → 磁吸
   * ------------------------------------------------------------------ */
  function statNumber(player, key, fallback) {
    var stats = player && player.stats;
    var v = stats && stats[key];
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }

  function update(dt, player) {
    if (!bound) bindBus();

    var step = Number(dt);
    if (!isFinite(step) || step <= 0) return;

    var p = player || (WG.combat && WG.combat.player) || null;

    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return;

    var pickupR = statNumber(p, 'pickupRadius', PICKUP.pickupRadius);
    var magnetR = statNumber(p, 'magnetRadius', PICKUP.magnetRadius);

    for (var i = active.length - 1; i >= 0; i--) {
      var o = active[i];
      /* 记录本步起始位置，供 render 以 alpha 插值（不新建对象） */
      o.px = o.x;
      o.py = o.y;
      o.age += step;

      /* 落地弹出动画期间不可拾取 */
      if (o.age < PICKUP.popDelay) continue;

      var dx = p.x - o.x;
      var dy = p.y - o.y;
      var dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= pickupR) {
        collect(o, p);
        active.splice(i, 1);
        recycle(o);
        continue;
      }

      if (!o.magnet && dist > magnetR) continue;

      /* 磁吸：以 260 px/s 飞向玩家 */
      o.magnet = true;
      var move = PICKUP.magnetSpeed * step;
      if (dist <= move) {
        o.x = p.x;
        o.y = p.y;
        dist = 0;
      } else {
        o.x += (dx / dist) * move;
        o.y += (dy / dist) * move;
        dist -= move;
      }

      if (dist <= pickupR) {
        collect(o, p);
        active.splice(i, 1);
        recycle(o);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 重开复位（main startRun → resetOptionalSystems 调用）
   * 清空掉落池/拾取计数/弹出与磁吸状态，按 world.seed 重置掉落 RNG，
   * 并调用 Progression.reset(world) 复位成长；不改事件契约。
   * ------------------------------------------------------------------ */
  function reset(world) {
    active.length = 0;
    free.length = 0;
    counters.picked = 0;
    counters.xp = 0;
    counters.silver = 0;
    counters.potion = 0;
    resetRng(world);

    var P = loot.Progression;
    if (P && typeof P.reset === 'function') P.reset(world);

    return true;
  }

  /* ------------------------------------------------------------------ *
   * 渲染（main 已施加相机变换；此处只画世界坐标）
   * 造型区分：经验珠=青蓝圆珠，银两=金色菱形，疗伤丹=绿色药瓶。
   * ------------------------------------------------------------------ */
  function easeOut(t) {
    var inv = 1 - t;
    return 1 - inv * inv;
  }

  function drawXp(ctx, x, y, scale, radius, age) {
    var pulse = 1 + 0.08 * Math.sin(age * 9);
    var r = radius * scale * pulse;
    var color = DROP.xp.color;

    /* 外层微光 */
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.1, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* 珠体 + 描边 + 高光 */
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = OUTLINE_ORB;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = HIGHLIGHT;
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y - r * 0.32, Math.max(0.7, r * 0.34), 0, TAU);
    ctx.fill();
  }

  function drawSilver(ctx, x, y, scale, radius) {
    var r = radius * scale * 1.15;

    /* 金色菱形 */
    ctx.fillStyle = DROP.silver.color;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.78, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r * 0.78, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = OUTLINE_GOLD;
    ctx.lineWidth = 1;
    ctx.stroke();

    /* 内部高光面 */
    ctx.fillStyle = '#fff6cf';
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.52);
    ctx.lineTo(x + r * 0.32, y);
    ctx.lineTo(x, y - r * 0.06);
    ctx.lineTo(x - r * 0.32, y);
    ctx.closePath();
    ctx.fill();
  }

  function drawPotion(ctx, x, y, scale, radius) {
    var r = radius * scale;
    var bodyY = y + r * 0.35;

    /* 瓶身 */
    ctx.fillStyle = DROP.potion.color;
    ctx.beginPath();
    ctx.arc(x, bodyY, r * 0.85, 0, TAU);
    ctx.fill();

    /* 瓶颈 */
    ctx.fillRect(x - r * 0.26, y - r * 0.95, r * 0.52, r * 1.05);

    /* 瓶塞 */
    ctx.fillStyle = CORK;
    ctx.fillRect(x - r * 0.38, y - r * 1.18, r * 0.76, r * 0.3);

    /* 瓶身描边 + 高光 */
    ctx.strokeStyle = OUTLINE_POTION;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, bodyY, r * 0.85, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = HIGHLIGHT;
    ctx.beginPath();
    ctx.arc(x - r * 0.28, bodyY - r * 0.12, Math.max(0.6, r * 0.22), 0, TAU);
    ctx.fill();
  }

  /* 调用共享加载器；返回 true 表示已绘制，false/异常时由调用方回退几何。
   * 不在此实现加载逻辑，也不新建临时对象（ASSET_OPTS 模块级复用）。 */
  function drawDropAsset(ctx, kind, x, y, scale, radius) {
    var fx = WG.fx;
    var assets = fx && fx.assets;
    if (!assets || typeof assets.draw !== 'function') return false;

    var id = ASSET_IDS[kind];
    if (!id) return false;

    var size = (radius || 5) * ASSET_SIZE_MUL * scale;
    try {
      return assets.draw(ctx, id, x, y, size, size, ASSET_OPTS) === true;
    } catch (err) {
      return false;
    }
  }

  function render(ctx, alpha) {
    if (!ctx || active.length === 0) return;

    var a = Number(alpha);
    if (!isFinite(a)) a = 1;
    if (a < 0) a = 0;
    else if (a > 1) a = 1;

    /* 相机视口（公开只读字段）用于离屏剔除 */
    var cam = WG.core && WG.core.Camera;
    var x0 = -Infinity, x1 = Infinity, y0 = -Infinity, y1 = Infinity;
    if (cam && cam.w > 0 && cam.h > 0) {
      x0 = cam.x - CULL_MARGIN;
      x1 = cam.x + cam.w + CULL_MARGIN;
      y0 = cam.y - CULL_MARGIN;
      y1 = cam.y + cam.h + CULL_MARGIN;
    }

    ctx.save();

    for (var i = 0; i < active.length; i++) {
      var o = active[i];

      /* 用上一步与当前步位置做 alpha 插值（磁吸飞行平滑） */
      var ox = typeof o.px === 'number' ? o.px : o.x;
      var oy = typeof o.py === 'number' ? o.py : o.y;
      var x = ox + (o.x - ox) * a;
      var y = oy + (o.y - oy) * a;

      /* 0.25s 弹出：小→大、由下浮回 */
      var t = o.age >= PICKUP.popDelay ? 1 : o.age / PICKUP.popDelay;
      if (t < 0) t = 0;
      var scale = 0.25 + 0.75 * easeOut(t);
      var cy = y - (1 - t) * 9;

      if (x < x0 || x > x1 || cy < y0 || cy > y1) continue;

      /* 磁吸提示：脉冲光环（拾取瞬间的表现由 fx 订阅 loot:picked 负责） */
      if (o.magnet) {
        var spec = DROP[o.kind];
        ctx.globalAlpha = 0.28 + 0.1 * Math.sin(o.age * 12);
        ctx.strokeStyle = spec ? spec.color : HIGHLIGHT;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, cy, (o.radius || 5) * 1.9 * scale, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      /* 优先贴图（drop-xp/drop-silver/drop-potion），尺寸随弹出缩放；
       * 加载器不可用/未就绪/缺图时返回 false，回退原有几何绘制。 */
      if (!drawDropAsset(ctx, o.kind, x, cy, scale, o.radius)) {
        if (o.kind === 'xp') {
          drawXp(ctx, x, cy, scale, o.radius, o.age);
        } else if (o.kind === 'silver') {
          drawSilver(ctx, x, cy, scale, o.radius);
        } else if (o.kind === 'potion') {
          drawPotion(ctx, x, cy, scale, o.radius);
        }
      }
    }

    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   * 事件绑定（core/bus.js 先于本文件加载；update 中兜底重试）
   * ------------------------------------------------------------------ */
  function bindBus() {
    var b = bus();
    if (!b || typeof b.on !== 'function') return false;
    b.on('monster:killed', onMonsterKilled);
    bound = true;
    return true;
  }

  bindBus();

  /* ------------------------------------------------------------------ *
   * 公开契约
   * ------------------------------------------------------------------ */
  loot.LootSystem = {
    dropAt: dropAt,
    update: update,
    render: render,
    reset: reset,
    pool: pool,
    count: function () { return active.length; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
