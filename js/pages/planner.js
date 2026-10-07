/** 路书规划：三栏 = 行程区 | 信息库调用 | 地图 */

import { state, currentBook, findItem } from '../core/state.js';
import { renameBook, touchBook } from '../core/bookOps.js';
import {
  addDay, removeDayById, dayLabel, dayStartAnchor, setStay, clearStay,
  insertStop, moveStop, removeStopById,
} from '../core/plannerOps.js';
import { optimizeOrder } from '../core/optimizer.js';
import { formModal, confirmDialog, openModal } from '../core/modal.js';
import { toast } from '../core/toast.js';
import { loadAMap } from '../core/amap.js';
import { geocodeName, resolveChainPoints, driveSegments } from '../core/routeDraw.js';
import { centerOnCurrentLocation } from '../core/amap.js';
import { escapeHtml, strToLoc, locToStr, normPos, debounce } from '../core/utils.js';

let el = null;
let mapRef = null;
let markerRef = null;
let catMarkers = [];   // 按一级分类展示的一组标记
let polylines = [];
let sortables = [];

function book() { return currentBook(); }

/* ---------------- 左栏 ---------------- */

function anchorText(b, dayId) {
  const a = dayStartAnchor(b, dayId);
  if (!a) return '自由出发'; // 起终点概念已全局移除：第一天无锚点时自由出发
  if (a.type === 'origin') return `${b.origin.name}（整趟起点）`;
  return findItem(a.id)?.name || '（条目已删除）';
}

function renderLeft() {
  const b = book();
  const left = el.querySelector('[data-left]');
  const activeId = el._activeDayId;
  left.innerHTML = `
    <div class="book-head">
      <input class="inline-input nm" data-bookname value="${escapeHtml(b.name)}" title="点击修改路书名">
    </div>
    ${b.days.map((d, i) => {
      // 检查住宿有效性，如已在信息库中被删除则自动清理
      if (d.stayItemId && !findItem(d.stayItemId)) {
        d.stayItemId = null;
        touchBook(b);
      }
      const stay = d.stayItemId ? findItem(d.stayItemId) : null;

      // 提取该天在信息库中真实存在的有效地点，并自动过滤/清理已删除的脏引用
      const validStops = [];
      let hasDeadStops = false;
      for (const id of d.stopItemIds) {
        const it = findItem(id);
        if (it) validStops.push({ id, it });
        else hasDeadStops = true;
      }
      if (hasDeadStops) {
        d.stopItemIds = validStops.map(x => x.id);
        touchBook(b);
      }

      return `<div class="card day-card ${d.id === activeId ? 'active' : ''}" data-day="${d.id}">
        <div class="day-head">
          <span class="dlabel">D${i + 1}</span>
          <button class="date-btn" data-datebtn="${d.id}" title="选择日期（每周从周一开始）">${d.date || '选择日期'}</button>
          <span class="spacer"></span>
          <button class="btn sm ghost" data-opt="${d.id}" title="按就近原则重排中间地点">⚡优化顺序</button>
          <span class="icon-btn sm" data-daydel="${d.id}" title="删除这一天">🗑</span>
        </div>
        <div class="anchor-row">🚩 从：${escapeHtml(anchorText(b, d.id))}</div>
        <div data-stops="${d.id}">
          ${validStops.length ? validStops.map(({ id, it }, n) => {
            const cat = state.library.categories.find(c => c.id === it.categoryId);
            return `<div class="stop-row" data-stoprow data-item-id="${id}" tabindex="0">
              <span class="drag">≡</span>
              <span class="idx">${n + 1}</span>
              <span class="nm link" data-locate="${id}">${escapeHtml(it.name)}</span>
              <span class="chip">${escapeHtml(cat?.name || '未分类')}</span>
              <span class="icon-btn sm" data-stopdel="${d.id}|${id}" title="从行程移除">✕</span>
            </div>`;
          }).join('') : '<div style="color:var(--sub);font-size:12px;padding:4px 8px;">从右侧拖入或点 ⊕ 添加地点</div>'}
        </div>
        <div class="stay-row ${stay ? 'set' : ''}">
          🏨 今晚住宿：<strong>${stay ? escapeHtml(stay.name) : '未设置'}</strong>
          <button class="btn sm" data-stayset="${d.id}">${stay ? '更换' : '设置'}</button>
          ${stay ? `<button class="btn sm ghost" data-stayclear="${d.id}">清除</button>` : ''}
        </div>
      </div>`;
    }).join('')}
    <button class="btn add-day-btn" data-act="addday">＋ 添加一天（D${b.days.length + 1}）</button>`;

  bindSortables(left);
}

