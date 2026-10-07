import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import { addDay, insertStop, setStay, effectiveStayId } from '../../js/core/plannerOps.js';
import { loadAMap } from '../../js/core/amap.js';
import * as mybooks from '../../js/pages/mybooks.js';
import * as generate from '../../js/pages/generate.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const page = document.getElementById('page');

function seedTwoDays() {
  state.settings = { amapKey: 'T', securityCode: '', weatherKey: '', appName: '', guideDismissed: true };
  state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }, { id: 'c2', name: '美食', order: 2 }], tags: [{ id: 't1', name: '川菜' }, { id: 't2', name: '亲子' }], items: [] };
  state.books = [];
  state.ui = { lastBookId: null };
  const a = addItemToLibrary(state.library, { name: '店A', location: '104.05,30.66', tagIds: ['t1'], address: '成都市青羊区A街1号' });
  const b2 = addItemToLibrary(state.library, { name: '店B', location: '104.08,30.64', tagIds: ['t2'], address: '成都市锦江区B街2号' });
  const c3 = addItemToLibrary(state.library, { name: '店C', location: '104.03,30.61', address: '成都市武侯区C街3号' });
  const hotel = addItemToLibrary(state.library, { name: '酒店H', location: '104.06,30.65', address: '成都市青羊区H路8号' });
  const book = createBook({ name: '标签测试' });
  const d1 = addDay(book, '2026-10-01');
  insertStop(book, d1.id, a.id);
  insertStop(book, d1.id, b2.id);
  setStay(book, d1.id, hotel.id);
  const d2 = addDay(book, '2026-10-02');
  insertStop(book, d2.id, c3.id);
  setStay(book, d2.id, hotel.id);
  return { book, d1, d2, a, b2, c3, hotel };
}

describe('M18 十三轮反馈回归', () => {
  it('【问题4】effectiveStayId：未设住宿默认最后一个地点', () => {
    const d = { stayItemId: null, stopItemIds: ['x', 'y', 'z'] };
    assert.eq(effectiveStayId(d), 'z');
    d.stayItemId = 'h';
    assert.eq(effectiveStayId(d), 'h', '显式住宿优先');
    assert.eq(effectiveStayId({ stayItemId: null, stopItemIds: [] }), null);
  });

  it('【问题4】D1·1/跨天锚/住宿/终点的旗帜标识齐全', async () => {
    seedTwoDays();
    await generate.render(page);
    await wait(3000);
    const AMap = await loadAMap({ forceMock: true });
    const map = AMap.Map.instances[AMap.Map.instances.length - 1];
    const contents = map.overlays.filter(o => o.opts?.content).map(o => o.opts.content);
    assert.ok(contents.some(c => c.includes('D1·1') && c.includes('🚩')), 'D1起点应有小红旗');
    assert.ok(contents.some(c => c.includes('D1·3') && c.includes('🏨')), 'D1住宿应有标识');
    assert.ok(contents.some(c => c.includes('D2·1') && c.includes('🚩')), 'D2起点（继承住宿锚）应有小红旗');
    assert.ok(contents.some(c => c.includes('D2·3') && c.includes('🏨')), 'D2住宿应标识');
  });

  it('【问题5】编号标签后带对应二级标签', async () => {
    seedTwoDays();
    await generate.render(page);
    await wait(3000);
    const AMap = await loadAMap({ forceMock: true });
    const map = AMap.Map.instances[AMap.Map.instances.length - 1];
    const contents = map.overlays.filter(o => o.opts?.content).map(o => o.opts.content);
    const aTag = contents.find(c => c.includes('D1·1'));
    assert.includes(aTag, '#川菜', 'D1·1应带店A的二级标签');
    const bTag = contents.find(c => c.includes('D1·2'));
    assert.includes(bTag, '#亲子', 'D1·2应带店B的二级标签');
  });

  it('【问题3】鼠标悬停编号标签显示地点详情（title）', async () => {
    seedTwoDays();
    await generate.render(page);
    await wait(3000);
    const AMap = await loadAMap({ forceMock: true });
    const map = AMap.Map.instances[AMap.Map.instances.length - 1];
    const aMarker = map.overlays.find(o => o.opts?.content?.includes('D1·1'));
    const content = aMarker.opts.content;
    assert.includes(content, 'title="', '应有悬停title');
    assert.includes(content, '店A', 'title应含地点名');
    assert.includes(content, '成都市青羊区A街1号', 'title应含地址');
    assert.includes(content, '#川菜', 'title应含标签');
  });

  it('【问题2】路线重叠分层：展开某天高亮该天、其余变淡', async () => {
    seedTwoDays();
    await generate.render(page);
    await wait(3000);
    const AMap = await loadAMap({ forceMock: true });
    const map = AMap.Map.instances[AMap.Map.instances.length - 1];
    const linesOf = day => map.overlays.filter(o => o.opts?.strokeColor === day);
    const d1 = linesOf('#E53935'), d2 = linesOf('#1E88E5');
    assert.gte(d1.length, 1);
    assert.gte(d2.length, 1);
    // 初始：全程均衡
    assert.near(d1[0].opts.strokeOpacity, 0.85, 0.01);
    // 收起D1再展开D1 → 高亮D1：D1不透明加粗，D2变淡
    // 点击summary展开→高亮该天，再点击收起→恢复
    const summary1 = [...page.querySelectorAll('[data-genday]')][0];
    summary1.click(); // 首次点击=收起D1（默认展开）
    await wait(60);
    assert.near(d1[0].opts.strokeOpacity, 0.85, 0.01, '收起后恢复');
    summary1.click(); // 再次点击=展开D1
    await wait(60);
    assert.near(d1[0].opts.strokeOpacity, 0.9, 0.01, '高亮天不透明');
    assert.eq(d1[0].opts.strokeWeight, 6, '高亮天加粗');
    assert.near(d2[0].opts.strokeOpacity, 0.22, 0.01, '其余天变淡');
    assert.eq(d2[0].opts.strokeWeight, 4, '其余天变细');
  });

  it('【问题1】我的路书页：三个点弹出菜单（重命名/导出/删除），不跳页', async () => {
    state.settings = { amapKey: 'T', securityCode: '', weatherKey: '', appName: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    createBook({ name: '菜单书' });
    location.hash = '#/mybooks';
    document.querySelector('[data-modal]')?.remove();
    await mybooks.render(page);
    await wait(50);
    const hashBefore = location.hash;
    const more = page.querySelector('[data-menu]');
    assert.ok(more, '⋯按钮应存在');
    more.click();
    await wait(60);
    assert.ok(document.querySelector('[data-ctxmenu]'), '应弹出菜单而非跳页');
    assert.eq(location.hash, hashBefore, '不应跳页');
    const items = [...document.querySelectorAll('[data-ctxmenu] [data-m]')].map(b => b.dataset.m);
    assert.eq(items, ['rename', 'export', 'delete'], '菜单应为 重命名/导出/删除');
    document.querySelector('[data-ctxmenu] [data-m="rename"]').click();
    await wait(30);
    assert.ok(document.querySelector('[data-modal]'), '重命名应弹表单');
    document.querySelector('[data-modal] [data-act="cancel"]').click();
  });
});
