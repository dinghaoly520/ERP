# 智慧水发招采 ERP 系统全栈重构设计文档

日期：2026-06-08

## 目标

将当前静态 HTML + Vue demo 招采系统重构为基于 Next.js + NestJS 的全栈真实可用系统。采用与 `procurement` 项目完全一致的技术栈和架构模式，新建独立 monorepo 项目 `water-erp`。

分阶段推进，每个阶段独立可用。Phase 1 完成全栈骨架和完整的开评标模块（6 个角色工作台全部有真实 CRUD），其余模块先做壳页面，后续阶段逐步填充。

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 包管理 | pnpm monorepo | 10.x |
| 前端 | Next.js + React + Tailwind CSS + shadcn/ui + React Query | Next 16, React 19, Tailwind 4 |
| 后端 | NestJS + Prisma | NestJS 11, Prisma 7 |
| 数据库 | PostgreSQL | 16 |
| 缓存 | Redis | 7 |
| 对象存储 | MinIO | latest |
| 认证 | Passport JWT + bcryptjs | — |
| 容器 | Docker Compose | — |

端口分配：Web 3002，API 4001，PostgreSQL 5432，Redis 6379，MinIO 9000/9001。

## 项目结构

```
water-erp/
├── apps/
│   ├── web/                        # Next.js 前端
│   │   └── src/
│   │       ├── app/                # App Router
│   │       │   ├── layout.tsx
│   │       │   ├── page.tsx        # 首页
│   │       │   ├── login/page.tsx
│   │       │   ├── bid/page.tsx            # 总览驾驶舱
│   │       │   ├── bid/submit/page.tsx     # 供应商端
│   │       │   ├── bid/open/page.tsx       # 开标主持端
│   │       │   ├── bid/evaluate/page.tsx   # 专家评标端
│   │       │   ├── bid/supervise/page.tsx  # 监督端
│   │       │   ├── bid/archive/page.tsx    # 归档端
│   │       │   ├── procurement/page.tsx    # 壳页面
│   │       │   ├── expert/page.tsx         # 壳页面
│   │       │   ├── supplier/page.tsx       # 壳页面
│   │       │   ├── mall/page.tsx           # 壳页面
│   │       │   ├── notice/page.tsx         # 壳页面
│   │       │   ├── evaluation/page.tsx     # 壳页面
│   │       │   └── about/page.tsx          # 壳页面
│   │       ├── components/
│   │       │   ├── app-shell.tsx           # 侧边栏 + 顶栏
│   │       │   ├── home/
│   │       │   │   ├── landing-home.tsx    # 未登录首页
│   │       │   │   └── dashboard-home.tsx  # 已登录首页
│   │       │   └── module-placeholder.tsx  # 壳页面组件
│   │       └── lib/
│   │           ├── api/                    # API 客户端函数
│   │           │   ├── auth.ts
│   │           │   └── bid.ts
│   │           ├── types/
│   │           │   ├── auth.ts
│   │           │   └── bid.ts
│   │           ├── utils.ts
│   │           └── login-routing.ts
│   └── api/                        # NestJS 后端
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── seed.ts
│       └── src/
│           ├── main.ts
│           ├── app.module.ts
│           ├── prisma/
│           │   ├── prisma.module.ts
│           │   └── prisma.service.ts
│           ├── auth/
│           │   ├── auth.module.ts
│           │   ├── auth.controller.ts
│           │   ├── auth.service.ts
│           │   ├── auth.guard.ts
│           │   ├── admin.guard.ts
│           │   ├── auth.types.ts
│           │   ├── current-user.decorator.ts
│           │   └── dto/
│           │       ├── login.dto.ts
│           │       └── register.dto.ts
│           └── bid/
│               ├── bid.module.ts
│               ├── bid.controller.ts
│               ├── bid.service.ts
│               └── dto/
│                   ├── create-bid-project.dto.ts
│                   ├── update-bid-project.dto.ts
│                   ├── submit-bid.dto.ts
│                   ├── create-score.dto.ts
│                   └── create-clarification.dto.ts
├── packages/
│   ├── config/
│   └── ui/
├── docker-compose.yml
├── pnpm-workspace.yaml
└── package.json
```

## Docker Compose

三个服务：PostgreSQL、Redis、MinIO。数据库 `water_erp`，用户 `water_erp`，密码 `water_erp_dev`。

## Prisma Schema（Phase 1）

基础表 + 开评标完整业务表。

### 基础表

- **Department**：id, name, code, 用户关联
- **User**：id, username, displayName, email, passwordHash, role, departmentId, isActive
- **Role**：通过 User.role 字段实现，值为 admin / internal_user / bid_host / bid_expert / bid_supervisor / supplier

### 开评标表

