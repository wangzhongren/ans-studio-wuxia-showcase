/*!
 * 江湖夜雨 · tests/smoke-core.js
 * core-runtime 自测（Node 无头）：验证 9 个核心脚本的公开契约与关键实现语义。
 * 运行：node tests/smoke-core.js
 * 说明：仅覆盖纯逻辑（不执行 DOM 渲染）；语法检查另用 node --check。
 */
'use strict';

/* ---------- 迷你断言 ---------- */
var passed = 0;
var failed = [];

function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed.push(msg);
    console.error('FAIL: ' + msg);
  }
}

function eq(actual, expected, msg) {
  ok(actual === expected, msg + ' (expected ' + expected + ', got ' + actual + ')');
}

/* ---------- 模拟 window 键盘通道（Input 在加载时绑定） ---------- */
var fakeListeners = {};
try {
  globalThis.addEventListener = function (type, fn) {
    (fakeListeners[type] || (fakeListeners[type] = [])).push(fn);
  };
  globalThis.removeEventListener = function () {};
} catch (e) {
  console.error('WARN: cannot stub addEventListener, key simulation skipped');
}

function fire(type, ev) {
  var list = fakeListeners[type] || [];
  for (var i = 0; i < list.length; i++) list[i](ev);
}

/* ---------- 按 architecture §3.2 顺序加载 ---------- */
require('../src/core/config.js');
require('../src/core/rng.js');
require('../src/core/pool.js');
require('../src/core/spatial-hash.js');
require('../src/core/input.js');
require('../src/core/camera.js');
require('../src/core/bus.js');
require('../src/core/loop.js');
require('../src/core/main.js');

var WG = globalThis.WG;
var core = WG.core;

/* ---------- CONFIG ---------- */
ok(!!core.CONFIG, 'CONFIG exists');
eq(core.CONFIG.world.width, 3840, 'CONFIG.world.width');
eq(core.CONFIG.world.height, 2160, 'CONFIG.world.height');
eq(core.CONFIG.sim.dt, 1 / 60, 'CONFIG.sim.dt');
eq(core.CONFIG.sim.maxSteps, 3, 'CONFIG.sim.maxSteps');
eq(core.CONFIG.spatialHash.cellSize, 128, 'CONFIG.spatialHash.cellSize');
eq(core.CONFIG.player.maxHp, 100, 'CONFIG.player.maxHp');
eq(core.CONFIG.player.speed, 220, 'CONFIG.player.speed');
eq(core.CONFIG.monsters.cap, 300, 'CONFIG.monsters.cap');
eq(core.CONFIG.monsters.types.youxia.hp, 30, 'CONFIG.monsters.types.youxia.hp');
eq(core.CONFIG.abilities.whirl.unlockLevel, 3, 'CONFIG.abilities.whirl.unlockLevel');
eq(core.CONFIG.abilities.swordRain.damage, 60, 'CONFIG.abilities.swordRain.damage');
eq(core.CONFIG.run.duration, 480, 'CONFIG.run.duration');

/* ---------- Rng ---------- */
var r1 = core.Rng(7);
var r2 = core.Rng(7);
var same = true;
for (var i = 0; i < 20; i++) {
  if (r1.next() !== r2.next()) same = false;
}
ok(same, 'Rng(seed) deterministic sequence');
var r = core.Rng(123);
var boundsOk = true;
for (var j = 0; j < 2000; j++) {
  var v = r.next();
  if (v < 0 || v >= 1) boundsOk = false;
  var q = r.range(-5, 5);
  if (q < -5 || q > 5) boundsOk = false;
  var n = r.int(2, 6);
  if (n < 2 || n > 6 || n !== Math.floor(n)) boundsOk = false;
}
ok(boundsOk, 'Rng next/range/int bounds');
eq(r.pick(['a', 'b', 'c']).length, 1, 'Rng pick returns element');
eq(r.pick([]), undefined, 'Rng pick empty array');

/* ---------- Pool ---------- */
var made = 0;
var resets = 0;
var pool = core.Pool(3, function () { return { id: made++, v: 9 }; }, function (o) { o.v = 0; resets++; });
eq(made, 3, 'Pool preallocates cap objects');
var a = pool.spawn();
var b = pool.spawn();
var c = pool.spawn();
eq(pool.count, 3, 'Pool count after 3 spawns');
eq(a.id, 0, 'Pool spawn first');
ok(a !== b && b !== c, 'Pool spawn distinct slots');
var seen = 0;
pool.forEach(function () { seen++; });
eq(seen, 3, 'Pool forEach visits active');
var d = pool.spawn();
eq(d, a, 'Pool recycles oldest slot when full');
eq(pool.count, 3, 'Pool count stable at cap');
eq(resets, 1, 'Pool reset called on recycle only');
pool.releaseAll();
eq(pool.count, 0, 'Pool releaseAll resets count');
eq(resets, 4, 'Pool releaseAll resets all used');

/* ---------- SpatialHash ---------- */
var hash = core.SpatialHash(128);
var e1 = { x: 10, y: 10 };
var e2 = { x: 130, y: 10 };
var e3 = { x: 1000, y: 1000 };
hash.insert(e1);
hash.insert(e2);
hash.insert(e3);
var out = [];
var got = hash.queryCircle(20, 20, 40, out);
ok(got === out, 'SpatialHash queryCircle reuses out');
eq(out.length, 1, 'SpatialHash queryCircle radius filter');
eq(out[0], e1, 'SpatialHash returns inserted entity');
hash.clear();
eq(hash.queryCircle(0, 0, 5000, out).length, 0, 'SpatialHash clear empties buckets');
hash.insert({ x: -129, y: -129 });
eq(hash.queryCircle(-129, -129, 1, out).length, 1, 'SpatialHash negative cell coords');

