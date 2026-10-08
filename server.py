#!/usr/bin/env python3
"""路书应用服务器：静态文件托管 + REST API + SQLite 数据库。
零外部依赖（Python 3.9+ 内置模块）。
支持本地开发调试、局域网多设备（手机/平板/电脑）同步，以及 Docker / 云端部署。"""

import contextlib
import hashlib
import http.server
import json
import mimetypes
import os
import re
import secrets
import signal
import socket
import socketserver
import sqlite3
import sys
import threading
import time
import webbrowser

# ------------------------------------------------------------------ 路径与配置

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get('DATA_DIR', os.path.join(ROOT, 'data'))
DB_PATH = os.environ.get('DB_PATH', os.path.join(DATA_DIR, 'lushu.db'))
JSON_DIR = os.environ.get('JSON_DIR', os.path.join(ROOT, '路书数据'))

DEFAULT_HOST = os.environ.get('HOST', '0.0.0.0')
DEFAULT_PORT = int(os.environ.get('PORT', '8123'))

# 显式注册常用 MIME 类型，防止在精简 Linux/Alpine 容器中 .js 变成 text/plain
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('application/json', '.json')
mimetypes.add_type('image/svg+xml', '.svg')
mimetypes.add_type('image/x-icon', '.ico')

# ------------------------------------------------------------------ 用户认证规则与工具

PHONE_RE = re.compile(r'^1[3-9]\d{9}$')
PWD_RE = re.compile(r'^\d{6,8}$')
SESSION_EXPIRE_MS = 30 * 24 * 3600 * 1000  # 30天会话有效期

def hash_password(password: str, salt: str = None) -> tuple:
    if not salt:
        salt = secrets.token_hex(16)
    pwd_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000).hex()
    return pwd_hash, salt

def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    pwd_hash, _ = hash_password(password, salt)
    return secrets.compare_digest(pwd_hash, expected_hash)

def validate_phone(phone: str) -> bool:
    return bool(phone and isinstance(phone, str) and PHONE_RE.match(phone.strip()))

def validate_password(password: str) -> bool:
    return bool(password and isinstance(password, str) and PWD_RE.match(password.strip()))

# ------------------------------------------------------------------ 防暴力破解与频控

FAILED_LOGINS = {}      # (ip, phone) -> list of timestamp
REGISTER_LIMITS = {}    # ip -> list of timestamp
RATE_LOCK = threading.Lock()

def check_login_rate_limit(ip: str, phone: str):
    now = time.time()
    key = (ip, phone)
    with RATE_LOCK:
        attempts = [t for t in FAILED_LOGINS.get(key, []) if now - t < 60]
        FAILED_LOGINS[key] = attempts
        if len(attempts) >= 5:
            raise PermissionError('密码尝试失败次数过多，请稍候 1 分钟后再试')

def record_failed_login(ip: str, phone: str):
    now = time.time()
    key = (ip, phone)
    with RATE_LOCK:
        attempts = [t for t in FAILED_LOGINS.get(key, []) if now - t < 60]
        attempts.append(now)
        FAILED_LOGINS[key] = attempts

def clear_failed_login(ip: str, phone: str):
    key = (ip, phone)
    with RATE_LOCK:
        FAILED_LOGINS.pop(key, None)

def check_register_rate_limit(ip: str):
    now = time.time()
    with RATE_LOCK:
        attempts = [t for t in REGISTER_LIMITS.get(ip, []) if now - t < 60]
        REGISTER_LIMITS[ip] = attempts
        if len(attempts) >= 15:
            raise PermissionError('注册过于频繁，请稍候再试')
        attempts.append(now)
        REGISTER_LIMITS[ip] = attempts

# ------------------------------------------------------------------ 静态文件访问安全拦截

FORBIDDEN_EXTENSIONS = ('.db', '.db-wal', '.db-shm', '.sqlite', '.sqlite3', '.py', '.pyc', '.sh', '.command', '.log', '.md', '.yml', '.yaml', '.conf')
FORBIDDEN_PREFIXES = ('/data', '/deploy', '/路书数据', '/Dockerfile', '/docker-compose', '/server.py', '/server.log')

