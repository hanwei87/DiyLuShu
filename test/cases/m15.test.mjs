import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import { addDay, insertStop, setStay } from '../../js/core/plannerOps.js';
import { contextIssue, renderPage } from '../../js/main.js';
import { centerOnCurrentLocation } from '../../js/core/amap.js';
import * as home from '../../js/pages/home.js';
import * as generate from '../../js/pages/generate.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const page = document.getElementById('page');

describe('M15 十轮反馈回归', () => {
  it('【既有】HTTP远程访问提示；localhost与HTTPS不提示', () => {
    assert.ok(contextIssue('example.ddns.net', false), 'HTTP远程应提示');
    assert.includes(contextIssue('example.ddns.net', false), 'HTTPS');
    assert.eq(contextIssue('localhost', false), null);
    assert.eq(contextIssue('127.0.0.1', false), null);
    assert.eq(contextIssue('example.ddns.net', true), null);
  });

  it('【问题2】新建路书后跳转"地图选点"页', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true, appName: '' };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    document.querySelector('[data-modal]')?.remove();
    await home.render(page);
    await wait(50);
    await page.querySelector('[data-act="new"]').click();
    const modal = document.querySelector('[data-modal]');
    modal.querySelector('input[name="name"]').value = '新建跳转测试';
    modal.querySelector('[data-act="ok"]').click();
    await wait(40);
    assert.eq(location.hash, '#/picker', '创建后应跳转地图选点');
    assert.eq(state.ui.lastBookId, state.books[0].id);
    location.hash = '#/home';
  });

  it('【问题4】当前路书芯片只在规划/生成页显示', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true, appName: '' };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    createBook({ name: '芯片测试' });
    const chip = document.getElementById('bookChip');

    location.hash = '#/home';
    await renderPage();
    await wait(50);
    assert.ok(chip.hidden, '首页不显示芯片');

    location.hash = '#/picker';
    await renderPage();
    await wait(50);
    assert.ok(chip.hidden, '地图选点不显示芯片');

    location.hash = '#/library';
    await renderPage();
    await wait(50);
    assert.ok(chip.hidden, '收藏地点不显示芯片');

    location.hash = '#/planner';
    await renderPage();
    await wait(80);
    assert.notOk(chip.hidden, '规划路线显示芯片');
    assert.includes(chip.textContent, '芯片测试');

    location.hash = '#/generate';
    await renderPage();
    await wait(80);
    assert.notOk(chip.hidden, '生成路线显示芯片');

    location.hash = '#/mine';
    await renderPage();
    await wait(50);
    assert.ok(chip.hidden, '我的不显示芯片');
    location.hash = '#/home';
    await renderPage();
  });

  it('【问题3】生成页切换路书：旧内容立即清空且旧计算任务作废', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true, appName: '' };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const a1 = addItemToLibrary(state.library, { name: '沈阳故宫', location: '104.05,30.66' });
    const a2 = addItemToLibrary(state.library, { name: '沈阳中街', location: '104.06,30.67' });
    const b1 = addItemToLibrary(state.library, { name: '国庆广场', location: '104.07,30.68' });
    const bookA = createBook({ name: '沈阳路书' });
    const da = addDay(bookA, '2026-10-01');
    insertStop(bookA, da.id, a1.id);
    insertStop(bookA, da.id, a2.id);
    const bookB = createBook({ name: '2026国庆路线' });
    const db = addDay(bookB, '2026-10-01');
    insertStop(bookB, db.id, b1.id);

    // 先生成A
    state.ui.lastBookId = bookA.id;
    await generate.render(page);
    await wait(900);
    assert.includes(page.querySelector('[data-days]').textContent, '沈阳故宫');

    // 切到B：渲染后立即检查——旧内容必须已清空
    state.ui.lastBookId = bookB.id;
    await generate.render(page);
    const earlyText = page.querySelector('[data-days]').textContent;
    assert.notIncludes(earlyText, '沈阳故宫', '旧书行程应立即清空');
    assert.notIncludes(earlyText, '沈阳中街', '旧书行程应立即清空');
    // 等B生成完成
    await wait(800);
    const lateText = page.querySelector('[data-days]').textContent;
    assert.includes(lateText, '国庆广场', '应显示新书内容');
    assert.notIncludes(lateText, '沈阳故宫');
    location.hash = '#/home';
  });

  it('【问题5】生成页不再显示"二维码"按钮（功能二期再启）', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true, appName: '' };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const a = addItemToLibrary(state.library, { name: '店A', location: '104.05,30.66' });
    const book = createBook({ name: '无码测试' });
    const d1 = addDay(book);
    insertStop(book, d1.id, a.id);
    await generate.render(page);
    await wait(700);
    assert.notOk(page.querySelector('[data-qr]'), '二维码按钮应移除');
    assert.ok(page.querySelector('[data-showday]'), '单独显示按钮保留');
    assert.notOk(page.querySelector('[data-mobnav]'), '桌面无手机导航按钮');
    location.hash = '#/home';
  });

  it('【问题6】定位等待有上限且不覆盖路线视野（时序单元）', async () => {
    const AMap = await (await import('../../js/core/amap.js')).loadAMap({ forceMock: true });
    const t0 = performance.now();
    const map = new AMap.Map(document.createElement('div'), {});
    // waitMs=50：应在~50ms内返回（Mock定位30ms成功则更早）
    await centerOnCurrentLocation(map, 12, 50);
    const cost = performance.now() - t0;
    assert.lt(cost, 2000, `等待应受waitMs约束，实际${cost.toFixed(0)}ms`);
    assert.ok(map.center, 'Mock定位成功后中心已设置');
  });
});
