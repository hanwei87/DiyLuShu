/** 应用名称（品牌字）应用：顶栏 + 标题 */

import { state } from './state.js';

export function defaultAppName() { return '路书'; }

export function currentAppName() { return state.settings.appName || defaultAppName(); }

export function applyAppName() {
  const name = currentAppName();
  const brand = document.getElementById('brand');
  if (brand) brand.textContent = `🗺 ${name}`;
  document.title = `${name} · 本地行程规划`;
}
