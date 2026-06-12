# 开发者 A 实施计划 — 关键实现与 UI 协调方案

> 基于《招采ERP两人开发分配方案》开发者A职责，结合代码库现状分析

---

## 一、现状评估

### 已完成的模块（骨架已搭建，可用）

| 模块 | 后端 | 前端 | 状态 |
|---|---|---|---|
| 供应商注册/审核 | ✅ supplier.service 完整 | ✅ web/supplier + public-portal 注册 | 列表、审核弹窗、筛选、分页齐全 |
| 供应商详情 | ✅ API 完整 | ⚠️ web/supplier/[id] 仅占位 | **需补全详情页** |
| 供应商门户布局 | — | ✅ MainLayout + Dashboard | 侧边栏、头部、工作台完整 |
| 企业信息 | ✅ API 完整 | ✅ supplier-portal/profile | 展示+状态提示完整 |
| 公告管理 | ✅ API 完整 | ✅ web/notice 列表+发布+详情弹窗 | 完整可用 |
| 通知模块 | ✅ notification.service | ✅ supplier-portal 通知组件 | Web 端 NotificationBell 已接入 |
| 公开门户首页 | — | ✅ public-portal Hero+公告+注册登录 | 完整可用 |

### 需要重点推进的模块

| 模块 | 缺口 | 优先级 |
|---|---|---|
| 供应商详情页 (web) | 只有路由，页面未实现 | P0 |
| 资质管理 | 后端 CRUD 在，前端 supplier-portal 有页面但缺 web 端管理 | P0 |
| 联系人管理 | 同上 | P1 |
| 信息变更审批 | 后端有，web 端无审批页面 | P0 |
| 履约评价 | 后端 createEvaluation 存在，前后端页面需完善 | P1 |
| 公告详情独立页 (public-portal) | 仅占位路由 | P1 |
| 供应商分类管理 | 后端有，web 端无独立管理入口 | P2 |
| Dashboard 统计卡片 | B 提供壳子，A 需提供供应商/公告数据 API | P0 |

---

## 二、关键实现清单

### 🔴 P0 — 核心业务闭环（第1-2周）

#### 1. 供应商详情页 (`apps/web/src/app/(dashboard)/supplier/[id]/page.tsx`)

**当前状态**：路由存在，页面占位
**需要实现**：
- 企业基本信息展示（el-descriptions 风格 → 用 Tailwind 复刻）
- 状态标签 + 操作按钮（审核通过/退回/拒绝/停用/黑名单）
- 联系人列表 Tab
- 资质文件列表 Tab（含有效期提醒）
- 变更记录 Tab
- 履约评价历史 Tab
- 顶部快捷操作栏（分类分配、状态变更）

**关键 API**：
```
GET    /suppliers/:id          → 基本信息 + contacts + qualifications
GET    /suppliers/:id/changes  → 变更记录
GET    /suppliers/:id/evaluations → 评价历史
PATCH  /suppliers/:id/status   → 状态变更
```

#### 2. 供应商管理端信息变更审批

**当前状态**：后端 `createChangeRequest` + `reviewChange` 存在，web 端无审批页面
**需要实现**：
- 变更记录列表页（含筛选：待审批/已通过/已拒绝）
- 变更详情审批弹窗（新旧值对比 + 审批操作）
- 在供应商详情页内嵌变更记录 Tab

#### 3. Dashboard 供应商/公告统计 API

**当前状态**：Dashboard 页面壳子由 B 维护
**需要提供**：
```
GET /suppliers/stats  → { total, pending, approved, disabled, blacklist, classificationDistribution[] }
GET /announcements/stats → { total, published, bidNotice, winNotice, policy }
GET /suppliers/expiring-qualifications → 资质即将到期列表（Dashboard 卡片用）
```

#### 4. 公开门户公告详情页

**当前状态**：`/announcements` 路由占位
**需要实现**：
- 公告详情页（标题、类型标签、内容渲染、浏览量、发布日期）
- 公告列表页（分页、类型筛选、搜索）

---

### 🟡 P1 — 体验完善（第3周）

#### 5. 供应商门户体验打磨

