/** 通用工具函数（纯函数，可在浏览器测试环境中直接验证） */

let uidCounter = 0;
export function uid(prefix = '') {
  uidCounter = (uidCounter + 1) % 1679616;
  return (prefix ? prefix + '_' : '') +
    Date.now().toString(36) + uidCounter.toString(36) + Math.random().toString(36).slice(2, 7);
}

export function debounce(fn, wait) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

const R_EARTH = 6371008.8;
export function haversine(a, b) {
  const toRad = d => d * Math.PI / 180;
  const [lng1, lat1] = a, [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}

const ILLEGAL = /[\\/:*?"<>|\s]+/g;
export function safeFilename(name, max = 40) {
  const s = String(name ?? '').replace(ILLEGAL, '_').replace(/^_+|_+$/g, '');
  return (s.slice(0, max) || '未命名');
}

export function todayCompact(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function fmtClock(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(str) {
  if (!str) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return str;
  return `${Number(m[2])}月${Number(m[3])}日`;
}

export function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  const d = new Date(ts), now = new Date();
  const p = n => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const dayMs = 86400_000;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startToday) return `今天 ${hm}`;
  if (ts >= startToday - dayMs) return `昨天 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function deepClone(o) {
  return structuredClone(o);
}

/** 经纬度 "lng,lat" 字符串 <-> 数组 */
export function locToStr(loc) {
  return `${Number(loc[0])},${Number(loc[1])}`;
}
export function strToLoc(s) {
  if (!s) return null;
  const [lng, lat] = String(s).split(',').map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}
/** 归一化各种坐标形态（数组 / {lng,lat} / LngLat实例）为 [lng,lat] */
export function normPos(p) {
  if (!p) return null;
  if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
  if (typeof p === 'object' && Number.isFinite(Number(p.lng))) return [Number(p.lng), Number(p.lat)];
  return null;
}

/** 距离与用时格式化（生成路书/规划页展示用） */
export function fmtDistance(m) {
  if (!Number.isFinite(m) || m <= 0) return '';
  return m < 1000 ? `${Math.round(m)}米` : `${(m / 1000).toFixed(1)}公里`;
}

export function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return '1分钟内';
  let h = Math.floor(sec / 3600);
  let m = Math.round((sec % 3600) / 60);
  if (m === 60) { h += 1; m = 0; }
  return `${h ? `${h}小时` : ''}${m ? `${m}分钟` : ''}`.trim();
}

/** 从地址里解析城市名（取第一个"市"字前的行政区划末段）。
 *  "四川省成都市青羊区…"→"成都市"；"天津市天津市河西区…"→"天津市"（去重）；
 *  "新疆维吾尔自治区乌鲁木齐市…"→"乌鲁木齐市"；解析不出返回"" */
export function cityOfAddress(addr) {
  if (!addr) return '';
  const s = String(addr);
  const i = s.indexOf('市');
  if (i <= 0) return '';
  const before = s.slice(0, i);
  const seg = before.split(/省|自治区|特别行政区|州|地区|盟/).pop();
  if (!seg || seg.length < 2 || seg.length > 5) return '';
  return seg + '市';
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual(a[k], b[k]));
}
