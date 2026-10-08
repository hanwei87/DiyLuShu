/** 行程（天/条目/住宿锚点）操作：纯模型逻辑，UI与测试共用 */

import { uid } from './utils.js';
import { touchBook } from './bookOps.js';

export function addDay(book, date = '') {
  // 未指定日期时自动延续上一天：D1设了10月1日，新建D2自动为10月2日
  if (!date) {
    const last = book.days[book.days.length - 1];
    if (last?.date) {
      const d = new Date(`${last.date}T00:00:00`);
      d.setDate(d.getDate() + 1);
      const p = n => String(n).padStart(2, '0');
      date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
  }
  const day = { id: uid('d'), date, stopItemIds: [], stayItemId: null };
  book.days.push(day);
  touchBook(book);
  return day;
}

export function removeDayById(book, dayId) {
  const idx = book.days.findIndex(d => d.id === dayId);
  if (idx >= 0) { book.days.splice(idx, 1); touchBook(book); }
  return idx >= 0;
}

export function dayLabel(book, dayId) {
  const idx = book.days.findIndex(d => d.id === dayId);
  return idx >= 0 ? `D${idx + 1}` : '';
}

/**
 * 当天的出发锚点：
 * 优先向前找最近一天的终点（默认为该天最后一个条目，若历史数据有 stayItemId 亦兼容）；
 * 都没有则用整趟起点（仅从源头找得到时）。
 * 返回 {type:'item', id} | {type:'origin'} | null
 */
export function dayStartAnchor(book, dayId) {
  const idx = book.days.findIndex(d => d.id === dayId);
  if (idx < 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const d = book.days[i];
    const lastId = (d.stopItemIds && d.stopItemIds.length)
      ? d.stopItemIds[d.stopItemIds.length - 1]
      : d.stayItemId;
    if (lastId) return { type: 'item', id: lastId };
  }
  return book.origin?.name ? { type: 'origin' } : null;
}

/** 设置当晚住宿：兼容保留函数，历史数据或测试可用 */
export function setStay(book, dayId, itemId) {
  const day = book.days.find(d => d.id === dayId);
  if (!day) return false;
  day.stayItemId = itemId;
  day.stopItemIds = day.stopItemIds.filter(id => id !== itemId);
  touchBook(book);
  return true;
}

export function clearStay(book, dayId) {
  const day = book.days.find(d => d.id === dayId);
  if (!day) return false;
  day.stayItemId = null;
  touchBook(book);
  return true;
}

/** 当天有效终点/住宿：未设住宿时默认最后一个地点（最后一条为目的地） */
export function effectiveStayId(day) {
  if (!day) return null;
  return (day.stopItemIds && day.stopItemIds.length ? day.stopItemIds[day.stopItemIds.length - 1] : null) || day.stayItemId || null;
}

/** 插入条目（index=-1 追加到末尾） */
export function insertStop(book, dayId, itemId, index = -1) {
  const day = book.days.find(d => d.id === dayId);
  if (!day) return false;
  if (day.stayItemId === itemId) return false;
  day.stopItemIds = day.stopItemIds.filter(id => id !== itemId);
  if (index < 0 || index > day.stopItemIds.length) day.stopItemIds.push(itemId);
  else day.stopItemIds.splice(index, 0, itemId);
  touchBook(book);
  return true;
}

/** 移动条目：同天内重排（toIndex按移除后的数组）或跨天移动 */
export function moveStop(book, fromDayId, toDayId, itemId, toIndex = -1) {
  const from = book.days.find(d => d.id === fromDayId);
  const to = fromDayId === toDayId ? from : book.days.find(d => d.id === toDayId);
  if (!from || !to) return false;
  if (fromDayId !== toDayId && to.stayItemId === itemId) return false;
  from.stopItemIds = from.stopItemIds.filter(id => id !== itemId);
  if (toIndex < 0 || toIndex > to.stopItemIds.length) to.stopItemIds.push(itemId);
  else to.stopItemIds.splice(toIndex, 0, itemId);
  touchBook(book);
  return true;
}

export function removeStopById(book, dayId, itemId) {
  const day = book.days.find(d => d.id === dayId);
  if (!day) return false;
  const before = day.stopItemIds.length;
  day.stopItemIds = day.stopItemIds.filter(id => id !== itemId);
  if (day.stopItemIds.length !== before) { touchBook(book); return true; }
  return false;
}

/**
 * 当天的导航链（画线/优化用）：
 * [出发锚?, ...条目..., 住宿?, 目的地?(仅最后一天)]，相邻重复点去除。
 * 元素：{type:'origin'} | {type:'item', id} | {type:'dest'}
 */
export function routeChain(book, dayId) {
  const day = book.days.find(d => d.id === dayId);
  if (!day) return [];
  const idx = book.days.findIndex(d => d.id === dayId);
  const seq = [];
  const anchor = dayStartAnchor(book, dayId);
  if (anchor) seq.push(anchor);
  day.stopItemIds.forEach(id => seq.push({ type: 'item', id }));
  if (day.stayItemId) seq.push({ type: 'item', id: day.stayItemId });
  // 整趟目的地作为最后一天的终点（PRD 决策Q5）
  if (idx === book.days.length - 1 && book.destination?.name) seq.push({ type: 'dest' });
  return seq.filter((e, i) => {
    if (i === 0) return true;
    const prev = seq[i - 1];
    return !(prev.type === 'item' && e.type === 'item' && prev.id === e.id);
  });
}
