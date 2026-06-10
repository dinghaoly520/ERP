# 供应商管理模块设计文档

## 1. 概述

### 1.1 文档目的

本文档定义"智慧水发 · ERP体系下一期智慧招采平台"中供应商管理模块的技术设计方案，作为后续开发实施的依据。

### 1.2 建设范围

本期建设包含以下功能：
- 供应商注册
- 供应商库管理
- 信息变更管理
- 供应商评价

### 1.3 技术栈

- 后端：NestJS + Prisma + PostgreSQL
- 前端：Next.js 16 + React 19 + Tailwind CSS + Framer Motion
- 认证：JWT + Cookie

---

## 2. 数据模型设计

### 2.1 Supplier 主表

```prisma
enum SupplierStatus {
  PENDING      // 待审核
  RETURNED     // 退回补正
  APPROVED     // 审核通过/已入库
  REJECTED     // 审核不通过
  DISABLED     // 停用
  BLACKLIST    // 黑名单
}

model Supplier {
  id                 String            @id @default(cuid())
  userId             String            @unique  // 关联User表，供应商登录账号
  name               String            // 企业名称
  normalizedName     String            @unique  // 标准化名称（用于查重）
  creditCode         String            @unique  // 统一社会信用代码
  enterpriseType     String            // 企业类型：国有/民营/外资等
  legalPerson        String            // 法定代表人
  registeredAddress  String            // 注册地址
  businessScope      String            // 经营范围
  status             SupplierStatus    @default(PENDING)
  classificationId   String?           // 供应商分类
  rejectReason       String?           // 拒绝原因
  returnReason       String?           // 退回原因
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  user               User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  classification     SupplierClassification? @relation(fields: [classificationId], references: [id])
  contacts           SupplierContact[]
  qualifications     SupplierQualification[]
  evaluations        SupplierEvaluation[]
  changeRecords      SupplierChangeRecord[]

  @@index([status])
  @@index([creditCode])
}
```

### 2.2 SupplierContact 联系人表

```prisma
model SupplierContact {
  id          String   @id @default(cuid())
  supplierId  String
  name        String   // 联系人姓名
  phone       String   // 手机号
  email       String?  // 邮箱
  isPrimary   Boolean  @default(false)  // 是否主要联系人
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  supplier    Supplier @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@index([supplierId])
}
```

### 2.3 SupplierQualification 资质材料表

```prisma
model SupplierQualification {
  id          String    @id @default(cuid())
  supplierId  String
  type        String    // 资质类型：营业执照/资质证书/授权书等
  name        String    // 资质名称
  fileUrl     String    // 文件路径
  validFrom   DateTime? // 有效期起
  validTo     DateTime? // 有效期止
  status      String    @default("有效")  // 有效/即将过期/已过期
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  supplier    Supplier  @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@index([supplierId])
  @@index([validTo])
}
```

### 2.4 SupplierClassification 供应商分类表

```prisma
model SupplierClassification {
  id          String   @id @default(cuid())
  name        String   @unique  // 分类名称
  code        String   @unique  // 分类代码
  description String?  // 描述
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  suppliers   Supplier[]
}
```

### 2.5 SupplierEvaluation 供应商评价表

```prisma
model SupplierEvaluation {
  id                  String    @id @default(cuid())
  supplierId          String
  projectId           String?   // 关联采购项目（可选）
  evaluatorId         String    // 评价人ID
  score               Decimal   @db.Decimal(5, 1)  // 总分
  level               String    // A/B/C/D等级
  completenessScore   Decimal   @db.Decimal(5, 1)  // 资料完整性得分(20%)
  responsivenessScore Decimal   @db.Decimal(5, 1)  // 文件响应得分(30%)
  cooperationScore    Decimal   @db.Decimal(5, 1)  // 配合情况得分(20%)
  complianceScore     Decimal   @db.Decimal(5, 1)  // 合规情况得分(20%)
  overallScore        Decimal   @db.Decimal(5, 1)  // 综合评价得分(10%)
  comment             String?   // 评价意见
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  supplier            Supplier  @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@index([supplierId])
  @@index([evaluatorId])
}
```

### 2.6 SupplierChangeRecord 信息变更记录表

```prisma
enum ChangeStatus {
  PENDING   // 待审核
  APPROVED  // 已通过
  REJECTED  // 已拒绝
}

model SupplierChangeRecord {
  id          String        @id @default(cuid())
  supplierId  String
  fieldName   String        // 变更字段名
  fieldLabel  String        // 字段显示名称
  oldValue    String?       // 旧值
  newValue    String?       // 新值
  reason      String?       // 变更原因
  status      ChangeStatus  @default(PENDING)
  reviewedBy  String?       // 审核人ID
  reviewedAt  DateTime?     // 审核时间
  rejectReason String?      // 拒绝原因
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  supplier    Supplier      @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@index([supplierId])
  @@index([status])
}
```

### 2.7 Notification 通知表

```prisma
model Notification {
  id        String   @id @default(cuid())
  userId    String   // 接收用户ID
  type      String   // 通知类型
  title     String   // 标题
  content   String   // 内容
  isRead    Boolean  @default(false)
  link      String?  // 跳转链接
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, isRead])
}
```

