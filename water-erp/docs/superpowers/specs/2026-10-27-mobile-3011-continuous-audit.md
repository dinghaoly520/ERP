# :3011 持续自查与优化台账（2026-10-27 起）

> 机制：每轮聚焦一个维度（交互/数据/稳健/性能/PWA）——取证 → 修复 → 实证（tsc/curl/逻辑复验）→ 提交 → 记账。仅记**实修项**与**遗留待决项**；台账即下一轮的输入。

## 轮次记录

### R1 交互细节（已完结，3 修 1 判非问题）

- **R1-1** chat `?q=` 预填读后未清 URL——刷新/回退会重复预填；`history.replaceState` 清参（不留历史）
- **R1-2** 水叮当发送失败无重试入口——失败气泡携带 `failedQ` 渲染「重试」chip；ask 拆 doAsk（重试不重复追加用户气泡）
- **R1-3** dashboard 下拉刷新同轮双取——`retryTick` 在 loadData deps 内，pull 回调 bump 后 loadData 身份重建 → mount effect 二次触发；移出 deps（pull 已直调 loadData；retryTick 仍驱动要报/龙虎榜重取）
- **判非问题**：chat 页无下拉刷新——fixed 壳脱离主滚动容器，但会话无需拉刷新（历史弹层即重载入口），维持现状

## 遗留待决（需用户裁定，勿自行实施）

- 分享图片卡（canvas 绘卡转发微信群）
- 水叮当按项目名/编号直查（cockpit 工具加 project action）
- 每日定时推送（需通道决策）
- bid_host 在水叮当 INTERNAL_ROLES 的数据面口径
