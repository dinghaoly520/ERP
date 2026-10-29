# 保证金金额 AI 生成纯数字约束 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** :3005 采购文件编写中，两个保证金金额字段（响应/履约）选「收取」后，右侧 AI 生成只产出纯数字（单位元），不产出文本。

**Architecture:** 双层约束——前端 `templates.ts` 给字段配 `aiPrompt`（软约束、引导首次即合规），后端 `generateTenderFieldContent` 对命中 fieldKey 做纯数字硬校验（全匹配判定、不合规进既有 3 次重试、仍失败抛明确错误）。后端是唯一收口点，覆盖所有调用方。

**Tech Stack:** Next.js 16（apps/web 数据层）、NestJS 11 + Jest（apps/api）。

**Spec:** `docs/superpowers/specs/2026-10-29-tender-deposit-amount-numeric-ai-design.md`

## Global Constraints

- 金额口径：纯阿拉伯数字、单位元、至多两位小数（`^\d+(\.\d{1,2})?$`）；不带任何单位/大写/标点/说明文字。
- 后端校验是**全匹配判定**，禁止正则从混杂文本中提取数字（防「5万→5」错值）。
- 并行会话在制改动（`apps/web/src/lib/notice/schedule.*`、supplier dashboard 等）：**禁用 `git add -A`/`git add .`，只 add 本计划列出的文件路径**。
- 提交信息按仓库惯例中文 + 模块前缀（`feat(api):` / `feat(web):`），结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 工作目录：`/Users/qihao/ERP2/ERP/water-erp`（所有 pnpm/git 命令在此执行）。

---

### Task 1: 后端纯数字硬校验（TDD）

**Files:**
- Modify: `apps/api/src/ai/ai.service.ts`（`generateTenderFieldContent`，约 2641-2681 行；类声明前加模块常量）
- Test: `apps/api/src/ai/ai.service.spec.ts`（文件末尾追加 describe）

**Interfaces:**
- Consumes: 既有 `generateTenderFieldContent(payload: { fieldKey; fieldLabel; currentValue; aiPrompt?; context? })` 签名与既有 `llm.chatJson`/`sanitizeAiText`/`toFriendlyLlmError`，均不变。
- Produces: `generateTenderFieldContent` 返回类型不变 `{ content: string }`；新增模块常量 `TENDER_NUMERIC_AMOUNT_FIELDS`（私有于本文件，Task 2 不依赖）；新增类私有方法 `normalizeNumericAmountField(content: string): string | null`。

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/ai/ai.service.spec.ts` 文件末尾（最外层 describe 内、最后一个 describe 之后）追加：

```ts
  describe('generateTenderFieldContent（保证金金额纯数字硬校验，2026-10-29）', () => {
    it('金额字段：纯数字原样透传', async () => {
      (service as any).llm.chatJson.mockResolvedValue({ content: '50000' });
      const res = await service.generateTenderFieldContent({
        fieldKey: 'responseDepositAmount', fieldLabel: '响应保证金金额', currentValue: '', context: {},
      });
      expect(res.content).toBe('50000');
    });

    it('金额字段：千分位逗号与结尾「元」规整为纯数字', async () => {
      (service as any).llm.chatJson.mockResolvedValue({ content: '50,000元' });
      const res = await service.generateTenderFieldContent({
        fieldKey: 'performanceDepositAmount', fieldLabel: '履约保证金金额', currentValue: '', context: {},
      });
      expect(res.content).toBe('50000');
    });

    it('金额字段：无阿拉伯数字的文本（伍万元整）→ 3 次重试后明确报错', async () => {
      (service as any).llm.chatJson.mockResolvedValue({ content: '伍万元整' });
      await expect(
        service.generateTenderFieldContent({
          fieldKey: 'responseDepositAmount', fieldLabel: '响应保证金金额', currentValue: '', context: {},
        }),
      ).rejects.toThrow('未返回纯数字金额');
      expect((service as any).llm.chatJson).toHaveBeenCalledTimes(3);
    });

    it('金额字段：数字+文本混杂（保证金5万元）不做提取 → 重试后报错（防「5万→5」错值）', async () => {
      (service as any).llm.chatJson.mockResolvedValue({ content: '保证金5万元' });
      await expect(
        service.generateTenderFieldContent({
          fieldKey: 'performanceDepositAmount', fieldLabel: '履约保证金金额', currentValue: '', context: {},
        }),
      ).rejects.toThrow('未返回纯数字金额');
    });

    it('非金额字段不受校验：文本照常返回', async () => {
      (service as any).llm.chatJson.mockResolvedValue({ content: '自合同签订之日起60日内完成供货' });
      const res = await service.generateTenderFieldContent({
        fieldKey: 'projectDuration', fieldLabel: '项目完成期限', currentValue: '', context: {},
      });
      expect(res.content).toBe('自合同签订之日起60日内完成供货');
    });
  });
