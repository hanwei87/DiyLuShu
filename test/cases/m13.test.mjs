import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import { addDay, insertStop, setStay } from '../../js/core/plannerOps.js';
import { cityOfAddress } from '../../js/core/utils.js';
import { dayCity } from '../../js/pages/generate.js';
import * as generate from '../../js/pages/generate.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const page = document.getElementById('page');

describe('M13 七轮反馈回归', () => {
  it('【真bug】城市解析非贪婪：直辖市重复前缀不再吞两份', () => {
    assert.eq(cityOfAddress('天津市天津市河西区某某路3号'), '天津市');
    assert.eq(cityOfAddress('上海市上海市黄浦区南京东路'), '上海市');
    assert.eq(cityOfAddress('四川省成都市青羊区宽巷子26号'), '成都市');
    assert.eq(cityOfAddress('河北省石家庄市长安区中山东路'), '石家庄市');
    assert.eq(cityOfAddress('新疆维吾尔自治区乌鲁木齐市天山区'), '乌鲁木齐市');
  });

  it('【问题3】城市逐站回退：住宿无城市→最后一站→倒数第二站', () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const s1 = addItemToLibrary(state.library, { name: '无城市店', location: '104.01,30.60' });
    const s2 = addItemToLibrary(state.library, { name: '有城店', location: '104.02,30.61', address: '天津市天津市河西区广东路' });
    const stay = addItemToLibrary(state.library, { name: '无名旅店', location: '104.03,30.62' });
    const book = createBook({ name: '回退测试' });
    const d1 = addDay(book, '2026-10-04');
    insertStop(book, d1.id, s1.id);
    insertStop(book, d1.id, s2.id);
    setStay(book, d1.id, stay.id);
    // 住宿解析不出 → 回退到最后一站 s2（天津市）
    assert.eq(dayCity(book, d1.id), '天津市');
    // 最后一站也无城市 → 倒数第二站
    s2.address = '';
    assert.eq(dayCity(book, d1.id), '');
    // 住宿自身有城市时优先用住宿
    stay.address = '四川省成都市武侯区';
    assert.eq(dayCity(book, d1.id), '成都市');
  });

  it('【问题3】天标题新布局：日期在左不换行/右上全程/右下宿', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c1', name: '酒店', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const stay = addItemToLibrary(state.library, {
      name: '大树旅店', location: '104.03,30.62', address: '天津市天津市河西区广东路',
    });
    const stop = addItemToLibrary(state.library, { name: '景点X', location: '104.01,30.60' });
    const book = createBook({ name: '布局测试' });
    const d1 = addDay(book, '2026-09-27');
    insertStop(book, d1.id, stop.id);
    setStay(book, d1.id, stay.id);
    await generate.render(page);
    await wait(800);
    const summary = page.querySelector('[data-genday] summary');
    // 左侧日期列：不换行
    const dateEl = summary.querySelector('.day-date');
    assert.ok(dateEl, '日期元素应存在');
    assert.eq(getComputedStyle(dateEl).whiteSpace, 'nowrap', '日期不应换行');
    assert.includes(dateEl.textContent, '9月27日');
    // 右上：全程徽标与单独展示按钮
    const top = summary.querySelector('.day-meta-top');
    assert.includes(top.textContent, '全程');
    assert.ok(top.querySelector('[data-showday]'), '单独展示按钮在右上区');
    // 右下：宿（城市来自逐站回退）
    const bottom = summary.querySelector('.day-meta-bottom');
    assert.eq(bottom.textContent, '宿：天津市-大树旅店');
  });
});
