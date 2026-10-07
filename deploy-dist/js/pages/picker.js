/** 地图选点：搜索 → 详情 → 归类入库 */

import { state } from '../core/state.js';
import { loadAMap, centerOnCurrentLocation } from '../core/amap.js';
import { findExistingItem, addItemToLibrary, removeItemEverywhere } from '../core/libraryOps.js';
import { formModal } from '../core/modal.js';
import { toast } from '../core/toast.js';
import { normPos, debounce, escapeHtml, locToStr } from '../core/utils.js';

let sessionAdded = [];   // 本次会话已入库条目id
let lastCategoryId = ''; // 上一次入库选择的分类（默认给下一次用）
let mapRef = null;
let markerRef = null;
let infoWindowRef = null;
let boundEl = null;

function renderCands(el, tips) {
  const box = el.querySelector('[data-cands]');
  if (!tips) { box.innerHTML = ''; return; }
  if (!tips.length) {
    box.innerHTML = `<div style="color:var(--sub);padding:10px;">没有匹配的地点，换个关键词试试</div>`;
    return;
  }
  box.innerHTML = tips.map((t, i) => {
    const pos = normPos(t.location);
    const existing = findExistingItem(state.library, { amapPoiId: t.id, name: t.name, location: pos });
    const btnHtml = existing
      ? `<button type="button" class="btn sm cand-fav-btn is-collected" data-act="view-item" data-id="${existing.id}" title="已在收藏库中，点击查看">✓ 已收藏</button>`
      : `<button type="button" class="btn sm primary cand-fav-btn" data-act="quick-fav" data-tip-idx="${i}" title="加入收藏">加入收藏</button>`;

    return `
      <div class="cand-item" data-tip="${i}">
        <div class="cand-info">
          <div class="nm" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>
          <div class="ad" title="${escapeHtml([t.district, t.address].filter(Boolean).join(' · '))}">${escapeHtml([t.district, t.address].filter(Boolean).join(' · '))}</div>
        </div>
        ${btnHtml}
      </div>`;
  }).join('');
  box.dataset.count = tips.length;
}

