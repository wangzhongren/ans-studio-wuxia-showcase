/*!
 * 江湖夜雨 · core-runtime · spatial-hash.js
 * 契约：WG.core.SpatialHash(cellSize) → { clear(), insert(e), queryCircle(x,y,r,out) }
 * 用途：怪物/掉落每帧重建（O(n)），索敌/碰撞只查包围盒覆盖的邻格（proposal §5.9）。
 * 性能：桶数组在 clear() 时仅 length=0 复用，不逐帧新建数组/对象；
 *       queryCircle 传入 out 数组时复用调用方数组（不分配），不传则新建并返回。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var core = WG.core = WG.core || {};

  var OFFSET = 32768; // 支持负网格坐标；世界内坐标远小于该量级
  var SPAN = 65536;

  function cellKey(cx, cy) {
    return (cx + OFFSET) * SPAN + (cy + OFFSET);
  }

  /** clear() 用的固定回调（避免每次 clear 创建闭包） */
  function truncate(arr) {
    arr.length = 0;
  }

  /**
   * @param {number} cellSize 网格边长（px），缺省 128
   */
  function SpatialHash(cellSize) {
    var size = (cellSize > 0 && isFinite(cellSize)) ? cellSize : 128;
    var buckets = new Map();

    function clear() {
      buckets.forEach(truncate);
    }

    function insert(e) {
      if (!e) return;
      var x = e.x;
      var y = e.y;
      if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return;
      var k = cellKey(Math.floor(x / size), Math.floor(y / size));
      var bucket = buckets.get(k);
      if (bucket === undefined) {
        bucket = [];
        buckets.set(k, bucket);
      }
      bucket.push(e);
    }

    /**
     * 查询圆心 (x,y)、半径 r 内的实体（按中心点距离判定；需要体半径时调用方自行加 r）。
     * @param {number} x
     * @param {number} y
     * @param {number} r
     * @param {Array=} out 复用的输出数组
     * @returns {Array}
     */
    function queryCircle(x, y, r, out) {
      var result = out || [];
      if (out) out.length = 0;
      if (r < 0) return result;

      var r2 = r * r;
      var minX = Math.floor((x - r) / size);
      var maxX = Math.floor((x + r) / size);
      var minY = Math.floor((y - r) / size);
      var maxY = Math.floor((y + r) / size);

      for (var cx = minX; cx <= maxX; cx++) {
        var base = (cx + OFFSET) * SPAN + OFFSET;
        for (var cy = minY; cy <= maxY; cy++) {
          var bucket = buckets.get(base + cy);
          if (bucket === undefined || bucket.length === 0) continue;
          for (var i = 0; i < bucket.length; i++) {
            var e = bucket[i];
            var dx = e.x - x;
            var dy = e.y - y;
            if (dx * dx + dy * dy <= r2) result.push(e);
          }
        }
      }
      return result;
    }

    return {
      clear: clear,
      insert: insert,
      queryCircle: queryCircle
    };
  }

  core.SpatialHash = SpatialHash;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
