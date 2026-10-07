import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import { addDay, insertStop, setStay, routeChain } from '../../js/core/plannerOps.js';
import { dayColor, DAY_COLORS } from '../../js/core/routeDraw.js';
import { loadAMap } from '../../js/core/amap.js';
import * as generate from '../../js/pages/generate.js';

function resetState() {
  state.settings = { amapKey: 'TEST', securityCode: '', guideDismissed: false };
  state.library = { categories: [{ id: 'c_food', name: '美食', order: 1 }, { id: 'c_hotel', name: '酒店', order: 2 }, { id: 'c_play', name: '游玩', order: 3 }], tags: [], items: [] };
  state.books = [];
  state.ui = { lastBookId: null };
}

async function seedBook() {
  resetState();
  const kuai = addItemToLibrary(state.library, { name: '宽窄巷子', location: '104.0550,30.6630' });
  const xmt = addItemToLibrary(state.library, { name: '小名堂冒烤鸭', location: '104.0535,30.6645' });
  const jinli = addItemToLibrary(state.library, { name: '锦里古街', location: '104.0430,30.6440' });
  const atour = addItemToLibrary(state.library, { name: '亚朵酒店', location: '104.0650,30.6570', address: '四川省成都市青羊区人民中路二段' });
  const homeinn = addItemToLibrary(state.library, { name: '如家酒店', location: '104.0700,30.6550', address: '四川省成都市锦江区红星路' });
  const book = createBook({ name: '成都三日游', origin: '成都东站', destination: '春熙路' });
  const d1 = addDay(book, '2026-10-01');
  insertStop(book, d1.id, kuai.id);
  insertStop(book, d1.id, xmt.id);
  setStay(book, d1.id, atour.id);
  const d2 = addDay(book, '2026-10-02');
  insertStop(book, d2.id, jinli.id);
  setStay(book, d2.id, homeinn.id);
  return { book, d1, d2 };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

describe('M7 目的地参与链路', () => {
  it('多天书：中间天无目的地，最后一天有', async () => {
    const { book, d1, d2 } = await seedBook();
    const d3 = addDay(book, '2026-10-03');
    assert.notOk(routeChain(book, d1.id).some(e => e.type === 'dest'));
    assert.notOk(routeChain(book, d2.id).some(e => e.type === 'dest'));
    assert.ok(routeChain(book, d3.id).some(e => e.type === 'dest'));
    void d1;
  });

  it('配色：按天循环且可辨识', () => {
    assert.eq(dayColor(0), DAY_COLORS[0]);
    assert.eq(dayColor(DAY_COLORS.length), DAY_COLORS[0], '超出后循环');
    assert.eq(new Set(DAY_COLORS).size, DAY_COLORS.length, '颜色不重复');
  });
});

describe('M7 生成路书页（DOM集成 + Mock地图）', () => {
  const page = document.getElementById('page');

  it('全程预览：行程单按天展示、链路完整、二维码占位', async () => {
    const { book } = await seedBook();
    document.querySelector('[data-modal]')?.remove();
    await generate.render(page);
    await wait(500);
    assert.has(page, '[data-page="generate"]');
    assert.includes(page.querySelector('.page-head').textContent, '成都三日游 · 全程预览');
    const days = page.querySelectorAll('[data-genday]');
    assert.eq(days.length, 2);
    // D1：起点 + 条目 + 住宿
    assert.includes(days[0].textContent, '🚩 成都东站');
    assert.includes(days[0].textContent, '宽窄巷子');
    assert.includes(days[0].textContent, '小名堂冒烤鸭');
    assert.includes(days[0].textContent, '亚朵酒店');
    assert.includes(days[0].textContent, '宿：成都市-亚朵酒店', '宿按 城市-住宿 格式显示');
    assert.includes(days[0].textContent, '全程', '每天应显示当天总距离/用时');
    assert.includes(days[0].textContent, '10月1日');
    // D2：从前一天住宿出发 + 条目 + 住宿 + 终点
    assert.includes(days[1].textContent, '🚩 亚朵酒店');
    assert.includes(days[1].textContent, '锦里古街');
    assert.includes(days[1].textContent, '如家酒店');
    assert.includes(days[1].textContent, '🏁 春熙路');
    // 二维码占位与调整入口
    assert.includes(page.querySelector('.qr-placeholder').textContent, '第二版');
    const editLink = page.querySelector('a[href="#/planner"]');
    assert.ok(editLink, '应有"去调整行程"入口');
    void book;
  });

  it('全程地图：按天分色画线 + 起点/住宿/终点标记', async () => {
    await seedBook();
    await generate.render(page);
    await wait(600);
    const AMap = await loadAMap({ forceMock: true });
    const map = AMap.Map.instances[AMap.Map.instances.length - 1];
    const strokeColors = new Set(map.overlays.filter(o => o.opts?.strokeColor).map(o => o.opts.strokeColor));
    assert.ok(strokeColors.has(DAY_COLORS[0]), 'D1颜色应出现');
    assert.ok(strokeColors.has(DAY_COLORS[1]), 'D2颜色应出现');
    const tags = map.overlays.filter(o => o.opts?.content).map(o => o.opts.content);
    assert.gte(tags.length, 3, '至少有 起点/住宿/终点 编号标记');
    assert.ok(tags.some(t => t.includes('🚩')), '应有出发锚标记');
    assert.ok(tags.some(t => t.includes('🏨')), '应有住宿标记');
    assert.ok(tags.some(t => t.includes('🏁')), '应有目的地标记');
  });

  it('无当前路书：引导回首页', async () => {
    resetState();
    await generate.render(page);
    await wait(30);
    assert.includes(page.textContent, '还没有选择要生成的路书');
    assert.ok(page.querySelector('a[href="#/home"]'));
  });

  it('空行程路书：提示去规划', async () => {
    seedBook();
    state.books[0].days = [];
    await generate.render(page);
    await wait(30);
    assert.includes(page.textContent, '还没有安排行程');
  });
});
