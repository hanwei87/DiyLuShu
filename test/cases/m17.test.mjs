import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import { addDay, insertStop } from '../../js/core/plannerOps.js';
import { renderPage } from '../../js/main.js';
import * as home from '../../js/pages/home.js';
import * as mybooks from '../../js/pages/mybooks.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const page = document.getElementById('page');

describe('M17 十二轮反馈回归', () => {
  function seedBooks(n) {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true, appName: '' };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const stop = addItemToLibrary(state.library, { name: '宽窄巷子', location: '104.05,30.66' });
    const books = [];
    for (let i = 1; i <= n; i++) {
      const b = createBook({ name: `路书${String(i).padStart(2, '0')}` });
      const d = addDay(b, '2026-10-01');
      insertStop(b, d.id, stop.id);
      books.push(b);
    }
    return books;
  }

  it('【问题1】首页只显示最新5本，"显示更多"跳转我的路书页', async () => {
    seedBooks(7);
    document.querySelector('[data-modal]')?.remove();
    await home.render(page);
    await wait(60);
    assert.eq(page.querySelectorAll('#bookGrid [data-book]').length, 5, '首页最多5本');
    const moreBtn = page.querySelector('[data-act="morebooks"]');
    assert.ok(moreBtn, '应有显示更多按钮');
    moreBtn.click();
    await wait(30);
    assert.eq(location.hash, '#/mybooks', '应跳转我的路书页');
    location.hash = '#/home';
  });

  it('【问题1】我的路书页显示全部路书（含卡片菜单入口）', async () => {
    seedBooks(7);
    document.querySelector('[data-modal]')?.remove();
    await mybooks.render(page);
    await wait(50);
    assert.has(page, '[data-page="mybooks"]');
    assert.eq(page.querySelectorAll('[data-allbooks] [data-book]').length, 7, '应显示全部7本');
    assert.ok(page.querySelector('[data-menu]'), '卡片应有菜单入口');
    // 新建按钮存在
    assert.ok(page.querySelector('[data-act="new"]'), '应有新建按钮');
  });

  it('【问题1】导航含"我的路书"与"系统设置"，路由可用', async () => {
    assert.eq(document.querySelector('#tabs a[data-route="mybooks"]').textContent, '我的路书');
    assert.eq(document.querySelector('#tabs a[data-route="mine"]').textContent, '系统设置');
    location.hash = '#/mybooks';
    await renderPage();
    await wait(30);
    assert.eq(page.dataset.route, 'mybooks');
    location.hash = '#/mine';
    await renderPage();
    await wait(30);
    assert.eq(page.dataset.route, 'mine');
    location.hash = '#/home';
    await renderPage();
  });

  it('【问题2】首页四步指引带箭头；顶部导航无箭头', async () => {
    seedBooks(2);
    await home.render(page);
    await wait(50);
    assert.eq(page.querySelectorAll('.steps .step-arrow').length, 3, '四步之间3个箭头');
    assert.eq(document.querySelectorAll('#tabs .tab-arrow').length, 0, '顶部导航无箭头');
  });

  it('【问题3】文件夹读写教程：不支持时展示傻瓜式步骤', async () => {
    seedBooks(2);
    location.hash = '#/mine';
    await renderPage();
    await wait(50);
    const html = page.querySelector('.fsa-help')?.textContent || '';
    assert.includes(html, 'chrome://version', '应有内核版本自查指引');
    assert.includes(html, '导出全部数据', '应有手动备份指引');
    assert.includes(html, '升级', '应有升级建议');
    location.hash = '#/home';
    await renderPage();
  });
});
