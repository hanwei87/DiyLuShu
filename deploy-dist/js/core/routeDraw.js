/** 路线绘制共享模块：链路坐标解析、分段驾车画线+距离用时、配色（规划页/生成页共用） */

import { findItem } from './state.js';
import { routeChain } from './plannerOps.js';
import { strToLoc, locToStr, normPos } from './utils.js';
import { loadAMap } from './amap.js';

const geoCache = new Map(); // 地名 -> [lng,lat]

export async function geocodeName(name) {
  if (!name) return null;
  if (geoCache.has(name)) return geoCache.get(name);
  try {
    const AMap = await loadAMap();
    let loc = null;
    await new Promise(resolve => {
      const ps = new AMap.PlaceSearch({});
      ps.search(name, (status, result) => {
        if (status === 'complete' && result.poiList?.pois?.length) loc = normPos(result.poiList.pois[0].location);
        resolve();
      });
    });
    if (loc) geoCache.set(name, loc);
    return loc;
  } catch { return null; }
}

/** 解析某天导航链的坐标序列（起点锚/条目/住宿/目的地；解析不到的点跳过） */
export async function resolveChainPoints(book, dayId) {
  const chain = routeChain(book, dayId);
  const pts = [];
  for (const entry of chain) {
    if (entry.type === 'origin') {
      let loc = book.origin?.location ? strToLoc(book.origin.location) : null;
      if (!loc) loc = await geocodeName(book.origin?.name);
      if (loc) {
        if (book.origin && !book.origin.location) book.origin.location = locToStr(loc);
        pts.push(loc);
      }
    } else if (entry.type === 'dest') {
      let loc = book.destination?.location ? strToLoc(book.destination.location) : null;
      if (!loc) loc = await geocodeName(book.destination?.name);
      if (loc) {
        if (book.destination && !book.destination.location) book.destination.location = locToStr(loc);
        pts.push(loc);
      }
    } else {
      const it = findItem(entry.id);
      const loc = it && strToLoc(it.location);
      if (loc) pts.push(loc);
    }
  }
  return pts;
}

/**
 * 相邻点之间用高德驾车路线画线并统计距离/用时。
 * pts 允许含 null（该段跳过，segments 对应位置为 null）。
 * policy: 0=速度优先(高速优先) 1=费用优先(不走高速)，与高德 DrivingPolicy 对应。
 * 防限流：同段结果缓存；真实API下请求间隔350ms；失败重试3次（递增退避）。
 * 返回 { lines, segments }：segments[i] 对应 pts[i]→pts[i+1]，含 {distance米, time秒}。
 */
const segCache = new Map(); // key -> {distance,time,path}
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function clearRouteCache() { segCache.clear(); }

export async function driveSegments(AMap, pts, { map = null, color = '#2f6fed', policy = 0 } = {}) {
  const isMock = Boolean(AMap && AMap.__POIS__);
  const lines = [];
  const segments = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (!a || !b) { segments.push(null); continue; }
    const key = `${policy}|${a[0].toFixed(5)},${a[1].toFixed(5)}>${b[0].toFixed(5)},${b[1].toFixed(5)}`;
    let seg = segCache.get(key) || null;
    if (!seg) {
      for (let attempt = 0; attempt < 3 && !seg; attempt++) {
        if (!isMock) await sleep(350); // 真实API请求间隔，避开个人Key QPS限制
        seg = await new Promise(resolve => {
          const driving = new AMap.Driving({ policy });
          driving.search(a, b, (status, result) => {
            if (status === 'complete' && result.routes?.[0]) {
              const route = result.routes[0];
              const path = route.steps
                .flatMap(s => (s.path || []).map(normPos))
                .filter(Boolean);
              resolve({ distance: route.distance || 0, time: route.time || 0, path });
            } else {
              resolve(null);
            }
          });
        });
        if (!seg && !isMock) await sleep(400 * (attempt + 1)); // 失败退避后重试
      }
      if (seg) {
        if (segCache.size > 800) segCache.clear();
        segCache.set(key, seg);
      }
    }
    if (seg && map && seg.path && seg.path.length >= 2) {
      lines.push(new AMap.Polyline({
        path: seg.path, strokeColor: color, strokeWeight: 5, strokeOpacity: .85, map, showDir: true,
      }));
    }
    segments.push(seg ? { distance: seg.distance, time: seg.time } : null);
  }
  return { lines, segments };
}

export const DAY_COLORS = ['#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00897B', '#D81B60', '#5E35B1'];
export function dayColor(i) { return DAY_COLORS[i % DAY_COLORS.length]; }
