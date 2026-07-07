# 个人中心（/profile）全面重新设计 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 :3005 采购管理工作台的 `/profile` 路由从旧的"资料修改"单列页面完全重建为"个人中心"——顶部 Tab + 左侧固定用户信息卡 + 右侧 Tab 内容区，使用全站 `neu-*` 新拟态设计语言。

**Architecture:** 后端新增 `PATCH /auth/me` 资料编辑接口和 `GET /auth/departments` 部门下拉接口，扩展 `GET /auth/me` 返回 department/createdAt/lastLoginAt。前端拆分 487 行单体 `profile-page.tsx` 为 7 个聚焦组件（编排页 + Hero + TabBar + 4 个 Tab 内容组件），删除旧的 `profile-page.tsx` 和 `user-center-panel.tsx`。

**Tech Stack:** NestJS 11 (backend), Next.js 16 App Router + React 19 + Tailwind CSS v4 + Lucide icons (frontend)

## Global Constraints

- 完全摒弃现有 profile-page.tsx 和 user-center-panel.tsx 的设计和 UI，从零重建
- 使用 `neu-*` 新拟态类（`neu-card-static`、`neu-input`、`neu-select`、`neu-btn-primary`、`neu-btn-soft`、`neu-icon-well`），禁用内联 style=
- Sidebar 文字 `资料修改` → `个人中心`，key `profile-edit` → `personal-center`
- 页面结构: 独立全屏页面 + 顶部 Tab + 左侧固定用户信息卡(280px) + 右侧 Tab 内容区
- Tab: 基本资料、账号安全、操作日志、偏好设置
- 角色标签: 完整 `AuthRole` 映射（admin/leader/staff/procurement_staff/bid_host/bid_expert/supplier/mall）
- 验证方式: 真实渲染截图，非 pass-rate

---

### Task 1: Backend — Create UpdateProfileDto

**Files:**
- Create: `apps/api/src/auth/dto/update-profile.dto.ts`

**Interfaces:**
- Produces: `UpdateProfileDto` class with `displayName?: string`, `email?: string | null`, `departmentId?: string | null`

- [ ] **Step 1: Create the DTO file**

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: '显示名称', example: '陈主任' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  displayName?: string;

  @ApiPropertyOptional({ description: '邮箱地址', example: 'chen@example.com', nullable: true })
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional({ description: '部门 ID', example: 'clx...', nullable: true })
  @IsOptional()
  @IsString()
  departmentId?: string | null;
}
```

- [ ] **Step 2: Verify DTO compiles**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter api exec npx tsc --noEmit 2>&1 | grep -i "update-profile" | head -5
```

Expected: No errors related to update-profile.dto.ts

- [ ] **Step 3: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/api/src/auth/dto/update-profile.dto.ts && git commit -m "feat(auth): add UpdateProfileDto for PATCH /auth/me"
```

---

### Task 2: Backend — Extend AuthService.me() and add updateProfile()

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`

**Interfaces:**
- Consumes: `UpdateProfileDto` from Task 1
- Produces: Extended `me(userId)` return with `department`, `createdAt`, `lastLoginAt`; new `updateProfile(userId, dto)` method

- [ ] **Step 1: Update auth.service.ts — add imports**

Add at top of file (after existing imports):
```typescript
import { NotFoundException } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto';
```

- [ ] **Step 2: Replace me() method (currently lines 52-57)**

```typescript
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
      lastLoginAt: true,
      department: {
        select: { id: true, name: true, code: true },
      },
    },
  });
}
```

- [ ] **Step 3: Add updateProfile() method after me()**

```typescript
async updateProfile(userId: string, dto: UpdateProfileDto) {
  if (dto.departmentId) {
    const dept = await this.prisma.department.findUnique({
      where: { id: dto.departmentId },
    });
    if (!dept) {
      throw new NotFoundException('指定的部门不存在');
    }
  }

  const updated = await this.prisma.user.update({
    where: { id: userId },
    data: {
      ...(dto.displayName !== undefined && { displayName: dto.displayName }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.departmentId !== undefined && { departmentId: dto.departmentId }),
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      lastLoginAt: true,
      department: {
        select: { id: true, name: true, code: true },
      },
    },
  });

  return updated;
}
```

