# =============================================================================
# OCR 微服务镜像（FastAPI + RapidOCR）——生产线同构版（2026-11-05 对齐生产
# Dockerfile.ocr 结构：BASE_IMAGE/PIP_INDEX/DEB_MIRROR 可参数化 + OCR_GPU 变体）
#
# 构建（CPU 版，8 核无 GPU 生产机用这个）：
#   docker build -t water-erp-ocr:1.3.0 .
# 构建（GPU 变体，供有 CUDA 机器；镜像约 +6GB）：
#   docker build --build-arg OCR_GPU=1 -t water-erp-ocr:1.3.0-gpu .
# 搬运（生产无网）：docker save water-erp-ocr:1.3.0 | gzip > water-erp-ocr-1.3.0.tar.gz
#
# v1.3.0 变更（相对生产 1.0.0）：
#   - 依赖走 requirements-prod.txt（drop pdf2image——v1.2 起代码改用 PyMuPDF，已死）
#   - 细粒度配置面：OCR_NUM_WORKERS/OCR_INTRA_THREADS 等（线程铁律 2×3≤核预算，
#     全量旋钮见 .env.example；compose -e 注入优先）
#   - 文字层快速路径 + 三护栏 / health 上报生效配置
# =============================================================================
ARG BASE_IMAGE=python:3.10-slim
FROM ${BASE_IMAGE}

# 国内加速参数（内网/海外机器可置空回退官方源）
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG DEB_MIRROR=mirrors.aliyun.com

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# opencv（rapidocr 依赖）libgl/libglib + OpenMP libgomp + curl（compose 健康检查用）
RUN set -eux; \
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
      [ -f "$f" ] && sed -i -e "s|deb.debian.org/debian|${DEB_MIRROR}/debian|g" \
                          -e "s|deb.debian.org/debian-security|${DEB_MIRROR}/debian-security|g" "$f" || true; \
    done; \
    apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libxcb1 libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依赖：rapid(ONNX/CPU) 为底座（requirements-prod.txt，PP-OCRv4 模型随 wheel 内置）；
# OCR_GPU=1 叠加 opendataloader-pdf[hybrid]（torch/cuda wheel，约 +6GB）
ARG OCR_GPU=0
COPY requirements-prod.txt .
RUN set -eux; \
    pip install --no-cache-dir --index-url ${PIP_INDEX_URL} -r requirements-prod.txt; \
    if [ "$OCR_GPU" = "1" ]; then \
        pip install --no-cache-dir --index-url ${PIP_INDEX_URL} "opendataloader-pdf[hybrid]"; \
    fi

COPY main.py ocr_engine.py config_gpu.yaml ./

# 镜像出厂默认 rapid/CPU + 8 核机 6 核预算预设；compose 覆盖层 env 优先级更高
ENV OCR_ENGINE=rapid \
    OCR_HOST=0.0.0.0 \
    OCR_PORT=8100 \
    OCR_MAX_SIDE=3000 \
    OCR_NUM_WORKERS=2 \
    OCR_INTRA_THREADS=3 \
    OCR_INTER_THREADS=1

EXPOSE 8100

# 容器级健康检查（compose 层的 curl 检查会覆盖此项；docker run 直用时兜底）
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -sf http://127.0.0.1:8100/health || exit 1

CMD ["sh", "-c", "exec uvicorn main:app --host \"${OCR_HOST:-0.0.0.0}\" --port \"${OCR_PORT:-8100}\" --workers 1 --timeout-keep-alive 300"]
