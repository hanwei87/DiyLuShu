#!/usr/bin/env python3
"""测试从现有 JSON 文件平滑自动迁移到 SQLite 数据库以及首次注册用户无缝认领历史数据"""

import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
import json

TEST_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(TEST_DIR)
SCRATCH_DIR = os.path.join(TEST_DIR, '_test_migration')
PORT = 8198

def run_migration_test():
    print(">>> 启动数据自动平滑迁移测试...")
    if os.path.exists(SCRATCH_DIR):
        shutil.rmtree(SCRATCH_DIR)
    os.makedirs(SCRATCH_DIR, exist_ok=True)

    db_path = os.path.join(SCRATCH_DIR, 'migrated.db')
    mock_json_dir = os.path.join(SCRATCH_DIR, 'mock_json')
    os.makedirs(mock_json_dir, exist_ok=True)
    os.makedirs(os.path.join(mock_json_dir, '路书'), exist_ok=True)

    # 准备测试用 mock JSON 数据
    with open(os.path.join(mock_json_dir, '信息库.json'), 'w', encoding='utf-8') as f:
        json.dump({'categories': [], 'tags': [], 'items': [{'id': 'm_item', 'name': '测试景点'}]}, f)

    with open(os.path.join(mock_json_dir, '设置.json'), 'w', encoding='utf-8') as f:
        json.dump({'appName': '历史迁移路书', 'amapKey': 'legacy_key_123'}, f)

    with open(os.path.join(mock_json_dir, '路书', 'book_01.json'), 'w', encoding='utf-8') as f:
        json.dump({
            'id': 'book_legacy_001',
            'name': '历史路书第一本',
            'createdAt': 1700000000000,
            'updatedAt': 1700000000000,
            'days': []
        }, f)

    env = os.environ.copy()
    env['PORT'] = str(PORT)
    env['HOST'] = '127.0.0.1'
    env['DATA_DIR'] = SCRATCH_DIR
    env['DB_PATH'] = db_path
    env['JSON_DIR'] = mock_json_dir
    env['SERVER_NO_OPEN'] = '1'

    proc = subprocess.Popen(
        [sys.executable, os.path.join(PROJECT_ROOT, 'server.py')],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=PROJECT_ROOT
    )

    try:
        # 等待就绪
        for _ in range(25):
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/health', timeout=1) as res:
                    if res.status == 200:
                        break
            except Exception:
                time.sleep(0.2)

        # 检查数据库物理迁移
        assert os.path.exists(db_path), "数据库文件未生成"
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()

        books_count = cur.execute('SELECT COUNT(*) FROM books').fetchone()[0]
        lib_count = cur.execute('SELECT COUNT(*) FROM library').fetchone()[0]
        set_count = cur.execute('SELECT COUNT(*) FROM settings').fetchone()[0]
        conn.close()

        print(f"  ✓ 自动迁移历史路书数量: {books_count}")
        print(f"  ✓ 自动迁移历史信息库: {lib_count} 条")
        print(f"  ✓ 自动迁移历史设置: {set_count} 项")

        assert books_count > 0, "路书未正确迁移"
        assert lib_count > 0, "信息库未正确迁移"

        # 首次用户注册，验证自动认领历史数据
        reg_payload = json.dumps({'phone': '13800000001', 'password': '123456'}).encode('utf-8')
        req = urllib.request.Request(f'http://127.0.0.1:{PORT}/api/auth/register', data=reg_payload, headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=2) as res:
            auth_data = json.loads(res.read().decode('utf-8'))
            token = auth_data['token']
            print(f"  ✓ 首个用户注册成功，获得 Token")

        # 检查首个用户获取全局状态，验证历史路书已顺利无缝归属
        req_state = urllib.request.Request(f'http://127.0.0.1:{PORT}/api/state', headers={'Authorization': f'Bearer {token}'})
        with urllib.request.urlopen(req_state, timeout=2) as res:
            state = json.loads(res.read().decode('utf-8'))
            assert len(state['books']) == books_count, "用户状态中路书数与历史数据不符"
            assert state['settings'].get('appName') == '历史迁移路书', "历史设置未正确挂载到首个用户"
            print(f"  ✓ GET /api/state 返回成功，首个用户完整认领 {len(state['books'])} 本历史路书与设置")

        print(">>> 数据自动平滑迁移测试全部通过！\n")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        if os.path.exists(SCRATCH_DIR):
            shutil.rmtree(SCRATCH_DIR)

if __name__ == '__main__':
    sys.exit(run_migration_test())
