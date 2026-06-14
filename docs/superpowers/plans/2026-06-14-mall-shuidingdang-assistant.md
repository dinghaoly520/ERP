# Mall Shui Ding Dang Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mall page's current price-stat AI strip with an in-page Shui Ding Dang search entry that opens a centered, lightweight assistant dialog tailored to electronic-mall price analysis.

**Architecture:** Build a local `apps/mall` assistant component set and keep the existing `POST /api/ai` route as the only server integration. `page.tsx` owns mall business state and passes a compact assistant context into `MallAssistantEntry`; the dialog manages transient messages in memory only. Copy the Shui Ding Dang image assets from the procurement project into mall public assets and use them via a focused avatar component.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, existing mall `/api/ai` DeepSeek route, static WebP assets under `public/DingDang`.

---

## File Structure

Create these files:

- `water-erp/apps/mall/src/app/assistant/types.ts` — shared assistant message/context/expression types.
- `water-erp/apps/mall/src/app/assistant/mall-assistant-avatar.tsx` — Shui Ding Dang avatar using real character assets.
- `water-erp/apps/mall/src/app/assistant/mall-assistant-message.tsx` — user/assistant message bubble rendering.
- `water-erp/apps/mall/src/app/assistant/mall-assistant-welcome.tsx` — minimal welcome state and quick prompts.
- `water-erp/apps/mall/src/app/assistant/mall-assistant-dialog.tsx` — centered modal, message state, AI calls, loading/error handling.
- `water-erp/apps/mall/src/app/assistant/mall-assistant-entry.tsx` — in-page search-bar style entry that opens the dialog.

Modify these files:

- `water-erp/apps/mall/src/app/page.tsx` — remove old AI states/UI from the page, build assistant context, render `MallAssistantEntry`, and wire item-detail analysis into the new dialog when applicable.
- `water-erp/apps/mall/src/app/api/ai/route.ts` — replace the generic price assistant prompt with the mall Shui Ding Dang prompt.

Copy these assets:

- From `/Users/qihao/Desktop/procurement/apps/web/public/DingDang/{normal,thinking,serious}_{sm,md,lg}.webp`
- To `/Users/qihao/Desktop/ERP/water-erp/apps/mall/public/DingDang/{normal,thinking,serious}_{sm,md,lg}.webp`

Do not add persistent chat history, SSE, tool calling, cross-page assistant provider, or floating assistant UI.

---

### Task 1: Copy Shui Ding Dang Assets

**Files:**
- Create directory: `water-erp/apps/mall/public/DingDang/`
- Copy assets into: `water-erp/apps/mall/public/DingDang/`

- [ ] **Step 1: Copy only the required character assets**

Run from repository root `/Users/qihao/Desktop/ERP`:

```bash
mkdir -p water-erp/apps/mall/public/DingDang
cp /Users/qihao/Desktop/procurement/apps/web/public/DingDang/normal_sm.webp water-erp/apps/mall/public/DingDang/normal_sm.webp
cp /Users/qihao/Desktop/procurement/apps/web/public/DingDang/normal_md.webp water-erp/apps/mall/public/DingDang/normal_md.webp
cp /Users/qihao/Desktop/procurement/apps/web/public/DingDang/normal_lg.webp water-erp/apps/mall/public/DingDang/normal_lg.webp
cp /Users/qihao/Desktop/procurement/apps/web/public/DingDang/thinking_sm.webp water-erp/apps/mall/public/DingDang/thinking_sm.webp
cp /Users/qihao/Desktop/procurement/apps/web/public/DingDang/thinking_md.webp water-erp/apps/mall/public/DingDang/thinking_md.webp
cp /Users/qihao/Desktop/procurement/apps/web/public/DingDang/thinking_lg.webp water-erp/apps/mall/public/DingDang/thinking_lg.webp
cp /Users/qihao/Desktop/procurement/apps/web/public/DingDang/serious_sm.webp water-erp/apps/mall/public/DingDang/serious_sm.webp
cp /Users/qihao/Desktop/procurement/apps/web/public/DingDang/serious_md.webp water-erp/apps/mall/public/DingDang/serious_md.webp
cp /Users/qihao/Desktop/procurement/apps/web/public/DingDang/serious_lg.webp water-erp/apps/mall/public/DingDang/serious_lg.webp
```

Expected: command exits with code 0.