def is_forbidden_static_path(path: str) -> bool:
    clean = path.split('?')[0].split('#')[0]
    if '..' in clean:
        return True
    parts = clean.strip('/').split('/')
    for part in parts:
        if part.startswith('.') and part != '.':
            return True
    for prefix in FORBIDDEN_PREFIXES:
        if clean == prefix or clean.startswith(prefix + '/') or clean.startswith(prefix):
            return True
    clean_lower = clean.lower()
    for ext in FORBIDDEN_EXTENSIONS:
        if clean_lower.endswith(ext):
            return True
    return False

# ------------------------------------------------------------------ SQLite 数据库

@contextlib.contextmanager
def get_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA busy_timeout=5000')
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    """初始化多用户数据库表结构与向前兼容列"""
    with get_db() as d:
        # 1. 用户表
        d.execute('''CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            phone TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            created_at INTEGER
        )''')
        d.execute('''CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users (phone)''')

        # 2. 会话 Token 表
        d.execute('''CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at INTEGER,
            expires_at INTEGER
        )''')
        d.execute('''CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)''')

        # 3. 用户独立设置表（每个用户的设置完全隔离，包括高德Key、天气Key等）
        d.execute('''CREATE TABLE IF NOT EXISTS user_settings (
            user_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (user_id, key)
        )''')

        # 4. 用户独立素材地点库
        d.execute('''CREATE TABLE IF NOT EXISTS user_library (
            user_id TEXT PRIMARY KEY,
            data TEXT NOT NULL
        )''')

        # 5. 旧版单机表（用于兼容和无缝迁移历史已有数据）
        d.execute('''CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )''')
        d.execute('''CREATE TABLE IF NOT EXISTS library (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL
        )''')
        d.execute('''CREATE TABLE IF NOT EXISTS books (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            created_at INTEGER,
            updated_at INTEGER,
            app_name TEXT DEFAULT '',
            user_id TEXT DEFAULT ''
        )''')
        d.execute('''CREATE INDEX IF NOT EXISTS idx_books_updated_at
            ON books (updated_at DESC)''')

        # 检查 books 表向前兼容列（添加 user_id）
        cols = {r['name'] for r in d.execute('PRAGMA table_info(books)').fetchall()}
        for col in ['app_name', 'user_id']:
            if col not in cols:
                try:
                    d.execute(f"ALTER TABLE books ADD COLUMN {col} TEXT DEFAULT ''")
                except sqlite3.OperationalError:
                    pass
        d.execute('''CREATE INDEX IF NOT EXISTS idx_books_user_updated
            ON books (user_id, updated_at DESC)''')
        d.commit()

        # 消除同名路书自愈机制
        deduplicate_existing_books(d)

        # 首次运行：如果 SQLite 为空且存在旧版 JSON 文件，自动无缝迁移导入单机库
        row_books = d.execute('SELECT COUNT(*) FROM books').fetchone()[0]
        row_lib = d.execute('SELECT COUNT(*) FROM library').fetchone()[0]
        if row_books == 0 and row_lib == 0:
            import_json_data(d)

def deduplicate_existing_books(d):
    """自愈机制：检测并消除同一用户下的同名路书，主路书保留原名，副本追加区分后缀"""
    try:
        user_rows = d.execute("SELECT DISTINCT user_id FROM books").fetchall()
        for u in user_rows:
            uid = u['user_id']
            rows = d.execute("SELECT id, data, updated_at FROM books WHERE user_id = ?", (uid,)).fetchall()
            groups = {}
            for r in rows:
                try:
                    bdata = json.loads(r['data'])
                except Exception:
                    continue
                name = (bdata.get('name') or '').strip()
                groups.setdefault(name, []).append((r['id'], bdata, r['updated_at'] or 0))

            for name, items in groups.items():
                if len(items) <= 1:
                    continue
                def score(item):
                    bid, bdata, updated_at = item
                    days = bdata.get('days') or []
                    stops = sum(len(day.get('stopItemIds') or []) + (1 if day.get('stayItemId') else 0) for day in days)
                    return (stops, updated_at)

                items.sort(key=score, reverse=True)
                for idx, (bid, bdata, updated_at) in enumerate(items[1:], 1):
                    days = bdata.get('days') or []
                    stops = sum(len(day.get('stopItemIds') or []) + (1 if day.get('stayItemId') else 0) for day in days)
                    suffix = "未排行程" if stops == 0 else ("副本" if idx == 1 else f"副本 {idx}")
                    new_name = f"{name} ({suffix})"
                    bdata['name'] = new_name
                    d.execute("UPDATE books SET data = ? WHERE id = ?",
                              (json.dumps(bdata, ensure_ascii=False), bid))
                    print(f"[自愈] 自动消除同名路书: {bid} 重命名为 《{new_name}》")
        d.commit()
    except Exception as e:
        print(f"[警告] 同名路书自愈检测失败: {e}")

