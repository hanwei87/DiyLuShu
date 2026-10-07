/**
 * 高德 JS API 测试替身：接口形状与真实 API 对齐（回调签名、结果结构），
 * 内置成都若干POI。仅用于自动化测试，正式运行走真实 CDN。
 */

const POIS = [
  { id: 'B001SEM0X1', name: '宽窄巷子', address: '四川省成都市青羊区金河路口', district: '四川省成都市青羊区', location: [104.055, 30.663], type: '风景名胜;风景名胜;省级景点', tel: '' },
  { id: 'B001S0YYF2', name: '小名堂冒烤鸭(宽窄巷子店)', address: '四川省成都市青羊区宽巷子26号', district: '四川省成都市青羊区', location: [104.0535, 30.6645], type: '餐饮服务;中餐厅;特色/风味餐厅', tel: '028-12345678' },
  { id: 'B001S7Z890', name: '锦里古街', address: '四川省成都市武侯区武侯祠大街231号', district: '四川省成都市武侯区', location: [104.043, 30.644], type: '风景名胜;风景名胜', tel: '' },
  { id: 'B001SATT33', name: '亚朵酒店(成都天府广场店)', address: '四川省成都市青羊区人民中路二段', district: '四川省成都市青羊区', location: [104.065, 30.657], type: '住宿服务;宾馆酒店;高档型', tel: '028-88888888' },
  { id: 'B001SBUH55', name: '春熙路', address: '四川省成都市锦江区春熙路街道', district: '四川省成都市锦江区', location: [104.081, 30.657], type: '交通设施;道路;普通道路', tel: '' },
  { id: 'B001S11W66', name: '成都大熊猫繁育研究基地', address: '四川省成都市成华区外北熊猫大道1375号', district: '四川省成都市成华区', location: [104.147, 30.733], type: '风景名胜;风景名胜;旅游景点', tel: '028-83516748' },
  { id: 'B001S44X77', name: '马路边边麻辣烫(玉林店)', address: '四川省成都市武侯区玉林南路15号', district: '四川省成都市武侯区', location: [104.051, 30.612], type: '餐饮服务;中餐厅;火锅店', tel: '' },
  { id: 'B001S99901', name: '成都东站', address: '四川省成都市成华区邛崃山路', district: '四川省成都市成华区', location: [104.1391, 30.629], type: '交通设施;火车站;火车站', tel: '' },
];

import { haversine } from './utils.js';

function asPos(p) {
  if (!p) return null;
  if (Array.isArray(p)) return p;
  if (typeof p.getLng === 'function') return [p.getLng(), p.getLat()];
  return [Number(p.lng ?? p[0]), Number(p.lat ?? p[1])];
}