- [ ] **Step 2: Verify copied files exist**

Run:

```bash
find water-erp/apps/mall/public/DingDang -maxdepth 1 -type f | sort
```

Expected output includes exactly these nine required files:

```text
water-erp/apps/mall/public/DingDang/normal_lg.webp
water-erp/apps/mall/public/DingDang/normal_md.webp
water-erp/apps/mall/public/DingDang/normal_sm.webp
water-erp/apps/mall/public/DingDang/serious_lg.webp
water-erp/apps/mall/public/DingDang/serious_md.webp
water-erp/apps/mall/public/DingDang/serious_sm.webp
water-erp/apps/mall/public/DingDang/thinking_lg.webp
water-erp/apps/mall/public/DingDang/thinking_md.webp
water-erp/apps/mall/public/DingDang/thinking_sm.webp
```

- [ ] **Step 3: Commit assets**

```bash
git add water-erp/apps/mall/public/DingDang
git commit -m "feat(mall): add Shui Ding Dang assistant assets" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Add Assistant Types and Avatar Component

**Files:**
- Create: `water-erp/apps/mall/src/app/assistant/types.ts`
- Create: `water-erp/apps/mall/src/app/assistant/mall-assistant-avatar.tsx`

- [ ] **Step 1: Create shared assistant types**

Create `water-erp/apps/mall/src/app/assistant/types.ts` with:

```ts
export type MallAssistantExpression = 'normal' | 'thinking' | 'serious';

export type MallAssistantRole = 'user' | 'assistant';

export interface MallAssistantMessage {
  id: string;
  role: MallAssistantRole;
  content: string;
}

export interface MallAssistantContextItem {
  code: string;
  name: string;
  specification: string;
  category: string;
  referencePrice: number;
  unit: string;
  priceRange: string;
  averagePrice: number;
  supplier: string;
  priceSource: string;
  region: string;
  validUntil: string | null;
  status: string;
  changeRate: number;
}

export interface MallAssistantBudgetLine {
  code: string;
  name: string;
  qty: number;
  unit: string;
  referencePrice: number;
}

export interface MallAssistantSelectedItem extends MallAssistantContextItem {
  id: string;
  supplierType: string;
  minOrder: string;
  remark: string | null;
}

export interface MallAssistantContext {
  totalItems: number;
  currentFilters: {
    category: string;
    region: string;
    status: string;
    source: string;
    search: string;
  };
  riskSummary: {
    safe: number;
    inquiry: number;
    expiring: number;
    review: number;
  };
  visibleItems: MallAssistantContextItem[];
  budget: MallAssistantBudgetLine[];
  selectedItem?: MallAssistantSelectedItem | null;
}
```

- [ ] **Step 2: Create the avatar component**

Create `water-erp/apps/mall/src/app/assistant/mall-assistant-avatar.tsx` with:

```tsx
import type { MallAssistantExpression } from './types';

const imageByExpression: Record<MallAssistantExpression, string> = {
  normal: 'normal',
  thinking: 'thinking',
  serious: 'serious',
};

interface MallAssistantAvatarProps {
  expression?: MallAssistantExpression;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses: Record<NonNullable<MallAssistantAvatarProps['size']>, string> = {
  sm: 'h-9 w-9',
  md: 'h-14 w-14',
  lg: 'h-20 w-20',
};

export function MallAssistantAvatar({ expression = 'normal', size = 'md', className = '' }: MallAssistantAvatarProps) {
  const src = `/DingDang/${imageByExpression[expression]}_${size}.webp`;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_25%,rgba(232,244,255,.98),rgba(120,184,255,.78)_48%,rgba(54,116,214,.70))] p-1 shadow-[0_10px_26px_rgba(6,78,162,.18)] ring-1 ring-white/70 ${sizeClasses[size]} ${className}`}
    >
      <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,.75),transparent_34%)]" />
      <img src={src} alt="水叮当" className="relative h-full w-full rounded-full object-contain" />
    </span>
  );
}
```

- [ ] **Step 3: Run mall lint**

Run from `water-erp/`:

```bash
pnpm --filter mall lint
```

Expected: PASS with no TypeScript or ESLint errors related to the new files.

- [ ] **Step 4: Commit types and avatar**

