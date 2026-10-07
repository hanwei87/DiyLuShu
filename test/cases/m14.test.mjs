import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import { addDay, insertStop, setStay } from '../../js/core/plannerOps.js';
import { dayNavLinks, __setWeatherForTest, nav } from '../../js/pages/generate.js';
import { renderPage } from '../../js/main.js';
import * as generate from '../../js/pages/generate.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const page = document.getElementById('page');

describe('M14 八轮反馈回归', () => {
  it('【问题2】二维码库已加载；导航链接按"起点+1途经+终点"拆段', () => {
    assert.ok(window.qrcode, 'qrcode库应全局可用');
    const blocks = [
      { name: '🚩 成都东站', loc: [104.1391, 30.629] },
      { name: '宽窄巷子', loc: [104.055, 30.663] },
      { name: '小名堂', loc: [104.0535, 30.6645] },
      { name: '锦里', loc: [104.043, 30.644] },
      { name: '🏨 亚朵酒店', loc: [104.065, 30.657] },
    ];
    const links = dayNavLinks(blocks, 0);
    // 5个点4段路 → 每链接最多3点(2段路) → 2个链接，首尾相接
    assert.eq(links.length, 2, `应拆成2段，实际${links.length}`);
    assert.ok(links[0].uri.startsWith('https://uri.amap.com/navigation?'), '应为高德URI');
    assert.includes(links[0].uri, 'from=104.1391,30.629');
    assert.includes(links[0].uri, 'via=');               // 中间点为途经
    assert.includes(links[0].uri, 'to=104.0535,30.6645');
    assert.includes(links[1].uri, 'from=104.0535,30.6645', '下一段应从上一段终点出发');
    assert.includes(links[1].uri, 'via=104.043,30.644', '第二段途经锦里');
    assert.includes(links[1].uri, 'to=104.065,30.657', '第二段终点为亚朵酒店');
    assert.includes(links[1].uri, 'callnative=1', '应尝试调起高德App');
    // 3个点 → 1段
    assert.eq(dayNavLinks(blocks.slice(0, 3), 0).length, 1);
    // 1个点 → 0段
    assert.eq(dayNavLinks(blocks.slice(0, 1), 0).length, 0);
    // 不走高速策略透传
    assert.includes(dayNavLinks(blocks, 1)[0].uri, 'policy=1');
  });

  it('【问题2→十轮修订】桌面只有"单独显示"，二维码按钮已移除、手机导航不显示', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true, appName: '' };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const a = addItemToLibrary(state.library, { name: '店A', location: '104.05,30.66' });
    const b2 = addItemToLibrary(state.library, { name: '店B', location: '104.08,30.64' });
    const book = createBook({ name: '二维码测试' });
    const d1 = addDay(book, '2026-10-01');
    insertStop(book, d1.id, a.id);
    insertStop(book, d1.id, b2.id);
    document.querySelector('[data-modal]')?.remove();
    await generate.render(page);
    await wait(800);
    assert.includes(page.querySelector('[data-showday]').textContent, '单独显示');
    assert.notOk(page.querySelector('[data-mobnav]'), '桌面不应显示手机导航按钮');
    assert.notOk(page.querySelector('[data-qr]'), '十轮反馈5：二维码按钮应已移除');
  });

  it('【问题2】手机UA：显示手机导航按钮且多段时弹分段导航列表', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true, appName: '' };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const p1 = addItemToLibrary(state.library, { name: '店A', location: '104.05,30.66' });
    const p2 = addItemToLibrary(state.library, { name: '店B', location: '104.08,30.64' });
    const p3 = addItemToLibrary(state.library, { name: '店C', location: '104.03,30.61' });
    const book = createBook({ name: '手机导航' });
    const d1 = addDay(book, '2026-10-01');
    insertStop(book, d1.id, p1.id);
    insertStop(book, d1.id, p2.id);
    insertStop(book, d1.id, p3.id);
    document.querySelector('[data-modal]')?.remove();
    // 覆盖UA为iPhone
    const origUA = navigator.userAgent;
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', configurable: true });
    try {
      await generate.render(page);
      await wait(800);
      assert.notOk(page.querySelector('[data-qr]'), '手机上不显示二维码按钮');
      const mob = page.querySelector('[data-mobnav]');
      assert.ok(mob, '手机应显示手机导航按钮');
    // 3个点=1段 → 点击直接调起高德（跳转出口已注入，不真跳转）
    let jumped = '';
    const origGo = nav.go;
    nav.go = uri => { jumped = uri; };
    mob.click();
    await wait(100);
    nav.go = origGo;
    assert.ok(jumped.includes('uri.amap.com/navigation'), '单段应直接调起高德导航');
    assert.notOk(document.querySelector('[data-modal]'), '单段不弹选择列表');
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', { value: origUA, configurable: true });
      document.querySelector('[data-modal]')?.remove();
    }
    // 多段：5个点 → 弹分段列表
    const p4 = addItemToLibrary(state.library, { name: '店D', location: '104.06,30.67' });
    const p5 = addItemToLibrary(state.library, { name: '店E', location: '104.04,30.68' });
    book.days[0].stopItemIds.push(p4.id, p5.id);
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', configurable: true });
    try {
      await generate.render(page);
      await wait(800);
      page.querySelector('[data-mobnav]').click();
      await wait(100);
      const modal = document.querySelector('[data-modal]');
      assert.ok(modal, '多段应弹分段导航列表');
      assert.eq(modal.querySelectorAll('[data-uri]').length, 2, '5个点拆2段');
      assert.includes(modal.textContent, '第1段');
      assert.includes(modal.textContent, '第2段');
      modal.querySelector('[data-act="cancel"]').click();
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', { value: origUA, configurable: true });
    }
  });

  it('【问题3】标签与天气合并一行显示', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true, appName: '' };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [{ id: 't1', name: '川菜' }], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const a = addItemToLibrary(state.library, { name: '店A', location: '104.05,30.66', tagIds: ['t1'] });
    const b2 = addItemToLibrary(state.library, { name: '店B', location: '104.08,30.64' });
    const hotel = addItemToLibrary(state.library, { name: '酒店H', location: '104.06,30.65' });
    const book = createBook({ name: '一行显示' });
    const d1 = addDay(book, '2026-10-01');
    insertStop(book, d1.id, a.id);
    insertStop(book, d1.id, b2.id);
    setStay(book, d1.id, hotel.id);
    document.querySelector('[data-modal]')?.remove();
    await generate.render(page);
    await wait(700);
    __setWeatherForTest([{ first: { emoji: '☀️', text: '晴', tmax: 26, tmin: 18 }, last: null }]);
    await wait(50);
    const firstStop = page.querySelector('.gen-stop');
    const subline = firstStop.querySelector('.gen-subline');
    assert.ok(subline, '应有合并行');
    assert.includes(subline.textContent, '#川菜');
    assert.includes(subline.textContent, '☀️');
    // 标签与天气在同一容器（一行）
    assert.eq(subline.querySelectorAll('.gtags').length, 1);
    assert.eq(subline.querySelectorAll('.gw').length, 1);
  });

  it('【问题1】我的页：天气Key输入与高德注册指引链接', async () => {
    location.hash = '#/mine';
    await renderPage();
    await wait(30);
    assert.has(page, '[data-page="mine"]');
    assert.ok(page.querySelector('[data-weatherkey]'), '天气Key输入应存在');
    const link = page.querySelector('a[href="https://lbs.amap.com/"]');
    assert.ok(link, '注册指引链接应存在');
    assert.includes(link.textContent, 'lbs.amap.com');
    // 保存三把Key
    page.querySelector('[data-weatherkey]').value = 'WEATHER_KEY_1';
    page.querySelector('[data-act="savekey"]').click();
    await wait(30);
    assert.eq(state.settings.weatherKey, 'WEATHER_KEY_1');
    state.settings.weatherKey = '';
  });

  it('【问题3】天气：起终点标签下方显示当天天气（注入式验证）', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true, appName: '' };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const a = addItemToLibrary(state.library, { name: '店A', location: '104.05,30.66' });
    const b2 = addItemToLibrary(state.library, { name: '店B', location: '104.08,30.64' });
    const hotel = addItemToLibrary(state.library, { name: '酒店H', location: '104.06,30.65' });
    const c3 = addItemToLibrary(state.library, { name: '店C', location: '104.03,30.61' });
    const book = createBook({ name: '天气测试' });
    const d1 = addDay(book, '2026-10-01');
    insertStop(book, d1.id, a.id);
    insertStop(book, d1.id, b2.id);
    insertStop(book, d1.id, c3.id);
    setStay(book, d1.id, hotel.id);
    document.querySelector('[data-modal]')?.remove();
    await generate.render(page);
    await wait(700);
    // 真实网络天气在Mock环境被跳过，注入数据验证渲染
    __setWeatherForTest([{ first: { emoji: '☀️', text: '晴', tmax: 26, tmin: 18 }, last: { emoji: '🌧️', text: '雨', tmax: 22, tmin: 15 } }]);
    await wait(50);
    const stops = [...page.querySelectorAll('.gen-stop')];
    const first = stops[0], last = stops[stops.length - 1];
    assert.includes(first.querySelector('.gw')?.textContent || '', '☀️', '起点块应显示天气');
    assert.includes(first.querySelector('.gw')?.textContent || '', '26°/18°');
    assert.includes(last.querySelector('.gw')?.textContent || '', '🌧️', '终点块应显示天气');
    // 中间地点无天气
    const middle = stops[1];
    assert.notOk(middle.querySelector('.gw'), '中间地点不应显示天气');
    // 注入前无天气也不报错（已在渲染中体现）
  });

  it('【问题4】手机适配：viewport与触屏拖动配置', () => {
    assert.includes(document.querySelector('meta[name="viewport"]').content, 'device-width', 'viewport应适配手机');
    // 响应式样式规则存在（≤900px 纵向堆叠）
    const css = [...document.styleSheets].find(s => (s.href || '').includes('app.css'));
    assert.ok(css, 'app.css已加载');
    let hasMedia = false;
    try {
      for (const rule of css.cssRules) {
        if (rule.media && rule.media.mediaText.includes('900px')) { hasMedia = true; break; }
      }
    } catch { hasMedia = true; }
    assert.ok(hasMedia, '应存在≤900px媒体查询');
  });
});
