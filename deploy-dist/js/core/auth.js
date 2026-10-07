/**
 * 用户认证模块：手机号登录/注册、Token 会话管理、多租户身份识别与顶栏状态
 * 登录名：11位手机号 (^1[3-9]\d{9}$)
 * 密码：6～8位纯数字 (^\d{6,8}$)
 */

import { state } from './state.js';
import { toast } from './toast.js';
import { confirmDialog } from './modal.js';
import { escapeHtml } from './utils.js';

const TOKEN_KEY = 'lushu:token';
const USER_KEY = 'lushu:user';

export const PHONE_REGEX = /^1[3-9]\d{9}$/;
export const PWD_REGEX = /^\d{6,8}$/;

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch { /* 忽略 */ }
}

export function getCurrentUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCurrentUser(user) {
  try {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  } catch { /* 忽略 */ }
}

export function isLoggedIn() {
  return Boolean(getToken() && getCurrentUser());
}

export function maskPhone(phone) {
  if (!phone || typeof phone !== 'string' || phone.length < 7) return phone || '';
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

/** 检验手机号格式 */
export function validatePhone(phone) {
  return PHONE_REGEX.test((phone || '').trim());
}

/** 检验密码格式（6～8位纯数字） */
export function validatePassword(pwd) {
  return PWD_REGEX.test((pwd || '').trim());
}

/** 登录接口 */
export async function login({ phone, password }) {
  phone = (phone || '').trim();
  password = (password || '').trim();
  if (!validatePhone(phone)) {
    throw new Error('请输入有效的11位手机号');
  }
  if (!validatePassword(password)) {
    throw new Error('密码必须为6～8位纯数字');
  }

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || '登录失败');
  }

  setToken(data.token);
  setCurrentUser(data.user);
  return data;
}

/** 注册新账号接口 */
export async function register({ phone, password }) {
  phone = (phone || '').trim();
  password = (password || '').trim();
  if (!validatePhone(phone)) {
    throw new Error('请输入有效的11位手机号');
  }
  if (!validatePassword(password)) {
    throw new Error('密码必须为6～8位纯数字');
  }

  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || '注册失败');
  }

  setToken(data.token);
  setCurrentUser(data.user);
  return data;
}

/** 退出登录 */
export async function logout(skipConfirm = false) {
  if (!skipConfirm) {
    const ok = await confirmDialog({
      title: '退出登录',
      message: '确定要退出当前账号吗？退出后可使用其他手机号登录。',
      okText: '退出登录',
      danger: true,
    });
    if (!ok) return false;
  }

  const token = getToken();
  if (token) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
    } catch { /* 忽略网络错误 */ }
  }

  setToken(null);
  setCurrentUser(null);

  // 清空内存数据
  state.books = [];
  state.library = { categories: [], tags: [], items: [] };
  state.settings = { amapKey: '', securityCode: '', weatherKey: '', appName: '', guideDismissed: false };
  state.ui.lastBookId = null;
  try { localStorage.removeItem('lushu:settingsCache'); } catch { /* 忽略 */ }
  try {
    const { applyAppName } = await import('./brand.js');
    applyAppName();
  } catch { /* 忽略 */ }

  renderUserChip();
  toast('已安全退出登录');

  // 引导重新登录
  showAuthModal({ canClose: false });
  return true;
}

/** 检验当前 Token 是否依然有效 */
export async function verifySession() {
  const token = getToken();
  if (!token) {
    setCurrentUser(null);
    return null;
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setCurrentUser(data.user);
      return data.user;
    }
  } catch { /* 离线或服务异常 */ }

  setToken(null);
  setCurrentUser(null);
  return null;
}

let activeModalMask = null;

/**
 * 弹出登录/注册模态弹窗
 * @param {object} options
 * @param {'login'|'register'} options.defaultTab
 * @param {boolean} options.canClose
 * @param {string} options.tip
 * @param {Function} options.onSuccess
 */