/* ---------- Bus ---------- */
var bus = core.Bus;
var hits = 0;
var payloadSeen = null;
function h1(p) { hits++; payloadSeen = p; }
function h2() { hits++; }
bus.on('t', h1);
bus.on('t', h2);
eq(bus.emit('t', { a: 1 }), 2, 'Bus emit calls all handlers');
eq(hits, 2, 'Bus handlers invoked');
eq(payloadSeen.a, 1, 'Bus payload delivered');
bus.off('t', h1);
eq(bus.emit('t', { a: 2 }), 1, 'Bus off removes handler');
var selfOff = 0;
function h3() { selfOff++; bus.off('t', h3); }
bus.on('t', h3);
eq(bus.emit('t', {}), 2, 'Bus emit with self-off handler');
eq(selfOff, 1, 'Bus self-off during emit works');
eq(bus.emit('none', {}), 0, 'Bus emit unknown type');

/* ---------- Input ---------- */
var Input = core.Input;
eq(Input.axis().x, 0, 'Input axis idle x');
eq(Input.axis().y, 0, 'Input axis idle y');
ok(typeof Input._endFrame === 'function');
if (fakeListeners.keydown && fakeListeners.keydown.length) {
  fire('keydown', { code: 'KeyD', preventDefault: function () {} });
  eq(Input.axis().x, 1, 'Input axis right');
  ok(Input.keyPressed('KeyD'), 'Input keyPressed edge true on first press');
  fire('keydown', { code: 'ShiftLeft', preventDefault: function () {} });
  ok(Input.dashPressed(), 'Input dashPressed on Shift');
  fire('keydown', { code: 'F3', preventDefault: function () {} });
  ok(Input.keyPressed('F3'), 'Input keyPressed F3 edge');
  Input._endFrame();
  ok(!Input.keyPressed('F3'), 'Input edge cleared after _endFrame');
  ok(!Input.dashPressed(), 'Input dash edge cleared after _endFrame');
  eq(Input.axis().x, 1, 'Input axis still held after edge clear');
  fire('keyup', { code: 'KeyD' });
  eq(Input.axis().x, 0, 'Input axis clears on keyup');
} else {
  console.error('WARN: key simulation unavailable in this runtime');
}

/* ---------- Camera ---------- */
var cam = core.Camera;
ok(typeof cam.update === 'function' && typeof cam.apply === 'function' && typeof cam.shake === 'function');
var fakeWorld = { width: 3840, height: 2160 };
cam.update({ x: 3000, y: 1800 }, 1 / 60, fakeWorld);
ok(cam.x > 0 && cam.x <= 3840 - cam.w, 'Camera x clamped within world');
ok(cam.y > 0 && cam.y <= 2160 - cam.h, 'Camera y clamped within world');
for (var k = 0; k < 300; k++) cam.update({ x: 0, y: 0 }, 1 / 60, fakeWorld);
eq(cam.x, 0, 'Camera clamp left');
eq(cam.y, 0, 'Camera clamp top');
cam.shake(6, 0.25);
ok(cam._left > 0, 'Camera shake armed');
cam.update({ x: 0, y: 0 }, 1 / 60, fakeWorld);
ok(cam.shakeX !== 0 || cam.shakeY !== 0, 'Camera shake offsets applied');

/* ---------- Loop ---------- */
var Loop = core.Loop;
ok(typeof Loop.start === 'function' && typeof Loop.stop === 'function');
ok(Loop.frameStats && typeof Loop.frameStats.fps === 'number');
eq(typeof Loop.simTime, 'number', 'Loop simTime is number');

/* ---------- main / boot（无 DOM：仅装配与状态机） ---------- */
var world = core.boot({ seed: 7, timescale: 2 });
ok(!!world, 'boot returns world');
eq(world.seed, 7, 'boot seed from options');
eq(world.timescale, 2, 'boot timescale from options');
eq(Loop.timeScale, 2, 'Loop timeScale synced');
eq(world.state, 'title', 'boot starts in title state');
eq(world.width, 3840, 'world width from CONFIG');
eq(world.height, 2160, 'world height from CONFIG');
ok(world.hash && typeof world.hash.queryCircle === 'function', 'world hash wired');
ok(world.bus === core.Bus, 'world bus wired');
ok(world.rng && typeof world.rng.next === 'function', 'world rng wired');

bus.emit('ui:start', null);
eq(world.state, 'playing', 'ui:start begins run');
bus.emit('monster:killed', { id: 1 });
eq(world.kills, 1, 'monster:killed counted by main');
bus.emit('loot:picked', { kind: 'coin', amount: 3 });
eq(world.picked, 1, 'loot:picked counted');
eq(world.coins, 3, 'coin amount recorded');
bus.emit('player:dead', { runTime: 12 });
eq(world.state, 'over', 'player:dead ends run');
eq(world.outcome, 'dead', 'outcome dead');

Loop.stop();

/* ---------- 汇总 ---------- */
console.log('smoke-core: ' + passed + ' passed, ' + failed.length + ' failed');
if (failed.length) {
  process.exit(1);
}
