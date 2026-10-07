/** 生成路书：全程分色驾车图 + 按天行程单（二维码导航、天气、单天展示） */

import { state, currentBook, findItem } from '../core/state.js';
import { loadAMap, centerOnCurrentLocation } from '../core/amap.js';
import { routeChain, effectiveStayId } from '../core/plannerOps.js';
import { geocodeName, driveSegments, dayColor } from '../core/routeDraw.js';
import { formModal } from '../core/modal.js';
import { openModal } from '../core/modal.js';
import { toast } from '../core/toast.js';
import { escapeHtml, fmtDate, strToLoc, locToStr, fmtDistance, fmtDuration, cityOfAddress } from '../core/utils.js';

let el = null;
let mapRef = null;
let overlays = [];
let dayBlocks = [];    // 每天: [{kind:'origin'|'item'|'dest'|'stay', name, tags:[], loc|null}]
let daySegments = [];  // 每天: [{distance米, time秒}|null] 对应相邻块
let dayWeather = [];   // 每天: {first:{emoji,tmax,tmin}|null, last:…|null}
let dayLines = [];     // 每天: 该天驾车线数组（用于重叠分层高亮）
let genRenderStamp = 0; // 渲染时间戳：details插入时的初始toggle不触发高亮
let genPolicy = 0;     // 0=高速优先 1=不走高速
let genRun = 0;        // 计算任务代号：切换路书/重算时使旧任务作废（十轮反馈3）

function isMobileUA() {
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

/** 跳转出口（测试可替换） */
export const nav = { go: uri => { location.href = uri; } };

function tagNamesOf(item) {
  return item.tagIds
    .map(tid => state.library.tags.find(t => t.id === tid)?.name)
    .filter(Boolean);
}

/* ---------------- 天气（Open-Meteo，免Key，按坐标+日期） ---------------- */

const WMO = code => {
  if (code === 0) return { emoji: '☀️', text: '晴' };
  if (code === 1) return { emoji: '🌤️', text: '基本晴' };
  if (code === 2) return { emoji: '⛅', text: '多云' };
  if (code === 3) return { emoji: '☁️', text: '阴' };
  if (code === 45 || code === 48) return { emoji: '🌫️', text: '雾' };
  if (code >= 51 && code <= 57) return { emoji: '🌦️', text: '毛毛雨' };
  if (code >= 61 && code <= 67) return { emoji: '🌧️', text: '雨' };
  if (code >= 71 && code <= 77) return { emoji: '❄️', text: '雪' };
  if (code >= 80 && code <= 82) return { emoji: '🌦️', text: '阵雨' };
  if (code === 85 || code === 86) return { emoji: '🌨️', text: '阵雪' };
  if (code >= 95) return { emoji: '⛈️', text: '雷雨' };
  return { emoji: '🌡️', text: '' };
};

const wxCache = new Map(); // 'date|lng,lat' -> {emoji,text,tmax,tmin}|null

/** 中文天气现象 → emoji（高德dayweather文本用） */
export function cnWeatherEmoji(text = '') {
  const t = String(text);
  if (t.includes('雷')) return '⛈️';
  if (t.includes('雪')) return '❄️';
  if (t.includes('雨')) return '🌧️';
  if (t.includes('雾') || t.includes('霾') || t.includes('沙')) return '🌫️';
  if (t === '晴') return '☀️';
  if (t.includes('多云')) return '⛅';
  if (t.includes('阴')) return '☁️';
  return '🌡️';
}

/** 解析高德天气API（extensions=all）的预报，取指定日期 */
export function parseAmapCasts(json, dateStr) {
  const casts = json?.forecasts?.[0]?.casts;
  if (!Array.isArray(casts)) return null;
  const cast = casts.find(c => c.date === dateStr);
  if (!cast) return null;
  return {
    emoji: cnWeatherEmoji(cast.dayweather),
    text: cast.dayweather,
    tmax: parseInt(cast.daytemp) || 0,
    tmin: parseInt(cast.nighttemp) || 0,
  };
}

/** 解析高德行政区划API，返回城市adcode */
export function parseAmapDistrict(json) {
  if (json?.status === '1' && Array.isArray(json.districts) && json.districts.length) {
    return json.districts[0].adcode || '';
  }
  return '';
}

async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function fetchOpenMeteoWeather(loc, dateStr) {
  const key = `${dateStr}|${loc[0].toFixed(3)},${loc[1].toFixed(3)}`;
  if (wxCache.has(key)) return wxCache.get(key);
  let out = null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc[1]}&longitude=${loc[0]}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto` +
      `&start_date=${dateStr}&end_date=${dateStr}`;
    const j = await fetchJSON(url);
    if (j?.daily?.time?.length) {
      const w = WMO(j.daily.weather_code[0]);
      out = {
        emoji: w.emoji, text: w.text,
        tmax: Math.round(j.daily.temperature_2m_max[0]),
        tmin: Math.round(j.daily.temperature_2m_min[0]),
      };
    }
  } catch { out = null; }
  if (wxCache.size > 500) wxCache.clear();
  wxCache.set(key, out);
  return out;
}

/** 天气双层：用户填了天气Key→优先高德（城市名→adcode→预报）；失败/未填→Open-Meteo兜底 */
const adcodeCache = new Map();
async function amapAdcode(city, key) {
  if (adcodeCache.has(city)) return adcodeCache.get(city);
  const j = await fetchJSON(`https://restapi.amap.com/v3/config/district?keywords=${encodeURIComponent(city)}&key=${key}&subdistrict=0`);
  const ad = parseAmapDistrict(j);
  if (ad) adcodeCache.set(city, ad);
  return ad || '';
}

