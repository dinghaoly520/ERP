# Expert Phone Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SMS verification code (stub) to expert identity verification step in the evaluation wizard, with reusable VerificationModule.

**Architecture:** New `VerificationModule` (independent, reusable) stores codes in Redis (TTL-based). `ExpertService.signIn` gates on `phoneVerified`. Expert portal evaluate page gains phone code UI above the sign-in button.

**Tech Stack:** NestJS 11, Prisma, ioredis, React 19, TypeScript

---

### Task 1: Install Redis dependency + Create RedisModule

**Files:**
- Create: `water-erp/apps/api/src/redis/redis.module.ts`
- Modify: `water-erp/apps/api/package.json` (add ioredis)

- [ ] **Step 1: Install ioredis**

```bash
cd water-erp && pnpm --filter api add ioredis
```

- [ ] **Step 2: Create RedisModule**

Create `water-erp/apps/api/src/redis/redis.module.ts`:

```typescript
import { Module, Global } from '@nestjs/common';
import Redis from 'ioredis';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        const host = process.env.REDIS_HOST || 'localhost';
        const port = parseInt(process.env.REDIS_PORT || '6380', 10);
        return new Redis({ host, port, maxRetriesPerRequest: 3 });
      },
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
```

- [ ] **Step 3: Register RedisModule in AppModule**

Modify `water-erp/apps/api/src/app.module.ts` — add import line and add `RedisModule` to the `imports` array:

At line ~3 (after existing imports):
```typescript
import { RedisModule } from './redis/redis.module';
```

In the `imports` array (add as first import so Redis is available to all modules):
```typescript
imports: [
  ConfigModule.forRoot({ isGlobal: true }),
  PrismaModule,
  RedisModule,  // <-- add this
  AuthModule,
  // ... rest unchanged
],
```

- [ ] **Step 4: Verify RedisModule compiles**

```bash
cd water-erp && pnpm --filter api build
```

Expected: Build succeeds (no TypeScript errors).

- [ ] **Step 5: Commit**

```bash
cd "D:\claude projects\ERP-main" && git add water-erp/apps/api/src/redis/ water-erp/apps/api/src/app.module.ts water-erp/apps/api/package.json water-erp/pnpm-lock.yaml && git commit -m "feat(api): add RedisModule with ioredis"
```

---

### Task 2: Prisma schema — add phoneVerified to BidExpert

**Files:**
- Modify: `water-erp/apps/api/prisma/schema.prisma`
- Create: migration via `prisma migrate`

- [ ] **Step 1: Add field to BidExpert model**

In `water-erp/apps/api/prisma/schema.prisma`, inside the `BidExpert` model, add after `signedIn` field (currently line 185):

```prisma
  signedIn           Boolean          @default(false)
  phoneVerified      Boolean          @default(false)   // <-- new
  avoidanceConfirmed  Boolean          @default(false)
```

- [ ] **Step 2: Run migration**

```bash
cd water-erp && npx prisma migrate dev --name add-phone-verified-to-bid-expert
```

Expected: Migration applied successfully.

- [ ] **Step 3: Regenerate Prisma client**

```bash
cd water-erp && pnpm db:generate
```

Expected: Client regenerated without errors.

- [ ] **Step 4: Verify build still passes**

```bash
cd water-erp && pnpm --filter api build
```

- [ ] **Step 5: Commit**

```bash
cd "D:\claude projects\ERP-main" && git add water-erp/apps/api/prisma/schema.prisma water-erp/apps/api/prisma/migrations/ && git commit -m "feat(prisma): add phoneVerified field to BidExpert"
```

---

### Task 3: Update shared types

**Files:**
- Modify: `water-erp/packages/shared/src/types.ts`

- [ ] **Step 1: Add phoneVerified and phoneMasked to BidExpert interface**

In `water-erp/packages/shared/src/types.ts`, find the `BidExpert` interface (around lines 54-65) and add `phoneVerified` and `phoneMasked`:

