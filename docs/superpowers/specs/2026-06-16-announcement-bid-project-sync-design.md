# 公告发布 → 自动创建开评标项目 设计方案

**日期**: 2026-06-16
**状态**: 待审核

---

## 一、目标

采购管理端（web :3005）发布 BID_NOTICE 类型公告时，自动在开评标管理端（bid-portal :3007）创建对应的 BidProject，消除"先发公告再手动创建项目"的断裂流程。

---

## 二、整体架构

```
web :3005 /notice                      API                           bid-portal :3007 /bid
┌──────────────────────┐    ┌─────────────────────────┐    ┌──────────────────────┐
│ 新建 BID_NOTICE 公告   │    │ AnnouncementService      │    │ 项目列表自动出现       │
│ 填写结构化 metadata     │    │   publish() 触发          │    │ projectCode 自动生成   │
│ 上传加密招标文件        │───→│   → BidService            │───→│ 招标文件自动挂载       │
│ 点击「发布」            │    │     .createFromAnnouncement│    │ 来源标记"来自公告"     │
└──────────────────────┘    └─────────────────────────┘    └──────────────────────┘
                                      │
                                      ▼ 专家抽取下拉框自动可见（GET /bid/projects）
                             web :3005 /expert/extract
```

---

## 三、触发机制

### 3.1 触发条件

| 条件 | 说明 |
|---|---|
| 公告类型 | `BID_NOTICE` |
| 状态变更 | `DRAFT` → `PUBLISHED`（首次发布） |
| 幂等 | `relatedProjectCode` 已关联有效 BidProject 则跳过创建（不重复创建） |
| 草稿不触发 | 保存草稿（`DRAFT`）不创建项目 |
| 再次编辑已发布公告 | 不触发新建，仅更新已关联项目的 name/procurementMethod 等字段 |

### 3.2 不触发的情况

- WIN_NOTICE / POLICY / PLATFORM 类型公告发布
- 公告已关联的 BidProject 被手动删除后（relatedProjectCode 指向失效记录，跳过并记录日志）

---

## 四、数据模型变更

### 4.1 BidProject 新增字段

```prisma
model BidProject {
  // ... 现有字段保持不变
  budget        Decimal?   // 预算金额（元）
  scope         String?    // 采购内容/范围
  qualification String?    // 投标人资格要求
  contact       String?    // 联系方式
}
```

全部 nullable，兼容已有数据。需新增 Prisma migration。

### 4.2 字段映射表

| BidProject 字段 | 来源 | 缺省值 |
|---|---|---|
| `name` | `Announcement.title` | —（必填，公告已有校验） |
| `projectCode` | 自动生成 `BID-{Date.now()}` | — |
| `procurementMethod` | `metadata.method` | `'公开招标'` |
| `openTime` | `metadata.openTime` | `publishDate` 或当前时间 |
| `deadline` | `metadata.deadline` | `openTime + 7天` |
| `riskNote` | 固定值 | `'（来自公告自动创建）'` |
| `budget` | `metadata.budget` | `null` |
| `scope` | `metadata.scope` | `null` |
| `qualification` | `metadata.qualification` | `null` |
| `contact` | `metadata.contact` | `null` |
| `stage` | 固定值 | `DOWNLOAD` |

### 4.3 回写

创建 BidProject 后，自动更新以下关联数据：

| 目标 | 字段 | 值 |
|---|---|---|
| `Announcement` | `relatedProjectCode` | 自动生成的 `projectCode` |
| `BidDocument`（如存在） | `bidProjectId` | 新创建的 `BidProject.id` |

---

## 五、后端联动逻辑

### 5.1 AnnouncementService 变更

在 `publish` 或 `update` 逻辑中（status 变为 PUBLISHED 时），插入联动调用：

```
if (type === 'BID_NOTICE' && targetStatus === 'PUBLISHED') {
  // 幂等检查：已有有效关联则跳过
  const existing = await bidProject.findUnique({ where: { projectCode: relatedProjectCode } })
  if (!existing) {
    const project = await bidService.createFromAnnouncement(announcement, metadata)
    // 回写 relatedProjectCode
    await updateAnnouncement(id, { relatedProjectCode: project.projectCode })
    // 挂载招标文件
    if (bidDocument) {
      await bidDocument.update({ bidProjectId: project.id })
    }
  } else {
    // 已存在则同步更新名称/采购方式/时间等可编辑字段
    await bidService.syncFromAnnouncement(existing.id, announcement, metadata)
  }
}
```

### 5.2 BidService 新增方法

**`createFromAnnouncement(announcement, metadata)`**

```ts
async createFromAnnouncement(ann: Announcement, meta: Record<string, any>) {
  const projectCode = `BID-${Date.now()}`;
  const openTime = meta.openTime ? new Date(meta.openTime) : (ann.publishDate || new Date());
  const deadline = meta.deadline ? new Date(meta.deadline) : new Date(openTime.getTime() + 7 * 86400000);

  return this.prisma.bidProject.create({
    data: {
      name: ann.title,
      projectCode,
      procurementMethod: meta.method || '公开招标',
      openTime,
      deadline,
      riskNote: '（来自公告自动创建）',
      budget: meta.budget ? new Decimal(meta.budget) : null,
      scope: meta.scope || null,
      qualification: meta.qualification || null,
      contact: meta.contact || null,
      stage: 'DOWNLOAD',
    },
  });
}
```

