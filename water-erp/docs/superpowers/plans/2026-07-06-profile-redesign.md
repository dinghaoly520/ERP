# 资料修改（/profile）Phase 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/web` (:3005) 的 `/profile` 路由重做：补齐真正的资料编辑能力（姓名/邮箱/部门），视觉统一到 `neu-*` 新拟态体系，用「顶部身份横幅 + 卡片网格 + 常驻表单卡」重排信息架构。

**Architecture:** 后端在 Auth 模块加两个端点（`PATCH /auth/me`、`GET /auth/departments`）并扩展 `me()` 返回值；前端把 486 行单文件拆成 `src/components/profile/` 下 6 个聚焦组件，全部使用 `globals.css` 已就绪的 `neu-*` 类。无 Prisma 迁移（所需字段已存在）。

**Tech Stack:** NestJS 11 + Prisma（后端）/ Next.js 16 App Router + React 19 + Tailwind v4（前端）/ supertest e2e（后端测试）/ 手动截图验证（前端，按用户偏好）。

## Global Constraints

- 后端角色 `AuthRole` 完整集合：`admin | leader | staff | procurement_staff | bid_host | bid_expert | supplier | mall`（来自 `apps/web/src/lib/api/auth.ts`）。:3005 登录用户主要是 `procurement_staff`，也可能是 `bid_host`/`admin`。
- `AuditModule` 是 `@Global()`，`AuthService` 可直接注入 `AuditService`，**无需改 `AuthModule` 的 imports**。
- 新拟态类已全部就绪在 `apps/web/src/app/globals.css`（`neu-btn-primary` / `neu-btn-soft` / `neu-btn-xs` / `neu-card-static` / `neu-input` / `neu-select` / `neu-icon-well`）。**禁止用内联 `style=` 覆盖阴影/渐变**（绕过 `:hover/:active` 三态）。
- 后端 e2e 用 `supertest`，登录 helper `loginAs(app, username, password, portal)` 已存在于 `apps/api/test/auth.e2e-spec.ts`。所有 e2e 用 `X-Portal: web` + procurement_staff 账号。
- 种子账号：`陈主任` / `czr@2026`（procurement_staff，:3005）。Department 表有 14 条种子。
- 前端无单元测试框架（项目惯例）；前端验证靠 `pnpm dev:web` 真实渲染截图。
- 不提交 git（用户会话规则：仅在明确要求时 commit）。每个 Task 末尾的 commit 步骤改为「暂存并等待用户确认是否提交」。

---

## File Structure

**后端（`apps/api/src/auth/`）**
- `dto/update-profile.dto.ts` — **新建** — `PATCH /auth/me` 的入参 DTO（class-validator）
- `auth.service.ts` — **改** — 扩展 `me()`、新增 `updateProfile()` / `listDepartments()`、注入 `AuditService`
- `auth.controller.ts` — **改** — 新增 `@Patch('me')` / `@Get('departments')`

**后端测试（`apps/api/test/`）**
- `auth.e2e-spec.ts` — **改** — 加 departments / patch-me / me-shape 用例

**后端审计（`apps/api/src/audit/`）**
- `audit.service.ts` — **改** — `AuditAction` 联合类型加 `PROFILE_UPDATE`

**前端 API 层（`apps/web/src/lib/api/`）**
- `auth.ts` — **改** — 扩展 `AuthUser` 类型；新增 `updateMyProfile()` / `fetchDepartments()`
- `audit-log.ts` — **改** — `AUDIT_ACTION_LABELS` 加 `PROFILE_UPDATE`

**前端组件（`apps/web/src/components/profile/` — 全部新建）**
- `profile-page.tsx` — 编排器：加载 user + departments，渲染 Hero + 卡片网格
- `profile-hero.tsx` — 身份横幅（只读 + 退出登录）
- `profile-edit-card.tsx` — 资料修改表单卡
- `profile-security-card.tsx` — 修改密码卡
- `profile-activity-card.tsx` — 操作记录卡
- `profile-preferences-card.tsx` — 偏好设置卡
- `role-labels.ts` — 完整 `AuthRole` → 中文映射（多组件复用）

**前端路由 & 清理**
- `src/app/(main)/profile/page.tsx` — **改** — import 指向新 `ProfilePage`
- `src/components/profile-page.tsx` — **删** — 旧的 486 行单文件

---

## Task 1: 后端 — 扩展 `me()` 返回值 + 新增 `PROFILE_UPDATE` 审计动作

**Files:**
- Modify: `apps/api/src/audit/audit.service.ts:5-14`（`AuditAction` 联合类型）
- Modify: `apps/api/src/auth/auth.service.ts:51-56`（`me()` 方法）
- Test: `apps/api/test/auth.e2e-spec.ts`（追加用例）

**Interfaces:**
- Produces: `AuthService.me()` 现在返回 `{ id, username, displayName, email, role, isActive, createdAt, departmentId, department: { id, name, code } | null }`。前端 Task 4 据此扩展 `AuthUser` 类型。