```typescript
export interface BidExpert {
  id: string;
  expertName: string;
  major: string;
  signedIn: boolean;
  phoneVerified?: boolean;       // <-- new
  phoneMasked?: string | null;   // <-- new (computed, not a DB column)
  avoidanceConfirmed: boolean;
  progress: number;
  totalScore: number;
  reportConfirmed?: boolean;
  conflictedSupplierIds?: string[];
  reportConfirmedAt?: string | null;
}
```

- [ ] **Step 2: Rebuild shared package**

```bash
cd water-erp && pnpm --filter @water-erp/shared build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd "D:\claude projects\ERP-main" && git add water-erp/packages/shared/src/types.ts && git commit -m "feat(shared): add phoneVerified and phoneMasked to BidExpert type"
```

---

### Task 4: Create VerificationModule — DTOs

**Files:**
- Create: `water-erp/apps/api/src/verification/dto/send-code.dto.ts`
- Create: `water-erp/apps/api/src/verification/dto/verify-code.dto.ts`

- [ ] **Step 1: Create send-code.dto.ts**

```typescript
import { IsString, IsIn } from 'class-validator';

export const VERIFICATION_SCENES = ['expert_sign_in'] as const;
export type VerificationScene = (typeof VERIFICATION_SCENES)[number];

export class SendCodeDto {
  @IsString()
  @IsIn(VERIFICATION_SCENES)
  scene: VerificationScene;

  @IsString()
  targetId: string;
}
```

- [ ] **Step 2: Create verify-code.dto.ts**

```typescript
import { IsString, IsIn, Length } from 'class-validator';
import { VERIFICATION_SCENES, VerificationScene } from './send-code.dto';

export class VerifyCodeDto {
  @IsString()
  @IsIn(VERIFICATION_SCENES)
  scene: VerificationScene;

  @IsString()
  targetId: string;

  @IsString()
  @Length(6, 6)
  code: string;
}
```

- [ ] **Step 3: Commit**

```bash
cd "D:\claude projects\ERP-main" && git add water-erp/apps/api/src/verification/ && git commit -m "feat(verification): add send-code and verify-code DTOs"
```

---

### Task 5: Create VerificationService

**Files:**
- Create: `water-erp/apps/api/src/verification/verification.service.ts`

- [ ] **Step 1: Write VerificationService**

Create `water-erp/apps/api/src/verification/verification.service.ts`:

