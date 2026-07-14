# 专家门户「身份核验」新增 AI 辅助评标声明（④）— 设计文档

- 日期：2026-07-13
- 触发页面：`http://localhost:3006/evaluate/{projectId}` → 身份核验步骤
- 范围：全栈（DB + API + 前端），含服务端硬门控（方案 B1）
- 决策：声明正文已定稿 / 服务端门控 B1 / 种子专家不预置 `aiConsentConfirmed`

## 1. 背景与目标

专家门户的「身份核验」步骤（`apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`）当前是三段递进的承诺链：① 身份核验（手机+签到）→ ② 保密承诺 → ③ 评标纪律，之后是利益冲突回避，最后「核验完成」解锁标书获取。

本项目评标引入 AI 辅助（「辅助评标」步骤 + `assist-panel.tsx`）：AI（大模型 + 文档识别）产出合规门、证据层、评分建议、跨供应商对比。辅助评标面板页脚已有一行声明「以上结果由 AI 辅助生成，仅供参考，以专家独立评分为准」，但那是事后提示，且**无留痕、无强制确认**。

目标：在签到环节加一份正式的 **AI 辅助评标使用声明**，作为第 ④ 段承诺：

- 专家必须阅读并确认后方可进入后续评标；
- 确认记录**持久化**（带时间戳），供合规审计；
- 服务端硬门控，直接调 API 也绕不过；
- 明确 AI 意见仅供参考、不得干预独立职业判断、不得作为打分依据。

## 2. 声明正文（定稿）

> **AI 辅助评标使用声明**
>
> 本项目评审引入人工智能（大语言模型与文档识别）辅助工具，可对投标文件进行合规性检查、风险提示与评分参考分析。本人郑重声明并知悉：
>
> 一、AI 辅助工具生成的合规判断、风险提示、评分建议等内容，性质均为**辅助参考**，不构成评审结论；
>
> 二、上述 AI 意见仅供本人在评标过程中参考，**不得干预或干扰本人的独立职业判断**；
>
> 三、任何 AI 输出均**不得作为本人打分的直接依据或唯一理由**，本人对每一项评分及其理由独立负责；
>
> 四、最终评审意见与评分结果，由本人依据招标文件规定的标准和方法、结合专业判断独立作出，不由 AI 决定，亦不因 AI 意见而免除本人的评审责任。
>
> 本人确认已阅读并充分理解上述声明。

## 3. 后端改动

### 3.1 Schema（`apps/api/prisma/schema.prisma`，`BidExpert` 模型）

新增两字段（与 `reportConfirmed` / `reportConfirmedAt` 同款）：

```prisma
aiConsentConfirmed Boolean @default(false)
aiConsentAt        DateTime?
```

迁移按 `CLAUDE.md` 非交互流程：`prisma migrate dev --create-only` → `prisma db execute` → `prisma migrate resolve --applied`。

### 3.2 Service（`apps/api/src/expert/expert.service.ts`）

新增 `confirmAiConsent(userId, projectId)`，照搬 `confirmAvoidance`（第 261 行）骨架：

1. 阶段门控：`stage` 必须为 `OPENING` 或 `EVALUATING`，否则 `ForbiddenException({ error: '项目不在可确认 AI 声明阶段', code: 'PROJECT_NOT_ACTIVE' })`。
2. `findFirst({ where: { userId, projectId } })`，无记录抛 `ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' })`。
3. `update({ where: { id: expert.id }, data: { aiConsentConfirmed: true, aiConsentAt: new Date() } })`。
4. （可选）`this.gateway?.notifyExpertPresence(projectId, { expertId, expertName, milestone: 'ai_consent_confirmed', progressPercent })`。
5. 返回 `updated`。

幂等：重复确认只刷新 `aiConsentAt`，不报错（与签到/回避一致）。

### 3.3 Controller（`apps/api/src/expert/expert.controller.ts`）

紧挨 `avoidance` 路由（第 54 行）之后新增：

```ts
@Post('projects/:projectId/ai-consent')
confirmAiConsent(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string) {
  return this.expertService.confirmAiConsent(userId, projectId);
}
```

无需 DTO（无 body 参数）。

### 3.4 服务端硬门控（方案 B1）

现有 7 处门控（`expert.service.ts` 第 305 / 365 / 537 / 703 / 903 / 1028 / 1124 行）：

```ts
if (!expert.signedIn || !expert.avoidanceConfirmed) {
  throw new ForbiddenException({ error: '请先完成身份核验和回避确认', code: 'VERIFICATION_REQUIRED' });
}
```

全部改为：

```ts
if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed) {
  throw new ForbiddenException({ error: '请先完成身份核验、回避确认与 AI 辅助评标声明', code: 'VERIFICATION_REQUIRED' });
}
```

### 3.5 `myExpertRecord` 字段透出

`getProject`（第 172 行）中 `myExpertRecord = { ...expertRecord, ... }` 是展开，`aiConsentConfirmed` / `aiConsentAt` 自动带到前端，**无需改动 select**。

## 4. 前端改动（`apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`）

### 4.1 新增 ④ AI 辅助评标声明 块

插在 ③ 评标纪律块（第 917-972 行）之后、利益冲突回避块（第 975 行）之前。视觉沿用 ②③ 同款：

