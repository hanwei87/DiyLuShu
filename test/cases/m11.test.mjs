import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import { addDay, insertStop, setStay } from '../../js/core/plannerOps.js';
import { loadAMap } from '../../js/core/amap.js';
import { DAY_COLORS } from '../../js/core/routeDraw.js';
import { renderPage, currentRoute } from '../../js/main.js';
import * as home from '../../js/pages/home.js';
import * as generate from '../../js/pages/generate.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const page = document.getElementById('page');

describe('M11 四轮反馈回归', () => {
  it('【问题4→十二轮修订】导航：我的路书/系统设置入口', () => {
    assert.eq(document.querySelector('#tabs a[data-route="mybooks"]').textContent, '我的路书');
    assert.eq(document.querySelector('#tabs a[data-route="mine"]').textContent, '系统设置');
    assert.notOk(document.getElementById('settingsBtn'), '⚙按钮应移除（并入系统设置页）');
  });

  it('【问题3/4】我的页：应用名称保存后替换顶栏品牌字', async () => {
    location.hash = '#/mine';
    await renderPage();
    await wait(30);
    assert.eq(currentRoute(), 'mine');
    assert.has(page, '[data-page="mine"]');
    const input = page.querySelector('[data-appname]');
    assert.ok(input, '应用名称输入应存在');
    assert.ok(page.querySelector('[data-amapkey]'), 'Key输入应存在');
    assert.ok(page.querySelector('[data-act="export"]'), '导出备份应存在');
    input.value = '我的旅行册';
    page.querySelector('[data-act="savename"]').click();
    await wait(30);
    assert.eq(state.settings.appName, '我的旅行册');
    assert.includes(document.getElementById('brand').textContent, '我的旅行册');
    assert.includes(document.title, '我的旅行册');
    // 恢复默认
    input.value = '';
    page.querySelector('[data-act="savename"]').click();
    await wait(30);
    assert.includes(document.getElementById('brand').textContent, '路书');
  });

  it('【问题1】首页行程色带封面（取消高德缩略图）', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true, appName: '' };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const a = addItemToLibrary(state.library, { name: '宽窄巷子', location: '104.0550,30.6630' });
    const b2 = addItemToLibrary(state.library, { name: '锦里古街', location: '104.0430,30.6440' });
    const book = createBook({ name: '有行程的书' });
    const d1 = addDay(book, '2026-10-01');
    insertStop(book, d1.id, a.id);
    insertStop(book, d1.id, b2.id);
    const d2 = addDay(book, '2026-10-02');
    insertStop(book, d2.id, b2.id);
    createBook({ name: '空书' });
    const before = (await loadAMap({ forceMock: true })).Map.instances.length;
    await home.render(page);
    await wait(120);
    const AMap = await loadAMap({ forceMock: true });
    assert.eq(AMap.Map.instances.length, before, '封面不再创建任何地图实例');
    const covers = [...page.querySelectorAll('[data-cover]')];
    assert.eq(covers.length, 2);
    // 最新创建的空书排在前面
    assert.ok(covers[0].textContent.includes('还没排行程'), '空书显示空封面');
    const filled = covers[1];
    assert.ok(filled.querySelector('.cover-svg svg'), '封面应为SVG迷你地图');
    assert.gte(filled.querySelectorAll('svg circle').length, 3, '地点节点');
    assert.ok(filled.querySelectorAll('svg text').length >= 1, '应有终点旗⚑');
  });

  it('【问题2】生成页：单天单独展示/恢复全程/标签居中', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true, appName: '' };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [{ id: 't1', name: '川菜' }], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const a = addItemToLibrary(state.library, { name: '店A', location: '104.05,30.66', tagIds: ['t1'] });
    const b2 = addItemToLibrary(state.library, { name: '店B', location: '104.08,30.64' });
    const hotel = addItemToLibrary(state.library, { name: '酒店H', location: '104.06,30.65' });
    const c3 = addItemToLibrary(state.library, { name: '店C', location: '104.03,30.61' });
    const hotel2 = addItemToLibrary(state.library, { name: '酒店2', location: '104.02,30.60' });
    const book = createBook({ name: '单天展示' });
    const d1 = addDay(book, '2026-10-01');
    insertStop(book, d1.id, a.id);
    insertStop(book, d1.id, b2.id);
    setStay(book, d1.id, hotel.id);
    const d2 = addDay(book, '2026-10-02');
    insertStop(book, d2.id, c3.id);
    setStay(book, d2.id, hotel2.id);
    await generate.render(page);
    await wait(900);
    // 标签居中
    const stopBlock = page.querySelector('.gen-stop');
    assert.eq(getComputedStyle(stopBlock).textAlign, 'center', '地点块文字应居中');
    assert.eq(getComputedStyle(stopBlock.querySelector('.gtags')).justifyContent, 'center', '标签应居中');
    // 全程：两天都有线
    const getColors = () => {
      const AMap = window.__LUSHU_AMAP_MOCK__;
      const m = AMap.Map.instances[AMap.Map.instances.length - 1];
      return new Set(m.overlays.filter(o => o.opts?.strokeColor).map(o => o.opts.strokeColor));
    };
    assert.ok(getColors().has(DAY_COLORS[0]) && getColors().has(DAY_COLORS[1]), '全程应两天都有线');
    // 单独展示 D2
    page.querySelector('[data-showday="1"]').click();
    await wait(700);
    const colors2 = getColors();
    assert.ok(colors2.has(DAY_COLORS[1]) && !colors2.has(DAY_COLORS[0]), '单独展示只画D2');
    const AMap2 = window.__LUSHU_AMAP_MOCK__;
    const tags2 = AMap2.Map.instances[AMap2.Map.instances.length - 1]
      .overlays.filter(o => o.opts?.content).map(o => o.opts.content);
    assert.ok(tags2.some(t => t.includes('D2·')), '单独展示应有D2编号标签');
    assert.notOk(tags2.some(t => t.includes('D1·')), '不应再显示D1标签');
    // 恢复全程
    page.querySelector('[data-showday="1"]').click();
    await wait(700);
    assert.ok(getColors().has(DAY_COLORS[0]) && getColors().has(DAY_COLORS[1]), '恢复全程');
  });
});
