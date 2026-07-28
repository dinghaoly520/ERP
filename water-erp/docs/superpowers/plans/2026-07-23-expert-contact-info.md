# 专家联系方式展示与首次登录确认 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在专家门户 `/profile` 页面展示完整个人资料（姓名、邮箱、专业、职称、工作单位、手机、身份证号），并在专家首次登录时弹窗确认手机号（必填）、邮箱（选填），确保平台能联系上专家。

**Architecture:** 后端为 `ExpertProfile` 新增 `contactConfirmedAt` 时间戳字段标记是否已确认联系方式；扩展 `GET /expert/profile` 返回 `expertProfile` 关联数据用于页面展示；新增两个轻量端点（`GET /expert/profile/contact-check` 检查确认状态、`POST /expert/profile/confirm-contact` 提交确认）。前端在 `/profile` 资料卡片中渲染新增字段，并在 `AppShell` 层集成一个首次登录强制确认弹窗（`contactConfirmedAt === null` 时显示，确认后永不再现）。

**Tech Stack:** NestJS 11 + Prisma（API）、Next.js 16 App Router + React 19 + Tailwind CSS v4（expert-portal）、class-validator（DTO）、Jest（单元测试）。

## Global Constraints

- **数据库迁移禁止交互式 `migrate dev`**：main 分支存在 DB/migration drift，任何 `prisma migrate dev` 都会要求 reset（数据丢失）。必须用「手写迁移 SQL → `prisma db execute` → `prisma migrate resolve --applied` → `prisma generate`」流程。
- **提交后不 push**：每个任务可 `git commit`，但**不得** `git push`（用户明确要求每轮等待其确认后才 push）。
- **设计系统**：遵循 `.impeccable.md` 工业精密风格——按钮用实色 `bg-[#064ea2]`，禁止渐变按钮、emoji 图标、Material 风格阴影。弹窗样式与 expert-portal 现有组件（`rounded-xl` 输入框、`#064ea2` 主色、`#18243a` 文字）保持一致。
- **DTO 校验**：`ValidationPipe` 全局启用 `whitelist: true, transform: true`。DTO 必须用 class-validator 装饰器显式声明每个字段。
- **手机号格式**：11 位中国大陆手机号，正则 `/^1[3-9]\d{9}$/`（与 admin 端 `expert/[id]` 编辑弹窗一致）。
- **专家侧 controller 路由**：`ExpertController` 带类级 `@Roles('bid_expert')`，新增端点自动继承该角色守卫，无需额外装饰器。

---

## File Structure

| 文件 | 操作 | 责任 |
|------|------|------|
| `apps/api/prisma/schema.prisma` | 修改 | `ExpertProfile` 增加 `contactConfirmedAt DateTime?` |
| `apps/api/prisma/migrations/20260723120000_add_expert_contact_confirmed_at/migration.sql` | 新建 | 手写迁移 SQL（ADD COLUMN） |
| `apps/api/src/expert/dto/confirm-contact.dto.ts` | 新建 | `ConfirmContactDto`（phone 必填 + email 选填） |
| `apps/api/src/expert/expert.service.ts` | 修改 | `getProfile` 增加 expertProfile include；新增 `getContactCheck`、`confirmContact` |
| `apps/api/src/expert/expert.controller.ts` | 修改 | 注册 `GET profile/contact-check`、`POST profile/confirm-contact` |
| `apps/api/src/expert/expert.service.spec.ts` | 修改 | 为新增方法补单元测试；`$transaction` mock 兼容数组形式 |
| `apps/expert-portal/src/app/(app)/profile/page.tsx` | 修改 | 资料卡片展示 专业/职称/工作单位/手机/身份证号 |
| `apps/expert-portal/src/components/contact-confirm-modal.tsx` | 新建 | 首次登录联系方式确认弹窗组件 |
| `apps/expert-portal/src/components/app-shell.tsx` | 修改 | 挂载后拉取 contact-check，未确认则渲染弹窗 |

---

