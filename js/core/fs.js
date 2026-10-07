/**
 * 存储适配器兼容层：保留内存适配器供单元测试与降级使用。
 * 生产环境统一由 REST API + 后端 SQLite 驱动。
 */

import { idb, KEYS } from './idb.js';

let adapter = null;

export function getAdapter() { return adapter; }
export function setAdapter(a) { adapter = a; } // 供测试使用

export const PATHS = {
  settings: '路书数据/设置.json',
  library: '路书数据/信息库.json',
  booksDir: '路书数据/路书',
  book: file => `路书数据/路书/${file}`,
};

export async function initStorage() {
  const params = new URLSearchParams(location.search);
  if (params.get('storage') === 'memory') {
    adapter = createMemoryAdapter();
    return 'memory';
  }
  return 'api';
}

/* ---------- 内存适配器（单元测试与纯内存模式） ---------- */

export function createMemoryAdapter() {
  const files = new Map();
  let chosen = false;
  return {
    kind: 'memory',
    async chooseDirectory() { chosen = true; return 'mem://root'; },
    async ensurePermission() { return chosen ? 'granted' : 'none'; },
    async hasPermission() { return chosen; },
    async readAll() {
      if (!chosen) return null;
      const out = { settings: null, library: null, books: {} };
      for (const [path, text] of files) {
        const obj = JSON.parse(text);
        if (path === PATHS.settings) out.settings = obj;
        else if (path === PATHS.library) out.library = obj;
        else if (path.startsWith('路书数据/路书/') && path.endsWith('.json')) {
          out.books[path.slice('路书数据/路书/'.length)] = obj;
        }
      }
      return out;
    },
    async writeJSON(relPath, obj) {
      files.set(relPath, JSON.stringify(obj, null, 2));
    },
    async deleteFile(relPath) { files.delete(relPath); },
    async renameFile(oldRel, newRel) {
      if (!files.has(oldRel)) throw new Error(`文件不存在: ${oldRel}`);
      files.set(newRel, files.get(oldRel));
      files.delete(oldRel);
    },
    _files: files,
  };
}

/* ---------- 真实文件夹适配器（FSA 向后兼容壳） ---------- */

export function createFsAdapter() {
  let root = null;
  return {
    kind: 'fsaccess',
    async chooseDirectory() { return null; },
    async ensurePermission() { return 'none'; },
    async hasPermission() { return false; },
    async requestPermission() { return false; },
    async readAll() { return null; },
    async writeJSON() {},
    async deleteFile() {},
    async renameFile() {},
  };
}
