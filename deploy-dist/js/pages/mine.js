import { state } from '../core/state.js';
import { markDirty } from '../core/persist.js';
import { toast } from '../core/toast.js';
import { exportAll, importAll, downloadJson } from '../core/backup.js';
import { applyAppName, defaultAppName } from '../core/brand.js';
import { escapeHtml } from '../core/utils.js';
import { KEYS } from '../core/idb.js';
import { getCurrentUser, logout, showAuthModal, maskPhone } from '../core/auth.js';

export async function render(container) {
  const user = getCurrentUser();

  container.innerHTML = `
    <div data-page="mine">
      <div class="page-head"><h1>系统设置</h1></div>

      <div class="panel mine-panel">
        <h3>用户账号</h3>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:4px 0 6px;">
          <div>
            <div style="font-weight:700;font-size:16px;display:flex;align-items:center;gap:6px;">
              <span>📱</span>
              <span>${user ? escapeHtml(maskPhone(user.phone)) : '未登录'}</span>
              ${user ? '<span class="chip active" style="font-size:11px;padding:1px 8px;">独立数据空间</span>' : ''}
            </div>
            <p class="modal-msg" style="margin-top:6px;font-size:12px;color:var(--sub);">
              多用户数据已独立隔离。您的路书、地点库及下方高德地图设置仅归属于当前账号。
            </p>
          </div>
          <div>
            ${user
              ? '<button class="btn sm danger" data-act="logout">退出账号</button>'
              : '<button class="btn sm primary" data-act="login">立即登录 / 注册</button>'
            }
          </div>
        </div>
      </div>

      <div class="panel mine-panel">
        <h3>个性化</h3>
        <div class="field"><label>应用名称（替代顶栏的「${escapeHtml(defaultAppName())}」二字）</label>
          <input type="text" data-appname value="${escapeHtml(state.settings.appName || '')}" placeholder="${escapeHtml(defaultAppName())}">
        </div>
        <button class="btn sm primary" data-act="savename">保存名称</button>
      </div>

      <div class="panel mine-panel">
        <h3>高德地图 <span class="chip" style="font-size:11px;margin-left:6px;font-weight:normal;">当前账号独立配置</span></h3>
        <div class="field"><label>高德 Key（Web端 JS API）</label>
          <input type="text" data-amapkey value="${escapeHtml(state.settings.amapKey || '')}" placeholder="每个用户独立申请填入，lbs.amap.com 免费获取">
        </div>
        <div class="field">
          <label>安全密钥 securityJsCode</label>
          <div style="position:relative;display:flex;align-items:center;">
            <input type="password" data-seccode value="${escapeHtml(state.settings.securityCode || '')}" placeholder="与Key配套的安全密钥" style="padding-right:38px;">
            <button type="button" class="btn-eye-toggle" data-target="data-seccode" title="显示/隐藏密钥" style="position:absolute;right:8px;border:none;background:transparent;cursor:pointer;color:var(--sub);font-size:14px;padding:4px;">👁️</button>
          </div>
        </div>
        <div class="field">
          <label>天气 Key（Web服务 API，用于生成页天气预报，选填）</label>
          <div style="position:relative;display:flex;align-items:center;">
            <input type="password" data-weatherkey value="${escapeHtml(state.settings.weatherKey || '')}" placeholder="与上面同账号，类型选「Web服务」" style="padding-right:38px;">
            <button type="button" class="btn-eye-toggle" data-target="data-weatherkey" title="显示/隐藏Key" style="position:absolute;right:8px;border:none;background:transparent;cursor:pointer;color:var(--sub);font-size:14px;padding:4px;">👁️</button>
          </div>
        </div>
        <button class="btn sm primary" data-act="savekey">保存Key</button>
        <p class="modal-msg" style="margin-top:10px;font-size:12px;">没有Key？前往注册：<a href="https://lbs.amap.com/" target="_blank" rel="noopener">lbs.amap.com（高德开放平台）</a><br>
        <span style="color:var(--sub);">地图用「Web端(JS API)」类型；天气用「Web服务」类型，同一账号即可创建两种。</span></p>
      </div>

      <div class="panel mine-panel">
        <h3>备份与恢复</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn" data-act="export">⬇️ 导出全部数据</button>
          <button class="btn" data-act="import">⬆️ 导入备份</button>
          <input type="file" accept="application/json,.json" data-file hidden>
        </div>
        <p class="modal-msg" style="margin-top:10px;font-size:12px;">清浏览器缓存前建议先导出一份备份。</p>
      </div>
    </div>`;

  const root = container.querySelector('[data-page="mine"]');
  root.addEventListener('click', async e => {
    const eyeBtn = e.target.closest('.btn-eye-toggle');
    if (eyeBtn) {
      const targetAttr = eyeBtn.dataset.target;
      const input = container.querySelector(`[${targetAttr}]`);
      if (input) {
        const isPwd = input.type === 'password';
        input.type = isPwd ? 'text' : 'password';
        eyeBtn.style.opacity = isPwd ? '1' : '0.4';
      }
      return;
    }

    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    if (!act) return;

    if (act === 'logout') {
      const ok = await logout();
      if (ok) render(container);
    } else if (act === 'login') {
      showAuthModal({
        onSuccess: async () => {
          render(container);
        }
      });
    } else if (act === 'savename') {
      const input = container.querySelector('[data-appname]');
      state.settings.appName = input.value.trim();
      markDirty('settings');
      try { localStorage.setItem(KEYS.settingsCache, JSON.stringify(state.settings)); } catch { /* 忽略 */ }
      applyAppName();
      toast(`应用名称已保存：${state.settings.appName || defaultAppName()}`);
    } else if (act === 'savekey') {
        state.settings.amapKey = container.querySelector('[data-amapkey]').value.trim();
        state.settings.securityCode = container.querySelector('[data-seccode]').value.trim();
        state.settings.weatherKey = container.querySelector('[data-weatherkey]').value.trim();
        markDirty('settings');
        try { localStorage.setItem(KEYS.settingsCache, JSON.stringify(state.settings)); } catch { /* 忽略 */ }
        toast('Key已保存，刷新后生效');
      } else if (act === 'export') {
        downloadJson(exportAll(state), `路书备份_${new Date().toISOString().slice(0, 10)}.json`);
        toast('备份已导出');
      } else if (act === 'import') {
        container.querySelector('[data-file]').click();
      }
    });
    root.addEventListener('change', async e => {
      if (!e.target.matches('[data-file]')) return;
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        importAll(state, data);
        markDirty('settings'); markDirty('library');
        state.books.forEach(b => markDirty(`book:${b.id}`));
        await import('../core/persist.js').then(m => m.flushAll());
        applyAppName();
        toast('备份已导入，即将刷新', 'ok');
        setTimeout(() => location.reload(), 700);
      } catch (err) {
        toast(`导入失败：${err.message}`, 'error');
      }
    });

    const appInput = root.querySelector('[data-appname]');
    if (appInput) {
      appInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          root.querySelector('[data-act="savename"]')?.click();
        }
      });
    }
}
