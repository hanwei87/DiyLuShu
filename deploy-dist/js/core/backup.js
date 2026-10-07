/** 备份导出/导入（纯逻辑，可测试） */

import { deepClone } from './utils.js';

export function exportAll(st) {
  return {
    version: 1,
    app: 'lushu',
    exportedAt: new Date().toISOString(),
    settings: deepClone(st.settings),
    library: deepClone(st.library),
    books: deepClone(st.books),
  };
}

export function validateBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('备份文件内容为空');
  if (data.app !== 'lushu' || data.version !== 1) throw new Error('不是本应用的备份文件');
  if (!data.library || !Array.isArray(data.library.items)) throw new Error('备份缺少信息库数据');
  if (!Array.isArray(data.books)) throw new Error('备份缺少路书数据');
  return true;
}

/** 导入 = 全量替换 st 的内容（不替换 ui 偏好） */
export function importAll(st, data) {
  validateBackup(data);
  st.settings = { ...st.settings, ...data.settings };
  st.library = {
    categories: data.library.categories || [],
    tags: data.library.tags || [],
    items: data.library.items,
  };
  st.books = data.books.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return st;
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
