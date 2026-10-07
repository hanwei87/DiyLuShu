/** 我的路书：完整路书列表页 + 卡片组件（首页预览复用） */

import { state, findItem } from '../core/state.js';
import { createBook, renameBook, deleteBook, bookSummary } from '../core/bookOps.js';
import { formModal, confirmDialog } from '../core/modal.js';
import { toast } from '../core/toast.js';
import { escapeHtml, relTime, strToLoc } from '../core/utils.js';
import { downloadJson } from '../core/backup.js';
import { dayColor } from '../core/routeDraw.js';
import { effectiveStayId } from '../core/plannerOps.js';

export async function openBook(book, page = 'planner') {
  state.ui.lastBookId = book.id;
  try { localStorage.setItem('lushu:lastBook', book.id); } catch { /* 忽略 */ }
  location.hash = `#/${page}`;
}

export async function newBookDialog(jumpPage = 'planner') {
  const values = await formModal({
    title: '新建路书',
    fields: [
      {
        key: 'name',
        label: '路书名称',
        type: 'text',
        required: true,
        placeholder: '如：成都三日游',
        validate: val => {
          const trimmed = (val || '').trim();
          if (state.books.some(b => b.name === trimmed)) {
            return `已存在同名路书《${trimmed}》，请更换名称`;
          }
          return null;
        }
      },
    ],
    okText: '创建',
  });
  if (!values) return null;
  const book = createBook(values);
  toast(`已创建《${book.name}》`);
  openBook(book, jumpPage);
  return book;
}

const COVER_THEMES = [
  {
    name: 'ocean',
    bg: 'linear-gradient(135deg, #f0f7ff 0%, #e0f2fe 100%)',
    grid: 'rgba(2, 132, 199, 0.08)',
    glow: 'rgba(2, 132, 199, 0.32)',
    line: '#0284c7',
    badgeBg: 'rgba(255, 255, 255, 0.92)',
    badgeText: '#0284c7',
    pillText: '#0369a1',
  },
  {
    name: 'sunset',
    bg: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)',
    grid: 'rgba(234, 88, 12, 0.08)',
    glow: 'rgba(234, 88, 12, 0.32)',
    line: '#ea580c',
    badgeBg: 'rgba(255, 255, 255, 0.92)',
    badgeText: '#ea580c',
    pillText: '#9a3412',
  },
  {
    name: 'forest',
    bg: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
    grid: 'rgba(22, 163, 74, 0.08)',
    glow: 'rgba(22, 163, 74, 0.32)',
    line: '#16a34a',
    badgeBg: 'rgba(255, 255, 255, 0.92)',
    badgeText: '#16a34a',
    pillText: '#166534',
  },
  {
    name: 'lavender',
    bg: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)',
    grid: 'rgba(147, 51, 234, 0.08)',
    glow: 'rgba(147, 51, 234, 0.32)',
    line: '#9333ea',
    badgeBg: 'rgba(255, 255, 255, 0.92)',
    badgeText: '#9333ea',
    pillText: '#6b21a8',
  },
  {
    name: 'rose',
    bg: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)',
    grid: 'rgba(225, 29, 72, 0.08)',
    glow: 'rgba(225, 29, 72, 0.32)',
    line: '#e11d48',
    badgeBg: 'rgba(255, 255, 255, 0.92)',
    badgeText: '#e11d48',
    pillText: '#9f1239',
  },
  {
    name: 'amber',
    bg: 'linear-gradient(135deg, #fefce8 0%, #fef08a 100%)',
    grid: 'rgba(202, 138, 4, 0.08)',
    glow: 'rgba(202, 138, 4, 0.32)',
    line: '#ca8a04',
    badgeBg: 'rgba(255, 255, 255, 0.92)',
    badgeText: '#ca8a04',
    pillText: '#854d0e',
  },
];

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
  return h;
}

function getBookTheme(book) {
  const str = book.id || book.name || '';
  return COVER_THEMES[Math.abs(hashStr(str)) % COVER_THEMES.length];
}

/** 平滑样条曲线生成 (Catmull-Rom to Cubic Bezier) */
function getSmoothSplinePath(pts, tension = 0.35) {
  if (!pts || !pts.length) return '';
  if (pts.length === 1) return `M ${pts[0].px} ${pts[0].py}`;
  if (pts.length === 2) {
    const p0 = pts[0], p1 = pts[1];
    const mx = (p0.px + p1.px) / 2;
    const my = (p0.py + p1.py) / 2 - 8;
    return `M ${p0.px} ${p0.py} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${p1.px} ${p1.py}`;
  }

  let d = `M ${pts[0].px} ${pts[0].py}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = (i !== pts.length - 2) ? pts[i + 2] : p2;

    const cp1x = p1.px + (p2.px - p0.px) * tension;
    const cp1y = p1.py + (p2.py - p0.py) * tension;
    const cp2x = p2.px - (p3.px - p1.px) * tension;
    const cp2y = p2.py - (p3.py - p1.py) * tension;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.px} ${p2.py}`;
  }
  return d;
}

