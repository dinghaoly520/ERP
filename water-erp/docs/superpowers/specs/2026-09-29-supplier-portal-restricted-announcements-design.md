# 供应商门户定向公告可见性设计（:3004 公告中心并入 RESTRICTED）

日期：2026-09-29
状态：已与用户对齐（本文件为实施依据）

## 背景

公告发布配置支持两种可见范围（:3005 发布向导 / notice 编辑页）：
- `PUBLIC`：发给全部
- `RESTRICTED`：定向给勾选的部分供应商（`metadata.visibility='RESTRICTED'` + `metadata.restrictedSupplierIds[]`）

现状问题：:3004 供应商门户公告中心使用 `GET /announcements/public` → `publicList`，而 `publicList` 把 `RESTRICTED` 一律过滤（announcement.service.ts ~L296），导致定向公告在被选供应商自己的公告中心里也看不到。详情侧反而已支持（`getPublic` 校验登录供应商命中 `restrictedSupplierIds`，2026-09-28 P1 收口）。

用户需求：
- :3004 公告中心 = 发给全部的公告 ∪ 定向给本供应商的公告
- :3002 公开门户 = 仅发给全部的（现状即正确，不动）

## 目标 / 非目标

**目标**
1. 新增供应商视角公告列表端点，合并公开与定向命中的公告
2. :3004 公告中心页切换数据源，定向公告带「定向」徽章

**非目标（明确不做）**
- 不改 `publicList`（:3002、助手 AI 工具、公开语义零改动）
- 不改 :3005 发布向导 / 公告管理
- 不改候选供应商邀请链路（SELECTION_NOTIFY 是站内私信，本就不属于公告——用户拍板）
- 不改 DB schema（visibility/restrictedSupplierIds 已在 metadata jsonb）
- 不覆盖 :3006 专家端

## 方案（已选定）

新增登录态端点，公开端点契约不动。备选方案（publicList 注入登录上下文 / 前端双请求拼接）因语义污染与假分页被否。

## 后端设计

**`announcement.service.ts` 新增 `supplierList(params, supplierId)`**
- 查询口径与 `publicList` 一致的部分：status ∈ {PUBLISHED, ARCHIVED}（HIDDEN/OFFLINE 不出）；`publicVisibilityOnly` 同口径过滤；已下线出标题壳（`isOfflined`/`titleOnlyStub`）；脱敏（`stripForPublic`）
- 追加并入：`metadata.visibility='RESTRICTED' AND metadata.restrictedSupplierIds array_contains [supplierId]` 同 status 口径
- 实现为**单次 Prisma 查询**（`OR` 合并），不是两次查询拼接——分页 total/排序才真实
- Prisma jsonb 条件形态（Postgres）：`metadata: { path: ['visibility'], equals: 'RESTRICTED' }`；`metadata: { path: ['restrictedSupplierIds'], array_contains: [supplierId] }`
- 排序沿用 `[{ isTop: 'desc' }, { publishDate: 'desc' }, { createdAt: 'desc' }]`
- 返回项附 `visibility`（'PUBLIC' | 'RESTRICTED'，供前端徽章）
- 公司维度全量（沿用 2026-08-20 拍板契约：公开端全量所有公司公告，不注入公司隔离；定向并入同样不按公司过滤）

**Controller：supplier-portal 模块新增 `GET /supplier-portal/announcements`**
- 供应商登录鉴权（复用模块现有鉴权装饰器与 token→Supplier 解析，同 bid-documents 先例）
- 参数同 publicList（type/search/page/pageSize）

## 前端设计（apps/supplier-portal-next）

- `lib/api/announcement.ts` 新增 `supplierList(params)`（走需鉴权的 api 客户端路径，自动带 X-Supplier-Token）
- `app/(main)/announcements/page.tsx`：有登录 token → `supplierList`；无 token → 回退 `publicList`（= 今日匿名行为，只看公开）
- 列表项 `visibility==='RESTRICTED'` 渲染「定向」徽章
- 详情页继续 `getPublic`（RESTRICTED 命中放行已实现）；实施时确认详情请求确实携带 token（api 客户端统一头）

## 边界与错误处理

- 存量公告 metadata 无 `visibility` 字段 → 视为公开，与现行为一致
- `restrictedSupplierIds` 缺失/非数组的脏数据 → 视为不命中任何供应商（安全侧默认，不炸查询）
- 已下线（公示期满 PUBLISHED / ARCHIVED）定向公告 → 与公开公告同规则：仅标题壳
- 未登录访问供应商视角端点 → 401（前端已回退 publicList，不会触达）

## 测试与验收

**单测（announcement.service.spec 增补）**
1. 定向公告命中本供应商 → 出现在 supplierList
2. 同公告未选供应商 B → B 的列表不含
3. RESTRICTED + HIDDEN/OFFLINE → 不出
4. RESTRICTED + 公示期满 → 仅标题壳（content 空 + titleOnly）
5. 合并排序：公开与定向混排按 isTop/publishDate 正确（单查询）

**冒烟（curl，:4001）**：发布 RESTRICTED 公告选湖南状元 → 登录其 token 调新端点可见；另选一家不可见；匿名调公开端点不可见。

**视觉验收（用户要求真实渲染截图，非通过率）**
- :3004 湖南状元登录：公告中心出现该公告 + 「定向」徽章 + 详情可开
- 换未入选供应商登录：看不到
- 匿名公告中心 / :3002 门户：不出现
- 既有公开公告列表渲染回归对比

## 开放问题

无。