```bash
git add water-erp/apps/mall/src/app/assistant/types.ts water-erp/apps/mall/src/app/assistant/mall-assistant-avatar.tsx
git commit -m "feat(mall): add assistant avatar foundation" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Add Welcome and Message Components

**Files:**
- Create: `water-erp/apps/mall/src/app/assistant/mall-assistant-message.tsx`
- Create: `water-erp/apps/mall/src/app/assistant/mall-assistant-welcome.tsx`

- [ ] **Step 1: Create message bubble component**

Create `water-erp/apps/mall/src/app/assistant/mall-assistant-message.tsx` with:

```tsx
import { MallAssistantAvatar } from './mall-assistant-avatar';
import type { MallAssistantMessage as Message } from './types';

interface MallAssistantMessageProps {
  message: Message;
}

export function MallAssistantMessage({ message }: MallAssistantMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <MallAssistantAvatar size="sm" expression="serious" />}
      <div
        className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm ${
          isUser
            ? 'rounded-br-md bg-[#064ea2] text-white'
            : 'rounded-bl-md border border-[#e1e9f4] bg-white text-[#24364f]'
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create minimal welcome component**

Create `water-erp/apps/mall/src/app/assistant/mall-assistant-welcome.tsx` with:

```tsx
import { MallAssistantAvatar } from './mall-assistant-avatar';
import type { MallAssistantContext } from './types';

const QUICK_QUESTIONS = ['分析当前筛选结果', '找出需复核价格', '生成预算清单建议'];

interface MallAssistantWelcomeProps {
  context: MallAssistantContext;
  onAsk: (question: string) => void;
}

const isActiveFilter = (value: string) => value.trim() && value !== '全部';

function buildContextHint(context: MallAssistantContext) {
  const filters = [
    isActiveFilter(context.currentFilters.category) ? context.currentFilters.category : null,
    isActiveFilter(context.currentFilters.region) ? context.currentFilters.region : null,
    isActiveFilter(context.currentFilters.status) ? context.currentFilters.status : null,
    isActiveFilter(context.currentFilters.source) ? context.currentFilters.source : null,
    context.currentFilters.search.trim() ? `关键词「${context.currentFilters.search.trim()}」` : null,
  ].filter(Boolean);

  const parts: string[] = [];
  if (filters.length > 0) parts.push(`当前筛选：${filters.join(' / ')}`);
  if (context.budget.length > 0) parts.push(`预算清单 ${context.budget.length} 项`);
  if (context.selectedItem) parts.push(`当前商品：${context.selectedItem.name}`);

  return parts.length > 0 ? `我会结合${parts.join('，')}来回答。` : null;
}

export function MallAssistantWelcome({ context, onAsk }: MallAssistantWelcomeProps) {
  const contextHint = buildContextHint(context);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <MallAssistantAvatar size="lg" expression="normal" />
      <h3 className="mt-5 text-xl font-black text-[#123a6e]">你好，我是水叮当</h3>
      <p className="mt-2 max-w-md text-sm leading-7 text-[#5a6d8a]">我可以帮你研判目录价格、生成预算建议、比较供应商报价。</p>
      {contextHint && (
        <p className="mt-3 max-w-lg rounded-full bg-[#eef6ff] px-4 py-2 text-xs font-semibold text-[#064ea2]">{contextHint}</p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {QUICK_QUESTIONS.map(question => (
          <button
            key={question}
            type="button"
            onClick={() => onAsk(question)}
            className="rounded-full border border-[#cdd9ea] bg-white px-4 py-2 text-sm font-bold text-[#064ea2] transition hover:border-[#064ea2] hover:bg-[#f3f8ff]"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run mall lint**

Run from `water-erp/`:

```bash
pnpm --filter mall lint
```

Expected: PASS.

- [ ] **Step 4: Commit welcome and message components**

```bash
git add water-erp/apps/mall/src/app/assistant/mall-assistant-message.tsx water-erp/apps/mall/src/app/assistant/mall-assistant-welcome.tsx
git commit -m "feat(mall): add assistant welcome and messages" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Add Assistant Dialog

**Files:**
- Create: `water-erp/apps/mall/src/app/assistant/mall-assistant-dialog.tsx`

- [ ] **Step 1: Create centered dialog with transient chat state**

Create `water-erp/apps/mall/src/app/assistant/mall-assistant-dialog.tsx` with:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MallAssistantAvatar } from './mall-assistant-avatar';
import { MallAssistantMessage } from './mall-assistant-message';
import { MallAssistantWelcome } from './mall-assistant-welcome';
import type { MallAssistantContext, MallAssistantMessage as Message } from './types';