```typescript
import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationScene } from './dto/send-code.dto';

interface VerificationRecord {
  code: string;
  phone: string;
  attempts: number;
}

const CODE_LENGTH = 6;
const CODE_TTL = 300;            // 5 minutes
const COOLDOWN_TTL = 60;         // 60 seconds
const MAX_ATTEMPTS = 5;
const IP_RATE_LIMIT = 10;        // per minute

// Dev bypass: set SMS_DEBUG_BYPASS=true to accept "123456" for any verification
const DEBUG_BYPASS_CODE = '123456';

@Injectable()
export class VerificationService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  private codeKey(scene: string, userId: string, targetId: string) {
    return `verification:${scene}:${userId}:${targetId}`;
  }

  private cooldownKey(scene: string, userId: string, targetId: string) {
    return `verification:cooldown:${scene}:${userId}:${targetId}`;
  }

  private ipKey(ip: string) {
    return `verification:ip:${ip}`;
  }

  private maskPhone(phone: string): string {
    if (phone.length < 7) return phone;
    return phone.slice(0, 3) + '****' + phone.slice(-4);
  }

  private generateCode(): string {
    const digits: number[] = [];
    for (let i = 0; i < CODE_LENGTH; i++) {
      digits.push(Math.floor(Math.random() * 10));
    }
    return digits.join('');
  }

  private async getPhoneForExpertSignIn(
    userId: string,
    projectId: string,
  ): Promise<string> {
    // Verify user is assigned as an expert to this project
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
      include: {
        user: { include: { expertProfile: true } },
      },
    });

    if (!expert) {
      throw new BadRequestException({
        code: 'NOT_EXPERT',
        error: '您不是该项目的评审专家',
      });
    }

    const phone = expert.user?.expertProfile?.phone;
    if (!phone) {
      throw new BadRequestException({
        code: 'PHONE_NOT_FOUND',
        error: '未绑定手机号，请联系管理员完善资料',
      });
    }

    return phone;
  }

  async sendCode(
    scene: VerificationScene,
    userId: string,
    targetId: string,
    clientIp: string,
  ) {
    // IP rate limit check
    const ipCount = await this.redis.incr(this.ipKey(clientIp));
    if (ipCount === 1) {
      await this.redis.expire(this.ipKey(clientIp), 60);
    }
    if (ipCount > IP_RATE_LIMIT) {
      throw new BadRequestException({
        code: 'IP_RATE_LIMITED',
        error: '请求过于频繁，请稍后再试',
      });
    }

    // Cooldown check
    const cooldown = await this.redis.get(
      this.cooldownKey(scene, userId, targetId),
    );
    if (cooldown) {
      const ttl = await this.redis.ttl(this.cooldownKey(scene, userId, targetId));
      throw new BadRequestException({
        code: 'TOO_FREQUENT',
        error: `请${ttl}秒后再试`,
      });
    }

    // Get phone number (scene-specific logic)
    let phone: string;
    switch (scene) {
      case 'expert_sign_in':
        phone = await this.getPhoneForExpertSignIn(userId, targetId);
        break;
      default:
        throw new BadRequestException({
          code: 'UNSUPPORTED_SCENE',
          error: `不支持的验证场景: ${scene}`,
        });
    }

    // Generate code and store in Redis
    const code = this.generateCode();
    const record: VerificationRecord = { code, phone, attempts: 0 };
    const key = this.codeKey(scene, userId, targetId);
    await this.redis.set(key, JSON.stringify(record), 'EX', CODE_TTL);

    // Set cooldown
    await this.redis.set(
      this.cooldownKey(scene, userId, targetId),
      '1',
      'EX',
      COOLDOWN_TTL,
    );

    // Stub: log to console
    console.log(`[SMS-STUB] 验证码: ${code} → ${phone} (场景: ${scene})`);

    return { maskedPhone: this.maskPhone(phone) };
  }

  async verifyCode(
    scene: VerificationScene,
    userId: string,
    targetId: string,
    code: string,
  ) {
    const key = this.codeKey(scene, userId, targetId);

    // Dev bypass
    if (
      process.env.SMS_DEBUG_BYPASS === 'true' &&
      code === DEBUG_BYPASS_CODE
    ) {
      // Mark phoneVerified in BidExpert for the sign-in scene
      if (scene === 'expert_sign_in') {
        await this.markPhoneVerified(userId, targetId);
      }
      return { ok: true };
    }

    const raw = await this.redis.get(key);
    if (!raw) {
      throw new BadRequestException({
        code: 'CODE_EXPIRED',
        error: '验证码已过期，请重新获取',
      });
    }

    const record: VerificationRecord = JSON.parse(raw);

    if (record.attempts >= MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new BadRequestException({
        code: 'ATTEMPTS_EXCEEDED',
        error: '尝试次数过多，请重新获取验证码',
      });
    }

    if (record.code !== code) {
      record.attempts += 1;
      const remaining = MAX_ATTEMPTS - record.attempts;
      const ttl = await this.redis.ttl(key);
      await this.redis.set(key, JSON.stringify(record), 'EX', ttl > 0 ? ttl : CODE_TTL);

      if (remaining <= 0) {
        await this.redis.del(key);
        throw new BadRequestException({
          code: 'ATTEMPTS_EXCEEDED',
          error: '尝试次数过多，请重新获取验证码',
        });
      }

      throw new BadRequestException({
        code: 'CODE_INVALID',
        error: `验证码错误，剩余 ${remaining} 次尝试`,
      });
    }

    // Code correct — delete from Redis, mark phone verified
    await this.redis.del(key);

    if (scene === 'expert_sign_in') {
      await this.markPhoneVerified(userId, targetId);
    }

    return { ok: true };
  }

  private async markPhoneVerified(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (expert) {
      await this.prisma.bidExpert.update({
        where: { id: expert.id },
        data: { phoneVerified: true },
      });
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd "D:\claude projects\ERP-main" && git add water-erp/apps/api/src/verification/verification.service.ts && git commit -m "feat(verification): add VerificationService with Redis-backed code logic"
```