async function fetchDayWeather(cityName, loc, dateStr) {
  const wkey = state.settings.weatherKey;
  if (wkey && cityName) {
    try {
      const ad = await amapAdcode(cityName, wkey);
      if (ad) {
        const j = await fetchJSON(`https://restapi.amap.com/v3/weather/weatherInfo?city=${ad}&key=${wkey}&extensions=all`);
        const w = parseAmapCasts(j, dateStr);
        if (w) return w;
      }
    } catch { /* 高德失败回退Open-Meteo */ }
  }
  return fetchOpenMeteoWeather(loc, dateStr);
}

/** 测试注入钩子：预置天气数据并刷新列表 */
export function __setWeatherForTest(arr) {
  dayWeather = arr;
  const b = currentBook();
  if (b) renderDaysList(b);
}

/**
 * 当天城市解析（六轮反馈）：住宿优先，解析不出则从当天行程
 * 最后一站、倒数第二站……逐个回退，直到解析出城市为止。
 */
export function dayCity(book, dayId) {
  const day = book.days.find(d => d.id === dayId);
  if (!day) return '';
  const candidates = [];
  if (day.stayItemId) candidates.push(findItem(day.stayItemId));
  [...day.stopItemIds].reverse().forEach(id => candidates.push(findItem(id)));
  for (const it of candidates) {
    const city = it && cityOfAddress(it.address);
    if (city) return city;
  }
  return '';
}

/** 构建某天的展示块：出发锚/条目/住宿/目的地，附带坐标（解析不到为null） */
async function resolveBlocks(book, dayId) {
  const day = book.days.find(d => d.id === dayId);
  const chain = routeChain(book, dayId);
  const effStay = effectiveStayId(day); // 未设住宿时默认最后一个地点为住宿
  const blocks = [];
  for (const e of chain) {
    if (e.type === 'origin') {
      let loc = book.origin?.location ? strToLoc(book.origin.location) : null;
      if (!loc) loc = await geocodeName(book.origin?.name);
      if (loc && book.origin && !book.origin.location) book.origin.location = locToStr(loc);
      blocks.push({ kind: 'origin', name: `🚩 ${book.origin?.name || '出发地'}`, tags: [], loc });
    } else if (e.type === 'dest') {
      let loc = book.destination?.location ? strToLoc(book.destination.location) : null;
      if (!loc) loc = await geocodeName(book.destination?.name);
      if (loc && book.destination && !book.destination.location) book.destination.location = locToStr(loc);
      blocks.push({ kind: 'dest', name: `🏁 ${book.destination?.name || '目的地'}`, tags: [], loc });
    } else {
      const it = findItem(e.id);
      if (it) {
        const isStay = effStay === e.id;
        blocks.push({
          kind: isStay ? 'stay' : 'item',
          id: it.id,
          name: it.name,
          tags: tagNamesOf(it),
          address: it.address || '',
          loc: strToLoc(it.location),
        });
      }
    }
  }
  // 链首块为当天出发位置：补🚩标识（origin块自带）
  const first = blocks[0];
  if (first && (first.kind === 'item' || first.kind === 'stay') && !first.name.startsWith('🚩')) {
    first.isStart = true;
    first.name = `🚩 ${first.name}`;
  } else if (first && first.kind === 'origin') {
    first.isStart = true;
  }
  return blocks;
}