interface MallAssistantDialogProps {
  open: boolean;
  context: MallAssistantContext;
  initialQuestion: string;
  onInitialQuestionConsumed: () => void;
  onClose: () => void;
}

const newMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function MallAssistantDialog({ open, context, initialQuestion, onInitialQuestionConsumed, onClose }: MallAssistantDialogProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastInitialQuestionRef = useRef('');

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [open, messages, loading]);

  const sendQuestion = useCallback(async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || loading) return;

    setError('');
    setInput('');
    setLoading(true);
    setMessages(prev => [...prev, { id: newMessageId(), role: 'user', content: question }]);

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, context }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'AI 服务暂时不可用，请稍后重试。');
      const answer = typeof data?.answer === 'string' ? data.answer : '';
      if (!answer.trim()) throw new Error('AI 未返回有效内容，请重试。');
      setMessages(prev => [...prev, { id: newMessageId(), role: 'assistant', content: answer }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI 服务暂时不可用，请稍后重试。';
      setError(message);
      setMessages(prev => [...prev, { id: newMessageId(), role: 'assistant', content: message }]);
      toast.error('水叮当调用失败');
    } finally {
      setLoading(false);
    }
  }, [context, loading]);

  useEffect(() => {
    if (!open) return;
    const question = initialQuestion.trim();
    if (!question || lastInitialQuestionRef.current === question) return;
    lastInitialQuestionRef.current = question;
    onInitialQuestionConsumed();
    void sendQuestion(question);
  }, [initialQuestion, onInitialQuestionConsumed, open, sendQuestion]);

  if (!open) return null;

  const hasMessages = messages.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#10213d]/45 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="水叮当">
      <div className="flex max-h-[calc(100vh-48px)] w-full max-w-[720px] flex-col overflow-hidden rounded-3xl bg-[#f7faff] shadow-[0_28px_80px_rgba(7,24,52,.28)] ring-1 ring-white/60 sm:h-[620px]">
        <div className="flex items-center justify-between border-b border-[#e1e9f4] bg-white px-5 py-4">
          <div className="flex items-center gap-3">
            <MallAssistantAvatar size="sm" expression={loading ? 'thinking' : 'normal'} />
            <div className="text-base font-black text-[#123a6e]">水叮当</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-[#8a96aa] transition hover:bg-[#f1f5fb] hover:text-[#123a6e]"
            aria-label="关闭水叮当"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {!hasMessages ? (
            <MallAssistantWelcome context={context} onAsk={sendQuestion} />
          ) : (
            <div className="space-y-4">
              {messages.map(message => <MallAssistantMessage key={message.id} message={message} />)}
              {loading && (
                <div className="flex items-center gap-3 text-sm font-semibold text-[#5a6d8a]">
                  <MallAssistantAvatar size="sm" expression="thinking" />
                  <span className="rounded-2xl border border-[#e1e9f4] bg-white px-4 py-3">水叮当思考中…</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {error && <div className="border-t border-red-100 bg-red-50 px-5 py-2 text-xs font-semibold text-red-700">{error}</div>}

        <form
          className="flex gap-3 border-t border-[#e1e9f4] bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void sendQuestion(input);
          }}
        >
          <textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendQuestion(input);
              }
            }}
            placeholder="继续问水叮当…"
            rows={1}
            className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-[#cdd9ea] bg-[#f8fbff] px-4 py-3 text-sm outline-none transition focus:border-[#064ea2] focus:bg-white"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="h-11 rounded-2xl bg-[#064ea2] px-5 text-sm font-black text-white transition hover:bg-[#043d82] disabled:cursor-not-allowed disabled:opacity-50"
          >
            发送
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run mall lint**

Run from `water-erp/`:

```bash
pnpm --filter mall lint
```

Expected: PASS. If ESLint flags `Math.random()` as acceptable, no change is needed. If it flags hook dependencies, update dependencies rather than disabling the rule.

- [ ] **Step 3: Commit dialog**

```bash
git add water-erp/apps/mall/src/app/assistant/mall-assistant-dialog.tsx
git commit -m "feat(mall): add Shui Ding Dang dialog" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Add Page Search Entry Component

**Files:**
- Create: `water-erp/apps/mall/src/app/assistant/mall-assistant-entry.tsx`

- [ ] **Step 1: Create the page-level search entry**

Create `water-erp/apps/mall/src/app/assistant/mall-assistant-entry.tsx` with:

```tsx
import { useMemo, useState } from 'react';
import { MallAssistantAvatar } from './mall-assistant-avatar';
import { MallAssistantDialog } from './mall-assistant-dialog';
import type { MallAssistantContext } from './types';

interface MallAssistantEntryProps {
  context: MallAssistantContext;
  initialQuestion?: string;
  onInitialQuestionConsumed?: () => void;
}

export function MallAssistantEntry({ context, initialQuestion = '', onInitialQuestionConsumed = () => {} }: MallAssistantEntryProps) {
  const [entryQuestion, setEntryQuestion] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitialQuestion, setDialogInitialQuestion] = useState('');

  const effectiveInitialQuestion = initialQuestion || dialogInitialQuestion;

  const contextLabel = useMemo(() => {
    const activeFilters = [
      context.currentFilters.category !== '全部' ? context.currentFilters.category : null,
      context.currentFilters.region !== '全部' ? context.currentFilters.region : null,
      context.currentFilters.status !== '全部' ? context.currentFilters.status : null,
      context.currentFilters.source !== '全部' ? context.currentFilters.source : null,
      context.currentFilters.search.trim() ? `关键词「${context.currentFilters.search.trim()}」` : null,
    ].filter(Boolean);

    if (activeFilters.length > 0) return activeFilters.join(' / ');
    if (context.budget.length > 0) return `预算清单 ${context.budget.length} 项`;
    return '可结合当前目录、筛选和预算清单回答';
  }, [context]);

  const openDialog = (question?: string) => {
    const trimmed = question?.trim() ?? '';
    setDialogInitialQuestion(trimmed);
    setDialogOpen(true);
    if (trimmed) setEntryQuestion('');
  };

  return (
    <section className="mt-5 rounded-2xl border border-[#bfd4f4] bg-gradient-to-br from-white to-[#f4f8ff] p-4 shadow-[0_12px_34px_rgba(6,78,162,.07)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <button type="button" onClick={() => openDialog()} className="flex shrink-0 items-center gap-3 text-left">
          <MallAssistantAvatar size="md" expression="normal" />
          <div>
            <h2 className="text-lg font-black text-[#123a6e]">水叮当 · 电子商城价格参谋</h2>
            <p className="mt-1 text-xs font-semibold text-[#6a7890]">{contextLabel}</p>
          </div>
        </button>

        <form
          className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            openDialog(entryQuestion);
          }}
        >
          <input
            value={entryQuestion}
            onChange={event => setEntryQuestion(event.target.value)}
            onFocus={() => {
              if (!entryQuestion.trim()) setDialogOpen(true);
            }}
            placeholder="问水叮当：分析当前筛选结果、找出需复核价格、生成预算清单建议"
            className="h-12 min-w-0 flex-1 rounded-xl border border-[#cdd9ea] bg-white px-4 text-sm outline-none transition placeholder:text-[#8a96aa] focus:border-[#064ea2] focus:shadow-[0_0_0_4px_rgba(6,78,162,.08)]"
          />
          <button type="submit" className="h-12 rounded-xl bg-[#064ea2] px-5 text-sm font-black text-white transition hover:bg-[#043d82]">
            问水叮当
          </button>
        </form>
      </div>

      <MallAssistantDialog
        open={dialogOpen}
        context={context}
        initialQuestion={effectiveInitialQuestion}
        onInitialQuestionConsumed={() => {
          setDialogInitialQuestion('');
          onInitialQuestionConsumed();
        }}
        onClose={() => setDialogOpen(false)}
      />
    </section>
  );
}
```

- [ ] **Step 2: Run mall lint**

Run from `water-erp/`:

```bash
pnpm --filter mall lint
```

Expected: PASS.

- [ ] **Step 3: Commit entry component**

```bash
git add water-erp/apps/mall/src/app/assistant/mall-assistant-entry.tsx
git commit -m "feat(mall): add Shui Ding Dang search entry" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Wire Assistant Into Mall Page