async function showPoiAtPos(el, poiInfo) {
  const AMap = await loadAMap();
  const detail = el.querySelector('[data-detail]');
  let poi = { ...poiInfo };

  // 若提供了 POI 检索线索（名称或ID），尝试获取高德 PlaceSearch 完整详情（地址、电话、分类）
  if ((poi.name || poi.id) && (!poi.address || !poi.tel)) {
    try {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 800);
        const done = () => { clearTimeout(timer); resolve(); };
        const ps = new AMap.PlaceSearch({ city: el.querySelector('[data-city]')?.value.trim() || '全国' });
        const onRes = (status, result) => {
          if (status === 'complete' && result.poiList?.pois?.length) {
            const pois = result.poiList.pois;
            const match = pois.find(p => (poi.id && p.id === poi.id) || p.name === poi.name) || pois[0];
            if (match) {
              if (!poi.name && match.name) poi.name = match.name;
              if (!poi.address && match.address) poi.address = match.address;
              if (!poi.tel && match.tel) poi.tel = match.tel;
              if (!poi.type && match.type) poi.type = match.type;
              if (!poi.id && match.id) poi.id = match.id;
              if (!poi.location && match.location) poi.location = match.location;
            }
          }
          done();
        };
        if (poi.id && typeof ps.getDetails === 'function') {
          ps.getDetails(poi.id, onRes);
        } else {
          ps.search(poi.name || poi.id, onRes);
        }
      });
    } catch { /* 忽略检索异常 */ }
  }

  const pos = normPos(poi.location);
  if (!poi.address && pos) {
    poi.address = `经纬度: ${pos.join(', ')}`;
  }

  const existing = findExistingItem(state.library, { amapPoiId: poi.id, name: poi.name, location: pos });

  // 地图标记与平移
  if (mapRef && pos) {
    mapRef.setCenter(pos);
    if (markerRef) markerRef.setMap(null);
    markerRef = new AMap.Marker({ position: pos, title: poi.name, map: mapRef });

    // 在点位上方弹出信息窗体，内嵌“＋ 加入收藏”按钮
    if (window.AMap && window.AMap.InfoWindow) {
      if (infoWindowRef) infoWindowRef.close();
      infoWindowRef = new AMap.InfoWindow({
        offset: new AMap.Pixel(0, -32),
        content: `
          <div style="padding:6px 8px;min-width:180px;max-width:270px;line-height:1.4;">
            <div style="font-weight:600;font-size:13px;color:var(--txt,#1e293b);margin-bottom:3px;">${escapeHtml(poi.name)}</div>
            <div style="font-size:11.5px;color:var(--sub,#64748b);margin-bottom:8px;">${escapeHtml(poi.address || '地图选定位置')}</div>
            ${existing
              ? `<div style="font-size:12px;color:var(--ok,#10b981);font-weight:600;margin-bottom:6px;">✓ 已在收藏中（${escapeHtml(state.library.categories.find(c => c.id === existing.categoryId)?.name || '未分类')}）</div>
                 <button type="button" class="btn sm" data-act="view" style="width:100%;font-size:12px;padding:3px 0;">查看收藏</button>`
              : `<button type="button" class="btn sm primary" data-act="add" style="width:100%;font-size:12px;padding:3px 0;">＋ 加入收藏</button>`}
          </div>
        `,
      });
      infoWindowRef.open(mapRef, pos);
    }
  }

  // 右下角详情面板同步呈现
  detail.hidden = false;
  detail.dataset.poiId = poi.id || '';
  detail.dataset.name = poi.name;
  detail.dataset.address = poi.address || '';
  detail.dataset.tel = poi.tel || '';
  detail.dataset.type = poi.type || '';
  detail.dataset.location = pos ? locToStr(pos) : '';
  detail.dataset.existingId = existing?.id || '';
  detail.innerHTML = `
    <h4>${escapeHtml(poi.name)}</h4>
    <div class="addr">${escapeHtml(poi.address || '')}</div>
    ${poi.tel ? `<div class="addr">☎ ${escapeHtml(poi.tel)}</div>` : ''}
    ${existing
      ? `<div class="addr" style="color:var(--ok);">✓ 已在收藏中（${escapeHtml(state.library.categories.find(c => c.id === existing.categoryId)?.name || '未分类')}）</div>
         <button class="btn" data-act="view">查看收藏</button>`
      : `<button class="btn primary" data-act="add">＋ 加入收藏</button>`}`;
}

async function showTipDetail(el, tip) {
  await showPoiAtPos(el, tip);
}

async function addToLibrary(el, detail) {
  const pos = detail.dataset.location;
  const catOptions = state.library.categories.map(c => ({ value: c.id, label: c.name }));
  if (!catOptions.length) catOptions.push({ value: '__uncat', label: '未分类' });
  // 默认选中上一次使用的分类（更顺手）
  const defaultCat = catOptions.some(o => o.value === lastCategoryId) ? lastCategoryId : catOptions[0].value;
  const values = await formModal({
    title: `归类入库：${detail.dataset.name}`,
    fields: [
      { key: 'categoryId', label: '一级大类', type: 'select', options: catOptions, required: true, value: defaultCat },
      { key: 'tagIds', label: '二级标签（可多选，回车新建）', type: 'tagsel', options: state.library.tags.map(t => ({ value: t.id, label: t.name })) },
      { key: 'note', label: '备注', type: 'textarea', placeholder: '如：人均80，需要排号' },
    ],
    okText: '确认入库',
  });
  if (!values) return;
  // tagsel 里新建的标签落入 state
  values.tagIds.forEach(tid => {
    if (!state.library.tags.some(t => t.id === tid)) {
      state.library.tags.push({ id: tid, name: tid });
    }
  });
  const item = addItemToLibrary(state.library, {
    name: detail.dataset.name,
    address: detail.dataset.address,
    location: pos,
    amapPoiId: detail.dataset.poiId,
    tel: detail.dataset.tel,
    type: detail.dataset.type,
    categoryId: values.categoryId,
    tagIds: values.tagIds,
    note: values.note,
  });
  sessionAdded.push(item.id);
  lastCategoryId = values.categoryId;
  renderSession(el);
  toast(`已加入收藏：${item.name}`);
  showTipDetailRefresh(el, detail);
  if (el._tips) renderCands(el, el._tips);
}

