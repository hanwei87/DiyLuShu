/** 通用弹窗：openModal / confirmDialog / formModal */
import { escapeHtml } from './utils.js';

export function openModal({ title = '', content = '', wide = false, className = '', onClose = null }) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''} ${className}" role="dialog" data-modal>
      <h3>${escapeHtml(title)}</h3>
      <div class="modal-body">${content}</div>
      <div class="modal-footer">
        <button class="btn" data-act="cancel">取消</button>
        <button class="btn primary" data-act="ok">确定</button>
      </div>
    </div>`;
  document.getElementById('modalRoot').appendChild(mask);
  let settled = false;
  const close = () => {
    if (mask.isConnected) mask.remove();
    if (!settled) { settled = true; onClose && onClose(); }
  };
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  mask.querySelector('[data-act="cancel"]').addEventListener('click', close);
  const okBtn = mask.querySelector('[data-act="ok"]');
  return { mask, close, okBtn, body: mask.querySelector('.modal-body') };
}

/** 确认弹窗，resolve(true/false) */
export function confirmDialog({ title = '请确认', message = '', okText = '确定', danger = false }) {
  return new Promise(resolve => {
    const { mask, close, okBtn, body } = openModal({
      title,
      content: `<div class="modal-msg">${message}</div>`,
    });
    mask.querySelector('[data-act="cancel"]').textContent = '取消';
    okBtn.textContent = okText;
    if (danger) okBtn.classList.replace('primary', 'danger');
    okBtn.addEventListener('click', () => { resolve(true); close(); });
    mask.querySelector('[data-act="cancel"]').addEventListener('click', () => resolve(false));
    mask.addEventListener('click', e => { if (e.target === mask) resolve(false); });
    body.querySelector('.modal-msg') && void 0;
  });
}

/**
 * 表单弹窗。fields: [{key,label,type:'text'|'date'|'textarea'|'select'|'tagsel',options,required,placeholder,value,half}]
 * tagsel: 选项多选 + 可新建（value 为字符串数组）
 * resolve(值对象 | null)
 */
export function formModal({ title, fields, okText = '确定' }) {
  return new Promise(resolve => {
    const html = fields.map(f => {
      let inner = '';
      if (f.type === 'textarea') {
        inner = `<textarea rows="3" name="${f.key}" placeholder="${escapeHtml(f.placeholder || '')}">${escapeHtml(f.value || '')}</textarea>`;
      } else if (f.type === 'select') {
        const opts = (f.options || []).map(o =>
          `<option value="${escapeHtml(o.value)}" ${o.value === f.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
        inner = `<select name="${f.key}">${opts}</select>`;
      } else if (f.type === 'tagsel') {
        inner = `<div class="tagsel" data-key="${f.key}">
          ${(f.options || []).map(o => `<span class="chip tag-opt ${f.value?.includes(o.value) ? 'active' : ''}" data-v="${escapeHtml(o.value)}">${escapeHtml(o.label)}</span>`).join('')}
          <input type="text" class="newtag" placeholder="新建标签后回车" style="width:130px;border:1px solid var(--line-strong);border-radius:999px;padding:1px 10px;font-size:12px;">
        </div>`;
      } else {
        const maxAttr = f.maxlength ? ` maxlength="${f.maxlength}"` : '';
        inner = `<input type="${f.type || 'text'}" name="${f.key}" value="${escapeHtml(f.value ?? '')}" placeholder="${escapeHtml(f.placeholder || '')}"${maxAttr}>`;
      }
      const labelSuffix = f.maxlength ? ` <span style="font-size:11.5px;color:var(--sub);font-weight:normal;">(最多${f.maxlength}字)</span>` : '';
      return `<div class="field" data-field="${f.key}">
        <label>${escapeHtml(f.label)}${f.required ? ' *' : ''}${labelSuffix}</label>
        ${inner}
        <div class="err" hidden></div>
      </div>`;
    }).join('');
    const { mask, close, okBtn } = openModal({ title, content: html });
    okBtn.textContent = okText;

    // tagsel 交互
    mask.querySelectorAll('.tagsel').forEach(box => {
      box.addEventListener('click', e => {
        const chip = e.target.closest('.tag-opt');
        if (chip) chip.classList.toggle('active');
      });
      box.querySelector('.newtag').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const v = e.target.value.trim();
          if (!v) return;
          const chip = document.createElement('span');
          chip.className = 'chip tag-opt active';
          chip.dataset.v = v;
          chip.textContent = v;
          box.insertBefore(chip, e.target);
          e.target.value = '';
        }
      });
    });

    okBtn.addEventListener('click', () => {
      const out = {};
      let firstErr = null;
      for (const f of fields) {
        const wrap = mask.querySelector(`[data-field="${f.key}"]`);
        const err = wrap.querySelector('.err');
        let val;
        if (f.type === 'tagsel') {
          val = [...wrap.querySelectorAll('.tag-opt.active')].map(c => c.dataset.v);
        } else {
          const input = wrap.querySelector('input,select,textarea');
          val = input ? input.value.trim() : '';
        }
        if (f.required && (Array.isArray(val) ? !val.length : !val)) {
          err.textContent = `${f.label}不能为空`;
          err.hidden = false;
          firstErr ??= wrap;
          continue;
        }
        if (f.maxlength && typeof val === 'string' && val.length > f.maxlength) {
          err.textContent = `${f.label}不能超过 ${f.maxlength} 个字`;
          err.hidden = false;
          firstErr ??= wrap;
          continue;
        }
        if (typeof f.validate === 'function') {
          const customMsg = f.validate(val);
          if (customMsg) {
            err.textContent = customMsg;
            err.hidden = false;
            firstErr ??= wrap;
            continue;
          }
        }
        err.hidden = true;
        out[f.key] = val;
      }
      if (firstErr) { firstErr.querySelector('input,select,textarea')?.focus(); return; }
      resolve(out);
      close();
    });
    mask.addEventListener('click', e => { if (e.target === mask) resolve(null); });
    mask.querySelector('[data-act="cancel"]').addEventListener('click', () => resolve(null));
    mask.querySelector('input,select,textarea')?.focus();
  });
}
