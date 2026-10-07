import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { locToStr, strToLoc, normPos } from '../../js/core/utils.js';
import { findExistingItem, addItemToLibrary, removeItemEverywhere } from '../../js/core/libraryOps.js';
import { loadAMap, centerOnCurrentLocation } from '../../js/core/amap.js';
import * as picker from '../../js/pages/picker.js';

function resetState() {
  state.settings = { amapKey: 'TEST', securityCode: '', guideDismissed: false };
  state.library = { categories: [{ id: 'c_food', name: '美食', order: 1 }, { id: 'c_play', name: '游玩', order: 2 }], tags: [{ id: 't1', name: '川菜' }], items: [] };
  state.books = [];
  state.ui = { lastBookId: null };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

describe('M3 坐标工具', () => {
  it('locToStr / strToLoc / normPos 互转', () => {
    const s = locToStr([104.055, 30.663]);
    assert.eq(s, '104.055,30.663');
    assert.eq(strToLoc(s), [104.055, 30.663]);
    assert.eq(strToLoc(''), null);
    assert.eq(normPos({ lng: 104.1, lat: 30.2 }), [104.1, 30.2]);
    assert.eq(normPos([1, 2]), [1, 2]);
    assert.eq(normPos(null), null);
  });
});

describe('M3 信息库条目操作', () => {
  it('findExistingItem：poiId判重优先，其次名称+坐标（容忍微小误差）', () => {
    resetState();
    const lib = state.library;
    addItemToLibrary(lib, { name: '宽窄巷子', amapPoiId: 'B001SEM0X1', location: '104.0550,30.6630', categoryId: 'c_play' });
    // 同 poiId
    assert.eq(findExistingItem(lib, { amapPoiId: 'B001SEM0X1', name: '宽窄巷子', location: [104.055, 30.663] })?.name, '宽窄巷子');
    // 无 poiId，同名同坐标（偏差小于万分之一）
    assert.eq(findExistingItem(lib, { name: '宽窄巷子', location: [104.05501, 30.66298] })?.name, '宽窄巷子');
    // 不同名不同坐标 → 不算重复
    assert.eq(findExistingItem(lib, { name: '别的地方', location: [104.055, 30.663] }), null);
    assert.eq(findExistingItem(lib, { name: '宽窄巷子', location: [104.06, 30.7] }), null);
  });

  it('addItemToLibrary：字段完整入库', () => {
    resetState();
    const item = addItemToLibrary(state.library, {
      name: '小名堂', amapPoiId: 'B1', location: '104.05,30.66',
      categoryId: 'c_food', tagIds: ['t1'], note: '人均80', tel: '123', type: '餐饮',
    });
    assert.ok(item.id.startsWith('i_'));
    assert.eq(state.library.items.length, 1);
    assert.eq(item.categoryId, 'c_food');
    assert.eq(item.tagIds, ['t1']);
    assert.eq(item.note, '人均80');
  });

  it('removeItemEverywhere：级联清理路书行程与住宿引用', () => {
    resetState();
    const i1 = addItemToLibrary(state.library, { name: '甲', location: '104,30' });
    const i2 = addItemToLibrary(state.library, { name: '乙', location: '104.1,30.1' });
    state.books = [{
      id: 'b1', name: '书', days: [
        { id: 'd1', label: 'D1', stopItemIds: [i1.id, i2.id], stayItemId: i2.id },
        { id: 'd2', label: 'D2', stopItemIds: [i1.id], stayItemId: null },
      ],
    }];
    const affected = removeItemEverywhere(i1.id);
    assert.eq(state.library.items.length, 1);
    assert.eq(state.books[0].days[0].stopItemIds, [i2.id]);
    assert.eq(state.books[0].days[1].stopItemIds, []);
    assert.eq(affected.length, 2);
    assert.eq(affected.every(a => a.dayLabel === 'D1' || a.dayLabel === 'D2'), true);

    const affected2 = removeItemEverywhere(i2.id);
    assert.eq(state.books[0].days[0].stayItemId, null);
    assert.ok(affected2.some(a => a.kind === '当晚住宿'));
  });
});

describe('M3 地图选点（Mock高德 DOM集成）', () => {
  const page = document.getElementById('page');

  async function freshPicker() {
    resetState();
    document.querySelector('[data-modal]')?.remove();
    await picker.render(page);
    await wait(60);
  }

  it('loadAMap forceMock 返回Mock且带测试POI', async () => {
    const AMap = await loadAMap({ forceMock: true });
    assert.ok(AMap.__POIS__.length >= 5);
  });

  it('渲染页面：地图容器被Mock接管', async () => {
    await freshPicker();
    const AMap = await loadAMap({ forceMock: true });
    assert.gte(AMap.Map.instances.length, 1, 'Mock地图实例应存在');
    assert.has(page, '[data-page="picker"]');
  });

  it('输入≥3字出候选，<3字清空（PRD规则）', async () => {
    await freshPicker();
    const kw = page.querySelector('[data-kw]');
    // 2字不触发
    kw.value = '宽窄';
    kw.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(450);
    assert.eq(page.querySelector('[data-cands]').children.length, 0, '2字不应出候选');
    // 4字触发
    kw.value = '宽窄巷子';
    kw.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(450);
    assert.eq(page.querySelectorAll('[data-cands] [data-tip]').length, 2, '应有2个候选');
    // 1字清空
    kw.value = '宽';
    kw.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(450);
    assert.eq(page.querySelector('[data-cands]').children.length, 0, '不足3字应清空候选');
  });

  it('点候选→详情卡+地图定位落标记', async () => {
    await freshPicker();
    const AMap = await loadAMap({ forceMock: true });
    const map = AMap.Map.instances[AMap.Map.instances.length - 1];
    const kw = page.querySelector('[data-kw]');
    kw.value = '大熊猫';
    kw.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(450);
    const cand = page.querySelector('[data-cands] [data-tip]');
    assert.ok(cand, '应有候选');
    cand.click();
    await wait(60);
    const detail = page.querySelector('[data-detail]');
    assert.notOk(detail.hidden, '详情卡应显示');
    assert.includes(detail.textContent, '成都大熊猫繁育研究基地');
    assert.eq(map.zoom, 16);
    assert.eq(map.getOverlayCount(), 1, '地图应有一个标记');
  });

  it('加入信息库：归类弹窗→入库→防重复→会话列表可撤销', async () => {
    await freshPicker();
    const kw = page.querySelector('[data-kw]');
    kw.value = '小名堂';
    kw.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(450);
    page.querySelector('[data-cands] [data-tip]').click();
    await wait(60);
    page.querySelector('[data-detail] [data-act="add"]').click();
    await wait(30);
    // 归类弹窗
    const modal = document.querySelector('[data-modal]');
    assert.ok(modal, '归类弹窗应出现');
    modal.querySelector('select[name="categoryId"]').value = 'c_food';
    // 新建标签：输入回车
    const newTag = modal.querySelector('.tagsel .newtag');
    newTag.value = '必去';
    newTag.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // 选中已有标签
    modal.querySelector('.tagsel .tag-opt').classList.add('active');
    modal.querySelector('[data-act="ok"]').click();
    await wait(30);
    assert.eq(state.library.items.length, 1, '应入库一条');
    const item = state.library.items[0];
    assert.eq(item.categoryId, 'c_food');
    assert.ok(item.tagIds.includes('必去'), '新标签应生效');
    assert.ok(item.tagIds.includes('t1'), '已有标签应选中');
    assert.eq(state.library.tags.some(t => t.id === '必去'), true, '新标签应写入标签表');
    // 防重复：详情卡变"已在收藏/信息库"
    await wait(30);
    const detail = page.querySelector('[data-detail]');
    assert.ok(detail.textContent.includes('已在收藏') || detail.textContent.includes('已在信息库'), '应显示已在收藏/信息库');
    assert.notHas(detail, '[data-act="add"]', '不应再有入库按钮');
    // 会话列表与撤销
    const undoBtn = page.querySelector('[data-undo]');
    assert.ok(undoBtn, '会话列表应有撤销按钮');
    undoBtn.click();
    await wait(30);
    assert.eq(state.library.items.length, 0, '撤销后应移除');
    assert.notOk(page.querySelector('[data-undo]'), '撤销后列表应清空');
  });

  it('地图底图左键点击地点：触发热点/逆地理编码并支持加入收藏', async () => {
    await freshPicker();
    const AMap = await loadAMap({ forceMock: true });
    const map = AMap.Map.instances[AMap.Map.instances.length - 1];

    // 模拟点击底图已有的 POI 热点 (hotspotclick)
    map.emit('hotspotclick', {
      id: 'mock_hotspot_1',
      name: '锦里古街',
      lnglat: [104.051, 30.647],
    });
    await wait(60);

    const detail = page.querySelector('[data-detail]');
    assert.notOk(detail.hidden, '点击地图POI后详情卡应显示');
    assert.includes(detail.textContent, '锦里古街');
    assert.has(detail, '[data-act="add"]', '详情卡应有加入收藏按钮');

    // 点击“加入收藏”
    detail.querySelector('[data-act="add"]').click();
    await wait(30);

    const modal = document.querySelector('[data-modal]');
    assert.ok(modal, '应弹出归类入库弹窗');
    modal.querySelector('[data-act="ok"]').click();
    await wait(40);

    // 验证入库成功
    assert.eq(state.library.items.some(i => i.name === '锦里古街'), true, '锦里古街应成功入库');
    assert.notHas(detail, '[data-act="add"]', '已入库后不应再显示加入收藏按钮');
  });

  it('地图任意位置点击：Geocoder逆地理编码并落点弹窗加入收藏', async () => {
    await freshPicker();
    const AMap = await loadAMap({ forceMock: true });
    const map = AMap.Map.instances[AMap.Map.instances.length - 1];

    // 模拟点击地图坐标 (click)
    map.emit('click', {
      lnglat: [104.0655, 30.657],
    });
    await wait(80);

    const detail = page.querySelector('[data-detail]');
    assert.notOk(detail.hidden, '点击地图后详情卡应显示');
    assert.includes(detail.textContent, '天府广场');
    assert.has(detail, '[data-act="add"]', '详情卡应有加入收藏按钮');
  });

  it('centerOnCurrentLocation：定位成功或降级时设置地图中心', async () => {
    const AMap = await loadAMap({ forceMock: true });
    const map = new AMap.Map(document.createElement('div'), { zoom: 10, center: [104.0, 30.0] });
    await centerOnCurrentLocation(map, 12, 500);
    assert.ok(map.center, '地图应被设置中心点');
  });
});
