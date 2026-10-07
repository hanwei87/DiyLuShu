import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import {
  addDay, removeDayById, dayLabel, dayStartAnchor, setStay, clearStay,
  insertStop, moveStop, removeStopById, routeChain,
} from '../../js/core/plannerOps.js';
import { optimizeOrder, twoOpt, pathLength } from '../../js/core/optimizer.js';
import * as planner from '../../js/pages/planner.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

function resetState() {
  state.settings = { amapKey: 'TEST', securityCode: '', guideDismissed: false };
  state.library = {
    categories: [{ id: 'c_food', name: '美食', order: 1 }, { id: 'c_hotel', name: '酒店', order: 2 }, { id: 'c_play', name: '游玩', order: 3 }],
    tags: [],
    items: [],
  };
  state.books = [];
  state.ui = { lastBookId: null };
}

function seed() {
  resetState();
  const items = {
    kuai: addItemToLibrary(state.library, { name: '宽窄巷子', categoryId: 'c_play', location: '104.0550,30.6630' }),
    xmt: addItemToLibrary(state.library, { name: '小名堂冒烤鸭', categoryId: 'c_food', location: '104.0535,30.6645' }),
    jinli: addItemToLibrary(state.library, { name: '锦里古街', categoryId: 'c_play', location: '104.0430,30.6440' }),
    atour: addItemToLibrary(state.library, { name: '亚朵酒店', categoryId: 'c_hotel', location: '104.0650,30.6570' }),
    homeinn: addItemToLibrary(state.library, { name: '如家酒店', categoryId: 'c_hotel', location: '104.0700,30.6550' }),
    panda: addItemToLibrary(state.library, { name: '熊猫基地', categoryId: 'c_play', location: '104.1470,30.7330' }),
  };
  const book = createBook({ name: '成都三日游' }); // 起终点概念已全局移除（三轮反馈1）
  const d1 = addDay(book, '2026-10-01');
  insertStop(book, d1.id, items.kuai.id);
  insertStop(book, d1.id, items.xmt.id);
  setStay(book, d1.id, items.atour.id);
  const d2 = addDay(book, '2026-10-02');
  insertStop(book, d2.id, items.jinli.id);
  return { book, d1, d2, items };
}

describe('M5 行程操作（plannerOps）', () => {
  it('addDay/dayLabel/removeDayById：标签自动重排', () => {
    const { book, d1, d2 } = seed();
    assert.eq(dayLabel(book, d1.id), 'D1');
    assert.eq(dayLabel(book, d2.id), 'D2');
    const d3 = addDay(book);
    assert.eq(dayLabel(book, d3.id), 'D3');
    removeDayById(book, d2.id);
    assert.eq(dayLabel(book, d3.id), 'D2');
    assert.notOk(removeDayById(book, '不存在'));
  });

  it('dayStartAnchor：住宿优先→上一天末条目→无锚点为null（自由出发）', () => {
    const { book, d1, d2, items } = seed();
    // D1: 无前一天且无整趟起点 → null（页面显示"自由出发"）
    assert.eq(dayStartAnchor(book, d1.id), null);
    // D2: D1有住宿 → 住宿
    assert.eq(dayStartAnchor(book, d2.id), { type: 'item', id: items.atour.id });
    // 新D3: D2无住宿但有条目 → D2最后一个条目
    const d3 = addDay(book);
    assert.eq(dayStartAnchor(book, d3.id), { type: 'item', id: items.jinli.id });
    // 全空书且无起点
    const empty = createBook({ name: '空' });
    const ed = addDay(empty);
    assert.eq(dayStartAnchor(empty, ed.id), null);
  });

  it('setStay：住宿从条目列表移出；insertStop拒绝住宿id；clearStay', () => {
    const { book, d1, items } = seed();
    // 把住宿条目再插入条目列表会被拒绝
    assert.notOk(insertStop(book, d1.id, items.atour.id));
    // 换住宿：新住宿原先在条目里则被移出
    insertStop(book, d1.id, items.homeinn.id);
    setStay(book, d1.id, items.homeinn.id);
    assert.eq(d1.stayItemId, items.homeinn.id);
    assert.notOk(d1.stopItemIds.includes(items.homeinn.id));
    clearStay(book, d1.id);
    assert.eq(d1.stayItemId, null);
  });

  it('moveStop：同天重排与跨天移动', () => {
    const { book, d1, d2, items } = seed();
    insertStop(book, d1.id, items.panda.id);
    assert.eq(d1.stopItemIds, [items.kuai.id, items.xmt.id, items.panda.id]);
    // 同天：把第一个移到最后（toIndex按移除后数组）
    moveStop(book, d1.id, d1.id, items.kuai.id, 2);
    assert.eq(d1.stopItemIds, [items.xmt.id, items.panda.id, items.kuai.id]);
    // 跨天
    moveStop(book, d1.id, d2.id, items.panda.id, 0);
    assert.notOk(d1.stopItemIds.includes(items.panda.id));
    assert.eq(d2.stopItemIds, [items.panda.id, items.jinli.id]);
    // 跨天目标day的住宿拦截
    setStay(book, d2.id, items.atour.id);
    assert.notOk(moveStop(book, d1.id, d2.id, items.atour.id, 0));
  });

  it('removeStopById / routeChain：链路含住宿锚且相邻去重（无起终点概念）', () => {
    const { book, d1, d2, items } = seed();
    removeStopById(book, d1.id, items.xmt.id);
    assert.eq(d1.stopItemIds, [items.kuai.id]);
    // D1链：条目 + 住宿
    assert.eq(routeChain(book, d1.id), [
      { type: 'item', id: items.kuai.id },
      { type: 'item', id: items.atour.id },
    ]);
    // D2链：前一天住宿开头 + 自己条目（起终点概念已移除，不再有origin/dest块）
    assert.eq(routeChain(book, d2.id), [
      { type: 'item', id: items.atour.id },
      { type: 'item', id: items.jinli.id },
    ]);
    // 相邻重复去除：D1最后一个条目===D2住宿情形
    insertStop(book, d1.id, items.jinli.id);
    removeStopById(book, d2.id, items.jinli.id);
    setStay(book, d2.id, items.jinli.id);
    assert.eq(routeChain(book, d2.id).length, 2, '锚点与住宿相邻重复应去重');
  });
});