**Files:**
- Modify: `water-erp/apps/mall/src/app/page.tsx`

- [ ] **Step 1: Add imports**

In `water-erp/apps/mall/src/app/page.tsx`, add this import after `PriceChart`:

```ts
import { MallAssistantEntry } from './assistant/mall-assistant-entry';
import type { MallAssistantContext } from './assistant/types';
```

- [ ] **Step 2: Replace old AI state with initial-question state**

In `MallPage`, replace these old states:

```ts
  const [aiOpen, setAiOpen] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
```

with:

```ts
  const [assistantInitialQuestion, setAssistantInitialQuestion] = useState('');
```

- [ ] **Step 3: Replace old AI context variable with typed assistant context**

Keep the existing `aiRiskSummary` and `aiContextItems` calculations. After `aiContextItems`, add:

```ts
  const assistantContext: MallAssistantContext = useMemo(() => ({
    totalItems: items.length,
    currentFilters: { category, region, status, source, search },
    riskSummary: aiRiskSummary,
    visibleItems: aiContextItems,
    budget: lines.map(row => ({ code: row.code, name: row.name, qty: row.qty, unit: row.unit, referencePrice: row.referencePrice })),
    selectedItem: detail ? {
      id: detail.id,
      code: detail.code,
      name: detail.name,
      specification: detail.specification,
      category: detail.category,
      referencePrice: detail.referencePrice,
      unit: detail.unit,
      priceRange: `${detail.priceMin}-${detail.priceMax}`,
      averagePrice: detail.averagePrice,
      supplier: detail.supplier,
      supplierType: detail.supplierType,
      priceSource: detail.priceSource,
      region: detail.region,
      validUntil: detail.validUntil,
      status: detail.status,
      changeRate: detail.changeRate,
      minOrder: detail.minOrder,
      remark: detail.remark,
    } : null,
  }), [aiContextItems, aiRiskSummary, category, detail, items.length, lines, region, search, source, status]);
```

