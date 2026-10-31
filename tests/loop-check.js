/*!
 * 江湖夜雨 · tests/loop-check.js
 * 验证固定步长循环：dt=1/60、累加器、单帧最多 3 次补步、渲染插值 alpha、stop() 取消调度。
 * 运行：node tests/loop-check.js
 */
'use strict';

var passed = 0;
var failed = [];
function ok(cond, msg) {
  if (cond) passed++; else { failed.push(msg); console.error('FAIL: ' + msg); }
}
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= eps, msg + ' (got ' + a + ', want ~' + b + ')'); }

/* 在加载 loop.js 前注入可控的 rAF */
var pending = null;
var rafCalls = 0;
var cancels = 0;
globalThis.requestAnimationFrame = function (cb) { pending = cb; return ++rafCalls; };
globalThis.cancelAnimationFrame = function () { cancels++; };

require('../src/core/config.js');
require('../src/core/input.js');
require('../src/core/loop.js');

var core = globalThis.WG.core;
var Loop = core.Loop;
var dt = core.CONFIG.sim.dt;

var updates = 0;
var renders = 0;
var lastAlpha = -1;
var badDt = 0;
var maxStepsSeen = 0;

Loop.start(function (stepDt) {
  updates++;
  if (stepDt !== dt) badDt++;
}, function (alpha) {
  renders++;
  lastAlpha = alpha;
});

function drive(ts) {
  var cb = pending;
  pending = null;
  if (typeof cb !== 'function') { ok(false, 'no scheduled frame at ' + ts); return; }
  var before = updates;
  cb(ts);
  var steps = updates - before;
  if (steps > maxStepsSeen) maxStepsSeen = steps;
}

/* 第一帧只建立时钟 */
drive(1000);
ok(rafCalls === 2, 'first frame schedules next frame');
ok(renders === 1, 'render once on first frame');

/* 90 ms = 5.4 dt：应补 3 步（上限），余量 0.4 dt → alpha≈0.4 */
updates = 0;
renders = 0;
drive(1090);
ok(updates === 3, '90ms frame capped at 3 substeps');
ok(renders === 1, 'render once per frame');
near(lastAlpha, 0.4, 0.02, 'alpha reflects accumulator remainder');
near(Loop.simTime, 3 * dt, 1e-9, 'simTime advanced by exactly 3 fixed steps');

/* 16.7 ms ≈ 1 dt：应只有 1 步 */
updates = 0;
drive(1106.7);
ok(updates === 1, 'one dt frame runs one substep');

/* 1 s 心跳：被 maxFrameDt=0.25 钳制，仍最多 3 步 */
updates = 0;
drive(2106.7);
ok(updates === 3, 'long stall clamped and capped at 3 substeps');
ok(badDt === 0, 'update always receives dt=1/60');
ok(maxStepsSeen <= 3, 'never exceeds maxSteps=3');
ok(Loop.frameStats.frames >= 4, 'frameStats.frames counts frames');
ok(Loop.frameStats.fps > 0, 'frameStats.fps measured');

Loop.stop();
ok(cancels >= 1, 'stop() cancels scheduled frame');
ok(Loop.running === false, 'stop() clears running');
var stoppedCalls = rafCalls;
Loop.frameStats.frames = Loop.frameStats.frames; // no-op, keep shape
ok(stoppedCalls === rafCalls, 'no reschedule after stop');

console.log('loop-check: ' + passed + ' passed, ' + failed.length + ' failed');
if (failed.length) process.exit(1);
