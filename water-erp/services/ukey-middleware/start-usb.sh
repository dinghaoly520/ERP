#!/usr/bin/env bash
# USB 盾模式:slot 目录指向U盘挂载点——插盘=插盾,拔盘=未插盾(SHD_NOT_FOUND)
# 卷标默认 CA,可用 UKEY_USB_LABEL 覆盖;演示盘建议 exFAT(跨 Windows/Linux,无 POSIX 权限位属演示边界)
set -euo pipefail
LABEL="${UKEY_USB_LABEL:-CA}"
MOUNT="/media/${USER:-$(id -un)}/${LABEL}"
if [ ! -d "${MOUNT}/slots" ]; then
  echo "[ukey-mw-usb] 未检测到U盘 ${MOUNT}/slots —— 请插入卷标为 ${LABEL} 的U盘(盘上建 slots/ 并放入 .ukey 盾文件)" >&2
  echo "[ukey-mw-usb] 当前块设备:" >&2
  lsblk -o NAME,LABEL,SIZE,FSTYPE,MOUNTPOINT | grep -v loop >&2 || true
  exit 1
fi
export UKEY_SLOT_DIR="${MOUNT}/slots"
exec bash "$(dirname "$0")/start.sh" "$@"