function renderDaysList(book) {
  const box = el.querySelector('[data-days]');
  if (!book.days.length) {
    box.innerHTML = `<div class="empty-state"><p>这份路书还没有安排行程，去规划页添加吧</p></div>`;
    return;
  }
  box.innerHTML = book.days.map((d, i) => {
    const effStay = effectiveStayId(d); // 未设住宿时默认最后一个地点
    const stay = effStay ? findItem(effStay) : null;
    const blocks = dayBlocks[i] || null;
    // 当天总距离/总用时（所有可解析段求和）
    const segs = daySegments[i] || [];
    const totalD = segs.reduce((n, s) => n + (s?.distance || 0), 0);
    const totalT = segs.reduce((n, s) => n + (s?.time || 0), 0);
    const hasTotal = segs.some(Boolean) && totalD > 0;
    // 宿：城市-住宿位置（城市解析失败时逐站回退；无城市只显示住宿名）
    const city = stay ? dayCity(book, d.id) : '';
    const stayText = stay
      ? `${city ? city + '-' : ''}${escapeHtml(stay.name)}`
      : '未设置';
    let chainHtml = '<div style="color:var(--sub);padding:2px 0;">正在计算路线…</div>';
    if (blocks) {
      if (!blocks.length) chainHtml = '<div style="color:var(--sub);padding:2px 0;">这一天没有安排地点</div>';
      else {
        const segs2 = daySegments[i] || [];
        const wx = dayWeather[i] || {};
        // 地点与其后箭头（含距离/用时）成组，换行时不拆散，杜绝错位；
        // 起点（首块）与终点（末块）的标签与天气合并一行显示
        chainHtml = blocks.map((b, bi) => {
          const isFirst = bi === 0;
          const isLast = bi === blocks.length - 1;
          const w = (isFirst && wx.first) || (isLast && wx.last) || null;
          const subParts = [];
          if (b.tags.length) {
            subParts.push(`<span class="gtags">${b.tags.map(t => `<span class="chip">#${escapeHtml(t)}</span>`).join('')}</span>`);
          }
          if (w) subParts.push(`<span class="gw" title="当天天气预报">${w.emoji} ${w.tmax}°/${w.tmin}°</span>`);
          const subline = subParts.length ? `<div class="gen-subline">${subParts.join('')}</div>` : '';
          const stopHtml = `<div class="gen-stop"><div class="gname" title="${escapeHtml(b.name)}"><span class="gnum" style="background:${dayColor(i)};">${bi + 1}</span><span class="gtxt">${escapeHtml(b.name)}</span></div>${subline}</div>`;
          const seg = segs2[bi];
          const info = seg ? `<span class="gdist">${fmtDistance(seg.distance)} · ${fmtDuration(seg.time)}</span>` : '';
          const arrow = bi < blocks.length - 1
            ? `<div class="gen-arrow"><span class="garr">→</span>${info}</div>`
            : '';
          return `<span class="gen-pair">${stopHtml}${arrow}</span>`;
        }).join('');
      }
    }
    return `<details class="gen-day" data-genday="${d.id}" open>
      <summary>
        <span class="day-info">
          <span class="chip" style="background:${dayColor(i)};color:#fff;">D${i + 1}</span>
          <span class="day-date">${fmtDate(d.date) || '未设日期'}</span>
        </span>
        <span class="day-meta">
          <span class="day-meta-top">
            ${hasTotal ? `<span class="chip" style="background:var(--pri-weak);color:var(--pri-dark);">全程 ${fmtDistance(totalD)} · ${fmtDuration(totalT)}</span>` : ''}
            <span style="flex:1"></span>
            <button class="btn sm ${el && el._onlyDay === i ? 'primary' : 'ghost'}" data-showday="${i}">${el && el._onlyDay === i ? '🗺 显示全程' : '🗺 单独显示'}</button>
            ${isMobileUA()
              ? `<button class="btn sm primary" data-mobnav="${i}" title="点击直接调起高德导航">📱 手机导航</button>`
              : ''}
          </span>
          <span class="day-meta-bottom">宿：${stayText}</span>
        </span>
      </summary>
      <div class="chain">${chainHtml}</div>
    </details>`;
  }).join('');
}

async function computeAndDraw(book, runId = ++genRun) {
  const status = el.querySelector('[data-genstatus]');
  try {
    const AMap = await loadAMap();
    if (runId !== genRun) return; // 已有更新的任务接管
    const panel = el.querySelector('.gen-map');
    // 每次进入页面重建地图（容器是新的，旧实例已随旧DOM脱离）
    if (mapRef) { try { mapRef.destroy(); } catch { /* 忽略 */ } }
    const defaultCenter = normPos(state.library?.items?.slice(-1)[0]?.location) || [104.065, 30.65];
    mapRef = new AMap.Map(panel.querySelector('#mapGen'), { zoom: 10, center: defaultCenter });
    // 先尝试定位当前位置（最多等1.5s），随后的画线 setFitView 不会被迟到的定位回调覆盖
    await centerOnCurrentLocation(mapRef, 10, 1500);
    if (runId !== genRun) return;
    overlays.forEach(o => o.setMap(null));
    overlays = [];
    dayBlocks = [];
    daySegments = [];
    dayLines = [];
    const only = (typeof el._onlyDay === 'number') ? el._onlyDay : null; // 单独展示某天
    for (let i = 0; i < book.days.length; i++) {
      if (runId !== genRun) return;
      const blocks = await resolveBlocks(book, book.days[i].id);
      dayBlocks.push(blocks);
      const pts = blocks.map(b => b.loc);
      const include = only === null || i === only;
      const { lines, segments } = await driveSegments(AMap, pts, {
        map: include ? mapRef : null, color: dayColor(i), policy: genPolicy,
      });
      overlays.push(...lines);
      dayLines.push(lines); // 记录每天线组，供高亮分层（十三轮反馈2）
      daySegments.push(segments);
    }
    // 标记：起点/各天住宿/终点（只标被展示的天）
    const showDay = i => only === null || i === only;
    // 每个点挂"D天·序号 #二级标签"编号标签；悬停显示地点详情（十三轮反馈3/5）
    const markTagged = (dayIdx, blocks) => {
      let n = 0;
      blocks.forEach(b => {
        if (!b.loc) return;
        n += 1;
        let suffix = '';
        if (b.kind === 'dest') suffix = ' 🏁';
        else if (b.isStart || b.kind === 'origin') suffix = ' 🚩';
        else if (b.kind === 'stay') suffix = ' 🏨';
        const tagText = b.tags.length ? ' ' + b.tags.map(t => '#' + t).join(' ') : '';
        const hover = [b.name.replace(/^🚩\s*/, ''), b.address, b.tags.map(t => '#' + t).join(' ')].filter(Boolean).join('｜');
        overlays.push(new AMap.Marker({
          position: b.loc,
          map: mapRef,
          content: `<span class="map-tag" style="background:${dayColor(dayIdx)};" title="${escapeHtml(hover)}">D${dayIdx + 1}·${n}${suffix}${escapeHtml(tagText)}</span>`,
        }));
      });
    };
    book.days.forEach((d, i) => {
      if (!showDay(i)) return;
      markTagged(i, dayBlocks[i] || []);
    });
    mapRef.setFitView();
    status.innerHTML = '';
  } catch (err) {
    status.innerHTML = `<div class="banner" style="position:absolute;top:10px;left:10px;right:10px;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <span>${err.message === 'NO_KEY' ? '尚未配置高德Key，地图画线不可用' : `路线计算失败：${escapeHtml(err.message || String(err))}`}</span>
      ${err.message === 'NO_KEY' ? '<button class="btn sm primary" data-act="goset">去「系统设置」填写</button>' : ''}
    </div>`;
    status.querySelector('[data-act="goset"]')?.addEventListener('click', () => { location.hash = '#/mine'; });
  }
  // 起点/终点当天天气：城市逐站回退；填了天气Key优先高德，否则Open-Meteo（Mock环境跳过网络）
  const isMockAmap = Boolean((await loadAMap().catch(() => ({})))?.__POIS__);
  dayWeather = book.days.map((d, i) => ({ first: null, last: null }));
  if (!isMockAmap) {
    await Promise.all(book.days.map(async (d, i) => {
      const blocks = dayBlocks[i] || [];
      if (!d.date || !blocks.length) return;
      const city = dayCity(book, d.id);
      const targets = [];
      if (blocks[0].loc) targets.push(['first', blocks[0].loc]);
      if (blocks.length > 1 && blocks[blocks.length - 1].loc) targets.push(['last', blocks[blocks.length - 1].loc]);
      const res = await Promise.all(targets.map(([k, loc]) => fetchDayWeather(city, loc, d.date).then(w => [k, w])));
      res.forEach(([k, w]) => { if (w) dayWeather[i][k] = w; });
    }));
  }
  if (runId !== genRun) return;
  renderDaysList(book);
}

/** 路线重叠分层（十三轮反馈2）：高亮某天（该天线加粗不透明、其余变淡）；null=恢复绘制默认 */
function highlightDay(i) {
  dayLines.forEach((lines, di) => {
    const active = i === null ? null : (di === i);
    lines.forEach(pl => pl.setOptions({
      strokeOpacity: active === null ? 0.85 : (active ? 0.9 : 0.22),
      strokeWeight: active === null ? 5 : (active ? 6 : 4),
    }));
  });
}

/* ---------------- 导航二维码（高德URI，按"起点+1途经+终点"自动拆段） ---------------- */

/** 把某天链路拆成高德导航链接：每段最多 起点+1途经点+终点，段与段首尾相接 */
export function dayNavLinks(blocks, policy = 0) {
  const pts = [];
  blocks.forEach(b => {
    if (b.loc) pts.push({ loc: b.loc, name: b.name.replace(/^[🚩🏨🏁]\s*/u, '') });
  });
  if (pts.length < 2) return [];
  const out = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const seg = pts.slice(i, i + 3);
    const from = seg[0], to = seg[seg.length - 1];
    const via = seg.slice(1, -1);
    const enc = s => encodeURIComponent(s);
    const pos = p => `${p.loc[0]},${p.loc[1]}${p.name ? ',' + enc(p.name) : ''}`;
    const uri = `https://uri.amap.com/navigation?from=${pos(from)}&to=${pos(to)}` +
      (via.length ? `&via=${via.map(v => `${v.loc[0]},${v.loc[1]},${enc(v.name)}`).join(';')}` : '') +
      `&mode=car&policy=${policy}&src=lushu&coordinate=gaode&callnative=1`;
    out.push({ uri, label: seg.map(p => p.name).join(' → ') });
  }
  return out;
}

