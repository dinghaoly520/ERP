# 便携 CA盾U盘(portable stick)重建指南

U盘=「盾+驱动」自包含:自带 Node 双平台运行时+中间件源码+盾文件,B 机零环境插盘即用。
盘上布局(exFAT,卷标 `CA`,挂载 `/media/<用户>/CA`):

```
slots/                  7 家供应商 .ukey 盾文件(来源 ~/.shuidi-ukey/slots)
middleware/src          中间件源码副本 + package.json + node_modules/{sm-crypto,jsbn}
runtime/linux/node      node-v24.16.0-linux-x64/bin/node(仅二进制,118M)
runtime/win/node.exe    node-v24.16.0-win-x64/node.exe(仅二进制,89M)
CA盾-启动-Linux.sh      双击运行(=本目录 run-linux.sh)
CA盾-启动-Windows.bat   双击运行(=本目录 run-windows.bat)
使用说明.txt
```

## 重建步骤

1. exFAT U盘设卷标 `CA`:卸载后 `sudo exfatlabel /dev/sdX1 CA`(需 exfatprogs)
2. 盾:`cp ~/.shuidi-ukey/slots/*.ukey /media/<用户>/CA/slots/`
3. 中间件:拷 `src/`、`package.json`、`node_modules/{sm-crypto,jsbn}`——
   **jsbn 是 sm-crypto 的传递依赖,漏了会 MODULE_NOT_FOUND(2026-09-03 实录)**
4. Node 双平台(版本与本机 nvm 一致,防行为漂移):
   - https://nodejs.org/dist/v24.16.0/node-v24.16.0-linux-x64.tar.xz → 取 bin/node
   - https://nodejs.org/dist/v24.16.0/node-v24.16.0-win-x64.zip → 取 node.exe
5. 拷 run-linux.sh/run-windows.bat 到盘根(重命名中文)。

## B 机使用

- Linux:插盘→双击「CA盾-启动-Linux.sh」→ :17999 起服务;Ctrl-C 停
- Windows:插盘→双击「CA盾-启动-Windows.bat」
- 门户来源默认加白 localhost:3004 与 `http://192.168.1.111:3004`(演示服务器),
  其他来源改脚本 `UKEY_MW_ALLOW_ORIGIN` 或 `UKEY_ERP_HOST` 环境变量
- 本机常驻模式仍走 `systemctl --user {start|stop} ukey-mw-usb`(与U盘脚本互斥,同抢 :17999)
