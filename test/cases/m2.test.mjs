import { describe, it, assert } from '../harness.mjs';
import { state } from '../../js/core/state.js';
import { createBook, renameBook, deleteBook, bookSummary, touchBook } from '../../js/core/bookOps.js';
import { createMemoryAdapter, setAdapter, PATHS } from '../../js/core/fs.js';
import { flushNow } from '../../js/core/persist.js';
import * as home from '../../js/pages/home.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

function resetState() {
  state.settings = { amapKey: '', securityCode: '', guideDismissed: false };
  state.library = { categories: [{ id: 'c1', name: '美食', order: 1 }], tags: [], items: [] };
  state.books = [];
  state.ui = { lastBookId: null };
}

describe('M2 bookOps 路书操作', () => {
  it('createBook：字段完整、文件名净化、置顶排序', () => {
    resetState();
    const b = createBook({ name: '成都/三日:游', origin: '成都', destination: '' });
    assert.ok(b.id.startsWith('b_'));
    assert.eq(b.name, '成都/三日:游');
    assert.ok(b.file.endsWith('.json') && !/[\\/:*?"<>|\s]/.test(b.file.replace('.json', '').split('_').slice(1).join('_')), `文件名含非法字符: ${b.file}`);
    assert.ok(b.file.startsWith(String(new Date().getFullYear())));
    assert.eq(b.origin, { name: '成都' });
    assert.eq(b.destination, null);
    assert.eq(b.days.length, 0);
    assert.eq(state.books[0], b);
  });

  it('createBook：同名书同日创建时文件名自动去重', () => {
    resetState();
    const b1 = createBook({ name: '测试行' });
    const b2 = createBook({ name: '测试行' });
    assert.ok(b1.file !== b2.file, `文件名重复: ${b1.file} vs ${b2.file}`);
  });

  it('renameBook：改名 + 文件重命名（含旧文件清理）', async () => {
    resetState();
    const mem = createMemoryAdapter();
    await mem.chooseDirectory();
    setAdapter(mem);
    const b = createBook({ name: '旧名字' });
    await flushNow();
    assert.ok(mem._files.get(PATHS.book(b.file)), '旧文件应已写入');
    await renameBook(b, '新名字啊');
    await flushNow();
    assert.eq(b.name, '新名字啊');
    const files = [...mem._files.keys()];
    assert.ok(files.some(f => f === PATHS.book(b.file)), '新文件应存在');
    assert.notOk(files.some(f => f.includes('旧名字')), '旧文件应被清理');
    const content = JSON.parse(mem._files.get(PATHS.book(b.file)));
    assert.eq(content.name, '新名字啊');
  });

  it('deleteBook：移出列表并删除文件', async () => {
    resetState();
    const mem = createMemoryAdapter();
    await mem.chooseDirectory();
    setAdapter(mem);
    const b = createBook({ name: '待删除' });
    await flushNow();
    assert.ok(await deleteBook(b.id));
    assert.eq(state.books.length, 0);
    assert.notOk(mem._files.get(PATHS.book(b.file)), '文件应被删除');
    assert.notOk(await deleteBook('不存在的id'));
  });

  it('bookSummary：天数与地点数（含住宿）', () => {
    resetState();
    const b = createBook({ name: 'x' });
    b.days = [
      { id: 'd1', label: 'D1', stopItemIds: ['i1', 'i2'], stayItemId: 'h1' },
      { id: 'd2', label: 'D2', stopItemIds: ['i3'], stayItemId: null },
    ];
    const s = bookSummary(b);
    assert.eq(s.dayCount, 2);
    assert.eq(s.stopCount, 4);
  });

  it('touchBook：updatedAt 更新并保持最近修改在前', () => {
    resetState();
    const b1 = createBook({ name: '一' });
    const b2 = createBook({ name: '二' });
    assert.eq(state.books[0].name, '二');
    b1.days.push({ id: 'd1', stops: [] });
    touchBook(b1);
    assert.eq(state.books[0].name, '一');
  });
});

describe('M2 首页交互（DOM集成）', () => {
  const page = document.getElementById('page');

  function cleanDom() {
    document.querySelector('[data-modal]')?.remove();
    document.querySelector('[data-ctxmenu]')?.remove();
  }
  async function freshRender() {
    resetState();
    cleanDom();
    await home.render(page);
  }

  it('渲染卡片墙：最新在前（行程色带封面，无起终点）', async () => {
    await freshRender();
    const old = createBook({ name: '老路书', origin: 'A', destination: 'B' });
    old.updatedAt = Date.now() - 86400_000;
    const empty = createBook({ name: '新路书' });
    await home.render(page);
    await wait(100);
    const cards = [...page.querySelectorAll('[data-book]')];
    assert.eq(cards.length, 2);
    assert.includes(cards[0].textContent, '新路书');
    assert.includes(cards[0].textContent, '还没排天');
    assert.notOk(page.querySelector('.book-card .route'), '起终点行已全局移除');
    assert.has(cards[0], '[data-cover]', '应有封面容器');
    assert.has(cards[0], '.cover-empty', '未排行程显示空封面');
    // 老路书排一天后有行程色带
    const lib = await import('../../js/core/libraryOps.js');
    const i1 = lib.addItemToLibrary(state.library, { name: '点X', location: '104.05,30.66' });
    const i2 = lib.addItemToLibrary(state.library, { name: '点Y', location: '104.04,30.67' });
    const d = { id: 'dx', stopItemIds: [i1.id, i2.id], stayItemId: null };
    old.days.push(d);
    await home.render(page);
    await wait(50);
    const oldCard = [...page.querySelectorAll('[data-book]')].find(c => c.textContent.includes('老路书'));
    assert.ok(oldCard.querySelector('.cover-svg svg'), '封面应为SVG迷你地图');
    assert.gte(oldCard.querySelectorAll('svg line').length, 1, '地点间应有连线');
    void empty;
  });

  it('点击"新建路书"弹表单（只需名称），提交后创建并选中', async () => {
    await freshRender();
    await page.querySelector('[data-act="new"]').click();
    const nameInput = document.querySelector('[data-modal] input[name="name"]');
    assert.ok(nameInput, '新建表单应出现');
    assert.notOk(document.querySelector('[data-modal] input[name="origin"]'), '起点输入已移除');
    assert.notOk(document.querySelector('[data-modal] input[name="destination"]'), '目的地输入已移除');
    nameInput.value = 'E2E新建的书';
    document.querySelector('[data-modal] [data-act="ok"]').click();
    await new Promise(r => setTimeout(r, 30));
    assert.eq(state.books.length, 1);
    assert.eq(state.books[0].name, 'E2E新建的书');
    assert.eq(state.books[0].origin, null);
    assert.eq(state.ui.lastBookId, state.books[0].id);
    assert.eq(document.querySelectorAll('#bookGrid [data-book]').length, 1);
  });

  it('必填校验：名称为空时提交不通过', async () => {
    await freshRender();
    await page.querySelector('[data-act="new"]').click();
    document.querySelector('[data-modal] [data-act="ok"]').click();
    await new Promise(r => setTimeout(r, 30));
    const err = document.querySelector('[data-modal] .field .err');
    assert.ok(err && !err.hidden, '应显示必填错误');
    assert.eq(state.books.length, 0, '不应创建');
    document.querySelector('[data-modal] [data-act="cancel"]').click();
  });

  it('卡片菜单：重命名（十二轮起在我的路书页）', async () => {
    await freshRender();
    createBook({ name: '待改名' });
    document.querySelector('[data-modal]')?.remove();
    const mybooks = await import('../../js/pages/mybooks.js');
    await mybooks.render(page);
    await wait(60);
    page.querySelector('[data-menu]').click();
    await new Promise(r => setTimeout(r, 10));
    const menu = document.querySelector('[data-ctxmenu]');
    assert.ok(menu, '菜单应出现');
    menu.querySelector('[data-m="rename"]').click();
    const input = document.querySelector('[data-modal] input[name="name"]');
    input.value = '改后的名字';
    document.querySelector('[data-modal] [data-act="ok"]').click();
    await new Promise(r => setTimeout(r, 30));
    assert.eq(state.books[0].name, '改后的名字');
    assert.includes(document.querySelector('[data-allbooks]').textContent, '改后的名字');
  });

  it('卡片菜单：删除（二次确认）', async () => {
    await freshRender();
    createBook({ name: '待删除' });
    document.querySelector('[data-modal]')?.remove();
    const mybooks = await import('../../js/pages/mybooks.js');
    await mybooks.render(page);
    await wait(60);
    page.querySelector('[data-menu]').click();
    await new Promise(r => setTimeout(r, 10));
    document.querySelector('[data-ctxmenu] [data-m="delete"]').click();
    await new Promise(r => setTimeout(r, 10));
    const confirmOk = document.querySelector('[data-modal] [data-act="ok"]');
    assert.includes(confirmOk.textContent, '删除');
    confirmOk.click();
    await new Promise(r => setTimeout(r, 30));
    assert.eq(state.books.length, 0);
    assert.has(page, '[data-page="mybooks-empty"]', '应显示空状态');
  });

  it('点击卡片进入规划并记录当前路书', async () => {
    await freshRender();
    const b = createBook({ name: '点我' });
    await home.render(page);
    page.querySelector('[data-book]').click();
    await new Promise(r => setTimeout(r, 30));
    assert.eq(state.ui.lastBookId, b.id);
    assert.eq(location.hash, '#/planner');
    location.hash = '#/home';
  });
});
