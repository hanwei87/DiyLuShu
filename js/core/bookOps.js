/** 路书操作（含文件名管理），供首页/规划页共用 */

import { state } from './state.js';
import { uid, todayCompact, safeFilename } from './utils.js';
import { markDirty, deleteBookAPI } from './persist.js';
import { getAdapter, PATHS } from './fs.js';

function uniqueFile(base) {
  const name = base.replace(/\.json$/, '');
  const files = new Set(state.books.map(b => b.file));
  let file = `${base}`;
  let n = 2;
  while (files.has(file)) file = `${name}_${n++}.json`;
  return file;
}

export function uniqueBookName(baseName, excludeId = null) {
  const name = (baseName || '').trim() || '未命名路书';
  const existingNames = new Set(
    state.books
      .filter(b => b.id !== excludeId)
      .map(b => (b.name || '').trim())
  );
  if (!existingNames.has(name)) return name;

  let n = 2;
  let candidate = `${name} (${n})`;
  while (existingNames.has(candidate)) {
    n++;
    candidate = `${name} (${n})`;
  }
  return candidate;
}

export function touchBook(book) {
  // 保证严格递增：与其他路书同毫秒时也要排到最前
  const maxOther = Math.max(0, ...state.books.filter(b => b !== book).map(b => b.updatedAt || 0));
  book.updatedAt = Math.max(Date.now(), maxOther + 1);
  state.books.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  markDirty(`book:${book.id}`);
}

export function createBook({ name, origin = '', destination = '' }) {
  const now = Date.now();
  const cleanName = uniqueBookName(name);
  const book = {
    id: uid('b'),
    name: cleanName,
    origin: origin ? { name: origin.trim() } : null,
    destination: destination ? { name: destination.trim() } : null,
    days: [],
    createdAt: now,
    updatedAt: now,
    file: uniqueFile(`${todayCompact()}_${safeFilename(cleanName)}.json`),
  };
  state.books.unshift(book);
  markDirty(`book:${book.id}`);
  return book;
}

export async function renameBook(book, newName) {
  const name = newName.trim();
  if (!name || name === book.name) return book;
  if (state.books.some(b => b.id !== book.id && b.name === name)) {
    throw new Error(`已存在同名路书《${name}》`);
  }
  const oldFile = book.file;
  book.name = name;
  book.file = uniqueFile(`${todayCompact(new Date(book.createdAt))}_${safeFilename(name)}.json`);
  touchBook(book);
  const adapter = getAdapter();
  if (adapter && oldFile && oldFile !== book.file) {
    try {
      if (await adapter.hasPermission()) {
        await adapter.renameFile(PATHS.book(oldFile), PATHS.book(book.file));
      }
    } catch { /* 旧文件留待 flushAll 清理 */ }
  }
  return book;
}

export function updateBookMeta(book, { origin, destination }) {
  book.origin = origin ? { name: String(origin).trim() } : null;
  book.destination = destination ? { name: String(destination).trim() } : null;
  touchBook(book);
  return book;
}

export async function deleteBook(id) {
  const idx = state.books.findIndex(b => b.id === id);
  if (idx < 0) return false;
  const [book] = state.books.splice(idx, 1);

  if (state.ui?.lastBookId === id) {
    state.ui.lastBookId = state.books[0]?.id || null;
    try {
      if (state.ui.lastBookId) localStorage.setItem('lushu:lastBook', state.ui.lastBookId);
      else localStorage.removeItem('lushu:lastBook');
    } catch { /* 忽略 */ }
  }

  const adapter = getAdapter();
  if (adapter && book.file) {
    try {
      if (await adapter.hasPermission()) {
        await adapter.deleteFile(PATHS.book(book.file));
      }
    } catch { /* 文件已不存在等情况忽略 */ }
  }

  try {
    await deleteBookAPI(id);
  } catch (err) {
    console.error('删除路书远程同步失败:', err);
  }
  return true;
}

export function bookSummary(book) {
  const dayCount = book.days.length;
  const stopCount = book.days.reduce((n, d) => n + (d.stopItemIds?.length || 0) + (d.stayItemId ? 1 : 0), 0);
  return { dayCount, stopCount };
}
