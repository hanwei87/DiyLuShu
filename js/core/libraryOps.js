/** 信息库操作：条目增删、判重、级联移除（大类/标签管理在 M4 扩展） */

import { state } from './state.js';
import { uid } from './utils.js';
import { markDirty } from './persist.js';

function roundKey(loc) {
  return `${Number(loc[0]).toFixed(4)},${Number(loc[1]).toFixed(4)}`;
}

/** 判重：优先 amapPoiId，其次 名称+四舍五入坐标（PRD §5③） */
export function findExistingItem(library, poi) {
  if (poi.amapPoiId) {
    const byId = library.items.find(i => i.amapPoiId && i.amapPoiId === poi.amapPoiId);
    if (byId) return byId;
  }
  if (poi.name && poi.location) {
    const key = roundKey(poi.location);
    return library.items.find(i => {
      if (i.name !== poi.name || !i.location) return false;
      const [, lat] = String(i.location).split(',').map(Number);
      const [lng] = String(i.location).split(',').map(Number);
      return roundKey([lng, lat]) === key;
    }) || null;
  }
  return null;
}

export function addItemToLibrary(library, data) {
  const item = {
    id: uid('i'),
    name: data.name,
    categoryId: data.categoryId || '__uncat',
    tagIds: Array.isArray(data.tagIds) ? data.tagIds.slice() : [],
    address: data.address || '',
    location: data.location || '',
    amapPoiId: data.amapPoiId || '',
    tel: data.tel || '',
    type: data.type || '',
    note: data.note || '',
    createdAt: data.createdAt || Date.now(),
  };
  library.items.push(item);
  markDirty('library');
  return item;
}

/** 扫描某条目在所有路书中的引用位置（不修改数据） */
export function scanItemReferences(itemId) {
  const refs = [];
  for (const b of state.books) {
    b.days.forEach((d, di) => {
      if (d.stopItemIds.includes(itemId)) {
        refs.push({ bookId: b.id, bookName: b.name, dayId: d.id, dayLabel: `D${di + 1}`, kind: '行程条目' });
      }
      if (d.stayItemId === itemId) {
        refs.push({ bookId: b.id, bookName: b.name, dayId: d.id, dayLabel: `D${di + 1}`, kind: '当晚住宿' });
      }
    });
  }
  return refs;
}

/** 从库中删除条目，并级联移除所有路书里的引用；返回受影响位置列表 */
export function removeItemEverywhere(itemId) {
  const affected = scanItemReferences(itemId);
  for (const b of state.books) {
    let changed = false;
    for (const d of b.days) {
      if (d.stopItemIds.includes(itemId)) {
        d.stopItemIds = d.stopItemIds.filter(id => id !== itemId);
        changed = true;
      }
      if (d.stayItemId === itemId) {
        d.stayItemId = null;
        changed = true;
      }
    }
    if (changed) {
      markDirty(`book:${b.id}`);
    }
  }
  state.library.items = state.library.items.filter(i => i.id !== itemId);
  markDirty('library');
  return affected;
}

/* ---------- 大类管理 ---------- */

export function addCategory(library, name) {
  const cat = { id: uid('c'), name: name.trim(), order: library.categories.length + 1 };
  library.categories.push(cat);
  markDirty('library');
  return cat;
}

export function renameCategory(library, id, name) {
  const cat = library.categories.find(c => c.id === id);
  if (cat && name.trim()) { cat.name = name.trim(); markDirty('library'); }
  return cat;
}

/** 手动调整大类顺序：把 from 位的大类移到 to 位（拖拽排序用） */
export function reorderCategory(library, from, to) {
  if (from === to || from < 0 || to < 0 || from >= library.categories.length || to >= library.categories.length) return false;
  const [cat] = library.categories.splice(from, 1);
  library.categories.splice(to, 0, cat);
  library.categories.forEach((c, i) => { c.order = i + 1; });
  markDirty('library');
  return true;
}

/** 测试钩子：模拟拖拽排序回调 */
export function __reorderHook(library, from, to) {
  return reorderCategory(library, from, to);
}

/** 删除大类：其下条目移入"未分类"，不删除条目（PRD FR-3.1） */
export function deleteCategory(library, id) {
  library.categories = library.categories.filter(c => c.id !== id);
  library.items.forEach(i => { if (i.categoryId === id) i.categoryId = '__uncat'; });
  markDirty('library');
}

/* ---------- 标签管理 ---------- */

export function addTag(library, name) {
  const tag = { id: uid('t'), name: name.trim() };
  library.tags.push(tag);
  markDirty('library');
  return tag;
}

export function renameTag(library, id, name) {
  const tag = library.tags.find(t => t.id === id);
  if (tag && name.trim()) { tag.name = name.trim(); markDirty('library'); }
  return tag;
}

/** 删除标签：只从条目上摘除，不删条目（PRD FR-3.2） */
export function deleteTag(library, id) {
  library.tags = library.tags.filter(t => t.id !== id);
  library.items.forEach(i => { i.tagIds = i.tagIds.filter(t => t !== id); });
  markDirty('library');
}

/** 确保标签存在（tagsel里新建的标签），返回标签id */
export function ensureTag(library, name) {
  const nameTrim = String(name).trim();
  const existing = library.tags.find(t => t.name === nameTrim);
  if (existing) return existing.id;
  return addTag(library, nameTrim).id;
}

/* ---------- 条目编辑与筛选 ---------- */

export function updateItem(library, id, patch) {
  const item = library.items.find(i => i.id === id);
  if (!item) return null;
  Object.assign(item, patch);
  markDirty('library');
  return item;
}

/** 筛选：categoryId（'__all'/UNCAT/具体id）+ 标签多选（任一命中）+ 名称关键词 + 排序 */
export function filterItems(library, opts = {}) {
  const { categoryId = '__all', tagIds = [], kw = '', sort = 'time' } = opts;
  let arr = library.items.slice();
  if (categoryId === '__uncat') {
    arr = arr.filter(i => !library.categories.some(c => c.id === i.categoryId));
  } else if (categoryId !== '__all') {
    arr = arr.filter(i => i.categoryId === categoryId);
  }
  if (tagIds.length) arr = arr.filter(i => tagIds.some(t => i.tagIds.includes(t)));
  if (kw) arr = arr.filter(i => i.name.includes(kw));
  if (sort === 'name') arr.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  else arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return arr;
}
