# 截标↔开标 24h 关系规范化 · 设计 Spec

> 日期：2026-08-21
> 状态：已实施（feat/opening-deadline-24h）
> 依据：电子招投标合规审查报告（2026-08-19）P0-2；《招标投标法》第34条
> 用户决策（2026-08-21 确认）：①业务规则 = **截标 = 开标前 24 小时**（修正现存 12h 散落硬编码）；②留痕口径 = 集团采购业务规则（**内部惯例、无成文条款**），注明与第34条偏离风险；③校验语义 = **强制精确 24h**（分钟级 ±1min 容差，不等 400）；④存量由迁移脚本统一差值。

---

## 1. 目标

1. 把散落在全链路的「截标=开标前 12 小时」统一为**单一权威常量**「截标=开标前 24 小时」，前后端同源；
2. 服务层全写路径强制该关系（截标前），杜绝漂移；截标后 deadline 冻结、仅 openTime 可延（延时开标）；
3. 制度依据显式留痕（内部惯例 + 第34条偏离风险声明），审计存疑项#2 关闭；
4. 存量种子/快照/演示脚本统一到 24h 口径。

## 2. 常量与留痕

### 2.1 共享常量（`packages/shared/src/constants.ts`）

```ts
/** 截标↔开标业务规则：投标截止 = 开标前 24 小时（集团采购业务规则·内部惯例）。
 * 留痕：与《招标投标法》第34条「开标应当在提交投标文件截止时间的同一时间公开进行」
 * 存在偏离——依据为集团采购业务规则（内部惯例，无成文条款）；对依法必须招标项目
 * 存在程序瑕疵风险，待制度成文化后更新本引用与 UI 文案。 */
export const BID_DEADLINE_BEFORE_OPENING_MS = 24 * 3_600_000;
/** 关系校验分钟级容差 */
export const BID_OPENING_GAP_TOLERANCE_MS = 60_000;
```

- 前端（web/supplier-portal/bid-portal）引用该常量（经 `@water-erp/shared`），不再本地写死 12/24。
- UI 文案引用口径：「截标=开标前24小时（集团业务规则）」；:3005 开标确认面板标题（现 bid-confirm-panel.tsx:558「公告发布 → 开标前 12 小时」）同步改为 24h 并注明「截标后不可变更」。

## 3. 服务层强校验（分阶段语义）

### 3.1 公共纯函数（`apps/api/src/bid/opening-deadline.util.ts`）

```ts
export type DeadlineOpenMode = 'align' | 'frozen';
/** 校验截标↔开标关系。
 * - align（截标前，openTime 尚未到）：deadline === openTime − 24h（±1min 容差）
 * - frozen（截标后/阶段≥OPENING）：deadline 不得变更（与现值相等），openTime ≥ deadline + 24h
 * 不满足 → 抛 BadRequestException({ code: 'DEADLINE_OPENING_GAP_INVALID', error: 文案带期望值 })
 */
export function assertOpeningDeadlineRelation(
  opts: { openTime: Date; deadline: Date; prev?: { openTime: Date; deadline: Date }; mode: DeadlineOpenMode },
): void;
/** 自动派生：由其一推另一个（align 语义下） */
export function deriveDeadlineFromOpenTime(openTime: Date): Date; // = openTime − 24h
export function deriveOpenTimeFromDeadline(deadline: Date): Date; // = deadline + 24h
```

### 3.2 写路径清单（全部接入）

| # | 路径 | 现状锚点 | 接入方式 |
|---|---|---|---|
| 1 | `createBidProject`（手动建项目） | bid.service.ts create 入参 openTime/deadline | align 校验（双字段均提供时）；缺 deadline 则 deriveDeadlineFromOpenTime |
| 2 | `createFromAnnouncement`（公告直建 N16） | bid.service.ts:1213-1214 区域（现 deadline 缺省 = openTime +7 天） | metadata.deadline 缺省 → derive（openTime 为基准）；提供则 align 校验 |
| 3 | `reopenFromAborted`（流标重启） | bid.service.ts:1213-1214（现 deadline=+3天、openTime=deadline+2h） | 兜底改为 `deadline = now+3天`、`openTime = deriveOpenTimeFromDeadline(deadline)`（+24h） |
| 4 | `updateProject`（PATCH 单/双字段） | bid.service.ts updateProject | **align 模式（截标前）**：仅传 openTime → deadline 反推；仅传 deadline → openTime 反推；双传 → align 校验。**frozen 模式（prev.deadline 已过）**：派生不生效——deadline 传值与现值不同 → 400 `DEADLINE_FROZEN`；仅传 openTime → 须 ≥ deadline + 24h，deadline 保持不动 |
| 5 | 延时开标（开标确认面板 PATCH openTime） | web bid-confirm-panel 延时开标路径 | 同 #4 的 frozen 语义；前端 UI 注明「截标已固化，仅推迟开标」 |