export function installMock() {
  if (window.__LUSHU_AMAP_MOCK__) return window.__LUSHU_AMAP_MOCK__;

  class MockMap {
    constructor(el, opts = {}) {
      this.container = typeof el === 'string' ? document.getElementById(el) : el;
      this.opts = opts;
      this.overlays = [];
      this.center = opts.center || null;
      this.zoom = opts.zoom || 12;
      MockMap.instances.push(this);
    }
    add(...ovs) { ovs.flat().forEach(o => { this.overlays.push(o); o._map = this; }); }
    remove(ovs) { (Array.isArray(ovs) ? ovs : [ovs]).forEach(o => { this.overlays = this.overlays.filter(x => x !== o); }); }
    clearMap() { this.overlays = []; }
    setZoomAndCenter(z, center) { this.zoom = z; this.center = center && asPos(center); }
    setCenter(center) { this.center = center && asPos(center); }
    setBounds(b) { this.bounds = b; }
    setCity(c) { this.city = c; }
    on(event, handler) {
      if (!this._handlers) this._handlers = {};
      if (!this._handlers[event]) this._handlers[event] = [];
      this._handlers[event].push(handler);
    }
    emit(event, data) {
      if (this._handlers?.[event]) {
        this._handlers[event].forEach(fn => fn(data));
      }
    }
    destroy() { MockMap.instances = MockMap.instances.filter(m => m !== this); }
    getOverlayCount() { return this.overlays.length; }
  }
  MockMap.instances = [];

  class MockOverlay {
    constructor(opts = {}) {
      this.opts = opts;
      this._map = null;
      // 与真实API一致：构造时传入 map 即自动上屏
      if (opts.map) opts.map.add(this);
    }
    setMap(m) {
      if (this._map) this._map.remove(this);
      if (m) m.add(this);
    }
    getPosition() { return this.opts.position && asPos(this.opts.position); }
    setPosition(p) { this.opts.position = p; }
    getOptions() { return this.opts; }
  }

  class MockMarker extends MockOverlay {}
  class MockPolyline extends MockOverlay {
    setPath(p) { this.opts.path = p; }
    getPath() { return this.opts.path; }
    setOptions(o) { Object.assign(this.opts, o || {}); }
  }

  class MockAutoComplete {
    constructor(opts = {}) { this.opts = opts; }
    search(kw, cb) {
      setTimeout(() => {
        const k = String(kw || '').trim();
        if (!k) return cb('error', { info: 'EMPTY_KEYWORD', tips: [] });
        let hits = POIS.filter(p => p.name.includes(k) || p.address.includes(k));
        if (this.opts.city && this.opts.city !== '全国') {
          const city = String(this.opts.city);
          hits = hits.filter(p => p.district.includes(city.replace(/市$/, '')));
        }
        cb('complete', {
          info: 'OK',
          tips: hits.slice(0, 8).map(p => ({
            id: p.id, name: p.name, district: p.district, address: p.address,
            location: { lng: p.location[0], lat: p.location[1] },
          })),
        });
      }, 10);
    }
  }

  class MockPlaceSearch {
    constructor(opts = {}) { this.opts = opts; }
    search(kwOrId, cb) {
      setTimeout(() => {
        const p = POIS.find(x => x.id === kwOrId) || POIS.find(x => x.name === kwOrId) ||
          POIS.find(x => x.name.includes(kwOrId));
        if (!p) return cb('error', { info: 'NO_DATA' });
        cb('complete', {
          info: 'OK',
          poiList: { pois: [{ ...p, location: { lng: p.location[0], lat: p.location[1] } }] },
        });
      }, 10);
    }
    getDetails(id, cb) {
      setTimeout(() => {
        const p = POIS.find(x => x.id === id) || POIS[0];
        if (!p) return cb('error', { info: 'NO_DATA' });
        cb('complete', {
          info: 'OK',
          poiList: { pois: [{ ...p, location: { lng: p.location[0], lat: p.location[1] } }] },
        });
      }, 10);
    }
  }

  class MockDriving {
    constructor(opts = {}) { this.opts = opts; }
    search(origin, destination, cb) {
      setTimeout(() => {
        const o = asPos(origin), d = asPos(destination);
        if (!o || !d) return cb('error', { info: 'INVALID_PARAM' });
        const straight = haversine(o, d);
        const distance = Math.round(straight * 1.2 + 600);
        const speed = Number(this.opts.policy) === 1 ? 7.5 : 9; // 不走高速更慢
        const time = Math.max(120, Math.round(distance / speed));
        const mid = [(o[0] + d[0]) / 2 + 0.002, (o[1] + d[1]) / 2 + 0.001];
        cb('complete', {
          info: 'OK',
          routes: [{
            distance,
            time,
            steps: [{ path: [{ lng: o[0], lat: o[1] }, { lng: mid[0], lat: mid[1] }] },
                    { path: [{ lng: mid[0], lat: mid[1] }, { lng: d[0], lat: d[1] }] }],
          }],
        });
      }, 10);
    }
    clear() { /* no-op */ }
  }

  /** 定位：固定返回成都天府广场附近（测试确定性强） */
  class MockGeolocation {
    constructor(opts = {}) { this.opts = opts; }
    getCurrentPosition(cb) {
      setTimeout(() => cb('complete', { position: { lng: 104.0655, lat: 30.657 }, accuracy: 25 }), 30);
    }
  }

  class MockGeocoder {
    constructor(opts = {}) { this.opts = opts; }
    getAddress(pos, cb) {
      setTimeout(() => {
        if (cb) cb('complete', {
          regeocode: {
            formattedAddress: '成都市青羊区人民南路一段',
            pois: [{ id: 'mock_poi_1', name: '天府广场', address: '成都市锦江区人民南路一段', location: pos }],
          },
        });
      }, 20);
    }
  }

  class MockInfoWindow {
    constructor(opts = {}) { this.opts = opts; this.isOpen = false; }
    open(map, pos) { this.isOpen = true; this.pos = pos; }
    close() { this.isOpen = false; }
    setContent(c) { this.opts.content = c; }
  }

  class MockCitySearch {
    constructor(opts = {}) { this.opts = opts; }
    getLocalCity(cb) {
      setTimeout(() => {
        cb('complete', {
          info: 'OK',
          city: '成都市',
          bounds: {
            getCenter() { return { getLng: () => 104.0655, getLat: () => 30.657 }; }
          },
          rectangle: '104.0,30.5;104.2,30.8'
        });
      }, 20);
    }
  }

  const AMap = {
    Map: MockMap,
    Marker: MockMarker,
    Polyline: MockPolyline,
    AutoComplete: MockAutoComplete,
    PlaceSearch: MockPlaceSearch,
    Driving: MockDriving,
    Geolocation: MockGeolocation,
    Geocoder: MockGeocoder,
    CitySearch: MockCitySearch,
    InfoWindow: MockInfoWindow,
    Pixel: class { constructor(x, y) { this.x = x; this.y = y; } },
    LngLat: class { constructor(lng, lat) { this.lng = lng; this.lat = lat; } getLng() { return this.lng; } getLat() { return this.lat; } },
    __POIS__: POIS,
  };
  window.__LUSHU_AMAP_MOCK__ = AMap;
  window.AMap = AMap;
  return AMap;
}