def import_json_data(d):
    """从已有的 路书数据/ 目录导入历史 JSON 数据到 SQLite"""
    now = int(time.time() * 1000)
    imported = False

    # 1. 信息库
    lib_path = os.path.join(JSON_DIR, '信息库.json')
    if os.path.exists(lib_path):
        try:
            with open(lib_path, encoding='utf-8') as f:
                data = json.load(f)
            d.execute('INSERT OR REPLACE INTO library (id, data) VALUES (1, ?)',
                      (json.dumps(data, ensure_ascii=False),))
            imported = True
        except Exception as e:
            print(f'[警告] 导入信息库失败: {e}')

    # 2. 设置
    set_path = os.path.join(JSON_DIR, '设置.json')
    if os.path.exists(set_path):
        try:
            with open(set_path, encoding='utf-8') as f:
                data = json.load(f)
            for k, v in data.items():
                d.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
                          (k, json.dumps(v, ensure_ascii=False)))
            imported = True
        except Exception as e:
            print(f'[警告] 导入设置失败: {e}')

    # 3. 路书
    book_dir = os.path.join(JSON_DIR, '路书')
    if os.path.isdir(book_dir):
        for fname in sorted(os.listdir(book_dir)):
            if not fname.endswith('.json'):
                continue
            try:
                with open(os.path.join(book_dir, fname), encoding='utf-8') as f:
                    bdata = json.load(f)
                bid = bdata.get('id')
                bname = bdata.get('name')
                if not bid or not bname:
                    continue
                created_at = bdata.get('createdAt') or now
                updated_at = bdata.get('updatedAt') or now
                d.execute('''INSERT OR IGNORE INTO books (id, data, created_at, updated_at)
                             VALUES (?, ?, ?, ?)''',
                          (bid, json.dumps(bdata, ensure_ascii=False), created_at, updated_at))
                imported = True
            except Exception as e:
                print(f'[警告] 导入路书 {fname} 失败: {e}')

    d.commit()
    if imported:
        print('[数据迁移] 已自动从 路书数据/ 导入历史数据至 SQLite 数据库')

# ------------------------------------------------------------------ 用户与认证数据操作

def register_user(phone: str, password: str):
    phone = (phone or '').strip()
    password = (password or '').strip()
    if not validate_phone(phone):
        raise ValueError('请输入有效的11位手机号')
    if not validate_password(password):
        raise ValueError('密码必须为6～8位纯数字')

    with get_db() as d:
        existing = d.execute('SELECT id FROM users WHERE phone = ?', (phone,)).fetchone()
        if existing:
            raise ValueError('该手机号已注册，请直接登录')

        is_first_user = (d.execute('SELECT COUNT(*) FROM users').fetchone()[0] == 0)
        user_id = 'u_' + secrets.token_hex(8)
        pwd_hash, salt = hash_password(password)
        now = int(time.time() * 1000)

        d.execute(
            'INSERT INTO users (id, phone, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)',
            (user_id, phone, pwd_hash, salt, now)
        )

        if is_first_user:
            # 首次注册：将此前单机调试沉淀的无归属历史路书、旧素材库和旧设置无缝挂载到首个用户名下
            d.execute("UPDATE books SET user_id = ? WHERE user_id = '' OR user_id IS NULL", (user_id,))
            for row in d.execute('SELECT key, value FROM settings'):
                d.execute('INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)',
                          (user_id, row['key'], row['value']))
            old_lib = d.execute('SELECT data FROM library WHERE id = 1').fetchone()
            if old_lib:
                d.execute('INSERT OR IGNORE INTO user_library (user_id, data) VALUES (?, ?)',
                          (user_id, old_lib['data']))
        else:
            # 后续注册：为新用户初始化干净独立的模版结构（各用户数据独立，设置需自行配置）
            default_library = {
                'categories': [
                    {'id': 'c_food', 'name': '美食', 'order': 1},
                    {'id': 'c_hotel', 'name': '酒店', 'order': 2},
                    {'id': 'c_play', 'name': '游玩', 'order': 3},
                ],
                'tags': [],
                'items': [],
            }
            d.execute('INSERT INTO user_library (user_id, data) VALUES (?, ?)',
                      (user_id, json.dumps(default_library, ensure_ascii=False)))
            default_settings = {
                'amapKey': '',
                'securityCode': '',
                'weatherKey': '',
                'appName': '',
                'guideDismissed': False,
            }
            for k, v in default_settings.items():
                d.execute('INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)',
                          (user_id, k, json.dumps(v, ensure_ascii=False)))

        # 生成会话 Token
        token = secrets.token_urlsafe(32)
        expires_at = now + SESSION_EXPIRE_MS
        d.execute('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
                  (token, user_id, now, expires_at))
        d.commit()

    return {'user': {'id': user_id, 'phone': phone}, 'token': token}