function destroySortables() {
  sortables.forEach(s => { try { s.destroy(); } catch { /* 忽略 */ } });
  sortables = [];
}

function bindSortables(left) {
  destroySortables();
  const b = book();
  left.querySelectorAll('[data-stops]').forEach(box => {
    sortables.push(Sortable.create(box, {
      group: 'stops',
      draggable: '[data-stoprow]',
      animation: 150,
      delay: 200,
      delayOnTouchOnly: true, // 手机长按拖动，桌面即时
      onAdd: evt => {
        const dayId = evt.to.dataset.stops;
        const itemId = evt.item.dataset.itemId;
        if (!insertStop(b, dayId, itemId, evt.newIndex)) {
          toast('该地点已是当晚住宿，不能重复加入', 'error');
        }
        renderLeft();
        renderCalloutRows();
      },
      onEnd: evt => {
        const dayId = evt.from.dataset.stops;
        const itemId = evt.item.dataset.itemId;
        if (evt.from === evt.to) {
          moveStop(b, dayId, dayId, itemId, evt.newIndex);
        }
        renderLeft();
        renderCalloutRows();
      },
    }));
  });
}

/* ---------------- 日期选择器（每周一为第一天） ---------------- */

let datePop = null;
let docClickListener = null;

function closeDatePicker() {
  if (docClickListener) {
    document.removeEventListener('click', docClickListener);
    docClickListener = null;
  }
  if (datePop) {
    datePop.remove();
    datePop = null;
  }
}

function openDatePicker(anchor, dayId) {
  closeDatePicker();
  const b = book();
  const day = b.days.find(d => d.id === dayId);
  const init = day?.date ? day.date.split('-').map(Number) : null;
  let vy = init ? init[0] : new Date().getFullYear();
  let vm = init ? init[1] - 1 : new Date().getMonth();
  const pop = document.createElement('div');
  pop.className = 'datepop';
  document.body.appendChild(pop);
  datePop = pop;

  function renderPop() {
    const first = new Date(vy, vm, 1);
    const lead = (first.getDay() + 6) % 7; // 周一为第一列
    const daysIn = new Date(vy, vm + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span class="dp-blank"></span>';
    for (let dnum = 1; dnum <= daysIn; dnum++) {
      const ds = `${vy}-${String(vm + 1).padStart(2, '0')}-${String(dnum).padStart(2, '0')}`;
      cells += `<button class="dp-day ${day?.date === ds ? 'dp-sel' : ''}" data-pickdate="${ds}">${dnum}</button>`;
    }
    pop.innerHTML = `
      <div class="dp-head">
        <button class="btn sm ghost" data-dpprev title="上个月" style="cursor:pointer;font-size:16px;line-height:1;padding:2px 8px;">‹</button>
        <strong>${vy}年${vm + 1}月</strong>
        <button class="btn sm ghost" data-dpnext title="下个月" style="cursor:pointer;font-size:16px;line-height:1;padding:2px 8px;">›</button>
      </div>
      <div class="dp-week">${['一', '二', '三', '四', '五', '六', '日'].map(w => `<span>${w}</span>`).join('')}</div>
      <div class="dp-grid">${cells}</div>
      <div class="dp-foot"><button class="btn sm ghost" data-dpclear>清除日期</button></div>`;
  }
  renderPop();
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 240))}px`;
  pop.style.top = `${Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 300))}px`;

  pop.addEventListener('click', e => {
    e.stopPropagation(); // 关键修复：阻止事件冒泡到 document，避免触发外部点击关闭
    const pick = e.target.closest('[data-pickdate]');
    if (pick) {
      const d2 = book().days.find(x => x.id === dayId);
      if (d2) d2.date = pick.dataset.pickdate;
      touchBook(b);
      closeDatePicker();
      renderLeft();
      return;
    }
    if (e.target.closest('[data-dpprev]')) {
      vm--;
      if (vm < 0) { vm = 11; vy--; }
      renderPop();
      return;
    }
    if (e.target.closest('[data-dpnext]')) {
      vm++;
      if (vm > 11) { vm = 0; vy++; }
      renderPop();
      return;
    }
    if (e.target.closest('[data-dpclear]')) {
      const d2 = book().days.find(x => x.id === dayId);
      if (d2) d2.date = '';
      touchBook(b);
      closeDatePicker();
      renderLeft();
    }
  });

  docClickListener = function onDoc(e) {
    if (datePop && !datePop.contains(e.target) && !e.target.closest('[data-datebtn]')) {
      closeDatePicker();
    }
  };
  setTimeout(() => {
    document.addEventListener('click', docClickListener);
  }, 0);
}

/* ---------------- 右上：信息库调用 ---------------- */

function calloutFilter() {
  return el._calloutF || (el._calloutF = { categoryId: '__all', tagIds: [], kw: '', cols: 2 });
}

function tagChipsOf(item) {
  return item.tagIds.map(tid => {
    const t = state.library.tags.find(x => x.id === tid);
    return t ? `<span class="chip">#${escapeHtml(t.name)}</span>` : '';
  }).join('');
}