export function showAuthModal({ defaultTab = 'login', canClose = true, tip = '', onSuccess = null } = {}) {
  // 如果已存在弹窗，先清理
  if (activeModalMask && activeModalMask.isConnected) {
    activeModalMask.remove();
  }

  const mask = document.createElement('div');
  mask.className = 'modal-mask auth-modal-mask';
  activeModalMask = mask;

  let currentTab = defaultTab;

  function renderContent() {
    mask.innerHTML = `
      <div class="modal auth-modal" role="dialog" style="max-width: 420px; width: 92%;">
        <div class="auth-header">
          <div class="auth-title">🗺 路书数据中心</div>
          <div class="auth-sub">多用户独立数据空间 · 云端与多端同步</div>
          ${canClose ? '<button class="auth-close-btn" data-act="close" title="关闭">&times;</button>' : ''}
        </div>

        <div class="auth-tabs">
          <button type="button" class="auth-tab ${currentTab === 'login' ? 'active' : ''}" data-tab="login">账号登录</button>
          <button type="button" class="auth-tab ${currentTab === 'register' ? 'active' : ''}" data-tab="register">注册新账号</button>
        </div>

        <div class="auth-banner-err" id="authErr" hidden></div>
        ${tip ? `<div class="auth-banner-info">${escapeHtml(tip)}</div>` : ''}

        <form id="authForm" class="auth-form" onsubmit="return false;">
          <div class="auth-field">
            <div class="auth-field-head">
              <label class="auth-label" for="authPhone">手机号码</label>
              <span class="auth-field-badge">11位有效号码</span>
            </div>
            <div class="auth-input-group">
              <span class="auth-input-prefix">📱</span>
              <input id="authPhone" type="tel" name="phone" maxlength="11" placeholder="请输入11位手机号（如 13800000000）" autocomplete="tel" required>
            </div>
          </div>

          <div class="auth-field">
            <div class="auth-field-head">
              <label class="auth-label" for="authPwd">数字密码</label>
              <span class="auth-field-badge">6～8位纯数字</span>
            </div>
            <div class="auth-input-group">
              <span class="auth-input-prefix">🔒</span>
              <input id="authPwd" type="password" name="password" maxlength="8" placeholder="请输入6～8位纯数字密码" autocomplete="current-password" required>
              <button type="button" class="auth-pwd-toggle" data-target="authPwd" title="显示或隐藏密码" tabindex="-1">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </div>

          ${currentTab === 'register' ? `
            <div class="auth-field">
              <div class="auth-field-head">
                <label class="auth-label" for="authRePwd">确认密码</label>
                <span class="auth-field-badge">再次输入一致密码</span>
              </div>
              <div class="auth-input-group">
                <span class="auth-input-prefix">🔒</span>
                <input id="authRePwd" type="password" name="repassword" maxlength="8" placeholder="请再次输入6～8位纯数字密码" autocomplete="new-password" required>
                <button type="button" class="auth-pwd-toggle" data-target="authRePwd" title="显示或隐藏密码" tabindex="-1">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              </div>
            </div>
            <div class="auth-reg-note">
              💡 <strong>数据隔离提示</strong>：每个账号的数据独立保存。新账号注册后，高德地图 Key 与天气 Key 需在「系统设置」中自行填入。
            </div>
          ` : ''}

          <div style="margin-top: 22px;">
            <button type="submit" class="btn primary auth-submit-btn">
              ${currentTab === 'login' ? '登 录' : '立即注册并登录'}
            </button>
          </div>

          <div class="auth-switch-tip">
            ${currentTab === 'login'
              ? '没有账号？<a href="javascript:void(0)" data-switch="register">点击免费注册</a>'
              : '已有账号？<a href="javascript:void(0)" data-switch="login">点击返回登录</a>'
            }
          </div>
        </form>
      </div>
    `;

    // 绑定事件
    const form = mask.querySelector('#authForm');
    const errBox = mask.querySelector('#authErr');
    const submitBtn = mask.querySelector('.auth-submit-btn');

    function showErr(msg) {
      errBox.hidden = false;
      errBox.textContent = msg;
    }
    function hideErr() {
      errBox.hidden = true;
      errBox.textContent = '';
    }

    // 密码可见性切换
    mask.querySelectorAll('.auth-pwd-toggle').forEach(btn => {
      btn.onclick = () => {
        const input = mask.querySelector('#' + btn.dataset.target);
        if (!input) return;
        const isPwd = (input.type === 'password');
        input.type = isPwd ? 'text' : 'password';
        btn.classList.toggle('active', isPwd);
        btn.title = isPwd ? '隐藏密码' : '显示密码';
      };
    });

    // 切换 Tab
    mask.querySelectorAll('[data-tab]').forEach(tabBtn => {
      tabBtn.onclick = () => {
        currentTab = tabBtn.dataset.tab;
        renderContent();
      };
    });

    // 底部文字切换
    mask.querySelectorAll('[data-switch]').forEach(a => {
      a.onclick = () => {
        currentTab = a.dataset.switch;
        renderContent();
      };
    });

    // 关闭弹窗
    if (canClose) {
      mask.querySelector('[data-act="close"]')?.addEventListener('click', () => {
        mask.remove();
        activeModalMask = null;
      });
      mask.addEventListener('click', e => {
        if (e.target === mask) {
          mask.remove();
          activeModalMask = null;
        }
      });
    }

    // 提交逻辑
    form.onsubmit = async e => {
      e.preventDefault();
      hideErr();

      const phone = form.phone.value.trim();
      const password = form.password.value.trim();

      if (!phone) {
        showErr('请输入手机号');
        form.phone.focus();
        return;
      }
      if (!validatePhone(phone)) {
        showErr('请输入有效的11位手机号（如 13800000000）');
        form.phone.focus();
        return;
      }

      if (!password) {
        showErr('请输入密码');
        form.password.focus();
        return;
      }
      if (!validatePassword(password)) {
        showErr('密码格式不符：必须为6～8位纯数字');
        form.password.focus();
        return;
      }

      if (currentTab === 'register') {
        const repassword = form.repassword.value.trim();
        if (password !== repassword) {
          showErr('两次输入的密码不一致，请重新检查');
          form.repassword.focus();
          return;
        }
      }

      submitBtn.disabled = true;
      submitBtn.textContent = currentTab === 'login' ? '登录中…' : '正在注册…';

      try {
        let result;
        if (currentTab === 'login') {
          result = await login({ phone, password });
          toast(`登录成功，欢迎使用路书！`, 'ok');
        } else {
          result = await register({ phone, password });
          toast(`注册成功，已自动登录！`, 'ok');
        }

        renderUserChip();
        mask.remove();
        activeModalMask = null;

        // 统一从 API 恢复该用户的云端数据并应用配置
        const { restoreFromAPI } = await import('./persist.js');
        await restoreFromAPI();

        if (onSuccess) {
          onSuccess(result.user);
        } else {
          const { renderPage } = await import('../main.js');
          await renderPage();
        }

        // 核心流程：注册或登录成功后，再引导填入必要的 Key
        setTimeout(async () => {
          try {
            const { shouldShowGuide, showGuide } = await import('./guide.js');
            if (shouldShowGuide()) {
              showGuide();
            }
          } catch (e) {
            console.warn('检查引导失败:', e);
          }
        }, 120);
      } catch (err) {
        showErr(err.message || '操作失败，请重试');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = currentTab === 'login' ? '登 录' : '立即注册并登录';
      }
    };
  }

  renderContent();
  document.getElementById('modalRoot').appendChild(mask);
  // 自动聚焦手机号输入框
  setTimeout(() => mask.querySelector('input[name="phone"]')?.focus(), 80);
}

/** 渲染顶栏右侧的用户身份组件 */
export function renderUserChip() {
  const container = document.getElementById('userChip');
  if (!container) return;

  const user = getCurrentUser();
  if (user && user.phone) {
    container.innerHTML = `
      <div class="user-chip-wrap">
        <span class="user-chip-badge" title="当前登录账号: ${escapeHtml(user.phone)}">
          <span class="user-icon">📱</span>
          <span class="user-phone">${escapeHtml(maskPhone(user.phone))}</span>
        </span>
        <button class="btn sm ghost user-btn-exit" title="退出登录" data-auth-act="logout">退出</button>
      </div>
    `;
    container.querySelector('[data-auth-act="logout"]').onclick = () => logout();
  } else {
    container.innerHTML = `
      <button class="btn sm primary user-btn-login" data-auth-act="login">
        <span>🔑 登录 / 注册</span>
      </button>
    `;
    container.querySelector('[data-auth-act="login"]').onclick = () => showAuthModal();
  }
}
