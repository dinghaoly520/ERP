# 专家「身份核验」AI 辅助评标声明（④）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在专家门户身份核验步骤新增第 ④ 段「AI 辅助评标使用声明」，专家确认后持久化到 `BidExpert`，并由服务端硬门控挡住未确认者访问后续评标接口。

**Architecture:** 全栈。DB 层给 `BidExpert` 加 `aiConsentConfirmed` + `aiConsentAt`；API 层新增 `confirmAiConsent` 服务方法与 `POST /ai-consent` 路由，并把现有 7 处 `VERIFICATION_REQUIRED` 门控加上 `aiConsentConfirmed`；前端在 ②③ 之后渲染同款 ④ 卡片，确认按钮调 API 持久化，`stepAccessible`/`stepCompleted`/核验完成横幅同步加门控。共享包 `@water-erp/shared` 的 `BidExpert` 类型补字段。

**Tech Stack:** NestJS 11 + Prisma 6（API，:4001）、Next.js 16 + React 19 + Tailwind v4（expert-portal，:3006）、`@water-erp/shared` 类型包。

## Global Constraints

- 分支：`feat/expert-ai-consent-declaration`（已建，设计文档已提交 `c0383cc`）。
- 声明正文以设计文档第 2 节为准，逐字使用，不改措辞。
- 服务端门控走 B1：7 处全改，错误信息统一为「请先完成身份核验、回避确认与 AI 辅助评标声明」。
- 种子专家**不预置** `aiConsentConfirmed`（保持 `false` 默认）。
- 编辑 `@water-erp/shared` 后必须 `pnpm --filter @water-erp/shared build`。
- Prisma 迁移用非交互流程（见 Task 1）。
- 提交信息走项目约定 `type(scope): 中文描述`，结尾带 `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

## File Structure

| 文件 | 责任 | 动作 |
|------|------|------|
| `apps/api/prisma/schema.prisma` | `BidExpert` 模型定义 | 改：加 2 字段 |
| `apps/api/prisma/migrations/<ts>_add_bid_expert_ai_consent/migration.sql` | DDL | 新建（由 prisma 生成） |
| `packages/shared/src/types.ts` | 前端共享 `BidExpert` TS 契约 | 改：加 2 可选字段 |
| `apps/api/src/expert/expert.service.ts` | 专家业务逻辑 | 改：加 `confirmAiConsent`；7 处门控 |
| `apps/api/src/expert/expert.controller.ts` | 专家路由 | 改：加 `POST /ai-consent` |
| `apps/api/src/expert/expert.service.spec.ts` | 服务单测 | 改：mockExpert 加字段；新增 2 组用例 |
| `apps/api/src/expert/expert.controller.spec.ts` | 控制器单测 | 改：新增 1 组透传用例 |
| `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx` | 身份核验步骤 UI | 改：④ 块 + handler + 门控 |

---

## Task 1: Schema 与迁移（DB 层）

**Files:**
- Modify: `apps/api/prisma/schema.prisma:353`（`BidExpert.avoidanceConfirmed` 之后）

**Interfaces:**
- Produces: `BidExpert.aiConsentConfirmed: Boolean @default(false)`、`BidExpert.aiConsentAt: DateTime?`（供 Task 3/4 的 Prisma client 使用）

- [ ] **Step 1: 加字段到 schema**

在 `apps/api/prisma/schema.prisma` 的 `BidExpert` 模型中，`avoidanceConfirmed Boolean @default(false)`（第 353 行）之后插入两行：

```prisma
  avoidanceConfirmed    Boolean          @default(false)
  aiConsentConfirmed    Boolean          @default(false)
  aiConsentAt           DateTime?
  conflictedSupplierIds Json             @default("[]")