def login_user(phone: str, password: str):
    phone = (phone or '').strip()
    password = (password or '').strip()
    if not validate_phone(phone):
        raise ValueError('请输入有效的11位手机号')
    if not validate_password(password):
        raise ValueError('密码必须为6～8位纯数字')

    with get_db() as d:
        user = d.execute('SELECT id, phone, password_hash, salt FROM users WHERE phone = ?', (phone,)).fetchone()
        if not user or not verify_password(password, user['salt'], user['password_hash']):
            raise ValueError('手机号或密码错误')

        now = int(time.time() * 1000)
        token = secrets.token_urlsafe(32)
        expires_at = now + SESSION_EXPIRE_MS
        d.execute('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
                  (token, user['id'], now, expires_at))
        d.commit()

    return {'user': {'id': user['id'], 'phone': user['phone']}, 'token': token}

def logout_user(token: str):
    if not token:
        return
    with get_db() as d:
        row = d.execute('SELECT user_id FROM sessions WHERE token = ?', (token,)).fetchone()
        if row:
            d.execute('DELETE FROM sessions WHERE user_id = ?', (row['user_id'],))
        else:
            d.execute('DELETE FROM sessions WHERE token = ?', (token,))
        d.commit()

def get_user_by_token(token: str):
    if not token:
        return None
    now = int(time.time() * 1000)
    with get_db() as d:
        # 自动修剪过期失效的会话
        d.execute('DELETE FROM sessions WHERE expires_at <= ?', (now,))
        row = d.execute('''
            SELECT u.id, u.phone
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ? AND s.expires_at > ?
        ''', (token, now)).fetchone()
        if row:
            return {'id': row['id'], 'phone': row['phone']}
    return None

# ------------------------------------------------------------------ 多租户用户数据操作

def read_user_settings(user_id: str):
    with get_db() as d:
        settings = {}
        for row in d.execute('SELECT key, value FROM user_settings WHERE user_id = ?', (user_id,)):
            try:
                settings[row['key']] = json.loads(row['value'])
            except (json.JSONDecodeError, TypeError):
                settings[row['key']] = row['value']
        defaults = {'amapKey': '', 'securityCode': '', 'weatherKey': '', 'appName': '', 'guideDismissed': False}
        for k, v in defaults.items():
            if k not in settings:
                settings[k] = v
        return settings

def save_user_settings(user_id: str, settings: dict):
    if not isinstance(settings, dict):
        return
    with get_db() as d:
        for k, v in settings.items():
            d.execute('''
                INSERT INTO user_settings (user_id, key, value)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
            ''', (user_id, k, json.dumps(v, ensure_ascii=False)))
        d.commit()

def read_user_library(user_id: str):
    with get_db() as d:
        lib_row = d.execute('SELECT data FROM user_library WHERE user_id = ?', (user_id,)).fetchone()
        if lib_row:
            try:
                return json.loads(lib_row['data'])
            except json.JSONDecodeError:
                pass
        return {
            'categories': [
                {'id': 'c_food', 'name': '美食', 'order': 1},
                {'id': 'c_hotel', 'name': '酒店', 'order': 2},
                {'id': 'c_play', 'name': '游玩', 'order': 3},
            ],
            'tags': [],
            'items': []
        }

def save_user_library(user_id: str, library: dict):
    if not isinstance(library, dict):
        return
    with get_db() as d:
        d.execute('''
            INSERT INTO user_library (user_id, data)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET data = excluded.data
        ''', (user_id, json.dumps(library, ensure_ascii=False)))
        d.commit()

