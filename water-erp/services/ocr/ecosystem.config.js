/**
 * ERP 自管 OCR 实例（PM2 erp-ocr，:8110）
 *
 * 2026-11-04 接管：ERP 不再复用 procurement :8100（procurement-ocr PM2 不动），
 * apps/api/.env OCR_SERVICE_URL 指向本实例。与生产拓扑一致（ERP 独立容器）。
 *
 * 参数对齐 procurement-ocr 惯例：watchdog 自杀（os._exit(1)）靠 restart_delay
 * 拉起——必须 PM2 托管，勿并入 pnpm dev 的 concurrently（不会重启）。
 * 配置旋钮（线程/worker/dpi/分块）经 services/ocr/.env（ocr_engine.py 自读）。
 */
module.exports = {
  apps: [
    {
      name: 'erp-ocr',
      cwd: __dirname,
      script: './.venv/bin/uvicorn',
      args: 'main:app --host 127.0.0.1 --port 8110 --workers 1 --timeout-keep-alive 300',
      interpreter: 'none',
      max_memory_restart: '4G',
      kill_timeout: 30000,
      restart_delay: 5000,
      max_restarts: 10,
    },
  ],
};
