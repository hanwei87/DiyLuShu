import { describe, it, assert } from '../harness.mjs';
import { createMemoryAdapter, setAdapter, PATHS } from '../../js/core/fs.js';
import { markDirty, flushNow, hydrate, flushAll } from '../../js/core/persist.js';
import { state } from '../../js/core/state.js';
import { exportAll, importAll, validateBackup } from '../../js/core/backup.js';
import { idb, KEYS } from '../../js/core/idb.js';
import { deepEqual, deepClone } from '../../js/core/utils.js';

function ensureIndicatorEl() {
  let el = document.getElementById('saveIndicator');
  if (!el) {
    el = document.createElement('span');
    el.id = 'saveIndicator';
    document.body.appendChild(el);
  }
  return el;
}

describe('M1 存储适配器（memory）', () => {
  it('写/读/改名/删除 round-trip，含子目录', async () => {
    const mem = createMemoryAdapter();
    await mem.chooseDirectory();
    await mem.writeJSON(PATHS.settings, { amapKey: 'K1' });
    await mem.writeJSON(PATHS.book('20260101_测试.json'), { id: 'b1', name: '测试' });
    let all = await mem.readAll();
    assert.eq(all.settings.amapKey, 'K1');
    assert.eq(all.books['20260101_测试.json'].id, 'b1');
    assert.eq(all.library, null);
    await mem.renameFile(PATHS.book('20260101_测试.json'), PATHS.book('20260101_改名.json'));
    all = await mem.readAll();
    assert.ok(all.books['20260101_改名.json'], '改名后文件应存在');
    assert.notOk(all.books['20260101_测试.json'], '旧文件应消失');
    await mem.deleteFile(PATHS.book('20260101_改名.json'));
    all = await mem.readAll();
    assert.eq(Object.keys(all.books).length, 0);
  });

  it('未选择目录时 readAll 返回 null', async () => {
    const mem = createMemoryAdapter();
    assert.eq(await mem.readAll(), null);
    assert.eq(await mem.ensurePermission(), 'none');
  });
});

describe('M1 hydrate 数据恢复优先级', () => {
  it('文件夹快照优先于镜像', () => {
    const folder = {
      settings: { amapKey: 'FROM_FOLDER' },
      library: { categories: [{ id: 'c1', name: '玩', order: 1 }], tags: [], items: [{ id: 'i1' }] },
      books: [{ id: 'bF', name: '文件夹的路书', updatedAt: 5 }],
    };
    const mirror = { state: { settings: { amapKey: 'FROM_MIRROR' }, library: { categories: [], tags: [], items: [] }, books: [{ id: 'bM' }] } };
    state.books = [];
    hydrate({ folder, mirror });
    assert.eq(state.settings.amapKey, 'FROM_FOLDER');
    assert.eq(state.books.length, 1);
    assert.eq(state.books[0].id, 'bF');
    assert.eq(state.library.items.length, 1);
  });

  it('无文件夹时回退镜像；都无时保持默认预置大类', () => {
    const mirror = { state: { settings: { amapKey: 'FROM_MIRROR' }, library: { categories: [{ id: 'c1', name: '吃', order: 1 }], tags: [], items: [] }, books: [{ id: 'bM', updatedAt: 1 }] } };
    state.books = [];
    hydrate({ folder: null, mirror });
    assert.eq(state.settings.amapKey, 'FROM_MIRROR');
    assert.eq(state.books[0].id, 'bM');

    state.books = [];
    hydrate({ folder: null, mirror: null });
    assert.eq(state.settings.amapKey, '');
    assert.eq(state.library.categories.map(c => c.name), ['美食', '酒店', '游玩']);
  });

  it('books 按 updatedAt 倒序排列（首页最近修改排序）', () => {
    hydrate({ folder: null, mirror: { state: { settings: {}, library: {}, books: [
      { id: 'old', updatedAt: 100 }, { id: 'new', updatedAt: 300 }, { id: 'mid', updatedAt: 200 },
    ] } } });
    assert.eq(state.books.map(b => b.id), ['new', 'mid', 'old']);
  });
});