```

- [ ] **Step 2: 跑测试确认按预期失败**

```bash
pnpm --filter api test -- ai.service
```

预期：新增 5 例中——「纯数字透传」「非金额字段」两例 PASS（现状恰好兼容）；「50,000元 规整」「伍万元整 报错」「保证金5万元 报错」三例 FAIL（现状无校验：`50,000元` 原样返回 ≠ `50000`；文本内容当前被当成功返回而非 rejects）。整体 3 failed 即为预期红灯。

- [ ] **Step 3: 实现**

3a. 在 `apps/api/src/ai/ai.service.ts` 的 `@Injectable()` 类声明**之前**（imports 之后）加模块常量：

```ts
/** 保证金金额字段（2026-10-29 用户裁定）：AI 只能产出纯数字（单位元，预览模板自带「元」后缀）。
 *  硬校验在 generateTenderFieldContent；前端 templates.ts 的 aiPrompt 是软约束（首次即合规引导）。 */
const TENDER_NUMERIC_AMOUNT_FIELDS = new Set(['responseDepositAmount', 'performanceDepositAmount']);
```

3b. 在 `generateTenderFieldContent` 方法**之前**加类私有方法：

```ts
  /** 金额字段结果规整：去空白/全半角千分位逗号/货币符/结尾「元」；非纯数字（至多两位小数）返回 null */
  private normalizeNumericAmountField(content: string): string | null {
    const cleaned = content
      .replace(/[\s,，]/g, '')
      .replace(/^[¥￥]/, '')
      .replace(/元$/, '');
    return /^\d+(\.\d{1,2})?$/.test(cleaned) ? cleaned : null;
  }
```

3c. 改 `generateTenderFieldContent`：

方法开头（`const systemPrompt` 之前）加一行：

```ts
    const isNumericAmountField = TENDER_NUMERIC_AMOUNT_FIELDS.has(payload.fieldKey);
```

`systemPrompt` 拼接改为（在「现为"…"字段生成内容」那句**之前**插入条件段；其余原文一字不动）：

```ts
    const systemPrompt =
      `你是招标/采购文件编写专家。默认以采购方（招标方）立场行文，向供应商提出要求、规范其投标与报价行为；` +
      `若字段要求中明确指定以供应商口吻填写（如供应商填报的报价清单），则按该字段指定口吻生成。` +
      `涉及天数、百分比、期限、比例、数量、技术参数等可量化指标时，必须根据项目类型、规模、行业惯例直接填入合理具体的数值，禁止使用 ____ 下划线、空格、括号等占位符，也禁止「待定」「另行约定」等模糊表述；唯有最终投标报价金额（供应商需填报的分项报价、总报价）以 ____ 留空供供应商填写。` +
      `只输出正文：不写标题、抬头（如 致：××）或落款签字栏（如 投标人盖章、法定代表人签字、日期）。` +
      `严禁在正文开头重复字段名称作为前缀（例如字段是"项目完成期限"，正文直接写"自合同签订之日起 60 日内完成"，不得写成"项目完成期限：自合同签订之日起 60 日内完成"）。` +
      (isNumericAmountField
        ? `本字段为金额数字字段：只输出一个纯阿拉伯数字（单位为元，如 50000），严禁任何单位（元/万元/人民币/¥）、大写金额、标点与说明文字。`
        : '') +
      `现为"${payload.fieldLabel}"字段生成内容。只返回 JSON: {"content": "正文"}，content 字段不得为空字符串。`;
```

重试循环与收尾（`let lastError` 起到方法尾）整体替换为：

```ts
    // LLM 调用可能因限流/网络/解析偶发失败，重试 3 次以提升稳定性
    let lastError: unknown;
    let emptyCount = 0;
    let nonNumericCount = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.llm.chatJson<{ content: string }>(systemPrompt, userPrompt);
        const content = await this.sanitizeAiText((result.content || '').trim());
        if (isNumericAmountField) {
          // 金额字段：纯数字全匹配才算成功——「50,000元」规整为 50000；
          // 「伍万元整」「保证金5万元」等计失败重试，不做正则提取（防「5万→5」错值）
          const numeric = content ? this.normalizeNumericAmountField(content) : null;
          if (numeric) return { content: numeric };
          nonNumericCount++;
        } else if (content) {
          return { content };
        } else {
          emptyCount++;
        }
      } catch (err) {
        lastError = err;
      }
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      }
    }
    // 全部重试失败 —— 区分错误类型，便于前端诊断（避免笼统的"AI 生成失败"）
    if (lastError instanceof Error) throw toFriendlyLlmError(lastError);
    if (nonNumericCount > 0) {
      throw new Error(
        `AI 连续 ${nonNumericCount} 次未返回纯数字金额（应为以元为单位的小写数字，如 50000），请重试或手动填写`,
      );
    }
    if (emptyCount > 0) {
      throw new Error(
        `AI 连续 ${emptyCount} 次返回空内容，可能为字段"${payload.fieldLabel}"配置不当或模型异常，请调整提示词后重试`,
      );
    }
    throw new Error('AI 生成失败，请稍后重试');
