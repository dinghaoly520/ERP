# 供应商公司名登录 — Seed & E2E 改造报告

日期：2026-07-26 · 分支：main（未提交、未推送）

## 目标

所有 `role='supplier'` 用户改为**公司名登录**、口令统一 **supplier@2026**，与评审专家「用户名=姓名 / 口令 expert@2026」的规整方式一致。只改 seed 与 e2e，不动业务代码。

## 改动文件

### A. `apps/api/prisma/seed.ts`

- **`seed.ts:296-338`** — 新增「═══ 供应商凭据规整 ═══」段，紧接专家评审规整段（264-294）之后，完全镜像其写法：
  1. `prisma.supplier.findMany({ select: { userId, name } })` 建 userId→公司名 Map；
  2. 遍历 `prisma.user.findMany({ where: { role: 'supplier' } })`，无对应公司名者 `continue`（计入 `supNoCompany`）；
  3. `targetUsername = 公司名.trim()`；与现用户名相同 → 仅 `passwordHash` 重置（`supPasswordOnly`）；
  4. 占用检查 `findFirst({ where: { username: targetUsername, role: 'supplier', NOT: { id: u.id } } })`，被占用 → `console.warn` + 保留原用户名仅重置口令（`supConflictSkipped`）；
  5. 否则同时 update `username` + `passwordHash`（`supRenamed`）。
  - 标题日志：`▶ 规整供应商凭据（用户名=公司名，口令 supplier@2026）`；
  - 汇总日志：`供应商 504 名：重命名 501、仅改口令 3、冲突跳过 0、无公司名跳过 0`（3 个"仅改口令"是 User.json 中 username 本就为公司名的账号，如 3 家英雄项目供应商之一；504 家公司名实测零重复，冲突分支仅为防御性兜底）。
- **`seed.ts:384`** — 末尾演示账号日志由 `supplier1 / supplier1@2026` 改为：
  `[供应商端   :3004]  公司名登录 / 口令 supplier@2026（例：四川水发建设有限公司 / supplier@2026）`

### B. E2E（`apps/api/test/`，登录串与 username 反查全量替换）

| 文件:行 | 改动 |
|---|---|
| `auth.e2e-spec.ts:110,128,139` | `loginAs(..., 'supplier1', 'supplier1@2026')` → `'重庆蜀通岩土工程有限公司', 'supplier@2026'`（:109 注释同步说明原 supplier1） |
| `bid.e2e-spec.ts:43` | 同上（loginAs） |
| `catalog.e2e-spec.ts:54` | `findUnique({ username_role: { username: 'supplier1' ... } })` → `'重庆蜀通岩土工程有限公司'` |
| `catalog.e2e-spec.ts:75` | loginAs 同上 |
| `supplier.e2e-spec.ts:44` | `findUnique({ username_role: ... })` → `'重庆蜀通岩土工程有限公司'` |
| `supplier.e2e-spec.ts:48` | loginAs 同上 |
| `opening-hall.e2e-spec.ts:69` | loginAs → `'重庆蜀通岩土工程有限公司', 'supplier@2026'` |
| `opening-hall.e2e-spec.ts:70` | loginAs `huaxi` → `'成都华西物资供应有限公司', 'supplier@2026'` |
| `opening-hall.e2e-spec.ts:124,289` | `findFirst({ username: 'supplier1' })` → `'重庆蜀通岩土工程有限公司'` |
| `opening-hall.e2e-spec.ts:125` | `findFirst({ username: 'huaxi' })` → `'成都华西物资供应有限公司'` |
| `sealed-bid-backup.e2e-spec.ts:47` | loginAs 同上 |
| `sealed-bid-backup.e2e-spec.ts:49` | `findFirst({ username: ... })` → `'重庆蜀通岩土工程有限公司'` |

grep 复核：`apps/api/test/` 残留的 `supplier1` 字样仅剩 4 处纯注释（catalog:58,71 / supplier:43 / sealed-bid-backup:66），无登录/查询串遗漏。

## 验证结果

### 1. Seed（`pnpm db:seed`）

成功。末尾日志含 `▶ 规整供应商凭据…` 段与新版 :3004 演示账号行。DB 复核：`username IN ('supplier1','huaxi')` 的 supplier 用户 = **0**。

### 2. 登录实测（curl → :4001，`X-Portal: supplier`）

| 用例 | 结果 |
|---|---|
| `成都华西物资供应有限公司 / supplier@2026` | **200**（返回 supplier JWT） |
| `huaxi / huaxi@2026` | **401** 用户名或密码错误 |
| `四川水发建设有限公司 / supplier@2026`（文档示例） | **200** |
| `重庆蜀通岩土工程有限公司 / supplier@2026`（e2e 账号） | **200** |

### 3. E2E

- `pnpm --filter api test:e2e -- opening-hall`：**24/24 全绿**。
- 全量 `pnpm --filter api test:e2e`：93 用例，**87 过 / 6 败**（3 个套件：catalog ×3、bid ×2、operation-log ×1）。
- **预存失败取证**：stash 本改造 → 旧 seed 重灌（DB 恢复 supplier1/huaxi）→ 旧代码全量 e2e，得到**完全相同**的 3 套件 / 6 用例失败（catalog 议价/审批 403、bid startEvaluation 409 状态机、operation-log 记录断言），与供应商登录名无关；pop 恢复后重跑结果一致。结论：6 个失败全部预存，本次改造**零新增失败**。
- 所有供应商登录相关套件（auth / supplier / sealed-bid-backup / opening-hall / upload）全绿。

### 4. 构建

`pnpm --filter api build` 干净退出（exit 0）。

## 遗留

1. **6 个预存 e2e 失败**（与本次无关）：catalog `JOIN_EXISTING / UPDATE_QUOTE / NEW_ITEM`（管理员审评端点 403）、bid `管理员可启动评标`（409 状态机）与 `SCORE_ITEM_HAS_NO_POINTS`、operation-log `已认证请求被记录`。建议另开任务排查。
2. `water-erp/ACCOUNTS.md` 与各 README/文档中残留的 `supplier1@2026` 等旧凭据描述未改（本任务范围仅 seed + e2e；CLAUDE.md 由用户自行更新）。
3. 供应商注册流程（`/api/supplier/register`）仍由用户自定用户名，新注册账号不自动获得「公司名用户名」；规整仅在 seed 时生效。如需线上存量迁移，需一次性脚本（不在本次范围）。
4. 未提交、未推送（按要求由用户处理）。工作区改动：seed.ts + 6 个 e2e spec。