## Task 1: Prisma Schema — 新增 `contactConfirmedAt` 字段并迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma:647-669`（`ExpertProfile` model）
- Create: `apps/api/prisma/migrations/20260723120000_add_expert_contact_confirmed_at/migration.sql`

**Interfaces:**
- Produces: `ExpertProfile.contactConfirmedAt`（`DateTime?`，`null` 表示未确认）；Prisma Client 重新生成后 `prisma.expertProfile` 的类型包含该字段。

- [ ] **Step 1: 在 `ExpertProfile` model 中追加字段**

在 `apps/api/prisma/schema.prisma` 的 `ExpertProfile` model 中，`retireReason` 行之后、`createdAt` 行之前插入一行：

```prisma
  contactConfirmedAt DateTime? // 首次登录联系方式确认时间（null = 未确认，需弹窗提醒）
```

插入后该 model 相关片段应为：

```prisma
  retiredAt    DateTime? // Track D: 退库时间（人工确认后写入）
  retireReason String? // Track D: 退库原因
  contactConfirmedAt DateTime? // 首次登录联系方式确认时间（null = 未确认，需弹窗提醒）
  createdAt    DateTime  @default(now())
```

- [ ] **Step 2: 手写迁移 SQL（不用交互式 migrate dev）**

```bash
cd /home/asus/桌面/ERP/water-erp
mkdir -p apps/api/prisma/migrations/20260723120000_add_expert_contact_confirmed_at
cat > apps/api/prisma/migrations/20260723120000_add_expert_contact_confirmed_at/migration.sql <<'EOF'
-- AlterTable
ALTER TABLE "ExpertProfile" ADD COLUMN "contactConfirmedAt" TIMESTAMP(3);
EOF
```

- [ ] **Step 3: 直连数据库应用 DDL**

```bash
cd /home/asus/桌面/ERP/water-erp
DATABASE_URL="postgresql://water_erp:water_erp_dev@localhost:5432/water_erp" \
  pnpm --filter api exec prisma db execute \
  --file prisma/migrations/20260723120000_add_expert_contact_confirmed_at/migration.sql
```

Expected: 无报错（`prisma db execute` 成功时静默或输出空）。

- [ ] **Step 4: 标记迁移为已应用**

```bash
cd /home/asus/桌面/ERP/water-erp
DATABASE_URL="postgresql://water_erp:water_erp_dev@localhost:5432/water_erp" \
  pnpm --filter api exec prisma migrate resolve --applied 20260723120000_add_expert_contact_confirmed_at
```

Expected: 输出 `Migration 20260723120000_add_expert_contact_confirmed_at marked as applied.`

- [ ] **Step 5: 重新生成 Prisma Client**

```bash
cd /home/asus/桌面/ERP/water-erp
pnpm --filter api exec prisma generate
```

Expected: 输出 `✔ Generated Prisma Client`。

- [ ] **Step 6: Commit**

```bash
cd /home/asus/桌面/ERP/water-erp
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260723120000_add_expert_contact_confirmed_at
git commit -m "feat(api): ExpertProfile 增加 contactConfirmedAt 字段（首次登录联系确认）"
```

---

## Task 2: 后端 — DTO + Service + Controller（联系方式检查与确认）

**Files:**
- Create: `apps/api/src/expert/dto/confirm-contact.dto.ts`
- Modify: `apps/api/src/expert/expert.service.ts`（`getProfile` + 新增两方法）
- Modify: `apps/api/src/expert/expert.controller.ts`（注册两端点）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Consumes: `prisma.expertProfile.findUnique/upsert`、`prisma.user.findUnique/update`、`prisma.$transaction`（Task 1 生成的 Client）。
- Produces:
  - `GET /api/expert/profile` 响应新增 `expertProfile: { specialty, title, employer, phone, idNumber, ethnicity, education, licenseNo, contactConfirmedAt } | null`。
  - `GET /api/expert/profile/contact-check` → `{ displayName: string, phone: string, email: string, contactConfirmedAt: string | null }`。
  - `POST /api/expert/profile/confirm-contact`（body `ConfirmContactDto`）→ 同 contact-check 形状（确认后 `contactConfirmedAt` 非空）。