- [ ] **Step 4: Verify compilation**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter api exec npx tsc --noEmit 2>&1 | grep -i "auth.service" | head -5
```

- [ ] **Step 5: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/api/src/auth/auth.service.ts && git commit -m "feat(auth): extend me() with department/createdAt/lastLoginAt, add updateProfile()"
```

---

### Task 3: Backend — Add PATCH /auth/me and GET /auth/departments endpoints

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts`

**Interfaces:**
- Consumes: `AuthService.me()` extended return, `AuthService.updateProfile()`, `UpdateProfileDto`
- Produces: `PATCH /auth/me` and `GET /auth/departments` endpoints

- [ ] **Step 1: Add imports to auth.controller.ts**

Change import line to include `Body, Patch, Get`:
```typescript
import { Body, Controller, Get, Patch, Post, Req, Res } from '@nestjs/common';
```

Add:
```typescript
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
```

- [ ] **Step 2: Add PrismaService to constructor**

```typescript
constructor(
  private readonly authService: AuthService,
  private readonly prisma: PrismaService,
) {}
```

- [ ] **Step 3: Add PATCH /auth/me endpoint (before closing `}` of class)**

```typescript
@Patch('me')
@ApiOperation({ summary: '更新当前用户个人资料' })
async updateProfile(
  @CurrentUser('sub') userId: string,
  @Body() dto: UpdateProfileDto,
) {
  const updated = await this.authService.updateProfile(userId, dto);

  // Write audit log
  const changedFields = Object.keys(dto).filter(
    (k) => dto[k as keyof UpdateProfileDto] !== undefined,
  );
  await this.prisma.auditLog.create({
    data: {
      userId,
      action: 'PROFILE_UPDATE',
      resourceType: 'user',
      resourceId: userId,
      details: { changedFields },
    },
  });

  return updated;
}
```

- [ ] **Step 4: Add GET /auth/departments endpoint**

```typescript
@Get('departments')
@ApiOperation({ summary: '获取部门列表（下拉选择用）' })
async listDepartments() {
  return this.prisma.department.findMany({
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  });
}
```

- [ ] **Step 5: Verify compilation**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter api exec npx tsc --noEmit 2>&1 | grep -i "auth" | head -10
```

- [ ] **Step 6: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/api/src/auth/auth.controller.ts && git commit -m "feat(auth): add PATCH /auth/me and GET /auth/departments endpoints"
```

---

### Task 4: Frontend API — Add updateMyProfile(), fetchDepartments(), and shared ROLE_LABELS

**Files:**
- Modify: `apps/web/src/lib/api/auth.ts`
- Create: `apps/web/src/lib/role-labels.ts`

**Interfaces:**
- Produces: `DepartmentItem` type, `UpdateProfileInput` type, `updateMyProfile()`, `fetchDepartments()`, and `ROLE_LABELS` constant

- [ ] **Step 1: Create shared role-labels.ts**

```typescript
import type { AuthRole } from '@/lib/api/auth';

export const ROLE_LABELS: Record<AuthRole, string> = {
  admin: '管理员',
  leader: '领导',
  staff: '员工',
  procurement_staff: '采购管理岗',
  bid_host: '开标主持',
  bid_expert: '评审专家',
  supplier: '供应商',
  mall: '商城用户',
};
```

- [ ] **Step 2: Add types and functions to auth.ts**

After the `AuthUser` type definition (after line 37 in current file):

```typescript
export type DepartmentItem = {
  id: string;
  name: string;
  code: string | null;
};