async function showTipDetailRefresh(el, detail) {
  // 重新判断已入库状态
  const pos = detail.dataset.location ? detail.dataset.location.split(',').map(Number) : null;
  const existing = findExistingItem(state.library, {
    amapPoiId: detail.dataset.poiId, name: detail.dataset.name, location: pos,
  });
  detail.dataset.existingId = existing?.id || '';
  detail.innerHTML = `
    <h4>${escapeHtml(detail.dataset.name)}</h4>
    <div class="addr">${escapeHtml(detail.dataset.address)}</div>
    ${existing
      ? `<div class="addr" style="color:var(--ok);">✓ 已在收藏中（${escapeHtml(state.library.categories.find(c => c.id === existing.categoryId)?.name || '未分类')}）</div><button class="btn" data-act="view">查看收藏</button>`
      : `<button class="btn primary" data-act="add">＋ 加入收藏</button>`}`;

  if (infoWindowRef && typeof infoWindowRef.setContent === 'function') {
    infoWindowRef.setContent(`
      <div style="padding:6px 8px;min-width:180px;max-width:270px;line-height:1.4;">
        <div style="font-weight:600;font-size:13px;color:var(--txt,#1e293b);margin-bottom:3px;">${escapeHtml(detail.dataset.name)}</div>
        <div style="font-size:11.5px;color:var(--sub,#64748b);margin-bottom:8px;">${escapeHtml(detail.dataset.address || '地图选定位置')}</div>
        ${existing
          ? `<div style="font-size:12px;color:var(--ok,#10b981);font-weight:600;margin-bottom:6px;">✓ 已在收藏中（${escapeHtml(state.library.categories.find(c => c.id === existing.categoryId)?.name || '未分类')}）</div>
             <button type="button" class="btn sm" data-act="view" style="width:100%;font-size:12px;padding:3px 0;">查看收藏</button>`
          : `<button type="button" class="btn sm primary" data-act="add" style="width:100%;font-size:12px;padding:3px 0;">＋ 加入收藏</button>`}
      </div>
    `);
  }
}

function renderSession(el) {
  const box = el.querySelector('[data-session]');
  if (!sessionAdded.length) { box.innerHTML = ''; return; }
  // 只展示最近5条（PRD二轮反馈2）
  box.innerHTML = `<strong>本次已入库（${sessionAdded.length}，最近5条）</strong>
    <ul style="list-style:none;margin-top:4px;">
      ${sessionAdded.slice(-5).reverse().map(id => {
        const it = state.library.items.find(i => i.id === id);
        if (!it) return '';
        return `<li data-session-item="${id}">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(it.name)}</span>
          <button class="btn sm ghost" data-undo="${id}">撤销</button>
        </li>`;
      }).join('')}
    </ul>`;
}