def list_user_books(user_id: str):
    with get_db() as d:
        books = []
        for row in d.execute('SELECT id, data FROM books WHERE user_id = ? ORDER BY updated_at DESC', (user_id,)):
            try:
                books.append(json.loads(row['data']))
            except json.JSONDecodeError:
                pass
        return books

def get_user_book(user_id: str, bid: str):
    with get_db() as d:
        row = d.execute('SELECT data FROM books WHERE id = ? AND user_id = ?', (bid, user_id)).fetchone()
        if row:
            try:
                return json.loads(row['data'])
            except json.JSONDecodeError:
                pass
        return None

def save_user_book(user_id: str, book: dict, is_import: bool = False):
    if not isinstance(book, dict) or not book.get('id'):
        raise ValueError('无效的路书数据（缺少 id）')
    bid = book['id']
    now = int(time.time() * 1000)
    created_at = book.get('createdAt') or now
    updated_at = book.get('updatedAt') or now
    app_name = book.get('appName', '')

    with get_db() as d:
        existing = d.execute('SELECT user_id FROM books WHERE id = ?', (bid,)).fetchone()
        if existing and existing['user_id'] and existing['user_id'] != user_id:
            if is_import:
                # 导入他人备份或模板时避免ID碰撞：为当前用户重新分配独立ID
                bid = 'b_' + secrets.token_hex(8)
                book['id'] = bid
            else:
                raise PermissionError('无权修改其他用户的路书')

        data_str = json.dumps(book, ensure_ascii=False)
        d.execute('''
            INSERT INTO books (id, data, created_at, updated_at, app_name, user_id)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at,
                app_name = excluded.app_name,
                user_id = excluded.user_id
        ''', (bid, data_str, created_at, updated_at, app_name, user_id))
        d.commit()

def delete_user_book(user_id: str, bid: str):
    with get_db() as d:
        d.execute('DELETE FROM books WHERE id = ? AND user_id = ?', (bid, user_id))
        d.commit()

def read_user_state(user_id: str):
    return {
        'settings': read_user_settings(user_id),
        'library': read_user_library(user_id),
        'books': list_user_books(user_id),
    }

def import_user_state(user_id: str, data: dict):
    if not isinstance(data, dict):
        raise ValueError('导入数据格式错误')
    if 'settings' in data and isinstance(data['settings'], dict):
        save_user_settings(user_id, data['settings'])
    if 'library' in data and isinstance(data['library'], dict):
        save_user_library(user_id, data['library'])
    if 'books' in data and isinstance(data['books'], list):
        for b in data['books']:
            if isinstance(b, dict) and b.get('id'):
                save_user_book(user_id, b, is_import=True)

# 兼容单机函数（供不带多租户的旧脚本或单机测试引用）
def read_settings():
    with get_db() as d:
        settings = {}
        for row in d.execute('SELECT key, value FROM settings'):
            try: settings[row['key']] = json.loads(row['value'])
            except Exception: settings[row['key']] = row['value']
        return settings

def save_settings(settings):
    if not isinstance(settings, dict): return
    with get_db() as d:
        d.execute('DELETE FROM settings')
        for k, v in settings.items():
            d.execute('INSERT INTO settings (key, value) VALUES (?, ?)', (k, json.dumps(v, ensure_ascii=False)))
        d.commit()

def read_library():
    with get_db() as d:
        row = d.execute('SELECT data FROM library WHERE id = 1').fetchone()
        if row:
            try: return json.loads(row['data'])
            except Exception: pass
        return {'categories': [], 'tags': [], 'items': []}

def save_library(library):
    if not isinstance(library, dict): return
    with get_db() as d:
        d.execute('INSERT OR REPLACE INTO library (id, data) VALUES (1, ?)', (json.dumps(library, ensure_ascii=False),))
        d.commit()

def list_books():
    with get_db() as d:
        books = []
        for row in d.execute('SELECT data FROM books ORDER BY updated_at DESC'):
            try: books.append(json.loads(row['data']))
            except Exception: pass
        return books

def get_book(bid):
    with get_db() as d:
        row = d.execute('SELECT data FROM books WHERE id = ?', (bid,)).fetchone()
        if row:
            try: return json.loads(row['data'])
            except Exception: pass
        return None

