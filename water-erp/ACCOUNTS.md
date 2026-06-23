# 测试账号汇总

> 各门户独立登录会话（每端口需单独登录），密码统一为 `<用户名>@2026`。
> 来源：`apps/api/prisma/seed-data/*.json`（JSON 快照，由 `seed.ts` 做 `TRUNCATE + createMany` 重载；改种子数据改 JSON，不要改 seed.ts 逻辑）。`admin` 角色在 RBAC 中存在，但**无种子用户**。

## 信息门户 — http://localhost:3002

无需登录，公开访问。

## 电子商城 — http://localhost:3003

| 用户名 | 密码 | 角色(role) | 姓名 |
|--------|------|------------|------|
| `陈主任` | `czr@2026` | `mall` · 商城采购员 | 陈主任 |

## 供应商门户 — http://localhost:3004

| 用户名 | 密码 | 角色(role) | 姓名 |
|--------|------|------------|------|
| `supplier1` | `supplier1@2026` | `supplier` · 供应商（已入库 APPROVED） | 王仁平 |
| `四川水发建设有限公司` | `supplier@2026` | `supplier` (approved) · 英雄项目 3 家之一 | — |
| `中科院成都信息技术股份有限公司` | `supplier@2026` | `supplier` (approved) · 英雄项目评标第 1 名 | — |
| `四川省通信产业服务有限公司` | `supplier@2026` | `supplier` (approved) · 英雄项目解密异常 | — |
| `huaxi` | `huaxi@2026` | `supplier` (approved) · 成都华西物资供应 | — |

> 共 497 家供应商种子数据。`supplier1` 已入库（可投标/提交文件）；其余以完整企业名称为用户名的供应商均 `supplier@2026`。

## 采购管理端 — http://localhost:3005

| 用户名 | 密码 | 角色(role) | 姓名 |
|--------|------|------------|------|
| `陈主任` | `czr@2026` | `procurement_staff` · 采购管理员 | 陈主任 |

## 专家门户 — http://localhost:3006

> 评审专家共 186 名，来自真实专家库（`ExpertProfile.json`）。**用户名 = 专家姓名，口令统一 `expert@2026`**。完整名单见 `apps/api/prisma/seed-data/ExpertProfile.json`。

| 用户名 | 密码 | 角色(role) | 姓名 |
|--------|------|------------|------|
| `刘苡池` | `expert@2026` | `bid_expert` · 评标专家 | 刘苡池 |
| `宋为广` | `expert@2026` | `bid_expert` · 评标专家 | 宋为广 |
| `魏熙` | `expert@2026` | `bid_expert` · 评标专家 | 魏熙 |
| …（共 186 名） | `expert@2026` | `bid_expert` · 评标专家 | 见专家库 |

> `seed.ts` 末尾会把真实库导出的编号用户名（如 `a000912`）自动重置为专家姓名、口令统一为 `expert@2026`，故即使从真实库重新 `dump-seed.ts` 导出，再 seed 一次凭据即自动修复。

## 开评标管理端 — http://localhost:3007

> 登录入口在专家端 :3006 → 管理员 tab（与 web 共享 `token_web` 会话）。

| 用户名 | 密码 | 角色(role) | 姓名 |
|--------|------|------------|------|
| `陈主任` | `czr@2026` | `bid_host` · 开标主持人 | 陈主任 |

## 说明

- **「陈主任」同名账号**：username 不再全局唯一（改为 `[username, role]` 复合唯一），三个 role 不同的账号共用登录名「陈主任」/ `czr@2026`。登录时按来源门户（`X-Portal` 头）区分：电子商城→mall、采购管理端→procurement_staff、开标端（专家门户 admin tab）→bid_host。详见 `auth.service.ts` 的 `PORTAL_ROLE_PRIORITY`。
- **无 `admin` 账号**：`admin` 角色仍存在于 schema/RBAC（如 `BidController` 的 `@Roles`），但没有种子用户，已改为按门户划分的账号。
- **每门户独立登录**：cookie 按门户命名（`token_public`/`token_web`/`token_expert`/`token_supplier`/`token_mall`），切换门户需重新登录。
- **会话共享例外**：开评标管理端 :3007 读取 `token_web` cookie，与 web :3005 共享同一会话（后端按角色命名 cookie，`admin`/`bid_host` 都落到 `web` 命名空间，无 `token_bid`）。