---

### Task 6: Create VerificationController and VerificationModule

**Files:**
- Create: `water-erp/apps/api/src/verification/verification.controller.ts`
- Create: `water-erp/apps/api/src/verification/verification.module.ts`

- [ ] **Step 1: Write VerificationController**

Create `water-erp/apps/api/src/verification/verification.controller.ts`:

```typescript
import { Controller, Post, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { VerificationService } from './verification.service';
import { SendCodeDto } from './dto/send-code.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';

@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('send-code')
  @Roles('bid_expert')
  sendCode(
    @CurrentUser('sub') userId: string,
    @Body() dto: SendCodeDto,
    @Req() req: Request,
  ) {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || '127.0.0.1';
    return this.verificationService.sendCode(dto.scene, userId, dto.targetId, clientIp);
  }

  @Post('verify-code')
  @Roles('bid_expert')
  verifyCode(
    @CurrentUser('sub') userId: string,
    @Body() dto: VerifyCodeDto,
  ) {
    return this.verificationService.verifyCode(dto.scene, userId, dto.targetId, dto.code);
  }
}
```

- [ ] **Step 2: Write VerificationModule**

Create `water-erp/apps/api/src/verification/verification.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
```

- [ ] **Step 3: Register VerificationModule in AppModule**

Modify `water-erp/apps/api/src/app.module.ts`:

Add import:
```typescript
import { VerificationModule } from './verification/verification.module';
```

Add to imports array (after RedisModule):
```typescript
RedisModule,
VerificationModule,  // <-- add this
AuthModule,
```

- [ ] **Step 4: Verify build**

```bash
cd water-erp && pnpm --filter api build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
cd "D:\claude projects\ERP-main" && git add water-erp/apps/api/src/verification/verification.controller.ts water-erp/apps/api/src/verification/verification.module.ts water-erp/apps/api/src/app.module.ts && git commit -m "feat(verification): add VerificationController and VerificationModule"
```

---

### Task 7: Modify ExpertService — gate sign-in on phoneVerified + return phone info

**Files:**
- Modify: `water-erp/apps/api/src/expert/expert.service.ts`

- [ ] **Step 1: Modify signIn to check phoneVerified**

In `water-erp/apps/api/src/expert/expert.service.ts`, replace the `signIn` method (lines 120-135) with:

```typescript
  /* ── 身份核验 ── */

  async signIn(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');

    if (!expert.phoneVerified) {
      throw new ForbiddenException({
        code: 'PHONE_NOT_VERIFIED',
        error: '请先完成手机验证',
      });
    }

    this.gateway?.notifyExpertPresence(expert.projectId, {
      expertId: expert.id, expertName: '', milestone: 'signed_in', progressPercent: expert.progress ?? 0,
    });
    return this.prisma.bidExpert.update({
      where: { id: expert.id },
      data: { signedIn: true },
    });
  }
```

- [ ] **Step 2: Modify getProject to return phoneMasked and phoneVerified**

Replace the `getProject` method (lines 92-118 in expert.service.ts) with:

```typescript
  async getProject(userId: string, projectId: string) {
    const expertRecord = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
      include: {
        user: { include: { expertProfile: true } },
      },
    });
    if (!expertRecord) throw new ForbiddenException('您不是该项目的评审专家');

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: {
        suppliers: true,
        openingSession: true,
        openingRecords: true,
        experts: { include: { scoreRecords: { include: { scoreItem: true } } } },
        scoreItems: { orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] },
        clarifications: { orderBy: { createdAt: 'desc' } },
        supervisionLogs: { orderBy: { time: 'desc' }, take: 20 },
      },
    });

    // 获取当前专家自己的评分记录
    const myScores = await this.prisma.bidScoreRecord.findMany({
      where: { expertId: expertRecord.id },
      include: { scoreItem: true },
    });

    // Compute masked phone from ExpertProfile
    const phone = expertRecord.user?.expertProfile?.phone ?? null;
    const phoneMasked = phone
      ? phone.slice(0, 3) + '****' + phone.slice(-4)
      : null;

    const myExpertRecord = {
      ...expertRecord,
      phoneVerified: expertRecord.phoneVerified,
      phoneMasked,
    };

    return { ...project, myExpertRecord, myScores };
  }
```

