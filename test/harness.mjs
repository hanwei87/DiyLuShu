/** 零依赖浏览器测试运行器：describe/it/assert，结果输出到 window.__testResults */

import { deepEqual } from '../js/core/utils.js';

const suites = [];
let cur = null;

export function describe(name, fn) {
  cur = { name, tests: [] };
  suites.push(cur);
  fn();
  cur = null;
}

export function it(name, fn) {
  cur.tests.push({ name, fn });
}

export const assert = {
  ok(v, msg = '断言失败：应为真') {
    if (!v) throw new Error(msg);
  },
  notOk(v, msg = '断言失败：应为假') {
    if (v) throw new Error(msg);
  },
  eq(actual, expected, msg) {
    if (!deepEqual(actual, expected)) {
      throw new Error(msg || `断言失败:\n  实际: ${JSON.stringify(actual)}\n  期望: ${JSON.stringify(expected)}`);
    }
  },
  near(actual, expected, tol, msg) {
    if (Math.abs(actual - expected) > tol) {
      throw new Error(msg || `断言失败: ${actual} 与 ${expected} 相差超过 ${tol}`);
    }
  },
  gt(a, b, msg) { if (!(a > b)) throw new Error(msg || `断言失败: ${a} 应大于 ${b}`); },
  gte(a, b, msg) { if (!(a >= b)) throw new Error(msg || `断言失败: ${a} 应不小于 ${b}`); },
  lt(a, b, msg) { if (!(a < b)) throw new Error(msg || `断言失败: ${a} 应小于 ${b}`); },
  notEq(a, b, msg) {
    if (deepEqual(a, b)) {
      throw new Error(msg || `断言失败: 两值不应相等 (${JSON.stringify(a)})`);
    }
  },
  includes(hay, needle, msg) {
    if (!hay || !String(hay).includes(needle)) {
      throw new Error(msg || `断言失败: "${hay}" 应包含 "${needle}"`);
    }
  },
  notIncludes(hay, needle, msg) {
    if (hay && String(hay).includes(needle)) {
      throw new Error(msg || `断言失败: "${hay}" 不应包含 "${needle}"`);
    }
  },
  has(el, selector, msg) {
    if (!el || !el.querySelector(selector)) {
      throw new Error(msg || `断言失败: 应存在元素 ${selector}`);
    }
  },
  notHas(el, selector, msg) {
    if (el && el.querySelector(selector)) {
      throw new Error(msg || `断言失败: 不应存在元素 ${selector}`);
    }
  },
  throws(fn, msg = '断言失败：应抛出异常') {
    try { fn(); } catch { return; }
    throw new Error(msg);
  },
  async rejects(promise, msg = '断言失败：应抛出异常') {
    try { await promise; } catch { return; }
    throw new Error(msg);
  },
};

export async function runAll(filter) {
  const results = { suites: [], summary: { total: 0, passed: 0, failed: 0 } };
  for (const s of suites) {
    if (filter && !s.name.includes(filter)) continue;
    const rs = { name: s.name, tests: [] };
    for (const t of s.tests) {
      results.summary.total++;
      try {
        await t.fn();
        rs.tests.push({ name: t.name, ok: true });
        results.summary.passed++;
      } catch (err) {
        rs.tests.push({ name: t.name, ok: false, error: String((err && err.stack) || err).split('\n').slice(0, 8).join('\n') });
        results.summary.failed++;
      }
    }
    results.suites.push(rs);
  }
  return results;
}

export function renderReport(container, results) {
  let html = `<h2>路书测试报告</h2>
    <p>总计 ${results.summary.total} · <span class="pass">通过 ${results.summary.passed}</span> · <span class="fail">失败 ${results.summary.failed}</span></p>`;
  for (const s of results.suites) {
    html += `<div class="suite">${s.name}</div>`;
    for (const t of s.tests) {
      html += t.ok
        ? `<div class="pass">✓ ${t.name}</div>`
        : `<div class="fail">✗ ${t.name}</div><pre>${t.error || ''}</pre>`;
    }
  }
  container.innerHTML = html;
}
