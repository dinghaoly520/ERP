# Supplier Auth and Registration Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the current supplier portal brand while improving the login hierarchy, unifying formal and temporary registration flows, and persisting business tags for temporary suppliers.

**Architecture:** Keep page-owned business state and submission logic, while extracting a small shared registration shell, stepper, section wrapper, password field, and controlled business-tag field. Extend the existing temporary-registration API contract and reuse the formal-registration custom-tag transaction behavior. Work against the current checkout because the target files already contain the user's latest uncommitted design; do not replace them with an older worktree snapshot.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Lucide React, CSS, NestJS 11, class-validator, Prisma 6, Jest 30.

---

## Working-tree guard

The following target files are already modified before this plan and are the source of truth:

- `apps/api/src/supplier/supplier.service.ts`
- `apps/supplier-portal-next/src/app/globals.css`
- `apps/supplier-portal-next/src/app/login/page.tsx`
- `apps/supplier-portal-next/src/app/register/page.tsx`
- `apps/supplier-portal-next/src/app/register-temporary/page.tsx`
- `apps/supplier-portal-next/src/styles/pages/register2.css`

Before and after each task, inspect the focused diff. Do not reset, restore, or stage unrelated changes. Implementation commits are intentionally deferred because staging whole dirty files would absorb pre-existing user work.

## File map

**Create**

- `apps/api/src/supplier/supplier.temporary-register.spec.ts`: DTO and service tests for temporary registration tags.
- `apps/supplier-portal-next/src/components/registration/registration-shell.tsx`: shared branded shell, stepper, registration section, and page actions.
- `apps/supplier-portal-next/src/components/registration/business-tag-field.tsx`: controlled 2-to-8 business-tag selector and custom-tag input.
- `apps/supplier-portal-next/src/components/registration/password-field.tsx`: accessible password input with Lucide visibility icons.

**Modify**

- `apps/api/src/supplier/dto/register-temporary-supplier.dto.ts`: validate the new `tags` payload.
- `apps/api/src/supplier/supplier.service.ts`: normalize, persist, and register custom tags for temporary suppliers.
- `apps/supplier-portal-next/src/lib/auth.ts`: add `tags` to `RegisterTemporaryParams`.
- `apps/supplier-portal-next/src/app/login/page.tsx`: implement approved login option B.
- `apps/supplier-portal-next/src/app/register/page.tsx`: reorganize the six current sections into five shared-shell steps.
- `apps/supplier-portal-next/src/app/register-temporary/page.tsx`: convert the long form into four shared-shell steps and submit tags.
- `apps/supplier-portal-next/src/app/globals.css`: refine login-only layout and remove malformed inert selectors.
- `apps/supplier-portal-next/src/styles/pages/register2.css`: shared registration shell, one-accent modules, responsive rules, focus/error states.
- `AGENTS.md`: replace the obsolete five-app map with the current runtime map, commands, and role routing.

### Task 1: Lock the temporary-tag API contract with failing tests

**Files:**

- Create: `apps/api/src/supplier/supplier.temporary-register.spec.ts`

- [ ] **Step 1: Add DTO validation cases**

Create a test using `plainToInstance` and `validate` so the payload must contain 2 to 8 non-empty tags, each no longer than 20 characters:

```ts
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { RegisterTemporarySupplierDto } from './dto/register-temporary-supplier.dto';
import { SupplierService } from './supplier.service';

const dtoPayload = {
  invitationCode: 'ABCDEFGH',
  name: '四川示例水利设备有限公司',
  creditCode: '91510100MA6ABCDEFG',
  legalPerson: '张三',
  legalPersonIdCard: '51010419900101123X',
  displayName: '李四',
  password: 'supplier2026',
  phone: '13800138000',
  tags: ['水利工程', '泵站设备'],
};

describe('RegisterTemporarySupplierDto business tags', () => {
  it.each([
    [undefined, true],
    [[], true],
    [['水利工程'], true],
    [Array.from({ length: 9 }, (_, i) => `标签${i}`), true],
    [['水利工程', '超过二十个字符的自定义业务标签名称不允许提交'], true],
    [['水利工程', '泵站设备'], false],
  ])('validates %p', async (tags, shouldFail) => {
    const dto = plainToInstance(RegisterTemporarySupplierDto, { ...dtoPayload, tags });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'tags')).toBe(shouldFail);
  });
});
```

