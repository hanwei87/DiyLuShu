import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import { addDay } from '../../js/core/plannerOps.js';
import * as planner from '../../js/pages/planner.js';
import * as picker from '../../js/pages/picker.js';
import * as generate from '../../js/pages/generate.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

describe('M10 三轮反馈回归', () => {
  it('【问题6】addDay 自动延续日期（含跨月/跨年）', () => {
    state.books = [];
    const b1 = createBook({ name: '日期延续' });
    const d1 = addDay(b1, '2026-10-31');
    const d2 = addDay(b1);
    assert.eq(d2.date, '2026-11-01', '跨月延续');
    const d3 = addDay(b1);
    assert.eq(d3.date, '2026-11-02');
    const b2 = createBook({ name: '跨年' });
    addDay(b2, '2026-12-31');
    assert.eq(addDay(b2).date, '2027-01-01', '跨年延续');
    // 无上一天日期时不自动填
    const b3 = createBook({ name: '空日期' });
    assert.eq(addDay(b3).date, '');
  });

  it('【问题1】归类弹窗默认上一次选择的分类', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c_food', name: '美食', order: 1 }, { id: 'c_play', name: '游玩', order: 2 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const page = document.getElementById('page');
    document.querySelector('[data-modal]')?.remove();
    await picker.render(page);
    await wait(60);
    async function addPoi(kw, categoryValue) {
      const kwInput = page.querySelector('[data-kw]');
      kwInput.value = kw;
      kwInput.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(450);
      page.querySelector('[data-cands] [data-tip]').click();
      await wait(80);
      page.querySelector('[data-detail] [data-act="add"]').click();
      await wait(30);
      const modal = document.querySelector('[data-modal]');
      const select = modal.querySelector('select[name="categoryId"]');
      if (categoryValue) select.value = categoryValue;
      modal.querySelector('[data-act="ok"]').click();
      await wait(30);
    }
    // 第一次入库：手动选"游玩"
    await addPoi('大熊猫', 'c_play');
    // 第二次入库：弹窗应默认"游玩"（上一次选择）
    const kwInput = page.querySelector('[data-kw]');
    kwInput.value = '宽窄巷子';
    kwInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(450);
    page.querySelector('[data-cands] [data-tip]').click();
    await wait(80);
    page.querySelector('[data-detail] [data-act="add"]').click();
    await wait(30);
    const modal = document.querySelector('[data-modal]');
    assert.eq(modal.querySelector('select[name="categoryId"]').value, 'c_play', '应默认上一次的分类');
    modal.querySelector('[data-act="cancel"]').click();
  });

  it('【问题2】本次已入库列表只显示最近5条', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const page = document.getElementById('page');
    document.querySelector('[data-modal]')?.remove();
    await picker.render(page);
    await wait(60);
    const names = ['宽窄巷子', '锦里古街', '春熙路', '成都东站', '小名堂', '马路边边', '亚朵酒店'];
    for (const nm of names) {
      const kw = page.querySelector('[data-kw]');
      kw.value = nm;
      kw.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(420);
      const tip = page.querySelector('[data-cands] [data-tip]');
      if (!tip) continue;
      tip.click();
      await wait(70);
      const addBtn = page.querySelector('[data-detail] [data-act="add"]');
      if (!addBtn) continue; // 已在库的跳过
      addBtn.click();
      await wait(30);
      document.querySelector('[data-modal] [data-act="ok"]').click();
      await wait(30);
    }
    const items = page.querySelectorAll('[data-session] li');
    assert.eq(items.length, 5, '列表最多显示5条');
    assert.includes(page.querySelector('[data-session] strong').textContent, '7', '计数应显示总数');
  });

  it('【问题3/5/7】规划页：搜索不丢焦点/标签筛选/列数切换/已加入标识', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true };
    state.library = {
      categories: [{ id: 'c_food', name: '美食', order: 1 }],
      tags: [{ id: 't1', name: '川菜' }],
      items: [],
    };
    state.books = [];
    state.ui = { lastBookId: null };
    const kuai = addItemToLibrary(state.library, { name: '宽窄巷子', location: '104.0550,30.6630' });
    const xmt = addItemToLibrary(state.library, { name: '小名堂', tagIds: ['t1'], location: '104.0535,30.6645' });
    const jinli = addItemToLibrary(state.library, { name: '锦里', tagIds: ['t1'], location: '104.0430,30.6440' });
    const book = createBook({ name: '测试' });
    const d1 = addDay(book, '2026-10-01');
    insertStopUi(d1, kuai.id);
    function insertStopUi(day, itemId) { day.stopItemIds.push(itemId); }
    const page = document.getElementById('page');
    document.querySelector('[data-modal]')?.remove();
    await planner.render(page);
    await wait(80);

    // 搜索输入不丢焦点（问题3根因修复）
    const kwInput = page.querySelector('[data-libkw]');
    kwInput.focus();
    kwInput.value = '小';
    kwInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(450);
    assert.eq(document.activeElement, kwInput, '防抖重建后焦点应保留在输入框');
    assert.eq(page.querySelectorAll('[data-librow]').length, 1);
    kwInput.value = '';
    kwInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(450);

    // 二级标签筛选（问题5）
    page.querySelector('[data-libtag="t1"]').click();
    await wait(30);
    const tagRowNames = [...page.querySelectorAll('[data-librow] .nm')].map(e => e.textContent);
    assert.eq(tagRowNames.sort(), ['小名堂', '锦里'], '标签筛选应命中2条');
    page.querySelector('[data-libtag="t1"]').click();
    await wait(30);

    // 列数切换（问题7）
    page.querySelector('[data-cols]').click();
    await wait(120);
    assert.includes(page.querySelector('[data-librows]').className, 'two-col',
      `应切换为2列: className=${page.querySelector('[data-librows]').className}`);
    page.querySelector('[data-cols]').click();
    await wait(120);
    assert.notOk(page.querySelector('[data-librows]').className.includes('two-col'), '应切回1列');

    // 已加入行程标识（问题7）：宽窄巷子已在D1
    const kuaiRow = [...page.querySelectorAll('[data-librow]')].find(r => r.querySelector('.nm').textContent === '宽窄巷子');
    assert.includes(kuaiRow.textContent, '✓D1', '已加入行程的条目应显示标识');
    const xmtRow = [...page.querySelectorAll('[data-librow]')].find(r => r.querySelector('.nm').textContent === '小名堂');
    assert.notOk(xmtRow.querySelector('.used-chip'), '未加入的不显示标识');
    // ⊕加入后标识出现
    xmtRow.querySelector('[data-addplus]').click();
    await wait(30);
    const xmtRow2 = [...page.querySelectorAll('[data-librow]')].find(r => r.querySelector('.nm').textContent === '小名堂');
    assert.includes(xmtRow2.textContent, '✓D1', '⊕加入后应出现标识');
    assert.ok(d1.stopItemIds.includes(xmt.id));
    void jinli;
  });

  it('【问题4】住宿选择弹窗支持大类/标签筛选', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true };
    state.library = {
      categories: [{ id: 'c_food', name: '美食', order: 1 }, { id: 'c_hotel', name: '酒店', order: 2 }],
      tags: [{ id: 't1', name: '带泳池' }],
      items: [],
    };
    state.books = [];
    state.ui = { lastBookId: null };
    addItemToLibrary(state.library, { name: '火锅店', categoryId: 'c_food' });
    addItemToLibrary(state.library, { name: '亚朵酒店', categoryId: 'c_hotel' });
    addItemToLibrary(state.library, { name: '如家酒店', categoryId: 'c_hotel', tagIds: ['t1'] });
    const book = createBook({ name: '住宿筛选' });
    const d1 = addDay(book);
    const page = document.getElementById('page');
    document.querySelector('[data-modal]')?.remove();
    await planner.render(page);
    await wait(80);
    // 去除“今晚住宿”选项后，页面不再存在 data-stayset 按钮
    assert.eq(page.querySelectorAll('[data-stayset]').length, 0);
    assert.eq(page.querySelectorAll('[data-stayclear]').length, 0);
  });

  it('【问题8】生成页左右布局：行程全部展开/地图在右', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const a = addItemToLibrary(state.library, { name: '店A', location: '104.05,30.66' });
    const b2 = addItemToLibrary(state.library, { name: '店B', location: '104.08,30.64' });
    const c3 = addItemToLibrary(state.library, { name: '店C', location: '104.03,30.61' });
    const book = createBook({ name: '布局测试', origin: '成都东站' });
    const d1 = addDay(book, '2026-10-01');
    const d2 = addDay(book);
    const d3 = addDay(book);
    [a, b2].forEach(x => book.days[0].stopItemIds.push(x.id));
    [b2, c3].forEach(x => book.days[1].stopItemIds.push(x.id));
    [c3, a].forEach(x => book.days[2].stopItemIds.push(x.id));
    const page = document.getElementById('page');
    document.querySelector('[data-modal]')?.remove();
    await generate.render(page);
    await wait(900);
    // 左右布局
    const layout = page.querySelector('.gen-layout');
    assert.includes(getComputedStyle(layout).gridTemplateColumns.split(' ').length >= 2 ? 'two-col' : '', 'two-col');
    assert.ok(page.querySelector('.gen-left'), '左侧行程列应存在');
    assert.ok(page.querySelector('.gen-right .gen-map'), '右侧地图应存在');
    // 三天全部展开
    const details = [...page.querySelectorAll('[data-genday]')];
    assert.eq(details.length, 3);
    assert.ok(details.every(x => x.open), '每天行程应全部展开');
    // D1~D3 每天的每一段都有距离（缓存+重试后mock全成功）
    details.forEach(dd => {
      const arrows = [...dd.querySelectorAll('.gen-arrow')];
      assert.eq(arrows.length, dd.querySelectorAll('.gen-stop').length - 1);
      arrows.forEach(ar => assert.includes(ar.querySelector('.gdist')?.textContent || '', '公里'));
    });
    // 地图画线覆盖三天（三种颜色）
    const AMap = await (await import('../../js/core/amap.js')).loadAMap({ forceMock: true });
    const genMap = AMap.Map.instances[AMap.Map.instances.length - 1];
    const colors = new Set(genMap.overlays.filter(o => o.opts?.strokeColor).map(o => o.opts.strokeColor));
    assert.gte(colors.size, 3, 'D1/D2/D3 都应有导航线');
  });
});
