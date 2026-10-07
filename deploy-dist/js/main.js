/** 入口：API恢复数据 → hash路由 + 全局装配（无FSA/IndexedDB） */

import { state, currentBook } from './core/state.js';
import { restoreFromAPI, flush } from './core/persist.js';
import { applyAppName } from './core/brand.js';
import { shouldShowGuide, showGuide } from './core/guide.js';
import { renderUserChip, verifySession } from './core/auth.js';
import * as home from './pages/home.js';
import * as picker from './pages/picker.js';
import * as library from './pages/library.js';
import * as planner from './pages/planner.js';
import * as generate from './pages/generate.js';
import * as mine from './pages/mine.js';
import * as mybooks from './pages/mybooks.js';

const routes = {
  home, picker, library, planner, generate, mine, mybooks,
};

export function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  return routes[h] ? h : 'home';
}

export function setActiveTab(route) {
  document.querySelectorAll('#tabs a').forEach(a => {
    a.classList.toggle('active', a.dataset.route === route);
  });
}

export function routeGuard(route) {
  // 核心修复：规划路线与生成路线均允许直接进入，无路书时由各页面内部展示空状态，不再强制弹回首页
  return true;
}

export function updateBookChip(route) {
  const chip = document.getElementById('bookChip');
  if (!chip) return;
  if (!['planner', 'generate'].includes(route)) { chip.hidden = true; return; }
  const book = state.books.find(b => b.id === state.ui?.lastBookId) || state.books[0];
  if (!book) { chip.hidden = true; return; }
  chip.hidden = false;
  chip.textContent = `当前路书: ${book.name}`;
  chip.onclick = async () => {
    const picked = await import('./core/bookPicker.js').then(m => m.pickBook());
    if (picked) { state.ui.lastBookId = picked.id; renderPage(); }
  };
}

let renderSeq = 0;
export async function renderPage() {
  const seq = ++renderSeq;
  const route = currentRoute();
  if (!routeGuard(route)) { location.hash = '#/home'; return; }
  setActiveTab(route);
  renderUserChip();
  const page = document.getElementById('page');
  page.innerHTML = '';
  await routes[route].render(page);
  if (seq === renderSeq) {
    page.setAttribute('data-route', route);
    updateBookChip(route);
  }
}

export function contextIssue() { return null; }

export async function boot() {
  window.addEventListener('hashchange', renderPage);
  try {
    const cached = localStorage.getItem('lushu:settingsCache');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        Object.assign(state.settings, parsed);
      }
    }
  } catch { /* 忽略 */ }
  applyAppName();
  if (!location.hash) location.hash = '#/home';
  renderUserChip();
  try {
    await verifySession();
    renderUserChip();
    await restoreFromAPI();
    applyAppName();
  } catch (err) {
    console.warn('API数据加载失败（可能是首次运行或未登录）:', err.message);
  }
  await renderPage();
  if (shouldShowGuide()) showGuide();
}

export { flush } from './core/persist.js';
export async function restoreFromStorage() { await restoreFromAPI(); }

if (!window.__TEST_HARNESS__) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
