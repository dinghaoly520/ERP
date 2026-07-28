# 智慧水发·蜀水云采 ERP — 技术栈与端口概览

## 一、整体架构

- **Monorepo**：pnpm workspace（`pnpm@10.33`，Node 24），代码位于 `water-erp/`，TypeScript 6
- **后端一个、前端多门户**：NestJS 统一 API + 8 个独立前端应用，按角色 / 门户隔离会话
- **基础设施**（docker-compose）：PostgreSQL 16（:5432）、Redis 7（:6380）、MinIO 对象存储（:9000）
- **辅助服务**：Python FastAPI OCR 微服务（:8100）

## 二、技术栈

| 层 | 技术 |
|---|---|
| 后端 API | NestJS 11 + Prisma 6（PostgreSQL）、JWT + httpOnly Cookie 鉴权、BullMQ 队列、Socket.IO（开评标实时通信）、Swagger `/api/docs` |
| 前端主流（Next 系） | Next.js 16.2（App Router + Turbopack）+ React 19.2 + Tailwind CSS v4 |
| 供应商门户（Vue 系） | Vue 3.5 + Vite + Element Plus 2.14 + Pinia 3 + Vue Router |
| 共享包 | `@water-erp/config`（端口 / 路由）、`@water-erp/shared`（领域类型 / 状态枚举）、`@water-erp/ui`（工作台组件 + `cn`） |
| 动效 / 图标 | framer-motion、lucide-react（1.5px 描边） |
| 设计规范 | `.impeccable.md`：工业精密风、拟物凸起边框阴影系统、`rounded-2xl` 卡片；禁用渐变按钮 / emoji 图标 / Material 式投影 |

## 三、门户端口表

端口以 `packages/config/src/ports.ts` 为唯一真源。

| 端口 | 应用 | 目录 | 技术 | 访问角色 / Cookie |
|---|---|---|---|---|
| 4001 | API 后端 | `apps/api` | NestJS 11 + Prisma | — |
| 3002 | 信息门户 | `apps/public-portal` | Next.js | 公开，全系统登录入口 / `token_public` |
| 3003 | 采购商城 | `apps/mall` | Next.js | `mall` / `token_mall` |
| 3004 | 供应商门户 | `apps/supplier-portal` | Vue 3 | `supplier` / `token_supplier` |
| 3005 | 采购管理工作台 | `apps/web` | Next.js | `procurement_staff` / `token_web` |
| 3006 | 专家门户 | `apps/expert-portal` | Next.js | `bid_expert` / `token_expert` |
| 3007 | 开评标管理端 | `apps/bid-portal` | Next.js | `admin` / `bid_host`，共用 `token_web` |
| 3008 | 水叮当助手 | `apps/assistant` | Next.js | 公开免登录 |
| 3010 | 大屏 | `apps/bigscreen` | Next.js | 独立启动 `pnpm dev:bigscreen`（端口硬编码，不含在 `pnpm dev` 内） |

## 四、注意事项

- Next.js 16 默认 Turbopack，`dev` 脚本勿加 `--webpack`。
- 前端不做 mock 数据兜底，统一展示真实数据 / 加载态 / 空态。