/** 该条目在当前路书中被用在哪些天（行程条目/住宿都算） */
function usageBadges(itemId) {
  const b = book();
  if (!b) return [];
  return b.days
    .map((d, i) => (d.stopItemIds.includes(itemId) || d.stayItemId === itemId) ? `D${i + 1}` : null)
    .filter(Boolean);
}

function filteredCalloutItems() {
  const cf = calloutFilter();
  let items = state.library.items.slice();
  if (cf.categoryId !== '__all') {
    if (cf.categoryId === '__uncat') items = items.filter(i => !state.library.categories.some(c => c.id === i.categoryId));
    else items = items.filter(i => i.categoryId === cf.categoryId);
  }
  if (cf.tagIds.length) items = items.filter(i => cf.tagIds.some(t => i.tagIds.includes(t)));
  if (cf.kw) items = items.filter(i => i.name.includes(cf.kw));
  items.sort((a, b2) => (b2.createdAt || 0) - (a.createdAt || 0));
  return items;
}

/** 只重建工具栏（切大类/标签时用） */
function renderCalloutToolbar() {
  const box = el.querySelector('[data-calloutbar]');
  const cf = calloutFilter();
  box.innerHTML = `
    <div class="lib-toolbar">
      ${[['__all', '全部'], ...state.library.categories.map(c => [c.id, c.name])].map(([id, name]) =>
        `<button class="btn sm ${cf.categoryId === id ? 'primary' : ''}" data-libcat="${id}">${escapeHtml(name)}</button>`).join('')}
      <input type="search" data-libkw placeholder="搜索信息库…" value="${escapeHtml(cf.kw)}" style="width:140px;">
    </div>
    <div class="lib-toolbar" style="margin-top:4px;">
      <span style="color:var(--sub);font-size:12px;">标签:</span>
      ${state.library.tags.map(t => `<span class="chip ${cf.tagIds.includes(t.id) ? 'active' : ''}" data-libtag="${t.id}">#${escapeHtml(t.name)}</span>`).join('')}
    </div>`;
}

/** 只重建条目列表（固定2列显示） */
function renderCalloutRows() {
  const rows = el.querySelector('[data-librows]');
  if (!rows) return;
  const items = filteredCalloutItems();
  rows.classList.add('two-col');
  rows.innerHTML = items.map(it => {
    const badges = usageBadges(it.id);
    return `<div class="stop-row" data-librow data-item-id="${it.id}" tabindex="0">
      <button class="btn sm" data-addplus="${it.id}" title="追加到当前选中的天">⊕</button>
      <span class="nm link" data-locate="${it.id}">${escapeHtml(it.name)}</span>
      <span class="chips">${tagChipsOf(it)}</span>
      ${badges.length ? `<span class="chips">${badges.map(x => `<span class="chip used-chip">✓${x}</span>`).join('')}</span>` : ''}
    </div>`;
  }).join('') || '<div style="color:var(--sub);font-size:12px;padding:6px;grid-column:1/-1;">没有匹配的条目，去「地图选点」收集</div>';
}

function renderCallout() { renderCalloutToolbar(); renderCalloutRows(); }

function destroySortableOf(target) {
  sortables = sortables.filter(s => {
    if (s.el === target) { try { s.destroy(); } catch { /* 忽略 */ } return false; }
    return true;
  });
}

function bindCalloutSortable() {
  const rows = el.querySelector('[data-librows]');
  destroySortableOf(rows);
  sortables.push(Sortable.create(rows, {
    group: { name: 'stops', pull: 'clone', put: false },
    draggable: '[data-librow]',
    sort: false,
    animation: 150,
    delay: 200,
    delayOnTouchOnly: true, // 手机长按拖动
  }));
}

/* ---------------- 右下：地图 ---------------- */

async function initMap() {
  const panel = el.querySelector('.planner-map-panel');
  try {
    const AMap = await loadAMap();
    if (mapRef) { try { mapRef.destroy(); } catch { /* 忽略 */ } }
    const defaultCenter = normPos(state.library?.items?.slice(-1)[0]?.location) || [104.065, 30.657];
    mapRef = new AMap.Map(panel.querySelector('#mapPlanner'), { zoom: 11, center: defaultCenter });
    markerRef = null;
    centerOnCurrentLocation(mapRef, 11); // 默认显示当前位置
  } catch (err) {
    panel.querySelector('#mapPlanner').innerHTML =
      `<div class="banner" style="margin:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span>${err.message === 'NO_KEY' ? '尚未配置高德Key，地图不可用' : '高德地图加载失败，请检查网络'}</span>
        ${err.message === 'NO_KEY' ? '<button class="btn sm primary" data-act="goset">去「系统设置」填写</button>' : ''}
      </div>`;
    panel.querySelector('[data-act="goset"]')?.addEventListener('click', () => { location.hash = '#/mine'; });
  }
}

async function geocode(name) {
  return geocodeName(name);
}

async function locateItem(itemId) {
  const it = findItem(itemId);
  if (!it) return;
  if (!mapRef) { toast('地图尚未加载', 'error'); return; }
  const pos = strToLoc(it.location);
  if (!pos) { toast('该条目没有坐标信息', 'error'); return; }
  const AMap = await loadAMap();
  catMarkers.forEach(m => m.setMap(null));
  catMarkers = [];
  if (markerRef) markerRef.setMap(null);
  markerRef = new AMap.Marker({ position: pos, title: it.name, map: mapRef });
  mapRef.setZoomAndCenter(14, pos);
}

/** 点击一级分类：地图显示该分类下全部条目的大致位置 */
async function showCategoryOnMap(catId) {
  if (!mapRef) return;
  const AMap = await loadAMap();
  catMarkers.forEach(m => m.setMap(null));
  catMarkers = [];
  if (markerRef) { markerRef.setMap(null); markerRef = null; }
  let items = state.library.items.slice();
  if (catId === '__uncat') items = items.filter(i => !state.library.categories.some(c => c.id === i.categoryId));
  else if (catId !== '__all') items = items.filter(i => i.categoryId === catId);
  items.forEach(it => {
    const pos = strToLoc(it.location);
    if (pos) catMarkers.push(new AMap.Marker({ position: pos, title: it.name, map: mapRef }));
  });
  if (catMarkers.length) mapRef.setFitView();
}

async function redrawRoute() {
  if (!mapRef) return;
  polylines.forEach(p => p.setMap(null));
  polylines = [];
  const toggle = el.querySelector('[data-showroute]');
  if (!toggle || !toggle.checked) return;
  const b = book();
  const day = b.days.find(d => d.id === el._activeDayId);
  if (!day) return;
  const AMap = await loadAMap();
  const pts = await resolveChainPoints(b, day.id);
  const { lines } = await driveSegments(AMap, pts, { map: mapRef, color: '#2f6fed' });
  polylines = lines;
}

/* ---------------- 住宿选择弹窗（支持大类/标签/关键词筛选） ---------------- */

function stayModal(dayId) {
  const b = book();
  const hotelCatIds = state.library.categories.filter(c => c.name.includes('酒店') || c.name.includes('住宿')).map(c => c.id);
  const f = { categoryId: '__all', tagIds: [], kw: '' };
  const { mask, body, close } = openModal({ title: '选择今晚住宿', wide: true, content: `
    <div class="lib-toolbar">
      <select data-staycat style="border:1px solid var(--line-strong);border-radius:8px;padding:5px 8px;">
        <option value="__all">全部分类</option>
        ${state.library.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <input type="search" data-staykw placeholder="搜索全部信息库条目…" style="flex:1;min-width:140px;">
    </div>
    <div class="lib-toolbar" style="margin-top:6px;">
      <span style="color:var(--sub);font-size:12px;">标签:</span>
      <span data-staytags style="display:flex;gap:5px;flex-wrap:wrap;">
        ${state.library.tags.map(t => `<span class="chip" data-staytag="${t.id}">#${escapeHtml(t.name)}</span>`).join('')}
      </span>
    </div>
    <div data-staylist style="max-height:320px;overflow:auto;margin-top:10px;display:flex;flex-direction:column;gap:6px;"></div>`,
  });
  mask.querySelector('[data-act="ok"]').hidden = true;
  mask.querySelector('[data-act="cancel"]').textContent = '取消';

  function list() {
    let items = state.library.items.slice();
    if (f.categoryId !== '__all') items = items.filter(i => i.categoryId === f.categoryId);
    if (f.tagIds.length) items = items.filter(i => f.tagIds.some(t => i.tagIds.includes(t)));
    if (f.kw) items = items.filter(i => i.name.includes(f.kw));
    const noFilter = f.categoryId === '__all' && !f.tagIds.length && !f.kw;
    if (noFilter) {
      items.sort((x, y) => {
        const hx = hotelCatIds.includes(x.categoryId) ? 0 : 1;
        const hy = hotelCatIds.includes(y.categoryId) ? 0 : 1;
        return hx - hy;
      });
    }
    body.querySelector('[data-staylist]').innerHTML = items.map(it => `
      <button class="btn" data-pickstay="${it.id}" style="justify-content:space-between;">
        <span>${escapeHtml(it.name)}</span>
        <span style="color:var(--sub);font-size:12px;">${escapeHtml(state.library.categories.find(c => c.id === it.categoryId)?.name || '未分类')}${it.tagIds.map(tid => {
          const t = state.library.tags.find(x => x.id === tid);
          return t ? ` #${escapeHtml(t.name)}` : '';
        }).join('')}</span>
      </button>`).join('') || '<p style="color:var(--sub);">没有匹配的条目</p>';
  }
  function renderTags() {
    body.querySelector('[data-staytags]').innerHTML = state.library.tags.map(t =>
      `<span class="chip ${f.tagIds.includes(t.id) ? 'active' : ''}" data-staytag="${t.id}">#${escapeHtml(t.name)}</span>`).join('');
  }
  list();
  body.querySelector('[data-staykw]').addEventListener('input', e => { f.kw = e.target.value.trim(); list(); });
  body.querySelector('[data-staycat]').addEventListener('change', e => { f.categoryId = e.target.value; list(); });
  body.querySelector('[data-staytags]').addEventListener('click', e => {
    const chip = e.target.closest('[data-staytag]');
    if (!chip) return;
    const id = chip.dataset.staytag;
    f.tagIds = f.tagIds.includes(id) ? f.tagIds.filter(x => x !== id) : [...f.tagIds, id];
    renderTags();
    list();
  });
  body.querySelector('[data-staylist]').addEventListener('click', e => {
    const btn = e.target.closest('[data-pickstay]');
    if (!btn) return;
    setStay(b, dayId, btn.dataset.pickstay);
    toast('今晚住宿已设置，将作为明天出发地');
    close();
    renderLeft();
    redrawRoute();
  });
}

