import { describe, it, assert } from '../harness.mjs';
import { state, currentBook } from '../../js/core/state.js';
import { createBook } from '../../js/core/bookOps.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { routeGuard } from '../../js/main.js';
import { pickBook } from '../../js/core/bookPicker.js';
import * as library from '../../js/pages/library.js';
import * as planner from '../../js/pages/planner.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

describe('M8 路由守卫', () => {
  it('无路书时 planner/generate 允许进入并展示空状态（不强制弹回首页）', () => {
    state.books = [];
    state.ui = { lastBookId: null };
    assert.ok(routeGuard('planner'));
    assert.ok(routeGuard('generate'));
    assert.ok(routeGuard('home'));
    assert.ok(routeGuard('picker'));
  });

  it('有路书时放行；currentBook 兜底最近修改的一份', () => {
    state.books = [];
    state.ui = { lastBookId: null };
    createBook({ name: 'A' });
    const b2 = createBook({ name: 'B' });
    assert.ok(routeGuard('planner'));
    assert.eq(currentBook().id, b2.id, '未选过时兜底为最近修改的一份');
  });
});

describe('M8 当前路书切换弹窗', () => {
  it('pickBook 选中即返回对应路书', async () => {
    state.books = [];
    state.ui = { lastBookId: null };
    const b1 = createBook({ name: '书一' });
    const b2 = createBook({ name: '书二' });
    const p = pickBook();
    await wait(30);
    const modal = document.querySelector('[data-modal]');
    assert.ok(modal, '弹窗应出现');
    modal.querySelector(`[data-pick="${b2.id}"]`).click();
    const picked = await p;
    assert.eq(picked.id, b2.id);
    await wait(20);
    assert.notOk(document.querySelector('[data-modal]'), '选后应关闭');
    void b1;
  });
});

describe('M8 安全：条目名称XSS转义', () => {
  it('恶意名称不产生真实元素、只作为文本显示', async () => {
    state.library = { categories: [{ id: 'c1', name: '美食', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    addItemToLibrary(state.library, {
      name: '<img src=x onerror="window.__xss=1">',
      categoryId: 'c1', location: '104,30',
    });
    const page = document.getElementById('page');
    document.querySelector('[data-modal]')?.remove();
    await library.render(page);
    await wait(30);
    assert.notOk(window.__xss, 'onerror不应被执行');
    assert.notHas(page, '.item-card img', '不应插入img元素');
    assert.includes(page.querySelector('.item-card h4').textContent, '<img src=x');
  });
});

describe('M8 性能与规模', () => {
  it('300条目信息库：渲染+筛选流畅', async () => {
    state.library = { categories: [{ id: 'c1', name: '美食', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    for (let i = 0; i < 300; i++) {
      addItemToLibrary(state.library, { name: `店铺${i}`, categoryId: 'c1', location: `${104 + (i % 50) / 100},30.${i % 90}` });
    }
    const page = document.getElementById('page');
    document.querySelector('[data-modal]')?.remove();
    const t0 = performance.now();
    await library.render(page);
    await wait(50);
    const cost = performance.now() - t0;
    assert.eq(page.querySelectorAll('[data-item]').length, 300);
    assert.ok(cost < 2000, `300条渲染耗时${cost.toFixed(0)}ms 应<2000ms`);
    // 筛选交互
    page.querySelector('[data-cat="c1"]').click();
    await wait(30);
    assert.eq(page.querySelectorAll('[data-item]').length, 300);
  });

  it('15天行程的规划页渲染流畅', async () => {
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const it1 = addItemToLibrary(state.library, { name: '点A', location: '104.05,30.66' });
    const book = createBook({ name: '长行程' });
    for (let d = 0; d < 15; d++) {
      // 通过 plannerOps 间接造天
      const { addDay, insertStop } = await import('../../js/core/plannerOps.js');
      const day = addDay(book, `2026-10-${String(d + 1).padStart(2, '0')}`);
      insertStop(book, day.id, it1.id);
    }
    const page = document.getElementById('page');
    document.querySelector('[data-modal]')?.remove();
    const t0 = performance.now();
    await planner.render(page);
    await wait(80);
    const cost = performance.now() - t0;
    assert.eq(page.querySelectorAll('[data-day]').length, 15);
    assert.ok(cost < 2000, `15天规划页渲染耗时${cost.toFixed(0)}ms 应<2000ms`);
  });
});
