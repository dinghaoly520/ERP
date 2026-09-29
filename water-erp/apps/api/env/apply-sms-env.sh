#!/usr/bin/env bash
# 一键把 SMS 阿里云直连配置并入本机 apps/api/.env（.env 不入库，机器本地）。
# 用法：cd water-erp/apps/api && bash env/apply-sms-env.sh
# 会提示输入 env/sms-aliyun-keys.enc 的解密口令（不回显），口令请走非 git 渠道获取。
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET=.env
ENC=env/sms-aliyun-keys.enc
CFG=env/sms-aliyun.env
MARKER='# ── SMS 阿里云直连配置（env/apply-sms-env.sh 注入）──'

if [ ! -f "$TARGET" ]; then
  echo "未找到 $TARGET —— 请先: cp .env.example .env 再运行本脚本" >&2
  exit 1
fi
if grep -qF "$MARKER" "$TARGET"; then
  echo "$TARGET 已有注入的 SMS 配置块；如需重装请先手动删除旧块（自 $MARKER 起）再运行。" >&2
  exit 1
fi

# 解密密钥（口令由 openssl 在终端提示输入，不回显、不进 shell 历史）
KEYS=$(openssl enc -d -aes-256-cbc -pbkdf2 -a -in "$ENC")

# 追加到 .env 末尾——dotenv 同文件内后值覆盖前值，
# 故本块会覆盖 .env.example 带来的 SMS_DEBUG_BYPASS=true 等旧值
{
  echo ""
  echo "$MARKER"
  cat "$CFG"
  echo "$KEYS"
} >> "$TARGET"

echo "已并入 ${TARGET}。重启 :4001 后生效（pnpm dev:api）。"