Note: exclude the nested `user` object from the response to avoid leaking sensitive data.

- [ ] **Step 3: Verify build**

```bash
cd water-erp && pnpm --filter api build
```

- [ ] **Step 4: Commit**

```bash
cd "D:\claude projects\ERP-main" && git add water-erp/apps/api/src/expert/expert.service.ts && git commit -m "feat(expert): gate sign-in on phoneVerified, return phone info in project detail"
```

---

### Task 8: Update seed data

**Files:**
- Modify: `water-erp/apps/api/prisma/seed-data/BidExpert.json`
- Modify: `water-erp/apps/api/prisma/seed-data/ExpertProfile.json`

- [ ] **Step 1: Add phoneVerified to BidExpert seed entries**

In `water-erp/apps/api/prisma/seed-data/BidExpert.json`, add `"phoneVerified": false` to each of the 3 entries after `"signedIn"`:

```json
"signedIn": true,
"phoneVerified": false,
```

Apply to all 3 records (ids: `cmqgefcij001gvkr44uxpbeu9`, `cmqgefcij001ivkr4vgjiw7e3`, `cmqgefcij001kvkr4azblt3zw`).

- [ ] **Step 2: Add phone numbers to demo expert profiles**

In `water-erp/apps/api/prisma/seed-data/ExpertProfile.json`, find the 3 entries matching the demo BidExpert userIds and change `"phone": null` to a valid phone number:

| userId | expertName | phone (new) |
|-------|-----------|-------------|
| `cmqbysdeo0006koh11kf0fh37` | 王某国 | `"13800000001"` |
| `cmqbysdg70008koh18qzpg1dx` | 刘某梅 | `"13800000002"` |
| `cmqbysdhq000akoh1il5mllhl` | 陈某强 | `"13800000003"` |

- [ ] **Step 3: Re-seed database**

```bash
cd water-erp && pnpm db:seed
```

Expected: Seed completes without errors.

- [ ] **Step 4: Commit**

```bash
cd "D:\claude projects\ERP-main" && git add water-erp/apps/api/prisma/seed-data/BidExpert.json water-erp/apps/api/prisma/seed-data/ExpertProfile.json && git commit -m "feat(seed): add phoneVerified field and demo expert phone numbers"
```

---

### Task 9: Frontend — add phone verification UI to evaluate page

**Files:**
- Modify: `water-erp/apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`

- [ ] **Step 1: Add phone verification state variables**

In `water-erp/apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`, after the existing state declarations (after `const [busy, setBusy] = useState(false);` around line 80), add:

```typescript
  // Phone verification
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [codeError, setCodeError] = useState('');
  const [attemptsLeft, setAttemptsLeft] = useState(5);
```

- [ ] **Step 2: Add sendCode and verifyCode handler functions**

After the `handleSignIn` function (around line 206), add:

```typescript
  // Phone verification handlers
  const handleSendCode = async () => {
    if (countdown > 0) return;
    setSendingCode(true);
    setCodeError('');
    try {
      const res = await api.post('/verification/send-code', {
        scene: 'expert_sign_in',
        targetId: projectId,
      });
      setPhoneMasked(res.data.maskedPhone);
      setCodeSent(true);
      setCountdown(60);
      setAttemptsLeft(5);
      setVerificationCode('');
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) { clearInterval(timer); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message || '发送失败');
    }
    setSendingCode(false);
  };

  const handleVerifyCode = async (code: string) => {
    if (!code || code.length !== 6) return;
    setVerifying(true);
    setCodeError('');
    try {
      await api.post('/verification/verify-code', {
        scene: 'expert_sign_in',
        targetId: projectId,
        code,
      });
      setPhoneVerified(true);
      toast.success('手机验证通过');
    } catch (e: any) {
      const data = e.response?.data;
      setCodeError(data?.error || '验证失败');
      if (data?.code === 'ATTEMPTS_EXCEEDED' || data?.code === 'CODE_EXPIRED') {
        setCodeSent(false);
        setVerificationCode('');
      }
      // Extract remaining attempts from error message
      const match = data?.error?.match(/剩余 (\d+) 次/);
      if (match) setAttemptsLeft(parseInt(match[1], 10));
    }
    setVerifying(false);
  };
```