- [ ] **Step 2: Add the service persistence case**

In the same spec, construct `SupplierService` with a transaction mock and assert normalized tags are written to the supplier while unknown tags become pending catalog entries:

```ts
describe('SupplierService.registerTemporary business tags', () => {
  let service: SupplierService;
  let prisma: any;
  let tx: any;

  beforeEach(async () => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ supplier_no: 'SUP-000001' }]),
      user: {
        create: jest.fn().mockResolvedValue({ id: 'user-1', username: dtoPayload.creditCode, passwordHash: 'hash' }),
      },
      supplier: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'supplier-1', name: data.name, creditCode: data.creditCode, tags: data.tags })),
      },
      supplierInvitation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      businessTag: {
        findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(where.name === '水利工程' ? { id: 'tag-1' } : null)),
        create: jest.fn().mockResolvedValue({ id: 'tag-2' }),
      },
    };
    prisma = {
      supplierInvitation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'invite-1', code: 'ABCDEFGH', status: 'ACTIVE', validityDays: 30,
          expiresAt: new Date('2099-01-01T00:00:00.000Z'), boundCreditCode: null,
        }),
      },
      supplier: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const module = await Test.createTestingModule({
      providers: [
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn().mockResolvedValue(undefined) } },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  it('normalizes, persists, and registers custom tags in the invitation transaction', async () => {
    await service.registerTemporary({
      ...dtoPayload,
      tags: [' 水利工程 ', '泵站设备', '水利工程'],
    } as RegisterTemporarySupplierDto);

    expect(tx.supplier.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tags: ['水利工程', '泵站设备'] }),
    }));
    expect(tx.businessTag.create).toHaveBeenCalledWith({
      data: {
        name: '泵站设备',
        status: 'PENDING',
        source: 'supplier_register',
        createdBySupplierId: 'supplier-1',
      },
    });
  });

  it('rejects a payload that collapses below two unique tags', async () => {
    await expect(service.registerTemporary({
      ...dtoPayload,
      tags: ['水利工程', ' 水利工程 '],
    } as RegisterTemporarySupplierDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the focused test and verify the red state**

Run:

```bash
pnpm --filter api test -- supplier.temporary-register.spec.ts --runInBand
```

Expected: the DTO cases and persistence assertions fail because `tags` is absent from the temporary DTO and service.

### Task 2: Implement temporary-tag validation and transaction persistence

**Files:**

- Modify: `apps/api/src/supplier/dto/register-temporary-supplier.dto.ts`
- Modify: `apps/api/src/supplier/supplier.service.ts`

- [ ] **Step 1: Add the DTO field and validators**

Extend the class-validator import and add the required field:

```ts
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

@IsArray()
@ArrayMinSize(2)
@ArrayMaxSize(8)
@IsString({ each: true })
@IsNotEmpty({ each: true })
@MaxLength(20, { each: true })
tags: string[];
```

- [ ] **Step 2: Normalize temporary-registration tags before opening the transaction**

Extend the existing business-tag import and add a module-level helper plus a temporary-registration guard:

```ts
import { generateBusinessTags, TAG_MAX, TAG_MIN } from './business-tags';

function normalizeRegistrationTags(tags: string[]): string[] {
  return [...new Set((tags || []).map((tag) => tag.trim()).filter(Boolean))];
}

