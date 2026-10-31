/*!
 * 江湖夜雨 · core-runtime · rng.js
 * 契约：WG.core.Rng(seed) → { next(), range(a,b), int(a,b), pick(arr) }
 * 算法：mulberry32（proposal §5.9 确定性要求 / architecture §4.1）
 * 说明：不传 seed 时用当前时间；传入相同整数 seed 可复现同一随机序列（?seed=）。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var core = WG.core = WG.core || {};

  /** mulberry32 状态步进 → [0, 1) */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function next() {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * @param {number} [seed] 32 位整数种子；缺省取时间
   * @returns {{next:function():number, range:function(number,number):number,
   *            int:function(number,number):number, pick:function(Array):*}}
   */
  function Rng(seed) {
    var s = (seed === undefined || seed === null) ? (Date.now() >>> 0) : (seed >>> 0);
    var next = mulberry32(s);

    function range(a, b) {
      return a + (b - a) * next();
    }

    /** 闭区间随机整数 [a, b] */
    function int(a, b) {
      var lo = Math.ceil(a);
      var hi = Math.floor(b);
      if (hi < lo) return lo;
      return lo + Math.floor(next() * (hi - lo + 1));
    }

    function pick(arr) {
      if (!arr || arr.length === 0) return undefined;
      return arr[Math.floor(next() * arr.length)];
    }

    return {
      next: next,
      range: range,
      int: int,
      pick: pick
    };
  }

  core.Rng = Rng;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
