/** 全局状态：单一数据源 + 变更通知 */

export const state = {
  settings: { amapKey: '', securityCode: '', weatherKey: '', appName: '', guideDismissed: false },
  library: {
    categories: [
      { id: 'c_food', name: '美食', order: 1 },
      { id: 'c_hotel', name: '酒店', order: 2 },
      { id: 'c_play', name: '游玩', order: 3 },
    ],
    tags: [],
    items: [],
  },
  books: [],
  ui: { lastBookId: null },
};

export const UNCAT = '__uncat';

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function notify() { for (const fn of [...listeners]) fn(); }

export function findBook(id) { return state.books.find(b => b.id === id) || null; }
export function findItem(id) { return state.library.items.find(i => i.id === id) || null; }
export function findCategory(id) {
  if (id === UNCAT) return { id: UNCAT, name: '未分类' };
  return state.library.categories.find(c => c.id === id) || null;
}
export function currentBook() {
  return state.books.find(b => b.id === state.ui?.lastBookId) || state.books[0] || null;
}