**资质管理** (`supplier-portal/views/profile/Qualifications.vue`)
- 添加"新增资质"弹窗（类型选择、文件上传、有效期）
- 资质状态标签：有效/即将到期/已过期
- 文件预览功能

**联系人管理** (`supplier-portal/views/profile/Contacts.vue`)
- 增删改联系人
- 主联系人标记切换

**投标列表** (`supplier-portal/views/bid/`)
- 对接 B 提供的 `GET /supplier-portal/bid-submissions` API
- 投标详情 + 投递文件上传交互

#### 6. 履约评价体系

**管理端**（web）：
- 评价列表页（按供应商/项目/等级筛选）
- 创建评价弹窗（评分维度：完整性/响应速度/合作质量/合规性）
- 评价详情展示

**供应商端**（supplier-portal）：
- 评价记录列表（只读）
- 评价详情弹窗

#### 7. 供应商分类管理

- web 端新增分类管理页面（分类列表 + 增删改）
- 供应商列表增加"分配分类"操作
- 供应商详情页显示当前分类 + 更换分类

---

### 🟢 P2 — 收口优化（第4周）

#### 8. Upload 文件上传服务完善
- 统一文件上传返回结构
- 资质文件上传预览
- 标书文件上传进度（与 B 联调）

#### 9. 通知触发完善
- 供应商审核通过/退回/拒绝时自动发通知（后端已有 NotificationService）
- 公告发布时通知已入库供应商
- 资质即将到期提醒

#### 10. 共享资源维护
- `@water-erp/shared` 补充缺失的类型导出
- 确认所有状态枚举、颜色映射与 constants.ts 同步

---

## 三、🎨 UI 设计协调方案（重点）

> **核心目标**：三个门户（public-portal、supplier-portal、web 管理端）风格统一、品牌一致、体验互融。

### 3.1 设计语言体系

当前各门户存在**视觉断层**，需要建立统一设计语言：

#### 问题诊断

| 问题 | 位置 | 现状 | 目标 |
|---|---|---|---|
| **品牌色不统一** | web 用 `#064ea2`，supplier-portal 用 `#0a5eb8` 渐变，public-portal 用 `#064ea2` | 三处品牌色接近但不一致 | 统一主色为 `#064ea2`，辅助色为 `#0891b2`（青） |
| **侧边栏风格断裂** | web 是深色 oklch 平面侧边栏，supplier-portal 是蓝色渐变侧边栏 | 风格完全不同 | **可以不同**（管理端 vs 供应商端定位不同），但需确保圆角、间距、字体层级一致 |
| **圆角标准不同** | web 用 `rounded-xl`(12px)，supplier-portal 用 `8px`，public-portal 用 `rounded-lg`(8px) | 不一致 | 统一圆角：卡片 `12px`，按钮 `8px`，弹窗 `16px`，输入框 `6px` |
| **状态标签不同** | web 用 inline style 颜色，supplier-portal 用 CSS class | 实现方式不同但视觉可统一 | 统一状态色板，见下方色板定义 |
| **字体层级不同** | web 用 oklch 色值，supplier-portal 用 CSS 变量 | 表现一致但代码风格不同 | 各端保持现有方案，但视觉输出要对齐 |

#### 统一色板定义（写入 shared/constants）

```typescript
// 🎯 品牌色
export const BRAND = {
  primary: '#064ea2',       // 主蓝 — 按钮、链接、侧边栏高亮
  primaryHover: '#0e62d0',  // 主蓝悬浮
  secondary: '#0891b2',     // 辅助青 — 渐变终点、辅助标签
  navy: '#18243a',          // 深海军蓝 — 标题文字
} as const;

// 🎯 语义色（全平台统一）
export const SEMANTIC = {
  success: '#11a874',       // 通过/已入库/已发布
  warning: '#f5a623',       // 待审核/退回/即将到期
  danger: '#e74c3c',        // 拒绝/黑名单/异常
  info: '#5a6d8a',          // 草稿/已停用/辅助文字
} as const;

// 🎯 状态 → 颜色映射（替代各端分散的 statusMap）
export const STATUS_COLOR: Record<string, { color: string; bg: string }> = {
  // 供应商状态
  PENDING:    { color: '#f5a623', bg: '#f5a62318' },
  RETURNED:   { color: '#e67e22', bg: '#e67e2218' },
  APPROVED:   { color: '#11a874', bg: '#11a87418' },
  REJECTED:   { color: '#e74c3c', bg: '#e74c3c18' },
  DISABLED:   { color: '#95a5a6', bg: '#95a5a618' },
  BLACKLIST:  { color: '#c0392b', bg: '#c0392b18' },
  // 公告状态
  DRAFT:      { color: '#8a9aaa', bg: '#8a9aaa18' },
  PUBLISHED:  { color: '#11a874', bg: '#11a87418' },
  ARCHIVED:   { color: '#5a6d8a', bg: '#5a6d8a18' },
};
```