### 2.8 User 表扩展

在现有 User 模型中添加关联：

```prisma
model User {
  // ... 现有字段
  supplier            Supplier?
  notifications       Notification[]
  supplierEvaluations SupplierEvaluation[]
}
```

---

## 3. API 接口设计

### 3.1 供应商注册相关

| 端点 | 方法 | 说明 | 认证 |
|---|---|---|---|
| `/supplier/register` | POST | 供应商注册 | 无 |
| `/supplier/register/status` | GET | 查询注册状态 | 供应商 |
| `/supplier/register/resubmit` | POST | 重新提交 | 供应商 |

### 3.2 供应商库管理

| 端点 | 方法 | 说明 | 认证 |
|---|---|---|---|
| `/supplier/list` | GET | 供应商列表 | procurement_staff/admin |
| `/supplier/:id` | GET | 供应商详情 | 认证用户 |
| `/supplier/:id/approve` | POST | 审核通过 | procurement_staff/admin |
| `/supplier/:id/reject` | POST | 审核不通过 | procurement_staff/admin |
| `/supplier/:id/return` | POST | 退回补正 | procurement_staff/admin |
| `/supplier/:id/status` | PATCH | 更新状态 | admin |
| `/supplier/export` | GET | 导出数据 | procurement_staff/admin |

### 3.3 信息变更管理

| 端点 | 方法 | 说明 | 认证 |
|---|---|---|---|
| `/supplier/:id/changes` | GET | 变更记录列表 | supplier/procurement_staff |
| `/supplier/:id/changes` | POST | 提交变更申请 | supplier |
| `/supplier/changes/:changeId/approve` | POST | 审核变更 | procurement_staff/admin |
| `/supplier/changes/:changeId/reject` | POST | 拒绝变更 | procurement_staff/admin |

### 3.4 资质材料管理

| 端点 | 方法 | 说明 | 认证 |
|---|---|---|---|
| `/supplier/:id/qualifications` | GET | 资质材料列表 | supplier/procurement_staff |
| `/supplier/:id/qualifications` | POST | 上传资质材料 | supplier |
| `/supplier/:id/qualifications/:qid` | DELETE | 删除资质材料 | supplier |

### 3.5 供应商评价

| 端点 | 方法 | 说明 | 认证 |
|---|---|---|---|
| `/supplier/:id/evaluations` | GET | 评价记录列表 | procurement_staff/admin/leader |
| `/supplier/:id/evaluations` | POST | 发起评价 | procurement_staff/admin |
| `/supplier/evaluations/stats` | GET | 评价统计 | procurement_staff/admin/leader |

### 3.6 分类管理

| 端点 | 方法 | 说明 | 认证 |
|---|---|---|---|
| `/supplier/classifications` | GET | 分类列表 | admin |
| `/supplier/classifications` | POST | 创建分类 | admin |
| `/supplier/classifications/:id` | PATCH | 更新分类 | admin |
| `/supplier/classifications/:id` | DELETE | 删除分类 | admin |

### 3.7 通知管理

| 端点 | 方法 | 说明 | 认证 |
|---|---|---|---|
| `/notifications` | GET | 通知列表 | 认证用户 |
| `/notifications/unread-count` | GET | 未读数量 | 认证用户 |
| `/notifications/:id/read` | POST | 标记已读 | 认证用户 |

---

## 4. 权限设计

### 4.1 角色定义

| 角色 | 说明 |
|---|---|
| admin | 系统管理员 |
| procurement_staff | 采购中心员工 |
| supplier | 供应商用户 |
| leader | 领导用户 |

### 4.2 权限守卫

**SupplierGuard** - 供应商权限守卫
- 检查用户角色是否为 `supplier`
- 检查供应商状态是否为 `APPROVED`

**ProcurementGuard** - 采购中心权限守卫
- 检查用户角色是否为 `procurement_staff` 或 `admin`

**OwnerGuard** - 数据所有权守卫
- 检查供应商用户只能操作自己的数据

### 4.3 权限矩阵

| 功能 | supplier | procurement_staff | admin | leader |
|---|:---:|:---:|:---:|:---:|
| 供应商注册 | ✓ | 查看 | 配置 | 统计 |
| 注册审核 | - | ✓ | ✓ | 查看 |
| 企业信息维护 | 仅本人 | 查看/审核 | 配置 | 查看 |
| 供应商库查询 | 仅本人 | ✓ | ✓ | ✓ |
| 状态调整 | - | ✓ | ✓ | 查看 |
| 供应商评价 | 可配置 | ✓ | 配置 | 查看 |
| 数据导出 | - | ✓ | ✓ | ✓ |

---

## 5. 业务流程设计

### 5.1 供应商注册流程

```
1. 供应商填写注册信息
   ↓
2. 系统校验（creditCode重复、必填项、格式）
   ↓
3. 创建 User（role=supplier, isActive=false）
   创建 Supplier（status=PENDING）
   创建 SupplierContact
   创建 SupplierQualification
   ↓
4. 发送通知给采购中心员工
   ↓
5. 采购中心审核
   ├─ 通过 → Supplier.status=APPROVED, User.isActive=true
   ├─ 退回 → Supplier.status=RETURNED, 记录退回原因
   └─ 拒绝 → Supplier.status=REJECTED, 记录拒绝原因
   ↓
6. 发送通知给供应商
```