- [ ] **Step 1: 创建 `ConfirmContactDto`**

新建 `apps/api/src/expert/dto/confirm-contact.dto.ts`：

```ts
import { IsString, IsOptional, IsEmail, Matches } from 'class-validator';

export class ConfirmContactDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '请输入正确的11位手机号' })
  phone!: string;

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;
}
```

- [ ] **Step 2: 修改 `getProfile` — include expertProfile**

在 `apps/api/src/expert/expert.service.ts` 中，将 `getProfile` 的 `user.findUnique` 调用（当前第 40 行）替换为带 `include` 的版本：

```ts
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        expertProfile: {
          select: {
            specialty: true,
            title: true,
            employer: true,
            phone: true,
            idNumber: true,
            ethnicity: true,
            education: true,
            licenseNo: true,
            contactConfirmedAt: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException({ error: '用户不存在', code: 'USER_NOT_FOUND' });
    const expertRecords = await this.prisma.bidExpert.findMany({
      where: {
        userId,
        project: { stage: { in: ['OPENING', 'EVALUATING', 'ARCHIVED'] } },
      },
      include: {
        project: { select: { id: true, projectCode: true, name: true, stage: true, openTime: true } },
        scoreRecords: { include: { scoreItem: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const { passwordHash, ...safeUser } = user;
    return { ...safeUser, assignments: expertRecords, averageScore: this.computeAverageScore(expertRecords) };
  }
```

（仅 `findUnique` 的入参变化，其余逻辑不变；`safeUser` 会自动携带 `expertProfile`。）

- [ ] **Step 3: 新增 `getContactCheck` 与 `confirmContact` 方法**

在 `expert.service.ts` 中 `updateProfile` 方法之后、`/* ── 统计概览 ── */` 注释之前插入：

```ts
  /* ── 联系方式确认（首次登录弹窗）── */

  async getContactCheck(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, phone: true, email: true },
    });
    if (!user) throw new NotFoundException({ error: '用户不存在', code: 'USER_NOT_FOUND' });
    const ep = await this.prisma.expertProfile.findUnique({
      where: { userId },
      select: { phone: true, contactConfirmedAt: true },
    });
    return {
      displayName: user.displayName,
      phone: ep?.phone || user.phone || '',
      email: user.email || '',
      contactConfirmedAt: ep?.contactConfirmedAt || null,
    };
  }

  async confirmContact(userId: string, dto: ConfirmContactDto) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { phone: dto.phone, ...(dto.email && { email: dto.email }) },
      }),
      this.prisma.expertProfile.upsert({
        where: { userId },
        update: { phone: dto.phone, contactConfirmedAt: now },
        create: { userId, specialty: '综合', phone: dto.phone, contactConfirmedAt: now },
      }),
    ]);
    return this.getContactCheck(userId);
  }
```

并在文件顶部 import 区（约第 14 行 `UpdateExpertProfileDto` 之后）添加：

```ts
import { ConfirmContactDto } from './dto/confirm-contact.dto';
```

- [ ] **Step 4: 注册 Controller 端点**

在 `apps/api/src/expert/expert.controller.ts` 顶部 import 区添加：

```ts
import { ConfirmContactDto } from './dto/confirm-contact.dto';
```

在现有 `updateProfile` 端点（`@Patch('profile')`，第 46-49 行）之后插入两个端点：

```ts
  @Get('profile/contact-check')
  getContactCheck(@CurrentUser('sub') userId: string) {
    return this.expertService.getContactCheck(userId);
  }

  @Post('profile/confirm-contact')
  confirmContact(@CurrentUser('sub') userId: string, @Body() dto: ConfirmContactDto) {
    return this.expertService.confirmContact(userId, dto);
  }
```

