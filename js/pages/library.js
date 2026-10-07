/** 信息库：大类/标签管理 + 条目卡片（编辑/地图/删除/筛选） */

import { state, UNCAT } from '../core/state.js';
import {
  addCategory, renameCategory, deleteCategory, reorderCategory,
  addTag, renameTag, deleteTag, ensureTag,
  updateItem, filterItems, scanItemReferences, removeItemEverywhere,
} from '../core/libraryOps.js';
import { formModal, confirmDialog, openModal } from '../core/modal.js';
import { toast } from '../core/toast.js';
import { loadAMap } from '../core/amap.js';
import { escapeHtml, debounce, strToLoc, relTime } from '../core/utils.js';

let el = null;
let f = { categoryId: '__all', tagIds: [], kw: '', sort: 'time' };

function catName(id) {
  return state.library.categories.find(c => c.id === id)?.name || '未分类';
}

function renderSide() {
  const side = el.querySelector('[data-side]');
  const items = state.library.items;
  const cnt = pred => items.filter(pred).length;
  const uncatCnt = cnt(i => !state.library.categories.some(c => c.id === i.categoryId));
  side.innerHTML = `
    <button class="lib-cat ${f.categoryId === '__all' ? 'active' : ''}" data-cat="__all">
      <span class="cat-name">全部</span>
      <span class="cat-right"><span class="cnt">${items.length}</span></span>
    </button>
    ${uncatCnt
      ? `<button class="lib-cat ${f.categoryId === '__uncat' ? 'active' : ''}" data-cat="__uncat">
          <span class="cat-name">未分类</span>
          <span class="cat-right"><span class="cnt">${uncatCnt}</span></span>
        </button>`
      : ''}
    <div data-catsort>
      ${state.library.categories.map(c => `
        <button class="lib-cat lib-cat-sort ${f.categoryId === c.id ? 'active' : ''}" data-cat="${c.id}">
          <span class="cat-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
          <span class="cat-right">
            <span class="cnt">${cnt(i => i.categoryId === c.id)}</span>
            <span class="ops">
              <span class="icon-btn sm" data-cat-edit="${c.id}" title="重命名">✎</span>
              <span class="icon-btn sm" data-cat-del="${c.id}" title="删除">🗑</span>
            </span>
          </span>
        </button>`).join('')}
    </div>
    <button class="btn ghost sm" data-act="newcat" style="margin-top:8px;justify-content:flex-start;">＋ 新建大类</button>`;
  bindCatSortable(side.querySelector('[data-catsort]'));
}

/** 一级分类长按拖动排序（长按200ms进入拖动，短按仍是点选筛选） */
let catSortable = null;
function bindCatSortable(box) {
  if (catSortable) { try { catSortable.destroy(); } catch { /* 忽略 */ } catSortable = null; }
  if (!box) return;
  catSortable = Sortable.create(box, {
    draggable: '.lib-cat-sort',
    delay: 200,
    animation: 150,
    onEnd: evt => {
      const { oldIndex, newIndex } = evt;
      if (oldIndex !== newIndex && typeof oldIndex === 'number' && typeof newIndex === 'number') {
        reorderCategory(state.library, oldIndex, newIndex);
      }
      renderAll();
    },
  });
}

function renderTags() {
  const box = el.querySelector('[data-tagfilter]');
  box.innerHTML = state.library.tags.map(t => `
    <span class="chip ${f.tagIds.includes(t.id) ? 'active' : ''}" data-tagtoggle="${t.id}">${escapeHtml(t.name)}
      <span class="x" data-tagdel="${t.id}" title="删除标签">×</span></span>`).join('');
}