- [ ] **Step 4: Replace old AI send function with initial-question helper**

Remove the entire old `askAi` function:

```ts
  const askAi = async (message = aiQuestion) => {
    ...
  };
```

Replace it with:

```ts
  const openAssistantWithQuestion = (message: string) => {
    const question = message.trim();
    if (!question) return;
    setAssistantInitialQuestion(question);
  };
```

Keep `buildDetailPrompt` unchanged.

- [ ] **Step 5: Replace old top AI section with new entry**

Replace the old section that starts with:

```tsx
        <section className="mt-5 rounded-2xl border border-[#bfd4f4] bg-gradient-to-br from-white to-[#f4f8ff] p-5 shadow-[0_12px_34px_rgba(6,78,162,.07)]">
```

and contains the four statistic blocks `可参考 / 需询价 / 将过期 / 待复核` plus the `AI 分析` input, with:

```tsx
        <MallAssistantEntry
          context={assistantContext}
          initialQuestion={assistantInitialQuestion}
          onInitialQuestionConsumed={() => setAssistantInitialQuestion('')}
        />
```

This removes the meaningless visible `58 / 14 / 2 / 7` style stat blocks from the page.

- [ ] **Step 6: Replace detail-drawer AI buttons**

Search in `page.tsx` for calls to:

```ts
askAi(buildDetailPrompt(detail))
```

Replace each with:

```ts
openAssistantWithQuestion(buildDetailPrompt(detail))
```

Search for any remaining `askAi`, `aiOpen`, `aiQuestion`, `aiAnswer`, or `aiLoading` references. Remove obsolete JSX for the old AI answer modal if present. There should be no references left.

- [ ] **Step 7: Run mall lint**

Run from `water-erp/`:

```bash
pnpm --filter mall lint
```

Expected: PASS. If TypeScript complains about implicit `any`, add explicit types matching existing `CatalogItem` and `BudgetLine` interfaces.

- [ ] **Step 8: Commit page integration**

