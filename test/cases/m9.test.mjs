import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import { addDay, insertStop, setStay } from '../../js/core/plannerOps.js';
import { loadAMap } from '../../js/core/amap.js';
import { fmtDistance, fmtDuration } from '../../js/core/utils.js';
import * as planner from '../../js/pages/planner.js';
import * as generate from '../../js/pages/generate.js';
import * as picker from '../../js/pages/picker.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

describe('M9 一轮反馈修复回归', () => {
  it('【问题1】hidden属性不被CSS覆盖：.banner隐藏后不可见', () => {
    const d = document.createElement('div');
    d.className = 'banner';
    d.hidden = true;
    document.body.appendChild(d);
    assert.eq(getComputedStyle(d).display, 'none', 'hidden应生效');
    d.hidden = false;
    assert.notEq(getComputedStyle(d).display, 'none');
    d.remove();
  });

  it('【问题4】距离/用时格式化', () => {
    assert.eq(fmtDistance(500), '500米');
    assert.eq(fmtDistance(12345), '12.3公里');
    assert.eq(fmtDistance(0), '');
    assert.eq(fmtDistance(-1), '');
    assert.eq(fmtDuration(30), '1分钟内');
    assert.eq(fmtDuration(1500), '25分钟');
    assert.eq(fmtDuration(3600), '1小时');
    assert.eq(fmtDuration(3900), '1小时5分钟');
    assert.eq(fmtDuration(0), '');
  });

  it('【问题2】选点：地图坐标优先用候选点自带位置', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const page = document.getElementById('page');
    document.querySelector('[data-modal]')?.remove();
    await picker.render(page);
    await wait(60);
    const kw = page.querySelector('[data-kw]');
    kw.value = '大熊猫';
    kw.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(450);
    page.querySelector('[data-cands] [data-tip]').click();
    await wait(100);
    const detail = page.querySelector('[data-detail]');
    assert.eq(detail.dataset.location, '104.147,30.733', '应使用候选点坐标');
    assert.includes(detail.textContent, '成都大熊猫繁育研究基地');
    assert.includes(detail.textContent, '028-83516748', '电话详情按POI id精确匹配获得');
  });

  it('【问题3】规划页：⊕最左/行内二级标签/点分类铺全类/点条目单独显示', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true };
    state.library = {
      categories: [{ id: 'c_food', name: '美食', order: 1 }, { id: 'c_play', name: '游玩', order: 2 }],
      tags: [{ id: 't1', name: '川菜' }],
      items: [],
    };
    state.books = [];
    state.ui = { lastBookId: null };
    const kuai = addItemToLibrary(state.library, { name: '宽窄巷子', categoryId: 'c_play', location: '104.0550,30.6630' });
    const xmt = addItemToLibrary(state.library, { name: '小名堂', categoryId: 'c_food', tagIds: ['t1'], location: '104.0535,30.6645' });
    const jinli = addItemToLibrary(state.library, { name: '锦里', categoryId: 'c_play', location: '104.0430,30.6440' });
    const book = createBook({ name: '测试', origin: '成都东站' });
    const d1 = addDay(book);
    insertStop(book, d1.id, kuai.id);
    const page = document.getElementById('page');
    document.querySelector('[data-modal]')?.remove();
    await planner.render(page);
    await wait(80);

    // ⊕ 是行内第一个元素（最左侧）
    const xmtRow = [...page.querySelectorAll('[data-librow]')].find(r => r.querySelector('.nm').textContent === '小名堂');
    assert.ok(xmtRow.firstElementChild?.hasAttribute('data-addplus'), '⊕应在最左侧');
    // 行内显示二级标签
    assert.includes(xmtRow.querySelector('.chips').textContent, '#川菜');
    const kuaiRow = [...page.querySelectorAll('[data-librow]')].find(r => r.querySelector('.nm').textContent === '宽窄巷子');
    assert.notOk([...kuaiRow.querySelectorAll('.chips .chip')].some(c => c.textContent.includes('#')), '无标签不显示#标签（✓标识不算标签）');

    // 点一级分类 → 地图铺该分类全部条目位置
    const AMap = await loadAMap({ forceMock: true });
    const map = AMap.Map.instances[AMap.Map.instances.length - 1];
    const before = map.getOverlayCount();
    page.querySelector('[data-libcat="c_play"]').click();
    await wait(120);
    assert.gte(map.getOverlayCount(), before + 2, '游玩分类应有2个标记');
    const titles = map.overlays.filter(o => o.opts?.title).map(o => o.opts.title);
    assert.ok(titles.includes('宽窄巷子') && titles.includes('锦里'), '标记应覆盖分类内全部条目');

    // 点具体条目 → 单独只显示该条目（分类点击会过滤列表，先切回"全部"再定位）
    page.querySelector('[data-libcat="__all"]').click();
    await wait(120);
    const xmtRow2 = [...page.querySelectorAll('[data-librow]')].find(r => r.querySelector('.nm').textContent === '小名堂');
    assert.ok(xmtRow2, '切回全部后应能找到条目行');
    xmtRow2.querySelector('[data-locate]').click();
    await wait(120);
    assert.eq(map.getOverlayCount(), 1, '应只剩该条目一个标记');
    void jinli;
  });

  it('【问题4】生成页：地点带标签/箭头带距离用时/可选高速并重算', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true, appName: '' };
    state.library = { categories: [{ id: 'c1', name: '酒店', order: 1 }], tags: [{ id: 't1', name: '川菜' }], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const a = addItemToLibrary(state.library, { name: '店A', location: '104.05,30.66', tagIds: ['t1'] });
    const b2 = addItemToLibrary(state.library, { name: '店B', location: '104.08,30.64' });
    const hotel = addItemToLibrary(state.library, { name: '酒店H', location: '104.06,30.65' });
    const book = createBook({ name: '生成测试', origin: '成都东站', destination: '春熙路' });
    const d1 = addDay(book, '2026-10-01');
    insertStop(book, d1.id, a.id);
    insertStop(book, d1.id, b2.id);
    setStay(book, d1.id, hotel.id);
    const page = document.getElementById('page');
    document.querySelector('[data-modal]')?.remove();
    await generate.render(page);
    await wait(2500);

    // 每个条目块下方有二级标签
    const stops = [...page.querySelectorAll('.gen-stop')];
    const aBlock = stops.find(s => s.querySelector('.gname')?.textContent.includes('店A'));
    assert.ok(aBlock, '应有店A块');
    assert.includes(aBlock.querySelector('.gtags')?.textContent || '', '#川菜');
    const bBlock = stops.find(s => s.querySelector('.gname')?.textContent.includes('店B'));
    assert.ok(bBlock, '应找到店B块');
    assert.notOk(bBlock?.querySelector('.gtags'), '无标签的条目不显示标签区');

    // 箭头下显示距离与用时（Mock下起终点均可解析）
    const arrows = [...page.querySelectorAll('.gen-arrow')];
    assert.eq(arrows.length, stops.length - 1, '箭头数=块数-1');
    arrows.forEach(ar => {
      assert.includes(ar.querySelector('.gdist')?.textContent || '', '公里', '每段应显示距离');
    });

    // 路线偏好选择：高速优先/不走高速，切换后重算
    const sel = page.querySelector('[data-policy]');
    assert.ok(sel, '应有路线偏好下拉');
    assert.includes(sel.textContent, '高速优先');
    assert.includes(sel.textContent, '不走高速');
    sel.value = '1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(2500);
    const arrows2 = [...page.querySelectorAll('.gen-arrow')];
    assert.eq(arrows2.length, arrows.length);
    arrows2.forEach(ar => {
      assert.includes(ar.querySelector('.gdist')?.textContent || '', '公里');
    });

    // 起点/住宿/终点编号标记（content标签，含图标后缀）
    const AMap = await loadAMap({ forceMock: true });
    const map = AMap.Map.instances[AMap.Map.instances.length - 1];
    const tags = map.overlays.filter(o => o.opts?.content).map(o => o.opts.content);
    assert.ok(tags.some(t => t.includes('🚩')), '起点标记');
    assert.ok(tags.some(t => t.includes('🏨')), '住宿标记');
    assert.ok(tags.some(t => t.includes('🏁')), '终点标记');
  });
});
