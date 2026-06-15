# 测试账号汇总

> 各门户独立登录会话（每端口需单独登录），密码统一为 `<用户名>@2026`。
> 来源：`apps/api/prisma/seed-data/*.json`（JSON 快照，由 `seed.ts` 做 `TRUNCATE + createMany` 重载；改种子数据改 JSON，不要改 seed.ts 逻辑）。`admin` 角色在 RBAC 中存在，但**无种子用户**。

## 信息门户 — http://localhost:3002

无需登录，公开访问。

## 电子商城 — http://localhost:3003

| 用户名 | 密码 | 角色(role) | 姓名 |
|--------|------|------------|------|
| `mall` | `mall@2026` | `mall` · 商城采购员 | 商城采购员 |

## 供应商门户 — http://localhost:3004

| 用户名 | 密码 | 角色(role) | 姓名 |
|--------|------|------------|------|
| `supplier1` | `supplier1@2026` | `supplier` · 供应商（已入库 APPROVED） | 张经理 |
| `supplier2` | `supplier2@2026` | `supplier` · 供应商（待审核 PENDING） | 赵总 |

## 采购管理端 — http://localhost:3005

| 用户名 | 密码 | 角色(role) | 姓名 |
|--------|------|------------|------|
| `caigou` | `caigou@2026` | `procurement_staff` · 采购管理员 | 采购管理员 |

## 专家门户 — http://localhost:3006

| 用户名 | 密码 | 角色(role) | 姓名 |
|--------|------|------------|------|
| `wangjg` | `wangjg@2026` | `bid_expert` · 评标专家（水利工程） | 王某国 |
| `liuxm` | `liuxm@2026` | `bid_expert` · 评标专家（机电设备） | 刘某梅 |
| `chenzq` | `chenzq@2026` | `bid_expert` · 评标专家（造价咨询） | 陈某强 |

> 另有 65 名生成专家（用户名 `exp0101`~`exp1305`，密码 `<用户名>@2026`），覆盖 13 个专业方向（职工代表/设备/造价/财资/测绘/工程设计院/施工-EPC/地质/人力资源/审计法务/安全环保/市场营销/机电），姓名均为某化、单位统一为 `XXX水利技术服务中心`。由 `apps/api/prisma/scripts/gen-experts.cjs` 生成。

## 开评标管理端 — http://localhost:3007

> 登录入口在专家端 :3006 → 管理员 tab（与 web 共享 `token_web` 会话）。

| 用户名 | 密码 | 角色(role) | 姓名 |
|--------|------|------------|------|
| `lizhuren` | `lizhuren@2026` | `bid_host` · 开标主持人 | 李主任 |

## 说明

- **无 `admin` 账号**：`admin` 角色仍存在于 schema/RBAC（如 `BidController` 的 `@Roles`），但没有种子用户，已改为按门户划分的账号。
- **每门户独立登录**：cookie 按门户命名（`token_web`/`token_expert`/`token_supplier`/`token_mall`），切换门户需重新登录。
- **会话共享例外**：开评标管理端 :3007 读取 `token_web` cookie，与 web :3005 共享同一会话（后端按角色命名 cookie，`admin`/`bid_host` 都落到 `web` 命名空间，无 `token_bid`）。
- **供应商差异**：`supplier1` 已入库（可投标/提交文件）；`supplier2` 待审核（只能浏览门户，不能提交）。