function renderItems() {
  const grid = el.querySelector('[data-items]');
  const arr = filterItems(state.library, f);
  grid.dataset.shown = arr.length;
  if (!arr.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <p>${state.library.items.length ? '当前筛选条件下没有条目' : '信息库还是空的，去「地图选点」收集第一个地点吧'}</p>
      <a class="btn primary" href="#/picker">去地图选点</a></div>`;
    return;
  }
  grid.innerHTML = arr.map(i => `
    <div class="card item-card" data-item="${i.id}">
      <div class="ops">
        <span class="icon-btn sm" data-item-edit="${i.id}" title="编辑">✎</span>
        <span class="icon-btn sm" data-item-map="${i.id}" title="在地图查看">🗺</span>
        <span class="icon-btn sm" data-item-del="${i.id}" title="删除">🗑</span>
      </div>
      <h4>${escapeHtml(i.name)}</h4>
      <div class="addr">${escapeHtml(i.address || '')}${i.note ? ` · ${escapeHtml(i.note)}` : ''}</div>
      <div class="chips">
        <span class="chip" style="background:var(--pri-weak);color:var(--pri-dark);">${escapeHtml(catName(i.categoryId))}</span>
        ${i.tagIds.map(tid => {
          const t = state.library.tags.find(x => x.id === tid);
          return t ? `<span class="chip">#${escapeHtml(t.name)}</span>` : '';
        }).join('')}
        <span class="chip" style="margin-left:auto;">${relTime(i.createdAt)}</span>
      </div>
    </div>`).join('');
}

function renderAll() { renderSide(); renderTags(); renderItems(); }

async function editItemDialog(itemId) {
  const item = state.library.items.find(i => i.id === itemId);
  if (!item) return;
  const catOptions = state.library.categories.map(c => ({ value: c.id, label: c.name }));
  catOptions.push({ value: '__uncat', label: '未分类' });
  const values = await formModal({
    title: '编辑条目',
    fields: [
      { key: 'name', label: '名称', type: 'text', required: true, value: item.name },
      { key: 'categoryId', label: '一级大类', type: 'select', options: catOptions, value: item.categoryId },
      { key: 'tagIds', label: '二级标签（可多选，回车新建）', type: 'tagsel', options: state.library.tags.map(t => ({ value: t.id, label: t.name })), value: item.tagIds },
      { key: 'note', label: '备注', type: 'textarea', value: item.note || '' },
    ],
    okText: '保存',
  });
  if (!values) return;
  updateItem(state.library, itemId, {
    name: values.name,
    categoryId: values.categoryId === '__uncat' ? '__uncat' : values.categoryId,
    // 已有标签返回的是id，tagsel里新建的是名称
    tagIds: values.tagIds.map(v => state.library.tags.some(t => t.id === v) ? v : ensureTag(state.library, v)),
    note: values.note,
  });
  toast('已保存');
  renderAll();
}

async function deleteItemDialog(itemId) {
  const item = state.library.items.find(i => i.id === itemId);
  if (!item) return;
  const refs = scanItemReferences(itemId);
  const refText = refs.length
    ? `<br>该地点正被以下行程使用，删除后将从行程中一并移除：<br>` +
      refs.map(r => `· 《${escapeHtml(r.bookName)}》${escapeHtml(r.dayLabel)}（${r.kind}）`).join('<br>')
    : '<br>该地点未被任何路书使用。';
  const ok = await confirmDialog({
    title: '删除条目',
    message: `确定从信息库删除<strong>「${escapeHtml(item.name)}」</strong>？${refText}`,
    okText: '删除', danger: true,
  });
  if (!ok) return;
  removeItemEverywhere(itemId);
  toast('已删除');
  renderAll();
}

async function itemMapDialog(itemId) {
  const item = state.library.items.find(i => i.id === itemId);
  if (!item) return;
  const { mask, body, close } = openModal({ title: item.name, content: `<div id="mapMini" style="height:320px;border-radius:8px;"></div>` });
  mask.querySelector('[data-act="ok"]').hidden = true;
  try {
    const AMap = await loadAMap();
    const pos = strToLoc(item.location) || [104.065, 30.657];
    const m = new AMap.Map(body.querySelector('#mapMini'), { zoom: 15, center: pos });
    new AMap.Marker({ position: pos, title: item.name, map: m });
  } catch (err) {
    body.innerHTML = `<p class="modal-msg">地图加载失败：${err.message === 'NO_KEY' ? '尚未配置高德Key' : '请检查网络'}</p>`;
  }
  mask.querySelector('[data-act="cancel"]').textContent = '关闭';
}

async function showHighlight() {
  const id = sessionStorage.getItem('lushu:highlightItem');
  if (!id) return;
  sessionStorage.removeItem('lushu:highlightItem');
  f.categoryId = '__all'; f.kw = ''; f.tagIds = [];
  el.querySelector('[data-kw]').value = '';
  renderAll();
  await new Promise(r => setTimeout(r, 50));
  const card = el.querySelector(`[data-item="${id}"]`);
  if (card) {
    card.classList.add('flash');
    card.scrollIntoView({ block: 'center' });
    setTimeout(() => card.classList.remove('flash'), 2400);
  }
}

export async function render(container) {
  el = container;
  f = { categoryId: '__all', tagIds: [], kw: '', sort: 'time' };
  el.innerHTML = `
    <div data-page="library" class="library-layout">
      <div class="panel library-side" data-side></div>
      <div class="panel library-main">
        <div class="lib-toolbar">
          <input type="search" data-kw placeholder="按名称搜索…">
          <span data-tagfilter style="display:flex;gap:5px;flex-wrap:wrap;"></span>
          <button class="btn sm ghost" data-act="newtag">＋ 标签</button>
          <span style="flex:1"></span>
          <select data-sort style="border:1px solid var(--line-strong);border-radius:8px;padding:5px 8px;">
            <option value="time">按加入时间</option>
            <option value="name">按名称</option>
          </select>
        </div>
        <div class="grid" data-items></div>
      </div>
    </div>`;
  renderAll();
  showHighlight();

  const root = el.querySelector('[data-page="library"]'); // 每次渲染的新根节点：监听不跨页叠加
  root.addEventListener('click', async e => {
      const catBtn = e.target.closest('[data-cat]');
      if (catBtn && !e.target.closest('[data-cat-edit], [data-cat-del]')) {
        f.categoryId = catBtn.dataset.cat;
        renderAll();
        return;
      }
      const catEdit = e.target.closest('[data-cat-edit]');
      if (catEdit) {
        const cat = state.library.categories.find(c => c.id === catEdit.dataset.catEdit);
        const v = await formModal({ title: '重命名大类', fields: [{ key: 'name', label: '新名称', type: 'text', required: true, value: cat.name, maxlength: 8, placeholder: '最多8个字' }] });
        if (v) { renameCategory(state.library, cat.id, v.name); renderAll(); }
        return;
      }
      const catDel = e.target.closest('[data-cat-del]');
      if (catDel) {
        const cat = state.library.categories.find(c => c.id === catDel.dataset.catDel);
        const n = state.library.items.filter(i => i.categoryId === cat.id).length;
        const ok = await confirmDialog({
          title: '删除大类',
          message: `确定删除大类<strong>「${escapeHtml(cat.name)}」</strong>？<br>其中 <strong>${n}</strong> 个条目会移入"未分类"，条目本身不会被删除。`,
          okText: '删除', danger: true,
        });
        if (ok) {
          deleteCategory(state.library, cat.id);
          if (f.categoryId === cat.id) f.categoryId = '__all';
          toast('大类已删除，条目移入未分类');
          renderAll();
        }
        return;
      }
      if (e.target.closest('[data-act="newcat"]')) {
        const v = await formModal({ title: '新建大类', fields: [{ key: 'name', label: '大类名称', type: 'text', required: true, maxlength: 8, placeholder: '如：美食、交通（最多8字）' }] });
        if (v) { const c = addCategory(state.library, v.name); f.categoryId = c.id; toast('大类已创建'); renderAll(); }
        return;
      }
      if (e.target.closest('[data-act="newtag"]')) {
        const v = await formModal({ title: '新建标签', fields: [{ key: 'name', label: '标签名称', type: 'text', required: true, maxlength: 10, placeholder: '如：川菜、人均100（最多10字）' }] });
        if (v) { addTag(state.library, v.name); toast('标签已创建'); renderTags(); }
        return;
      }
      const tagToggle = e.target.closest('[data-tagtoggle]');
      if (tagToggle && !e.target.closest('[data-tagdel]')) {
        const id = tagToggle.dataset.tagtoggle;
        f.tagIds = f.tagIds.includes(id) ? f.tagIds.filter(x => x !== id) : [...f.tagIds, id];
        renderTags(); renderItems();
        return;
      }
      const tagDel = e.target.closest('[data-tagdel]');
      if (tagDel) {
        const tag = state.library.tags.find(t => t.id === tagDel.dataset.tagdel);
        const ok = await confirmDialog({
          title: '删除标签',
          message: `确定删除标签<strong>「${escapeHtml(tag.name)}」</strong>？<br>只从条目上摘除该标签，条目本身保留。`,
          okText: '删除', danger: true,
        });
        if (ok) { deleteTag(state.library, tag.id); f.tagIds = f.tagIds.filter(x => x !== tag.id); toast('标签已删除'); renderAll(); }
        return;
      }
      const itemEdit = e.target.closest('[data-item-edit]');
      if (itemEdit) { await editItemDialog(itemEdit.dataset.itemEdit); return; }
      const itemMap = e.target.closest('[data-item-map]');
      if (itemMap) { await itemMapDialog(itemMap.dataset.itemMap); return; }
      const itemDel = e.target.closest('[data-item-del]');
      if (itemDel) { await deleteItemDialog(itemDel.dataset.itemDel); return; }
    });
    root.addEventListener('input', e => {
      if (e.target.matches('[data-kw]')) {
        debounce(() => { f.kw = e.target.value.trim(); renderItems(); }, 250)();
      }
    });
    root.addEventListener('change', e => {
      if (e.target.matches('[data-sort]')) { f.sort = e.target.value; renderItems(); }
    });
}
