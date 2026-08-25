# 合规修复遗留 minor backlog（2026-08-25 收官盘点）

> 来源：2026-08-19 合规审查 → P0/P1 修复 13 个 PR（#52-#64）期间各任务级审查的 deferred minor 发现。
> SDD 账本随工作区删除，本文为唯一持久载体。重要项已在各 PR 终审修复波解决或记入 spec/CLAUDE.md——**此处只列未处理项**。
> 严重度均为 Minor（不阻塞合并）；按域分组，无时间承诺。

## 1. 开评标时间与状态机

- **sendNegotiationConfig 直更 deadline**：24h 字面量直接 update（不走 updateProject 的 frozen 语义），理论上可动已冻结截标时间（值当前正确，属「单常量例外」）。
- **createCustomExtractionProject 影子项目 7 天 gap**：抽取专用项目 openTime/deadline 差 7 天，不属投标项目但造成口径不齐。
- **procurement.service createBid（legacy）+7d/+5d**：仅查 `deadline < openTime`，残留旧口径。
- **60s 接管魔数三处重复**（decryptOuter 预筛/单家接管/decryptSupplier）——可抽命名常量。
- **spec §8 开放问题：延时开标上限**——frozen 模式允许 openTime 距 deadline 任意远（≥24h）；若集团要求「截标后 24h 内必须开标」需另行加上限（P0-2 spec 留白，未实现）。

## 2. 公告与招标文件

- **公告直建 400 仅 log**：createFromAnnouncement 失败只写 error log，公告 publish 照样成功 → 无项目；发布用户无可见提示（P0-2 终审提出 follow-up，未做）。
- **向导双草稿字段优先级**：`bidOpeningTime` vs `procurementTime` 同时存在且不同时可自触发 align 400（边缘）。
- **pre-open 快照 1h gap** 与面板 −24h 展示不一致（演示专用，重拍快照即消）。
- **wizard「开标前24h」类展示标签**：部分仍为字面量（多数已常量化，残个别）。

## 3. 上传与文件保护

- **findSubmissionByDualAssets 硬编码角色数组**：与 `EnvelopeRole` 联合类型重复定义（fail-closed，新角色会静默 403）；建议从共享常量驱动。
- **staff/专家门控与四列规则平行副本**（canAccessFile vs delete 保护）：~60 行同语义重复，改一处漏另一处的漂移风险。
- **MinIO 无 versioning/retention/SSE**：归档文件 at rest 明文 + 同 key 覆盖（生产基础设施项）。

## 4. 密码学与时间锚

- **无 TSA 可信时间戳**：全部时间为服务器时钟 + 平台自身 HMAC（生产清单已记，属基础设施立项）。
- **canonicalJson 顶层 undefined 守卫**：`canonicalJson(undefined)` 返回 undefined 违反 `: string` 声明（调用面均类型化，纯防御）。
- **sha256Hex Uint8Array 分支无 golden 固定摘要**：编码回归（如 UTF-16）会静默通过。
- **crypto.subtle 需 secure context**：供应商门户 LAN http 部署会挂（生产须 https，已记生产清单）。

## 5. 日志与留痕

- **`clean-legacy-plaintext --execute` 从未执行**：dev 库 0 候选故无操作；生产执行前须先跑 dry-run 审阅 + streamFile sealedPath 条件已具备。
- **seed bootstrap 写盘失败回滚 parked**：seed.ts 内联 bootstrap 缺「写盘失败回滚 active 行」（P1-12 终审 Minor，极窄窗口）。
- **改判后 decryptError 残留旧文案**：BIDDER→PLATFORM 改判时 decryptError 未同步改写为 PLATFORM 文案（一行级）。
- **OperationLog 归档验证端点无 e2e**：verify/:month 仅单测（真实 MinIO roundtrip 未冒烟）。

## 6. 专家与评标

- **利害关系检测仅单位名子串匹配**：亲属/控股/任职靠自我声明；可加法人代表/控股链数据源。
- **候补→正选互换无阶段闸门**（P2-5）：swapExpertRole 任何阶段可调，被换专家已交分数被静默排除。
- **3 人委员会豁免无项目规模门槛**：任何项目 3 人即过（大型项目应 ≥5）。
- **评标时限仅约束专家侧**：管理端代评通道已删（P1-10），但生成评标结果/异议裁决不校验 evaluationDeadline。
- **web tsc pre-existing 6 错**（accounts.ts）：P1-9 冒烟时发现，与本次改动无关。

## 7. 环境与测试基建

- **e2e 脚本契约同步规则**：改注册/公告/时间契约的 PR 必须同步 `e2e-dual-envelope.ts`/`e2e-legacy-regression.js`（memory 已记，此处留档）。
- **登录限流 10/min 拖慢冒烟**：连续 e2e 重跑会撞 429；脚本可加节流或测试环境放宽。
- **dev 库冒烟残留 12 个项目**（4 个 24H冒烟 + 8 个双信封冒烟）：不影响功能，介意可清。
- **陈旧分支**：8+ 已合并/过时分支 + `ci/frontend-lint`（lint 清零工作未续）。
- **keystore 单点**：无轮转计划；生产须纳入部署备份。

## 8. 明确不做（决策留档）

- P0-3（20日/5日时限校验）：用户决定跳过（memory `p0-3-deadline-validation-deferred`）。
- P1-3② 开标记录向社会公布：用户明确暂缓。
- P1-11 电子签章：待服务商决策后启动（#64 纸面方案为升级路径）。
