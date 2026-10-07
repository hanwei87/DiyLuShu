/** 智能排序：直线距离 + 最近邻 + 2-opt（不耗高德配额，PRD 决策D2） */

import { haversine } from './utils.js';

const dist = (a, b) => (a && b ? haversine(a, b) : 0);

/** 路径总长：start→seq各点→end（start/end可为null） */
export function pathLength(seq, pts, start, end) {
  let L = 0;
  let prev = start;
  for (const i of seq) {
    if (prev) L += dist(prev, pts[i]);
    prev = pts[i];
  }
  if (end && prev) L += dist(prev, end);
  return L;
}

/** 2-opt局部改进：反转中间段直到无改善；order会被复制，不修改入参 */
export function twoOpt(order, pts, start, end, maxIter = 300) {
  let best = order.slice();
  let bestLen = pathLength(best, pts, start, end);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < maxIter) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        const len = pathLength(cand, pts, start, end);
        if (len < bestLen - 1e-6) {
          best = cand;
          bestLen = len;
          improved = true;
        }
      }
    }
  }
  return best;
}

/**
 * 优化中间点顺序（首尾锚点由调用方固定，不在此列）。
 * stops: [{id, location:[lng,lat]}]；start/end: [lng,lat] | null
 * 返回新的 id 顺序数组。
 */
export function optimizeOrder(stops, start = null, end = null) {
  const ids = stops.map(s => s.id);
  if (stops.length <= 2) return ids;
  const pts = stops.map(s => s.location);

  // 最近邻构造初始解
  const remaining = new Set(stops.map((_, i) => i));
  const order = [];
  let cur = start;
  while (remaining.size) {
    let bestI = null;
    let bestD = Infinity;
    for (const i of remaining) {
      const d = cur ? dist(cur, pts[i]) : 0;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    order.push(bestI);
    remaining.delete(bestI);
    cur = pts[bestI];
  }

  const improved = twoOpt(order, pts, start, end);
  return improved.map(i => ids[i]);
}
