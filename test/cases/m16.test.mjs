import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import { addDay, insertStop, setStay } from '../../js/core/plannerOps.js';
import { loadAMap } from '../../js/core/amap.js';
import { compatRows, browserInfo } from '../../js/core/compat.js';
import * as generate from '../../js/pages/generate.js';
import * as mine from '../../js/pages/mine.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const page = document.getElementById('page');

describe('M16 十一轮反馈回归', () => {
  it('【问题3→十二轮修订】箭头在首页四步指引中（顶部导航无箭头）', async () => {
    assert.eq(document.querySelectorAll('#tabs .tab-arrow').length, 0, '顶部导航不应有箭头');
    location.hash = '#/home';
    const { renderPage } = await import('../../js/main.js');
    await renderPage();
    await wait(50);
    const arrows = page.querySelectorAll('.steps .step-arrow');
    assert.eq(arrows.length, 3, '四步指引之间应有3个箭头');
    // 四个流程卡片仍可对应四个页面入口（指引文案里的页面名）
    const stepsText = page.querySelector('.steps').textContent;
    for (const nm of ['地图选点', '收藏地点', '规划路线', '生成路线']) {
      assert.includes(stepsText, nm);
    }
  });

  it('【问题1】我的页显示浏览器兼容自检（含内核版本与能力）', async () => {
    state.settings = { amapKey: '', securityCode: '', weatherKey: '', appName: '', guideDismissed: true };
    state.books = [];
    location.hash = '#/mine';
    const { renderPage } = await import('../../js/main.js');
    await renderPage();
    await wait(30);
    const rows = [...page.querySelectorAll('[data-compat] > div')].map(d => d.textContent);
    assert.eq(rows.length, 4, '应有4行兼容信息');
    const joined = rows.join('|');
    const info = browserInfo();
    if (info.isChromium) assert.includes(joined, 'Chromium');
    assert.includes(joined, '本地文件夹读写');
    // 页面语言：不再写死"需要 Chrome / Edge"
    assert.notIncludes(joined, '需要 Chrome / Edge');
  });

  it('【问题1】不支持文件夹时提示语面向Chromium内核浏览器', async () => {
    const { updatePermBanner } = await import('../../js/core/persist.js');
    let banner = document.getElementById('permBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'permBanner';
      document.body.appendChild(banner);
    }
    updatePermBanner(null, 'none');
    assert.includes(banner.textContent, 'chrome://flags');
    assert.includes(banner.textContent, '持久化');
    assert.includes(banner.textContent, 'CatsXP');
  });

  it('【问题2】生成页地图每个点挂"D天·序号"编号标签', async () => {
    state.settings = { amapKey: 'T', securityCode: '', weatherKey: '', appName: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const a = addItemToLibrary(state.library, { name: '店A', location: '104.05,30.66' });
    const b2 = addItemToLibrary(state.library, { name: '店B', location: '104.08,30.64' });
    const hotel = addItemToLibrary(state.library, { name: '酒店H', location: '104.06,30.65' });
    const c3 = addItemToLibrary(state.library, { name: '店C', location: '104.03,30.61' });
    const book = createBook({ name: '标签测试' });
    const d1 = addDay(book, '2026-10-01');
    insertStop(book, d1.id, a.id);
    insertStop(book, d1.id, b2.id);
    setStay(book, d1.id, hotel.id);
    const d2 = addDay(book, '2026-10-02');
    insertStop(book, d2.id, c3.id);
    await generate.render(page);
    await wait(900);
    const AMap = await loadAMap({ forceMock: true });
    const map = AMap.Map.instances[AMap.Map.instances.length - 1];
    const contents = map.overlays.filter(o => o.opts?.content).map(o => o.opts.content);
    assert.ok(contents.some(c => c.includes('D1·1')), '应有 D1·1');
    assert.ok(contents.some(c => c.includes('D1·2')), '应有 D1·2');
    assert.ok(contents.some(c => c.includes('D1·3') && c.includes('🏨')), '住宿点应带酒店角标');
    assert.ok(contents.some(c => c.includes('D2·1')), 'D2起点应有编号（继承住宿锚）');
    // 单独展示 D2 时只剩 D2 的标签
    page.querySelector('[data-showday="1"]').click();
    await wait(800);
    const map2 = AMap.Map.instances[AMap.Map.instances.length - 1];
    const contents2 = map2.overlays.filter(o => o.opts?.content).map(o => o.opts.content);
    assert.ok(contents2.some(c => c.includes('D2·1')), '单独展示仍应有D2标签');
    assert.notOk(contents2.some(c => c.includes('D1·')), '不应再显示D1标签');
  });
});
