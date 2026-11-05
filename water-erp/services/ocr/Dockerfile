# ERP OCR 服务生产镜像（麒麟 x86_64 / 8 核 / 无 GPU / 32G）
#
# 构建（本机有网）：docker build -t water-erp-ocr:1.3.0 .
# 搬运（生产无网）：docker save water-erp-ocr:1.3.0 | gzip > water-erp-ocr-1.3.0.tar.gz
#                   生产 docker load < water-erp-ocr-1.3.0.tar.gz
# 依赖用 requirements-prod.txt（rapid 专用裁剪版，模型内置 wheel，勿用全量 requirements
# ——opendataloader[hybrid] 会拖 torch/docling 使镜像膨胀数 GB）
#
# 运行时配置：容器内 ocr_engine 读 /app/.env（挂载）或直接 -e 注入；
# 8 核 6 核预算预设：-e OCR_NUM_WORKERS=2 -e OCR_INTRA_THREADS=3 -e OCR_INTER_THREADS=1
FROM python:3.10-slim

# 国内源加速（构建机网络对官方源慢）
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
    || sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list

# opencv（rapidocr 依赖）与 onnxruntime 的系统库：libGL/libglib/libxcb + OpenMP
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libxcb1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-prod.txt .
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements-prod.txt

COPY main.py ocr_engine.py config_gpu.yaml start.sh ./
COPY .env.example ./

# 容器必须绑 0.0.0.0（start.sh 的 OCR_HOST env 默认即经此生效）
ENV OCR_HOST=0.0.0.0 OCR_PORT=8100

EXPOSE 8100

# 与旧 1.0.0-gpu 的运维口径对齐（slim 无 curl，用 python 探活）
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8100/health', timeout=4)" || exit 1

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "1", "--timeout-keep-alive", "300"]