def save_book(book):
    if not isinstance(book, dict) or not book.get('id'): return
    with get_db() as d:
        d.execute('INSERT OR REPLACE INTO books (id, data, updated_at) VALUES (?, ?, ?)',
                  (book['id'], json.dumps(book, ensure_ascii=False), int(time.time() * 1000)))
        d.commit()

def delete_book(bid):
    with get_db() as d:
        d.execute('DELETE FROM books WHERE id = ?', (bid,))
        d.commit()

def read_state():
    return {'settings': read_settings(), 'library': read_library(), 'books': list_books()}

# ------------------------------------------------------------------ HTTP Handler

class LushuHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kw):
        super().__init__(*args, directory=ROOT, **kw)

    def end_headers(self):
        # 禁用强缓存，确保前端实时获取最新接口与脚本
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        # 安全加固响应头（防 MIME 混淆、防点击劫持、防跨站脚本）
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('X-XSS-Protection', '1; mode=block')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        # 跨域支持（供不同端口或反代访问）
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
        super().end_headers()

    def log_message(self, fmt, *args):
        # 保持控制台整洁，忽略静态文件的访问日志
        try:
            msg = fmt % args
            if ('GET /' in msg or 'HEAD /' in msg) and '/api/' not in msg and 'code 4' not in msg and 'code 5' not in msg:
                return
            sys.stderr.write(f"[{self.log_date_time_string()}] {msg}\n")
        except Exception:
            pass

    def _client_ip(self):
        forwarded = self.headers.get('X-Forwarded-For')
        if forwarded:
            return forwarded.split(',')[0].strip()
        return self.client_address[0] if self.client_address else '127.0.0.1'

    def _get_ip_location(self, ip: str) -> dict:
        is_private = not ip or ip.startswith((
            '127.', '10.', '192.168.',
            '172.16.', '172.17.', '172.18.', '172.19.',
            '172.20.', '172.21.', '172.22.', '172.23.',
            '172.24.', '172.25.', '172.26.', '172.27.',
            '172.28.', '172.29.', '172.30.', '172.31.',
            '::1', 'fe80:'
        ))
        target_ip = '' if is_private else ip

        # 1. 尝试从数据库读取已配置的 Web 服务 Key (如 weatherKey)
        key = None
        try:
            with get_db() as conn:
                row = conn.execute("SELECT value FROM settings WHERE key='weatherKey'").fetchone()
                if row and row[0]:
                    key = row[0].strip()
        except Exception:
            pass

        # 2. 若有高德 Web 服务 Key，调用高德官方 IP 定位接口
        if key:
            try:
                import urllib.request
                url = f"https://restapi.amap.com/v3/ip?key={key}"
                if target_ip:
                    url += f"&ip={target_ip}"
                req = urllib.request.Request(url, headers={'User-Agent': 'LuShu/1.0'})
                with urllib.request.urlopen(req, timeout=3) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    if data.get('status') == '1' and data.get('city') and isinstance(data.get('city'), str):
                        city = data.get('city')
                        province = data.get('province')
                        rect = data.get('rectangle')
                        center = None
                        if rect and isinstance(rect, str) and ';' in rect:
                            parts = [p.split(',') for p in rect.split(';')]
                            if len(parts) == 2:
                                p1, p2 = parts[0], parts[1]
                                center = [
                                    round((float(p1[0]) + float(p2[0])) / 2, 6),
                                    round((float(p1[1]) + float(p2[1])) / 2, 6)
                                ]
                        return {
                            'ok': True, 'ip': ip, 'city': city, 'province': province,
                            'center': center, 'source': 'amap'
                        }
            except Exception:
                pass

        # 3. 备用公网 IP 接口（免 Key）
        try:
            import urllib.request
            q_url = "https://whois.pconline.com.cn/ipJson.jsp?json=true"
            if target_ip:
                q_url += f"&ip={target_ip}"
            req = urllib.request.Request(q_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=3) as resp:
                raw = resp.read()
                try:
                    text = raw.decode('gbk')
                except Exception:
                    text = raw.decode('utf-8', errors='ignore')
                data = json.loads(text.strip())
                city = (data.get('city') or '').strip()
                pro = (data.get('pro') or '').strip()
                if city or pro:
                    return {
                        'ok': True, 'ip': ip, 'city': city or pro, 'province': pro,
                        'center': None, 'source': 'pconline'
                    }
        except Exception:
            pass

        return {'ok': False, 'ip': ip}

    def _json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length > 0:
            raw = self.rfile.read(length).decode('utf-8')
            return json.loads(raw)
        return None

    def _extract_token(self):
        auth = self.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            return auth[7:].strip()
        return None

    def _get_current_user(self):
        token = self._extract_token()
        if token:
            return get_user_by_token(token)
        return None

    def _require_user(self):
        user = self._get_current_user()
        if not user:
            self._json_response({'error': '未登录或登录已失效，请重新登录', 'needAuth': True}, 401)
            return None
        return user

    def _handle_api(self, method):
        path = self.path.split('?')[0]
        try:
            # 1. 健康检查与网络定位
            if method == 'GET' and (path == '/api/health' or path == '/health'):
                self._json_response({'status': 'ok', 'db': 'ok', 'version': '2.1.0'})
                return

            if method == 'GET' and path == '/api/locate':
                ip = self._client_ip()
                self._json_response(self._get_ip_location(ip))
                return

            # 2. 用户注册与登录公开接口（带频控防刷与防暴力破解）
            if path == '/api/auth/register' and method == 'POST':
                body = self._read_body() or {}
                ip = self._client_ip()
                check_register_rate_limit(ip)
                res = register_user(body.get('phone', ''), body.get('password', ''))
                self._json_response({'ok': True, 'token': res['token'], 'user': res['user']}, 201)
                return

            if path == '/api/auth/login' and method == 'POST':
                body = self._read_body() or {}
                phone = (body.get('phone', '')).strip()
                ip = self._client_ip()
                check_login_rate_limit(ip, phone)
                try:
                    res = login_user(phone, body.get('password', ''))
                    clear_failed_login(ip, phone)
                    self._json_response({'ok': True, 'token': res['token'], 'user': res['user']}, 200)
                except ValueError as e:
                    record_failed_login(ip, phone)
                    self._json_response({'error': str(e)}, 401)
                return

            if path == '/api/auth/logout' and method == 'POST':
                token = self._extract_token()
                logout_user(token)
                self._json_response({'ok': True})
                return

            if path == '/api/auth/me' and method == 'GET':
                user = self._require_user()
                if not user:
                    return
                self._json_response({'ok': True, 'user': user})
                return

            # 3. 需登录鉴权的多租户独立数据接口
            user = self._require_user()
            if not user:
                return
            uid = user['id']

            # 3.1 用户全局状态 (Hydrate)
            if method == 'GET' and (path == '/api/state' or path == '/api/export'):
                self._json_response(read_user_state(uid))
                return

            # 3.2 用户独立设置
            if path == '/api/settings':
                if method == 'GET':
                    self._json_response(read_user_settings(uid))
                elif method == 'PUT':
                    save_user_settings(uid, self._read_body())
                    self._json_response({'ok': True})
                else:
                    self._json_response({'error': 'Method Not Allowed'}, 405)
                return

            # 3.3 用户独立素材地点库
            if path == '/api/library':
                if method == 'GET':
                    self._json_response(read_user_library(uid))
                elif method == 'PUT':
                    save_user_library(uid, self._read_body())
                    self._json_response({'ok': True})
                else:
                    self._json_response({'error': 'Method Not Allowed'}, 405)
                return

            # 3.4 用户路书列表与创建
            if path == '/api/books':
                if method == 'GET':
                    self._json_response(list_user_books(uid))
                elif method == 'POST':
                    book = self._read_body()
                    save_user_book(uid, book)
                    self._json_response(book, 201)
                else:
                    self._json_response({'error': 'Method Not Allowed'}, 405)
                return

            # 3.5 单本路书操作 (/api/books/<id>)
            if path.startswith('/api/books/'):
                bid = path[len('/api/books/'):].strip()
                if not bid or not re.match(r'^[a-zA-Z0-9_-]{1,64}$', bid):
                    self._json_response({'error': '缺少或无效的路书ID'}, 400)
                    return
                if method == 'GET':
                    book = get_user_book(uid, bid)
                    if book:
                        self._json_response(book)
                    else:
                        self._json_response({'error': '路书不存在'}, 404)
                elif method == 'PUT':
                    book = self._read_body()
                    if isinstance(book, dict):
                        book['id'] = bid
                    save_user_book(uid, book)
                    self._json_response({'ok': True})
                elif method == 'DELETE':
                    delete_user_book(uid, bid)
                    self._json_response({'ok': True})
                else:
                    self._json_response({'error': 'Method Not Allowed'}, 405)
                return

            # 3.6 用户全量数据导入
            if path == '/api/import' and method == 'POST':
                import_user_state(uid, self._read_body())
                self._json_response({'ok': True})
                return

            self._json_response({'error': f'未知接口: {path}'}, 404)

        except PermissionError as e:
            self._json_response({'error': str(e)}, 403)
        except ValueError as e:
            self._json_response({'error': str(e)}, 400)
        except json.JSONDecodeError as e:
            self._json_response({'error': f'JSON解析错误: {str(e)}'}, 400)
        except Exception as e:
            self._json_response({'error': f'服务端错误: {str(e)}'}, 500)

    def do_GET(self):
        clean_path = self.path.split('?')[0]
        if clean_path.startswith('/api/') or clean_path == '/health':
            self._handle_api('GET')
            return

        # 敏感文件/数据库文件访问拦截，返回 403 Forbidden
        if is_forbidden_static_path(clean_path):
            self.send_error(403, 'Forbidden', '敏感资源访问被拒绝')
            return

        if clean_path == '/' or clean_path == '':
            self.path = '/index.html'
        super().do_GET()

    def do_HEAD(self):
        clean_path = self.path.split('?')[0]
        if is_forbidden_static_path(clean_path):
            self.send_error(403, 'Forbidden', '敏感资源访问被拒绝')
            return
        super().do_HEAD()

    def do_POST(self):
        if self.path.startswith('/api/'):
            self._handle_api('POST')
        else:
            self.send_error(405)

    def do_PUT(self):
        if self.path.startswith('/api/'):
            self._handle_api('PUT')
        else:
            self.send_error(405)

    def do_DELETE(self):
        if self.path.startswith('/api/'):
            self._handle_api('DELETE')
        else:
            self.send_error(405)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

