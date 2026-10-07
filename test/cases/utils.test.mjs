import { describe, it, assert } from '../harness.mjs';
import {
  uid, debounce, haversine, safeFilename, todayCompact,
  fmtClock, fmtDate, relTime, escapeHtml, deepEqual,
} from '../../js/core/utils.js';

describe('M0 utils 工具函数', () => {
  it('uid 生成唯一且带前缀', () => {
    const set = new Set();
    for (let i = 0; i < 2000; i++) set.add(uid());
    assert.eq(set.size, 2000);
    assert.ok(uid('book').startsWith('book_'));
  });

  it('debounce：等待期内的多次调用只执行一次', async () => {
    let n = 0;
    const fn = debounce(() => n++, 60);
    fn(); fn(); fn();
    assert.eq(n, 0);
    await new Promise(r => setTimeout(r, 120));
    assert.eq(n, 1);
  });

  it('haversine：成都→北京约1515公里，同点为0', () => {
    const cd = [104.065, 30.572], bj = [116.397, 39.909];
    const d = haversine(cd, bj);
    assert.near(d, 1_515_000, 40_000, `成都北京距离异常: ${d}`);
    assert.near(haversine(cd, cd), 0, 1);
  });

  it('haversine：经度跨180度方向正确（取劣弧）', () => {
    // (179,10)→(-179,10) 应约 2度经差 × 纬度余弦，不是绕远路
    const d = haversine([179, 10], [-179, 10]);
    assert.lt(d, 400_000, `跨180度距离异常: ${d}`);
  });

  it('safeFilename：去除非法字符与空白，限长，空名兜底', () => {
    assert.eq(safeFilename('成都/三日:游?'), '成都_三日_游');
    assert.eq(safeFilename('  成都 三日游  '), '成都_三日游');
    assert.eq(safeFilename('///'), '未命名');
    assert.eq(safeFilename('a'.repeat(100)).length, 40);
  });

  it('todayCompact 输出 YYYYMMDD', () => {
    assert.eq(todayCompact(new Date(2026, 9, 1)), '20261001');
    assert.eq(todayCompact(new Date(2026, 0, 5)), '20260105');
  });

  it('fmtClock / fmtDate', () => {
    assert.eq(fmtClock(new Date(2026, 8, 30, 9, 5).getTime()), '09:05');
    assert.eq(fmtDate('2026-10-01'), '10月1日');
    assert.eq(fmtDate('bad'), 'bad');
    assert.eq(fmtDate(''), '');
  });

  it('relTime 相对时间', () => {
    const now = Date.now();
    assert.eq(relTime(now - 10_000), '刚刚');
    assert.eq(relTime(now - 5 * 60_000), '5分钟前');
  });

  it('escapeHtml 转义五个危险字符', () => {
    assert.eq(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('deepEqual 深比较', () => {
    assert.ok(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
    assert.ok(!deepEqual({ a: 1 }, { a: 1, b: undefined }));
    assert.ok(deepEqual(NaN, NaN));
  });
});