function showQrModal(dayIdx) {
  const blocks = dayBlocks[dayIdx] || [];
  const links = dayNavLinks(blocks, genPolicy);
  const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const { mask, close } = openModal({
    title: `D${dayIdx + 1} 导航二维码`,
    wide: true,
    content: links.length ? `
      <p class="modal-msg">手机扫任意一段的码，高德会按顺序导航至各点；走完一段再扫下一段。手机上直接点二维码即可调起高德${isMobile ? '（已检测到手机）' : ''}。</p>
      <div class="qr-grid">
        ${links.map((l, i) => {
          let svg = '';
          try {
            const qr = qrcode(0, 'M');
            qr.addData(l.uri);
            qr.make();
            svg = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
          } catch { svg = '<div class="qr-err">生成失败</div>'; }
          return `<div class="qr-item">
            <div class="qr-label">第${i + 1}段 · ${escapeHtml(l.label)}</div>
            <a href="${l.uri}" target="_blank" rel="noopener" title="点击直接调起高德导航">${svg}</a>
          </div>`;
        }).join('')}
      </div>
      ${links.length > 1 ? '<p class="modal-msg" style="font-size:12px;">因高德限制（一条导航链接最多 起点+1途经点+终点），本天行程已自动拆段、段与段首尾相接。</p>' : ''}`
      : '<p class="modal-msg">这一天有效地点不足（至少2个有坐标的地点），无法生成导航二维码。</p>',
  });
  mask.querySelector('[data-act="ok"]').hidden = true;
  mask.querySelector('[data-act="cancel"]').textContent = '关闭';
}

