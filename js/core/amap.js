/** 高德 JS API 加载器：真实/测试Mock 两种模式，结果缓存 */

import { state } from './state.js';
import { normPos } from './utils.js';

let cached = null; // {mode, AMap}

export function isMockWanted(forceMock = false) {
  if (forceMock) return true;
  const params = new URLSearchParams(location.search);
  return params.has('mockamap') || params.has('test');
}

/**
 * loadAMap({forceMock}) -> Promise<AMap命名空间>
 * 失败抛错：NO_KEY（未配置Key）/ AMAP_LOAD_FAIL（脚本加载失败）
 */
export async function loadAMap({ forceMock = false } = {}) {
  const mock = isMockWanted(forceMock);
  if (cached && cached.mode === (mock ? 'mock' : 'real')) return cached.AMap;
  if (mock) {
    const m = await import('./amap-mock.js');
    cached = { mode: 'mock', AMap: m.installMock() };
    return cached.AMap;
  }
  const { amapKey, securityCode } = state.settings;
  if (!amapKey) throw new Error('NO_KEY');
  window._AMapSecurityConfig = { securityJsCode: securityCode || '' };
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(amapKey)}` +
      `&plugin=AMap.AutoComplete,AMap.PlaceSearch,AMap.Driving,AMap.Geolocation,AMap.Geocoder,AMap.CitySearch`;
    s.onload = resolve;
    s.onerror = () => reject(new Error('AMAP_LOAD_FAIL'));
    document.head.appendChild(s);
  });
  if (!window.AMap) throw new Error('AMAP_LOAD_FAIL');
  cached = { mode: 'real', AMap: window.AMap };
  return cached.AMap;
}

/** 测试辅助：清除缓存 */
export function resetAmapCache() { cached = null; }

/** 地图默认定位到当前位置（高精度GPS优先，HTTP或无权限时自动降级到IP城市定位与用户收藏位置）。
 *  waitMs>0 时最多等待该毫秒数（供"先定位、画线后fitView"的时序用） */
export async function centerOnCurrentLocation(map, zoom = 12, waitMs = 0) {
  if (!map) return;
  try {
    const AMap = await loadAMap();
    await new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const timer = waitMs > 0 ? setTimeout(finish, waitMs) : null;

      // 降级策略 1：使用 AMap.CitySearch 进行 IP 城市级别定位（不受非 HTTPS 限制）
      const fallbackToIp = () => {
        try {
          if (AMap.CitySearch) {
            const cs = new AMap.CitySearch();
            cs.getLocalCity((status, result) => {
              if (status === 'complete' && result?.info === 'OK') {
                if (result.bounds && typeof result.bounds.getCenter === 'function') {
                  const c = result.bounds.getCenter();
                  map.setZoomAndCenter(zoom, [c.getLng(), c.getLat()]);
                  if (timer) clearTimeout(timer);
                  finish();
                  return;
                } else if (result.rectangle) {
                  const parts = String(result.rectangle).split(';').map(p => p.split(',').map(Number));
                  if (parts.length === 2 && !isNaN(parts[0][0]) && !isNaN(parts[1][0])) {
                    const center = [(parts[0][0] + parts[1][0]) / 2, (parts[0][1] + parts[1][1]) / 2];
                    map.setZoomAndCenter(zoom, center);
                    if (timer) clearTimeout(timer);
                    finish();
                    return;
                  }
                }
                if (result.city && typeof map.setCity === 'function') {
                  map.setCity(result.city);
                  if (timer) clearTimeout(timer);
                  finish();
                  return;
                }
              }
              fallbackToSavedLocation();
            });
            return;
          }
        } catch { /* 忽略 */ }
        fallbackToSavedLocation();
      };

      // 降级策略 2：若完全离线或无 IP 信息，使用用户已有收藏地点或路书中的位置
      const fallbackToSavedLocation = () => {
        try {
          const lastItem = state.library?.items?.slice(-1)[0];
          if (lastItem?.location) {
            const pos = normPos(lastItem.location);
            if (pos && typeof map.setZoomAndCenter === 'function') {
              map.setZoomAndCenter(zoom, pos);
            }
          }
        } catch { /* 忽略 */ }
        if (timer) clearTimeout(timer);
        finish();
      };

      try {
        const geo = new AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 4000,
          getCityWhenFail: true,
          needAddress: true,
        });

        geo.getCurrentPosition((status, result) => {
          const pos = result?.position && normPos(result.position);
          if (status === 'complete' && pos) {
            map.setZoomAndCenter(zoom, pos);
            if (timer) clearTimeout(timer);
            finish();
          } else if (result?.city || result?.province) {
            if (result.bounds && typeof result.bounds.getCenter === 'function') {
              const c = result.bounds.getCenter();
              map.setZoomAndCenter(zoom, [c.getLng(), c.getLat()]);
            } else if (typeof map.setCity === 'function') {
              map.setCity(result.city || result.province);
            }
            if (timer) clearTimeout(timer);
            finish();
          } else {
            fallbackToIp();
          }
        });
      } catch {
        fallbackToIp();
      }
    });
  } catch { /* 定位失败保持原中心 */ }
}
