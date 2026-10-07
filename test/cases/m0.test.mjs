import { describe, it, assert } from '../harness.mjs';
import { currentRoute, setActiveTab, renderPage } from '../../js/main.js';

describe('M0 路由与骨架', () => {
  it('vendor 两个库已正确加载为全局', () => {
    assert.ok(window.Sortable, 'Sortable 未加载');
    assert.ok(window.idbKeyval && typeof window.idbKeyval.get === 'function', 'idbKeyval 未加载');
  });

  it('currentRoute：无hash默认home，非法hash回退home', () => {
    location.hash = '';
    assert.eq(currentRoute(), 'home');
    location.hash = '#/library';
    assert.eq(currentRoute(), 'library');
    location.hash = '#/notexist';
    assert.eq(currentRoute(), 'home');
  });

  it('setActiveTab 高亮当前Tab', () => {
    setActiveTab('picker');
    const active = document.querySelector('#tabs a.active');
    assert.eq(active?.dataset.route, 'picker');
  });

  it('renderPage：渲染对应页面并标记 data-route', async () => {
    location.hash = '#/home';
    await renderPage();
    const page = document.getElementById('page');
    assert.eq(page.dataset.route, 'home');
    assert.has(page, '[data-page="home"]');
    location.hash = '#/library';
    await renderPage();
    assert.eq(page.dataset.route, 'library');
    assert.has(page, '[data-page="library"]');
    location.hash = '#/home';
    await renderPage();
  });
});