/* ---------------- 优化当天顺序 ---------------- */

async function optimizeDay(dayId) {
  const b = book();
  const day = b.days.find(d => d.id === dayId);
  if (!day) return;
  const withLoc = [], withoutLoc = [];
  day.stopItemIds.forEach(id => {
    const it = findItem(id);
    const loc = it && strToLoc(it.location);
    if (loc) withLoc.push({ id, location: loc });
    else withoutLoc.push(id);
  });
  if (withLoc.length <= 2) { toast('地点太少或缺少坐标，无需优化', 'ok'); return; }
  const anchor = dayStartAnchor(b, dayId);
  let start = null;
  if (anchor?.type === 'item') start = strToLoc(findItem(anchor.id)?.location);
  else if (anchor?.type === 'origin') {
    start = b.origin?.location ? strToLoc(b.origin.location) : await geocode(b.origin?.name);
  }
  let end = day.stayItemId ? strToLoc(findItem(day.stayItemId)?.location) : null;
  if (!end) {
    const isLast = b.days[b.days.length - 1]?.id === dayId;
    if (isLast && b.destination?.name) {
      end = b.destination?.location ? strToLoc(b.destination.location) : await geocode(b.destination.name);
    }
  }
  const newOrder = optimizeOrder(withLoc, start, end);
  day.stopItemIds = [...newOrder, ...withoutLoc];
  toast('已优化顺序，可继续手动微调');
  renderLeft();
  redrawRoute();
}

