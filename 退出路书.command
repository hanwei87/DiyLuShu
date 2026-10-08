#!/bin/bash
# 停止路书后台服务
pids=$(lsof -ti :8123 -ti :8124 -ti :8125 -ti :8126 2>/dev/null)
if [ -n "$pids" ]; then
  kill -9 $pids 2>/dev/null
  echo "路书服务已停止"
else
  echo "路书服务当前未在运行"
fi
sleep 1
