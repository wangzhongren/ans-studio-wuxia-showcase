/*!
 * 江湖夜雨 · core-runtime · camera.js
 * 契约：WG.core.Camera → { update(target,dt,world), apply(ctx), shake(amp,dur) }
 * 行为（proposal §5.1）：
 *   - 跟随玩家，死区 120 px，平滑系数 8/s；
 *   - 相机钳制在世界边界内；世界小于视口时居中；
 *   - 震屏由 shake(amp,dur) 统一处理（确定性正弦衰减，不污染玩法 RNG）。
 * apply(ctx) 内部 save + translate；调用方负责最终 ctx.restore()。
 * 公开只读字段 x/y/w/h 供渲染层做视口剔除。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var core = WG.core = WG.core || {};
  var CONFIG = core.CONFIG;

  var cam = {
    x: 0,
    y: 0,
    w: CONFIG.viewport.width,
    h: CONFIG.viewport.height,
    shakeX: 0,
    shakeY: 0,
    // 内部震屏状态
    _amp: 0,
    _dur: 0,
    _left: 0,
    _phase: 0
  };

  function clampAxis(value, viewSize, worldSize) {
    if (worldSize <= viewSize) return (worldSize - viewSize) / 2;
    var max = worldSize - viewSize;
    if (value < 0) return 0;
    if (value > max) return max;
    return value;
  }

  function update(target, dt, world) {
    var step = (typeof dt === 'number' && dt > 0) ? dt : 0;
    var worldW = (world && typeof world.width === 'number') ? world.width : CONFIG.world.width;
    var worldH = (world && typeof world.height === 'number') ? world.height : CONFIG.world.height;

    if (target && typeof target.x === 'number' && typeof target.y === 'number') {
      var dz = CONFIG.camera.deadzone;
      var cx = cam.x + cam.w * 0.5;
      var cy = cam.y + cam.h * 0.5;

      var wantX, wantY;
      if (target.x > cx + dz) wantX = target.x - dz;
      else if (target.x < cx - dz) wantX = target.x + dz;
      else wantX = cx;

      if (target.y > cy + dz) wantY = target.y - dz;
      else if (target.y < cy - dz) wantY = target.y + dz;
      else wantY = cy;

      // 指数平滑（帧率无关）
      var k = 1 - Math.exp(-CONFIG.camera.smooth * step);
      cx += (wantX - cx) * k;
      cy += (wantY - cy) * k;

      cam.x = clampAxis(cx - cam.w * 0.5, cam.w, worldW);
      cam.y = clampAxis(cy - cam.h * 0.5, cam.h, worldH);
    } else {
      // 无目标时也让相机落在世界内
      cam.x = clampAxis(cam.x, cam.w, worldW);
      cam.y = clampAxis(cam.y, cam.h, worldH);
    }

    if (cam._left > 0) {
      cam._left -= step;
      if (cam._left < 0) cam._left = 0;
      cam._phase += step;
      var decay = cam._dur > 0 ? cam._left / cam._dur : 0; // 线性衰减
      var s = cam._amp * decay;
      cam.shakeX = Math.sin(cam._phase * 57.3) * s;
      cam.shakeY = Math.cos(cam._phase * 71.1) * s * 0.8;
    } else {
      cam.shakeX = 0;
      cam.shakeY = 0;
      cam._amp = 0; // 震动结束后允许下一次较弱的震动生效
    }
  }

  function apply(ctx) {
    if (!ctx) return;
    ctx.save();
    ctx.translate(
      -Math.round(cam.x + cam.shakeX),
      -Math.round(cam.y + cam.shakeY)
    );
  }

  function shake(amp, dur) {
    var a = (typeof amp === 'number' && isFinite(amp) && amp > 0) ? amp : 0;
    if (a <= 0) return;
    var d = (typeof dur === 'number' && isFinite(dur) && dur > 0) ? dur : CONFIG.camera.shakeDur;
    if (a > cam._amp) cam._amp = a;
    cam._dur = d;
    cam._left = d;
  }

  // 初始居中
  cam.x = clampAxis((CONFIG.world.width - cam.w) / 2, cam.w, CONFIG.world.width);
  cam.y = clampAxis((CONFIG.world.height - cam.h) / 2, cam.h, CONFIG.world.height);

  cam.update = update;
  cam.apply = apply;
  cam.shake = shake;

  core.Camera = cam;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