/* ---------------- 渲染与事件 ---------------- */

export async function render(container) {
  el = container;
  const b = book();
  if (!b) {
    el.innerHTML = `
      <div data-page="planner" style="padding: 40px 20px; display: flex; justify-content: center; align-items: center; min-height: 60vh;">
        <div class="empty-state" style="max-width: 440px; text-align: center; background: var(--card, #fff); padding: 36px 28px; border-radius: 16px; border: 1px solid var(--line, #e2e8f0); box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
          <div class="big" style="font-size: 52px; margin-bottom: 12px;">🗺️</div>
          <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 8px; color: var(--txt, #1e293b);">还没有创建路书</h3>
          <p style="color: var(--sub, #64748b); font-size: 13.5px; line-height: 1.6; margin-bottom: 24px;">
            规划路线需要先有一本路书。您可以立即创建第一份专属行程规划！
          </p>
          <button class="btn primary lg" data-act="create-first-book" style="padding: 10px 24px; font-size: 14px;">＋ 新建第一份路书</button>
        </div>
      </div>`;
    el.querySelector('[data-act="create-first-book"]')?.addEventListener('click', async () => {
      const { newBookDialog } = await import('./mybooks.js');
      const newBook = await newBookDialog();
      if (newBook) {
        state.ui.lastBookId = newBook.id;
        render(container);
      }
    });
    return;
  }
  el._activeDayId = el._activeDayId && b.days.some(d => d.id === el._activeDayId)
    ? el._activeDayId
    : (b.days[0]?.id || null);
  el.innerHTML = `
    <div data-page="planner" class="planner-layout">
      <div class="panel planner-left" data-left></div>
      <div class="planner-right">
        <div class="panel lib-callout">
          <div data-calloutbar></div>
          <div class="rows" data-librows></div>
        </div>
        <div class="panel planner-map-panel">
          <div class="map-switch"><label><input type="checkbox" data-showroute> 显示当天连线</label></div>
          <div id="mapPlanner"></div>
        </div>
      </div>
    </div>`;
  renderLeft();
  renderCallout();
  bindCalloutSortable();
  initMap();

  const root = el.querySelector('[data-page="planner"]'); // 每次渲染的新根节点：监听不跨页叠加
  root.addEventListener('click', async e => {
      const b = book();
      const dateBtn = e.target.closest('[data-datebtn]');
      if (dateBtn) { openDatePicker(dateBtn, dateBtn.dataset.datebtn); return; }
      if (e.target.closest('[data-act="addday"]')) {
        const d = addDay(b);
        el._activeDayId = d.id;
        renderLeft();
        toast(`已添加 D${b.days.length}${d.date ? `（${d.date}）` : ''}`);
        return;
      }
      const daydel = e.target.closest('[data-daydel]');
      if (daydel) {
        const label = dayLabel(b, daydel.dataset.daydel);
        const ok = await confirmDialog({
          title: '删除这一天',
          message: `确定删除<strong> ${label} </strong>？该天全部条目安排将一并移除（信息库不受影响）。`,
          okText: '删除', danger: true,
        });
        if (ok) {
          removeDayById(b, daydel.dataset.daydel);
          if (el._activeDayId && !b.days.some(d => d.id === el._activeDayId)) el._activeDayId = b.days[0]?.id || null;
          renderLeft();
          renderCalloutRows();
        }
        return;
      }
      const stopdel = e.target.closest('[data-stopdel]');
      if (stopdel) {
        const [dayId, itemId] = stopdel.dataset.stopdel.split('|');
        removeStopById(b, dayId, itemId);
        renderLeft();
        renderCalloutRows();
        redrawRoute();
        return;
      }
      const stayset = e.target.closest('[data-stayset]');
      if (stayset) { stayModal(stayset.dataset.stayset); return; }
      const stayclear = e.target.closest('[data-stayclear]');
      if (stayclear) { clearStay(b, stayclear.dataset.stayclear); renderLeft(); renderCalloutRows(); redrawRoute(); return; }
      const plus = e.target.closest('[data-addplus]');
      if (plus) {
        if (!el._activeDayId) { toast('请先在左侧点击选中某一天', 'error'); return; }
        insertStop(b, el._activeDayId, plus.dataset.addplus);
        renderLeft();
        renderCalloutRows();
        redrawRoute();
        return;
      }
      const locate = e.target.closest('[data-locate]');
      if (locate) { locateItem(locate.dataset.locate); return; }
      const opt = e.target.closest('[data-opt]');
      if (opt) { optimizeDay(opt.dataset.opt); return; }
      const libcat = e.target.closest('[data-libcat]');
      if (libcat) {
        calloutFilter().categoryId = libcat.dataset.libcat;
        renderCalloutToolbar();
        renderCalloutRows();
        showCategoryOnMap(libcat.dataset.libcat);
        return;
      }
      const libtag = e.target.closest('[data-libtag]');
      if (libtag) {
        const cf = calloutFilter();
        const id = libtag.dataset.libtag;
        cf.tagIds = cf.tagIds.includes(id) ? cf.tagIds.filter(x => x !== id) : [...cf.tagIds, id];
        renderCalloutToolbar();
        renderCalloutRows();
        return;
      }
      const dayCard = e.target.closest('[data-day]');
      if (dayCard && !e.target.closest('input,select,button,[data-locate],[data-stopdel],[data-opt],[data-daydel],[data-stayset],[data-stayclear],[data-addplus],[data-datebtn]')) {
        el._activeDayId = dayCard.dataset.day;
        renderLeft();
        redrawRoute();
      }
    });
    root.addEventListener('input', e => {
      if (e.target.matches('[data-libkw]')) {
        const kw = e.target.value.trim();
        debounce(() => { calloutFilter().kw = kw; renderCalloutRows(); }, 250)();
      }
    });
    root.addEventListener('change', e => {
      const b = book();
      if (e.target.matches('[data-bookname]')) {
        const v = e.target.value.trim();
        if (v && v !== b.name) {
          if (state.books.some(other => other.id !== b.id && other.name === v)) {
            toast(`已存在同名路书《${v}》，请使用其他名称`, 'error');
            e.target.value = b.name;
          } else {
            renameBook(b, v);
            toast('已重命名');
          }
        }
        renderLeft();
      } else if (e.target.matches('[data-showroute]')) {
        redrawRoute();
      }
    });
}

/* 测试钩子：把 Sortable 回调走的同一套模型逻辑暴露出来 */
export function __testHooks(container) {
  return {
    onAddToDay: (dayId, itemId, index) => {
      const ok = insertStop(book(), dayId, itemId, index);
      renderLeft();
      return ok;
    },
    onReorder: (dayId, itemId, newIndex) => {
      moveStop(book(), dayId, dayId, itemId, newIndex);
      renderLeft();
    },
    onMoveAcross: (fromDayId, toDayId, itemId, toIndex) => {
      moveStop(book(), fromDayId, toDayId, itemId, toIndex);
      renderLeft();
    },
  };
}
