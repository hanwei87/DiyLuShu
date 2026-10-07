/** IndexedDB 封装：文件夹句柄 / 数据镜像 / 设置快取 */

const store = window.idbKeyval;

export const KEYS = {
  handle: 'lushu:dirHandle',
  mirror: 'lushu:mirror',
  settingsCache: 'lushu:settingsCache',
  lastBook: 'lushu:lastBook',
};

function check() {
  if (!store || typeof store.get !== 'function') {
    throw new Error('idb-keyval 未加载');
  }
}

export const idb = {
  async get(key) { check(); return store.get(key); },
  async set(key, val) { check(); return store.set(key, val); },
  async del(key) { check(); return store.del(key); },
};
