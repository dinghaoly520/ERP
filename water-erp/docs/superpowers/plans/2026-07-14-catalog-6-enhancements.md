# 集中目录管理 6 项增强 — 实现计划

> **Spec:** 口头确认 · **Date:** 2026-07-14 · **Tasks:** 6

**Goal:** 在现有 9 个 Tab 内嵌 6 项增强：仪表盘统计卡/附件预览/生命周期/国标映射、录入附件上传、价格预测+采购时机、预警规则表单、比价雷达+搜索洞察、采购清单+变更订阅

**Architecture:** 后端新增 3 个 Prisma 模型（CatalogItemAttachment / CatalogSearchLog / CatalogSubscription），修改 CatalogItem 新增 lifecycleStage + nationalStandard 字段；前端在目录管理 page.tsx 各 Tab 组件内增强，不新增 Tab、不改侧边栏

**Tech Stack:** NestJS 11 + Prisma 7 + PostgreSQL 16, React 19 + Tailwind CSS v4 + Recharts

## Global Constraints

- 不新增 Tab，不修改侧边栏
- 所有 UI 遵循 neumorphic raised-border 设计规范
- 目录管理 page.tsx（当前 ~720 行）保持可维护，增强逻辑控制在 +300 行内

---

## File Structure

### 后端
| File | Action | Purpose |
|------|--------|---------|
| `apps/api/prisma/schema.prisma` | Modify | 新增 CatalogItemAttachment / CatalogSearchLog / CatalogSubscription，CatalogItem 加字段 |
| `apps/api/src/catalog/catalog.service.ts` | Modify | 附件上传下载 / 搜索日志 / 订阅 / 预测 / 仪表盘聚合方法 |
| `apps/api/src/catalog/catalog.controller.ts` | Modify | 新端点 |
| `apps/api/src/catalog/dto.ts` | Modify | 新 DTO |

### 前端
| File | Action | Purpose |
|------|--------|---------|
| `apps/web/src/app/(main)/mall-management/catalog/page.tsx` | Modify | ItemsTab / TrendsTab / AlertsTab / SuppliersTab 增强 |
| `apps/web/src/components/catalog/PriceAlertRuleForm.tsx` | Create | 预警规则表单弹窗 |
| `apps/web/src/lib/api/catalog-admin.ts` | Modify | 新 API 客户端方法 |
| `apps/web/src/components/app-shell.tsx` | Modify | 目录管理 activeKey 更新 |

---

### Task 1: 数据模型升级 — 附件/搜索日志/订阅/生命周期/国标

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: 在 CatalogItem 模型新增 lifecycleStage 和 nationalStandard 字段**

在 `apps/api/prisma/schema.prisma` 的 CatalogItem 模型 `status` 字段后插入：

```prisma
  lifecycleStage    String    @default("有效")     // 草稿|待审核|有效|价格异常|即将过期|已下架|已归档
  nationalStandard  String?                         // 国标号，如 "GB/T 1499.2-2018"
```

- [ ] **Step 2: 新增三个模型在 CatalogItemRelation 之后**

```prisma
model CatalogItemAttachment {
  id            String      @id @default(cuid())
  catalogItemId String
  catalogItem   CatalogItem @relation(fields: [catalogItemId], references: [id], onDelete: Cascade)
  fileName      String
  fileUrl       String
  fileType      String      // IMAGE | PDF | CERTIFICATE | OTHER
  fileSize      Int
  uploadedAt    DateTime    @default(now())
  @@index([catalogItemId])
}

model CatalogSearchLog {
  id        Int      @id @default(autoincrement())
  keyword   String
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  @@index([keyword])
  @@index([createdAt])
}

model CatalogSubscription {
  id            Int          @id @default(autoincrement())
  userId        String
  user          User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  catalogItemId String
  catalogItem   CatalogItem  @relation(fields: [catalogItemId], references: [id], onDelete: Cascade)
  createdAt     DateTime     @default(now())
  @@unique([userId, catalogItemId])
}
```

在 User 模型末尾追加反向关系：

```prisma
  catalogSearchLogs       CatalogSearchLog[]
  catalogSubscriptions    CatalogSubscription[]
```

在 CatalogItem 模型末尾追加：

```prisma
  attachments       CatalogItemAttachment[]
  subscriptions     CatalogSubscription[]
```

- [ ] **Step 3: Push schema + regenerate Prisma Client**

```bash
cd apps/api && npx prisma db push
```

- [ ] **Step 4: 更新 CatalogItem 种子数据 lifecycleStage**

```bash
python3 -c "
import json
items = json.load(open('prisma/seed-data/CatalogItem.json'))
for i in items:
    i['lifecycleStage'] = i.get('status', '有效')
    i['nationalStandard'] = None
# Add GB standard for steel items
for i in items:
    if '钢材' in i.get('category',''): i['nationalStandard'] = 'GB/T 1499.2-2018'
    if '水泥' in i.get('category',''): i['nationalStandard'] = 'GB 175-2007'
    if '管材' in i.get('category',''): i['nationalStandard'] = 'GB/T 3091-2015'
json.dump(items, open('prisma/seed-data/CatalogItem.json', 'w'), ensure_ascii=False, indent=2)
print('updated')
"