```bash
git add water-erp/apps/mall/src/app/page.tsx
git commit -m "feat(mall): replace price assistant strip with Shui Ding Dang" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Update Mall AI Prompt

**Files:**
- Modify: `water-erp/apps/mall/src/app/api/ai/route.ts`

- [ ] **Step 1: Replace the system prompt**

In `water-erp/apps/mall/src/app/api/ai/route.ts`, replace the existing `systemPrompt` array with:

```ts
  const systemPrompt = [
    '你是四川水发集团电子商城中的“水叮当”，负责集中采购目录的价格参谋能力。',
    '',
    '你的职责：',
    '- 帮助采购人员研判目录价格是否适合用于预算参考。',
    '- 帮助识别需要复核、询价或比价的条目。',
    '- 帮助基于目录数据生成预算清单建议。',
    '- 帮助比较供应商价格区间、价格来源、有效期和价格变化。',
    '- 帮助形成可用于内部沟通或审计说明的简洁口径。',
    '',
    '回答要求：',
    '- 必须使用中文。',
    '- 风格专业、简洁、可执行。',
    '- 结论先行，再说明依据和建议动作。',
    '- 优先基于传入的当前筛选条件、可见目录条目、预算清单和商品详情回答。',
    '- 数据不足时说明缺少什么，不要编造市场行情、供应商报价或审批结果。',
    '- 不替代审批，不决定最终采购价，不指定成交供应商。',
    '- 与电子商城无关的问题应简短说明超出当前模块范围，并引导用户回到目录价格、预算、询价或供应商比价场景。',
    '',
    '建议输出结构：',
    '结论：',
    '依据：',
    '建议动作：',
    '注意事项：',
  ].join('\n');
```

- [ ] **Step 2: Remove unused response text variable**

If `route.ts` still contains:

```ts
      const text = await response.text();
```

replace it with:

```ts
      await response.text();
```

This keeps the response body consumed without creating an unused variable.

- [ ] **Step 3: Run mall lint**

Run from `water-erp/`:

```bash
pnpm --filter mall lint
```

Expected: PASS.

- [ ] **Step 4: Commit prompt update**

```bash
git add water-erp/apps/mall/src/app/api/ai/route.ts
git commit -m "feat(mall): specialize Shui Ding Dang AI prompt" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Build and Manual Verification

**Files:**
- No source file changes expected unless verification finds a defect.

- [ ] **Step 1: Run mall lint**

Run from `water-erp/`:

```bash
pnpm --filter mall lint
```

Expected: PASS.

- [ ] **Step 2: Run mall build**

Run from `water-erp/`:

```bash
pnpm --filter mall build
```

Expected: PASS. If the build fails because shared packages are stale, run:

```bash
pnpm --filter @water-erp/shared build
pnpm --filter @water-erp/config build
pnpm --filter mall build
```

- [ ] **Step 3: Manual UI check in browser**

If the user already has dev servers running, use the existing mall at `http://localhost:3002`. Do not start background dev servers without user approval.

Verify:

1. The old top AI stats `可参考 / 需询价 / 将过期 / 待复核` are not visible.
2. A Shui Ding Dang search-bar style entry is visible in the page content.
3. The entry uses a real Shui Ding Dang avatar asset, not a water-drop emoji or placeholder.
4. Clicking the empty input opens a centered modal.
5. Modal header contains only avatar + `水叮当` + close button; it has no subtitle.
6. Welcome page says `你好，我是水叮当` and has no data-dashboard cards.
7. Welcome page quick questions are at most: `分析当前筛选结果`, `找出需复核价格`, `生成预算清单建议`.
8. Applying a filter or adding budget lines makes the welcome context hint appear.
9. Submitting `分析当前筛选结果` calls `/api/ai` and appends an assistant reply.
10. If `DEEPSEEK_API_KEY` is missing, the dialog shows `水叮当暂未启用，请联系管理员。` or the route's configured equivalent.

- [ ] **Step 4: Final git status check**

Run:

```bash
git status --short
```

Expected: no uncommitted changes. If verification fixes were required, commit them with:

```bash
git add water-erp/apps/mall/src/app water-erp/apps/mall/public/DingDang
git commit -m "fix(mall): polish Shui Ding Dang assistant" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review Notes

- Spec coverage: The plan removes visible stats, implements page search entry, centered dialog, no subtitle, minimal welcome page, context-aware hint, real Shui Ding Dang assets, custom prompt, transient messages, and existing `/api/ai` integration.
- Scope exclusions preserved: no floating UI, no persistent history, no SSE, no tool calls, no procurement backend assistant migration.
- Type consistency: `MallAssistantContext`, `MallAssistantMessage`, and `MallAssistantExpression` are defined in Task 2 and reused consistently in later tasks.
- Verification includes lint, build, and manual UI checks matching the spec.
