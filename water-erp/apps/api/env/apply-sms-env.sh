#!/usr/bin/env bash
# 一键把 SMS 融易达直连配置并入本机 apps/api/.env（.env 不入库，机器本地）。
# 用法：cd water-erp/apps/api && bash env/apply-sms-env.sh
# 会提示输入 env/sms-rongyida-keys.enc 的解密口令（不回显），口令请走非 git 渠道获取。
# 脚本化/免交互场景：SMS_KEYS_PASS=xxx bash env/apply-sms-env.sh（口令经环境变量传 openssl，不进 argv/历史）。
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET=.env
ENC=env/sms-rongyida-keys.enc
CFG=env/sms-rongyida.env
MARKER='# ── SMS 融易达直连配置（env/apply-sms-env.sh 注入）──'

if [ ! -f "$TARGET" ]; then
  echo "未找到 $TARGET —— 请先: cp .env.example .env 再运行本脚本" >&2
  exit 1
fi
if grep -qF "$MARKER" "$TARGET"; then
  echo "$TARGET 已有注入的 SMS 配置块；如需重装请先手动删除旧块（自 $MARKER 起）再运行。" >&2
  exit 1
fi

# 解密密钥（默认 openssl 终端提示输口令、不回显；SMS_KEYS_PASS 存在时经 env 传递）
if [ -n "${SMS_KEYS_PASS:-}" ]; then
  KEYS=$(openssl enc -d -aes-256-cbc -pbkdf2 -a -in "$ENC" -pass env:SMS_KEYS_PASS)
else
  KEYS=$(openssl enc -d -aes-256-cbc -pbkdf2 -a -in "$ENC")
fi

# 追加到 .env 末尾——dotenv 同文件内后值覆盖前值，
# 故本块会覆盖 .env.example 带来的 SMS_DEBUG_BYPASS=true 等旧值
{
  echo ""
  echo "$MARKER"
  cat "$CFG"
  echo "$KEYS"
} >> "$TARGET"

echo "已并入 ${TARGET}。重启 :4001 后生效（SMS provider 在服务构造时一次性解析）。"