```

- [ ] **Step 4: 跑测试确认全绿**

```bash
pnpm --filter api test -- ai.service
```

预期：ai.service 全部用例 PASS（含既有用例无回归）。失败用例内含 600+1200ms 退避等待，单例约 1.8s，默认 5s 超时内。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/ai/ai.service.ts apps/api/src/ai/ai.service.spec.ts
git commit -m "feat(api): 保证金金额字段 AI 生成纯数字硬校验——tender-field-generate 全匹配判定+重试后明确报错

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 前端 aiPrompt 与占位文案

**Files:**
- Modify: `apps/web/src/lib/tender-write/templates.ts:617-629`（responseDepositAmount）、`:697-701`（performanceDepositAmount）

**Interfaces:**
- Consumes: 既有字段类型 `aiPrompt?: string`（`apps/web/src/lib/types/tender-write.ts:256`）与 `tender-section-editor.tsx` 既有 `field.aiPrompt` 透传（`handleAiGenerate` → `/ai/tender-field-generate` 的 `要求:` 槽）。无需改任何组件。
- Produces: 无（纯数据变更，无下游依赖新符号）。

测试说明：本任务是提示词字符串与占位文案（纯数据），行为保证在 Task 1 的后端硬校验（已有测试锁定），不为其新增模板快照测试——对两句提示词做字符串断言无回归价值（YAGNI）。

- [ ] **Step 1: 改 responseDepositAmount**

`apps/web/src/lib/tender-write/templates.ts` 中（约 617 行起）：

```ts
      {
        key: "responseDepositAmount",
        label: "响应保证金金额",
        placeholder: "请输入金额（小写数字）",
        composite: {
```

在 `placeholder` 行之后、`composite` 之前插入一行：

```ts
        aiPrompt: "生成响应保证金金额。只输出一个纯阿拉伯数字（单位为元，如 50000），不要包含元、万元、人民币等任何单位，不要大写金额，不要标点、空格或任何说明文字。金额为具体数值，原则上不超过项目预算金额的2%。",
```

- [ ] **Step 2: 改 performanceDepositAmount**

同文件（约 697 行）整块替换：

```ts
      {
        key: "performanceDepositAmount",
        label: "履约保证金金额",
        placeholder: "请输入金额及比例，例如：合同金额的10%",
      },
```

替换为：

```ts
      {
        key: "performanceDepositAmount",
        label: "履约保证金金额",
        placeholder: "请输入金额（小写数字）",
        aiPrompt: "生成履约保证金金额。只输出一个纯阿拉伯数字（单位为元，如 50000），不要包含元、万元、人民币等任何单位，不要大写金额，不要标点、空格或任何说明文字。金额为具体数值，原则上不超过合同金额的10%折算所得金额。",
      },
```

- [ ] **Step 3: lint 验证**

```bash
pnpm --filter web lint
```

预期：通过（纯数据变更，字段类型已含 `aiPrompt?`）。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/lib/tender-write/templates.ts
git commit -m "feat(web): 保证金金额字段配 AI 纯数字提示词——履约占位文案弃比例语义改小写数字（2026-10-29 裁定）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 全量回归验证

**Files:** 无新改动（只读验证）。

- [ ] **Step 1: api 全量单测**

```bash
pnpm --filter api test
```

预期：全部 PASS（含既有 ai.service / 加密 / envelope 等套件无回归）。

- [ ] **Step 2: 确认工作区只含本计划改动**

```bash
git log --oneline -3
git status --short
```

预期：最近 3 条提交 = Task 1、Task 2 + spec 提交（`7a87c046`）；`git status` 中不出现本计划文件之外的、由本次工作引入的改动（并行会话的在制文件不属于本次，勿动）。

- [ ] **Step 3: 向用户汇报**

汇报内容：两字段 AI 生成已约束为纯数字（前端提示词 + 后端硬校验双保险）、失败时报错文案、测试结果（新增 5 例 + 全量绿）。

---

## Self-Review 记录

- **Spec 覆盖**：spec §改动清单 1（templates.ts 两处）→ Task 2；§2（后端校验/常量/报错）→ Task 1；§3（5 个测试用例）→ Task 1 Step 1；§明确不动 → 全程未触碰预览文档/DTO/数据库/显隐逻辑。✓
- **占位符扫描**：无 TBD/TODO/「适当处理」类；所有代码步骤含完整代码。✓
- **类型一致性**：`TENDER_NUMERIC_AMOUNT_FIELDS`、`normalizeNumericAmountField` 在 Task 1 内自洽；Task 2 不消费新符号；`aiPrompt` 字段名与类型定义（`tender-write.ts:256`）、editor 透传（`field.aiPrompt`）一致。✓
- **时序**：Task 1 先行（硬保证层），Task 2 独立无依赖，Task 3 收尾。✓
