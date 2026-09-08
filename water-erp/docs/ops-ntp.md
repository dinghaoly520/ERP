# 服务器时钟同步（国家授时中心）— W4 / CTS-EBS01 A-97~A-98

## 要求

A-97：投标截止/开标等关键时间须使用国家授时中心标准时间；A-98：页面动态显示标准时间。

## 架构

- **权威源**：API 服务器系统时钟，经 `chronyd` 同步国家授时中心（`ntp.ntsc.ac.cn` / `www.ntp.ac.cn`）。
- **应用层**：`GET /api/time`（@Public）返回 `{ serverTime, iso, source }`——运维上服务器即标准时间。
- **客户端**：`@water-erp/shared` 的 `serverClock` 工具（`syncServerClock()` 算 offset 含 RTT 半程补偿 → `serverNow()/serverNowMs()`）。
  已接入：:3004 `CountdownTimer`（投标截止倒计时）；:3007 开标大厅沿用其会话级 `serverTime` 同步（未改动）。

## 服务器配置（生产/演示机）

```bash
# macOS（开发机）
sudo systemsetup -setusingnetworktime on
sudo systemsetup -setnetworktimeserver ntp.ntsc.ac.cn

# Linux（生产）——实测有效的三步（2026-09-08 本机落地）：
# 1) 追加 NTSC 主源（prefer）+ 备源。勿保留 Ubuntu 默认池一起跑：
#    NTSC 与池源存在数十 ms 系统差，9 个池源多数派会把 NTSC 判为离群（^?），prefer 救不了已被排除的源
sudo tee -a /etc/chrony/chrony.conf <<'CONF'
server ntp.ntsc.ac.cn iburst prefer
server ntp.aliyun.com iburst   # 备源
CONF
# 2) 注释发行版池与 DHCP 源，让源选择以 NTSC 为准
sudo sed -i 's|^pool |# pool |; s|^sourcedir /run/chrony-dhcp|#sourcedir /run/chrony-dhcp|' /etc/chrony/chrony.conf
sudo systemctl restart chrony
# 3) NTSC 公网服务间歇限答：若 sources 里 NTSC 行长期 ^?（reach 低），root 发一轮探测突发加速建样本
#    （burst 按已解析 IP 下发，主机名报 503 No such source）
sudo chronyc -N burst 4/8 "$(getent ahostsv4 ntp.ntsc.ac.cn | awk '{print $1; exit}')"
# 验证：chronyc -N sources 中 NTSC 行出现 ^*（当前同步源）；chronyc tracking System time 偏差 <1s
```

## 验收口径

1. `curl -s localhost:4001/api/time` 返回 ISO 且与 `chronyc tracking` 偏差 <1s；
2. 客户端篡改本地时间后，:3004 倒计时不漂移（`syncServerClock` 每 Mount 重算 offset）；
3. `chronyc sourcestats` 显示 NTSC 源可达。

## 送测演示与证据固化（A-97 现场材料）

现场演示三步：

1. `chronyc tracking` —— 展示 `Leap status : Normal`、`System time` 偏差 <1s（同步链经 `ntp.ntsc.ac.cn`）；
2. `curl -s localhost:4001/api/time` —— 应用层时间源（`source: server-clock`）；
3. 篡改客户端本地时间 → :3004 投标倒计时不漂移（offset 每 Mount 重算）。

证据固化：`scripts/ntp-evidence.sh [API_BASE]`（默认 `http://localhost:4001`）——采集 tracking/sources/sourcestats + `/api/time` 偏差，落盘 `docs/认证送测材料/ntp-证据/ntp-evidence-<UTC时间戳>.txt`（目录 gitignore，仅本地留存）。退出码 0=证据有效；1=chrony 缺失/未同步/无 NTSC 源；2=API 时间校验未过。现场采集后随送测材料归档。

> ⚠️ Ubuntu 桌面默认 `systemd-timesyncd`：`timedatectl` 显示 synchronized 不等于国家授时中心同步——其默认源为发行版 NTP 池。安装 chrony 后自动接管 timesyncd；证据一律以 `chronyc` 输出为准。