private validateRegistrationTags(tags: string[]): string[] {
  const normalized = normalizeRegistrationTags(tags);
  if (normalized.length < TAG_MIN || normalized.length > TAG_MAX) {
    throw new BadRequestException({
      error: `业务标签须选择 ${TAG_MIN} 至 ${TAG_MAX} 项`,
      code: 'INVALID_BUSINESS_TAGS',
    });
  }
  return normalized;
}
```

In `registerTemporary()`, compute `submittedTags` before any create operation and write that normalized array to `supplier.tags`. Leave the formal-registration persistence path otherwise unchanged; its request is already protected by `RegisterSupplierDto` and its existing custom-tag transaction.

- [ ] **Step 3: Mirror the formal custom-tag transaction logic**

Inside the temporary registration transaction, after the supplier is created and before the invitation is claimed:

```ts
const customTags: string[] = [];
for (const tag of submittedTags) {
  const exists = await tx.businessTag.findUnique({ where: { name: tag } });
  if (!exists) {
    await tx.businessTag.create({
      data: {
        name: tag,
        status: 'PENDING',
        source: 'supplier_register',
        createdBySupplierId: supplier.id,
      },
    });
    customTags.push(tag);
  }
}
(supplier as typeof supplier & { _customTags?: string[] })._customTags = customTags;
```

Keep the existing post-transaction notification block, which now receives `_customTags` from the transaction result.

- [ ] **Step 4: Run focused and existing registration tests**

Run:

```bash
pnpm --filter api test -- supplier.temporary-register.spec.ts supplier.register.spec.ts --runInBand
```

Expected: both suites pass.

- [ ] **Step 5: Build the API**

Run:

```bash
pnpm --filter api build
```

Expected: NestJS TypeScript build exits with status 0.

### Task 3: Build shared registration primitives

**Files:**

- Create: `apps/supplier-portal-next/src/components/registration/registration-shell.tsx`
- Create: `apps/supplier-portal-next/src/components/registration/business-tag-field.tsx`
- Create: `apps/supplier-portal-next/src/components/registration/password-field.tsx`
- Modify: `apps/supplier-portal-next/src/styles/pages/register2.css`

- [ ] **Step 1: Add the shared branded shell and stepper**

Implement typed components with this public contract:

```tsx
export type RegistrationStep = { label: string; description: string };

type RegistrationShellProps = {
  title: string;
  subtitle: string;
  steps: RegistrationStep[];
  currentStep: number;
  maxVisitedStep: number;
  onStepChange: (step: number) => void;
  notice?: React.ReactNode;
  children: React.ReactNode;
  actions: React.ReactNode;
};

export function RegistrationShell(props: RegistrationShellProps) {
  return (
    <main className="reg-page">
      <div className="reg-bg" aria-hidden="true" />
      <Link className="reg-top-brand" href="/login" aria-label="返回供应商门户登录页">
        <Image src="/logo.png" alt="" width={42} height={42} priority />
        <span>智慧水发 · 蜀水云采</span>
      </Link>
      <section className="reg-panel">
        <div className="reg-card">
          <header className="reg-head">
            <p className="reg-brand-word">智慧水发 <span className="reg-dot">·</span> 蜀水云采</p>
            <div className="reg-divider" aria-hidden="true">◆</div>
            <h1 className="reg-title">{props.title}</h1>
            <p className="reg-sub">{props.subtitle}</p>
          </header>
          {props.notice}
          <RegistrationStepper {...props} />
          <div className="reg-body">{props.children}</div>
          <div className="reg-actions">{props.actions}</div>
          <div className="reg-foot">已有账号？<Link href="/login">返回登录</Link></div>
        </div>
      </section>
    </main>
  );
}
```

`RegistrationStepper` must expose clickable completed steps only, use `aria-current="step"`, render `已完成` for completed items, and render a compact `第 N / M 步` progress header below `768px`.

- [ ] **Step 2: Add the semantic section wrapper**

In the same file, export:

```tsx
type RegistrationSectionProps = {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  title: string;
  hint?: string;
  children: React.ReactNode;
};