/** 提取路书每天调用的收藏地点 */
function getDayPlaces(book) {
  const result = [];
  (book.days || []).forEach((d, di) => {
    const names = [];
    const itemIds = [...(d.stopItemIds || [])];
    if (d.stayItemId && !itemIds.includes(d.stayItemId)) {
      itemIds.push(d.stayItemId);
    }
    itemIds.forEach(id => {
      const it = findItem(id);
      if (it && it.name) {
        names.push(it.name);
      }
    });
    if (names.length) {
      result.push({
        dayIndex: di,
        dayNum: di + 1,
        color: dayColor(di),
        names,
        text: names.join(' · '),
      });
    }
  });
  return result;
}

function getCityOrRegion(book) {
  for (const d of (book.days || [])) {
    for (const id of (d.stopItemIds || [])) {
      const it = findItem(id);
      if (it?.address) {
        const m = it.address.match(/(.+?[省市区县市旗])/);
        if (m) {
          const clean = m[1].replace(/^(中国|河北省|辽宁省|四川省|广东省|北京市|上海市)/, '').slice(0, 6) || m[1].slice(0, 5);
          if (clean) return clean;
        }
      }
    }
  }
  const name = book.name || '';
  const m = name.match(/([\u4e00-\u9fa5]{2,4})(?:路书|游|自驾|之旅|路线)/);
  if (m) return m[1];
  return '';
}

