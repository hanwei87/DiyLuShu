/** 快速切换当前路书的弹窗（顶栏芯片点击） */

import { state, currentBook } from './state.js';
import { openModal } from './modal.js';
import { escapeHtml, relTime } from './utils.js';

export function pickBook() {
  return new Promise(resolve => {
    const { mask, body, close } = openModal({
      title: '选择要编辑的路书',
      content: '',
      className: 'book-picker-modal'
    });
    mask.querySelector('[data-act="ok"]').hidden = true;
    const cancel = mask.querySelector('[data-act="cancel"]');
    cancel.textContent = '关闭';

    if (!state.books.length) {
      body.innerHTML = `<p class="modal-msg">还没有路书，去首页新建一份吧。</p>`;
      return;
    }

    const currentId = currentBook()?.id;

    body.innerHTML = `
      <div class="book-picker-grid">
        ${state.books.map(b => {
          const isCurrent = (b.id === currentId);
          const stopCount = (b.days || []).reduce((n, d) => n + (d.stopItemIds?.length || 0) + (d.stayItemId ? 1 : 0), 0);
          const dayCount = (b.days || []).length;
          const infoText = dayCount ? `${dayCount}天 · ${stopCount}个地点` : '还没排行程';
          return `
            <div class="book-picker-card ${isCurrent ? 'current' : ''}" data-pick="${b.id}" tabindex="0" role="button">
              <div class="bp-top">
                <span class="bp-icon">🗺️</span>
                <span class="bp-name" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</span>
                ${isCurrent ? '<span class="bp-tag">当前</span>' : ''}
              </div>
              <div class="bp-bottom">
                <span class="bp-info">${infoText}</span>
                <span class="bp-time">${relTime(b.updatedAt)}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    const selectBook = id => {
      const book = state.books.find(b => b.id === id);
      resolve(book || null);
      close();
    };

    body.addEventListener('click', e => {
      const card = e.target.closest('[data-pick]');
      if (!card) return;
      selectBook(card.dataset.pick);
    });

    body.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('[data-pick]');
        if (card) {
          e.preventDefault();
          selectBook(card.dataset.pick);
        }
      }
    });
  });
}
