/** 首页：产品Hero + 四步指引（带箭头动线）+ 最新5本预览（显示更多→我的路书） */

import { state } from '../core/state.js';
import {
  newBookDialog, openBook, renderBookGridInto,
} from './mybooks.js';

let cardsEl = null;

/** 刷新首页预览（始终写入当前DOM；监听器闭包经由此模块级函数操作最新网格） */
function refreshPreview() {
  const books = [...state.books].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  renderBookGridInto(cardsEl, books.slice(0, 5), {
    withMenu: false, // 首页预览卡不带菜单（十四轮反馈3），点卡片直接进路书
    onChange: refreshPreview,
    emptyHtml: `<div class="empty-state" data-page="home-empty">
      <div class="big">📘</div><p>还没有路书，点这里创建第一份行程</p>
      <button class="btn primary" data-act="new">＋ 新建路书</button></div>`,
  });
}

export async function render(el) {
  el.innerHTML = `
    <div data-page="home">
    <div class="hero">
      <div class="hero-txt">
        <h1>把一次出行，装进一本路书</h1>
        <p>本地优先与云端同步的行程规划工具：搜地点、做收藏、按天排线、一键优化顺序，
           生成带分色驾车路线和导航二维码的电子路书。<strong>多用户独立数据空间，安全持久保存。</strong></p>
        <div class="hero-actions">
          <button class="btn primary" data-act="new">＋ 新建路书</button>
          <button class="btn" data-act="howto">↓ 了解使用方法</button>
        </div>
      </div>
    </div>
    <div class="steps" id="home-steps">
      <div class="step-card"><div class="step-no">1</div><div class="step-emoji">📍</div><h4>地图选点</h4><p>搜餐厅、酒店、景点，看位置确认后一键收藏</p></div>
      <div class="step-arrow">→</div>
      <div class="step-card"><div class="step-no">2</div><div class="step-emoji">🏷️</div><h4>收藏地点</h4><p>自定义分类与标签，长期沉淀，多条路线复用</p></div>
      <div class="step-arrow">→</div>
      <div class="step-card"><div class="step-no">3</div><div class="step-emoji">🗓️</div><h4>规划路线</h4><p>按天拖拽排行程，设今晚住宿，⚡一键优化不走回头路</p></div>
      <div class="step-arrow">→</div>
      <div class="step-card"><div class="step-no">4</div><div class="step-emoji">🧾</div><h4>生成路线</h4><p>分色驾车路线+每段距离用时+当天天气，随时出发</p></div>
    </div>
    <div class="sec-head">
      <h2>我的路书</h2>
      <span style="color:var(--sub);font-size:12px;">最新编辑的 5 本</span>
      <span style="flex:1"></span>
      <button class="btn primary sm" data-act="new">＋ 新建路书</button>
    </div>
    <div class="grid" id="bookGrid"></div>
    <div class="more-wrap"><button class="btn" data-act="morebooks">显示更多 →</button></div>
    <div class="share-teaser">🤝 用户分享路书 · 规划中：将来可把做好的路书分享给同行的人</div>
    <div class="home-foot" id="homeFoot"></div>
    </div>`;
  const grid = el.querySelector('#bookGrid');
  cardsEl = grid; // 模块级引用：监听器闭包始终操作当前DOM（修复切页回来后新建不显示）
  refreshPreview();

  el.querySelector('#homeFoot').innerHTML =
    `数据保存：<strong>服务器 SQLite 数据库</strong>
     <span>· 刷新/关机不丢失</span><span>· 管理入口在「系统设置」</span>`;

  const root = el.querySelector('[data-page="home"]');
  root.addEventListener('click', async e => {
      if (e.target.closest('[data-act="howto"]')) {
        document.getElementById('home-steps')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (e.target.closest('[data-act="morebooks"]')) {
        location.hash = '#/mybooks';
        return;
      }
      const newBtn = e.target.closest('[data-act="new"]');
      if (newBtn) {
        const book = await newBookDialog('picker'); // 新建后先去地图选点收集地点
        if (book) refreshPreview();
        return;
      }
      const card = e.target.closest('[data-book]');
      if (card) {
        const book = state.books.find(b => b.id === card.dataset.book);
        if (book) openBook(book, 'planner');
      }
    });
}