export type UpdateProfileInput = {
  displayName?: string;
  email?: string | null;
  departmentId?: string | null;
};
```

After the `logout()` function (at end of file):

```typescript
export async function updateMyProfile(
  payload: UpdateProfileInput,
): Promise<AuthUser> {
  return requestJson<AuthUser>(`${API_BASE}/auth/me`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function fetchDepartments(): Promise<DepartmentItem[]> {
  return requestJson<DepartmentItem[]>(`${API_BASE}/auth/departments`, {
    credentials: 'include',
    cache: 'no-store',
  });
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter web exec npx tsc --noEmit 2>&1 | grep -E "auth\.ts|role-labels" | head -5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/web/src/lib/api/auth.ts apps/web/src/lib/role-labels.ts && git commit -m "feat(web): add updateMyProfile, fetchDepartments, and shared ROLE_LABELS"
```

---

### Task 5: Frontend — Create PersonalCenterHero (左侧固定用户信息卡)

**Files:**
- Create: `apps/web/src/components/profile/personal-center-hero.tsx`

**Interfaces:**
- Consumes: `AuthUser`, `ROLE_LABELS`
- Produces: `<PersonalCenterHero user={...} onEdit onPassword onLogout loggingOut />`

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { LogOut, Loader2, UserRound } from 'lucide-react';
import type { AuthUser } from '@/lib/api/auth';
import { ROLE_LABELS } from '@/lib/role-labels';

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '未知';
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '未知';
  }
}

interface PersonalCenterHeroProps {
  user: AuthUser & { department?: { id: string; name: string; code: string | null } | null };
  onEdit: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
  loggingOut: boolean;
}

export function PersonalCenterHero({ user, onEdit, onChangePassword, onLogout, loggingOut }: PersonalCenterHeroProps) {
  return (
    <div className="neu-card-static w-[280px] shrink-0 self-start p-5">
      {/* Avatar */}
      <div className="flex flex-col items-center gap-3">
        <div className="neu-icon-well flex h-16 w-16 items-center justify-center">
          <UserRound size={30} strokeWidth={1.6} className="text-[color:var(--accent)]" />
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
            {user.displayName}
          </div>
          <div className="mt-1">
            <span className="inline-block rounded-full border border-[color:var(--accent-soft)] bg-[color:var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.04em] text-[color:var(--accent-strong)]">
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          </div>
        </div>
      </div>

      {/* Info rows */}
      <div className="mt-5 space-y-3 rounded-xl border border-white/60 bg-white/42 p-3.5">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-[color:var(--muted-foreground)]">用户名</span>
          <span className="font-medium text-[color:var(--foreground)]">{user.username}</span>
        </div>
        <div className="h-px bg-[linear-gradient(90deg,rgba(180,200,235,0.32),rgba(180,200,235,0.08))]" />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-[color:var(--muted-foreground)]">部门</span>
          <span className="font-medium text-[color:var(--foreground)]">
            {user.department?.name ?? '未设置'}
          </span>
        </div>
        <div className="h-px bg-[linear-gradient(90deg,rgba(180,200,235,0.32),rgba(180,200,235,0.08))]" />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-[color:var(--muted-foreground)]">邮箱</span>
          <span className="font-medium text-[color:var(--foreground)]">
            {user.email ?? '未设置'}
          </span>
        </div>
        <div className="h-px bg-[linear-gradient(90deg,rgba(180,200,235,0.32),rgba(180,200,235,0.08))]" />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-[color:var(--muted-foreground)]">创建时间</span>
          <span className="font-medium text-[color:var(--foreground)]">{formatDate(user.createdAt)}</span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-4 space-y-2">
        <button type="button" onClick={onEdit} className="neu-btn-soft w-full justify-center text-sm">
          编辑资料
        </button>
        <button type="button" onClick={onChangePassword} className="neu-btn-soft w-full justify-center text-sm">
          修改密码
        </button>
      </div>

      {/* Logout */}
      <div className="mt-3">
        <button
          type="button"
          onClick={onLogout}
          disabled={loggingOut}
          className="neu-btn-soft is-danger w-full justify-center text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loggingOut ? (
            <><Loader2 size={15} className="animate-spin" />退出中...</>
          ) : (
            <><LogOut size={15} strokeWidth={1.8} />退出登录</>
          )}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter web exec npx tsc --noEmit 2>&1 | grep "personal-center-hero" | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/web/src/components/profile/personal-center-hero.tsx && git commit -m "feat(web): add PersonalCenterHero left sidebar info card"
```

---

### Task 6: Frontend — Create PersonalCenterTabBar (顶部 Tab 导航)

**Files:**
- Create: `apps/web/src/components/profile/personal-center-tab-bar.tsx`

**Interfaces:**
- Produces: `<PersonalCenterTabBar activeTab onTabChange />`, exports `TabKey` type and `TABS` config

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { History, KeyRound, Settings, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type TabKey = 'basic-info' | 'security' | 'activity-log' | 'preferences';

interface TabConfig {
  key: TabKey;
  label: string;
  icon: LucideIcon;
}

export const TABS: TabConfig[] = [
  { key: 'basic-info', label: '基本资料', icon: UserRound },
  { key: 'security', label: '账号安全', icon: KeyRound },
  { key: 'activity-log', label: '操作日志', icon: History },
  { key: 'preferences', label: '偏好设置', icon: Settings },
];

interface PersonalCenterTabBarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

export function PersonalCenterTabBar({ activeTab, onTabChange }: PersonalCenterTabBarProps) {
  return (
    <nav className="inline-flex gap-1 rounded-2xl border border-white/50 bg-white/55 p-1 backdrop-blur-md" role="tablist">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.key;

        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.key)}
            className={[
              'relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200',
              isActive
                ? 'bg-white text-[color:var(--accent)] shadow-[0_2px_8px_rgba(69,99,158,0.1)]'
                : 'text-[color:var(--muted-foreground)] hover:bg-white/60 hover:text-[color:var(--foreground)]',
            ].join(' ')}
          >
            <Icon size={16} strokeWidth={1.8} />
            {tab.label}
            {isActive && (
              <span className="absolute bottom-0 left-4 right-4 h-[2.5px] rounded-full bg-[color:var(--accent)]" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter web exec npx tsc --noEmit 2>&1 | grep "personal-center-tab-bar" | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/web/src/components/profile/personal-center-tab-bar.tsx && git commit -m "feat(web): add PersonalCenterTabBar top tab navigation"
```

---

### Task 7: Frontend — Create TabBasicInfo (基本资料编辑表单)

**Files:**
- Create: `apps/web/src/components/profile/tab-basic-info.tsx`

**Interfaces:**
- Consumes: `AuthUser`, `DepartmentItem`, `UpdateProfileInput`, `updateMyProfile()`, `ROLE_LABELS`
- Produces: `<TabBasicInfo user departments onUserUpdated />`

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { Loader2, Mail, Building2, UserRound, Shield } from 'lucide-react';
import { useState } from 'react';
import { updateMyProfile } from '@/lib/api/auth';
import type { AuthUser, DepartmentItem, UpdateProfileInput } from '@/lib/api/auth';
import { ROLE_LABELS } from '@/lib/role-labels';

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '未知';
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return '未知'; }
}

interface TabBasicInfoProps {
  user: AuthUser & { department?: { id: string; name: string; code: string | null } | null };
  departments: DepartmentItem[];
  onUserUpdated: (updated: AuthUser) => void;
}

export function TabBasicInfo({ user, departments, onUserUpdated }: TabBasicInfoProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? '');
  const [departmentId, setDepartmentId] = useState(user.department?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hasChanges =
    displayName !== user.displayName ||
    email !== (user.email ?? '') ||
    departmentId !== (user.department?.id ?? '');

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    if (!displayName.trim()) { setError('姓名不能为空'); return; }
    if (displayName.trim().length > 32) { setError('姓名不能超过 32 个字符'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('邮箱格式不正确'); return; }

    setSaving(true);
    try {
      const payload: UpdateProfileInput = {};
      if (displayName !== user.displayName) payload.displayName = displayName.trim();
      if (email !== (user.email ?? '')) payload.email = email.trim() || null;
      if (departmentId !== (user.department?.id ?? '')) payload.departmentId = departmentId || null;

      const updated = await updateMyProfile(payload);
      onUserUpdated(updated);
      setSuccess('保存成功');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Read-only account info */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">账号信息</h3>
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/42 p-3">
            <Shield size={16} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
            <span className="text-sm text-[color:var(--muted-foreground)]">用户名</span>
            <span className="ml-auto text-sm font-medium text-[color:var(--foreground)]">{user.username}</span>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/42 p-3">
            <UserRound size={16} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
            <span className="text-sm text-[color:var(--muted-foreground)]">角色</span>
            <span className="ml-auto inline-block rounded-full border border-[color:var(--accent-soft)] bg-[color:var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold tracking-[0.04em] text-[color:var(--accent-strong)]">
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/42 p-3">
            <UserRound size={16} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
            <span className="text-sm text-[color:var(--muted-foreground)]">创建时间</span>
            <span className="ml-auto text-sm font-medium text-[color:var(--foreground)]">{formatDate(user.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* Edit form */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">编辑资料</h3>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">姓名</span>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              placeholder="请输入姓名" className="neu-input w-full" maxLength={32} />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">
              <Mail size={14} strokeWidth={1.6} className="mr-1.5 inline-block text-[color:var(--muted-foreground)]" />
              邮箱
            </span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="请输入邮箱地址" className="neu-input w-full" />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">
              <Building2 size={14} strokeWidth={1.6} className="mr-1.5 inline-block text-[color:var(--muted-foreground)]" />
              部门
            </span>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="neu-select w-full">
              <option value="">未设置</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[rgba(215,89,89,0.18)] bg-[rgba(255,241,241,0.76)] px-4 py-3 text-sm text-[color:var(--danger)]">
            <span className="mt-0.5 shrink-0">⚠</span>{error}
          </div>
        )}
        {success && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[rgba(92,181,150,0.18)] bg-[rgba(240,250,245,0.76)] px-4 py-3 text-sm text-[color:var(--success)]">
            <span className="mt-0.5 shrink-0">✓</span>{success}
          </div>
        )}

        <div className="mt-5">
          <button type="button" onClick={handleSave} disabled={saving || !hasChanges}
            className="neu-btn-primary disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <><Loader2 size={16} className="animate-spin" />保存中...</> : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter web exec npx tsc --noEmit 2>&1 | grep "tab-basic-info" | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/web/src/components/profile/tab-basic-info.tsx && git commit -m "feat(web): add TabBasicInfo profile editing form"
```

---

### Task 8: Frontend — Create TabSecurity (账号安全)

**Files:**
- Create: `apps/web/src/components/profile/tab-security.tsx`

**Interfaces:**
- Consumes: `requestPasswordChange` from `@/lib/api/auth`
- Produces: `<TabSecurity user={{ lastLoginAt }} />`

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { Loader2, Clock } from 'lucide-react';
import { useState } from 'react';
import { requestPasswordChange } from '@/lib/api/auth';

function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '从未登录';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '未知'; }
}

interface TabSecurityProps {
  user: { lastLoginAt?: string | null };
}

export function TabSecurity({ user }: TabSecurityProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!currentPassword) { setError('请输入当前密码'); return; }
    if (!newPassword) { setError('请输入新密码'); return; }
    if (newPassword.length < 6) { setError('新密码至少需要 6 位'); return; }
    if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致'); return; }

    setSubmitting(true);
    try {
      await requestPasswordChange({ currentPassword, newPassword });
      setSuccess('申请已提交，等待管理员审批通过后新密码才会生效。');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Password change */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">修改密码</h3>
        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
          提交申请后需等待管理员审批，审批通过后新密码生效。
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-5 max-w-md space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">当前密码</span>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="请输入当前密码" className="neu-input w-full" autoComplete="current-password" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">新密码</span>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              placeholder="不少于 6 位" className="neu-input w-full" autoComplete="new-password" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">确认新密码</span>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="请再次输入新密码" className="neu-input w-full" autoComplete="new-password" />
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-[rgba(215,89,89,0.18)] bg-[rgba(255,241,241,0.76)] px-4 py-3 text-sm text-[color:var(--danger)]">
              <span className="mt-0.5 shrink-0">⚠</span>{error}
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2 rounded-xl border border-[rgba(92,181,150,0.18)] bg-[rgba(240,250,245,0.76)] px-4 py-3 text-sm text-[color:var(--success)]">
              <span className="mt-0.5 shrink-0">✓</span>{success}
            </div>
          )}

          <button type="submit" disabled={submitting} className="neu-btn-primary">
            {submitting ? <><Loader2 size={16} className="animate-spin" />提交中...</> : '提交审批'}
          </button>
        </form>
      </div>

      {/* Login info */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">登录信息</h3>
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/42 p-3.5">
            <Clock size={16} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
            <span className="text-sm text-[color:var(--muted-foreground)]">最近登录</span>
            <span className="ml-auto text-sm font-medium text-[color:var(--foreground)]">
              {formatDateTime(user.lastLoginAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter web exec npx tsc --noEmit 2>&1 | grep "tab-security" | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/web/src/components/profile/tab-security.tsx && git commit -m "feat(web): add TabSecurity password change and login info"
```

---

### Task 9: Frontend — Create TabActivityLog (操作日志)

**Files:**
- Create: `apps/web/src/components/profile/tab-activity-log.tsx`

**Interfaces:**
- Consumes: `fetchMyActivities`, `AUDIT_ACTION_LABELS` from `@/lib/api/audit-log`
- Produces: `<TabActivityLog />` (self-loading component, no props needed)

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { History, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchMyActivities, AUDIT_ACTION_LABELS, type AuditLogItem } from '@/lib/api/audit-log';

function formatShortDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '未知';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return '未知'; }
}

export function TabActivityLog() {
  const [activities, setActivities] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const result = await fetchMyActivities({ limit: expanded ? 50 : 5 });
        setActivities(result.items);
      } catch {
        setActivities([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [expanded]);

  const displayItems = expanded ? activities : activities.slice(0, 5);

  return (
    <div className="neu-card-static p-5">
      <h3 className="neu-section-heading">操作日志</h3>

      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={16} className="animate-spin" />正在加载...
        </div>
      ) : activities.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-sm text-[color:var(--muted-foreground)]">
          <History size={32} strokeWidth={1.2} />暂无操作记录
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-2">
            {displayItems.map((item) => (
              <div key={item.id} className="neu-content-block rounded-xl border border-white/50 bg-white/42 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium text-[color:var(--foreground)]">
                    {AUDIT_ACTION_LABELS[item.action] ?? item.action}
                  </span>
                  <span className="shrink-0 text-xs text-[color:var(--muted-foreground)]">
                    {formatShortDateTime(item.createdAt)}
                  </span>
                </div>
                {item.details && Object.keys(item.details).length > 0 && (
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    目标: {item.resourceType}
                    {item.ipAddress && <span className="ml-3">IP: {item.ipAddress}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {activities.length > 5 && !expanded && (
            <button type="button" onClick={() => setExpanded(true)}
              className="neu-btn-soft mt-4 w-full justify-center text-sm">
              查看全部 ({activities.length} 条)
            </button>
          )}
          {expanded && activities.length > 5 && (
            <button type="button" onClick={() => setExpanded(false)}
              className="neu-btn-soft mt-4 w-full justify-center text-sm">
              收起
            </button>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter web exec npx tsc --noEmit 2>&1 | grep "tab-activity-log" | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/web/src/components/profile/tab-activity-log.tsx && git commit -m "feat(web): add TabActivityLog audit timeline"
```

---

### Task 10: Frontend — Create TabPreferences (偏好设置)

**Files:**
- Create: `apps/web/src/components/profile/tab-preferences.tsx`

**Interfaces:**
- Consumes: `useUserSettings`, `THEME_OPTIONS`, `HOME_PAGE_OPTIONS`
- Produces: `<TabPreferences />` (uses context, no props)

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { THEME_OPTIONS, HOME_PAGE_OPTIONS, type UserSettings } from '@/lib/api/user-settings';
import { useUserSettings } from '@/lib/user-settings-context';

export function TabPreferences() {
  const { settings, loading, updateSettings } = useUserSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="neu-card-static p-5">
        <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={16} className="animate-spin" />正在加载设置...
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="neu-card-static p-5">
        <div className="flex min-h-[200px] items-center justify-center text-sm text-[color:var(--muted-foreground)]">
          无法加载设置
        </div>
      </div>
    );
  }

  const handleUpdate = async (updates: Partial<UserSettings>) => {
    setSaving(true);
    setError(null);
    try {
      await updateSettings(updates);
    } catch {
      setError('保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Theme */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">主题</h3>
        <div className="mt-4 flex gap-2">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value} type="button" disabled={saving}
              onClick={() => handleUpdate({ theme: option.value })}
              className={[
                'flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                settings.theme === option.value
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)] shadow-[0_2px_8px_rgba(69,99,158,0.08)]'
                  : 'border-white/50 bg-white/50 text-[color:var(--muted-foreground)] hover:bg-white/75',
              ].join(' ')}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Default home page */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">默认首页</h3>
        <div className="mt-4">
          <select
            value={settings.defaultHomePage}
            onChange={(e) => handleUpdate({ defaultHomePage: e.target.value as UserSettings['defaultHomePage'] })}
            disabled={saving}
            className="neu-select w-full max-w-xs"
          >
            {HOME_PAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Compact mode */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">显示偏好</h3>
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-white/50 bg-white/42 p-4">
          <div>
            <div className="text-sm font-medium text-[color:var(--foreground)]">紧凑模式</div>
            <div className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">减少界面间距，显示更多内容</div>
          </div>
          <button
            type="button"
            onClick={() => handleUpdate({ compactMode: !settings.compactMode })}
            disabled={saving}
            className={[
              'relative h-6 w-11 rounded-full transition-all',
              settings.compactMode ? 'bg-[color:var(--accent)]' : 'bg-gray-200',
            ].join(' ')}
          >
            <span className={[
              'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
              settings.compactMode ? 'translate-x-5' : '',
            ].join(' ')}
            />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-[rgba(215,89,89,0.18)] bg-[rgba(255,241,241,0.76)] px-4 py-3 text-sm text-[color:var(--danger)]">
          <span className="mt-0.5 shrink-0">⚠</span>{error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter web exec npx tsc --noEmit 2>&1 | grep "tab-preferences" | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/web/src/components/profile/tab-preferences.tsx && git commit -m "feat(web): add TabPreferences settings panel"
```

---

### Task 11: Frontend — Create PersonalCenterPage (主编排组件)

**Files:**
- Create: `apps/web/src/components/profile/personal-center-page.tsx`

**Interfaces:**
- Consumes: All profile components, `fetchCurrentUser`, `fetchDepartments`, `logout`
- Produces: `<PersonalCenterPage />` — top-level orchestrator

- [ ] **Step 1: Create the main page component**

```typescript
'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect, useState } from 'react';
import { fetchCurrentUser, fetchDepartments, logout } from '@/lib/api/auth';
import type { AuthUser, DepartmentItem } from '@/lib/api/auth';
import { clearWorkspaceCache } from '@/components/work-arrangements/work-arrangements-page';
import { PersonalCenterHero } from './personal-center-hero';
import { PersonalCenterTabBar } from './personal-center-tab-bar';
import type { TabKey } from './personal-center-tab-bar';
import { TabBasicInfo } from './tab-basic-info';
import { TabSecurity } from './tab-security';
import { TabActivityLog } from './tab-activity-log';
import { TabPreferences } from './tab-preferences';

type ExtendedUser = AuthUser & {
  department?: { id: string; name: string; code: string | null } | null;
};

export function PersonalCenterPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('basic-info');
  const [user, setUser] = useState<ExtendedUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [currentUser, depts] = await Promise.all([
          fetchCurrentUser() as Promise<ExtendedUser>,
          fetchDepartments(),
        ]);
        setUser(currentUser);
        setDepartments(depts);
      } catch {
        setUser(null);
      } finally {
        setLoadingUser(false);
      }
    };
    void load();
  }, []);

  const handleUserUpdated = (updated: AuthUser) => {
    setUser((prev) => prev ? { ...prev, ...updated } : prev);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      clearWorkspaceCache();
      startTransition(() => { router.replace('/login'); router.refresh(); });
    } finally {
      setLoggingOut(false);
    }
  };

  if (loadingUser) {
    return (
      <div className="flex min-h-[400px] items-center justify-center gap-3 text-sm text-[color:var(--muted-foreground)]">
        <Loader2 size={20} className="animate-spin" />正在加载个人中心...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 text-sm text-[color:var(--muted-foreground)]">
        <p>无法加载账号信息</p>
        <button type="button" onClick={() => window.location.reload()} className="neu-btn-soft">重试</button>
      </div>
    );
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'basic-info': return <TabBasicInfo user={user} departments={departments} onUserUpdated={handleUserUpdated} />;
      case 'security': return <TabSecurity user={user} />;
      case 'activity-log': return <TabActivityLog />;
      case 'preferences': return <TabPreferences />;
    }
  };

  return (
    <div className="space-y-5">
      <PersonalCenterTabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex gap-5">
        <PersonalCenterHero
          user={user}
          onEdit={() => setActiveTab('basic-info')}
          onChangePassword={() => setActiveTab('security')}
          onLogout={handleLogout}
          loggingOut={loggingOut}
        />
        <div className="min-w-0 flex-1">{renderTabContent()}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter web exec npx tsc --noEmit 2>&1 | grep "personal-center-page" | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/web/src/components/profile/personal-center-page.tsx && git commit -m "feat(web): add PersonalCenterPage main orchestrator"
```

---

### Task 12: Frontend — Update route page, sidebar, and layout

**Files:**
- Modify: `apps/web/src/app/(main)/profile/page.tsx`
- Modify: `apps/web/src/app/(main)/layout.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`

**Interfaces:**
- Consumes: `PersonalCenterPage` from Task 11

- [ ] **Step 1: Update profile/page.tsx**

Replace entire file with:
```typescript
'use client';

import { PersonalCenterPage } from '@/components/profile/personal-center-page';

export default function ProfileRoute() {
  return <PersonalCenterPage />;
}
```

- [ ] **Step 2: Update (main)/layout.tsx**

Change line 16:
```typescript
// Before: "/profile": "profile-edit",
// After:
"/profile": "personal-center",
```

Change line 31:
```typescript
// Before: "/profile": "资料修改",
// After:
"/profile": "个人中心",
```

- [ ] **Step 3: Update app-shell.tsx sidebar nav item**

Change line 57:
```typescript
// Before:
{ key: "profile-edit", label: "资料修改", href: "/profile", icon: Settings, meta: "资料/密码修改" },
// After:
{ key: "personal-center", label: "个人中心", href: "/profile", icon: UserRound, meta: "管理个人资料与偏好" },
```

- [ ] **Step 4: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git add apps/web/src/app/\(main\)/profile/page.tsx apps/web/src/app/\(main\)/layout.tsx apps/web/src/components/app-shell.tsx && git commit -m "feat(web): wire PersonalCenterPage, update sidebar label to 个人中心"
```

---

### Task 13: Frontend — Delete old files and fix UserCenterPanel references

**Files:**
- Delete: `apps/web/src/components/profile-page.tsx`
- Delete: `apps/web/src/components/user-center-panel.tsx`
- Modify: `apps/web/src/components/app-user-actions.tsx` (if it imports UserCenterPanel)

- [ ] **Step 1: Check app-user-actions.tsx for UserCenterPanel references**

```bash
grep -n "user-center-panel\|UserCenterPanel" /Users/qihao/ERP2/ERP/water-erp/apps/web/src/components/app-user-actions.tsx
```

If there are references, remove them. The user avatar button can remain as a simple button showing username — since the full PersonalCenterPage replaces the modal.

- [ ] **Step 2: Delete old files**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git rm apps/web/src/components/profile-page.tsx apps/web/src/components/user-center-panel.tsx
```

- [ ] **Step 3: Fix app-user-actions.tsx if needed**

If it imported `UserCenterPanel`, remove the import and render. Replace any `setShowPanel(true)` with router navigation to `/profile`:
```typescript
import { useRouter } from 'next/navigation';
// ...
const router = useRouter();
// In the click handler:
router.push('/profile');
```

- [ ] **Step 4: Verify no broken imports**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter web exec npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors about `profile-page` or `user-center-panel`.

- [ ] **Step 5: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && git add -A && git commit -m "chore(web): remove old profile-page and user-center-panel, fix references"
```

---

### Task 14: Verification — Run and screenshot

- [ ] **Step 1: Start servers**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm dev:api & pnpm dev:web
```

- [ ] **Step 2: Login and navigate**

Open http://localhost:3005, login as `Swhi-CGZX-admin` / `abc123`, click "个人中心" in sidebar.

- [ ] **Step 3: Tab 1 — 基本资料**

- Verify left hero card shows: displayName, role badge, department, email, username, 创建时间
- Verify right side shows: 账号信息 (read-only) + 编辑资料 form (name/email/department inputs)
- Edit fields → click 保存修改 → hero card updates in real-time
- Verify save button disabled when no changes
- Screenshot

- [ ] **Step 4: Tab 2 — 账号安全**

- Click tab → verify password change form + login info card
- Submit password change → verify success message
- Screenshot

- [ ] **Step 5: Tab 3 — 操作日志**

- Verify recent activity list with action labels and timestamps
- Click 查看全部 → verify expanded list
- Screenshot

- [ ] **Step 6: Tab 4 — 偏好设置**

- Verify theme toggle, default homepage dropdown, compact mode switch
- Toggle theme → verify immediate visual change
- Screenshot

- [ ] **Step 7: Cross-tab navigation**

- Click 编辑资料 in hero → switches to Tab 1
- Click 修改密码 in hero → switches to Tab 2

- [ ] **Step 8: Logout**

- Click 退出登录 → verify redirect to /login
