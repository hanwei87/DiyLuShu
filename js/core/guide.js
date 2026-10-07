/**
 * 首次使用两步引导：先注册/登录 → 之后引导填入必要的高德 Key → 完成
 * 未登录用户绝不弹窗打扰，仅在注册/登录成功且未配置 Key 时提示
 */

import { state } from './state.js';
import { markDirty } from './persist.js';
import { openModal } from './modal.js';
import { isLoggedIn } from './auth.js';
import { escapeHtml } from './utils.js';

export function isTestMode() {
  return new URLSearchParams(location.search).has('test');
}

export function shouldShowGuide() {
  if (isTestMode()) return false;
  // 核心原则：未登录/未注册用户绝对不弹出 Key 引导，先完成账号体系构建
  if (!isLoggedIn()) return false;
  if (state.settings.guideDismissed) return false;
  return !state.settings.amapKey;
}

export function showGuide() {
  // 如果已存在引导弹窗，避免重复弹出
  if (document.querySelector('.guide-step-mask')) return;

  const { mask, body, close } = openModal({ title: '开始使用路书', content: '' });
  mask.classList.add('guide-step-mask');
  mask.querySelector('[data-act="ok"]').hidden = true;

  function skipBtn() {
    const b = document.createElement('button');
    b.className = 'btn ghost';
    b.textContent = '跳过，以后再说';
    b.addEventListener('click', () => finish());
    return b;
  }

  function finish() {
    state.settings.guideDismissed = true;
    markDirty('settings');
    close();
  }

  function render(step) {
    const cancel = mask.querySelector('[data-act="cancel"]');
    if (cancel) cancel.replaceWith(skipBtn());

    if (step === 1) {
      body.innerHTML = `<div class="guide-step">
        <p style="font-size:15px;font-weight:600;margin-bottom:6px;">第1步 / 共2步 · 填入必要的高德地图 Key</p>
        <p class="modal-msg" style="margin:8px 0 14px;color:var(--sub);font-size:12.5px;line-height:1.5;">
          地图搜索、地点标注与自驾规划基于高德开放平台服务（个人免费申请，服务平台选择「Web端 (JS API)」）。<br>
          已有可直接填入；如暂未申请，也可以点击下方<strong>「跳过，以后再说」</strong>，随时在「系统设置」中补填。
        </p>
        <div class="field">
          <label>高德 Key <span style="color:var(--pri);font-size:11px;font-weight:600;">*必须 (Web端)</span></label>
          <input type="text" data-g="key" value="${escapeHtml(state.settings.amapKey || '')}" placeholder="高德开放平台申请的 Web端(JS API) Key">
        </div>
        <div class="field">
          <label>安全密钥 securityJsCode <span style="color:var(--pri);font-size:11px;font-weight:600;">*配套</span></label>
          <input type="text" data-g="sec" value="${escapeHtml(state.settings.securityCode || '')}" placeholder="与高德 Key 配套的安全密钥">
        </div>
        <div class="field">
          <label>高德天气 Key <span style="color:var(--sub);font-size:11px;">(选填，自驾/旅行天气预报)</span></label>
          <input type="text" data-g="weather" value="${escapeHtml(state.settings.weatherKey || '')}" placeholder="选填，高德 Web服务 API Key">
        </div>
        <div style="margin-top:16px;">
          <button class="btn primary" data-g="next">下一步</button>
        </div>
      </div>`;

      body.querySelector('[data-g="next"]').addEventListener('click', () => {
        state.settings.amapKey = body.querySelector('[data-g="key"]').value.trim();
        state.settings.securityCode = body.querySelector('[data-g="sec"]').value.trim();
        state.settings.weatherKey = body.querySelector('[data-g="weather"]').value.trim();
        markDirty('settings');
        render(2);
      });
    } else {
      body.innerHTML = `<div class="guide-step">
        <p style="font-size:15px;font-weight:600;margin-bottom:6px;">第2步 / 共2步 · 准备就绪</p>
        <p class="modal-msg" style="margin:8px 0 16px;color:var(--sub);font-size:12.5px;line-height:1.6;">
          🎉 恭喜！您的专属旅行空间已配置就绪。<br>
          所有行程计划、地点收藏与 Key 配置均独立持久化保存在云端。<br><br>
          <strong>快速上手三步法：</strong><br>
          1. <strong>「新建路书」</strong>：创建您的第一份自驾或自由行计划；<br>
          2. <strong>「地图选点」</strong>：搜寻心仪的美食、景点与住宿一键收藏；<br>
          3. <strong>「规划路线」</strong>：按天排布打卡动线，并生成精美自驾路书！
        </p>
        <button class="btn primary" data-g="done">开始使用</button>
      </div>`;
      body.querySelector('[data-g="done"]').addEventListener('click', () => finish());
    }
  }

  render(1);
}
