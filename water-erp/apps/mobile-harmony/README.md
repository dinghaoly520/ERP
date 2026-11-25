# 蜀水云采·移动驾驶舱 — 鸿蒙壳应用（网页转 App）

ArkWeb WebView 壳载入 `:3011` 移动驾驶舱——**零后端改动、零 Web 代码改动**的纯血鸿蒙
（HarmonyOS NEXT）App。登录态、短信验证码、轮询、图表全部复用 Web 侧现成实现。

## 构建运行

1. **DevEco Studio 26.x**（自带 SDK HarmonyOS 26.0.1 / API 26，hvigor 6.26+）打开本目录
   （独立工程，不在 pnpm workspace 内）
2. 首次打开提示同步 hvigor/SDK → 允许
3. `File > Project Structure > Signing Configs` 勾选 **Automatically generate signature**
   （需登录华为账号；真机调试签名免费）
4. 连接鸿蒙真机（或模拟器）→ Run

> **工程结构要点（2026-11-25 DevEco 26 实测）**：新结构要求 `hvigor/hvigor-config.json5`
> 与根 `oh-package.json5` **双处 `modelVersion` 相等**（本工程=26.0.1，合法区间
> [5.0.0, 26.0.1]）；API 26 时代 `compatibleSdkVersion` 不带 `(N)` 后缀。
> 命令行复现：`DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk
> /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw --sync`。
> **真机注意**：手机若为 HarmonyOS NEXT 5.x（API 12–14 时代），需在
> `Settings > HarmonyOS SDK` 补装 5.0.0(12) 并把 `compatibleSdkVersion` 改回
> `"5.0.0(12)"`（模拟器 26.0.1 不受影响）。

## 上线前必改一处

`entry/src/main/ets/pages/Index.ets` 顶部：

```ts
const APP_URL: string = 'http://192.168.1.10:3011';   // ← 改成目标地址
```

- 联调：局域网 `http://<本机IP>:3011`（明文 http 仅限内网开发）
- 生产：`https://mobile-ssyc.scsfjt.com`（**必须 https**——生产 cookie 恒 `Secure`，
  http 载入会丢登录态；上架 AppGallery 审核同样要求 https）

## 壳内已内置

| 能力 | 说明 |
|------|------|
| 登录态持久化 | ArkWeb cookie（`token_web`）跨启动持久 + 页面 sessionStorage（X-Web-Token 头）；冷启动免登录（proxy 闸按 cookie 放行） |
| 返回键/侧滑 | Web 可后退（板块间跳转、登录流内退）→ 站内后退；根页 → 系统默认（退后台不杀进程） |
| 离线兜底 | 主文档网络错误 / HTTP 4xx-5xx → 品牌色错误层 + 重试；子资源失败不拦 |
| 加载进度 | 顶部品牌蓝细进度条（onProgressChange 驱动） |
| 防白闪 | 窗口底色/启动窗底色/壳底色三层对齐页面背景 `#f4f6fa` |
| 折叠屏/旋转 | `auto_rotation_restricted` 跟随系统旋转；展开态由页面 `sm:` 断点自适应（2026-11-25 已全量适配） |
| 流量标记 | UA 追加 `SsycCockpitHarmony/1.0`（观测用，无鉴权语义） |
| 键盘避让 | ArkWeb 压缩/覆盖两类内核行为，:3011 页面（`m-kb-open` + `--kb-h` visualViewport）双态兼容 |

## 权限

仅 `ohos.permission.INTERNET`（system_grant，免弹窗）。短信验证码由服务端融易达通道
发出、通知与下载经 Web 完成，App 侧无需任何系统能力。

## 上架 AppGallery 要点

1. AppGallery Connect 创建应用，包名与本工程 `bundleName` 一致
   （`com.scsfjt.ssyc.mobile`，可按公司命名规范改）
2. 签名材料（.p12/.cer/.p7b）由 AGC 签发，填入 `build-profile.json5` 的 `signingConfigs`
3. `Build > Build App(s)/Hap(s)` 出包（release 需开混淆时先核 obfuscation-rules.txt）
4. **图标为占位**（复用 `procurement-brand-logo.png`）——上架需在 DevEco
   「Image Asset」生成正式分层图标（foreground/background），AppGallery 素材另按后台要求

## 边界与后续可选

- 页内已有驾驶舱自带上拉（PullIndicator），壳层不做原生下拉刷新（防与页内双触发）
- 深链（`ssyc://`）、推送（Push Kit 通知「待办/公告」）、版本自更新——均为后续可选项，
  需 AGC 应用实体就绪后接
- 老鸿蒙（HarmonyOS 4 及更早，非 NEXT）不在本壳目标内——NEXT 起官方 Web 壳路径才成立
