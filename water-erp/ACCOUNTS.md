# 测试账号汇总

> 各门户独立登录会话（每端口需单独登录），密码统一为 `<用户名>@2026`。
> 来源：`apps/api/prisma/seed-data/*.json`（JSON 快照，由 `seed.ts` 做 `TRUNCATE + createMany` 重载；改种子数据改 JSON，不要改 seed.ts 逻辑）。`admin` 角色在 RBAC 中存在，但**无种子用户**。

## 信息门户 — http://localhost:3002

无需登录，公开访问。

## 电子商城 — http://localhost:3003

| 用户名 | 密码 | 角色(role) | 姓名 |
|--------|------|------------|------|
| `陈源远` | `陈源远@2026` | `mall` · 商城采购员 | 陈源远 |

## 供应商门户 — http://localhost:3004

> **登录用户名 = 统一社会信用代码（机构代码）**（2026-08-24 起注册强制；下表存量种子账号仍为企业名用户名，可继续用企业名登录）。注册 2.0 演示完整数据账号：`91511500MA6CMJ0004` / `supplier@2026`（宜宾岷江水电设备工程有限公司）。

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
| `Swhi-CGZX-01` | `Swhi-CGZX-01@2026` | `leader` · 采购中心领导 | 陈源远 |
| `Swhi-CGZX-05` | `Swhi-CGZX-05@2026` | `staff` · 采购中心员工 | 彭强 |
| `Swhi-CGZX-admin` | `Swhi-CGZX-admin@2026` | `admin` · 采购中心管理员 | 采购中心管理员 |

> 注：`陈源远` 从 :3005 登录时按 `PORTAL_ROLE_PRIORITY.web` 实际解析为 `bid_host` 账号，`/project-management` 403——:3005 项目管理请用 `Swhi-CGZX-*` leader/staff 账号。
> `Swhi-CGZX-admin` 用于 `tender-review` 的规则提取/CRUD（`AdminGuard` 限 admin）；口令已在 `seed.ts` 内部管理账号规整循环中纳入（`<用户名>@2026`）。

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
| `陈源远` | `陈源远@2026` | `bid_host` · 开标主持人 | 陈源远 |

## U盾演示绑定

> 双信封投递（供应商门户投标）与开标确认电子签名都要求供应商已绑 U盾（投递页 `dualReady` = `profile.sm2PublicKey` 非空，未绑定时 A-90 方案a 仅显示绑盾引导卡）。演示供应商须先「发盾 → 绑定」两步：

```bash
# ① 发盾（模拟 CA 柜台办证；从 water-erp/ 运行，写 ~/.shuidi-ukey/slots/<shieldId>.ukey，PUK 仅打印一次）
node services/ukey-middleware/src/cli.mjs issue --cn <企业名> --pin 123456

# ② 绑定（盾内 CN 与 Supplier.name 精确匹配，幂等 upsert SupplierCert + 回填 sm2PublicKey）
cd apps/api && npx tsx scripts/bind-ukey-slots.ts --dry-run   # 先看清单
cd apps/api && npx tsx scripts/bind-ukey-slots.ts             # 实跑绑定

# 供应商浏览器侧解锁/解密还需 mock U盾中间件在跑（:17999）
pnpm dev:ukey-mw
```

发盾时 `--cn` 必须与库内供应商企业名**完全一致**（脚本按 `supplier.name === cn` 精确匹配，匹配不到会列入「有盾无供应商」清单跳过）。绑定脚本输出三张清单（绑定动作表 / 有盾无供应商 / 有供应商无盾·绑定悬挂），任何清单非空退出码均为 0；重复运行幂等（状态已达标零写入）。

**当前盾-供应商对应表**（验收发盾后回填）：

| 盾号（certSn） | 供应商（CN） | 状态 |
|----------------|--------------|------|
| `SHD-B14EF038` | 四川水发建设有限公司 | 已绑定（ACTIVE） |
| 待发盾 | 中科院成都信息技术股份有限公司 | 占位——验收后回填 |
| 待发盾 | 四川省通信产业服务有限公司 | 占位——验收后回填 |
| 待发盾 | 重庆蜀通岩土工程有限公司 | 占位——验收后回填 |
| 待发盾 | 成都华西物资供应有限公司 | 占位——验收后回填 |

## 说明
- **`admin` 账号**：种子有 `Swhi-CGZX-admin`（口令 `Swhi-CGZX-admin@2026`）。`tender-review` 规则提取/CRUD 走 `AdminGuard`（仅 admin），无此账号则规则管理对所有人 403——故 `seed.ts` 已把它纳入 `<用户名>@2026` 规整循环。
- **每门户独立登录**：cookie 按门户命名（`token_public`/`token_web`/`token_expert`/`token_supplier`/`token_mall`），切换门户需重新登录。
- **会话共享例外**：开评标管理端 :3007 读取 `token_web` cookie，与 web :3005 共享同一会话（后端按角色命名 cookie，`admin`/`bid_host` 都落到 `web` 命名空间，无 `token_bid`）。