```

- [ ] **Step 2: 生成并应用迁移（非交互）**

Run:
```bash
cd water-erp && PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 pnpm --filter api exec prisma migrate dev --name add_bid_expert_ai_consent
```
Expected: 生成 `prisma/migrations/<timestamp>_add_bid_expert_ai_consent/migration.sql`，内容含 `ALTER TABLE "BidExpert" ADD COLUMN "aiConsentConfirmed" BOOLEAN NOT NULL DEFAULT false;` 与 `ADD COLUMN "aiConsentAt" TIMESTAMP(3);`，并应用到库、regenerate Prisma client。

- [ ] **Step 3: 验证 client 类型可用**

Run:
```bash
cd water-erp && pnpm --filter api exec tsc --noEmit -p apps/api/tsconfig.json 2>&1 | head -20
```
Expected: 无错误（此时源码还没引用新字段，应零报错；若报无关错误可忽略，只要不含 `aiConsentConfirmed` 相关）。

- [ ] **Step 4: 提交**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(expert): BidExpert 新增 aiConsentConfirmed/aiConsentAt 字段与迁移

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 共享类型契约（`@water-erp/shared`）

**Files:**
- Modify: `packages/shared/src/types.ts:95`（`export interface BidExpert`）

**Interfaces:**
- Produces: `BidExpert.aiConsentConfirmed?: boolean`、`BidExpert.aiConsentAt?: string | null`（供 Task 6 前端类型检查）

- [ ] **Step 1: 加可选字段**

在 `packages/shared/src/types.ts` 第 95 行起的 `export interface BidExpert {` 内，`avoidanceConfirmed: boolean;`（第 102 行）之后插入：

```ts
  avoidanceConfirmed: boolean;
  aiConsentConfirmed?: boolean;
  aiConsentAt?: string | null;
```

- [ ] **Step 2: 构建共享包**

Run:
```bash
cd water-erp && pnpm --filter @water-erp/shared build
```
Expected: `dist/` 产物更新，无 TS 报错。

- [ ] **Step 3: 提交**

```bash
git add packages/shared/src/types.ts packages/shared/dist
git commit -m "feat(shared): BidExpert 类型补 aiConsentConfirmed/aiConsentAt

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 服务层 `confirmAiConsent`（TDD）

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts`（紧接 `confirmAvoidance` 方法之后，约第 290 行）
- Test: `apps/api/src/expert/expert.service.spec.ts`（新增 `describe('confirmAiConsent')`）

**Interfaces:**
- Consumes: Task 1 的 Prisma client（`prisma.bidExpert.update` 写 `aiConsentConfirmed`/`aiConsentAt`）
- Produces: `ExpertService.confirmAiConsent(userId: string, projectId: string): Promise<BidExpert>`，被 Task 5 的控制器调用

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/expert/expert.service.spec.ts` 的 `describe('signIn', ...)` 块之后（约第 159 行后）插入新 describe：

```ts
  describe('confirmAiConsent', () => {
    it('确认成功应写入 aiConsentConfirmed=true 与时间戳', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue(mockExpert);
      prisma.bidExpert.update.mockResolvedValue({ ...mockExpert, aiConsentConfirmed: true });

      const result = await service.confirmAiConsent('user-1', 'proj-1');

      expect(prisma.bidExpert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { aiConsentConfirmed: true, aiConsentAt: expect.any(Date) },
        }),
      );
      expect(result.aiConsentConfirmed).toBe(true);
    });

    it('非活动阶段 → 403 PROJECT_NOT_ACTIVE', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ARCHIVED' });
      await expect(service.confirmAiConsent('user-1', 'proj-1'))
        .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_ACTIVE' } });
    });

    it('非本项目专家 → 403 NOT_PROJECT_EXPERT', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      await expect(service.confirmAiConsent('user-1', 'proj-1'))
        .rejects.toMatchObject({ response: { code: 'NOT_PROJECT_EXPERT' } });
    });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
cd water-erp && pnpm --filter api test -- expert.service.spec --testNamePattern="confirmAiConsent" 2>&1 | tail -20
```
Expected: FAIL，报 `service.confirmAiConsent is not a function`。

- [ ] **Step 3: 实现 `confirmAiConsent`**

在 `apps/api/src/expert/expert.service.ts` 的 `confirmAvoidance` 方法结束（约第 290 行 `return updated; }`）之后插入：

```ts
  async confirmAiConsent(userId: string, projectId: string) {
    // P1: 阶段门控 — 仅开标/评标阶段可确认 AI 辅助评标声明
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || (project.stage !== 'OPENING' && project.stage !== 'EVALUATING')) {
      throw new ForbiddenException({ error: '项目不在可确认 AI 声明阶段', code: 'PROJECT_NOT_ACTIVE' });
    }

    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    // 幂等：重复确认只刷新时间戳，不报错（与签到/回避一致）
    const updated = await this.prisma.bidExpert.update({
      where: { id: expert.id },
      data: { aiConsentConfirmed: true, aiConsentAt: new Date() },
    });
    return updated;
  }
```

> 注：不接 WebSocket 通知（`gateway?.notifyExpertPresence`）—— LiveStatusBoard 不消费 `ai_consent_confirmed` milestone，发了也无用，YAGNI。

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
cd water-erp && pnpm --filter api test -- expert.service.spec --testNamePattern="confirmAiConsent" 2>&1 | tail -20
```
Expected: PASS（3 条全过）。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts
git commit -m "feat(expert): 新增 confirmAiConsent 服务方法（持久化 AI 声明确认）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 服务端 B1 硬门控（7 处 + mockExpert）

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts` 第 305 / 365 / 537 / 703 / 903 / 1028 / 1124 行（7 处门控）
- Modify: `apps/api/src/expert/expert.service.spec.ts:18-30`（`mockExpert` 加字段）
- Test: 同 spec，`describe('getDecryptedDocuments')` 内新增 1 条门控用例

**Interfaces:**
- Consumes: Task 1 的 `BidExpert.aiConsentConfirmed`
- Produces: 7 处接口在 `aiConsentConfirmed=false` 时抛 `VERIFICATION_REQUIRED`

- [ ] **Step 1: 写失败测试（getDecryptedDocuments 门控）**

在 `apps/api/src/expert/expert.service.spec.ts` 的 `describe('getDecryptedDocuments', ...)`（第 406 行起）内，`beforeEach` 之后插入一条用例：

```ts
    it('未确认 AI 声明 → 403 VERIFICATION_REQUIRED', async () => {
      // signedExpert 已签到+回避，但未确认 AI 声明
      prisma.bidExpert.findFirst.mockResolvedValue({ ...signedExpert, aiConsentConfirmed: false });
      await expect(service.getDecryptedDocuments('user-1', 'proj-1', 'bs-1'))
        .rejects.toMatchObject({ response: { code: 'VERIFICATION_REQUIRED' } });
    });
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
cd water-erp && pnpm --filter api test -- expert.service.spec --testNamePattern="未确认 AI 声明" 2>&1 | tail -20
```
Expected: FAIL（当前门控不检查 `aiConsentConfirmed`，方法不抛错而继续执行，断言落空）。

- [ ] **Step 3: 更新 `mockExpert` 基础 mock**

在 `apps/api/src/expert/expert.service.spec.ts` 第 18-30 行的 `mockExpert` 对象内，`avoidanceConfirmed: false,` 之后加一行 `aiConsentConfirmed: true,`：

```ts
  const mockExpert = {
    id: 'exp-1',
    userId: 'user-1',
    expertName: '王建国',
    projectId: 'proj-1',
    major: '水利工程',
    signedIn: false,
    avoidanceConfirmed: false,
    aiConsentConfirmed: true,
    progress: 0,
    totalScore: 0,
    phoneVerified: true,
    reportConfirmed: false,
  };
```

> 这一步保证 `signedExpert`（`{ ...mockExpert, signedIn: true, avoidanceConfirmed: true }`，第 407 行）等所有派生 mock 都带 `aiConsentConfirmed: true`，加门控后既有用例不被误伤。Task 3 的 `confirmAiConsent` 用例用 `mockExpert`（`signedIn:false`）不受影响——它在门控之前。

- [ ] **Step 4: 改 7 处门控**

在 `apps/api/src/expert/expert.service.ts` 把以下 7 处（行号为当前近似值，用字符串匹配定位）：

```ts
    if (!expert.signedIn || !expert.avoidanceConfirmed) {
      throw new ForbiddenException({ error: '请先完成身份核验和回避确认', code: 'VERIFICATION_REQUIRED' });
    }
```

全部替换为：

```ts
    if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed) {
      throw new ForbiddenException({ error: '请先完成身份核验、回避确认与 AI 辅助评标声明', code: 'VERIFICATION_REQUIRED' });
    }
```

7 处分别在 `getDecryptedDocuments`、`getTenderDocument`/`downloadTenderDocument` 区、`getAssistData`、`submitScores`/评分相关、`getReport`/报告相关、澄清相关、`getMyScores` 相关。用编辑器「全部替换」该 3 行块（该块在文件中完全一致，可安全 replace_all）。

- [ ] **Step 5: 运行整个 expert.service.spec 确认全绿**

Run:
```bash
cd water-erp && pnpm --filter api test -- expert.service.spec 2>&1 | tail -25
```
Expected: PASS——新门控用例过；既有 `signedExpert` 派生用例（getDecryptedDocuments 等）因 mock 已带 `aiConsentConfirmed:true` 不受影响；`身份隔离` 用例（用未签到 mock）在签到/回避上先失败，不受影响。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts
git commit -m "feat(expert): VERIFICATION_REQUIRED 门控纳入 aiConsentConfirmed（B1）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 控制器 `POST /ai-consent` 路由（TDD）

**Files:**
- Modify: `apps/api/src/expert/expert.controller.ts`（紧接 `avoidance` 路由之后，第 57 行后）
- Test: `apps/api/src/expert/expert.controller.spec.ts`（新增 describe + mock 字段）

**Interfaces:**
- Consumes: Task 3 的 `ExpertService.confirmAiConsent`
- Produces: `POST /expert/projects/:projectId/ai-consent` → 调 `confirmAiConsent`（供 Task 6 前端调用）

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/expert/expert.controller.spec.ts` 的 `beforeEach` 中，给 `expertService` 加 `confirmAiConsent: jest.fn()`：

```ts
    expertService = {
      getTenderDocument: jest.fn(),
      downloadTenderDocument: jest.fn(),
      confirmAiConsent: jest.fn(),
    };
```

在文件末尾 `describe('downloadTenderDocument', ...)` 块之后追加：

```ts
  describe('confirmAiConsent', () => {
    it('透传给 service', async () => {
      expertService.confirmAiConsent.mockResolvedValue({ aiConsentConfirmed: true });
      await controller.confirmAiConsent('user-1', 'proj-1');
      expect(expertService.confirmAiConsent).toHaveBeenCalledWith('user-1', 'proj-1');
    });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
cd water-erp && pnpm --filter api test -- expert.controller.spec --testNamePattern="confirmAiConsent" 2>&1 | tail -20
```
Expected: FAIL，`controller.confirmAiConsent is not a function`。

- [ ] **Step 3: 加路由**

在 `apps/api/src/expert/expert.controller.ts` 的 `confirmAvoidance` 方法（第 54-57 行）之后插入：

```ts
  @Post('projects/:projectId/ai-consent')
  confirmAiConsent(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
    return this.expertService.confirmAiConsent(userId, projectId);
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
cd water-erp && pnpm --filter api test -- expert.controller.spec 2>&1 | tail -15
```
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/expert/expert.controller.ts apps/api/src/expert/expert.controller.spec.ts
git commit -m "feat(expert): 新增 POST /ai-consent 路由

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: 前端 ④ 块 + 门控

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`（state、handler、④ JSX、门控、守卫依赖）

**Interfaces:**
- Consumes: Task 2 的 `BidExpert.aiConsentConfirmed` 类型；Task 5 的 `POST /expert/projects/:id/ai-consent`
- Produces: ④ AI 声明 UI 块，确认态读服务端 `expert.aiConsentConfirmed`

> expert-portal 无单测运行器（`package.json` 仅有 dev/build/lint）。本任务用 `pnpm --filter expert-portal build` 做 TS 类型检查 + 手动运行时验证。

- [ ] **Step 1: 加 state**

在 `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx` 第 121 行 `const [avoiding, setAvoiding] = useState(false);` 之后加：

```ts
  const [avoiding, setAvoiding] = useState(false);
  // ④ AI 辅助评标声明：勾选门控（确认态以服务端 expert.aiConsentConfirmed 为准）
  const [aiConsentChecked, setAiConsentChecked] = useState(false);
```

- [ ] **Step 2: 加 handler**

在 `handleAvoidance` 函数（第 346-354 行）之后加：

```ts
  const handleConfirmAiConsent = async () => {
    if (!aiConsentChecked) return;
    setBusy(true);
    try {
      await api.post(`/expert/projects/${projectId}/ai-consent`, {});
      loadProject();
      toast.success('AI 辅助评标声明已确认');
    } catch (e: any) {
      toast.error(e.message || '确认失败');
    }
    setBusy(false);
  };
```

- [ ] **Step 3: 加 ④ JSX 块**

在 ③ 评标纪律块结束（第 972 行 `</div>`，即 `{confidentialityAgreed && disciplineAgreed && (...)}` 已确认条闭合处）之后、第 973 行 `</div>`（闭合 `space-y-4 mb-6`）之前插入：

```tsx
                {/* ===== ④ AI 辅助评标声明 — 评标纪律确认后解锁 ===== */}
                <div className={!disciplineAgreed ? 'opacity-50 pointer-events-none select-none' : ''}>
                  <div className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                    expert?.aiConsentConfirmed ? 'bg-emerald-50 border-emerald-200'
                    : disciplineAgreed ? 'bg-white/70 border-[oklch(0.91_0.006_264)]'
                    : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                      expert?.aiConsentConfirmed ? 'bg-emerald-500 text-white'
                      : disciplineAgreed ? 'bg-[oklch(0.94_0.004_264)] text-[oklch(0.55_0.01_264)]'
                      : 'bg-gray-200 text-gray-400'
                    }`}>
                      {expert?.aiConsentConfirmed ? <Check size={18} strokeWidth={2.5} /> : disciplineAgreed ? '4' : <Lock size={16} strokeWidth={1.5} />}
                    </div>
                    <div className="flex-1">
                      <h3 className={`font-bold ${
                        expert?.aiConsentConfirmed ? 'text-emerald-600'
                        : disciplineAgreed ? 'text-[oklch(0.18_0.012_265)]'
                        : 'text-gray-400'
                      }`}>AI 辅助评标声明</h3>
                      <p className="text-sm text-[oklch(0.55_0.01_264)]">确认 AI 辅助结果仅供参考</p>
                    </div>
                    {!disciplineAgreed && (
                      <span className="text-xs text-[oklch(0.72_0.008_264)] bg-[oklch(0.96_0.004_264)] px-2 py-1 rounded font-semibold">需先确认评标纪律</span>
                    )}
                    {disciplineAgreed && !expert?.aiConsentConfirmed && (
                      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded font-semibold">待签署</span>
                    )}
                  </div>
                  {/* AI 声明书 — 解锁后且未确认时显示 */}
                  {disciplineAgreed && !expert?.aiConsentConfirmed && (
                    <div className="mt-3 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                      <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-2 flex items-center gap-2">
                        <Sparkles size={14} strokeWidth={1.5} /> AI 辅助评标使用声明
                      </h3>
                      <p className="text-sm text-[oklch(0.55_0.01_264)] leading-relaxed mb-3">
                        本项目评审引入人工智能（大语言模型与文档识别）辅助工具，可对投标文件进行合规性检查、风险提示与评分参考分析。本人郑重声明并知悉：
                      </p>
                      <ol className="space-y-2 text-sm text-[oklch(0.55_0.01_264)] mb-4 list-decimal pl-5">
                        <li>AI 辅助工具生成的合规判断、风险提示、评分建议等内容，性质均为<strong className="text-[oklch(0.18_0.012_265)]">辅助参考</strong>，不构成评审结论；</li>
                        <li>上述 AI 意见仅供本人在评标过程中参考，<strong className="text-[oklch(0.18_0.012_265)]">不得干预或干扰本人的独立职业判断</strong>；</li>
                        <li>任何 AI 输出均<strong className="text-[oklch(0.18_0.012_265)]">不得作为本人打分的直接依据或唯一理由</strong>，本人对每一项评分及其理由独立负责；</li>
                        <li>最终评审意见与评分结果，由本人依据招标文件规定的标准和方法、结合专业判断独立作出，不由 AI 决定，亦不因 AI 意见而免除本人的评审责任。</li>
                      </ol>
                      <label className="flex items-center gap-3 cursor-pointer mb-3">
                        <input type="checkbox" checked={aiConsentChecked} onChange={e => setAiConsentChecked(e.target.checked)}
                          className="w-4 h-4 rounded border-blue-200 text-[#064ea2] focus:ring-[#064ea2]" />
                        <span className="text-sm text-[oklch(0.18_0.012_265)] font-semibold">本人已阅读并知悉以上声明</span>
                      </label>
                      <button onClick={handleConfirmAiConsent} disabled={!aiConsentChecked || busy}
                        className="px-5 py-2 bg-[#064ea2] text-white rounded-lg font-bold text-sm hover:bg-[#054280] transition disabled:opacity-50">
                        {busy ? '确认中…' : '确认同意'}
                      </button>
                    </div>
                  )}
                  {/* 已确认条 */}
                  {disciplineAgreed && expert?.aiConsentConfirmed && (
                    <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                      <CheckCircle size={14} strokeWidth={1.5} className="text-emerald-500" />
                      <span className="text-sm text-emerald-600 font-semibold">已确认 AI 辅助评标声明</span>
                    </div>
                  )}
                </div>
```

- [ ] **Step 4: 门控 — `stepAccessible`**

把第 127-131 行（`documents`/`assist`/`compare`/`scoring` 四个 case）从：

```ts
      case 'documents': return !!expert?.signedIn && !!expert?.avoidanceConfirmed;
      case 'assist': return !!expert?.signedIn && !!expert?.avoidanceConfirmed;
      case 'compare': return !!expert?.signedIn && !!expert?.avoidanceConfirmed;
      case 'scoring': return !!expert?.signedIn && !!expert?.avoidanceConfirmed;
```

改为：

```ts
      case 'documents': return !!expert?.signedIn && !!expert?.avoidanceConfirmed && !!expert?.aiConsentConfirmed;
      case 'assist': return !!expert?.signedIn && !!expert?.avoidanceConfirmed && !!expert?.aiConsentConfirmed;
      case 'compare': return !!expert?.signedIn && !!expert?.avoidanceConfirmed && !!expert?.aiConsentConfirmed;
      case 'scoring': return !!expert?.signedIn && !!expert?.avoidanceConfirmed && !!expert?.aiConsentConfirmed;
```

- [ ] **Step 5: 门控 — `stepCompleted('verify')`**

把第 136 行：

```ts
      case 'verify': return !!expert?.signedIn && !!expert?.avoidanceConfirmed && confidentialityAgreed && disciplineAgreed;
```

改为：

```ts
      case 'verify': return !!expert?.signedIn && !!expert?.avoidanceConfirmed && !!expert?.aiConsentConfirmed && confidentialityAgreed && disciplineAgreed;
```

- [ ] **Step 6: 守卫依赖数组**

把第 282 行 useEffect 的依赖数组：

```ts
  }, [step, expert?.signedIn, expert?.avoidanceConfirmed, expert?.reportConfirmed, expert?.progress, confidentialityAgreed, disciplineAgreed]);
```

改为：

```ts
  }, [step, expert?.signedIn, expert?.avoidanceConfirmed, expert?.aiConsentConfirmed, expert?.reportConfirmed, expert?.progress, confidentialityAgreed, disciplineAgreed]);