> 路由说明：`profile/contact-check` 与 `profile/confirm-contact` 均为两段静态路径，与现有 `@Get('profile')`（精确匹配）及 `@Get('projects/:projectId')`（首段为 `projects`）均不冲突。类级 `@Roles('bid_expert')` 自动生效。

- [ ] **Step 5: 更新单元测试 — `$transaction` mock 兼容数组 + 新增用例**

在 `apps/api/src/expert/expert.service.spec.ts` 中：

(a) 将 prisma mock 里 `$transaction` 一行（当前约第 66 行）：

```ts
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
```

替换为同时兼容数组与回调两种形式：

```ts
      $transaction: jest.fn(async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma))),
```

(b) 在 prisma mock 对象中（`user` 之后）补充 `expertProfile`：

```ts
      expertProfile: { findUnique: jest.fn(), upsert: jest.fn() },
```

(c) 在 `describe('getStatistics', ...)` 之前插入新的 describe 块：

```ts
  describe('getContactCheck / confirmContact', () => {
    it('未确认联系方式时 contactConfirmedAt 为 null', async () => {
      prisma.user.findUnique.mockResolvedValue({ displayName: '刘苡池', phone: null, email: null });
      prisma.expertProfile.findUnique.mockResolvedValue(null);

      const result = await service.getContactCheck('user-1');

      expect(result).toEqual({ displayName: '刘苡池', phone: '', email: '', contactConfirmedAt: null });
    });

    it('confirmContact 应同步写入 User/ExpertProfile 并打上确认时间戳', async () => {
      prisma.user.update.mockResolvedValue({});
      prisma.expertProfile.upsert.mockResolvedValue({});
      // confirmContact 末尾会调用 getContactCheck 重新读取
      prisma.user.findUnique.mockResolvedValue({ displayName: '刘苡池', phone: '13800138000', email: 'liu@example.com' });
      prisma.expertProfile.findUnique.mockResolvedValue({ phone: '13800138000', contactConfirmedAt: new Date('2026-07-23T10:00:00Z') });

      const result = await service.confirmContact('user-1', { phone: '13800138000', email: 'liu@example.com' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' }, data: expect.objectContaining({ phone: '13800138000', email: 'liu@example.com' }) }),
      );
      expect(prisma.expertProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          update: expect.objectContaining({ phone: '13800138000', contactConfirmedAt: expect.any(Date) }),
        }),
      );
      expect(result.contactConfirmedAt).not.toBeNull();
      expect(result.phone).toBe('13800138000');
    });
  });
```

- [ ] **Step 6: 运行单元测试验证**

```bash
cd /home/asus/桌面/ERP/water-erp
pnpm --filter api test -- expert.service.spec
```

Expected: 全部 PASS（含新增的 2 个用例）。

- [ ] **Step 7: 编译 API 验证类型**

```bash
cd /home/asus/桌面/ERP/water-erp
pnpm --filter api exec nest build
```

Expected: 无 TypeScript 报错，生成 `apps/api/dist`。

- [ ] **Step 8: Commit**

```bash
cd /home/asus/桌面/ERP/water-erp
git add apps/api/src/expert/dto/confirm-contact.dto.ts apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.controller.ts apps/api/src/expert/expert.service.spec.ts
git commit -m "feat(api): 专家联系方式确认端点 contact-check/confirm-contact + getProfile 返回 expertProfile"
```

---

