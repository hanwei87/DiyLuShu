/**
 * 持久层：通过 REST API 与后端 SQLite 交互。
 *  markDirty(scope) → 防抖600ms → 调用API写入
 *  boot 时 GET /api/state → hydrate 全局状态
 *  同时写入本地 IndexedDB 镜像兜底，确保离线或网络抖动时不丢数据。
 */

import { state } from './state.js';
import { getAdapter, PATHS } from './fs.js';
import { idb, KEYS } from './idb.js';
import { fmtClock, deepClone } from './utils.js';
import { getToken, showAuthModal, setToken, setCurrentUser } from './auth.js';

const pending = new Set();
let timer = null;

function setStatus(kind, text) {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  el.hidden = false;
  el.className = `save-indicator ${kind === 'ok' ? 'ok' : kind}`;
  el.textContent = text;
  if (kind === 'error') {
    el.title = '保存失败，点击重试';
    el.style.cursor = 'pointer';
    el.onclick = () => { flush().catch(() => {}); };
  } else {
    el.title = '';
    el.style.cursor = 'default';
    el.onclick = null;
  }
}

export function markDirty(scope) {
  pending.add(scope);
  setStatus('saving', '保存中…');
  clearTimeout(timer);
  timer = setTimeout(() => { flush().catch(() => {}); }, 600);
}

export function flushNow() {
  clearTimeout(timer);
  return flush();
}

async function api(method, url, body) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const opts = { method, headers };
  if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (res.status === 401) {
    setToken(null);
    setCurrentUser(null);
    if (!window.__TEST_HARNESS__) {
      showAuthModal({ canClose: false, tip: '登录已失效，请重新登录以同步数据' });
    }
    throw new Error('未登录或登录已失效');
  }
  if (!res.ok) throw new Error(`API ${url} → ${res.status}`);
  return res.json();
}

function scopePath(scope) {
  if (scope === 'settings') return PATHS.settings;
  if (scope === 'library') return PATHS.library;
  if (scope.startsWith('book:')) {
    const b = state.books.find(x => x.id === scope.slice(5));
    return b && b.file ? PATHS.book(b.file) : null;
  }
  return null;
}

function scopeData(scope) {
  if (scope === 'settings') return state.settings;
  if (scope === 'library') return state.library;
  if (scope.startsWith('book:')) return state.books.find(x => x.id === scope.slice(5)) || null;
  return null;
}

async function writeMirror() {
  try {
    await idb.set(KEYS.mirror, {
      savedAt: Date.now(),
      state: deepClone({ settings: state.settings, library: state.library, books: state.books }),
    });
    localStorage.setItem(KEYS.settingsCache, JSON.stringify(state.settings));
  } catch { /* 忽略环境不支持 */ }
}

export async function flush() {
  if (!pending.size) return;
  const scopes = [...pending];
  const adapter = getAdapter();

  try {
    // 1. 如果存在测试适配器（如内存适配器），写入适配器
    if (adapter) {
      for (const s of scopes) {
        const p = scopePath(s);
        const d = scopeData(s);
        if (p && d) await adapter.writeJSON(p, d);
      }
    }

    // 2. 生产环境 / 非纯内存测试时：调用后端 REST API 写入 SQLite
    if (!adapter || adapter.kind !== 'memory') {
      for (const s of scopes) {
        if (s === 'settings') {
          await api('PUT', '/api/settings', state.settings);
        } else if (s === 'library') {
          await api('PUT', '/api/library', state.library);
        } else if (s.startsWith('book:')) {
          const id = s.slice(5);
          const book = state.books.find(x => x.id === id);
          if (book) await api('PUT', `/api/books/${id}`, book);
        }
      }
    }

    scopes.forEach(s => pending.delete(s));
    setStatus('ok', `已保存 ${fmtClock(Date.now())}`);
  } catch (err) {
    setStatus('error', '未保存，点击重试');
    await writeMirror();
    throw err;
  }

  await writeMirror();
}

export async function deleteBookAPI(id) {
  pending.delete(`book:${id}`);
  const adapter = getAdapter();
  if (!adapter || adapter.kind !== 'memory') {
    await api('DELETE', `/api/books/${id}`);
  }
  await writeMirror();
}

