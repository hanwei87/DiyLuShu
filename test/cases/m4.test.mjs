import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import {
  addCategory, renameCategory, deleteCategory,
  addTag, renameTag, deleteTag, ensureTag,
  addItemToLibrary, updateItem, filterItems,
  scanItemReferences, removeItemEverywhere,
} from '../../js/core/libraryOps.js';
import * as library from '../../js/pages/library.js';

function resetState() {
  state.settings = { amapKey: 'TEST', securityCode: '', guideDismissed: false };
  state.library = {
    categories: [{ id: 'c_food', name: '美食', order: 1 }, { id: 'c_play', name: '游玩', order: 2 }],
    tags: [{ id: 't1', name: '川菜' }, { id: 't2', name: '亲子' }],
    items: [],
  };
  state.books = [];
  state.ui = { lastBookId: null };
}

function seedItems() {
  const i1 = addItemToLibrary(state.library, { name: '小名堂冒烤鸭', categoryId: 'c_food', tagIds: ['t1'], location: '104.05,30.66', createdAt: 1000 });
  const i2 = addItemToLibrary(state.library, { name: '马路边边', categoryId: 'c_food', tagIds: ['t1', 't2'], location: '104.06,30.61', createdAt: 2000 });
  const i3 = addItemToLibrary(state.library, { name: '宽窄巷子', categoryId: 'c_play', tagIds: ['t2'], location: '104.07,30.67', createdAt: 3000 });
  const i4 = addItemToLibrary(state.library, { name: '无名小店', categoryId: 'c_nope', tagIds: [], location: '104.08,30.68', createdAt: 4000 });
  return { i1, i2, i3, i4 };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

describe('M4 大类管理', () => {
  it('新增/重命名/删除大类（删除→条目入未分类）', () => {
    resetState();
    seedItems();
    const c = addCategory(state.library, '购物');
    assert.ok(state.library.categories.some(x => x.id === c.id));
    renameCategory(state.library, c.id, '购物街');
    assert.eq(state.library.categories.find(x => x.id === c.id).name, '购物街');
    deleteCategory(state.library, 'c_food');
    assert.notOk(state.library.categories.some(x => x.id === 'c_food'));
    // 美食下条目仍在，大类变为未分类；无名小店本来就不属于任何大类
    assert.ok(state.library.items.some(i => i.name === '小名堂冒烤鸭'));
    const uncat = filterItems(state.library, { categoryId: '__uncat' });
    assert.eq(uncat.map(i => i.name).sort(), ['小名堂冒烤鸭', '无名小店', '马路边边']);
    // 不存在的分类删除不报错
    deleteCategory(state.library, 'c_nope');
  });
});

describe('M4 标签管理', () => {
  it('新增/重命名/删除标签（删除→摘标签不删条目）', () => {
    resetState();
    const { i2 } = seedItems();
    const t = addTag(state.library, '人均100');
    renameTag(state.library, t.id, '人均百元');
    assert.eq(state.library.tags.find(x => x.id === t.id).name, '人均百元');
    deleteTag(state.library, 't1');
    assert.notOk(state.library.tags.some(x => x.id === 't1'));
    const item = state.library.items.find(i => i.id === i2.id);
    assert.eq(item.tagIds, ['t2'], '条目保留，仅摘除被删标签');
    assert.ok(state.library.items.some(i => i.name === '马路边边'));
  });

  it('ensureTag：存在即复用，不存在则创建', () => {
    resetState();
    assert.eq(ensureTag(state.library, '川菜'), 't1');
    const newId = ensureTag(state.library, '新标签');
    assert.ok(state.library.tags.some(t => t.id === newId && t.name === '新标签'));
    assert.eq(state.library.tags.filter(t => t.name === '川菜').length, 1, '不应重复创建');
  });
});

describe('M4 条目编辑与筛选', () => {
  it('updateItem 修改字段', () => {
    resetState();
    const { i1 } = seedItems();
    updateItem(state.library, i1.id, { note: '人均80', categoryId: 'c_play' });
    const item = state.library.items.find(i => i.id === i1.id);
    assert.eq(item.note, '人均80');
    assert.eq(item.categoryId, 'c_play');
  });

  it('filterItems：大类/未分类/标签OR/关键词/排序', () => {
    resetState();
    seedItems();
    assert.eq(filterItems(state.library, { categoryId: 'c_food' }).map(i => i.name).sort(), ['小名堂冒烤鸭', '马路边边']);
    assert.eq(filterItems(state.library, { categoryId: '__uncat' }).map(i => i.name), ['无名小店']);
    assert.eq(filterItems(state.library, { categoryId: '__all', tagIds: ['t2'] }).map(i => i.name).sort(), ['宽窄巷子', '马路边边'], '标签OR语义');
    assert.eq(filterItems(state.library, { categoryId: '__all', tagIds: ['t1', 't2'] }).length, 3);
    assert.eq(filterItems(state.library, { categoryId: '__all', kw: '小名堂' }).map(i => i.name), ['小名堂冒烤鸭']);
    // 排序：time默认createdAt倒序；name按中文
    assert.eq(filterItems(state.library, { sort: 'time' })[0].name, '无名小店');
    const byName = filterItems(state.library, { sort: 'name' }).map(i => i.name);
    assert.eq(byName, [...byName].sort((a, b) => a.localeCompare(b, 'zh')));
  });

  it('scanItemReferences：列出引用但不修改', () => {
    resetState();
    const { i1 } = seedItems();
    state.books = [{ id: 'b1', name: '成都行', days: [
      { id: 'd1', label: 'D1', stopItemIds: [i1.id], stayItemId: null },
      { id: 'd2', label: 'D2', stopItemIds: [], stayItemId: i1.id },
    ] }];
    const refs = scanItemReferences(i1.id);
    assert.eq(refs.length, 2);
    assert.ok(refs.some(r => r.kind === '当晚住宿' && r.dayLabel === 'D2'));
    assert.eq(state.books[0].days[0].stopItemIds.length, 1, '扫描不改数据');
  });
});

describe('M4 信息库页面（DOM集成）', () => {
  const page = document.getElementById('page');

  async function freshLibrary() {
    resetState();
    seedItems();
    document.querySelector('[data-modal]')?.remove();
    await library.render(page);
    await wait(30);
  }

  it('渲染：侧栏计数、条目卡片、标签chip', async () => {
    await freshLibrary();
    const allBtn = page.querySelector('[data-cat="__all"]');
    assert.includes(allBtn.textContent, '4');
    assert.eq(page.querySelectorAll('[data-item]').length, 4);
    assert.includes(page.querySelector('[data-items]').textContent, '小名堂冒烤鸭');
    assert.eq(page.querySelectorAll('[data-tagtoggle]').length, 2);
    // 未分类按钮出现（有c_nope条目）
    assert.ok(page.querySelector('[data-cat="__uncat"]'), '应有未分类入口');
  });

  it('点击大类筛选；点未分类', async () => {
    await freshLibrary();
    page.querySelector('[data-cat="c_food"]').click();
    await wait(20);
    assert.eq(page.querySelectorAll('[data-item]').length, 2);
    page.querySelector('[data-cat="__uncat"]').click();
    await wait(20);
    assert.eq(page.querySelectorAll('[data-item]').length, 1);
    assert.includes(page.querySelector('[data-items]').textContent, '无名小店');
  });

  it('标签筛选OR + 关键词搜索 + 排序切换', async () => {
    await freshLibrary();
    page.querySelector('[data-tagtoggle="t2"]').click();
    await wait(20);
    assert.eq(page.querySelectorAll('[data-item]').length, 2);
    page.querySelector('[data-tagtoggle="t1"]').click();
    await wait(20);
    assert.eq(page.querySelectorAll('[data-item]').length, 3);
    // 关键词
    const kw = page.querySelector('[data-kw]');
    kw.value = '宽窄';
    kw.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(350);
    assert.eq(page.querySelectorAll('[data-item]').length, 1);
    // 排序
    page.querySelector('[data-tagtoggle="t1"]').click();
    page.querySelector('[data-tagtoggle="t2"]').click();
    const sortSel = page.querySelector('[data-sort]');
    sortSel.value = 'name';
    sortSel.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(20);
    const names = [...page.querySelectorAll('[data-item] h4')].map(h => h.textContent);
    assert.eq(names, [...names].sort((a, b) => a.localeCompare(b, 'zh')));
  });

  it('新建大类 + 重命名 + 删除大类移入未分类', async () => {
    await freshLibrary();
    // 新建
    page.querySelector('[data-act="newcat"]').click();
    let modal = document.querySelector('[data-modal]');
    modal.querySelector('input[name="name"]').value = '购物';
    modal.querySelector('[data-act="ok"]').click();
    await wait(30);
    const newCat = state.library.categories.find(c => c.name === '购物');
    assert.ok(newCat, '大类应创建');
    // 重命名
    page.querySelector(`[data-cat-edit="${newCat.id}"]`).click();
    modal = document.querySelector('[data-modal]');
    modal.querySelector('input[name="name"]').value = '购物街';
    modal.querySelector('[data-act="ok"]').click();
    await wait(30);
    assert.eq(state.library.categories.find(c => c.id === newCat.id).name, '购物街');
    // 删除大类：条目进未分类
    page.querySelector('[data-cat="c_food"]').click();
    await wait(20);
    page.querySelector('[data-cat-del="c_food"]').click();
    modal = document.querySelector('[data-modal]');
    assert.includes(modal.textContent, '移入');
    modal.querySelector('[data-act="ok"]').click();
    await wait(30);
    assert.notOk(state.library.categories.some(c => c.id === 'c_food'));
    page.querySelector('[data-cat="__uncat"]').click();
    await wait(20);
    assert.eq(page.querySelectorAll('[data-item]').length, 3, '美食2条+本来未分类的1条');
  });

  it('编辑条目：改名+换大类+加减标签', async () => {
    await freshLibrary();
    const { i1 } = { i1: state.library.items.find(i => i.name === '小名堂冒烤鸭') };
    page.querySelector(`[data-item-edit="${i1.id}"]`).click();
    const modal = document.querySelector('[data-modal]');
    modal.querySelector('input[name="name"]').value = '小名堂·改';
    modal.querySelector('select[name="categoryId"]').value = 'c_play';
    modal.querySelectorAll('.tagsel .tag-opt')[0].classList.add('active');
    modal.querySelector('[data-act="ok"]').click();
    await wait(30);
    const item = state.library.items.find(i => i.id === i1.id);
    assert.eq(item.name, '小名堂·改');
    assert.eq(item.categoryId, 'c_play');
    assert.ok(item.tagIds.includes('t1'));
    assert.includes(page.querySelector('[data-items]').textContent, '小名堂·改');
  });

  it('删除条目：确认框列出引用并级联清理', async () => {
    await freshLibrary();
    const item = state.library.items.find(i => i.name === '宽窄巷子');
    state.books = [{ id: 'b1', name: '成都行', days: [
      { id: 'd1', label: 'D1', stopItemIds: [item.id, 'other'], stayItemId: null },
    ] }];
    page.querySelector(`[data-item-del="${item.id}"]`).click();
    await wait(30);
    const modal = document.querySelector('[data-modal]');
    assert.includes(modal.textContent, '成都行', '确认框应列出引用');
    assert.includes(modal.textContent, 'D1');
    modal.querySelector('[data-act="ok"]').click();
    await wait(30);
    assert.notOk(state.library.items.some(i => i.id === item.id));
    assert.eq(state.books[0].days[0].stopItemIds, ['other'], '行程引用应被清理');
  });

  it('高亮跳转：sessionStorage 标记的条目高亮显示', async () => {
    await freshLibrary();
    const item = state.library.items.find(i => i.name === '马路边边');
    sessionStorage.setItem('lushu:highlightItem', item.id);
    await library.render(page);
    await wait(80);
    const card = page.querySelector(`[data-item="${item.id}"]`);
    assert.ok(card, '高亮卡片应存在');
    assert.includes(card.className, 'flash', '应有高亮样式');
    assert.eq(sessionStorage.getItem('lushu:highlightItem'), null, '标记应清除');
  });
});
