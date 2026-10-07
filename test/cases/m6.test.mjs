import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import { addDay, insertStop, setStay, routeChain } from '../../js/core/plannerOps.js';
import { optimizeOrder, pathLength } from '../../js/core/optimizer.js';
import * as planner from '../../js/pages/planner.js';

/** 成都真实点位（测试夹具） */
const CD = {
  station: [104.1390, 30.6290],  // 成都东站
  panda:   [104.1470, 30.7330],  // 熊猫基地
  chunxi:  [104.0810, 30.6570],  // 春熙路
  kuai:    [104.0550, 30.6630],  // 宽窄巷子
  jinli:   [104.0430, 30.6440],  // 锦里
  atour:   [104.0650, 30.6570],  // 亚朵酒店
};

const wait = ms => new Promise(r => setTimeout(r, ms));

describe('M6 智能排序专项', () => {
  it('真实成都一日游：优化后路径明显短于乱序', () => {
    const stops = [
      { id: 'kuai', location: CD.kuai },
      { id: 'panda', location: CD.panda },
      { id: 'jinli', location: CD.jinli },
      { id: 'chunxi', location: CD.chunxi },
    ];
    const out = optimizeOrder(stops, CD.station, CD.atour);
    const pts = stops.map(s => s.location);
    const outLen = pathLength(out.map(id => stops.findIndex(s => s.id === id)), pts, CD.station, CD.atour);
    // 乱序（先去西南锦里再跳东北熊猫基地再折返）是明显的回头路
    const badLen = pathLength([3, 1, 0, 2], pts, CD.station, CD.atour);
    assert.ok(outLen < badLen, `优化路径(${outLen.toFixed(0)}m)应短于乱序(${badLen.toFixed(0)}m)`);
    // 优化结果应把熊猫基地放在头或尾（它是离群点）
    assert.ok(out[0] === 'panda' || out[out.length - 1] === 'panda', `离群点应在端点: ${out.join(',')}`);
  });

  it('18个点性能：500ms内完成且集合不变', () => {
    const stops = [];
    for (let i = 0; i < 18; i++) {
      stops.push({
        id: 'p' + i,
        location: [104 + (i % 6) * 0.01 + (i % 3) * 0.003, 30.6 + Math.floor(i / 6) * 0.012 + (i % 2) * 0.004],
      });
    }
    const t0 = performance.now();
    const out = optimizeOrder(stops, CD.station, CD.atour);
    const cost = performance.now() - t0;
    assert.ok(cost < 500, `18点优化耗时${cost.toFixed(0)}ms 应<500ms`);
    assert.eq([...out].sort(), stops.map(s => s.id).sort());
  });

  it('重合坐标不 死循环、不丢点', () => {
    const stops = [
      { id: 'a', location: [104.05, 30.66] },
      { id: 'b', location: [104.05, 30.66] },
      { id: 'c', location: [104.05, 30.66] },
      { id: 'd', location: [104.06, 30.67] },
    ];
    const out = optimizeOrder(stops, [104, 30.6], [104.07, 30.68]);
    assert.eq([...out].sort(), ['a', 'b', 'c', 'd']);
  });

  it('0个和1个中间点直接返回', () => {
    assert.eq(optimizeOrder([], CD.station, CD.atour), []);
    assert.eq(optimizeOrder([{ id: 'only', location: CD.kuai }], CD.station, CD.atour), ['only']);
  });
});

describe('M6 规划页优化按钮容错（DOM）', () => {
  const page = document.getElementById('page');

  it('缺坐标的条目：不参与优化、保持在原相对位置末尾', async () => {
    state.settings = { amapKey: 'TEST', securityCode: '', guideDismissed: false };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const withLoc1 = addItemToLibrary(state.library, { name: '宽窄巷子', location: '104.0550,30.6630' });
    const noLoc = addItemToLibrary(state.library, { name: '没坐标的店', location: '' });
    const withLoc2 = addItemToLibrary(state.library, { name: '熊猫基地', location: '104.1470,30.7330' });
    const book = createBook({ name: '容错测试', origin: '成都东站' });
    const d1 = addDay(book);
    // 乱序：宽窄 → 熊猫（对角线折返）→ 没坐标
    insertStop(book, d1.id, withLoc1.id);
    insertStop(book, d1.id, withLoc2.id);
    insertStop(book, d1.id, noLoc.id);
    document.querySelector('[data-modal]')?.remove();
    await planner.render(page);
    await wait(80);
    page.querySelector(`[data-opt="${d1.id}"]`).click();
    await wait(400);
    // 两个有坐标的已就近排序（熊猫基地离东站近→在前），没坐标的保持在末尾
    assert.eq(d1.stopItemIds[d1.stopItemIds.length - 1], noLoc.id, '缺坐标条目应保持在末尾');
    assert.eq(d1.stopItemIds.length, 3, '不应丢条目');
    // 锚点链依然完整
    const chain = routeChain(book, d1.id);
    assert.eq(chain[0].type, 'origin');
  });

  it('只有住宿无条目的天：点优化不报错', async () => {
    state.books = [];
    state.ui = { lastBookId: null };
    const atour = addItemToLibrary(state.library, { name: '亚朵酒店', location: '104.0650,30.6570' });
    const book = createBook({ name: '空天测试', origin: '成都东站' });
    const d1 = addDay(book);
    setStay(book, d1.id, atour.id);
    document.querySelector('[data-modal]')?.remove();
    await planner.render(page);
    await wait(80);
    page.querySelector(`[data-opt="${d1.id}"]`).click();
    await wait(200);
    assert.eq(d1.stopItemIds.length, 0);
  });
});