- [ ] **Step 1: 给 `AuditAction` 加 `PROFILE_UPDATE`**

修改 `apps/api/src/audit/audit.service.ts` 第 5-14 行的联合类型，在 `'SETTINGS_UPDATE'` 后追加：

```ts
export type AuditAction =
  | 'LOGIN'
  | 'LOGOUT'
  | 'PASSWORD_CHANGE_REQUEST'
  | 'PASSWORD_CHANGE_APPROVED'
  | 'PASSWORD_CHANGE_REJECTED'
  | 'PASSWORD_RESET_REQUEST'
  | 'PASSWORD_RESET_APPROVED'
  | 'PASSWORD_RESET_REJECTED'
  | 'SETTINGS_UPDATE'
  | 'PROFILE_UPDATE';
```

- [ ] **Step 2: 扩展 `me()` 返回 createdAt / departmentId / department**

修改 `apps/api/src/auth/auth.service.ts` 的 `me()` 方法（第 51-56 行）为：

```ts
  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        departmentId: true,
        department: { select: { id: true, name: true, code: true } },
      },
    });
  }
```

- [ ] **Step 3: 写失败的 e2e — `/me` 返回 createdAt 与 department 字段**

在 `apps/api/test/auth.e2e-spec.ts` 的 `describe('Auth (e2e)')` 块内（任意现有 `it(...>` 之后）追加：

```ts
  it('/api/auth/me (GET) — 返回 createdAt 与 department 字段', async () => {
    const cookie = await loginAs(app, '陈主任', 'czr@2026', 'web');
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .expect(200)
      .expect(res => {
        expect(res.body).toHaveProperty('createdAt');
        expect(res.body).toHaveProperty('departmentId');
        expect(res.body).toHaveProperty('department');
      });
  });
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/api && pnpm test:e2e -- auth`
Expected: PASS（含新用例）。若 `陈主任` 登录失败，确认 seed 已跑（`pnpm db:seed`）。

- [ ] **Step 5: 暂存，等待用户确认提交**

```bash
git add apps/api/src/audit/audit.service.ts apps/api/src/auth/auth.service.ts apps/api/test/auth.e2e-spec.ts
```
（不自动 commit；告知用户改动已暂存。）

---