```

- [ ] **Step 7: 核验完成横幅条件**

把第 1015 行：

```tsx
              {confidentialityAgreed && disciplineAgreed && expert?.signedIn && expert?.avoidanceConfirmed && (
```

改为：

```tsx
              {confidentialityAgreed && disciplineAgreed && expert?.signedIn && expert?.avoidanceConfirmed && expert?.aiConsentConfirmed && (
```

- [ ] **Step 8: 类型检查（build）**

Run:
```bash
cd water-erp && pnpm --filter expert-portal build 2>&1 | tail -20
```
Expected: 构建成功，无 TS 报错（`expert?.aiConsentConfirmed` 类型来自 Task 2 的共享包；`Sparkles`/`Check`/`Lock`/`CheckCircle` 均已在第 11 行 import）。

- [ ] **Step 9: 手动运行时验证**

启动（如未运行）：`pnpm dev:api` + `pnpm dev:expert`。用种子专家登录（如 `刘苡池` / `expert@2026`，见 CLAUDE.md），进入 `/evaluate/<英雄项目id>`：

1. 完成 ① 手机验证 + 签到 → ② 勾保密承诺 → ③ 勾评标纪律；
2. ④ 解锁，显示蓝色声明书 + 勾选框 + 「确认同意」按钮（未勾时按钮 disabled）；
3. 勾选 → 点「确认同意」→ 块变绿「已确认 AI 辅助评标声明」；步骤指示器「身份核验」打绿勾；
4. 刷新页面 → ④ 直接显示绿色已确认条（读服务端，无需重勾），但 ②③ 因纯前端 state 需重勾（既有行为）；
5. 核验完成横幅出现 → 点「进入标书获取」可进入；
6. （回归）辅助评标页脚那行既有声明仍在，未被改动。

Expected: 全部通过。

- [ ] **Step 10: 提交**

```bash
git add apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx
git commit -m "feat(expert-portal): 身份核验新增 ④ AI 辅助评标声明块（持久化）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: 全量回归

- [ ] **Step 1: API 单测全量**

Run:
```bash
cd water-erp && pnpm --filter api test 2>&1 | tail -25
```
Expected: 全绿。重点关注 expert.service.spec / expert.controller.spec。

- [ ] **Step 2: e2e（确认无回归）**

Run:
```bash
cd water-erp && pnpm --filter api test:e2e 2>&1 | tail -25
```
Expected: 全绿。注：e2e 不调用任何 `expert/projects/*` 接口（已核实 `apps/api/test/*.e2e-spec.ts` 无 `expert/projects` 引用），故 B1 门控不影响 e2e；此步仅防意外回归。

- [ ] **Step 3: 验收清单核对**

对照设计文档第 7 节 5 条验收标准逐条核对（已在 Task 6 Step 9 覆盖 1-3、5；第 4 条「未确认时直调 documents API → 403」可在 Step 1 单测 `未确认 AI 声明 → VERIFICATION_REQUIRED` 印证）。

- [ ] **Step 4: 收尾提交（如有 lint 修正）**

```bash
cd water-erp && pnpm --filter expert-portal lint 2>&1 | tail -10
```
如有 lint 报错，修正后提交；无则跳过。
