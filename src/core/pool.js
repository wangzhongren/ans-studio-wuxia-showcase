/*!
 * 江湖夜雨 · core-runtime · pool.js
 * 契约：WG.core.Pool(cap, factory, reset) → { spawn(), forEach(fn), count, releaseAll() }
 * 实现：启动时一次性预分配 cap 个对象；spawn 环形复用最旧槽位；
 *       稳态不产生新对象（proposal §5.9「对象池」/「稳态无逐帧新对象分配」）。
 * 复位时机：首次使用不调用 reset（factory 已是干净对象）；复用旧槽位或 releaseAll 时调用 reset。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var core = WG.core = WG.core || {};

  /**
   * @param {number} cap 容量（>0）
   * @param {function():Object} factory 预分配工厂
   * @param {function(Object):void} [reset] 复用前复位
   */
  function Pool(cap, factory, reset) {
    var size = Math.max(1, cap | 0);
    var items = new Array(size);
    var active = new Uint8Array(size);
    var used = new Uint8Array(size);
    var head = 0;
    var activeCount = 0;
    var doReset = typeof reset === 'function' ? reset : null;

    for (var i = 0; i < size; i++) {
      items[i] = factory();
    }

    function spawn() {
      var idx = head;
      head = (head + 1) % size;
      var obj = items[idx];

      if (active[idx]) {
        // 槽位仍在用 → 复用最旧（环形），不改变 activeCount
        if (doReset) doReset(obj);
      } else {
        if (used[idx] && doReset) doReset(obj);
        active[idx] = 1;
        activeCount++;
      }
      used[idx] = 1;
      return obj;
    }

    function forEach(fn) {
      for (var i = 0; i < size; i++) {
        if (active[i]) fn(items[i], i);
      }
    }

    function releaseAll() {
      for (var i = 0; i < size; i++) {
        if (active[i] && doReset) doReset(items[i]);
        active[i] = 0;
        used[i] = 0;
      }
      activeCount = 0;
      head = 0;
    }

    return {
      spawn: spawn,
      forEach: forEach,
      get count() { return activeCount; },
      releaseAll: releaseAll
    };
  }

  core.Pool = Pool;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
