# 水叮当知识库（:3005）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** :3005 水叮当新增「知识库」按钮与管理面板，用户上传资料（仅自己/所有人两档可见），对话自动 RAG 检索注入并标注来源。

**Architecture:** 复用现有 Knowledge 模块（库 CRUD/上传/分块/pgvector 检索全套，零表改动）。新增 `AssistantRagService`（检索集=自己的∪共享，top-5 注入 + 降级），`chat()` 在系统提示与回答尾部注入；上传嵌入失败降级为存件不索引；前端新面板组件 + 头部按钮。

**Tech Stack:** NestJS 11 + Prisma + pgvector + vLLM bge-m3（EmbeddingService）；Next.js 16 + React 19 + cgzxui。

**Spec:** `docs/superpowers/specs/2026-11-03-assistant-knowledge-base-design.md`

## Global Constraints

- RAG 任何失败（无库/无命中/嵌入 503/检索异常）→ 静默降级普通回答，`chat()` **永不**因 RAG 抛错
- 检索集恒为 `{isActive: true, OR: [{ownerId: 当前用户}, {isShared: true}]}`——他人私有库绝不进入
- 维护权（建库/传/删/重建/删库）= 创建者 + admin（沿用 `assertEditable`）
- 文件类型 pdf/doc/docx/txt/md，≤50MB；`DocumentChunk.embedding` 可空（降级存件）
- 前端仅 :3005 chat-panel 全屏模式头部入口；mini 小窗不放；样式走 cgzxui（neu-table-card/neu-btn/workbench-input/wb-section-rule，禁内联样式新增）
- 每任务：先写失败测试→实现→过测→只 add 本任务文件提交（并行会话约定，禁 git add -A）
- 界面文案禁英文/黑话（格式名/标准编号除外）

---

### Task 1: 后端·上传嵌入失败降级（存件不索引）

**Files:**
- Modify: `apps/api/src/knowledge/knowledge.service.ts:135-145`（embed 失败分支）、`:181`（返回值）
- Test: `apps/api/src/knowledge/knowledge-upload-degrade.spec.ts`（新建）

**Interfaces:**
- Produces: `uploadFile` 返回值新增字段 `indexed: boolean`（true=已向量化；false=嵌入失败待 reindex）。Task 6 前端据此 toast。

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/knowledge/knowledge-upload-degrade.spec.ts
import { KnowledgeService } from './knowledge.service';

/** 2026-11-03 设计 §4.2：嵌入失败不再整体报错——文件/分块照存（向量列空），
 *  返回 indexed:false 提示重建索引；检索天然不命中无向量分块。 */