- [ ] **Step 3: Update useEffect to sync phone state from project data**

In the existing `useEffect` that calls `loadProject()`, after the project is set, add logic to sync phone state. The `loadProject` function already calls `setProject(...)`. Add a second `useEffect`:

```typescript
  // Sync phone verification state from project data
  useEffect(() => {
    if (project?.myExpertRecord) {
      setPhoneMasked(project.myExpertRecord.phoneMasked ?? null);
      setPhoneVerified(project.myExpertRecord.phoneVerified ?? false);
    }
  }, [project]);
```

Place this after the existing `useEffect` that loads the project.

- [ ] **Step 4: Insert phone verification UI into the verify step**

In the verify step JSX (around line 450, inside the identity verification card for the item with `label: '身份核验'`), replace the first card in the `.map()` array. The current code (lines 447-455) has:

```tsx
{[
  { label: '身份核验', desc: '确认您的专家身份信息', done: !!expert?.signedIn, action: !expert?.signedIn ? handleSignIn : undefined },
  // ...
].map((item, i) => (...))}
```

Replace the entire `.map()` block and the phone-verification-containing first card with this expanded version:

```tsx
                {[
                  { label: '身份核验', desc: '确认您的专家身份信息', done: !!expert?.signedIn, action: !expert?.signedIn ? handleSignIn : undefined, isIdentity: true as const },
                  { label: '保密承诺', desc: '承诺不泄露评标过程中获取的信息', done: confidentialityAgreed, action: undefined, isIdentity: false as const },
                  { label: '评标纪律', desc: '遵守独立评审原则', done: disciplineAgreed, action: undefined, isIdentity: false as const },
                ].map((item, i) => (
                  <div key={i}>
                    <div className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${item.done ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-[oklch(0.91_0.006_264)]'}`}>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${item.done ? 'bg-emerald-500 text-white' : 'bg-[oklch(0.94_0.004_264)] text-[oklch(0.55_0.01_264)]'}`}>
                        {item.done ? '✓' : i + 1}
                      </div>
                      <div className="flex-1">
                        <h3 className={`font-bold ${item.done ? 'text-emerald-600' : 'text-[oklch(0.18_0.012_265)]'}`}>{item.label}</h3>
                        <p className="text-sm text-[oklch(0.55_0.01_264)]">{item.desc}</p>
                      </div>
                      {item.action && !item.isIdentity && (
                        <button onClick={item.action} disabled={busy}
                          className="px-4 py-2 bg-[#064ea2] text-white text-sm rounded-lg hover:bg-[#054280] transition disabled:opacity-50">确认</button>
                      )}
                    </div>

                    {/* Phone verification — shown inside the identity card when not yet done */}
                    {item.isIdentity && !item.done && (
                      <div className="ml-14 mt-3 p-4 bg-white border border-[oklch(0.91_0.006_264)] rounded-xl">
                        {!phoneMasked && !codeSent ? (
                          <div className="text-center py-2">
                            <p className="text-sm text-[oklch(0.55_0.01_264)] mb-2">未绑定手机号，请联系管理员完善资料</p>
                          </div>
                        ) : phoneVerified ? (
                          <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                            <span className="text-lg">✅</span>
                            <div>
                              <p className="text-sm font-semibold text-emerald-600">手机验证通过</p>
                              <p className="text-xs text-emerald-500">{phoneMasked}</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">📱 手机验证</p>
                            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-3">
                              验证码将发送至 {phoneMasked || '注册手机号'}
                            </p>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                value={verificationCode}
                                onChange={e => {
                                  const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                                  setVerificationCode(v);
                                  setCodeError('');
                                  if (v.length === 6) handleVerifyCode(v);
                                }}
                                placeholder="输入6位验证码"
                                disabled={verifying || !codeSent}
                                className="flex-1 px-3 py-2 text-center text-lg tracking-[8px] border border-[oklch(0.91_0.006_264)] rounded-lg focus:border-[#064ea2] focus:ring-1 focus:ring-[#064ea2] outline-none disabled:opacity-50 font-mono"
                              />
                              <button
                                onClick={handleSendCode}
                                disabled={sendingCode || countdown > 0 || verifying}
                                className="px-4 py-2 bg-[#064ea2] text-white text-sm rounded-lg hover:bg-[#054280] transition disabled:opacity-50 whitespace-nowrap"
                              >
                                {sendingCode ? '发送中…' : countdown > 0 ? `${countdown}s 后重发` : codeSent ? '重新获取' : '获取验证码'}
                              </button>
                            </div>
                            {codeError && (
                              <p className="mt-2 text-xs text-red-500">{codeError}</p>
                            )}
                            {!codeError && codeSent && !phoneVerified && (
                              <p className="mt-2 text-xs text-[oklch(0.55_0.01_264)]">
                                验证码6位数字，5分钟内有效
                                {attemptsLeft < 5 && ` · 剩余 ${attemptsLeft} 次尝试`}
                              </p>
                            )}
                          </>
                        )}

                        {/* Sign-in button — only shown when phone is verified */}
                        {phoneVerified && item.action && (
                          <button
                            onClick={item.action}
                            disabled={busy}
                            className="mt-3 w-full px-4 py-2.5 bg-[#064ea2] text-white text-sm rounded-lg hover:bg-[#054280] transition disabled:opacity-50 font-semibold"
                          >
                            {busy ? '请稍候…' : '确认签到并完成身份核验'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
```