export async function flushAll() {
  await flush();
  const adapter = getAdapter();

  if (adapter) {
    const scopes = ['settings', 'library', ...state.books.map(b => `book:${b.id}`)];
    for (const s of scopes) {
      const p = scopePath(s);
      const d = scopeData(s);
      if (p && d) await adapter.writeJSON(p, d);
    }
  }

  if (!adapter || adapter.kind !== 'memory') {
    if (state.settings) await api('PUT', '/api/settings', state.settings);
    if (state.library) await api('PUT', '/api/library', state.library);
    for (const b of state.books) await api('PUT', `/api/books/${b.id}`, b);
  }

  await writeMirror();
  setStatus('ok', `已保存 ${fmtClock(Date.now())}`);
}

export async function restoreFromAPI() {
  const token = getToken();
  if (!token) {
    if (!window.__TEST_HARNESS__) {
      showAuthModal({
        canClose: false,
        defaultTab: 'login',
      });
    }
    return;
  }
  const data = await api('GET', '/api/state');
  state.settings = { amapKey: '', securityCode: '', weatherKey: '', appName: '', guideDismissed: false, ...data.settings };
  try { localStorage.setItem(KEYS.settingsCache, JSON.stringify(state.settings)); } catch { /* 忽略 */ }
  state.library = { categories: [], tags: [], items: [], ...data.library };
  state.books = (data.books || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  try {
    const saved = localStorage.getItem('lushu:lastBook');
    if (saved && state.books.some(b => b.id === saved)) state.ui.lastBookId = saved;
  } catch { /* 忽略 */ }
  cleanOrphanedReferences();
  deduplicateBookNames();
  try {
    const { applyAppName } = await import('./brand.js');
    applyAppName();
  } catch { /* 忽略 */ }
}

/** 自动消除重名路书（自愈机制）：主路书保留原名，空/旧副本自动追加后缀区分 */
export function deduplicateBookNames() {
  if (!state.books || state.books.length <= 1) return;
  const groups = new Map();
  for (const b of state.books) {
    const name = (b.name || '').trim();
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(b);
  }

  let anyChanged = false;
  for (const [name, list] of groups.entries()) {
    if (list.length <= 1) continue;

    // 排序：地点数量多的排前面，更新时间最近的排前面
    list.sort((a, b) => {
      const stopsA = (a.days || []).reduce((n, d) => n + (d.stopItemIds?.length || 0) + (d.stayItemId ? 1 : 0), 0);
      const stopsB = (b.days || []).reduce((n, d) => n + (d.stopItemIds?.length || 0) + (d.stayItemId ? 1 : 0), 0);
      if (stopsB !== stopsA) return stopsB - stopsA;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    // list[0] 为主路书保留原名，其余副本重命名区分
    for (let i = 1; i < list.length; i++) {
      const dup = list[i];
      const stops = (dup.days || []).reduce((n, d) => n + (d.stopItemIds?.length || 0) + (d.stayItemId ? 1 : 0), 0);
      const suffix = stops === 0 ? '未排行程' : (i === 1 ? '副本' : `副本 ${i}`);
      const newName = `${name} (${suffix})`;
      dup.name = newName;
      markDirty(`book:${dup.id}`);
      anyChanged = true;
    }
  }

  if (anyChanged) {
    flush().catch(() => {});
  }
}

/** 自动清洗已被物理删除的地点的历史脏引用（自愈机制） */
export function cleanOrphanedReferences() {
  if (!state.library?.items || !state.books?.length) return;
  const validIds = new Set(state.library.items.map(i => i.id));
  let anyChanged = false;
  for (const b of state.books) {
    let bookChanged = false;
    for (const d of b.days) {
      const origLen = d.stopItemIds.length;
      d.stopItemIds = d.stopItemIds.filter(id => validIds.has(id));
      if (d.stopItemIds.length !== origLen) bookChanged = true;
      if (d.stayItemId && !validIds.has(d.stayItemId)) {
        d.stayItemId = null;
        bookChanged = true;
      }
    }
    if (bookChanged) {
      markDirty(`book:${b.id}`);
      anyChanged = true;
    }
  }
  if (anyChanged) {
    flush().catch(() => {});
  }
}

// 兼容旧代码与测试的空导出
export function hydrate() {}
export function updatePermBanner() {}
export async function onAuthorized() {}
