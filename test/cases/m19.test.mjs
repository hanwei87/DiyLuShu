import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import { addDay, insertStop, setStay } from '../../js/core/plannerOps.js';
import { fsaHelpHtml, compatRows } from '../../js/core/compat.js';
import * as home from '../../js/pages/home.js';
import * as generate from '../../js/pages/generate.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const page = document.getElementById('page');

describe('M19 十四轮反馈回归', () => {
  it('【问题1】CatsXP（内核153）无FSA时的针对性文案与flags教程', () => {
    // 内核≥86但无FSA：文案应指向"浏览器关闭了该能力"+ flags 开启法
    const help = fsaHelpHtml();
    assert.includes(help, 'chrome://flags/#file-system-access-api', '应有flags开启指引');
    assert.includes(help, 'Enabled', '应说明设为Enabled');
    // banner文案同步
    const { updatePermBanner } = import('../../js/core/persist.js').then(m => m);
    void updatePermBanner;
    const rows = compatRows();
    const fsaRow = rows.find(r => r.k === '本地文件夹读写');
    assert.ok(fsaRow, '应有文件夹读写行');
  });

  it('【问题1】不支持文件夹时的横幅含flags指引（DOM）', async () => {
    const { updatePermBanner } = await import('../../js/core/persist.js');
    let banner = document.getElementById('permBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'permBanner';
      document.body.appendChild(banner);
    }
    updatePermBanner(null, 'none');
    assert.includes(banner.textContent, 'chrome://flags/#file-system-access-api');
    assert.includes(banner.textContent, '系统设置');
  });

  it('【问题2】首页封面为SVG迷你地图：点线/终点旗/热门环', async () => {
    state.settings = { amapKey: 'T', securityCode: '', weatherKey: '', appName: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [{ id: 't1', name: '川菜' }], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const a = addItemToLibrary(state.library, { name: '宽窄巷子', location: '104.0550,30.6630', address: '成都市青羊区', tagIds: ['t1'] });
    const b2 = addItemToLibrary(state.library, { name: '锦里古街', location: '104.0430,30.6440', address: '成都市武侯区' });
    const hotel = addItemToLibrary(state.library, { name: '亚朵酒店', location: '104.0650,30.6570', address: '成都市青羊区' });
    const book = createBook({ name: 'SVG封面' });
    const d1 = addDay(book, '2026-10-01');
    insertStop(book, d1.id, a.id);
    insertStop(book, d1.id, b2.id);
    setStay(book, d1.id, hotel.id);
    const d2 = addDay(book, '2026-10-02');
    insertStop(book, d2.id, a.id); // 宽窄巷子第二次使用 → 热门
    setStay(book, d2.id, hotel.id);
    await home.render(page);
    await wait(120);
    const cover = page.querySelector('[data-cover]');
    const svg = cover.querySelector('svg');
    assert.ok(svg, '封面应为SVG');
    assert.gte(svg.querySelectorAll('circle').length, 4, '应有4个地点节点');
    assert.gte(svg.querySelectorAll('line').length, 3, '应有顺序连线');
    assert.gte(svg.querySelectorAll('text').length, 2, '每天应有终点旗⚑');
    // 宽窄巷子被排入2次 → 热门高亮环（stroke=#2f6fed 的 circle）
    const rings = [...svg.querySelectorAll('circle')].filter(c => c.getAttribute('stroke') === '#2f6fed');
    assert.gte(rings.length, 1, '热门点应有高亮环');
    assert.includes(cover.textContent, '🔥 热门：宽窄巷子', '底部应显示热门地点');
  });

  it('【问题3】首页预览卡无三个点按钮，点卡片直接进路书', async () => {
    state.settings = { amapKey: 'T', securityCode: '', weatherKey: '', appName: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const a = addItemToLibrary(state.library, { name: '店A', location: '104.05,30.66' });
    const book = createBook({ name: '无菜单预览' });
    const d1 = addDay(book);
    insertStop(book, d1.id, a.id);
    await home.render(page);
    await wait(80);
    assert.notOk(page.querySelector('#bookGrid [data-menu]'), '首页预览卡不应有三个点按钮');
    page.querySelector('#bookGrid [data-book]').click();
    await wait(30);
    assert.eq(location.hash, '#/planner', '点卡片应直接进入路书规划');
    assert.eq(state.ui.lastBookId, book.id);
    location.hash = '#/home';
  });

  it('【问题5】生成页左侧行程带D天·序号编号（与地图对应）', async () => {
    state.settings = { amapKey: 'T', securityCode: '', weatherKey: '', appName: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const a = addItemToLibrary(state.library, { name: '店A', location: '104.05,30.66' });
    const b2 = addItemToLibrary(state.library, { name: '店B', location: '104.08,30.64' });
    const hotel = addItemToLibrary(state.library, { name: '酒店H', location: '104.06,30.65' });
    const c3 = addItemToLibrary(state.library, { name: '店C', location: '104.03,30.61' });
    const book = createBook({ name: '编号对应' });
    const d1 = addDay(book, '2026-10-01');
    insertStop(book, d1.id, a.id);
    insertStop(book, d1.id, b2.id);
    setStay(book, d1.id, hotel.id);
    const d2 = addDay(book, '2026-10-02');
    insertStop(book, d2.id, c3.id);
    setStay(book, d2.id, hotel.id);
    await generate.render(page);
    await wait(800);
    const nums = [...page.querySelectorAll('.gen-stop .gnum')].map(e => e.textContent.trim());
    assert.eq(nums, ['1', '2', '3', '1', '2']);
  });
});