- [ ] **Step 5: Verify frontend builds**

```bash
cd water-erp && pnpm --filter expert-portal build
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
cd "D:\claude projects\ERP-main" && git add water-erp/apps/expert-portal/src/app/\(app\)/evaluate/\[id\]/page.tsx && git commit -m "feat(expert-portal): add phone verification UI to identity step"
```

---

### Task 10: Write API tests

**Files:**
- Create: `water-erp/apps/api/test/verification/verification.service.spec.ts`
- Create: `water-erp/apps/api/test/verification/verification.controller.spec.ts`

- [ ] **Step 1: Write VerificationService unit test**

Create `water-erp/apps/api/test/verification/verification.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { VerificationService } from '../../src/verification/verification.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('VerificationService', () => {
  let service: VerificationService;
  let redisMock: any;
  let prismaMock: any;

  beforeEach(async () => {
    redisMock = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
    };

    prismaMock = {
      bidExpert: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: 'REDIS_CLIENT', useValue: redisMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<VerificationService>(VerificationService);
  });

  describe('verifyCode', () => {
    it('should throw CODE_EXPIRED when no code in Redis', async () => {
      redisMock.get.mockResolvedValue(null);

      await expect(
        service.verifyCode('expert_sign_in', 'user1', 'proj1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw CODE_INVALID when code does not match', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ code: '999999', phone: '138****5678', attempts: 0 }));
      redisMock.ttl.mockResolvedValue(300);
      redisMock.set.mockResolvedValue('OK');

      await expect(
        service.verifyCode('expert_sign_in', 'user1', 'proj1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return ok when code matches', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ code: '123456', phone: '13800000001', attempts: 0 }));
      redisMock.del.mockResolvedValue(1);
      prismaMock.bidExpert.findFirst.mockResolvedValue({ id: 'expert1' });
      prismaMock.bidExpert.update.mockResolvedValue({});

      const result = await service.verifyCode('expert_sign_in', 'user1', 'proj1', '123456');
      expect(result.ok).toBe(true);
    });

    it('should throw ATTEMPTS_EXCEEDED after 5 failed attempts', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ code: '999999', phone: '13800000001', attempts: 5 }));

      await expect(
        service.verifyCode('expert_sign_in', 'user1', 'proj1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendCode', () => {
    it('should throw when cooldown is active', async () => {
      redisMock.incr.mockResolvedValue(1);
      redisMock.expire.mockResolvedValue(1);
      redisMock.get.mockResolvedValue('1');  // cooldown active
      redisMock.ttl.mockResolvedValue(45);

      await expect(
        service.sendCode('expert_sign_in', 'user1', 'proj1', '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed when expert has phone', async () => {
      redisMock.incr.mockResolvedValue(1);
      redisMock.expire.mockResolvedValue(1);
      redisMock.get.mockResolvedValue(null);  // no cooldown
      redisMock.set.mockResolvedValue('OK');
      prismaMock.bidExpert.findFirst.mockResolvedValue({
        user: { expertProfile: { phone: '13800000001' } },
      });

      const result = await service.sendCode('expert_sign_in', 'user1', 'proj1', '127.0.0.1');
      expect(result.maskedPhone).toBe('138****0001');
    });
  });
});
```