**`syncFromAnnouncement(id, announcement, metadata)`** — 已发布公告再次编辑时同步更新项目字段（不改变 projectCode 和 stage）。

### 5.3 模块依赖

`AnnouncementModule` 需导入 `BidModule`（或通过共享 Service 注入）。检查当前模块结构，避免循环依赖。

---

## 六、删除公告行为

### 6.1 仅解除关联（不级联删除）

当 BID_NOTICE 公告被删除时：

1. **BidProject 保留**，`riskNote` 追加标记：
   ```
   原始值 + "（来源公告已删除）"
   ```
2. **BidDocument.bidProjectId** 置为 `null`（招标文件不再挂载到项目）
3. **Announcement 正常删除**

### 6.2 后续影响

- 公告删除后，BidProject 仍然在开评标端和专家抽取端可见可用
- 开评标主持人可继续使用该项目进行开标/评标/归档流程
- `riskNote` 中的标记提示项目来源已失效

---

## 七、专家抽取联动（零代码）

专家抽取页面（`/expert/extract`）的项目下拉框通过 `GET /bid/projects` 获取项目列表。公告发布自动创建的 BidProject 存入同一张表，因此：

- ✅ 新项目自动出现在专家抽取下拉框
- ✅ 项目详情（供应商列表、已分配专家）初始为空，随流程推进自然填充
- ✅ 供应商列表用于自动回避规则

**无需任何额外代码。**

---

## 八、前端变更

### 8.1 bid-portal `/bid` 页面 (`apps/bid-portal/.../bid/page.tsx`)

| 变更 | 说明 |
|---|---|
| "+创建项目"按钮保留 | 移至 DataToolbar 区域，文案改为"手动创建"，样式降级为次要按钮 |
| 项目列表新增"来源"列 | 显示标签：`来自公告`（绿色）/ `手动创建`（灰色） |
| 判断逻辑 | `riskNote` 包含 `来自公告自动创建` 则为公告来源 |

### 8.2 bid-portal 项目详情/编辑弹窗

| 变更 | 说明 |
|---|---|
| 展示新增字段 | budget / scope / qualification / contact 可查看可编辑 |
| 来源公告信息 | 如有 `relatedProjectCode`，展示关联公告标题和链接 |

### 8.3 web `/notice` 页面

| 变更 | 说明 |
|---|---|
| 发布成功提示 | 追加"已同步创建开评标项目 {projectCode}" |
| 已发布公告行 | 如有自动创建的项目，展示项目编号快捷链接 |
| 删除确认 | 提示"删除公告不会删除关联的开评标项目" |

---

## 九、涉及文件清单

| 层 | 文件 | 变更 |
|---|---|---|
| Schema | `apps/api/prisma/schema.prisma` | BidProject 新增 4 字段 |
| Migration | `apps/api/prisma/migrations/` | 新增 migration |
| DTO | `apps/api/src/bid/dto/create-bid-project.dto.ts` | 新增可选字段 |
| DTO | `apps/api/src/bid/dto/update-bid-project.dto.ts` | 新增可选字段 |
| Service | `apps/api/src/bid/bid.service.ts` | 新增 `createFromAnnouncement()` + `syncFromAnnouncement()` |
| Service | `apps/api/src/announcement/announcement.service.ts` | publish/update 中插入联动逻辑 |
| Module | `apps/api/src/announcement/announcement.module.ts` | 导入 BidModule |
| Seed | `apps/api/prisma/seed-data/BidProject.json` | 补充新字段默认值 `null` |
| Page | `apps/bid-portal/src/app/(dashboard)/bid/page.tsx` | 表格加"来源"列，按钮文案/位置调整 |
| Component | `apps/bid-portal/src/components/edit-project-dialog.tsx` | 展示新增字段 |
| Page | `apps/web/src/app/(dashboard)/notice/page.tsx` | 发布/删除提示文案调整 |
| API client | `apps/bid-portal/src/lib/api/bid.ts` | 类型补充新增字段 |

---

## 十、边界情况

| 场景 | 处理 |
|---|---|
| 公告无 metadata.openTime | 使用 publishDate 或当前时间 |
| 公告无 metadata.deadline | 使用 openTime + 7 天 |
| 公告无 metadata.method | 默认 `'公开招标'` |
| 公告已填写 projectCode 但数据库已有重复 | projectCode 始终自动生成，忽略公告填写值 |
| 公告发布后又被改为 DRAFT | 不删除已创建的 BidProject |
| BidProject 被手动删除后又发布同一条公告 | 幂等检查失败（relatedProjectCode 指向失效记录），重新创建 |
| 公告附件中包含招标文件但未上传 BidDocument | 正常，仅 BidDocument 表中有记录时才挂载 |
| 两个公告填了相同的 projectCode | 每个公告发布时 projectCode 独立自动生成，不会冲突 |
