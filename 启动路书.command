#!/bin/bash
# 双击启动路书应用：后台常驻，无需保持终端窗口；已运行时直接打开页面
cd "$(dirname "$0")" || exit 1

PYTHON=""
for c in python3 /usr/bin/python3 /usr/local/bin/python3 /opt/homebrew/bin/python3; do
  if command -v "$c" >/dev/null 2>&1; then PYTHON="$c"; break; fi
done
if [ -z "$PYTHON" ]; then
  osascript -e 'display alert "路书启动失败" message "未找到 Python3。请打开「终端」执行：xcode-select --install 安装后重试" as critical'
  exit 1
fi

probe() { curl -s -o /dev/null -w '%{http_code}' --max-time 1 "http://localhost:$1/api/health" 2>/dev/null; }

# 已有实例在跑：直接打开页面即可
for port in 8123 8124 8125 8126; do
  if [ "$(probe "$port")" = "200" ]; then
    open "http://localhost:$port/"
    exit 0
  fi
done

# 后台启动（日志写 server.log，退出终端窗口也不影响）
LOG="$PWD/server.log"
SERVER_NO_OPEN=1 nohup "$PYTHON" server.py > "$LOG" 2>&1 &

# 等端口就绪（最多12秒）后打开浏览器
for i in $(seq 1 24); do
  sleep 0.5
  for port in 8123 8124 8125 8126; do
    if [ "$(probe "$port")" = "200" ]; then
      open "http://localhost:$port/"
      exit 0
    fi
  done
done

# 走到这里说明启动失败：把日志展示出来（窗口保持，便于反馈）
echo "路书启动失败，日志如下："
tail -n 30 "$LOG" 2>/dev/null
read -n 1 -s -r -p "按任意键关闭..."