describe('M5 智能排序（optimizer）', () => {
  const S = [104, 30.6], E = [104, 30.7];
  const M1 = [104, 30.62], M2 = [104, 30.65], M3 = [104, 30.68];

  it('≤2个中间点直接原样返回', () => {
    const out = optimizeOrder([{ id: 'a', location: M1 }, { id: 'b', location: M2 }], S, E);
    assert.eq(out, ['a', 'b']);
  });

  it('线状行程输出最优顺序（不走回头路）', () => {
    const out = optimizeOrder([
      { id: 'm3', location: M3 }, { id: 'm1', location: M1 }, { id: 'm2', location: M2 },
    ], S, E);
    assert.eq(out, ['m1', 'm2', 'm3']);
  });

  it('两端锚点固定：结果总路径不大于原始顺序', () => {
    const stops = [
      { id: 'a', location: [104.05, 30.62] },
      { id: 'b', location: [103.95, 30.68] },
      { id: 'c', location: [104.05, 30.69] },
      { id: 'd', location: [103.97, 30.63] },
    ];
    const origLen = pathLength([0, 1, 2, 3], stops.map(s => s.location), S, E);
    const out = optimizeOrder(stops, S, E);
    const pts = stops.map(s => s.location);
    const outLen = pathLength(out.map(id => stops.findIndex(s => s.id === id)), pts, S, E);
    assert.ok(outLen <= origLen + 1e-6, `优化后(${outLen})应不劣于原始(${origLen})`);
    assert.eq([...out].sort(), ['a', 'b', 'c', 'd'], '地点集合应保持不变');
  });

  it('twoOpt：能跳出局部劣解（构造矩阵验证）', () => {
    // 1维线上：P0=0.001, P1=0.003, P2=0.002；start=0, end=0.004
    // 劣解顺序 P0→P1→P2 有折返，2-opt 应反转为 P0→P2→P1
    const pts = [[0.001, 0], [0.003, 0], [0.002, 0]];
    const start = [0, 0], end = [0.004, 0];
    const order = [0, 1, 2];
    const before = pathLength(order, pts, start, end);
    const fixed = twoOpt(order, pts, start, end);
    const after = pathLength(fixed, pts, start, end);
    assert.ok(after < before, `2-opt应改进: ${after} < ${before}`);
    assert.eq(fixed, [0, 2, 1], '应得到 0.001→0.002→0.003 的顺序');
  });

  it('无start时也能优化；确定性（同输入同输出）', () => {
    const stops = [
      { id: 'x', location: [104.02, 30.66] },
      { id: 'y', location: [104.01, 30.64] },
      { id: 'z', location: [104.03, 30.68] },
    ];
    const out1 = optimizeOrder(stops, null, E);
    const out2 = optimizeOrder(stops, null, E);
    assert.eq(out1, out2);
    assert.eq([...out1].sort(), ['x', 'y', 'z']);
  });
});