- [ ] **Step 2: Run tests and verify they pass**

```bash
cd water-erp && pnpm --filter api test -- test/verification/
```

Expected: All 6 tests pass.

- [ ] **Step 3: Commit**

```bash
cd "D:\claude projects\ERP-main" && git add water-erp/apps/api/test/verification/ && git commit -m "test(verification): add unit tests for VerificationService"
```

---

### Task 11: Full build verification + end-to-end manual test

**Files:** None (verification only)

- [ ] **Step 1: Full API build**

```bash
cd water-erp && pnpm --filter api build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Full frontend build**

```bash
cd water-erp && pnpm --filter expert-portal build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Shared package build**

```bash
cd water-erp && pnpm --filter @water-erp/shared build
```

Expected: Build succeeds.

- [ ] **Step 4: Run all API tests**

```bash
cd water-erp && pnpm --filter api test
```

Expected: All tests pass (no regressions).

- [ ] **Step 5: Manual test checklist**

Start the app:
```bash
cd water-erp && pnpm dev:api & pnpm dev:expert
```

Then verify:

1. **Visit** `http://localhost:3006/evaluate/cmqgebt6q0005vkr4ea3mdorm`
2. **Login** as `wangjg` / `wangjg@2026` (or any bid_expert seed user)
3. **Observe** the identity step shows:
   - Expert identity info (name, masked phone)
   - "获取验证码" button
   - Disabled "确认签到" button
4. **Click** "获取验证码" → button changes to "60s 后重发" countdown
5. **Check** API console for `[SMS-STUB] 验证码: XXXXXX → 138...` log
6. **Enter** the 6-digit code from console → auto-verifies on 6th digit
7. **Observe** green checkmark + "确认签到" button enables
8. **Click** "确认签到" → step marked complete
9. **Test error cases**:
   - Enter wrong code → error message with remaining attempts
   - Wait for code expiry (5 min) or try 5 wrong codes → "请重新获取"
   - Set `SMS_DEBUG_BYPASS=true` env → enter `123456` → should pass

- [ ] **Step 6: Commit any final fixes**

If no fixes needed:
```bash
cd "D:\claude projects\ERP-main" && git add -A && git commit -m "chore: final verification — all builds and tests pass"
```

---

### Task Summary

| Task | Description | Files Created | Files Modified |
|------|-------------|---------------|----------------|
| 1 | Install Redis + RedisModule | 1 | 2 |
| 2 | Prisma schema + migration | 0 | 1 |
| 3 | Shared types update | 0 | 1 |
| 4 | Verification DTOs | 2 | 0 |
| 5 | VerificationService | 1 | 0 |
| 6 | Controller + Module + AppModule reg | 2 | 1 |
| 7 | ExpertService changes | 0 | 1 |
| 8 | Seed data update | 0 | 2 |
| 9 | Frontend UI | 0 | 1 |
| 10 | API tests | 2 | 0 |
| 11 | Build + manual test | 0 | 0 |

**Total: 8 new files, 9 modified files**