## Task 2: 后端 — `GET /auth/departments` 部门列表端点

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`（新增 `listDepartments()`）
- Modify: `apps/api/src/auth/auth.controller.ts`（新增 `@Get('departments')`）
- Test: `apps/api/test/auth.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /auth/departments` → `Array<{ id: string; name: string; code: string | null }>`，按 `name` 升序。前端 Task 4 的 `fetchDepartments()` 据此。

- [ ] **Step 1: 写失败的 e2e — departments 端点**

在 `auth.e2e-spec.ts` 追加：

```ts
  it('/api/auth/departments (GET) — 未认证返回 401', () => {
    return request(app.getHttpServer())
      .get('/api/auth/departments')
      .expect(401);
  });

  it('/api/auth/departments (GET) — 已认证返回部门数组', async () => {
    const cookie = await loginAs(app, '陈主任', 'czr@2026', 'web');
    await request(app.getHttpServer())
      .get('/api/auth/departments')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .expect(200)
      .expect(res => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        expect(res.body[0]).toHaveProperty('id');
        expect(res.body[0]).toHaveProperty('name');
      });
  });
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/api && pnpm test:e2e -- auth`
Expected: 新用例 FAIL（404，端点未实现）。

- [ ] **Step 3: 在 `AuthService` 加 `listDepartments()`**

在 `apps/api/src/auth/auth.service.ts` 的 `me()` 方法之后追加：

```ts
  async listDepartments() {
    return this.prisma.department.findMany({
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }
```

- [ ] **Step 4: 在 `AuthController` 加 `@Get('departments')`**

在 `apps/api/src/auth/auth.controller.ts` 顶部 `@Controller('auth')` 之前补 import（若缺）：`import { Get, Patch, Body } from '@nestjs/common';`（`Get` 已有；确认 `Patch` 在 Task 3 一并加）。先加 `Get` 路由——在 `me()` 路由之后追加：

```ts
  @Get('departments')
  @ApiCookieAuth('token')
  @ApiOperation({ summary: '部门列表（用于资料修改下拉）' })
  listDepartments() {
    return this.authService.listDepartments();
  }
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd apps/api && pnpm test:e2e -- auth`
Expected: PASS。

- [ ] **Step 6: 暂存**

```bash
git add apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.controller.ts apps/api/test/auth.e2e-spec.ts
```

---

## Task 3: 后端 — `PATCH /auth/me` 更新资料

**Files:**
- Create: `apps/api/src/auth/dto/update-profile.dto.ts`
- Modify: `apps/api/src/auth/auth.service.ts`（注入 `AuditService`、新增 `updateProfile()`）
- Modify: `apps/api/src/auth/auth.controller.ts`（新增 `@Patch('me')`）
- Test: `apps/api/test/auth.e2e-spec.ts`

**Interfaces:**
- Produces: `PATCH /auth/me` 接收 `UpdateProfileDto { displayName?: string(1–32); email?: string|null; departmentId?: string|null }`，返回更新后的 `AuthUser`（同 `me()` 形状）。前端 Task 4 的 `updateMyProfile()` 据此。写一条 `PROFILE_UPDATE` 审计日志。

- [ ] **Step 1: 新建 DTO**

创建 `apps/api/src/auth/dto/update-profile.dto.ts`：

```ts
import { IsString, IsNotEmpty, IsOptional, IsEmail, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @IsOptional()
  displayName?: string;

  @IsEmail()
  @IsOptional()
  @IsString()
  email?: string | null;

  @IsString()
  @IsOptional()
  departmentId?: string | null;
}
```

- [ ] **Step 2: 写失败的 e2e — PATCH /auth/me 各场景**

在 `auth.e2e-spec.ts` 追加（覆盖：未认证 401、合法更新 200、非法邮箱 400、不存在部门 400、审计已写入）：

```ts
  it('/api/auth/me (PATCH) — 未认证返回 401', () => {
    return request(app.getHttpServer())
      .patch('/api/auth/me')
      .send({ displayName: 'x' })
      .expect(401);
  });

  it('/api/auth/me (PATCH) — 合法更新 displayName 并写审计', async () => {
    const cookie = await loginAs(app, '陈主任', 'czr@2026', 'web');
    const original = await request(app.getHttpServer())
      .get('/api/auth/me').set('Cookie', cookie).set('X-Portal', 'web');
    const before = original.body.displayName;

    await request(app.getHttpServer())
      .patch('/api/auth/me')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .send({ displayName: '陈主任(测试)' })
      .expect(200)
      .expect(res => {
        expect(res.body.displayName).toBe('陈主任(测试)');
      });

    // 审计日志已写入
    const audits = await prisma.auditLog.findMany({
      where: { userId: original.body.id, action: 'PROFILE_UPDATE' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(audits.length).toBe(1);

    // 还原
    await request(app.getHttpServer())
      .patch('/api/auth/me')
      .set('Cookie', cookie).set('X-Portal', 'web')
      .send({ displayName: before })
      .expect(200);
  });

  it('/api/auth/me (PATCH) — 非法邮箱返回 400', async () => {
    const cookie = await loginAs(app, '陈主任', 'czr@2026', 'web');
    await request(app.getHttpServer())
      .patch('/api/auth/me')
      .set('Cookie', cookie).set('X-Portal', 'web')
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('/api/auth/me (PATCH) — 不存在的 departmentId 返回 400', async () => {
    const cookie = await loginAs(app, '陈主任', 'czr@2026', 'web');
    await request(app.getHttpServer())
      .patch('/api/auth/me')
      .set('Cookie', cookie).set('X-Portal', 'web')
      .send({ departmentId: 'nonexistent-dept-id' })
      .expect(400);
  });
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `cd apps/api && pnpm test:e2e -- auth`
Expected: 新 PATCH 用例 FAIL（404，端点未实现）。

- [ ] **Step 4: 在 `AuthService` 注入 `AuditService` 并加 `updateProfile()`**

修改 `apps/api/src/auth/auth.service.ts`：

顶部加 import：

```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
```

（把原来的 `import { Injectable } from '@nestjs/common';` 替换为上面这行。）

加 DTO import：

```ts
import { UpdateProfileDto } from './dto/update-profile.dto';
```

改构造函数（注入 `AuditService`）：

```ts
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
  ) {}
```

在 `me()` 之后（或 `listDepartments()` 之后）追加：

```ts
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.departmentId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: dto.departmentId },
        select: { id: true },
      });
      if (!dept) {
        throw new BadRequestException('所选部门不存在');
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.email !== undefined) data.email = dto.email || null;
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId || null;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        departmentId: true,
        department: { select: { id: true, name: true, code: true } },
      },
    });

    await this.audit.log({
      userId,
      action: 'PROFILE_UPDATE',
      resourceType: 'user',
      resourceId: userId,
      details: {
        fields: Object.keys(data),
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
      },
    });

    return updated;
  }
```

- [ ] **Step 5: 在 `AuthController` 加 `@Patch('me')`**

修改 `apps/api/src/auth/auth.controller.ts` 顶部 import，把 `@nestjs/common` 的导入扩为：

```ts
import { Controller, Post, Get, Patch, Body, Res, Req, UseGuards, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
```

加 DTO import：

```ts
import { UpdateProfileDto } from './dto/update-profile.dto';
```

在 `departments` 路由之后追加：

```ts
  @Patch('me')
  @ApiCookieAuth('token')
  @ApiOperation({ summary: '更新当前用户资料（姓名/邮箱/部门）' })
  updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(userId, dto);
  }
```

- [ ] **Step 6: 运行测试，确认全部通过**

Run: `cd apps/api && pnpm test:e2e -- auth`
Expected: 全部 PASS（含 Task 1/2/3 所有新增用例）。

- [ ] **Step 7: 暂存**

```bash
git add apps/api/src/auth/dto/update-profile.dto.ts apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.controller.ts apps/api/test/auth.e2e-spec.ts
```

---

## Task 4: 前端 — API 客户端 + 类型 + 标签（地基）

**Files:**
- Modify: `apps/web/src/lib/api/auth.ts:28-37`（`AuthUser` 类型）+ 末尾追加两个函数
- Modify: `apps/web/src/lib/api/audit-log.ts`（`AUDIT_ACTION_LABELS`）
- Create: `apps/web/src/components/profile/role-labels.ts`

**Interfaces:**
- Produces: `AuthUser` 含 `departmentId` / `department`；`updateMyProfile(payload)` / `fetchDepartments()` 可用；`ROLE_LABELS`（完整 AuthRole 映射）从 `role-labels.ts` 导出供后续组件用。

- [ ] **Step 1: 扩展 `AuthUser` 类型**

修改 `apps/web/src/lib/api/auth.ts` 第 28-37 行的 `AuthUser` 为：

```ts
export type AuthDepartment = {
  id: string;
  name: string;
  code: string | null;
};

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: AuthRole;
  email?: string | null;
  isActive?: boolean;
  createdAt?: string | null;
  departmentId?: string | null;
  department?: AuthDepartment | null;
};
```

- [ ] **Step 2: 在 `auth.ts` 末尾追加 `updateMyProfile` 与 `fetchDepartments`**

在 `apps/web/src/lib/api/auth.ts` 末尾（`logout` 函数之后）追加：

```ts
export async function updateMyProfile(payload: {
  displayName?: string;
  email?: string | null;
  departmentId?: string | null;
}): Promise<AuthUser> {
  return requestJson<AuthUser>(`${API_BASE}/auth/me`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export type DepartmentOption = {
  id: string;
  name: string;
  code: string | null;
};

export async function fetchDepartments(): Promise<DepartmentOption[]> {
  return requestJson<DepartmentOption[]>(`${API_BASE}/auth/departments`, {
    credentials: "include",
    cache: "no-store",
  });
}
```

- [ ] **Step 3: 给 `AUDIT_ACTION_LABELS` 加 `PROFILE_UPDATE`**

修改 `apps/web/src/lib/api/audit-log.ts` 的 `AUDIT_ACTION_LABELS`（在 `SETTINGS_UPDATE` 行之后追加一行）：

```ts
  SETTINGS_UPDATE: '更新个人设置',
  PROFILE_UPDATE: '更新个人资料',
```

- [ ] **Step 4: 新建 `role-labels.ts`**

创建 `apps/web/src/components/profile/role-labels.ts`：

```ts
import type { AuthRole } from "@/lib/api/auth";

/** 完整 AuthRole → 中文映射，供 Profile 页各组件复用。 */
export const ROLE_LABELS: Record<AuthRole, string> = {
  admin: "管理员",
  leader: "领导",
  staff: "员工",
  procurement_staff: "采购管理岗",
  bid_host: "开标主持",
  bid_expert: "评审专家",
  supplier: "供应商",
  mall: "商城用户",
};

/** 未知角色兜底（例如后端新增了未同步的角色）。 */
export function roleLabel(role: string | undefined): string {
  if (!role) return "未知";
  return ROLE_LABELS[role as AuthRole] ?? role;
}
```

- [ ] **Step 5: 类型检查通过**

Run: `cd apps/web && pnpm lint` （或 `pnpm exec tsc --noEmit`）
Expected: 无新增类型错误。

- [ ] **Step 6: 暂存**

```bash
git add apps/web/src/lib/api/auth.ts apps/web/src/lib/api/audit-log.ts apps/web/src/components/profile/role-labels.ts
```

---

## Task 5: 前端 — `ProfileHero` + `ProfilePage` 骨架

**Files:**
- Create: `apps/web/src/components/profile/profile-hero.tsx`
- Create: `apps/web/src/components/profile/profile-page.tsx`
- Modify: `apps/web/src/app/(main)/profile/page.tsx`

**Interfaces:**
- Consumes: `AuthUser`（Task 4）、`logout`（既有）、`roleLabel`（Task 4）
- Produces: `ProfilePage` 默认导出（具名 `ProfilePage`），路由在 Task 5 末尾切到它；后续 Task 6/7 往 `ProfilePage` 的网格里塞卡片。

- [ ] **Step 1: 新建 `ProfileHero`**

创建 `apps/web/src/components/profile/profile-hero.tsx`：

```tsx
"use client";

import { Loader2, LogOut, UserRound } from "lucide-react";
import type { AuthUser } from "@/lib/api/auth";
import { roleLabel } from "./role-labels";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "未知";
  try {
    return new Date(iso).toLocaleDateString("zh-CN", {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch {
    return "未知";
  }
}

export function ProfileHero({
  user,
  loggingOut,
  onLogout,
}: {
  user: AuthUser;
  loggingOut: boolean;
  onLogout: () => void;
}) {
  return (
    <section className="neu-card-static flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <span className="neu-icon-well inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px] text-[color:var(--accent)]">
          <UserRound size={24} strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
            当前账号
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="text-[1.15rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
              {user.displayName}
            </span>
            <span className="inline-flex items-center rounded-full bg-[oklch(0.94_0.05_251)] px-2.5 py-0.5 text-xs font-semibold text-[color:var(--accent-strong)]">
              {roleLabel(user.role)}
            </span>
          </div>
          <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">
            {user.department?.name ?? "未分配部门"}
            <span className="mx-2 opacity-40">·</span>
            创建于 {formatDate(user.createdAt)}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onLogout}
        disabled={loggingOut}
        className="neu-btn-soft is-danger self-start sm:self-auto"
      >
        {loggingOut ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
        退出登录
      </button>
    </section>
  );
}
```

- [ ] **Step 2: 新建 `ProfilePage` 编排器（骨架，先只放 Hero）**

创建 `apps/web/src/components/profile/profile-page.tsx`：

```tsx
"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import {
  fetchCurrentUser,
  fetchDepartments,
  logout,
  type AuthUser,
  type DepartmentOption,
} from "@/lib/api/auth";
import { clearWorkspaceCache } from "@/components/work-arrangements/work-arrangements-page";
import { ProfileHero } from "./profile-hero";

export function ProfilePage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [user, depts] = await Promise.all([
          fetchCurrentUser(),
          fetchDepartments().catch(() => [] as DepartmentOption[]),
        ]);
        setCurrentUser(user);
        setDepartments(depts);
      } catch {
        setCurrentUser(null);
      } finally {
        setLoadingUser(false);
      }
    };
    void load();
  }, []);

  const refreshUser = async () => {
    try {
      const user = await fetchCurrentUser();
      setCurrentUser(user);
    } catch {
      /* keep stale */
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      clearWorkspaceCache();
      startTransition(() => {
        router.replace("/login");
        router.refresh();
      });
    } finally {
      setLoggingOut(false);
    }
  };

  if (loadingUser) {
    return (
      <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-[color:var(--muted-foreground)]">
        正在加载账号信息...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-sm text-[color:var(--muted-foreground)]">
        无法加载账号信息
        <button type="button" onClick={refreshUser} className="neu-btn-soft">
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <ProfileHero user={currentUser} loggingOut={loggingOut} onLogout={handleLogout} />

      {/* 卡片网格 —— Task 6/7 填充 */}
      <div className="grid gap-4 md:grid-cols-2" />
    </div>
  );
}
```

- [ ] **Step 3: 切路由 import**

修改 `apps/web/src/app/(main)/profile/page.tsx` 为：

```tsx
"use client";

import { ProfilePage } from "@/components/profile/profile-page";

export default function ProfileRoute() {
  return <ProfilePage />;
}
```

- [ ] **Step 4: 运行 dev，截图确认 Hero**

Run: `cd apps/web && pnpm dev` （:3005），以 `陈主任` / `czr@2026` 登录，访问 `/profile`。
Expected: Hero 显示「陈主任 / 采购管理岗 / 部门名 · 创建于 日期」+「退出登录」。截图存档。
（旧文件 `src/components/profile-page.tsx` 此时仍未删，路由已不指向它 —— 删除留到 Task 8。）

- [ ] **Step 5: 暂存**

```bash
git add apps/web/src/components/profile/profile-hero.tsx apps/web/src/components/profile/profile-page.tsx 'apps/web/src/app/(main)/profile/page.tsx'
```

---

## Task 6: 前端 — `ProfileEditCard`（核心资料修改卡）

**Files:**
- Create: `apps/web/src/components/profile/profile-edit-card.tsx`
- Modify: `apps/web/src/components/profile/profile-page.tsx`（接入卡片）

**Interfaces:**
- Consumes: `AuthUser`、`DepartmentOption[]`、`updateMyProfile`（Task 4）；回调 `onSaved()` 让父组件刷新 Hero。
- Produces: `ProfileEditCard`，表单字段 displayName / email / departmentId。

- [ ] **Step 1: 新建 `ProfileEditCard`**

创建 `apps/web/src/components/profile/profile-edit-card.tsx`：

```tsx
"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import {
  normalizeRequestErrorMessage,
  updateMyProfile,
  type AuthUser,
  type DepartmentOption,
} from "@/lib/api/auth";

export function ProfileEditCard({
  user,
  departments,
  onSaved,
}: {
  user: AuthUser;
  departments: DepartmentOption[];
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? "");
  const [departmentId, setDepartmentId] = useState(user.departmentId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const dirty =
    displayName !== user.displayName ||
    (email || null) !== (user.email ?? null) ||
    (departmentId || null) !== (user.departmentId ?? null);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!displayName.trim()) {
      setError("姓名不能为空。");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateMyProfile({
        displayName: displayName.trim(),
        email: email.trim() ? email.trim() : null,
        departmentId: departmentId || null,
      });
      setSuccess("资料已更新。");
      onSaved();
    } catch (err) {
      setError(normalizeRequestErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="neu-card-static p-5">
      <h3 className="mb-4 text-base font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
        资料修改
      </h3>

      <form onSubmit={handleSave} noValidate className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">姓名</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="请输入姓名"
            maxLength={32}
            className="neu-input"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">邮箱</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="选填，如 name@example.com"
            className="neu-input"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">部门</span>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="neu-select"
          >
            <option value="">未分配部门</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-[color:var(--muted-foreground)]">
            用户名 @{user.username} · 不可修改
          </span>
          <button
            type="submit"
            disabled={saving || !dirty}
            className="neu-btn-primary"
          >
            {saving ? (
              <><Loader2 size={16} className="animate-spin" />保存中</>
            ) : (
              "保存"
            )}
          </button>
        </div>

        {error && (
          <div className="rounded-[10px] border border-[oklch(0.6_0.18_27/0.25)] bg-[oklch(0.96_0.04_27/0.5)] px-3.5 py-2.5 text-sm text-[color:var(--danger)]">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-[10px] border border-[oklch(0.6_0.13_164/0.25)] bg-[oklch(0.96_0.04_164/0.4)] px-3.5 py-2.5 text-sm text-[color:var(--success)]">
            {success}
          </div>
        )}
      </form>
    </section>
  );
}
```

- [ ] **Step 2: 在 `ProfilePage` 网格里接入 `ProfileEditCard`**

修改 `apps/web/src/components/profile/profile-page.tsx`：

顶部加 import：

```ts
import { ProfileEditCard } from "./profile-edit-card";
```

把 `{/* 卡片网格 —— Task 6/7 填充 */}` 那一段（含空 `<div className="grid ... />`）替换为：

```tsx
      <div className="grid gap-4 md:grid-cols-2">
        <ProfileEditCard
          user={currentUser}
          departments={departments}
          onSaved={refreshUser}
        />
        {/* Task 7: 安全 / 操作记录 / 偏好设置 */}
      </div>
```

- [ ] **Step 3: 运行 dev，截图验证资料修改闭环**

刷新 `/profile`。改姓名 → 点保存 → 期望：成功条出现，**Hero 顶部姓名同步刷新**；改部门 → 保存 → Hero 部门同步。试输入非法邮箱 → 期望红色错误条。截图存档。

- [ ] **Step 4: 暂存**

```bash
git add apps/web/src/components/profile/profile-edit-card.tsx apps/web/src/components/profile/profile-page.tsx
```

---

## Task 7: 前端 — 安全 / 操作记录 / 偏好设置 三张卡

**Files:**
- Create: `apps/web/src/components/profile/profile-security-card.tsx`
- Create: `apps/web/src/components/profile/profile-activity-card.tsx`
- Create: `apps/web/src/components/profile/profile-preferences-card.tsx`
- Modify: `apps/web/src/components/profile/profile-page.tsx`（接入三张卡）

**Interfaces:**
- Consumes: `requestPasswordChange`（既有）、`fetchMyActivities` + `AUDIT_ACTION_LABELS` + `AuditLogItem`（既有）、`useUserSettings` + `THEME_OPTIONS` + `HOME_PAGE_OPTIONS`（既有）。
- Produces: 三张卡组件，行为搬迁自旧 `profile-page.tsx`，视觉改用 `neu-*`。

- [ ] **Step 1: 新建 `ProfileSecurityCard`（迁移改密表单）**

创建 `apps/web/src/components/profile/profile-security-card.tsx`：

```tsx
"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { normalizeRequestErrorMessage, requestPasswordChange } from "@/lib/api/auth";

export function ProfileSecurityCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!currentPassword) { setError("请输入当前密码。"); return; }
    if (!newPassword) { setError("请输入新密码。"); return; }
    if (newPassword.length < 6) { setError("新密码至少需要 6 位。"); return; }
    if (newPassword !== confirmPassword) { setError("两次输入的新密码不一致。"); return; }

    setSubmitting(true);
    try {
      await requestPasswordChange({ currentPassword, newPassword });
      setSuccess("申请已提交，等待管理员审批通过后，新密码才会生效。");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(normalizeRequestErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="neu-card-static p-5">
      <h3 className="mb-1 text-base font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
        安全
      </h3>
      <p className="mb-4 text-xs text-[color:var(--muted-foreground)]">
        修改密码需提交申请，审批通过后生效。
      </p>

      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="当前密码"
          className="neu-input"
          autoComplete="current-password"
        />
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="新密码（不少于 6 位）"
          className="neu-input"
          autoComplete="new-password"
        />
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="确认新密码"
          className="neu-input"
          autoComplete="new-password"
        />

        {error && (
          <div className="rounded-[10px] border border-[oklch(0.6_0.18_27/0.25)] bg-[oklch(0.96_0.04_27/0.5)] px-3.5 py-2.5 text-sm text-[color:var(--danger)]">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-[10px] border border-[oklch(0.6_0.13_164/0.25)] bg-[oklch(0.96_0.04_164/0.4)] px-3.5 py-2.5 text-sm text-[color:var(--success)]">
            {success}
          </div>
        )}

        <button type="submit" disabled={submitting} className="neu-btn-primary w-full">
          {submitting ? (
            <><Loader2 size={16} className="animate-spin" />提交中</>
          ) : (
            "提交审批"
          )}
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: 新建 `ProfileActivityCard`（最近 5 + 查看全部展开到 20）**

创建 `apps/web/src/components/profile/profile-activity-card.tsx`：

```tsx
"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AUDIT_ACTION_LABELS,
  fetchMyActivities,
  type AuditLogItem,
} from "@/lib/api/audit-log";

function formatShort(iso: string | null | undefined): string {
  if (!iso) return "未知";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "未知";
  }
}

export function ProfileActivityCard() {
  const [activities, setActivities] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const result = await fetchMyActivities({ limit: expanded ? 20 : 5 });
        setActivities(result.items);
      } catch {
        setActivities([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [expanded]);

  return (
    <section className="neu-card-static p-5">
      <h3 className="mb-4 text-base font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
        操作记录
      </h3>

      {loading ? (
        <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={16} className="animate-spin" />
          加载中...
        </div>
      ) : activities.length === 0 ? (
        <div className="flex min-h-[120px] items-center justify-center text-sm text-[color:var(--muted-foreground)]">
          暂无操作记录
        </div>
      ) : (
        <ul className="space-y-2">
          {activities.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-[10px] bg-[oklch(0.98_0.005_258)] px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[color:var(--foreground)]">
                  {AUDIT_ACTION_LABELS[item.action] ?? item.action}
                </div>
                {item.resourceType && (
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    {item.resourceType}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-xs text-[color:var(--muted-foreground)]">
                {formatShort(item.createdAt)}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && activities.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="neu-btn-xs is-info mt-3 w-full"
        >
          {expanded ? "收起" : "查看全部"}
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 3: 新建 `ProfilePreferencesCard`（复用 useUserSettings）**

创建 `apps/web/src/components/profile/profile-preferences-card.tsx`：

```tsx
"use client";

import { useState } from "react";
import {
  HOME_PAGE_OPTIONS,
  THEME_OPTIONS,
  type UserSettings,
} from "@/lib/api/user-settings";
import { useUserSettings } from "@/lib/user-settings-context";

export function ProfilePreferencesCard() {
  const { settings, loading, updateSettings } = useUserSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <section className="neu-card-static p-5">
        <h3 className="mb-4 text-base font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
          偏好设置
        </h3>
        <div className="flex min-h-[120px] items-center justify-center text-sm text-[color:var(--muted-foreground)]">
          加载中...
        </div>
      </section>
    );
  }

  if (!settings) {
    return (
      <section className="neu-card-static p-5">
        <h3 className="mb-4 text-base font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
          偏好设置
        </h3>
        <div className="flex min-h-[120px] items-center justify-center text-sm text-[color:var(--muted-foreground)]">
          无法加载设置
        </div>
      </section>
    );
  }

  const handleUpdate = async (updates: Partial<UserSettings>) => {
    setSaving(true);
    setError(null);
    try {
      await updateSettings(updates);
    } catch {
      setError("保存设置失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="neu-card-static p-5">
      <h3 className="mb-4 text-base font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
        偏好设置
      </h3>

      <div className="space-y-4">
        <div>
          <div className="mb-2 text-sm font-medium text-[color:var(--foreground)]">主题</div>
          <div className="flex gap-2">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleUpdate({ theme: option.value })}
                disabled={saving}
                className={[
                  "flex-1 rounded-[10px] px-3 py-2 text-sm transition-all",
                  settings.theme === option.value
                    ? "bg-[oklch(0.94_0.05_251)] text-[color:var(--accent-strong)] shadow-[inset_1px_1px_3px_oklch(0.55_0.03_258/0.12),inset_-1px_-1px_2px_oklch(1_0_0/0.6)]"
                    : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">
            默认首页
          </span>
          <select
            value={settings.defaultHomePage}
            onChange={(e) => handleUpdate({ defaultHomePage: e.target.value as UserSettings["defaultHomePage"] })}
            disabled={saving}
            className="neu-select"
          >
            {HOME_PAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-[color:var(--foreground)]">紧凑模式</div>
            <div className="text-xs text-[color:var(--muted-foreground)]">减少界面间距</div>
          </div>
          <button
            type="button"
            onClick={() => handleUpdate({ compactMode: !settings.compactMode })}
            disabled={saving}
            className={[
              "relative h-6 w-11 rounded-full transition-all",
              settings.compactMode
                ? "bg-[color:var(--accent)]"
                : "bg-[oklch(0.9_0.01_258)]",
            ].join(" ")}
            aria-label="切换紧凑模式"
          >
            <span
              className={[
                "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                settings.compactMode ? "translate-x-5" : "",
              ].join(" ")}
            />
          </button>
        </div>

        {error && (
          <div className="rounded-[10px] border border-[oklch(0.6_0.18_27/0.25)] bg-[oklch(0.96_0.04_27/0.5)] px-3.5 py-2.5 text-sm text-[color:var(--danger)]">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 在 `ProfilePage` 接入三张卡**

修改 `apps/web/src/components/profile/profile-page.tsx`：

顶部加 import：

```ts
import { ProfileSecurityCard } from "./profile-security-card";
import {ProfileActivityCard} from "./profile-activity-card";
import {ProfilePreferencesCard} from "./profile-preferences-card";
```

把网格里的占位 `{/* Task 7: 安全 / 操作记录 / 偏好设置 */}` 替换为：

```tsx
        <ProfileSecurityCard />
        <ProfileActivityCard />
        <ProfilePreferencesCard />
```

（最终网格内顺序：`ProfileEditCard`、`ProfileSecurityCard`、`ProfileActivityCard`、`ProfilePreferencesCard`，2×2 排列。）

- [ ] **Step 5: 运行 dev，截图验证三张卡**

刷新 `/profile`。验证：① 改密表单提交后出现"等待审批"提示；② 操作记录显示最近 5 条 + 「查看全部」展开到 20 条；③ 主题/默认首页/紧凑模式可切换。截图存档。

- [ ] **Step 6: 暂存**

```bash
git add apps/web/src/components/profile/profile-security-card.tsx apps/web/src/components/profile/profile-activity-card.tsx apps/web/src/components/profile/profile-preferences-card.tsx apps/web/src/components/profile/profile-page.tsx
```

---

## Task 8: 清理旧文件 + 全面视觉验收

**Files:**
- Delete: `apps/web/src/components/profile-page.tsx`（旧 486 行单文件）
- Verify: 整页所有状态

- [ ] **Step 1: 确认旧文件无其他引用**

Run: `grep -rn "components/profile-page" apps/web/src` （在 `water-erp/` 下）
Expected: 无输出（路由在 Task 5 已切走）。若有输出，先修正引用。

- [ ] **Step 2: 删除旧文件**

```bash
git rm apps/web/src/components/profile-page.tsx
```

- [ ] **Step 3: 类型检查 + lint**

Run: `cd apps/web && pnpm lint`
Expected: 无错误。

- [ ] **Step 4: 全量 e2e 回归**

Run: `cd apps/api && pnpm test:e2e -- auth`
Expected: 全 PASS。

- [ ] **Step 5: 全状态截图验收（按 spec §验证方式）**

以 `陈主任` / `czr@2026` 登录 :3005 `/profile`，截并归档：
1. 加载态 → 内容态
2. 改姓名保存 → Hero 实时刷新
3. 部门下拉展开 + 切换部门保存
4. 非法邮箱 → 红色错误条
5. 改密提交审批提示
6. 偏好切换（主题 / 默认首页 / 紧凑）
7. 操作记录「查看全部」展开
8. 退出登录跳转 `/login`

- [ ] **Step 6: 暂存删除 + 通报完成**

```bash
git add -A apps/web/src/components/profile-page.tsx
```
通报：所有 8 个 Task 完成，截图已归档；等待用户确认是否 commit。

---

## Self-Review 结果

- **Spec 覆盖**：spec §1 页面结构 → Task 5/6/7；§2 后端 → Task 1/2/3；§3 组件拆分 → Task 4-7；§4 数据流 → Task 5/6/7（refreshUser 闭环、Promise.all 加载、审批流搬迁、记录卡 limit 切换、偏好复用 context）；§5 视觉映射 → 全程 `neu-*`；§6 角色修复 → Task 4 `role-labels.ts`；§7 错误处理 → 各卡内联错误条 + Hero 重试；§8 验证 → Task 8 截图 + Task 1/2/3 e2e。无遗漏。
- **占位符扫描**：无 TBD/TODO；每步含完整代码或确切命令。
- **类型一致性**：`updateMyProfile` / `fetchDepartments` / `DepartmentOption` / `AuthDepartment` 在 Task 4 定义、Task 5/6 消费，签名一致；`ROLE_LABELS`/`roleLabel` 在 Task 4 定义、Task 5 Hero 消费；`PROFILE_UPDATE` 在 Task 1（后端类型）+ Task 3（写入）+ Task 4（前端 label）一致。
- **一处偏离 spec（已记录）**：spec §1 Hero 写了"最近登录"，但 `User` 模型无 `lastLoginAt` 字段、`me()` 也不返回。本计划 Hero 只显示「部门 · 创建于 {date}」，不展示最近登录（避免展示假数据）。若用户坚持要"最近登录"，可在 Task 1 的 `me()` 里追加 `auditLog` 子查询取最新一条 `LOGIN`，作为后续增量。