describe('M5 规划页（DOM集成 + Mock地图）', () => {
  const page = document.getElementById('page');

  async function freshPlanner() {
    const { book } = seed();
    document.querySelector('[data-modal]')?.remove();
    await planner.render(page);
    await new Promise(r => setTimeout(r, 80));
    return { book };
  }

  it('三栏渲染：天卡片、锚点行、住宿行、信息库行', async () => {
    await freshPlanner();
    assert.has(page, '[data-page="planner"]');
    assert.includes(page.querySelector('[data-left]').textContent, 'D1');
    assert.includes(page.querySelector('[data-left]').textContent, 'D2');
    assert.includes(page.querySelector('[data-left]').textContent, '从：自由出发');
    assert.includes(page.querySelector('[data-left]').textContent, '从：亚朵酒店');
    assert.includes(page.querySelector('[data-left]').textContent, '今晚住宿：亚朵酒店');
    assert.eq(page.querySelectorAll('[data-day]').length, 2);
    assert.gte(page.querySelectorAll('[data-librow]').length, 5);
    // Sortable 已挂到各天容器与信息库列表
    const stopsBox = page.querySelector('[data-stops]');
    assert.ok(Object.keys(stopsBox).some(k => k.startsWith('Sortable')), '天容器应挂Sortable');
  });

  it('激活天切换 + ⊕追加到激活天', async () => {
    const { book } = await freshPlanner();
    const d2 = book.days[1];
    page.querySelector(`[data-day="${d2.id}"]`).click();
    await new Promise(r => setTimeout(r, 30));
    const d2Card = page.querySelector(`[data-day="${d2.id}"]`);
    assert.includes(d2Card.className, 'active', '点击后天应激活');
    const before = d2.stopItemIds.length;
    // 点击信息库第一行的⊕
    page.querySelector('[data-addplus]').click();
    await new Promise(r => setTimeout(r, 30));
    const activeNow = [...page.querySelectorAll('[data-day]')].find(c => c.className.includes('active'))?.dataset.day;
    assert.eq(d2.stopItemIds.length, before + 1,
      `⊕应追加到激活天: 实际长度${d2.stopItemIds.length} before=${before} activeDay=${activeNow} 期望day=${d2.id} 首行item=${page.querySelector('[data-addplus]')?.closest('[data-librow]')?.dataset.itemId}`);
  });

  it('测试钩子：跨天移动与同天重排（Sortable回调走的同一套模型逻辑）', async () => {
    const { book } = await freshPlanner();
    const [d1, d2] = book.days;
    const hooks = planner.__testHooks(page);
    const itemId = d1.stopItemIds[0];
    hooks.onMoveAcross(d1.id, d2.id, itemId, 0);
    assert.eq(d2.stopItemIds[0], itemId);
    assert.notOk(d1.stopItemIds.includes(itemId));
    // 同天重排
    const arr = d2.stopItemIds.slice();
    if (arr.length >= 2) {
      hooks.onReorder(d2.id, arr[0], arr.length - 1);
      assert.eq(d2.stopItemIds[d2.stopItemIds.length - 1], arr[0]);
    }
  });

  it('住宿选择弹窗：默认酒店靠前，选中后生效并清除条目重复', async () => {
    const { book } = await freshPlanner();
    const d2 = book.days[1];
    page.querySelector(`[data-stayset="${d2.id}"]`).click();
    await new Promise(r => setTimeout(r, 30));
    const modal = document.querySelector('[data-modal]');
    assert.ok(modal, '住宿弹窗应出现');
    const firstBtn = modal.querySelector('[data-pickstay]');
    // 默认列表酒店类在前
    assert.includes(firstBtn.textContent, '亚朵酒店');
    firstBtn.click();
    await new Promise(r => setTimeout(r, 30));
    assert.eq(d2.stayItemId, firstBtn.dataset.pickstay);
    assert.includes(page.querySelector('[data-left]').textContent, '今晚住宿：亚朵酒店');
  });

  it('日期选择（周一起始弹层）/ 添加一天自动延续日期 / 删除一天（确认）/ 移除条目', async () => {
    const { book } = await freshPlanner();
    // 打开日期弹层
    page.querySelector(`[data-datebtn="${book.days[0].id}"]`).click();
    await wait(30);
    const pop = document.querySelector('.datepop');
    assert.ok(pop, '日期弹层应出现');
    // 每周第一天为周一
    assert.eq(pop.querySelector('.dp-week').firstElementChild.textContent, '一');
    assert.eq(pop.querySelector('.dp-week').lastElementChild.textContent, '日');
    // 测试切换月份：点击上个月，弹层保持打开且月份递减
    const prevMonthBtn = pop.querySelector('[data-dpprev]');
    assert.ok(prevMonthBtn, '应有上个月按钮');
    prevMonthBtn.click();
    await wait(30);
    let popCur = document.querySelector('.datepop');
    assert.ok(popCur, '点击上个月后弹层仍应保持打开');
    assert.includes(popCur.querySelector('.dp-head strong').textContent, '9月');

    // 点击下个月，切回 10月
    popCur.querySelector('[data-dpnext]').click();
    await wait(30);
    popCur = document.querySelector('.datepop');
    assert.ok(popCur, '点击下个月后弹层仍应保持打开');
    assert.includes(popCur.querySelector('.dp-head strong').textContent, '10月');

    // 再次点击下个月，切换到 11月
    popCur.querySelector('[data-dpnext]').click();
    await wait(30);
    popCur = document.querySelector('.datepop');
    assert.ok(popCur, '再次点击下个月弹层仍保持打开');
    assert.includes(popCur.querySelector('.dp-head strong').textContent, '11月');

    // 点击上个月切回 10月并选 10月11日
    popCur.querySelector('[data-dpprev]').click();
    await wait(30);
    popCur = document.querySelector('.datepop');
    popCur.querySelector('[data-pickdate="2026-10-11"]').click();
    await wait(30);
    assert.eq(book.days[0].date, '2026-10-11');
    assert.notOk(document.querySelector('.datepop'), '选择后弹层应关闭');
    // 删除原有D2后，再添加一天 → 日期自动从10-11延续为10-12
    page.querySelector(`[data-daydel="${book.days[1].id}"]`).click();
    await wait(30);
    document.querySelector('[data-modal] [data-act="ok"]').click();
    await wait(30);
    assert.eq(book.days.length, 1);
    page.querySelector('[data-act="addday"]').click();
    await wait(30);
    assert.eq(book.days.length, 2);
    assert.eq(book.days[1].date, '2026-10-12', '新的一天日期应自动延续');
    assert.includes(page.querySelector('[data-left]').textContent, 'D2');
    // 移除条目
    const day1 = book.days[0];
    const stopId = day1.stopItemIds[0];
    page.querySelector(`[data-stopdel="${day1.id}|${stopId}"]`).click();
    await wait(30);
    assert.notOk(day1.stopItemIds.includes(stopId));
  });

  it('⚡优化顺序：线状行程重排为就近顺序', async () => {
    const { book, items } = seed();
    const d1 = book.days[0];
    // 构造折返：熊猫基地在最北，故意排中间
    d1.stopItemIds = [items.kuai.id, items.panda.id, items.xmt.id];
    document.querySelector('[data-modal]')?.remove();
    await planner.render(page);
    await new Promise(r => setTimeout(r, 60));
    page.querySelector(`[data-opt="${d1.id}"]`).click();
    await new Promise(r => setTimeout(r, 400));
    // 宽窄巷子(30.663)与小名堂(30.6645)相邻，熊猫基地(30.733)应被移到一端
    const names = d1.stopItemIds.map(id => state.library.items.find(i => i.id === id).name);
    const pandaPos = names.indexOf('熊猫基地');
    assert.ok(pandaPos === 0 || pandaPos === names.length - 1, `熊猫基地应在一端，实际顺序: ${names.join(',')}`);
  });

  it('地图联动：点条目落标记；连线开关画线', async () => {
    const { book } = await freshPlanner();
    const AMap = await (await import('../../js/core/amap.js')).loadAMap({ forceMock: true });
    const map = AMap.Map.instances[AMap.Map.instances.length - 1];
    // 点条目定位
    page.querySelector('[data-locate]').click();
    await new Promise(r => setTimeout(r, 30));
    const afterLocate = map.getOverlayCount();
    assert.gte(afterLocate, 1, '应有定位标记');
    // 开启连线
    const toggle = page.querySelector('[data-showroute]');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));
    const afterRoute = map.getOverlayCount();
    assert.gt(afterRoute, afterLocate, '连线应增加地图覆盖物');
  });

  it('路书头编辑：改名；起点/目的地输入已按要求移除', async () => {
    const { book } = await freshPlanner();
    const nameInput = page.querySelector('[data-bookname]');
    nameInput.value = '改名之旅';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(30);
    assert.eq(book.name, '改名之旅');
    assert.notOk(page.querySelector('[data-origin]'), '起点输入应已移除（二轮反馈问题6）');
    assert.notOk(page.querySelector('[data-destination]'), '目的地输入应已移除');
    // 锚点行仍显示整趟起点信息（若书上有起点）
    assert.has(page, '.anchor-row');
  });
});
