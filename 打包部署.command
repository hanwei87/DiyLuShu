#!/bin/bash
# ==============================================================================
# 双击生成云端部署包 deploy-dist/ 与 路书-云端部署包.zip
# 包含完整的 前端 + 后端 (Python) + SQLite 架构与 Docker 配置文件
# ==============================================================================

cd "$(dirname "$0")" || exit 1

DIST_DIR="deploy-dist"
ZIP_NAME="路书-云端部署包.zip"

echo "正在清理并打包部署资源..."
rm -rf "$DIST_DIR" "$ZIP_NAME"
mkdir -p "$DIST_DIR"

# 1. 复制核心程序
cp index.html "$DIST_DIR/"
cp favicon.ico "$DIST_DIR/" 2>/dev/null || true
cp favicon*.png "$DIST_DIR/" 2>/dev/null || true
cp apple-touch-icon.png "$DIST_DIR/" 2>/dev/null || true
cp android-chrome*.png "$DIST_DIR/" 2>/dev/null || true
cp favicon.svg "$DIST_DIR/" 2>/dev/null || true
cp server.py "$DIST_DIR/"
cp Dockerfile "$DIST_DIR/"
cp docker-compose.yml "$DIST_DIR/"
cp -R css "$DIST_DIR/"
cp -R js "$DIST_DIR/"
cp -R vendor "$DIST_DIR/"
mkdir -p "$DIST_DIR/deploy"
cp deploy/nginx.conf "$DIST_DIR/deploy/" 2>/dev/null || true

# 2. 清理临时缓存
find "$DIST_DIR" -name ".DS_Store" -delete 2>/dev/null || true
find "$DIST_DIR" -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$DIST_DIR" -name "*.pyc" -delete 2>/dev/null || true

# 3. 创建部署说明
cat << 'EOF' > "$DIST_DIR/README.md"
# 路书 (LuShu) - 云端部署说明

本项目采用：**现代纯前端 + Python 3.9+ 轻量后端 + SQLite 数据库** 架构。

## 方案一：Docker 一键部署（最推荐）

1. 将本部署包解压后上传到云服务器任意目录（如 `/root/lushu` 或 `/opt/lushu`）
2. 确保服务器已安装 Docker 和 Docker Compose
3. 在该目录下执行：
   ```bash
   docker compose up -d --build
   ```
4. 部署成功后，在浏览器访问：
   `http://你的服务器IP:8123/`
   （数据将持久保存在服务器当前目录的 `data/lushu.db` 中）

## 方案二：宝塔面板 / 1Panel 部署

- **1Panel / 飞牛NAS / 群晖**：进入「容器」或「Docker Compose」，创建新编排，把 `docker-compose.yml` 内容粘贴进去，点击「启动」即可。
- **宝塔面板**：进入「Docker」应用商店或直接「Python 项目管理器」，指定启动文件为 `server.py`，端口设置为 `8123`。

## 方案三：Linux 纯 Python 后台常驻

如果服务器不想用 Docker，直接使用系统内置 Python 3 即可（零第三方依赖）：
```bash
nohup python3 server.py > server.log 2>&1 &
```

## 绑定域名与 HTTPS
参考 `deploy/nginx.conf` 配置 Nginx 反向代理将 80/443 转发到 `127.0.0.1:8123`。
EOF

# 4. 生成压缩包
if command -v zip >/dev/null 2>&1; then
  zip -r "$ZIP_NAME" "$DIST_DIR" >/dev/null
  echo "✓ 已生成一键压缩包: $ZIP_NAME"
fi

echo "✓ 已生成部署目录: $DIST_DIR/"
echo "--------------------------------------------------------"
echo "部署包内容列表："
find "$DIST_DIR" -maxdepth 2 | sort
echo "--------------------------------------------------------"
echo "部署指引已就绪！将 $ZIP_NAME 上传到云端即可一键运行。"
echo