- 头部卡片：序号圆圈「4」（未解锁为 `<Lock>`）、标题「AI 辅助评标声明」、副标题「确认 AI 辅助结果仅供参考」、状态徽标（未解锁「需先确认评标纪律」/ 已解锁未签「待签署」/ 已签绿色）。
- 解锁条件：`disciplineAgreed === true`（跟在 ③ 后）。未解锁时 `opacity-50 pointer-events-none select-none`。
- 已解锁且 `!expert?.aiConsentConfirmed`：蓝色声明书卡片（`bg-blue-50 border border-blue-100`，图标用 `Sparkles`），渲染第 2 节正文（标题 + 引言 + 四条 + 确认语）。
- 声明卡片内交互：
  - 勾选框 `<input type="checkbox">`，文案「本人已阅读并知悉以上声明」，绑定本地 state `aiConsentChecked`（默认 false）。
  - 「确认同意」按钮：`aiConsentChecked` 为 false 时 disabled；点击调 `handleConfirmAiConsent()` → `POST /expert/projects/:id/ai-consent` → 成功 `loadProject()` 刷新 + toast「AI 辅助评标声明已确认」；失败 toast 报错。`busy` 期间按钮显示「确认中…」。
- `expert?.aiConsentConfirmed === true`：绿色确认条「已确认 AI 辅助评标声明」（`bg-emerald-50 border-emerald-200`，`CheckCircle` 图标），与 ②③ 已签条一致。

新增 state：`const [aiConsentChecked, setAiConsentChecked] = useState(false);`（仅为按钮启用门控，确认态以服务端 `expert.aiConsentConfirmed` 为准）。

新增 handler：

```ts
const handleConfirmAiConsent = async () => {
  if (!aiConsentChecked) return;
  setBusy(true);
  try { await api.post(`/expert/projects/${projectId}/ai-consent`, {}); loadProject(); toast.success('AI 辅助评标声明已确认'); }
  catch (e: any) { toast.error(e.message || '确认失败'); }
  setBusy(false);
};
```

### 4.2 门控更新

- `stepCompleted('verify')`（第 136 行）：追加 `&& !!expert?.aiConsentConfirmed`。
- 「核验完成」横幅条件（第 1015 行）：追加 `&& expert?.aiConsentConfirmed`。
- `stepAccessible`（第 124 行）：`documents` / `assist` / `compare` / `scoring` 四个分支追加 `&& !!expert?.aiConsentConfirmed`。
  - **原因**：B1 下服务端对这些接口硬门控；若 `stepAccessible` 仍只看 `signedIn && avoidanceConfirmed`，已签到+回避但未确认 AI 声明的专家能点进「标书获取」等步骤，随即触发 403，是体验陷阱。②③ 不存在此问题，因为它们服务端不挡。加进 `stepAccessible` 后，未确认 AI 声明时这些步骤按钮 disabled，与「核验完成」横幅的门控一致。
  - `verify` 分支（`return true`）不变；`report` 分支不变。
- 重定向守卫（第 277-282 行 useEffect）：依赖数组追加 `expert?.aiConsentConfirmed`，确保确认状态变化后守卫重新求值。

### 4.3 类型

`apps/expert-portal/src/lib/types.ts`（或 `@water-erp/shared` 中 `myExpertRecord` 对应类型）补：

```ts
aiConsentConfirmed?: boolean;
aiConsentAt?: string | null;
```

## 5. 数据 / 测试影响

- **种子数据**：字段默认 `false`，`apps/api/prisma/seed-data/*.json` 不需改。英雄项目已签到种子专家会被重新门控，下次进入需点一次「确认同意」——**保持真实，不预置**（已确认）。
- **e2e（`apps/api/test/bid.e2e`）**：B1 下专家流程接口需先 `POST /ai-consent`，否则 403。在专家首次拿 documents/assist/scores 前补一步确认调用。
- **单元测试**：`expert.service.spec.ts` 补 `confirmAiConsent` 用例（成功 / 非专家 / 非活动阶段 / 幂等）；门控用例补 `aiConsentConfirmed=false` → 抛 `VERIFICATION_REQUIRED`。
- **迁移幂等**：纯加列、有默认值，安全。

## 6. 非目标（YAGNI）

- 不持久化 ② 保密承诺 / ③ 评标纪律（保持现状，不在本任务扩展）。
- 不改「辅助评标」面板页脚那行既有声明（互补关系）。
- 不做撤回/重置 AI 声明的管理端入口（一旦确认即锁定，与签到/回避一致）。
- 不引入 `ensureVerified()` helper 抽象 7 处门控（保持与现有重复风格一致，避免无关重构）。

## 7. 验收标准

1. 专家进入身份核验，完成 ①②③ 后 ④ 解锁；未勾选并确认前，「核验完成」不出现，无法进标书获取。
2. 点「确认同意」后 `BidExpert.aiConsentConfirmed=true` 且 `aiConsentAt` 落库；块变绿。
3. 刷新/重进页面，④ 直接显示绿色已确认条（读服务端），无需重勾。
4. 直接 `GET /expert/projects/:id/documents/:sid`（未确认 AI 声明时）→ 403 `VERIFICATION_REQUIRED`。
5. e2e 与单元测试通过。
