/*!
 * 江湖夜雨 · core-runtime · bus.js
 * 契约：WG.core.Bus → { on(type,fn), off(type,fn), emit(type,payload) }
 * 唯一跨模块通信通道（architecture §5.2）。
 * 性能：emit 不复制监听器数组（稳态无分配）；off 采用置空+惰性压缩，
 *       发射过程中移除监听器不会打乱本次遍历。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var core = WG.core = WG.core || {};

  var handlers = Object.create(null);

  function compact(list) {
    var j = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] !== null) list[j++] = list[i];
    }
    list.length = j;
    list._holes = 0;
  }

  function on(type, fn) {
    if (typeof fn !== 'function') return;
    var list = handlers[type];
    if (list === undefined) {
      list = [];
      list._holes = 0;
      handlers[type] = list;
    }
    if (list._holes > 8 && list._holes * 2 >= list.length) compact(list);
    list.push(fn);
  }

  function off(type, fn) {
    var list = handlers[type];
    if (list === undefined) return;
    var holes = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === fn) {
        list[i] = null;
        holes++;
      }
    }
    if (holes === 0) return;
    list._holes = (list._holes || 0) + holes;
    if (list._holes > 8 && list._holes * 2 >= list.length) compact(list);
  }

  function emit(type, payload) {
    var list = handlers[type];
    if (list === undefined) return 0;
    var len = list.length; // 本次发射不接收发射期间新增的监听器
    var called = 0;
    for (var i = 0; i < len; i++) {
      var fn = list[i];
      if (fn === null) continue; // 发射期间被 off
      called++;
      fn(payload);
    }
    return called;
  }

  core.Bus = {
    on: on,
    off: off,
    emit: emit
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
