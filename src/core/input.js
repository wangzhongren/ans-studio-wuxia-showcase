/*!
 * 江湖夜雨 · core-runtime · input.js
 * 契约：WG.core.Input → { axis(): {x,y}, dashPressed(), keyPressed(code) }
 * 键位（proposal §5.1 / §6.1）：
 *   WASD / 方向键 = 八向移动（斜向归一化）
 *   Shift / 空格 = 闪身（边沿触发）
 *   F3 / F4 / F5 / Enter / R = 调试与流程键，上层通过 keyPressed(code) 读取
 * 语义：keyPressed 在本固定步内为 true（边沿），Loop 每个 update 后调用 _endFrame() 清边沿；
 *       axis() 返回复用的同一对象，调用方不得长期持有。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var core = WG.core = WG.core || {};

  var down = Object.create(null);
  var pressed = Object.create(null);
  var pressedThisFrame = [];
  var bound = false;

  // 复用的 axis 结果对象（避免逐帧分配）
  var axisObj = { x: 0, y: 0 };

  function isDown(code) {
    return down[code] === true;
  }

  function onKeyDown(e) {
    if (!e) return;
    var code = e.code || e.key;
    if (!code) return;

    if (!down[code]) {
      down[code] = true;
      pressed[code] = true;
      pressedThisFrame.push(code);
    }

    // 阻止方向键滚动页面 / 空格滚动 / 浏览器 F3 查找
    if (code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' ||
        code === 'ArrowRight' || code === 'Space' || code === 'F3' ||
        code === 'F4' || code === 'F5') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
    }
  }

  function onKeyUp(e) {
    if (!e) return;
    var code = e.code || e.key;
    if (!code) return;
    down[code] = false;
  }

  function onBlur() {
    for (var code in down) {
      if (down[code]) down[code] = false;
    }
    endFrame(); // 失焦时丢弃尚未消费的边沿，避免切窗后误触发
  }

  function bind() {
    if (bound) return;
    if (typeof root.addEventListener !== 'function') return; // 无头环境：Input 只读为 0/false
    bound = true;
    root.addEventListener('keydown', onKeyDown, false);
    root.addEventListener('keyup', onKeyUp, false);
    root.addEventListener('blur', onBlur, false);
  }

  function axis() {
    var x = 0;
    var y = 0;
    if (isDown('KeyD') || isDown('ArrowRight')) x += 1;
    if (isDown('KeyA') || isDown('ArrowLeft')) x -= 1;
    if (isDown('KeyS') || isDown('ArrowDown')) y += 1;
    if (isDown('KeyW') || isDown('ArrowUp')) y -= 1;

    if (x !== 0 && y !== 0) {
      var inv = 0.7071067811865476; // 1 / sqrt(2)
      x *= inv;
      y *= inv;
    }
    axisObj.x = x;
    axisObj.y = y;
    return axisObj;
  }

  function dashPressed() {
    return pressed.ShiftLeft === true || pressed.ShiftRight === true || pressed.Space === true;
  }

  function keyPressed(code) {
    return pressed[code] === true;
  }

  /** 内部：固定步边界清空边沿状态（由 Loop 每个 update 后调用；非公开契约） */
  function endFrame() {
    for (var i = 0; i < pressedThisFrame.length; i++) {
      pressed[pressedThisFrame[i]] = false;
    }
    pressedThisFrame.length = 0;
  }

  bind();

  core.Input = {
    axis: axis,
    dashPressed: dashPressed,
    keyPressed: keyPressed,
    _endFrame: endFrame
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