export async function render(el) {
  boundEl = el;
  sessionAdded = [];
  el.innerHTML = `
    <div data-page="picker">
    <div class="picker-layout">
      <div class="panel picker-left">
        <div class="field"><label>搜索范围（可选城市，留空为全国）</label>
          <input type="text" data-city placeholder="如：成都"></div>
        <div class="field"><label>地点搜索（至少3个字）</label>
          <input type="search" data-kw placeholder="输入店名、景点名…" autocomplete="off"></div>
        <div data-amap-status></div>
        <div class="cand-list" data-cands></div>
        <div class="session-list" data-session></div>
      </div>
      <div class="panel picker-map">
        <div id="mapPicker"></div>
        <div class="poi-detail" data-detail hidden></div>
      </div>
    </div>
    </div>`;

  // 高德加载（测试环境用Mock）
  const statusBox = el.querySelector('[data-amap-status]');
  let AMap;
  try {
    AMap = await loadAMap();
  } catch (err) {
    if (err.message === 'NO_KEY') {
      statusBox.innerHTML = `<div class="banner"><span>还没有配置高德Key，无法搜索地图</span><button class="btn sm primary" data-act="goset">去「我的」填写</button></div>`;
      statusBox.querySelector('[data-act="goset"]').addEventListener('click', () => { location.hash = '#/mine'; });
    } else {
      statusBox.innerHTML = `<div class="banner error"><span>高德地图加载失败，请检查网络后刷新重试</span></div>`;
    }
    return;
  }

  if (mapRef) { try { mapRef.destroy(); } catch { /* 忽略 */ } }
  const defaultCenter = normPos(state.library?.items?.slice(-1)[0]?.location) || [104.065, 30.657];
  mapRef = new AMap.Map(el.querySelector('#mapPicker'), {
    zoom: 12,
    center: defaultCenter,
    isHotspot: true,
  });
  markerRef = null;
  // 默认定位到当前位置（高精度优先，失败自动降级到IP/已存位置）
  centerOnCurrentLocation(mapRef, 12);

  let lastHotspotTs = 0;

  // 1. 底图 POI 热点点击（点击高德地图自带的餐饮、商铺、景点等图标与文字）
  mapRef.on('hotspotclick', async hotspot => {
    lastHotspotTs = Date.now();
    const pos = normPos(hotspot.lnglat);
    if (!pos) return;
    await showPoiAtPos(el, {
      id: hotspot.id,
      name: hotspot.name,
      location: pos,
    });
  });

  // 2. 地图任意点击与逆地理编码
  mapRef.on('click', async e => {
    if (Date.now() - lastHotspotTs < 400) return; // 避免 hotspotclick 重复触发
    const pos = normPos(e.lnglat);
    if (!pos) return;

    try {
      const geocoder = new AMap.Geocoder({ extensions: 'all', radius: 100 });
      geocoder.getAddress(pos, async (status, result) => {
        if (Date.now() - lastHotspotTs < 400) return;
        if (status === 'complete' && result?.regeocode) {
          const rg = result.regeocode;
          const pois = rg.pois || [];
          // 如果点击附近有具体 POI（100米内），优先采用具体 POI 信息
          const nearestPoi = (pois.length > 0 && pois[0]) ? pois[0] : null;
          if (nearestPoi && nearestPoi.name) {
            await showPoiAtPos(el, {
              id: nearestPoi.id,
              name: nearestPoi.name,
              address: nearestPoi.address || rg.formattedAddress,
              tel: nearestPoi.tel,
              type: nearestPoi.type,
              location: normPos(nearestPoi.location) || pos,
            });
          } else {
            // 点击位置没有具体店铺/建筑POI，以格式化街道地址作为名称
            const name = (rg.aois && rg.aois[0]?.name) || rg.formattedAddress || '地图标记点';
            await showPoiAtPos(el, {
              name,
              address: rg.formattedAddress || `经纬度: ${pos.join(', ')}`,
              location: pos,
            });
          }
        } else {
          await showPoiAtPos(el, {
            name: '地图选定位置',
            address: `经纬度: ${pos.join(', ')}`,
            location: pos,
          });
        }
      });
    } catch {
      await showPoiAtPos(el, {
        name: '地图选定位置',
        address: `经纬度: ${pos.join(', ')}`,
        location: pos,
      });
    }
  });

  // 监听地图内的气泡点击（捕获阶段，确保即使高德内部阻止冒泡也能执行）
  const mapPickerEl = el.querySelector('#mapPicker');
  if (mapPickerEl) {
    mapPickerEl.addEventListener('click', async e => {
      const addBtn = e.target.closest('[data-act="add"]');
      if (addBtn) {
        e.stopPropagation();
        const detail = el.querySelector('[data-detail]');
        if (detail) await addToLibrary(el, detail);
        return;
      }
      const viewBtn = e.target.closest('[data-act="view"]');
      if (viewBtn) {
        e.stopPropagation();
        const id = el.querySelector('[data-detail]')?.dataset.existingId;
        if (id) {
          sessionStorage.setItem('lushu:highlightItem', id);
          location.hash = '#/library';
        }
      }
    }, true);
  }

  const kwInput = el.querySelector('[data-kw]');
  const cityInput = el.querySelector('[data-city]');
  const ac = new AMap.AutoComplete({});
  const doSearch = debounce(() => {
    const kw = el.querySelector('[data-kw]').value.trim();
    if (kw.length < 3) { renderCands(el, null); return; }
    const acInst = el._ac || ac;
    acInst.search(kw, (status, result) => {
      const tips = status === 'complete' ? (result?.tips || []).filter(t => t.location) : [];
      renderCands(el, tips);
      el._tips = tips;
    });
  }, 300);
  el._doSearch = doSearch;
  const root = el.querySelector('[data-page="picker"]'); // 每次渲染的新根节点：监听随之重建，不跨页叠加
  root.addEventListener('input', e => {
      const kw = el.querySelector('[data-kw]'), city = el.querySelector('[data-city]');
      if (e.target === kw || e.target === city) el._doSearch();
    });
    root.addEventListener('click', async e => {
      // 1. 右侧快捷“加入收藏”按钮
      const quickFavBtn = e.target.closest('[data-act="quick-fav"]');
      if (quickFavBtn) {
        e.stopPropagation();
        const idx = Number(quickFavBtn.dataset.tipIdx);
        const tip = el._tips?.[idx];
        if (!tip) return;
        const cand = quickFavBtn.closest('.cand-item');
        if (cand) {
          [...el.querySelectorAll('.cand-item')].forEach(c => c.classList.toggle('sel', c === cand));
        }
        await showTipDetail(el, tip);
        const detail = el.querySelector('[data-detail]');
        if (detail) {
          await addToLibrary(el, detail);
          if (el._tips) renderCands(el, el._tips);
        }
        return;
      }

      // 2. 右侧“已收藏”按钮：点击直接在收藏库高亮展示
      const viewItemBtn = e.target.closest('[data-act="view-item"]');
      if (viewItemBtn) {
        e.stopPropagation();
        const id = viewItemBtn.dataset.id;
        if (id) {
          sessionStorage.setItem('lushu:highlightItem', id);
          location.hash = '#/library';
        }
        return;
      }

      // 3. 点击整行条目（非按钮）：在右侧地图聚焦展示
      const cand = e.target.closest('[data-tip]');
      if (cand) {
        [...el.querySelectorAll('.cand-item')].forEach(c => c.classList.toggle('sel', c === cand));
        await showTipDetail(el, el._tips[Number(cand.dataset.tip)]);
        return;
      }
      const addBtn = e.target.closest('[data-act="add"]');
      if (addBtn) { await addToLibrary(el, el.querySelector('[data-detail]')); return; }
      const viewBtn = e.target.closest('[data-act="view"]');
      if (viewBtn) {
        const id = el.querySelector('[data-detail]').dataset.existingId;
        if (id) {
          sessionStorage.setItem('lushu:highlightItem', id);
          location.hash = '#/library';
        }
        return;
      }
      const undoBtn = e.target.closest('[data-undo]');
      if (undoBtn) {
        const id = undoBtn.dataset.undo;
        removeItemEverywhere(id);
        sessionAdded = sessionAdded.filter(x => x !== id);
        renderSession(el);
        if (el._tips) renderCands(el, el._tips);
        const detail = el.querySelector('[data-detail]');
        if (detail) showTipDetailRefresh(el, detail);
        toast('已撤销收藏', 'ok');
      }
    });
  void boundEl;
}
