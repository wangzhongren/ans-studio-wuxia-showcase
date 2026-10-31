/*!
 * 江湖夜雨 · core-runtime · loop.js
 * 契约：WG.core.Loop → { start(update,render), stop(), simTime, frameStats }
 * 固定步长（architecture v2 §4.1 / proposal v2 §5.1）：
 *   - dt = 1/60，累加器；单帧最多 3 次补步（防死亡螺旋）；
 *   - 超出补步上限的积压丢弃小数部分，保留 <1 dt 的余量；
 *   - 渲染每帧一次，传入插值 alpha = 累加余量 / dt；
 *   - pause()/resume()/paused：暂停期间不调用 update，render 继续；
 *     resume 重建时间基准并清零累加器，避免暂停后大 dt 突进。
 * frameStats（原地更新，不逐帧分配）：
 *   { fps, frameMs, simMs, renderMs, steps, p95Sim, p95Render, frames, alpha }
 * 调试加速：组合根通过 loop.timeScale 设置（1..8），只影响累加器输入，不改变 dt。
 * update 之后调用 Input._endFrame() 清空按键边沿（同模块内部协作）。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var core = WG.core = WG.core || {};
  var CONFIG = core.CONFIG;

  var hasPerformance = typeof performance !== 'undefined' && typeof performance.now === 'function';
  function now() {
    return hasPerformance ? performance.now() : Date.now();
  }

  var raf = (typeof root.requestAnimationFrame === 'function')
    ? function (cb) { return root.requestAnimationFrame(cb); }
    : function (cb) { return setTimeout(function () { cb(now()); }, 16); };

  var caf = (typeof root.cancelAnimationFrame === 'function')
    ? function (id) { root.cancelAnimationFrame(id); }
    : function (id) { clearTimeout(id); };

  var SAMPLE_CAP = 120;

  var loop = {
    running: false,
    paused: false,
    simTime: 0,
    timeScale: 1,
    frameStats: {
      fps: 0,
      frameMs: 0,
      simMs: 0,
      renderMs: 0,
      steps: 0,
      p95Sim: 0,
      p95Render: 0,
      frames: 0,
      alpha: 0
    }
  };

  var updateFn = null;
  var renderFn = null;
  var rafId = null;
  var lastTime = -1;
  var acc = 0;
  var errorCount = 0;

  var simRing = new Float32Array(SAMPLE_CAP);
  var renderRing = new Float32Array(SAMPLE_CAP);
  var scratch = new Float32Array(SAMPLE_CAP);
  var ringIndex = 0;
  var ringLen = 0;
  var statTick = 0;

  function computeP95() {
    var n = ringLen;
    if (n === 0) {
      loop.frameStats.p95Sim = 0;
      loop.frameStats.p95Render = 0;
      return;
    }
    var i;
    for (i = 0; i < n; i++) scratch[i] = simRing[i];
    for (i = n; i < SAMPLE_CAP; i++) scratch[i] = Infinity;
    scratch.sort();
    var idx = Math.floor((n - 1) * 0.95);
    loop.frameStats.p95Sim = scratch[idx];

    for (i = 0; i < n; i++) scratch[i] = renderRing[i];
    for (i = n; i < SAMPLE_CAP; i++) scratch[i] = Infinity;
    scratch.sort();
    loop.frameStats.p95Render = scratch[idx];
  }

  function record(simMs, renderMs) {
    simRing[ringIndex] = simMs;
    renderRing[ringIndex] = renderMs;
    ringIndex = (ringIndex + 1) % SAMPLE_CAP;
    if (ringLen < SAMPLE_CAP) ringLen++;
    statTick++;
    if (statTick % 15 === 0) computeP95();
  }

  function frame(ts) {
    if (!loop.running) return;

    var t = (typeof ts === 'number' && isFinite(ts)) ? ts : now();
    if (lastTime < 0) lastTime = t;

    var rawDt = (t - lastTime) / 1000;
    lastTime = t;
    if (!isFinite(rawDt) || rawDt < 0) rawDt = 0;
    if (rawDt > CONFIG.sim.maxFrameDt) rawDt = CONFIG.sim.maxFrameDt;

    var stats = loop.frameStats;
    var frameStart = now();

    // FPS：指数平滑，避免数字抖动
    if (rawDt > 0) {
      var instant = 1 / rawDt;
      stats.fps = stats.fps > 0 ? (stats.fps * 0.9 + instant * 0.1) : instant;
    }

    var dt = CONFIG.sim.dt;
    var maxSteps = CONFIG.sim.maxSteps;
    var steps = 0;
    var simMs = 0;

    if (loop.paused) {
      // 暂停：不推进模拟；仍清空按键边沿，避免覆盖层操作在恢复后误触发。
      acc = 0;
      if (core.Input && typeof core.Input._endFrame === 'function') {
        core.Input._endFrame();
      }
    } else {
      var scale = (typeof loop.timeScale === 'number' && loop.timeScale > 0) ? loop.timeScale : 1;
      acc += rawDt * scale;

      // update 中可能触发 pause()（如升级三选一），此时立即停止补步。
      while (acc >= dt && steps < maxSteps && !loop.paused) {
        var s0 = now();
        try {
          updateFn(dt);
        } catch (err) {
          if (errorCount < 5 && typeof console !== 'undefined' && console.error) {
            console.error('[WG.core.Loop] update error:', err);
          }
          errorCount++;
        }
        if (core.Input && typeof core.Input._endFrame === 'function') {
          core.Input._endFrame();
        }
        simMs += now() - s0;
        acc -= dt;
        loop.simTime += dt;
        steps++;
      }

      if (loop.paused) {
        // 暂停当帧丢弃余量；resume 也会清零，保证恢复后不突进。
        acc = 0;
      } else if (acc >= dt) {
        // 补步上限后的积压：丢弃整步，只保留 < 1 dt 的余量
        acc %= dt;
      }
    }

    var alpha = loop.paused ? 0 : (acc / dt);
    var renderMs = 0;
    if (renderFn) {
      var r0 = now();
      try {
        renderFn(alpha);
      } catch (err) {
        if (errorCount < 5 && typeof console !== 'undefined' && console.error) {
          console.error('[WG.core.Loop] render error:', err);
        }
        errorCount++;
      }
      renderMs = now() - r0;
    }

    stats.frameMs = now() - frameStart;
    stats.simMs = simMs;
    stats.renderMs = renderMs;
    stats.steps = steps;
    stats.frames++;
    stats.alpha = alpha;
    record(simMs, renderMs);

    rafId = raf(frame);
  }

  function start(update, render) {
    if (typeof update === 'function') updateFn = update;
    if (typeof render === 'function') renderFn = render;
    if (loop.running) return;
    if (typeof updateFn !== 'function') updateFn = function () {};
    loop.running = true;
    lastTime = -1;
    acc = 0;
    rafId = raf(frame);
  }

  function stop() {
    loop.running = false;
    if (rafId !== null) {
      caf(rafId);
      rafId = null;
    }
  }

  /**
   * 暂停模拟（render 继续）。暂停可能发生在 update 内：当前补步返回后
   * 循环会停止继续补步，并丢弃累加器余量。
   */
  function pause() {
    if (loop.paused) return loop.paused;
    loop.paused = true;
    acc = 0;
    return loop.paused;
  }

  /**
   * 恢复模拟：重建时间基准并清零累加器，确保暂停时长不会变成一次大 dt。
   */
  function resume() {
    if (!loop.paused) return loop.paused;
    loop.paused = false;
    acc = 0;
    lastTime = -1;
    return loop.paused;
  }

  loop.start = start;
  loop.stop = stop;
  loop.pause = pause;
  loop.resume = resume;

  core.Loop = loop;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