- **BidProject**：id, projectCode, name, procurementMethod, openTime, deadline, stage（download / submit / opening / evaluating / archived）, riskNote
- **BidSupplier**：id, projectId, supplierName, downloadStatus, submitStatus, encryptStatus, receiptNo, decryptStatus, confirmStatus
- **BidOpeningSession**：id, projectId, host, supervisor, status, decryptWindowStart, decryptWindowEnd, remainingSeconds
- **BidOpeningRecord**：id, sessionId, supplierName, amount, period, qualityTarget, bondStatus, decryptResult, confirmStatus
- **BidExpert**：id, projectId, name, major, signedIn, avoidanceConfirmed, progress, totalScore
- **BidScoreItem**：id, projectId, category（qualification / responsive / business / technical / price）, name, maxScore
- **BidScoreRecord**：id, expertId, scoreItemId, score, reason
- **BidClarification**：id, projectId, question, issuer, supplierName, status, reply
- **BidSupervisionLog**：id, projectId, time, role, target, action, result, riskFlag
- **BidArchiveItem**：id, projectId, name, ownerRole, status, hashDigest, archivedAt

## 认证

同 procurement 项目模式：

- POST `/auth/register`：注册，bcryptjs 哈希密码
- POST `/auth/login`：登录，返回 JWT
- GET `/auth/me`：获取当前用户
- JWT 通过 HttpOnly Cookie 传递
- 前端 Next.js middleware：未登录访问受保护路由时重定向 `/login`
- 后端 AuthGuard：保护 API 端点
- 后端 AdminGuard：保护管理端点

## 开评标 API 端点

```
# 认证
POST   /auth/login
POST   /auth/register
GET    /auth/me

# 项目 CRUD
GET    /bid/projects
POST   /bid/projects
GET    /bid/projects/:id
PATCH  /bid/projects/:id

# 供应商投递
GET    /bid/projects/:id/suppliers
POST   /bid/projects/:id/suppliers
POST   /bid/projects/:id/submit-bid

# 开标
POST   /bid/projects/:id/open
GET    /bid/projects/:id/opening-status
POST   /bid/projects/:id/decrypt/:supplierId
GET    /bid/projects/:id/opening-records

# 评标
GET    /bid/projects/:id/experts
POST   /bid/projects/:id/scores
GET    /bid/projects/:id/scores

# 监督
GET    /bid/projects/:id/supervision-logs

# 澄清
GET    /bid/projects/:id/clarifications
POST   /bid/projects/:id/clarifications

# 归档
GET    /bid/projects/:id/archives
POST   /bid/projects/:id/archive-all
```

## 前端页面设计

### 首页 `/`

- 未登录：公开首页（系统介绍、功能入口卡片、公告预览）
- 已登录：仪表盘（开评标项目状态、统计数据、快捷入口）

### 布局 `app-shell.tsx`

- 左侧边栏：首页、采购管理、开评标管理（6 个子菜单）、专家管理、供应商管理、电子商城、信息公告、评价管理、关于我们
- 顶栏：面包屑 + 用户信息 + 退出
- 主内容区：`<Outlet />` 子页面

### 开评标 6 个页面

- `/bid`：总览驾驶舱。指标卡片、项目列表表格、风险提醒、角色入口卡片。数据全部来自 API。
- `/bid/submit`：供应商端。安全组件信息卡片、下载前置步骤、受控下载表格、加密投递上传 + 进度条 + 回执表格。
- `/bid/open`：开标主持端。项目信息横幅 + 倒计时、解密状态表格、开标记录表格、异常处理面板。
- `/bid/evaluate`：专家评标端。进入步骤条、三栏布局（供应商列表 | 文件摘要 | 评分表）、评分输入 + 总分、澄清记录、报告确认。
- `/bid/supervise`：监督端。权限边界提示、时间线、异常列表、日志表格。
- `/bid/archive`：归档端。档案摘要 + 进度环、资料清单表格（状态标签）、缺失提醒、一键归档按钮。

### 壳页面

其余 7 个模块（procurement、expert、supplier、mall、notice、evaluation、about）使用统一的 `module-placeholder.tsx` 组件，显示模块名称、功能说明和"即将开通"提示。

## 阶段规划

| 阶段 | 内容 | 交付标准 |
|------|------|----------|
| Phase 1 | 全栈骨架 + 完整开评标模块 | 认证可用；6 个工作台全部有真实 CRUD；7 个模块壳页面可访问 |
| Phase 2 | 采购管理 + 供应商管理 | 立项、文件编审、供应商注册/审核/评价全流程 |
| Phase 3 | 专家管理 + 信息公告 | 专家库、抽取、评价；招标公告、中标公示 |
| Phase 4 | 电子商城 + 评价管理 + 关于我们 | 集中采购、员工内购、商家入驻；评价体系 |

## Next.js 配置

```js
// apps/web/next.config.ts
{
  rewrites: [
    { source: '/api/:path*', destination: 'http://localhost:4001/:path*' }
  ]
}
```

前端通过 `/api/*` 代理到 NestJS 后端，开发时无跨域问题。

## 不在 Phase 1 范围内

- 真实文件上传到 MinIO（Phase 1 投标文件用模拟数据）
- 真实文件加密和 CA 签章
- WebSocket 实时推送
- AI 辅助评审
- 与 OA、合同、档案等外部系统对接
- 国际化（仅中文）