/** 智能旅程手账封面（方案 D：手账网格 + 柔光轨迹 + 胶囊标签 + 票根质感） */
export function coverSvgHtml(book) {
  const theme = getBookTheme(book);
  const pts = [];
  (book.days || []).forEach((d, di) => {
    const eff = effectiveStayId(d);
    const ids = [...(d.stopItemIds || [])];
    if (eff) ids.push(eff);
    ids.forEach((id, si) => {
      const it = findItem(id);
      const loc = it && strToLoc(it.location);
      if (loc) pts.push({
        x: loc[0], y: loc[1], day: di, id,
        isLast: si === ids.length - 1,
        name: it.name || '',
      });
    });
  });

  // 空路书时：旅行手账票根（Boarding Pass 质感）
  if (!pts.length) {
    const tripNum = String(Math.abs(hashStr(book.id || '1'))).slice(-4).padStart(4, '0');
    return `
      <div data-cover="${book.id}">
        <div class="smart-cover empty-ticket" style="background:${theme.bg};">
          <div class="sc-grid-bg" style="--grid-color:${theme.grid}"></div>
          <div class="sc-ticket-inner" style="border-color:${theme.line}45;">
            <div class="sc-ticket-top">
              <span class="sc-ticket-tag" style="background:${theme.badgeBg};color:${theme.badgeText};">✈️ 待启程路书</span>
              <span class="sc-ticket-id">TRIP #${tripNum}</span>
            </div>
            <div class="sc-ticket-body">
              <div class="sc-compass">🧭</div>
              <div class="sc-ticket-prompt">
                <div class="sc-prompt-main">全新旅程，等待规划</div>
                <div class="sc-prompt-sub">去「规划路线」排入地点即刻点亮轨迹 →</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // 坐标规范化
  const W = 260, H = 105, PAD_X = 26, PAD_Y = 18;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 0.005);
  const spanY = Math.max(maxY - minY, 0.005);
  const scale = Math.min((W - PAD_X * 2) / spanX, (H - PAD_Y * 2) / spanY);
  const cxm = (minX + maxX) / 2, cym = (minY + maxY) / 2;

  pts.forEach(p => {
    p.px = +(W / 2 + (p.x - cxm) * scale).toFixed(1);
    p.py = +(H / 2 - (p.y - cym) * scale).toFixed(1);
  });

  const pathD = getSmoothSplinePath(pts);

  // 节点渲染：起点双环脉冲，终点旗帜，中途白芯彩色珍珠点
  const nodes = pts.map((p, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === pts.length - 1;
    const c = dayColor(p.day);

    if (isFirst) {
      return `
        <circle cx="${p.px}" cy="${p.py}" r="7.5" fill="${c}" opacity="0.25" />
        <circle cx="${p.px}" cy="${p.py}" r="4.2" fill="${c}" stroke="#fff" stroke-width="1.8">
          <title>起点: ${escapeHtml(p.name)}</title>
        </circle>
      `;
    }
    if (isLast) {
      return `
        <circle cx="${p.px}" cy="${p.py}" r="7.5" fill="${c}" opacity="0.25" />
        <circle cx="${p.px}" cy="${p.py}" r="4.2" fill="${c}" stroke="#fff" stroke-width="1.8">
          <title>终点: ${escapeHtml(p.name)}</title>
        </circle>
        <text x="${p.px}" y="${p.py - 6.5}" font-size="9" text-anchor="middle" fill="${c}">⚑</text>
      `;
    }
    return `
      <circle cx="${p.px}" cy="${p.py}" r="3.2" fill="#fff" stroke="${c}" stroke-width="2">
        <title>${escapeHtml(p.name)}</title>
      </circle>
    `;
  }).join('');

  // 按天调用的收藏地点展示
  const dayPlaces = getDayPlaces(book);
  let daysHtml = '';
  if (dayPlaces.length === 1) {
    const dp = dayPlaces[0];
    daysHtml = `
      <div class="sc-day-capsule" title="${escapeHtml(`D${dp.dayNum} (${dp.names.length}个地点): ${dp.names.join('、')}`)}">
        <span class="sc-day-pill" style="background:${dp.color};">D${dp.dayNum}</span>
        <span class="sc-day-text">${escapeHtml(dp.text)}</span>
      </div>
    `;
  } else if (dayPlaces.length >= 2) {
    const dp1 = dayPlaces[0];
    const dp2 = dayPlaces[1];
    const moreCount = dayPlaces.length - 2;
    const moreBadge = moreCount > 0 
      ? `<span class="sc-day-more" title="${escapeHtml(dayPlaces.slice(2).map(d => `D${d.dayNum} (${d.names.length}个地点): ${d.names.join('、')}`).join('\n'))}">+${moreCount}天</span>` 
      : '';
    daysHtml = `
      <div class="sc-day-capsule" title="${escapeHtml(`D${dp1.dayNum} (${dp1.names.length}个地点): ${dp1.names.join('、')}`)}">
        <span class="sc-day-pill" style="background:${dp1.color};">D${dp1.dayNum}</span>
        <span class="sc-day-text">${escapeHtml(dp1.text)}</span>
      </div>
      <div class="sc-day-capsule" title="${escapeHtml(`D${dp2.dayNum} (${dp2.names.length}个地点): ${dp2.names.join('、')}`)}">
        <span class="sc-day-pill" style="background:${dp2.color};">D${dp2.dayNum}</span>
        <span class="sc-day-text">${escapeHtml(dp2.text)}</span>
        ${moreBadge}
      </div>
    `;
  } else {
    daysHtml = `
      <div class="sc-day-capsule">
        <span class="sc-day-text" style="color:var(--sub);font-size:11px;">待排行程地点</span>
      </div>
    `;
  }

  // 城市与天数
  const city = getCityOrRegion(book);
  const daysCount = (book.days || []).length;

  return `
    <div data-cover="${book.id}">
      <div class="smart-cover" style="background:${theme.bg};">
        <div class="sc-grid-bg" style="--grid-color:${theme.grid}"></div>
        <div class="sc-topbar">
          ${city ? `<span class="sc-city-badge" style="background:${theme.badgeBg};color:${theme.badgeText};">${escapeHtml(city)}</span>` : '<span class="sc-city-badge" style="background:' + theme.badgeBg + ';color:' + theme.badgeText + ';">🗺️ 行程动线</span>'}
          <span class="sc-day-badge" style="background:${theme.badgeBg};color:${theme.badgeText};">${daysCount ? `${daysCount}天` : '路线'} · ${pts.length}地点</span>
        </div>
        <div class="sc-svg-wrap">
          <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
            <path d="${pathD}" fill="none" stroke="${theme.glow}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" />
            <path d="${pathD}" fill="none" stroke="${theme.line}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
            ${nodes}
          </svg>
        </div>
        <div class="sc-footer">
          ${daysHtml}
        </div>
      </div>
    </div>
  `;
}

export function cardHtml(book, { withMenu = true } = {}) {
  const s = bookSummary(book);
  return `<div class="card book-card" data-book="${book.id}">
    ${withMenu ? `<button class="more" data-menu="${book.id}" title="更多操作">⋯</button>` : ''}
    ${coverSvgHtml(book)}
    <h3>${escapeHtml(book.name)}</h3>
    <div class="meta"><span>${s.dayCount ? `${s.dayCount}天` : '还没排天'}</span><span>${s.stopCount}个地点</span><span>${relTime(book.updatedAt)}</span></div>
  </div>`;
}

export function showMenu(btn, book, onChange) {
  document.querySelector('[data-ctxmenu]')?.remove();
  const menu = document.createElement('div');
  menu.setAttribute('data-ctxmenu', '');
  menu.style.cssText = 'position:fixed;z-index:150;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow-lg);padding:4px;display:flex;flex-direction:column;min-width:120px;';
  menu.innerHTML = `
    <button class="btn ghost" data-m="rename" style="justify-content:flex-start;">✏️ 重命名</button>
    <button class="btn ghost" data-m="export" style="justify-content:flex-start;">⬇️ 导出此路书</button>
    <button class="btn ghost" data-m="delete" style="justify-content:flex-start;color:var(--danger);">🗑 删除</button>`;
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, window.innerWidth - 150)}px`;
  menu.style.top = `${r.bottom + 4}px`;
  menu.addEventListener('click', async e => {
    const act = e.target.closest('[data-m]')?.dataset.m;
    menu.remove();
    if (act === 'rename') {
      const v = await formModal({
        title: '重命名路书',
        fields: [{
          key: 'name',
          label: '新名称',
          type: 'text',
          required: true,
          value: book.name,
          validate: val => {
            const trimmed = (val || '').trim();
            if (trimmed !== book.name && state.books.some(b => b.id !== book.id && b.name === trimmed)) {
              return `已存在同名路书《${trimmed}》，请更换名称`;
            }
            return null;
          }
        }],
      });
      if (v) {
        try {
          await renameBook(book, v.name);
          toast('已重命名');
          onChange && onChange();
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    } else if (act === 'export') {
      downloadJson(book, book.file);
      toast('已导出');
    } else if (act === 'delete') {
      const ok = await confirmDialog({
        title: '删除路书',
        message: `确定删除路书《<strong>${escapeHtml(book.name)}</strong>》？<br>只删除这份路书本身，收藏地点会保留。`,
        okText: '删除', danger: true,
      });
      if (ok) { await deleteBook(book.id); toast('路书已删除'); onChange && onChange(); }
    }
  });
  setTimeout(() => {
    document.addEventListener('click', function onDoc(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', onDoc); }
    }, { once: false });
  }, 0);
}

/** 渲染卡片列表（books由调用方给定，支持首页限5本预览）并绑定交互 */
export function renderBookGridInto(grid, books, { onChange = null, emptyHtml = '', withMenu = true } = {}) {
  if (!grid) return;
  if (!books.length) {
    grid.innerHTML = emptyHtml || `<div class="empty-state"><div class="big">📘</div><p>还没有路书</p></div>`;
    return;
  }
  grid.innerHTML = books.map(b => cardHtml(b, { withMenu })).join('');
  if (!grid.dataset.cardBound) {
    grid.dataset.cardBound = '1';
    grid.addEventListener('click', async e => {
      const menuBtn = e.target.closest('[data-menu]');
      if (menuBtn) {
        const book = state.books.find(b => b.id === menuBtn.dataset.menu);
        if (book) showMenu(menuBtn, book, onChange);
        return;
      }
      const card = e.target.closest('[data-book]');
      if (card) {
        const book = state.books.find(b => b.id === card.dataset.book);
        if (book) openBook(book, 'planner');
      }
    });
  }
}

let allBooksGrid = null;

/** 刷新完整列表（模块级函数：监听器闭包始终操作当前DOM） */
function refreshAllBooks() {
  renderBookGridInto(allBooksGrid, [...state.books].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), {
    onChange: refreshAllBooks,
    emptyHtml: `<div class="empty-state" data-page="mybooks-empty">
      <div class="big">📘</div><p>还没有路书，点这里创建第一份行程</p>
      <button class="btn primary" data-act="new">＋ 新建路书</button></div>`,
  });
}

/** 完整「我的路书」页 */
export async function render(el) {
  el.innerHTML = `
    <div data-page="mybooks">
      <div class="page-head">
        <h1>我的路书</h1>
        <span style="flex:1"></span>
        <button class="btn primary" data-act="new">＋ 新建路书</button>
      </div>
      <div class="grid" data-allbooks></div>
    </div>`;
  allBooksGrid = el.querySelector('[data-allbooks]');
  refreshAllBooks();
  const root = el.querySelector('[data-page="mybooks"]'); // 每次渲染的新根节点：监听不跨页叠加
  root.addEventListener('click', async e => {
      if (e.target.closest('[data-act="new"]')) {
        const book = await newBookDialog('planner');
        if (book) refreshAllBooks();
      }
    });
}