describe('M1 persist 落盘与镜像', () => {
  it('markDirty+flushNow 写文件 + 更新镜像 + 指示条状态', async () => {
    ensureIndicatorEl();
    const mem = createMemoryAdapter();
    await mem.chooseDirectory();
    setAdapter(mem);
    state.settings.amapKey = 'TEST_KEY_123';
    state.books = [{ id: 'b1', file: '20260101_测试路书.json', name: '测试路书' }];
    markDirty('settings');
    markDirty('book:b1');
    await flushNow();
    const saved = JSON.parse(mem._files.get(PATHS.settings));
    assert.eq(saved.amapKey, 'TEST_KEY_123');
    const bookSaved = JSON.parse(mem._files.get(PATHS.book('20260101_测试路书.json')));
    assert.eq(bookSaved.id, 'b1');
    const mirror = await idb.get(KEYS.mirror);
    assert.eq(mirror.state.settings.amapKey, 'TEST_KEY_123');
    assert.eq(mirror.state.books[0].id, 'b1');
    const el = document.getElementById('saveIndicator');
    assert.includes(el.className, 'ok');
    assert.includes(el.textContent, '已保存');
  });

  it('写盘失败：抛错、指示条变红、镜像仍更新（数据不丢）', async () => {
    const failAdapter = {
      kind: 'fail',
      async writeJSON() { throw new Error('boom'); },
    };
    setAdapter(failAdapter);
    state.settings.amapKey = 'FAIL_KEY';
    markDirty('settings');
    let threw = false;
    try { await flushNow(); } catch (e) { threw = true; }
    assert.ok(threw, 'flush 应抛出错误');
    const el = document.getElementById('saveIndicator');
    assert.includes(el.className, 'error');
    assert.includes(el.textContent, '未保存');
    const mirror = await idb.get(KEYS.mirror);
    assert.eq(mirror.state.settings.amapKey, 'FAIL_KEY');
    setAdapter(createMemoryAdapter());
  });

  it('flushAll：授权后全量补写 settings/library/所有books', async () => {
    const mem = createMemoryAdapter();
    await mem.chooseDirectory();
    setAdapter(mem);
    state.library.items = [{ id: 'iX', name: '条目X' }];
    state.books = [
      { id: 'b1', file: 'f1.json', name: '一' },
      { id: 'b2', file: 'f2.json', name: '二' },
    ];
    await flushAll();
    assert.ok(mem._files.get(PATHS.library));
    assert.ok(mem._files.get(PATHS.book('f1.json')));
    assert.ok(mem._files.get(PATHS.book('f2.json')));
    state.library.items = [];
    state.books = [];
  });
});

describe('M1 备份导出/导入', () => {
  it('export→import round-trip 数据一致', () => {
    const st = {
      settings: { amapKey: 'K', securityCode: 'S', guideDismissed: true },
      library: { categories: [{ id: 'c1', name: '美食', order: 1 }], tags: [{ id: 't1', name: '川菜' }], items: [{ id: 'i1', name: '店', categoryId: 'c1', tagIds: ['t1'] }] },
      books: [{ id: 'b1', name: '路书1', days: [] }],
    };
    const backup = exportAll(st);
    assert.eq(validateBackup(backup), true);
    const st2 = { settings: {}, library: { categories: [], tags: [], items: [] }, books: [] };
    importAll(st2, backup);
    const backup2 = exportAll(st2);
    assert.eq(backup2.settings, backup.settings);
    assert.eq(backup2.library, backup.library);
    assert.eq(backup2.books, backup.books);
  });

  it('导入校验：格式错误抛出明确错误', () => {
    assert.throws(() => validateBackup(null));
    assert.throws(() => validateBackup({ app: 'other' }));
    assert.throws(() => validateBackup({ app: 'lushu', version: 1, library: {}, books: [] }));
    assert.throws(() => importAll({ settings: {}, library: {}, books: [] }, { app: 'lushu', version: 1, library: { items: 'x' }, books: [] }));
  });
});