## Task 3: 前端 — `/profile` 页面展示完整资料字段

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/profile/page.tsx`

**Interfaces:**
- Consumes: `GET /api/expert/profile` 新增的 `expertProfile` 字段（Task 2 产出）。
- Produces: 资料卡片展示 姓名/用户名/手机/邮箱/专业/职称/工作单位/身份证号/角色。

- [ ] **Step 1: 扩展 `ExpertProfile` 接口**

在 `apps/expert-portal/src/app/(app)/profile/page.tsx` 中，将 `ExpertProfile` 接口（第 11-19 行）替换为：

```ts
interface ExpertProfile {
  id: string; username: string; displayName: string; email: string; role: string; isActive: boolean;
  phone?: string;
  averageScore: number;
  expertProfile?: {
    specialty?: string; title?: string; employer?: string; phone?: string;
    idNumber?: string; ethnicity?: string; education?: string; licenseNo?: string;
    contactConfirmedAt?: string | null;
  } | null;
  assignments: {
    id: string; expertName: string; major: string; signedIn: boolean; avoidanceConfirmed: boolean; progress: number; totalScore: number; createdAt: string;
    project: { id: string; projectCode: string; name: string; stage: string; openTime: string };
    scoreRecords: { id: string; score: number; reason?: string; scoreItem: { category: string; name: string; maxScore: number } }[];
  }[];
}
```

- [ ] **Step 2: 扩展资料卡片展示字段**

将只读视图中的字段网格（第 112-124 行，当前渲染 用户名/姓名/邮箱/角色 四项）替换为完整字段集：

```tsx
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-x-12 gap-y-4">
                    {[
                      ['姓名', profile.displayName],
                      ['用户名', profile.username],
                      ['手机', profile.expertProfile?.phone || profile.phone || '未设置'],
                      ['邮箱', profile.email || '未设置'],
                      ['专业', profile.expertProfile?.specialty || '未设置'],
                      ['职称', profile.expertProfile?.title || '未设置'],
                      ['工作单位', profile.expertProfile?.employer || '未设置'],
                      ['身份证号', profile.expertProfile?.idNumber || '未设置'],
                      ['角色', '评审专家'],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <p className="text-xs font-semibold text-[#5a6d8a] mb-1">{label}</p>
                        <p className="text-sm font-bold text-[#18243a]">{value}</p>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#bfdbfe] bg-[#eff6ff]/50 px-4 py-2 text-sm font-bold text-[#064ea2] hover:bg-[#eff6ff]/70 transition"
                  >
                    <Pencil size={14} strokeWidth={1.5} />
                    编辑资料
                  </button>
                </div>
```

（编辑表单保持现状——仅 姓名 + 邮箱；手机号的维护入口为首次登录弹窗。）

- [ ] **Step 3: 类型检查**

```bash
cd /home/asus/桌面/ERP/water-erp
pnpm --filter expert-portal exec tsc --noEmit
```

Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
cd /home/asus/桌面/ERP/water-erp
git add apps/expert-portal/src/app/(app)/profile/page.tsx
git commit -m "feat(expert-portal): /profile 展示专业/职称/工作单位/手机/身份证号"
```

---

## Task 4: 前端 — 首次登录联系方式确认弹窗

**Files:**
- Create: `apps/expert-portal/src/components/contact-confirm-modal.tsx`
- Modify: `apps/expert-portal/src/components/app-shell.tsx`

**Interfaces:**
- Consumes: `GET /api/expert/profile/contact-check`、`POST /api/expert/profile/confirm-contact`（Task 2 产出）。
- Produces: `contactConfirmedAt === null` 时，AppShell 内渲染强制确认弹窗；确认后弹窗消失且不再出现。

- [ ] **Step 1: 创建 `ContactConfirmModal` 组件**

新建 `apps/expert-portal/src/components/contact-confirm-modal.tsx`：

```tsx
'use client';

import { useState } from 'react';
import { Phone, Mail, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from 'sonner';

interface ContactConfirmModalProps {
  initialPhone: string;
  initialEmail: string;
  displayName: string;
  onConfirmed: () => void;
}

export default function ContactConfirmModal({ initialPhone, initialEmail, displayName, onConfirmed }: ContactConfirmModalProps) {
  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState(initialEmail);
  const [saving, setSaving] = useState(false);
  const [phoneError, setPhoneError] = useState('');

  const handleConfirm = async () => {
    const trimmedPhone = phone.trim();
    if (!/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      setPhoneError('请输入正确的11位手机号');
      return;
    }
    setPhoneError('');
    setSaving(true);
    try {
      const body: { phone: string; email?: string } = { phone: trimmedPhone };
      const trimmedEmail = email.trim();
      if (trimmedEmail) body.email = trimmedEmail;
      await api.post('/expert/profile/confirm-contact', body);
      toast.success('联系方式已确认');
      onConfirmed();
    } catch {
      toast.error('确认失败，请重试');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0f172a]/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-[#dbe6f3] bg-white shadow-2xl">
        <div className="border-b border-[#eef3fa] p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#064ea2]/10 text-[#064ea2]">
              <ShieldCheck size={22} strokeWidth={1.5} />
            </span>
            <div>
              <h3 className="text-lg font-black text-[#18243a]">确认联系方式</h3>
              <p className="text-sm text-[#5a6d8a]">{displayName}，请确认以下信息，确保我们能联系到您</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-1.5 block text-sm font-bold text-[#18243a]">
              手机号 <span className="text-[#e74c3c]">*</span>
            </label>
            <div className="relative">
              <Phone size={16} strokeWidth={1.5} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a96aa]" />
              <input
                value={phone}
                onChange={e => { setPhone(e.target.value); setPhoneError(''); }}
                maxLength={11}
                placeholder="请输入11位手机号"
                className="w-full rounded-xl border border-[#e5ecf4] py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-[#064ea2] focus:shadow-[0_0_0_3px_rgba(6,78,162,0.10)]"
              />
            </div>
            {phoneError && <p className="mt-1 text-xs text-[#e74c3c]">{phoneError}</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold text-[#18243a]">邮箱（选填）</label>
            <div className="relative">
              <Mail size={16} strokeWidth={1.5} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a96aa]" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="用于接收通知（可留空）"
                className="w-full rounded-xl border border-[#e5ecf4] py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-[#064ea2] focus:shadow-[0_0_0_3px_rgba(6,78,162,0.10)]"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-[#eef3fa] p-6 pt-4">
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="w-full rounded-xl bg-[#064ea2] py-2.5 text-sm font-bold text-white transition hover:bg-[#054280] disabled:opacity-50"
          >
            {saving ? '确认中...' : '确认联系方式'}
          </button>
          <p className="mt-3 text-center text-xs text-[#8a96aa]">确认后将用于评审通知与身份核验</p>
        </div>
      </div>
    </div>
  );
}
```

> 弹窗为**强制确认**型：无关闭按钮、无点击遮罩关闭、无跳过入口——唯一出路是提交合法手机号。这是「保证能联系上专家」的产品要求。

- [ ] **Step 2: 在 `AppShell` 中集成弹窗**

在 `apps/expert-portal/src/components/app-shell.tsx` 顶部 import 区追加：

```tsx
import ContactConfirmModal from './contact-confirm-modal';
import { api } from '../lib/api';
```

在组件内部 `const [authRetrying, setAuthRetrying] = useState(false);` 之后新增状态：

```tsx
  const [contactInfo, setContactInfo] = useState<{ phone: string; email: string; displayName: string; contactConfirmedAt: string | null } | null>(null);
```

在 `useEffect(() => { checkAuth(); }, []);` 之后新增副作用：

```tsx
  useEffect(() => {
    if (!user) return;
    api.get<{ phone: string; email: string; displayName: string; contactConfirmedAt: string | null }>('/expert/profile/contact-check')
      .then(setContactInfo)
      .catch(() => { /* 检查失败时不阻断使用（fail-open） */ });
  }, [user]);
```

在 `return (` 的 JSX 中，最外层 `<div>` 的**最后一个子元素**（即 `</div>` 闭合标签之前）追加弹窗渲染：

```tsx
      {contactInfo && !contactInfo.contactConfirmedAt && (
        <ContactConfirmModal
          initialPhone={contactInfo.phone}
          initialEmail={contactInfo.email}
          displayName={contactInfo.displayName}
          onConfirmed={() => setContactInfo(prev => (prev ? { ...prev, contactConfirmedAt: new Date().toISOString() } : prev))}
        />
      )}
```

- [ ] **Step 3: 类型检查**

```bash
cd /home/asus/桌面/ERP/water-erp
pnpm --filter expert-portal exec tsc --noEmit
```

Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
cd /home/asus/桌面/ERP/water-erp
git add apps/expert-portal/src/components/contact-confirm-modal.tsx apps/expert-portal/src/components/app-shell.tsx
git commit -m "feat(expert-portal): 首次登录强制确认手机号/邮箱弹窗"
```

---

## Task 5: 构建与集成验证

**Files:** 无新增/修改（纯验证）。

- [ ] **Step 1: 全量编译 API + expert-portal**

```bash
cd /home/asus/桌面/ERP/water-erp
pnpm --filter api exec nest build
pnpm --filter expert-portal exec tsc --noEmit
```

Expected: 两者均无报错。

- [ ] **Step 2: 后端单元测试回归**

```bash
cd /home/asus/桌面/ERP/water-erp
pnpm --filter api test -- expert.service.spec
```

Expected: 全部 PASS。

- [ ] **Step 3: 手动端到端验证（需 API :4001 与 expert-portal :3006 已启动）**

1. 用专家账号登录 `http://localhost:3006`（如 `刘苡池` / `expert@2026`）。
2. 若该专家 `contactConfirmedAt` 为空 → 应弹出「确认联系方式」弹窗，无法关闭。
3. 输入非法手机号（如 `123`）→ 显示「请输入正确的11位手机号」，不提交。
4. 输入合法手机号 + 可选邮箱 → 点确认 → toast「联系方式已确认」，弹窗消失。
5. 刷新页面 → 弹窗不再出现。
6. 访问 `http://localhost:3006/profile` → 资料卡片应展示 姓名/用户名/手机/邮箱/专业/职称/工作单位/身份证号/角色。
7. （可选）用 SQL 复核：`SELECT phone, "contactConfirmedAt" FROM "ExpertProfile" WHERE "userId" = '<该专家id>';` 应有值。

- [ ] **Step 4: 汇总未推送提交**

```bash
cd /home/asus/桌面/ERP/water-erp
git status && git log --oneline origin/main..HEAD
```

Expected: 列出本次新增的 4 个提交。**不要 push**——等待用户明确指示。

---

## Self-Review

**Spec coverage（需求 → 任务）:**
- 「姓名、邮箱、专业、职称、工作单位、手机、身份证号展示在专家页面」→ Task 3 ✅
- 「首次登录弹窗提醒手机号是否需要修改」→ Task 4（强制确认弹窗，预填当前手机号供修改）✅
- 「邮箱号备选修改」→ Task 4（邮箱选填输入框）✅
- 「保证能联系上专家」→ Task 4（弹窗不可跳过 + 手机号必填校验）✅
- 后端支撑（字段存储、状态标记、端点）→ Task 1 + Task 2 ✅

**Placeholder scan:** 无 TBD/TODO；所有代码步骤均含完整代码块；迁移/构建/测试命令均给出预期输出。✅

**Type consistency:**
- `expertProfile` 字段名在 schema（Task 1）、service select（Task 2）、前端接口（Task 3）三处一致。✅
- `contactConfirmedAt` 命名在 schema、DTO-less service、contact-check 响应、前端判断处一致。✅
- `ConfirmContactDto.phone` 必填 / `email` 选填，与前端 `handleConfirm` 仅在非空时携带 email 的逻辑对齐。✅
- `$transaction` mock 兼容数组形式（Task 2 Step 5a），与 `confirmContact` 的数组用法匹配。✅

**已知边界（记录，不处理）:**
- 联系方式后续变更入口：本期仅首次登录弹窗可改手机号；profile 页编辑表单维持 姓名+邮箱。若需常态维护，为后续独立需求。
- 存量专家 `contactConfirmedAt` 均为 null → 上线后每位专家下次登录都会弹一次窗，属预期（一次性确认）。