# ------------------------------------------------------------------ 辅助函数

def get_local_ip():
    """获取本机局域网 IP（用于展示手机/多设备访问地址）"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        # 连接公网公共DNS不需要真正发包，仅用于让内核决定使用的本地网卡IP
        s.connect(('223.5.5.5', 53))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

# ------------------------------------------------------------------ 服务启动

def run_server():
    init_db()

    host = DEFAULT_HOST
    port = DEFAULT_PORT

    # 如果默认端口被占用且未指定固定PORT，自动递增寻找可用端口
    auto_find_port = ('PORT' not in os.environ)
    httpd = None

    while True:
        try:
            socketserver.ThreadingTCPServer.allow_reuse_address = True
            socketserver.ThreadingTCPServer.daemon_threads = True
            httpd = socketserver.ThreadingTCPServer((host, port), LushuHandler)
            break
        except OSError as e:
            if auto_find_port and port < DEFAULT_PORT + 20:
                port += 1
            else:
                print(f'[错误] 端口 {port} 绑定失败: {e}')
                sys.exit(1)

    local_url = f'http://localhost:{port}/'
    lan_ip = get_local_ip()
    lan_url = f'http://{lan_ip}:{port}/'

    print('=' * 60)
    print(f'🗺  路书应用服务器已就绪 (前端 + REST API + SQLite)')
    print(f'   • 本地访问地址: {local_url}')
    if lan_ip != '127.0.0.1':
        print(f'   • 局域网/手机端: {lan_url}')
    print(f'   • 数据库文件:   {DB_PATH}')
    print(f'   • 健康检查:     {local_url}api/health')
    print('=' * 60)
    print('按 Ctrl+C 停止服务')
    sys.stdout.flush()

    # 桌面模式下自动打开浏览器（容器或后台服务设置 SERVER_NO_OPEN=1 时不弹窗）
    if not os.environ.get('SERVER_NO_OPEN') and not os.environ.get('DOCKER'):
        threading.Timer(0.8, lambda: webbrowser.open(local_url)).start()

    # 优雅退出信号处理
    def handle_signal(sig, frame):
        print('\n正在停止路书服务...')
        threading.Thread(target=httpd.shutdown).start()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        print('路书服务已安全退出。')

if __name__ == '__main__':
    run_server()
