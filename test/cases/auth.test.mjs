import { describe, it, assert } from '../harness.mjs';
import {
  validatePhone, validatePassword, maskPhone,
  getToken, setToken, getCurrentUser, setCurrentUser, isLoggedIn,
  renderUserChip
} from '../../js/core/auth.js';

describe('用户认证与权限工具 (auth.js)', () => {
  it('validatePhone：严格检验11位手机号', () => {
    assert.ok(validatePhone('13800138000'));
    assert.ok(validatePhone('15912345678'));
    assert.ok(validatePhone('18688889999'));
    assert.ok(validatePhone('19900001111'));

    // 非法号码
    assert.notOk(validatePhone('12345'));
    assert.notOk(validatePhone('1380013800')); // 10位
    assert.notOk(validatePhone('138001380000')); // 12位
    assert.notOk(validatePhone('23800138000')); // 非1开头
    assert.notOk(validatePhone('12800138000')); // 12开头非有效段
    assert.notOk(validatePhone('abcdefghijk'));
    assert.notOk(validatePhone(''));
    assert.notOk(validatePhone(null));
  });

  it('validatePassword：必须为6～8位纯数字', () => {
    assert.ok(validatePassword('123456'));
    assert.ok(validatePassword('000000'));
    assert.ok(validatePassword('1234567'));
    assert.ok(validatePassword('12345678'));

    // 非法密码
    assert.notOk(validatePassword('12345')); // 5位
    assert.notOk(validatePassword('123456789')); // 9位
    assert.notOk(validatePassword('abcdef')); // 字母
    assert.notOk(validatePassword('12345a')); // 包含字母
    assert.notOk(validatePassword(''));
    assert.notOk(validatePassword(null));
  });

  it('maskPhone：正确对中间4位脱敏', () => {
    assert.eq(maskPhone('13800138000'), '138****8000');
    assert.eq(maskPhone('15912345678'), '159****5678');
    assert.eq(maskPhone('123'), '123'); // 异常短号兜底
  });

  it('setToken & getToken & isLoggedIn', () => {
    setToken(null);
    setCurrentUser(null);
    assert.eq(getToken(), null);
    assert.notOk(isLoggedIn());

    setToken('test_token_123');
    setCurrentUser({ id: 'u_1', phone: '13800138000' });
    assert.eq(getToken(), 'test_token_123');
    assert.ok(isLoggedIn());
    assert.eq(getCurrentUser()?.phone, '13800138000');

    setToken(null);
    setCurrentUser(null);
    assert.notOk(isLoggedIn());
  });

  it('renderUserChip：未登录时渲染登录/注册按钮，已登录时渲染手机号', () => {
    const chipContainer = document.createElement('div');
    chipContainer.id = 'userChip';
    document.body.appendChild(chipContainer);

    setToken(null);
    setCurrentUser(null);
    renderUserChip();
    assert.has(chipContainer, '.user-btn-login');

    setToken('token_abc');
    setCurrentUser({ id: 'u_1', phone: '13800138000' });
    renderUserChip();
    assert.has(chipContainer, '.user-phone');
    assert.includes(chipContainer.textContent, '138****8000');
    assert.has(chipContainer, '[data-auth-act="logout"]');

    chipContainer.remove();
    setToken(null);
    setCurrentUser(null);
  });
});
