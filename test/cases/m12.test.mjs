import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { addItemToLibrary, __reorderHook } from '../../js/core/libraryOps.js';
import { createBook } from '../../js/core/bookOps.js';
import { addDay, insertStop, setStay } from '../../js/core/plannerOps.js';
import { loadAMap } from '../../js/core/amap.js';
import { cityOfAddress } from '../../js/core/utils.js';
import * as picker from '../../js/pages/picker.js';
import * as library from '../../js/pages/library.js';
import * as planner from '../../js/pages/planner.js';
import * as generate from '../../js/pages/generate.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const page = document.getElementById('page');

describe('M12 五轮反馈回归', () => {
  it('【问题1】行程色带封面：城市解析辅助（供宿显示用）', () => {
    assert.eq(cityOfAddress('四川省成都市青羊区金河路口'), '成都市');
    assert.eq(cityOfAddress('成都市武侯区大街231号'), '成都市');
    assert.eq(cityOfAddress(''), '');
    assert.eq(cityOfAddress('春熙路街道88号'), '');
  });

  it('【问题2】地图选点默认定位到当前位置（Mock为成都中心）', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    document.querySelector('[data-modal]')?.remove();
    await picker.render(page);
    await wait(250);
    const AMap = await loadAMap({ forceMock: true });
    const map = AMap.Map.instances[AMap.Map.instances.length - 1];
    assert.eq(map.center, [104.0655, 30.657], '定位成功后地图中心应为当前位置');
  });

  it('【问题1·六轮】收藏地点：▲▼移除修排版，改长按拖动排序', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true };
    state.library = {
      categories: [
        { id: 'ca', name: '美食', order: 1 },
        { id: 'cb', name: '酒店', order: 2 },
        { id: 'cc', name: '游玩', order: 3 },
      ],
      tags: [], items: [],
    };
    state.books = [];
    state.ui = { lastBookId: null };
    await library.render(page);
    await wait(30);
    // 排版修复：▲▼按钮已移除
    assert.notOk(page.querySelector('[data-cat-up]'), '▲按钮应移除');
    assert.notOk(page.querySelector('[data-cat-down]'), '▼按钮应移除');
    // 拖动排序：Sortable挂在分类容器上（长按200ms进入拖动）
    const sortBox = page.querySelector('[data-catsort]');
    assert.ok(sortBox, '应有可排序容器');
    assert.ok(Object.keys(sortBox).some(k => k.startsWith('Sortable')), '分类列表应挂Sortable');
    // 拖拽onEnd走的同一套模型逻辑：把游玩(第3个)拖到第2位
    __reorderHook(state.library, 2, 1);
    await library.render(page);
    await wait(30);
    assert.eq(state.library.categories.map(c => c.name), ['美食', '游玩', '酒店']);
    assert.eq(state.library.categories.map(c => c.order), [1, 2, 3], 'order字段应重排');
    // 边界：移到自己是无操作
    assert.notOk(__reorderHook(state.library, 1, 1));
    assert.eq(state.library.categories.map(c => c.name), ['美食', '游玩', '酒店']);
    // 左栏显示顺序同步
    const names = [...page.querySelectorAll('[data-side] .lib-cat')].map(b => b.textContent);
    assert.ok(names[0].includes('全部'));
    assert.ok(names[1].includes('美食'));
  });

  it('【问题4】规划页右上列表固定显示5行高度（超出滚动）', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c1', name: '游玩', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    for (let i = 0; i < 8; i++) {
      addItemToLibrary(state.library, { name: `地点${i}`, location: `104.0${i},30.6` });
    }
    createBook({ name: '行高测试' });
    await planner.render(page);
    await wait(80);
    const rows = page.querySelector('[data-librows]');
    const cs = getComputedStyle(rows);
    assert.includes(cs.maxHeight, '219', '列表高度应固定为5行(219px)');
    assert.gt(rows.scrollHeight, rows.clientHeight, '超出部分应滚动');
    // 2列模式下同样高度
    page.querySelector('[data-cols]').click();
    await wait(30);
    assert.includes(getComputedStyle(rows).maxHeight, '219');
  });

  it('【问题5】生成页：无地址住宿的宿显示不带城市前缀也不报错', async () => {
    state.settings = { amapKey: 'T', securityCode: '', guideDismissed: true };
    state.library = { categories: [{ id: 'c1', name: '酒店', order: 1 }], tags: [], items: [] };
    state.books = [];
    state.ui = { lastBookId: null };
    const stay = addItemToLibrary(state.library, { name: '无名旅店', location: '104.06,30.65' });
    const book = createBook({ name: '宿格式' });
    const d1 = addDay(book, '2026-10-01');
    setStay(book, d1.id, stay.id);
    await generate.render(page);
    await wait(700);
    assert.includes(page.querySelector('[data-days]').textContent, '宿：无名旅店', '无城市时只显示住宿名');
    // 地点与其后箭头成组（防错位布局）；单地点的天没有箭头属正常
    assert.has(page, '.gen-pair', '应使用成组布局');
    void insertStop;
  });
});