export function RegistrationSection({ icon: Icon, title, hint, children }: RegistrationSectionProps) {
  return (
    <section className="reg-module">
      <div className="reg-mod-head">
        <span className="reg-mod-icon" aria-hidden="true"><Icon size={17} strokeWidth={1.7} /></span>
        <h2 className="reg-mod-title">{title}</h2>
        {hint && <p className="reg-mod-hint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 3: Add a controlled business-tag field**

Implement `BusinessTagField` with `value`, `options`, `onChange`, `error`, `min = 2`, and `max = 8`. It must:

```tsx
<button
  type="button"
  className={selected ? 'reg-tagpick on' : 'reg-tagpick'}
  aria-pressed={selected}
  onClick={() => toggle(option.name)}
>
  {option.name}
</button>
```

Normalize with `trim()`, reject empty or over-20-character custom values, deduplicate exact values, prevent selection over 8, render custom values with a `待审核` badge, and place the validation message directly below the field with `role="alert"`.

- [ ] **Step 4: Add the shared password field**

Implement `PasswordField` with a real label, `Eye` / `EyeOff` from Lucide, `aria-label="显示密码"` or `aria-label="隐藏密码"`, `aria-invalid`, `aria-describedby`, and an error element below the input.

- [ ] **Step 5: Add one-accent and responsive component styles**

Update `register2.css` so `.reg-module` always uses the brand-blue accent, remove the six `data-accent` color overrides, add a compact mobile step header, and ensure:

```css
.reg-page { min-height: 100dvh; }
.reg-card { width: min(880px, 100%); }
.reg-module { --mod-accent: oklch(0.5 0.16 258); }
.reg-step:focus-visible,
.reg-tagpick:focus-visible,
.reg-btn:focus-visible,
.pwd-eye:focus-visible { outline: 3px solid color-mix(in oklab, var(--brand) 28%, transparent); outline-offset: 2px; }
@media (max-width: 768px) {
  .reg-panel { padding: 76px 14px 24px; }
  .reg-card { padding: 30px 18px 24px; border-radius: 18px; }
  .reg-form-grid { grid-template-columns: 1fr; }
  .reg-steps--desktop { display: none; }
  .reg-steps--mobile { display: block; }
}
@media (prefers-reduced-motion: reduce) {
  .reg-card, .reg-step-pane, .reg-btn, .reg-tagpick { animation: none; transition: none; }
}
```

- [ ] **Step 6: Type-check the new components through the portal build**

Run:

```bash
pnpm --filter supplier-portal-next build
```

Expected at this checkpoint: any errors are limited to components not yet wired to pages; resolve syntax and type errors before continuing.

### Task 4: Implement approved login option B

**Files:**

- Modify: `apps/supplier-portal-next/src/app/login/page.tsx`
- Modify: `apps/supplier-portal-next/src/app/globals.css`

- [ ] **Step 1: Replace hand-written icons and clarify the title hierarchy**

Import `ArrowRight`, `Clock3`, `EyeOff`, and `ShieldCheck` from Lucide. Delete the local SVG `EyeOff` function. Keep the existing photo, mascot, logo, input values, login request, pending-state dialog, and status-query behavior.

- [ ] **Step 2: Replace the stacked registration buttons with the approved two-entry block**

Use this semantic structure after the login helpers:

```tsx
<section className="lp-onboarding" aria-labelledby="lp-onboarding-title">
  <div className="lp-onboarding-head">
    <h2 id="lp-onboarding-title">首次使用平台？</h2>
    <span>选择适合的注册方式</span>
  </div>
  <div className="lp-register-options">
    <Link className="lp-register-option" href="/register">
      <span className="lp-register-option__icon" aria-hidden="true"><ShieldCheck size={17} /></span>
      <span><strong>正式注册</strong><small>长期合作，完成完整资料入库</small></span>
      <ArrowRight size={15} aria-hidden="true" />
    </Link>
    <Link className="lp-register-option" href="/register-temporary">
      <span className="lp-register-option__icon" aria-hidden="true"><Clock3 size={17} /></span>
      <span><strong>临时注册</strong><small>已获邀请，凭 8 位邀请码办理</small></span>
      <ArrowRight size={15} aria-hidden="true" />
    </Link>
  </div>
</section>
```

- [ ] **Step 3: Refine login CSS without changing the brand composition**

Keep the right-side card and existing neumorphic material. Fit all primary controls within `100dvh`, give `.lp-onboarding` a hairline top separator, render the two entries as equal-width soft surfaces, and collapse them to one column only when the viewport is too narrow. Replace the status separator long dash with a Chinese comma or full stop.

- [ ] **Step 4: Run focused lint**

Run:

```bash
pnpm --filter supplier-portal-next exec eslint src/app/login/page.tsx
```

Expected: exit status 0.

### Task 5: Reorganize formal registration into five steps

**Files:**

- Modify: `apps/supplier-portal-next/src/app/register/page.tsx`
- Modify: `apps/supplier-portal-next/src/styles/pages/register2.css`

- [ ] **Step 1: Replace the six-step definition**

Use these exact stages:

```ts
const STEPS = [
  { label: '身份与账号', description: '验证登录身份' },
  { label: '企业与业务', description: '登记主体与业务方向' },
  { label: '联系人', description: '维护业务联系人' },
  { label: '资质与履历', description: '补充账户、证照与业绩' },
  { label: '确认提交', description: '核对资料并提交审核' },
] satisfies RegistrationStep[];
```

Clamp recovered drafts with `Math.min(Number(d.step) || 0, STEPS.length - 1)` so old six-step drafts cannot open an empty pane.

- [ ] **Step 2: Remap step validation**

Split the current step-0 validation without changing its rules:

- Step 0: password, password confirmation, registration phone, and six-digit SMS code.
- Step 1: enterprise identity, address, business scope, legal-person fields, email formats, credit-code duplicate guard, legal-ID duplicate guard, and 2-to-8 tags.
- Step 2: contacts.
- Step 3: banks, qualifications, and performances in one pass.
- Step 4: agreement and final duplicate check before submit.

Use `STEPS.length - 1` instead of hard-coded `5` in `nextStep`, actions, and submit visibility.

- [ ] **Step 3: Recompose the five panes with shared primitives**

Wrap the page in `RegistrationShell`. Use `RegistrationSection` for each semantic group and `BusinessTagField` for tags. The fourth pane contains three sections in this order: bank accounts, qualification materials, representative performance.

Keep all current state, uploads, draft recovery, duplicate checks, payload field names, filters, and success routing. Do not remove optional fields.

- [ ] **Step 4: Make repeated row fields visibly labeled**

Wrap contact, bank, qualification, and performance controls with `.reg-inline-field` and a visible `.reg-inline-label`. On compact desktop the label appears above each control; on mobile it remains visible. Place row-level errors under the matching wrapper instead of relying on placeholders.

- [ ] **Step 5: Update the confirmation hierarchy**

Render five review groups matching the step names. Nest bank accounts, qualifications, and performances under “资质与履历”. Keep custom-tag `（待审核）` markers and existing agreement text.

- [ ] **Step 6: Run focused lint**

Run:

```bash
pnpm --filter supplier-portal-next exec eslint src/app/register/page.tsx src/components/registration/*.tsx
```

Expected: exit status 0.

### Task 6: Convert temporary registration into the shared four-step flow

**Files:**

- Modify: `apps/supplier-portal-next/src/lib/auth.ts`
- Modify: `apps/supplier-portal-next/src/app/register-temporary/page.tsx`
- Modify: `apps/supplier-portal-next/src/styles/pages/register2.css`

- [ ] **Step 1: Extend the typed request contract**

Add the required field:

```ts
export interface RegisterTemporaryParams {
  invitationCode: string;
  name: string;
  organizationCode?: string;
  creditCode: string;
  legalPerson: string;
  legalPersonIdCard: string;
  registeredAddress?: string;
  region?: string;
  displayName: string;
  password: string;
  phone: string;
  email?: string;
  tags: string[];
}
```

- [ ] **Step 2: Define the four stages and state**

Use:

```ts
const STEPS = [
  { label: '邀请与账号', description: '验证邀请并设置登录密码' },
  { label: '企业与业务', description: '登记主体与业务方向' },
  { label: '联系人', description: '登记主要联系人' },
  { label: '确认提交', description: '核对资料并提交审核' },
] satisfies RegistrationStep[];
```

Add `step`, `maxVisitedStep`, `errors`, `tags`, and `tagOptions`. Load options with `authApi.listBusinessTags()` and keep invitation verification state.

- [ ] **Step 3: Implement step-specific validation**

- Step 0: valid 8-character invitation, successful invitation verification, password policy, matching confirmation.
- Step 1: enterprise name, 18-character credit code, legal person, legal-person ID, optional email/address rules, and 2-to-8 tags.
- Step 2: contact name, 11-digit mobile number, and optional email.
- Step 3: agreement before submit.

On validation failure, set the field error map, show the first message, and focus the first element with `[aria-invalid="true"]`.

- [ ] **Step 4: Build four matching panes**

Use `RegistrationShell`, `RegistrationSection`, `PasswordField`, and `BusinessTagField`. The review pane must show invitation validity, enterprise identity, legal person, business tags, contact data, and the existing temporary-qualification notice.

- [ ] **Step 5: Submit normalized tags**

Include:

```ts
tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))],
```

Keep the existing success message and login navigation. Do not alter the invitation verification endpoint.

- [ ] **Step 6: Run focused lint**

Run:

```bash
pnpm --filter supplier-portal-next exec eslint src/app/register-temporary/page.tsx src/lib/auth.ts src/components/registration/*.tsx
```

Expected: exit status 0.

### Task 7: Complete the visual, responsive, and accessibility pass

**Files:**

- Modify: `apps/supplier-portal-next/src/app/globals.css`
- Modify: `apps/supplier-portal-next/src/styles/pages/register2.css`
- Modify: `apps/supplier-portal-next/src/app/login/page.tsx`
- Modify: `apps/supplier-portal-next/src/app/register/page.tsx`
- Modify: `apps/supplier-portal-next/src/app/register-temporary/page.tsx`

- [ ] **Step 1: Remove visual drift and malformed CSS**

Delete the inert repeated `.reg-form` and `.reg-row` selector lines in `globals.css`. Remove per-module blue, teal, green, amber, violet, and rose accents from `register2.css`; retain semantic red only for errors and amber only for warnings.

- [ ] **Step 2: Audit form semantics**

Verify every input has a visible label, errors sit below their field, icon-only controls have accessible names, and status containers use `role="status"` or `role="alert"` as appropriate. Remove remaining local SVG icons where an imported Lucide icon already exists.

- [ ] **Step 3: Audit layout at target widths**

Check `1440 × 900`, `1024 × 768`, `768 × 1024`, and `390 × 844`. The background and mascot may crop, but the form surface, step progress, registration entries, actions, and legal agreement must remain reachable without horizontal overflow.

- [ ] **Step 4: Respect reduced motion**

Confirm card entrance, pane transition, hover lift, and progress-fill transition are disabled under `prefers-reduced-motion: reduce` while preserving visible state changes.

### Task 8: Correct the repository map

**Files:**

- Modify: `AGENTS.md`

- [ ] **Step 1: Replace the obsolete five-app table with the active runtime map**

Update the monorepo table and commands to show:

```md
| `apps/public-portal` | Next.js 16 (App Router) | 3002 | Public information portal |
| `apps/mall` | Next.js 16 (App Router) | 3003 | Procurement mall |
| `apps/supplier-portal-next` | Next.js 16 (App Router) | 3004 | Supplier self-service portal |
| `apps/web` | Next.js 16 (App Router) | 3005 | Unified procurement management workspace |
| `apps/expert-portal` | Next.js 16 (App Router) | 3006 | Bid expert portal |
| `apps/bid-portal` | Next.js 16 (App Router) | 3007 | Bid opening and evaluation management portal |
| `apps/assistant` | Next.js 16 (App Router) | 3008 | Intelligent assistant |
| `apps/bigscreen` | Next.js 16 (App Router) | 3010 | Operations display wall |
```

Document that `pnpm dev` starts nine apps/services, and list the existing root aliases `pnpm dev:public`, `dev:mall`, `dev:supplier`, `dev:web`, `dev:expert`, `dev:bid`, `dev:assistant`, `dev:bigscreen`, and `dev:api` with their real ports.

- [ ] **Step 2: Correct role routing text**

Document `supplier → supplier-portal-next (:3004)`, `bid_expert → expert-portal (:3006)`, and `admin` / `bid_host → bid-portal (:3007)` according to `packages/config/src/urls.ts`. Note that `supplierNext: 3020` remains a compatibility alias used by the bid WebSocket handshake and is not the active supplier development port; do not remove it in this task.

### Task 9: Final verification

**Files:**

- Verify all files listed above; do not modify unrelated files.

- [ ] **Step 1: Run API tests and build**

```bash
pnpm --filter api test -- supplier.temporary-register.spec.ts supplier.register.spec.ts --runInBand
pnpm --filter api build
```

Expected: all focused tests pass and the API build exits with status 0.

- [ ] **Step 2: Run portal lint and production build**

```bash
pnpm --filter supplier-portal-next exec eslint \
  src/app/login/page.tsx \
  src/app/register/page.tsx \
  src/app/register-temporary/page.tsx \
  src/lib/auth.ts \
  src/components/registration/*.tsx
pnpm --filter supplier-portal-next build
```

Expected: lint and build exit with status 0.

- [ ] **Step 3: Inspect focused diffs**

```bash
git diff --check -- \
  AGENTS.md \
  water-erp/apps/api/src/supplier/dto/register-temporary-supplier.dto.ts \
  water-erp/apps/api/src/supplier/supplier.service.ts \
  water-erp/apps/api/src/supplier/supplier.temporary-register.spec.ts \
  water-erp/apps/supplier-portal-next/src/app/globals.css \
  water-erp/apps/supplier-portal-next/src/app/login/page.tsx \
  water-erp/apps/supplier-portal-next/src/app/register/page.tsx \
  water-erp/apps/supplier-portal-next/src/app/register-temporary/page.tsx \
  water-erp/apps/supplier-portal-next/src/lib/auth.ts \
  water-erp/apps/supplier-portal-next/src/components/registration \
  water-erp/apps/supplier-portal-next/src/styles/pages/register2.css
```

Expected: no whitespace errors. Review that unrelated pre-existing hunks remain intact.

- [ ] **Step 4: Run browser regression on the actual app**

Open `http://192.168.1.109:3004/login`, then verify:

1. Login remains the dominant task and both registration choices explain their purpose.
2. Formal registration shows five steps, preserves all existing fields, and retains values when moving back.
3. Temporary registration shows four steps, requires 2 to 8 business tags, displays the review summary, and preserves values when moving back.
4. Desktop and mobile screenshots match the approved brand-preserving direction.

- [ ] **Step 5: Report exact verification evidence**

Report commands, pass/fail counts, build status, tested viewport sizes, and any pre-existing failures separately. Do not claim completion until all required checks pass or a concrete blocker is documented.
