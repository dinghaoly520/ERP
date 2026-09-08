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

# Linux（生产）
sudo tee /etc/chrony/chrony.conf <<'CONF'
server ntp.ntsc.ac.cn iburst
server ntp.aliyun.com iburst   # 备源
makestep 1.0 3                 # 启动 3 次内允许跳变校准
CONF
sudo systemctl enable --now chronyd
chronyc tracking                # 验证：System time 偏差应 < 1s
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