### 3.2 跨门户视觉协调策略

三个门户**定位不同**，不需要完全一样，但需要在以下方面协调：

#### 🏛️ 公共基础元素（必须一致）

| 元素 | 规范 |
|---|---|
| **品牌 Logo** | 同一 SVG/JPG，`/assets/logo.jpg` |
| **品牌名称** | "四川水发集团" + "SICHUAN WATER DEVELOPMENT GROUP CO.,LTD." 字体和大小一致 |
| **主按钮** | `bg-[#064ea2] text-white rounded-[8px] font-semibold hover:bg-[#0e62d0]` |
| **状态标签** | 统一使用 `STATUS_COLOR` 映射，`text-xs font-semibold px-2 py-0.5 rounded` |
| **卡片容器** | `bg-white rounded-[12px] border border-[#e5ecf4] p-5~7` |
| **表格表头** | `text-sm text-[#5a6d8a] border-b py-3 px-5 text-left` |
| **弹窗遮罩** | `bg-black/30 backdrop-blur-[2px]` |
| **分页器** | 统一样式：`px-3 py-1 text-xs border rounded` |

#### 🔄 各门户差异化（允许且鼓励）

| 门户 | 侧边栏 | 整体氛围 | 允许的独特性 |
|---|---|---|---|
| **public-portal** (Next.js) | 无侧边栏，顶部导航 | 营销感、大气 | Hero 动画、渐变弧线、CTA 按钮风格 |
| **supplier-portal** (Vue) | 蓝青渐变侧边栏 | 温暖服务感 | Element Plus 组件、ProfileCompleteness 环形图 |
| **web 管理端** (Next.js) | 深色 oklch 侧边栏 | 专业严谨 | 数据驾驶舱、密集表格、统计卡片 |

#### 🎯 页面级协调要点

**1. 供应商列表 → 供应商详情（web）**

列表页已有良好基础。详情页需要：
- 顶部：企业名称 + 头像首字 + 状态标签（与列表标签色一致）
- Tab 导航：基本信息 | 联系人 | 资质 | 变更记录 | 评价
- 每个 Tab 面板使用统一的卡片容器 + descriptions 布局
- 操作按钮固定在页面顶部右侧

**2. 供应商门户 → 管理端（信息对称）**

供应商在 `supplier-portal` 提交的信息变更，需要在 `web` 管理端审批。
两端必须保证：
- 字段名完全一致（后端 DTO → 前端展示）
- 状态流转可视化一致（时间线/步骤条）
- 审批结果通知自动触发

**3. 公开门户 → 供应商门户（品牌连贯）**

用户从 public-portal 注册后跳转到 supplier-portal，需要保证：
- 注册表单字段一致（企业名称、信用代码、手机号、密码）
- 登录后 landing 页风格衔接
- Logo、品牌色、字体权重保持连贯感

### 3.3 实施步骤 — UI 协调

#### Phase 1: 建立共享设计 Token（1天）

1. 在 `@water-erp/shared/constants.ts` 补充 `BRAND`、`SEMANTIC`、`STATUS_COLOR` 导出
2. 各门户页面中分散的 `statusMap`、`typeMap` 替换为 shared 导出的统一映射
3. 公共 CSS 变量定义（supplier-portal 已有 `--sp-primary` 等，web 端需要对齐）

#### Phase 2: 逐一统一页面（随功能开发同步）

每新建一个页面时，遵循以下检查清单：

