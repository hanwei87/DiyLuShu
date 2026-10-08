#!/usr/bin/env python3
"""后端 REST API、用户认证与多租户 SQLite 数据隔离自动化测试套件"""

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

TEST_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(TEST_DIR)
SCRATCH_DIR = os.path.join(TEST_DIR, '_test_data')
TEST_PORT = 8199
BASE_URL = f'http://127.0.0.1:{TEST_PORT}'

def request_with_headers(method, path, body=None, token=None):
    url = f'{BASE_URL}{path}'
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            res_body = res.read().decode('utf-8')
            content_type = res.headers.get('Content-Type', '')
            try:
                parsed = json.loads(res_body) if res_body else None
            except json.JSONDecodeError:
                parsed = res_body
            return res.status, parsed, content_type, res.headers
    except urllib.error.HTTPError as e:
        res_body = e.read().decode('utf-8')
        try:
            parsed = json.loads(res_body)
        except Exception:
            parsed = res_body
        return e.code, parsed, e.headers.get('Content-Type', ''), e.headers

def request(method, path, body=None, token=None):
    st, parsed, ct, _ = request_with_headers(method, path, body=body, token=token)
    return st, parsed, ct

def run_tests():
    print(">>> 启动自动化后端、用户认证与多租户数据隔离测试...")

    # 清理并创建测试数据目录
    if os.path.exists(SCRATCH_DIR):
        shutil.rmtree(SCRATCH_DIR)
    os.makedirs(SCRATCH_DIR, exist_ok=True)
    db_file = os.path.join(SCRATCH_DIR, 'test_lushu.db')

    env = os.environ.copy()
    env['PORT'] = str(TEST_PORT)
    env['HOST'] = '127.0.0.1'
    env['DATA_DIR'] = SCRATCH_DIR
    env['DB_PATH'] = db_file
    env['JSON_DIR'] = os.path.join(SCRATCH_DIR, 'empty_json')
    env['SERVER_NO_OPEN'] = '1'

    # 启动后台测试服务
    proc = subprocess.Popen(
        [sys.executable, os.path.join(PROJECT_ROOT, 'server.py')],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=PROJECT_ROOT
    )

    passed = 0
    failed = 0

    def check(name, condition, extra=''):
        nonlocal passed, failed
        if condition:
            passed += 1
            print(f"  ✓ {name}")
        else:
            failed += 1
            print(f"  ✗ {name}: {extra}")

    try:
        # 1. 等待服务就绪
        ready = False
        for _ in range(25):
            try:
                status, data, _ = request('GET', '/api/health')
                if status == 200 and data.get('status') == 'ok':
                    ready = True
                    break
            except Exception:
                time.sleep(0.2)

        check("服务就绪与健康检查 /api/health", ready)
        if not ready:
            print("服务启动失败，终止测试")
            return 1

        st, loc_data, _ = request('GET', '/api/locate')
        check("免登录网络定位接口 /api/locate 可用", st == 200 and 'ip' in loc_data)

        # 2. 检查静态文件托管与安全加固
        st, data, ctype, headers = request_with_headers('GET', '/index.html')
        check("托管 index.html 状态码 200", st == 200)
        check("index.html 包含 userChip 挂载点", 'id="userChip"' in str(data))
        check("响应头包含 X-Content-Type-Options: nosniff", headers.get('X-Content-Type-Options') == 'nosniff')
        check("响应头包含 X-Frame-Options: SAMEORIGIN", headers.get('X-Frame-Options') == 'SAMEORIGIN')

        # 2.1 敏感资源静态拦截防护（防数据库与源码泄露）
        st, _, _, _ = request_with_headers('GET', '/data/test_lushu.db')
        check("直接通过 HTTP 下载数据库文件被禁止 (403 Forbidden)", st == 403)

        st, _, _, _ = request_with_headers('GET', '/server.py')
        check("直接通过 HTTP 下载 server.py 源码被禁止 (403 Forbidden)", st == 403)

        st, _, _, _ = request_with_headers('GET', '/server.log')
        check("直接通过 HTTP 下载日志文件被禁止 (403 Forbidden)", st == 403)

        st, _, _, _ = request_with_headers('GET', '/Dockerfile')
        check("直接通过 HTTP 下载 Dockerfile 被禁止 (403 Forbidden)", st == 403)

        # 3. 未登录访问受保护接口应返回 401
        st, res, _ = request('GET', '/api/state')
        check("未登录访问 /api/state 返回 401", st == 401 and res.get('needAuth') is True)

        st, res, _ = request('GET', '/api/books')
        check("未登录访问 /api/books 返回 401", st == 401)

        # 4. 手机号与密码格式校验
        # 4.1 非法手机号（非11位或非法开头）
        st, res, _ = request('POST', '/api/auth/register', {'phone': '12345', 'password': '123456'})
        check("非法手机号 '12345' 拒绝注册 (400)", st == 400 and '手机号' in res.get('error', ''))

        st, res, _ = request('POST', '/api/auth/register', {'phone': '23800000000', 'password': '123456'})
        check("非法开头手机号 '23800000000' 拒绝注册 (400)", st == 400)

        # 4.2 非法密码（必须为6~8位纯数字）
        st, res, _ = request('POST', '/api/auth/register', {'phone': '13800138001', 'password': '12345'})
        check("5位密码拒绝注册 (400)", st == 400 and '6～8位纯数字' in res.get('error', ''))

        st, res, _ = request('POST', '/api/auth/register', {'phone': '13800138001', 'password': '123456789'})
        check("9位密码拒绝注册 (400)", st == 400 and '6～8位纯数字' in res.get('error', ''))

        st, res, _ = request('POST', '/api/auth/register', {'phone': '13800138001', 'password': 'abcdef'})
        check("非数字密码拒绝注册 (400)", st == 400 and '6～8位纯数字' in res.get('error', ''))

        # 5. 用户 A 注册与登录
        user_a_phone = '13800138001'
        user_a_pwd = '123456'
        st, reg_a, _ = request('POST', '/api/auth/register', {'phone': user_a_phone, 'password': user_a_pwd})
        check("用户A 注册成功 (201)", st == 201 and reg_a.get('ok') is True)
        token_a = reg_a.get('token')
        check("用户A 获得有效 Token", bool(token_a) and isinstance(token_a, str))
        check("用户A 手机号匹配", reg_a.get('user', {}).get('phone') == user_a_phone)

        # 5.1 重复注册同一手机号
        st, dup_res, _ = request('POST', '/api/auth/register', {'phone': user_a_phone, 'password': user_a_pwd})
        check("重复注册同一手机号返回已存在错误 (400)", st == 400 and '已注册' in dup_res.get('error', ''))

        # 5.2 错误密码登录
        st, err_login, _ = request('POST', '/api/auth/login', {'phone': user_a_phone, 'password': '654321'})
        check("错误密码登录返回 401", st == 401 and '错误' in err_login.get('error', ''))

        # 5.3 正确登录
        st, login_a, _ = request('POST', '/api/auth/login', {'phone': user_a_phone, 'password': user_a_pwd})
        check("正确密码登录成功 (200)", st == 200 and login_a.get('ok') is True)
        token_a = login_a.get('token')

        # 5.4 验证当前身份 /api/auth/me
        st, me_a, _ = request('GET', '/api/auth/me', token=token_a)
        check("GET /api/auth/me 获取当前登录身份", st == 200 and me_a.get('user', {}).get('phone') == user_a_phone)

        # 6. 用户 A 数据读写与设置独立性
        # 6.1 用户 A 初始状态
        st, state_a, _ = request('GET', '/api/state', token=token_a)
        check("用户A 读取初始 state 成功", st == 200 and 'settings' in state_a)

        # 6.2 用户 A 保存个性化设置（包括高德地图 Key 与天气 Key）
        settings_a = {
            'amapKey': 'amap_key_user_a_123',
            'securityCode': 'sec_user_a_456',
            'weatherKey': 'weather_user_a_789',
            'appName': '用户A的定制路书'
        }
        st, res, _ = request('PUT', '/api/settings', settings_a, token=token_a)
        check("用户A 保存独立设置成功", st == 200 and res.get('ok') is True)

        st, saved_set_a, _ = request('GET', '/api/settings', token=token_a)
        check("用户A 读取设置内容一致", saved_set_a.get('amapKey') == 'amap_key_user_a_123')

        # 6.3 用户 A 保存素材库
        lib_a = {
            'categories': [{'id': 'c1', 'name': '景点', 'order': 1}],
            'tags': [{'id': 't1', 'name': '必去'}],
            'items': [{'id': 'item_a_1', 'name': '杭州西湖'}]
        }
        st, res, _ = request('PUT', '/api/library', lib_a, token=token_a)
        check("用户A 保存独立素材库成功", st == 200 and res.get('ok') is True)

        # 6.4 用户 A 创建路书
        book_a = {
            'id': 'book_a_001',
            'name': '用户A的西湖游',
            'createdAt': 1700000000000,
            'updatedAt': 1700000000000,
            'days': [{'id': 'd1', 'stopItemIds': ['item_a_1'], 'stayItemId': None}]
        }
        st, res, _ = request('POST', '/api/books', book_a, token=token_a)
        check("用户A 创建路书成功", st == 201 and res.get('id') == 'book_a_001')

        # 7. 用户 B 注册与多租户数据隔离测试
        user_b_phone = '13900139002'
        user_b_pwd = '888888'
        st, reg_b, _ = request('POST', '/api/auth/register', {'phone': user_b_phone, 'password': user_b_pwd})
        check("用户B 注册成功 (201)", st == 201 and reg_b.get('ok') is True)
        token_b = reg_b.get('token')

        # 7.1 验证 用户 B 的设置完全独立（未填入高德Key，不会读到用户A的高德Key）
        st, settings_b, _ = request('GET', '/api/settings', token=token_b)
        check("用户B 初始高德Key为空（与用户A隔离）", settings_b.get('amapKey') == '')
        check("用户B 初始天气Key为空（与用户A隔离）", settings_b.get('weatherKey') == '')

        # 7.2 验证 用户 B 的素材库完全独立（不会包含用户A的地标）
        st, lib_b, _ = request('GET', '/api/library', token=token_b)
        check("用户B 初始素材库地点列表为空（与用户A隔离）", len(lib_b.get('items', [])) == 0)

        # 7.3 验证 用户 B 的路书列表为空（不会看到用户A的路书）
        st, books_b, _ = request('GET', '/api/books', token=token_b)
        check("用户B 初始路书列表为空（与用户A隔离）", len(books_b) == 0)

        # 7.4 验证 用户 B 无法读取 用户 A 的路书单本
        st, res, _ = request('GET', '/api/books/book_a_001', token=token_b)
        check("用户B 读取用户A的路书返回 404 (隔离防护)", st == 404)

        # 7.5 验证 用户 B 无法篡改 用户 A 的路书
        malicious_update = dict(book_a)
        malicious_update['name'] = '被用户B篡改的名称'
        st, res, _ = request('PUT', '/api/books/book_a_001', malicious_update, token=token_b)
        check("用户B 修改用户A路书被拒绝 (403)", st == 403)

        # 7.6 用户 B 填入自己的高德 Key
        settings_b_new = {
            'amapKey': 'amap_key_user_b_999',
            'securityCode': 'sec_user_b_888',
            'weatherKey': 'weather_user_b_777',
            'appName': '用户B的专属路书'
        }
        request('PUT', '/api/settings', settings_b_new, token=token_b)

        # 再次检查用户 A 的设置未受任何影响
        st, recheck_set_a, _ = request('GET', '/api/settings', token=token_a)
        check("用户B 修改设置不影响用户A设置", recheck_set_a.get('amapKey') == 'amap_key_user_a_123')

        # 7.7 用户 B 创建自己的路书
        book_b = {
            'id': 'book_b_001',
            'name': '用户B的黄山游',
            'createdAt': 1700000010000,
            'updatedAt': 1700000010000,
            'days': []
        }
        st, res, _ = request('POST', '/api/books', book_b, token=token_b)
        check("用户B 创建专属路书", st == 201 and res.get('id') == 'book_b_001')

        # 用户 A 查询列表依然只有自己的路书
        st, user_a_books, _ = request('GET', '/api/books', token=token_a)
        check("用户A 路书列表仅含自己路书 (1本)", len(user_a_books) == 1 and user_a_books[0]['id'] == 'book_a_001')

        # 用户 B 查询列表依然只有自己的路书
        st, user_b_books, _ = request('GET', '/api/books', token=token_b)
        check("用户B 路书列表仅含自己路书 (1本)", len(user_b_books) == 1 and user_b_books[0]['id'] == 'book_b_001')

        # 8. 退出登录接口 /api/auth/logout
        st, res, _ = request('POST', '/api/auth/logout', token=token_a)
        check("用户A 退出登录成功 (200)", st == 200 and res.get('ok') is True)

        # 验证退出后旧 Token 作废
        st, res, _ = request('GET', '/api/auth/me', token=token_a)
        check("退出后旧 Token 访问返回 401", st == 401)

        # 9. 数据库物理落盘验证
        conn = sqlite3.connect(db_file)
        cur = conn.cursor()
        users_cnt = cur.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        check(f"SQLite 物理 users 表有 {users_cnt} 个用户", users_cnt == 2)
        sess_cnt = cur.execute('SELECT COUNT(*) FROM sessions').fetchone()[0]
        check(f"SQLite 物理 sessions 表有 {sess_cnt} 条有效会话", sess_cnt == 1) # 用户A退出了，剩下用户B
        user_books_cnt = cur.execute('SELECT COUNT(*) FROM books WHERE user_id != ""').fetchone()[0]
        check(f"SQLite 物理 books 表包含关联 user_id 的路书 {user_books_cnt} 本", user_books_cnt == 2)
        conn.close()

    finally:
        # 关闭测试进程
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        # 清理测试数据目录
        if os.path.exists(SCRATCH_DIR):
            shutil.rmtree(SCRATCH_DIR)

    print("\n" + "=" * 50)
    print(f"测试完成：共 {passed + failed} 项，通过 {passed} 项，失败 {failed} 项")
    print("=" * 50)
    return 0 if failed == 0 else 1

if __name__ == '__main__':
    sys.exit(run_tests())