describe('KnowledgeService 上传嵌入失败降级', () => {
  const mkSvc = (embedReject: boolean) => {
    const prisma: any = {
      knowledgeFile: { create: jest.fn().mockResolvedValue({ id: 'kf-1', fileName: 'a.pdf' }) },
      knowledgeBase: { findUnique: jest.fn().mockResolvedValue({ id: 'kb-1', ownerId: 'u-1' }) },
    };
    const embedding: any = { embed: embedReject ? jest.fn().mockRejectedValue(new Error('503')) : jest.fn().mockResolvedValue([[0.1, 0.2]]) };
    const svc = new KnowledgeService(
      prisma,
      { upload: jest.fn().mockResolvedValue(undefined) } as any,   // storage
      { parse: jest.fn().mockResolvedValue('正文内容'.repeat(50)) } as any, // parser
      { split: jest.fn().mockReturnValue([{ content: '块一', startOffset: 0 }]) } as any, // splitter
      embedding,
      { insertChunks: jest.fn().mockResolvedValue(undefined), deleteByFileId: jest.fn(), deleteByCollection: jest.fn() } as any, // vectorSearch
    );
    return { svc, prisma, embedding };
  };
  const file: any = { originalname: '制度.pdf', mimetype: 'application/pdf', buffer: Buffer.from('x'), size: 10 };
  const user: any = { sub: 'u-1', role: 'leader' };

  it('嵌入失败 → 不抛错，文件照存，返回 indexed:false', async () => {
    const { svc, prisma } = mkSvc(true);
    const res = await svc.uploadFile('kb-1', file, user);
    expect(res.indexed).toBe(false);
    expect(prisma.knowledgeFile.create).toHaveBeenCalledTimes(1);
  });

  it('嵌入成功 → indexed:true', async () => {
    const { svc } = mkSvc(false);
    const res = await svc.uploadFile('kb-1', file, user);
    expect(res.indexed).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- knowledge-upload-degrade`
Expected: FAIL（嵌入失败用例抛「文本嵌入失败」）

- [ ] **Step 3: 实现**

`knowledge.service.ts` uploadFile 中（现 135-145 行）：

```ts
    let embeddings: number[][] = [];
    let indexed = true;
    if (textChunks.length > 0) {
      try {
        embeddings = await this.embedding.embed(
          textChunks.map((c) => c.content),
        );
      } catch (err) {
        // 2026-11-03 水叮当知识库设计 §4.2：嵌入服务不可用不再整体失败——
        // 文件与分块照存（embedding 列空），响应 indexed:false，恢复后走 reindex
        console.error('Embedding error (degraded):', err);
        embeddings = [];
        indexed = false;
      }
    }
```

chunks 映射处 `embedding: embeddings[i]` 保持（undefined 时 Prisma 落 NULL，向量列 nullable）。返回值改：

```ts
    return { ...kbFile, indexed };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter api test -- knowledge-upload-degrade`
Expected: PASS 2 例

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/knowledge/knowledge.service.ts apps/api/src/knowledge/knowledge-upload-degrade.spec.ts
git commit -m "feat(knowledge): 上传嵌入失败降级存件不索引——indexed:false 待重建（水叮当知识库 T1）"
```

---

### Task 2: 后端·assistant-overview 聚合端点

**Files:**
- Modify: `apps/api/src/knowledge/knowledge.service.ts`（文末加方法）
- Modify: `apps/api/src/knowledge/knowledge.controller.ts:40`（`@Get()` 之前插入——**必须在 `@Get(':id')` 之前声明**，Nest 按声明序匹配）
- Test: `apps/api/src/knowledge/knowledge-assistant-overview.spec.ts`（新建）

**Interfaces:**
- Produces: `GET /api/knowledge/assistant-overview` →
  `{ mine: AssistantKbCard[], shared: AssistantKbCard[] }`，
  `AssistantKbCard = { id: string; name: string; isShared: boolean; ownerId: string; ownerName: string; files: Array<{ id: string; fileName: string; fileSize: number; chunkCount: number; createdAt: Date }> }`
  （shared 组为他人共享库，ownerName=创建者姓名）。Task 5/6 前端消费。

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/knowledge/knowledge-assistant-overview.spec.ts
import { KnowledgeService } from './knowledge.service';

describe('KnowledgeService.assistantOverview（水叮当知识库面板取数）', () => {
  it('mine=本人库、shared=他人共享库；他人私有库与停用库不入两组', async () => {
    const mineKb = { id: 'kb-m', name: '我的库', isShared: false, ownerId: 'u-1', isActive: true,
      user: { displayName: '我' }, files: [] };
    const sharedKb = { id: 'kb-s', name: '同事共享', isShared: true, ownerId: 'u-2', isActive: true,
      user: { displayName: '同事' }, files: [] };
    const privateOther = { id: 'kb-x', name: '他人私有', isShared: false, ownerId: 'u-2', isActive: true };
    const inactive = { id: 'kb-i', name: '停用', isShared: true, ownerId: 'u-2', isActive: false };
    const findMany = jest.fn().mockImplementation(({ where }: any) =>
      Promise.resolve([mineKb, sharedKb, privateOther, inactive].filter(() => true).filter(kb =>
        where.isActive === kb.isActive && (where.OR.some((o: any) =>
          o.ownerId ? o.ownerId === kb.ownerId : o.isShared === kb.isShared)))));
    const svc: any = new KnowledgeService({ findMany } as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const r = await svc.assistantOverview({ sub: 'u-1', role: 'leader' });
    expect(r.mine.map((k: any) => k.id)).toEqual(['kb-m']);
    expect(r.shared.map((k: any) => k.id)).toEqual(['kb-s']);
    expect(r.shared[0].ownerName).toBe('同事');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- knowledge-assistant-overview`
Expected: FAIL（`svc.assistantOverview is not a function`）

- [ ] **Step 3: 实现**

`knowledge.service.ts` 文末：

```ts
  /** 水叮当知识库面板取数（2026-11-03 设计 §4.3）：mine=本人库，shared=他人共享库
   *  （他人私有库与停用库不入）。写操作仍走既有端点与 assertEditable 闸。 */
  async assistantOverview(user: User) {
    const rows = await this.prisma.knowledgeBase.findMany({
      where: { isActive: true, OR: [{ ownerId: user.sub }, { isShared: true }] },
      select: {
        id: true, name: true, isShared: true, ownerId: true,
        ownerName: true,
        files: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, fileName: true, fileSize: true, chunkCount: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // KnowledgeBase 无 ownerName 列——共享组创建者名经 owner 关系取（schema 有 user 关系则用；无则回落 ownerId）
    const named = await Promise.all(rows.map(async (r) => ({
      ...r,
      ownerName: r.ownerName ?? (r.ownerId === user.sub ? '我' : '其他成员'),
    })));
    return {
      mine: named.filter((r) => r.ownerId === user.sub),
      shared: named.filter((r) => r.ownerId !== user.sub),
    };
  }
```

> 注意：若 schema `KnowledgeBase` 无 `ownerName` 列，select 里删掉该行（TS 会报错提示），仅用回落逻辑即可——以编译结果为准删留。

`knowledge.controller.ts`，在 `@Get()` 与 `@Get(':id')` 之间插入：

```ts
  @Get('assistant-overview')
  @ApiOperation({ summary: '水叮当知识库面板取数（mine=本人库；shared=他人共享库）' })
  assistantOverview(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user?.sub) throw new ForbiddenException('请登录后使用知识库');
    return this.knowledge.assistantOverview(user);
  }
```

（文件顶部补 `ForbiddenException` import；RolesGuard 全局默认拒绝——该控制器现有路由未标 @Roles 也可用，说明控制器层有任一标注，跟随现状即可，实施时以 `npx tsx scripts/list-uncovered-routes.ts` 验证零未覆盖。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter api test -- knowledge-assistant-overview`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/knowledge/knowledge.service.ts apps/api/src/knowledge/knowledge.controller.ts apps/api/src/knowledge/knowledge-assistant-overview.spec.ts
git commit -m "feat(knowledge): assistant-overview 聚合端点——mine/shared 分组供水叮当知识库面板（T2）"
```

---

### Task 3: 后端·AssistantRagService 检索服务（降级铁律）

**Files:**
- Create: `apps/api/src/assistant/knowledge/rag-retrieval.service.ts`（`assistant/knowledge/` 目录已存在，内含 system-knowledge.ts）
- Modify: `apps/api/src/assistant/assistant.module.ts:22`（imports 加 `KnowledgeModule`；providers 加新服务）
- Test: `apps/api/src/assistant/knowledge/rag-retrieval.service.spec.ts`（新建）

**Interfaces:**
- Consumes: `VectorSearchService.search(query: string, collectionName: string, topK?: number): Promise<ChunkSearchResult[]>`（`ChunkSearchResult = {id; content; metadata: {fileName?: string}; fileId; score}`，KnowledgeModule 已 export）；`EmbeddingService.embed(texts: string[]): Promise<number[][]>`（LocalAiModule 全局）
- Produces: `AssistantRagService.buildContext(question: string, user: {sub: string; role: string}): Promise<{ block: string; fileNames: string[] } | null>`——null=无库/无命中/任何异常（降级）。Task 4 的 chat() 消费。

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/assistant/knowledge/rag-retrieval.service.spec.ts
import { AssistantRagService } from './rag-retrieval.service';

describe('AssistantRagService（水叮当 RAG 检索，2026-11-03 设计 §4.1）', () => {
  const mk = (opts: {
    kbs?: any[]; searchHits?: any[]; embedReject?: boolean; searchReject?: boolean;
  }) => {
    const prisma: any = {
      knowledgeBase: { findMany: jest.fn().mockResolvedValue(opts.kbs ?? []) },
    };
    const embedding: any = { embed: opts.embedReject ? jest.fn().mockRejectedValue(new Error('503')) : jest.fn().mockResolvedValue([[0.1]]) };
    const vectorSearch: any = {
      search: opts.searchReject
        ? jest.fn().mockRejectedValue(new Error('vector down'))
        : jest.fn().mockResolvedValue(opts.searchHits ?? []),
    };
    return { svc: new AssistantRagService(prisma, embedding, vectorSearch), prisma, vectorSearch };
  };
  const me = { sub: 'u-1', role: 'leader' };

  it('检索集只含 自己∪共享（isActive）——where 断言，他人私有库不进', async () => {
    const { svc, prisma } = mk({ kbs: [{ id: 'kb-1' }] });
    await svc.buildContext('问句', me);
    expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, OR: [{ ownerId: 'u-1' }, { isShared: true }] },
    }));
  });

  it('命中 → block 含片段与来源文件名，fileNames 去重；跨库合并按 score 取 top5', async () => {
    const hits = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`, content: `片段${i}`, fileId: `f${i % 2}`,
      metadata: { fileName: i % 2 === 0 ? '制度.pdf' : '流程.docx' }, score: 1 - i * 0.1,
    }));
    const { svc } = mk({ kbs: [{ id: 'kb-1' }, { id: 'kb-2' }], searchHits: hits });
    const r = await svc.buildContext('问句', me);
    expect(r).not.toBeNull();
    expect(r!.block).toContain('【用户知识库资料');
    expect(r!.block).toContain('片段0');
    expect(r!.block).not.toContain('片段6'); // top5 截断
    expect(r!.fileNames.sort()).toEqual(['制度.pdf', '流程.docx']);
  });

  it('无库 / 无命中 → null', async () => {
    expect(await mk({}).svc.buildContext('问句', me)).toBeNull();
    expect(await mk({ kbs: [{ id: 'kb-1' }] }).svc.buildContext('问句', me)).toBeNull();
  });

  it('降级铁律：嵌入 503 / 检索异常 → 返回 null 绝不抛', async () => {
    expect(await mk({ kbs: [{ id: 'kb-1' }], embedReject: true }).svc.buildContext('问句', me)).toBeNull();
    expect(await mk({ kbs: [{ id: 'kb-1' }], searchReject: true }).svc.buildContext('问句', me)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- rag-retrieval`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// apps/api/src/assistant/knowledge/rag-retrieval.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from '../../local-ai/embedding.service';
import { VectorSearchService } from '../../knowledge/services/vector-search.service';

const TOP_K = 5;

/** 水叮当对话 RAG 检索（2026-11-03 设计 §4.1）：检索集=自己的∪共享（isActive）库，
 *  跨库合并按相似度取 top5 片段。降级铁律：无库/无命中/嵌入或检索任何异常 → null
 *  （调用方静默走普通流程，对话永不因 RAG 失败而报错）。 */
@Injectable()
export class AssistantRagService {
  private readonly logger = new Logger(AssistantRagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly vectorSearch: VectorSearchService,
  ) {}

  async buildContext(
    question: string,
    user: { sub: string; role: string },
  ): Promise<{ block: string; fileNames: string[] } | null> {
    try {
      const bases = await this.prisma.knowledgeBase.findMany({
        where: { isActive: true, OR: [{ ownerId: user.sub }, { isShared: true }] },
        select: { id: true, name: true },
      });
      if (bases.length === 0) return null;

      await this.embedding.embed([question]); // 探活+预热（search 内部会再嵌入查询词）
      const perBase = await Promise.all(
        bases.map((b) => this.vectorSearch.search(question, b.id, TOP_K).catch(() => [])),
      );
      const hits = perBase
        .flat()
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_K);
      if (hits.length === 0) return null;

      const fileNames = [...new Set(hits.map((h) => String(h.metadata?.fileName ?? '未命名文件')))];
      const lines = hits.map(
        (h) => `【${String(h.metadata?.fileName ?? '未命名文件')}】${h.content}`,
      );
      const block =
        `【用户知识库资料——回答时优先参考以下片段，引用时注明来源文件】\n` +
        lines.join('\n');
      return { block, fileNames };
    } catch (e) {
      this.logger.warn(`RAG 检索降级（按普通流程回答）: ${(e as Error).message}`);
      return null;
    }
  }
}
```

`assistant.module.ts`：imports 数组加 `KnowledgeModule`（顶部 import），providers 加 `AssistantRagService`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter api test -- rag-retrieval`
Expected: PASS 4 例；随后 `cd apps/api && npx tsc --noEmit` 干净

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/assistant/knowledge/rag-retrieval.service.ts apps/api/src/assistant/knowledge/rag-retrieval.service.spec.ts apps/api/src/assistant/assistant.module.ts
git commit -m "feat(assistant): AssistantRagService 对话 RAG 检索——own∪shared top5 + 降级铁律（水叮当知识库 T3）"
```

---

### Task 4: 后端·chat() 注入与来源标注

**Files:**
- Modify: `apps/api/src/assistant/assistant.service.ts:84-98`（构造器加 rag）、`:125` chat() 内两处
- Modify: `apps/api/src/assistant/assistant.service.spec.ts`（harness providers 加一行 + 新 describe）
- Test: 同上 spec 文件

**Interfaces:**
- Consumes: Task 3 的 `AssistantRagService.buildContext(question, user)`（返回 `{block, fileNames} | null`）
- Produces: 无新接口——行为：系统提示含 RAG block；回答尾部「（参考知识库：A、B）」（仅命中时）

- [ ] **Step 1: harness 补 mock + 写失败测试**

`assistant.service.spec.ts` 的 TestingModule providers 数组（`ActionExecutorService` 行后）加：

```ts
        { provide: AssistantRagService, useValue: { buildContext: jest.fn().mockResolvedValue(null) } },
```

（顶部 import 补 `AssistantRagService`。）在 `describe('chat', ...)` 内追加用例：

```ts
    it('RAG 命中 → 系统提示注入知识片段，回答尾部标注来源文件', async () => {
      const rag = module.get(AssistantRagService) as any;
      rag.buildContext.mockResolvedValue({
        block: '【用户知识库资料——回答时优先参考以下片段，引用时注明来源文件】\n【制度.pdf】报销标准…',
        fileNames: ['制度.pdf'],
      });
      prisma.assistantConversation.create.mockResolvedValue({ ...mockConversation, messages: [] });
      prisma.assistantMessage.create.mockResolvedValue({ id: 'msg-1' });
      prisma.user.findUnique.mockResolvedValue({ companyId: 'co-1' });

      const result = await service.chat(
        { message: '报销标准是什么' },
        { userId: 'u-1', role: 'leader' },
      );

      expect(rag.buildContext).toHaveBeenCalledWith('报销标准是什么', { sub: 'u-1', role: 'leader', companyId: 'co-1', companyIds: undefined });
      expect(model.chat).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: expect.stringContaining('【用户知识库资料') }),
      ]));
      expect(result.answer).toContain('（参考知识库：制度.pdf）');
    });

    it('RAG 降级（null）→ 系统提示无知识片段，回答无标注', async () => {
      prisma.assistantConversation.create.mockResolvedValue({ ...mockConversation, messages: [] });
      prisma.assistantMessage.create.mockResolvedValue({ id: 'msg-1' });
      prisma.user.findUnique.mockResolvedValue({ companyId: 'co-1' });

      const result = await service.chat({ message: '你好' }, { userId: 'u-1', role: 'leader' });
      expect(result.answer).not.toContain('参考知识库');
    });
```

> `module` 变量：harness 的 `beforeEach` 里 `const module = await Test.createTestingModule...` 是局部量——需提升为外层 `let moduleRef`（在 beforeEach 赋值）供用例 `moduleRef.get(AssistantRagService)`。实施时把 `const module` 改 `moduleRef =`（外层声明 `let moduleRef: TestingModule;`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- assistant.service.spec`
Expected: FAIL（构造器缺 rag 参数/注入不存在）

- [ ] **Step 3: 实现**

`assistant.service.ts`：

1. import 区补 `AssistantRagService`；
2. 构造器（96-97 行 actionPlanner/actionExecutor 之后）加：
   ```ts
   private readonly rag: AssistantRagService,
   ```
3. `chat()` 中 `const toolCtx = await resolveToolCtx(...)`（约 157 行）之后、`fullSystemPrompt` 组装（约 196 行）之前插入：
   ```ts
   // RAG 注入（2026-11-03 设计 §4.1）：登录用户从「自己的∪共享」知识库检索 top5；
   // 降级铁律——null/异常一律按普通流程，对话永不因 RAG 失败报错
   let ragContext: { block: string; fileNames: string[] } | null = null;
   if (toolCtx.user) {
     ragContext = await this.rag.buildContext(dto.message, toolCtx.user).catch(() => null);
   }
   ```
4. `messages` 组装处 system 内容改为：
   ```ts
   const messages = [
     { role: 'system' as const, content: fullSystemPrompt + (ragContext ? `\n\n${ragContext.block}` : '') },
     ...history,
     { role: 'user' as const, content: dto.message },
   ];
   ```
5. `chat()` 组装返回值之前（answer 已终定，try/catch 之后）：
   ```ts
   if (ragContext && ragContext.fileNames.length && answer) {
     answer += `\n\n（参考知识库：${ragContext.fileNames.join('、')}）`;
   }
   ```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter api test -- assistant.service.spec`
Expected: 全部 PASS（含既有用例）

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/assistant/assistant.service.ts apps/api/src/assistant/assistant.service.spec.ts
git commit -m "feat(assistant): chat 接入 RAG——系统提示注入知识片段 + 回答尾注来源（水叮当知识库 T4）"
```

---

### Task 5: 前端·知识库 API client

**Files:**
- Create: `apps/web/src/lib/api/knowledge.ts`

**Interfaces:**
- Consumes: Task 1/2 的后端端点（`/knowledge`、`/knowledge/assistant-overview`、`:id/files`、`:id/reindex`、`:id/files/:fileId`）
- Produces（Task 6 消费，全部经 `apiFetch`，X-Portal: web）:
  - `fetchAssistantKnowledge(): Promise<{mine: KbCard[]; shared: KbCard[]}>`
  - `createKnowledgeBase({name, isShared}): Promise<KbCard>`
  - `uploadKnowledgeFile(kbId, file): Promise<{id; indexed: boolean}>`
  - `deleteKnowledgeFile(kbId, fileId): Promise<void>`
  - `reindexKnowledgeBase(kbId): Promise<{reindexed: boolean}>`
  - `deleteKnowledgeBase(kbId): Promise<void>`
  - type `KbCard = { id: string; name: string; isShared: boolean; ownerId: string; ownerName: string; files: KbFile[] }`；`KbFile = { id: string; fileName: string; fileSize: number; chunkCount: number; createdAt: string }`

- [ ] **Step 1: 实现（薄封装无单测，Task 6 使用验证）**

```ts
// apps/web/src/lib/api/knowledge.ts
import { apiFetch } from './api-fetch';
import { toApiError } from '@water-erp/client';

/** 水叮当知识库客户端（2026-11-03）：面板取数/建库/上传/删件/重建/删库 */
export type KbFile = { id: string; fileName: string; fileSize: number; chunkCount: number; createdAt: string };
export type KbCard = { id: string; name: string; isShared: boolean; ownerId: string; ownerName: string; files: KbFile[] };

const API = '/api/knowledge';

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) throw await toApiError(res, fallback);
  return res.json() as Promise<T>;
}

export function fetchAssistantKnowledge() {
  return apiFetch(`${API}/assistant-overview`, { headers: { 'X-Portal': 'web' }, credentials: 'include' })
    .then((r) => jsonOrThrow<{ mine: KbCard[]; shared: KbCard[] }>(r, '知识库加载失败'));
}

export function createKnowledgeBase(data: { name: string; isShared: boolean; description?: string }) {
  return apiFetch(API, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' }, credentials: 'include',
    body: JSON.stringify(data),
  }).then((r) => jsonOrThrow<KbCard>(r, '创建知识库失败'));
}

export async function uploadKnowledgeFile(kbId: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await apiFetch(`${API}/${kbId}/files`, {
    method: 'POST', headers: { 'X-Portal': 'web' }, credentials: 'include', body: fd,
  });
  return jsonOrThrow<{ id: string; indexed: boolean }>(res, '上传失败');
}

export async function deleteKnowledgeFile(kbId: string, fileId: string) {
  const res = await apiFetch(`${API}/${kbId}/files/${fileId}`, {
    method: 'DELETE', headers: { 'X-Portal': 'web' }, credentials: 'include',
  });
  if (!res.ok) throw await toApiError(res, '删除文件失败');
}

export function reindexKnowledgeBase(kbId: string) {
  return apiFetch(`${API}/${kbId}/reindex`, {
    method: 'POST', headers: { 'X-Portal': 'web' }, credentials: 'include',
  }).then((r) => jsonOrThrow<{ reindexed: boolean }>(r, '重建索引失败'));
}

export async function deleteKnowledgeBase(kbId: string) {
  const res = await apiFetch(`${API}/${kbId}`, {
    method: 'DELETE', headers: { 'X-Portal': 'web' }, credentials: 'include',
  });
  if (!res.ok) throw await toApiError(res, '删除知识库失败');
}
```

- [ ] **Step 2: 类型检查**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 干净

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/lib/api/knowledge.ts
git commit -m "feat(web): 水叮当知识库 API client（assistant-overview/建库/上传/删件/重建/删库）（T5）"
```

---

### Task 6: 前端·知识库面板组件 + chat-panel 头部按钮

**Files:**
- Create: `apps/web/src/components/assistant/knowledge-panel.tsx`
- Modify: `apps/web/src/components/assistant/chat-panel.tsx:158-176`（头部按钮组）、import 区、组件 state

**Interfaces:**
- Consumes: Task 5 全部 client 函数；cgzxui Modal（`@/components/workbench` 的 Modal，参照 `components/projects/abort-restart-dialog.tsx` 的 Modal 用法：`<Modal open onClose size="md">`）
- Produces: `<KnowledgePanel open={kbOpen} onClose={() => setKbOpen(false)} />`；chat-panel 头部「知识库」按钮（BookOpen 图标，`asst-page-header-btn` 类）

- [ ] **Step 1: 实现面板组件**

```tsx
// apps/web/src/components/assistant/knowledge-panel.tsx
'use client';

/** 水叮当知识库管理面板（2026-11-03）：我的知识库（可维护）与共享知识库（只读检索）
 *  两组；建库（名称+可见性 仅自己/所有人）；上传 pdf/doc/docx/txt/md ≤50MB；
 *  上传返回 indexed:false 时提示嵌入服务未运行、可重建索引。 */
import { useEffect, useRef, useState } from 'react';
import { BookOpen, FileUp, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/workbench';
import {
  createKnowledgeBase, deleteKnowledgeBase, deleteKnowledgeFile,
  fetchAssistantKnowledge, reindexKnowledgeBase, uploadKnowledgeFile,
  type KbCard,
} from '@/lib/api/knowledge';

const MAX_SIZE = 50 * 1024 * 1024;
const ACCEPT = '.pdf,.doc,.docx,.txt,.md';

export function KnowledgePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [mine, setMine] = useState<KbCard[]>([]);
  const [shared, setShared] = useState<KbCard[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newShared, setNewShared] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadKbRef = useRef<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetchAssistantKnowledge();
      setMine(r.mine); setShared(r.shared);
    } catch (e) { toast.error(e instanceof Error ? e.message : '知识库加载失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (open) void load(); }, [open]);

  const handleCreate = async () => {
    if (!newName.trim()) { toast.error('请填写知识库名称'); return; }
    setCreating(true);
    try {
      await createKnowledgeBase({ name: newName.trim(), isShared: newShared });
      toast.success('知识库已创建，可上传资料');
      setNewName(''); setNewShared(false);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : '创建失败'); }
    finally { setCreating(false); }
  };

  const handleUpload = async (kbId: string, file: File) => {
    if (file.size > MAX_SIZE) { toast.error('文件超过 50MB 上限'); return; }
    setBusyId(kbId);
    try {
      const r = await uploadKnowledgeFile(kbId, file);
      if (r.indexed === false) {
        toast.warning(`《${file.name}》已保存；嵌入服务未运行，恢复后请点「重建索引」`);
      } else {
        toast.success(`《${file.name}》已上传并完成索引`);
      }
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : '上传失败'); }
    finally { setBusyId(null); }
  };

  const renderCard = (kb: KbCard, editable: boolean) => (
    <div key={kb.id} className="neu-table-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen size={15} className="text-[var(--accent)] shrink-0" />
          <span className="text-sm font-bold text-[color:var(--foreground)] truncate">{kb.name}</span>
          <span className="neu-tab-count shrink-0">{kb.isShared ? '所有人可用' : '仅自己'}</span>
          {!editable && <span className="text-[10px] text-[var(--muted-foreground)] shrink-0">来自 {kb.ownerName} · 只读</span>}
        </div>
        {editable && (
          <div className="flex items-center gap-1.5">
            <button type="button" className="neu-btn-xs gap-1"
              onClick={() => { uploadKbRef.current = kb.id; fileInputRef.current?.click(); }}
              disabled={busyId === kb.id}>
              {busyId === kb.id ? <Loader2 size={13} className="animate-spin" /> : <FileUp size={13} />}上传
            </button>
            <button type="button" className="neu-btn-xs gap-1" title="嵌入服务恢复后补建向量索引"
              onClick={async () => { setBusyId(kb.id); try { await reindexKnowledgeBase(kb.id); toast.success('索引已重建'); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : '重建失败'); } finally { setBusyId(null); } }}>
              <RefreshCw size={13} />重建索引
            </button>
            <button type="button" className="neu-btn-xs is-danger gap-1"
              onClick={async () => {
                if (!window.confirm(`确认删除知识库「${kb.name}」及其全部文件？`)) return;
                setBusyId(kb.id);
                try { await deleteKnowledgeBase(kb.id); toast.success('已删除'); await load(); }
                catch (e) { toast.error(e instanceof Error ? e.message : '删除失败'); }
                finally { setBusyId(null); }
              }}>
              <Trash2 size={13} />删除
            </button>
          </div>
        )}
      </div>
      {kb.files.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">暂无文件{editable ? '，点「上传」添加资料' : ''}</p>
      ) : (
        <div className="space-y-1.5">
          {kb.files.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-xs"
              style={{ background: 'color-mix(in oklch, var(--surface) 65%, transparent)' }}>
              <span className="min-w-0 flex-1 truncate font-medium text-[color:var(--foreground)]">{f.fileName}</span>
              <span className="tabular-nums text-[var(--muted-foreground)]">{(f.fileSize / 1024).toFixed(0)}KB · {f.chunkCount} 块</span>
              {editable && (
                <button type="button" className="neu-btn-xs is-danger" title="删除文件"
                  onClick={async () => {
                    if (!window.confirm(`确认删除《${f.fileName}》？`)) return;
                    setBusyId(kb.id);
                    try { await deleteKnowledgeFile(kb.id, f.id); toast.success('已删除'); await load(); }
                    catch (e) { toast.error(e instanceof Error ? e.message : '删除失败'); }
                    finally { setBusyId(null); }
                  }}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} size="md">
      <input ref={fileInputRef} type="file" accept={ACCEPT} className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && uploadKbRef.current) void handleUpload(uploadKbRef.current, f);
        }} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-[color:var(--foreground)]">知识库</h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">上传自己的资料，水叮当回答时自动检索引用；「所有人可用」的库全体用户可检索</p>
        </div>
      </div>

      {/* 新建 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          placeholder="新知识库名称（如：财务制度）" className="workbench-input flex-1 min-w-[200px] text-sm" />
        <select value={newShared ? 'shared' : 'private'} onChange={(e) => setNewShared(e.target.value === 'shared')}
          className="workbench-input w-[130px] text-sm">
          <option value="private">仅自己</option>
          <option value="shared">所有人</option>
        </select>
        <button type="button" className="neu-btn-soft gap-1" disabled={creating} onClick={() => void handleCreate()}>
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}新建
        </button>
      </div>

      <div className="wb-section-rule" />

      {loading ? (
        <div className="py-10 text-center text-sm text-[var(--muted-foreground)]"><Loader2 size={16} className="inline animate-spin mr-2" />加载中…</div>
      ) : (
        <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">我的知识库（{mine.length}）</p>
            <div className="space-y-3">{mine.map((kb) => renderCard(kb, true))}</div>
            {mine.length === 0 && <p className="text-xs text-[var(--muted-foreground)]">还没有知识库，先新建一个再上传资料</p>}
          </div>
          {shared.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">共享知识库（{shared.length}）</p>
              <div className="space-y-3">{shared.map((kb) => renderCard(kb, false))}</div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: chat-panel 头部按钮接入**

`chat-panel.tsx`：import 区补 `BookOpen`（lucide-react 现有 import 行追加）与 `import { KnowledgePanel } from './knowledge-panel';`；组件 state 区加 `const [kbOpen, setKbOpen] = useState(false);`（跟随现有 useState 风格）。头部按钮组（「新对话」按钮之前）插入：

```tsx
          <button onClick={() => setKbOpen(true)} title="知识库" className="asst-page-header-btn">
            <BookOpen size={15} strokeWidth={1.5} />
          </button>
```

组件 JSX 末尾（与 mini 面板同级）加：

```tsx
      <KnowledgePanel open={kbOpen} onClose={() => setKbOpen(false)} />
```

- [ ] **Step 3: 类型检查 + lint**

Run: `cd apps/web && npx tsc --noEmit && npx eslint src/components/assistant/knowledge-panel.tsx src/components/assistant/chat-panel.tsx src/lib/api/knowledge.ts`
Expected: 0 error

- [ ] **Step 4: 手工冒烟（dev 已跑）**

浏览器 :3005 → 水叮当面板 → 右上角「知识库」→ 新建库（仅自己）→ 上传一个 .md/.txt → vLLM 未启动时应提示「已保存；嵌入服务未运行…」→ 新对话提问相关内容 → 回答正常（降级）；启动 vLLM 后点重建索引 → 再问 → 回答尾注「（参考知识库：××）」。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/assistant/knowledge-panel.tsx apps/web/src/components/assistant/chat-panel.tsx
git commit -m "feat(web): 水叮当知识库面板 + 头部入口——上传/可见性/重建索引/共享只读（T6）"
```

---

## 验收清单（对照 spec §7）

- [ ] 有库命中 → 上下文含片段、回答尾注来源；他人私有库不进检索集（Task 3 测试）
- [ ] 嵌入抛错 → 降级不阻塞（Task 3/4 测试）
- [ ] 上传嵌入失败 → indexed:false + 提示重建（Task 1/6）
- [ ] overview 分组正确（Task 2 测试）
- [ ] 前端 tsc/lint 干净（Task 5/6）
- [ ] 手工验收路径跑通（Task 6 Step 4，需 vLLM 启动配合）
