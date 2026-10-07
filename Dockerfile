# ==============================================================================
# 路书 (LuShu) - 容器化镜像构建
# 轻量级 Python 3.9+ 运行时，前端静态页面 + 后端 REST API + SQLite 数据库
# 使用国内稳定公开加速镜像源（解决飞牛默认 docker.fnnas.com 报 401 及 DockerHub 超时问题）
FROM docker.1ms.run/library/python:3.9-slim

# 设置工作目录与环境变量
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8123 \
    DATA_DIR=/app/data \
    DOCKER=1 \
    SERVER_NO_OPEN=1

# 复制前端与后端代码
COPY index.html ./
COPY server.py ./
COPY favicon* ./
COPY apple-touch-icon.png ./
COPY android-chrome* ./
COPY css/ ./css/
COPY js/ ./js/
COPY vendor/ ./vendor/

# 创建持久化数据挂载目录
RUN mkdir -p /app/data

# 暴露端口
EXPOSE 8123

# 健康检查探针
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8123/api/health')" || exit 1

# 挂载卷声明
VOLUME ["/app/data"]

# 启动服务
CMD ["python3", "server.py"]