export async function render(container) {
  el = container;
  const book = currentBook();
  if (!book) {
    el.innerHTML = `
      <div data-page="generate" style="padding: 40px 20px; display: flex; justify-content: center; align-items: center; min-height: 60vh;">
        <div class="empty-state" style="max-width: 440px; text-align: center; background: var(--card, #fff); padding: 36px 28px; border-radius: 16px; border: 1px solid var(--line, #e2e8f0); box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
          <div class="big" style="font-size: 52px; margin-bottom: 12px;">🧾</div>
          <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 8px; color: var(--txt, #1e293b);">还没有选择要生成的路书</h3>
          <p style="color: var(--sub, #64748b); font-size: 13.5px; line-height: 1.6; margin-bottom: 24px;">
            生成自驾路书需要先创建路书并安排行程。您可以立即新建一份专属路书！
          </p>
          <button class="btn primary lg" data-act="create-book-gen" style="padding: 10px 24px; font-size: 14px;">＋ 新建路书</button>
        </div>
      </div>`;
    el.querySelector('[data-act="create-book-gen"]')?.addEventListener('click', async () => {
      const { newBookDialog } = await import('./mybooks.js');
      const newBook = await newBookDialog();
      if (newBook) {
        state.ui.lastBookId = newBook.id;
        location.hash = '#/planner';
      }
    });
    return;
  }
  // 切换路书/重进页面：清空上一本书的块数据，避免"新书标题+旧书行程"串页（十轮反馈3）
  dayBlocks = [];
  daySegments = [];
  dayWeather = [];
  el._onlyDay = null;
  const runId = ++genRun;
  genRenderStamp = performance.now();
  el.innerHTML = `
    <div data-page="generate" class="gen-layout">
      <div class="panel gen-left">
        <div class="page-head" style="margin:0;flex-wrap:wrap;gap:8px;">
          <h1 style="font-size:16px;">${escapeHtml(book.name)} · 全程预览</h1>
          <label style="color:var(--sub);font-size:13px;display:flex;align-items:center;gap:6px;">
            路线偏好
            <select data-policy style="border:1px solid var(--line-strong);border-radius:8px;padding:5px 8px;">
              <option value="0" ${genPolicy === 0 ? 'selected' : ''}>高速优先</option>
              <option value="1" ${genPolicy === 1 ? 'selected' : ''}>不走高速</option>
            </select>
          </label>
          <span style="flex:1"></span>
          <a class="btn" href="#/planner">✏️ 去调整行程</a>
        </div>
        <div data-days style="display:flex;flex-direction:column;gap:10px;"></div>
      </div>
      <div class="gen-right">
        <div class="panel gen-map"><div id="mapGen"></div><div data-genstatus></div></div>
        <div class="qr-placeholder">🧭 第二版将在此提供「每天导航二维码」（高德URI按天拆段生成）</div>
      </div>
    </div>`;
  renderDaysList(book);
  computeAndDraw(book, runId);

  const root = el.querySelector('[data-page="generate"]'); // 每次渲染的新根节点：监听不跨页叠加
  root.addEventListener('click', e => {
      const showday = e.target.closest('[data-showday]');
      if (showday) {
        e.preventDefault(); // 阻止summary折叠
        const i = Number(showday.dataset.showday);
        el._onlyDay = (el._onlyDay === i) ? null : i;
        const b = currentBook();
        renderDaysList(b);
        computeAndDraw(b);
        return;
      }
      const genSum = e.target.closest('[data-genday] > summary');
      if (genSum && !e.target.closest('button')) {
        // 点击summary展开/收起：展开→高亮该天（重叠分层），收起→恢复全程
        const dd = genSum.closest('[data-genday]');
        const i = book.days.findIndex(d => d.id === dd.dataset.genday);
        if (i >= 0) highlightDay(dd.open ? i : null);
        return;
      }
      const mobnav = e.target.closest('[data-mobnav]');
      if (mobnav) {
        const i = Number(mobnav.dataset.mobnav);
        const links = dayNavLinks(dayBlocks[i] || [], genPolicy);
        if (!links.length) { toast('这一天有效地点不足（至少2个有坐标的地点）', 'error'); return; }
        if (links.length === 1) { nav.go(links[0].uri); return; } // 直接调起高德
        const { mask, body, close } = openModal({
          title: `D${i + 1} 分${links.length}段导航`,
          content: `<p class="modal-msg">按顺序逐段导航，走完一段回来点下一段：</p>
            <div>${links.map((l, idx) => `<button class="btn primary" data-uri="${escapeHtml(l.uri)}" style="width:100%;justify-content:flex-start;margin-bottom:8px;">第${idx + 1}段 · ${escapeHtml(l.label)}</button>`).join('')}</div>`,
        });
        mask.querySelector('[data-act="ok"]').hidden = true;
        mask.querySelector('[data-act="cancel"]').textContent = '取消';
        body.addEventListener('click', ev => {
          const btn = ev.target.closest('[data-uri]');
          if (btn) { close(); nav.go(btn.dataset.uri); }
        });
        return;
      }
      if (e.target.matches('[data-policy]')) {
        genPolicy = Number(e.target.value);
        const b = currentBook();
        if (b) computeAndDraw(b);
      }
    });
    root.addEventListener('change', e => {
      if (e.target.matches('[data-policy]')) {
        genPolicy = Number(e.target.value);
        const b = currentBook();
        if (b) computeAndDraw(b);
      }
    });
}