- 阶段判定：`mode = (prev?.deadline ?? deadline) < now ? 'frozen' : 'align'`（创建路径无 prev 恒 align）。
- 错误码：`DEADLINE_OPENING_GAP_INVALID`（align 不符，error 含期望 deadline 值）、`DEADLINE_FROZEN`（截标后改 deadline）。

## 4. 存量迁移

- 新脚本 `apps/api/scripts/align-opening-deadline-24h.ts`（tsx，参照 clean-legacy-plaintext 模式）：
  - 扫 BidProject 全部行；**deadline 未过**（> now）且 `|deadline − (openTime − 24h)| > 容差` 的行 → `deadline = openTime − 24h`（openTime 为基准，不动）；
  - 已截标/已归档行**不动**（历史留痕），dry-run 输出清单 + 分区计数；`--execute` 才写库，逐条失败隔离。
- 演示快照 `scripts/snapshots/*.json`：pre-open 类快照（openTime/deadline 均未来）同口径修正；已 OPENING 快照不动。
- `scripts/demo-decrypt-project.js` 等演示脚本中与截标-开标差相关硬编码随常量对齐（若无相关硬编码则跳过，报告说明）。
- seed-data JSON：含 BidProject 的 openTime/deadline 差值统一 24h（未截标的演示项目）。

## 5. 前端联动

| 门户 | 改动 |
|---|---|
| web (:3005) | 公告发布向导：openTime 输入后 deadline 自动 = openTime − 24h（只读展示，引用共享常量）；开标确认面板 :400/:558 的 12h 文案→24h + 「截标后不可变更」提示；延时开标弹窗注明冻结语义 |
| supplier-portal (:3004) | 投标页倒计时/截止展示若引用 12h 派生逻辑则改共享常量（grep 后确认，无则不动） |
| bid-portal (:3007) | 无派生逻辑（只读展示后端字段），不动 |

## 6. 数据模型

- 无 schema 变更（openTime/deadline 列保留，关系由服务层校验+派生保证）。

## 7. 测试策略

- **util 单测**（opening-deadline.util.spec.ts）：align 合规/差 23h/差 25h/容差边界；derive 两方向；frozen（deadline 改 → DEADLINE_FROZEN；openTime < deadline+24h → 400；openTime 延后合规）。
- **服务单测**（bid.service.spec.ts）：四写路径各 2-3 例（合规落库/违规 400/缺省派生/重启 +24h 兜底）；updateProject 单字段派生与 frozen 语义。
- **迁移脚本**：dry-run 对 dev 库输出清单核对（不执行 --execute 由用户决定）。
- **前端**：web tsc 0 错；supplier-portal 无改动则跳过。
- **e2e 冒烟**：建项目（默认 24h 关系落库）→ 延时开标（deadline 不动、openTime 延后）→ 流标重启（+24h 兜底）→ 截标后改 deadline 被拒。

## 8. 风险与开放问题

1. **第34条偏离不因本 spec 消除**：24h 关系只是把内部惯例规范化；对依法必须招标项目仍是程序瑕疵——留痕文案已注明，制度成文化后可替换引用。
2. **延时开标与 24h 关系的语义**：截标后 deadline 冻结、openTime 可延——frozen 模式允许 openTime 距 deadline 任意远（≥24h）；若集团要求开标必须在截标后 24h 内完成，需另行加上限（本 spec 不加，留开放项）。
3. **快照时间漂移**：快照的 openTime/deadline 是历史时间点，迁移后重新 snapshot 演示数据时按新口径生成。
4. **公告直建的 metadata.deadline 兼容**：既有公告元数据（含 12h 语义 deadline）在直建时会被 align 校验拒绝——迁移脚本先跑或 createFromAnnouncement 对「历史公告元数据」给出明确错误文案（含期望值），报告说明取舍。