```
□ 使用 shared/constants 的颜色映射，不自定义 statusMap
□ 卡片容器用 rounded-xl border-[#e5ecf4] bg-white
□ 主按钮用 bg-[#064ea2] rounded-lg
□ 状态标签用 STATUS_COLOR[status]
□ 弹窗遮罩用 bg-black/30
□ 表格表头用 text-[#5a6d8a] border-b
□ 字体：标题 font-bold text-[#18243a]，正文 text-[#333]，辅助 text-[#5a6d8a]/[#8a96aa]
□ 间距：页内 padding p-6，卡片间距 gap-4~5
```

#### Phase 3: 视觉审查（第4周收口）

- 截图对比三个门户的：状态标签、按钮、卡片、弹窗、表格
- 确认颜色在不同屏幕亮度下的可读性
- 确认移动端响应式表现

### 3.4 组件复用策略

| 复用类型 | 方案 | 示例 |
|---|---|---|
| **跨门户常量** | `@water-erp/shared/constants.ts` | STATUS_COLOR、BRAND |
| **跨门户类型** | `@water-erp/shared/types.ts` | Supplier、Announcement |
| **跨 Next.js 门户组件** | 未来可抽 `@water-erp/ui` 包 | StatusTag、DataTable、ConfirmDialog |
| **Vue 门户组件** | supplier-portal 内部组件库 | SkeletonCard、CountdownTimer |
| **当前阶段** | 不急于抽包，先在各端保持视觉一致 | 各端 copy 同样的 Tailwind class |

---

## 四、时间线总览

```
Week 1 ──────────────────────────────────────────────
  Day 1-2: 供应商详情页 (web) + shared 设计 Token 统一
  Day 3-4: 信息变更审批 (web) + 供应商分类管理
  Day 5:   Dashboard 统计 API + 卡片数据对接

Week 2 ──────────────────────────────────────────────
  Day 1-2: 公开门户公告详情页 + 列表页
  Day 3-4: 履约评价体系（管理端 + 供应商端）
  Day 5:   通知触发完善（审核/公告/资质到期）

Week 3 ──────────────────────────────────────────────
  Day 1-2: 供应商门户体验打磨（资质/联系人）
  Day 3-4: 投标列表对接 B 的 API + 文件上传联调
  Day 5:   跨门户视觉审查 + 状态标签统一替换

Week 4 ──────────────────────────────────────────────
  Day 1-2: Upload 服务完善 + 标书文件联调
  Day 3-4: 收口测试 + 边界 case 处理
  Day 5:   全流程验收（注册→审核→入库→投标→评价）
```

---

## 五、关键交叉点对接节奏

| 交叉点 | A 的准备 | 需要 B 提供什么 | 联调时间 |
|---|---|---|---|
| 投标提交 | supplier-portal 投标列表/详情页面 | `GET /supplier-portal/bid-submissions` API 契约 | Week 3 |
| Dashboard | 供应商/公告统计 API | Dashboard 页面壳 + 卡片插槽 | Week 1 |
| 通知触发 | `NotificationService` 方法 | B 在招标关键节点调用通知方法 | Week 2 |
| 导航菜单 | 供应商/公告菜单项需求 | B 合并到 web 导航配置 | Week 1 |

---

## 六、验收标准

### 业务闭环验收

- [ ] 供应商注册 → 审核（通过/退回/拒绝）→ 入库 → 分类 → 信息变更审批 → 履约评价 → 状态变更
- [ ] 公告草稿 → 发布 → 公开展示（public-portal）→ 归档
- [ ] 通知自动触发：审核结果、公告发布、资质到期
- [ ] Dashboard 展示供应商/公告统计数据

### UI 协调验收

- [ ] 三个门户的品牌色、状态标签色完全一致
- [ ] 卡片、按钮、弹窗圆角统一
- [ ] 公开门户注册 → 供应商门户登录，视觉衔接自然
- [ ] 移动端关键页面可用（公开门户、供应商门户）
- [ ] 无 oklch/hex 混用导致视觉不一致的情况

### 技术验收

- [ ] 所有跨门户类型定义在 `@water-erp/shared`
- [ ] 所有颜色映射使用 `@water-erp/shared/constants`
- [ ] 无各端自行定义的 statusMap/typeMap（已迁移到 shared）
- [ ] Prisma 跨域关系已确认，migration 已 review