### 5.2 信息变更流程

```
1. 供应商提交变更申请
   ↓
2. 创建 SupplierChangeRecord（status=PENDING）
   ↓
3. 采购中心审核
   ├─ 通过 → 更新Supplier字段, status=APPROVED
   └─ 拒绝 → status=REJECTED
   ↓
4. 发送通知给供应商
```

### 5.3 供应商评价流程

```
1. 采购中心员工发起评价
   ↓
2. 填写各项评分：
   - 资料完整性（20%）
   - 文件响应（30%）
   - 配合情况（20%）
   - 合规情况（20%）
   - 综合评价（10%）
   ↓
3. 计算总分并确定等级：
   - ≥90分 → A级
   - 80-89分 → B级
   - 60-79分 → C级
   - <60分 → D级
   ↓
4. 创建 SupplierEvaluation 记录
```

---

## 6. 前端 UI 设计

### 6.1 页面路由

```
app/(dashboard)/supplier/
├── page.tsx                 # 供应商库列表
├── register/page.tsx        # 供应商注册
├── [id]/
│   ├── page.tsx            # 供应商详情
│   ├── edit/page.tsx       # 信息变更
│   ├── qualifications/     # 资质材料
│   ├── evaluations/        # 评价记录
│   └── changes/            # 变更记录
├── audit/page.tsx          # 注册审核
├── classifications/        # 分类管理
└── stats/                  # 供应商统计
```

### 6.2 UI 组件风格

参照 `procurement-ui` 项目设计：
- 使用 `AppShell` 组件作为主布局
- 采用 `framer-motion` 实现动画
- 使用 Tailwind CSS Glass 风格样式
- 导航项配置在 `app-shell.tsx` 的 `navItems` 中

### 6.3 导航配置

```tsx
{
  key: "supplier",
  label: "供应商管理",
  href: "/supplier",
  icon: Building2,
  meta: "供应商库与审核",
  roles: ["admin", "procurement_staff", "leader"] as const,
}
```

---

## 7. 错误处理设计

### 7.1 业务错误码

| 错误码 | 说明 |
|---|---|
| DUPLICATE_CREDIT_CODE | 统一社会信用代码已存在 |
| DUPLICATE_NAME | 企业名称已存在 |
| INVALID_STATUS | 状态不允许此操作 |
| FORBIDDEN | 无权操作 |
| NOT_FOUND | 供应商不存在 |
| QUALIFICATION_EXPIRED | 资质已过期 |

### 7.2 错误响应格式

```json
{
  "error": "错误描述",
  "code": "ERROR_CODE"
}
```

---

## 8. 通知设计

### 8.1 通知场景

| 场景 | 接收对象 | 通知方式 |
|---|---|---|
| 注册提交成功 | 采购中心 | 站内消息 |
| 审核通过 | 供应商 | 站内消息 + 短信 |
| 审核退回 | 供应商 | 站内消息 + 短信 |
| 审核不通过 | 供应商 | 站内消息 |
| 变更审核结果 | 供应商 | 站内消息 |
| 状态调整 | 供应商 | 站内消息 |
| 资质即将过期 | 供应商 + 采购中心 | 站内消息 |

---

## 9. 文件上传设计

### 9.1 资质材料上传规则

- 格式限制：PDF、Word、图片（jpg/png）
- 单文件大小：≤ 10MB
- 存储路径：`/uploads/suppliers/{supplierId}/qualifications/`
- 文件命名：`{timestamp}_{originalName}`

---

## 10. 开发计划

### 10.1 第一阶段：数据模型与基础API

1. 创建 Prisma 数据模型
2. 执行数据库迁移
3. 创建 SupplierModule、NotificationModule
4. 实现基础 CRUD 接口

### 10.2 第二阶段：业务逻辑实现

1. 实现注册流程
2. 实现审核流程
3. 实现信息变更流程
4. 实现评价功能
5. 实现通知服务

### 10.3 第三阶段：前端页面开发

1. 创建供应商库列表页
2. 创建供应商注册页
3. 创建供应商详情页
4. 创建审核页面
5. 创建评价页面
6. 创建分类管理页面

### 10.4 第四阶段：集成测试

1. 端到端流程测试
2. 权限测试
3. 边界条件测试
4. 性能测试

---

## 11. 附录

### 11.1 评价等级标准

| 等级 | 分值范围 | 说明 |
|---|---|---|
| A | ≥90分 | 表现优秀 |
| B | 80-89分 | 表现良好 |
| C | 60-79分 | 表现一般 |
| D | <60分 | 表现较差 |

### 11.2 企业类型枚举

- 国有企业
- 民营企业
- 外资企业
- 合资企业
- 个体工商户
- 其他

### 11.3 资质类型枚举

- 营业执照
- 资质证书
- 授权委托书
- 安全生产许可证
- ISO认证证书
- 其他
