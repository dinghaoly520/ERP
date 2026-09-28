# pgvector Sidecar 改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 向量检索（DocumentChunk/pgvector）外置为可选 sidecar PG，使金仓（V8R6/V9，PG 模式）作为主库时 tender-review RAG 功能完整保留；dev/CI 纯 PG 环境零变化。

**Architecture:** `VectorSearchService`（唯一向量流量入口，5 个方法）的执行器从 PrismaService 换为新的 `VectorDbService`（pg Pool，连接串回退链 `VECTOR_DATABASE_URL → DIRECT_URL → DATABASE_URL`）；`VectorInitService` 在目标库上做幂等 DDL bootstrap（扩展+表+双索引），sidecar 库无需迁移文件。金仓主库上那条 pgvector 迁移（20260727020000）不改文件，由部署脚本 `migrate resolve --applied` 跳过。两个 reviewer 加软兜底：向量检索不可用时退化为「无 RAG 上下文」继续 LLM 审查，不红失败。

**Tech Stack:** NestJS 11 + node-postgres(`pg`, 新增依赖, CJS) + pgvector/pgvector:pg16 + docker compose profiles

**Spec:** 本计划自带评估结论（2026-09-28 会话定稿，用户拍板：D1-选项1 部署脚本跳过 / D2 DocumentChunk 模型保留 / D3 reviewer 软兜底要打）

## Global Constraints

- tsconfig **无 esModuleInterop**（仅 allowSyntheticDefaultImports）：`pg` 是命名空间导出包，用 `import { Pool } from 'pg'`；**禁止** default import
- `pg` 为 CJS 包，**不**加入 jest 两份 ESM allowlist
- **不修改** `prisma/schema.prisma`（D2）与任何已应用迁移文件（D1）——金仓差异全部由部署脚本处理
- 测试命令在 `water-erp/` 下执行：`pnpm --filter api test -- <pattern>`；lint：`pnpm --filter api lint`
- 提交信息末尾带：`Co-Authored-By: Claude Code <noreply@anthropic.com>`；只 add 明确改动文件，**禁用** `git add -A`
- 本地验证资产：金仓容器 `kingbase-v8r6-test` @ 宿主 54323（system/kdb123456，库 water_erp，已含 190 迁移+seed）；dev 主 PG `water-erp-postgres` @ 5432（pgvector:pg16）；sidecar 预定宿主端口 **5434**
- `CLAUDE.md` 的修改必须走 Bash（ARS 守卫拦 Edit/Write）

## Review Focus（实现时必须逐条有测试/验证钉住）

1. **pg 池误连 pgbouncer**：`DATABASE_URL` 带 `?pgbouncer=true` 走 transaction 池会砸扩展协议——回退链必须优先 `DIRECT_URL`（Task 1 测试锁定顺序）
2. **连接串泄漏密码**：日志只允许出现 `host:port/db` 脱敏形态（Task 1 测试 describeTarget）
3. **向量写入误落主库**：金仓环境漏设 `VECTOR_DATABASE_URL` 时，写侧（insertChunks）会报 DocumentChunk 不存在——读侧由 Task 3 软兜底吃掉；写侧现状已有 try/catch 静默续传（knowledge.service.ts:177），Task 5 金仓端到端验证隔离性
4. **node-postgres 返回形态**：jsonb 自动对象化、`COUNT(*)::int` 才是 number——Task 2 保持既有 SQL 的 `::int` 与 jsonb 直读；Task 5 端到端核对 upload→count
5. **双形态回归**：CI e2e 与 dev PG（不设新变量）必须与现状行为一致——Task 5 dev-PG 冒烟 + 全量单测

---

### Task 1: VectorDbService（pg Pool 封装 + 回退链）

**Files:**
- Create: `apps/api/src/knowledge/services/vector-db.service.ts`
- Test: `apps/api/src/knowledge/services/vector-db.service.spec.ts`
- Modify: `apps/api/package.json`（加 `pg` + `@types/pg` devDep）、`apps/api/src/knowledge/knowledge.module.ts`（providers 加 VectorDbService）

**Interfaces:**
- Produces: `class VectorDbService { readonly connectionString: string; readonly sourceLabel: string; getPool(): Pool; describeTarget(): string }`（后续 Task 2/VectorInitService 消费）

- [ ] **Step 1: 安装依赖**

```bash
cd /home/asus/桌面/ERP/water-erp && pnpm --filter api add pg && pnpm --filter api add -D @types/pg
```

- [ ] **Step 2: 写失败测试**（`vector-db.service.spec.ts`）

```typescript
import { ConfigService } from '@nestjs/config';
import { VectorDbService } from './vector-db.service';

describe('VectorDbService 连接串回退链', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  function make() {
    return new VectorDbService(new ConfigService());
  }

  it('VECTOR_DATABASE_URL 显式设置时最优先（sidecar 形态）', () => {
    process.env.VECTOR_DATABASE_URL = 'postgresql://u:p@vdb:5432/water_erp';
    process.env.DIRECT_URL = 'postgresql://u:p@pg:5432/water_erp';
    process.env.DATABASE_URL = 'postgresql://u:p@pg:6432/water_erp';
    const svc = make();
    expect(svc.connectionString).toBe('postgresql://u:p@vdb:5432/water_erp');
    expect(svc.sourceLabel).toContain('VECTOR_DATABASE_URL');
  });

  it('未设 VECTOR_DATABASE_URL 时回退 DIRECT_URL（绕开 pgbouncer——扩展协议与 transaction 池不兼容）', () => {
    delete process.env.VECTOR_DATABASE_URL;
    process.env.DIRECT_URL = 'postgresql://u:p@pg:5432/water_erp';
    process.env.DATABASE_URL = 'postgresql://u:p@pg:6432/water_erp?pgbouncer=true';
    const svc = make();
    expect(svc.connectionString).toBe('postgresql://u:p@pg:5432/water_erp');
    expect(svc.sourceLabel).toContain('DIRECT_URL');
  });

  it('DIRECT_URL 也缺失时回退 DATABASE_URL', () => {
    delete process.env.VECTOR_DATABASE_URL;
    delete process.env.DIRECT_URL;
    process.env.DATABASE_URL = 'postgresql://u:p@pg:6432/water_erp';
    const svc = make();
    expect(svc.connectionString).toBe('postgresql://u:p@pg:6432/water_erp');
    expect(svc.sourceLabel).toContain('DATABASE_URL');
  });

  it('describeTarget 只输出 host:port/db，不泄漏密码', () => {
    process.env.DIRECT_URL = 'postgresql://secretuser:secretpw@pg.internal:5432/water_erp?ssl=true';
    const svc = make();
    const t = svc.describeTarget();
    expect(t).toBe('pg.internal:5432/water_erp');
    expect(t).not.toContain('secret');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter api test -- vector-db
```
预期：FAIL（Cannot find module './vector-db.service'）

- [ ] **Step 4: 最小实现**（`vector-db.service.ts`）

```typescript
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

/**
 * 向量检索专用 pg 连接池。
 * 目标库选择（回退链）：
 *   1. VECTOR_DATABASE_URL —— sidecar 形态（金仓主库 + pgvector sidecar）
 *   2. DIRECT_URL          —— 纯 PG 形态直连主库（绕开 pgbouncer：
 *                             node-postgres 参数化查询走扩展协议，与 transaction 池不兼容）
 *   3. DATABASE_URL        —— 最后兜底
 */
@Injectable()
export class VectorDbService implements OnModuleDestroy {
  private readonly logger = new Logger(VectorDbService.name);
  private pool: Pool | null = null;

  readonly connectionString: string;
  readonly sourceLabel: string;

  constructor(config: ConfigService) {
    const explicit = config.get<string>('VECTOR_DATABASE_URL');
    const direct = config.get<string>('DIRECT_URL');
    const primary = config.get<string>('DATABASE_URL');
    if (explicit) {
      this.connectionString = explicit;
      this.sourceLabel = 'VECTOR_DATABASE_URL(sidecar)';
    } else if (direct) {
      this.connectionString = direct;
      this.sourceLabel = 'DIRECT_URL(主库直连)';
    } else {
      this.connectionString = primary ?? '';
      this.sourceLabel = 'DATABASE_URL';
    }
  }

  getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({ connectionString: this.connectionString, max: 5 });
      this.logger.log(
        `Vector DB → ${this.describeTarget()} [${this.sourceLabel}]`,
      );
    }
    return this.pool;
  }

  /** 日志脱敏：只输出 host:port/db，绝不含密码 */
  describeTarget(): string {
    try {
      const u = new URL(this.connectionString);
      return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
    } catch {
      return '(unparsable)';
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
```

- [ ] **Step 5: knowledge.module.ts 接线**

providers 数组加 `VectorDbService`，顶部加 `import { VectorDbService } from './services/vector-db.service';`（exports 不需要——仅 KnowledgeModule 内部消费）

- [ ] **Step 6: 跑测试确认通过**

```bash
pnpm --filter api test -- vector-db
```
预期：4 passed

- [ ] **Step 7: Commit**

```bash
cd /home/asus/桌面/ERP && git add water-erp/apps/api/src/knowledge/services/vector-db.service.ts water-erp/apps/api/src/knowledge/services/vector-db.service.spec.ts water-erp/apps/api/src/knowledge/knowledge.module.ts water-erp/apps/api/package.json water-erp/pnpm-lock.yaml
git commit -m "feat(vector): pgvector 专用连接池 VectorDbService（VECTOR_DATABASE_URL→DIRECT_URL→DATABASE_URL 回退链）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: VectorSearchService 换执行器 + VectorInitService 幂等 bootstrap

**Files:**
- Modify: `apps/api/src/knowledge/services/vector-search.service.ts`（全文重写执行层，5 个方法 SQL 不动）
- Modify: `apps/api/src/knowledge/services/vector-init.service.ts`（prisma → vectorDb；DDL 幂等全套）

**Interfaces:**
- Consumes: Task 1 的 `VectorDbService.getPool()/describeTarget()`
- Produces: `VectorSearchService` 公共签名**不变**（search/insertChunks/deleteByFileId/deleteByCollection/getChunkCountByFileId）——knowledge.service 与两个 reviewer 零改动

- [ ] **Step 1: 重写 vector-search.service.ts**

只动三处：import 行、constructor、每个方法里的执行调用。完整目标形态：

```typescript
import { Injectable } from '@nestjs/common';
import { EmbeddingService } from '../../local-ai/embedding.service';
import { VectorDbService } from './vector-db.service';
import { createId } from '@paralleldrive/cuid2';

export interface ChunkSearchResult {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  fileId: string;
  score: number;
}

export interface InsertChunk {
  collectionName: string;
  fileId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

@Injectable()
export class VectorSearchService {
  constructor(
    private vectorDb: VectorDbService,
    private embedding: EmbeddingService,
  ) {}

  private validateVector(vector: number[]): string {
    // Validate all values are finite numbers to prevent SQL injection
    for (const val of vector) {
      if (!Number.isFinite(val)) {
        throw new Error('Invalid embedding vector: contains non-finite values');
      }
    }
    return `[${vector.map((v) => v.toFixed(6)).join(',')}]`;
  }

  async search(
    query: string,
    collectionName: string,
    topK = 10,
  ): Promise<ChunkSearchResult[]> {
    const [queryVector] = await this.embedding.embed([query]);
    const vectorStr = this.validateVector(queryVector);

    const res = await this.vectorDb.getPool().query<{
      id: string;
      content: string;
      metadata: Record<string, unknown>;
      file_id: string;
      score: number;
    }>(
      `SELECT id, content, metadata, "fileId" AS file_id,
              1 - (embedding <=> '${vectorStr}'::vector) AS score
       FROM "DocumentChunk"
       WHERE "collectionName" = $1
       ORDER BY embedding <=> '${vectorStr}'::vector
       LIMIT $2`,
      [collectionName, topK],
    );

    return res.rows.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: row.metadata,
      fileId: row.file_id,
      score: Number(row.score),
    }));
  }

  async insertChunks(chunks: InsertChunk[]): Promise<void> {
    for (const chunk of chunks) {
      const id = createId();
      const vectorStr = this.validateVector(chunk.embedding);
      const metadataJson = JSON.stringify(chunk.metadata ?? {});

      await this.vectorDb.getPool().query(
        `INSERT INTO "DocumentChunk" (id, "collectionName", "fileId", content, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5::jsonb, '${vectorStr}'::vector)`,
        [id, chunk.collectionName, chunk.fileId, chunk.content, metadataJson],
      );
    }
  }

  async deleteByFileId(fileId: string): Promise<void> {
    await this.vectorDb
      .getPool()
      .query(`DELETE FROM "DocumentChunk" WHERE "fileId" = $1`, [fileId]);
  }

  async deleteByCollection(collectionName: string): Promise<void> {
    await this.vectorDb
      .getPool()
      .query(`DELETE FROM "DocumentChunk" WHERE "collectionName" = $1`, [
        collectionName,
      ]);
  }

  async getChunkCountByFileId(fileId: string): Promise<number> {
    const res = await this.vectorDb.getPool().query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM "DocumentChunk" WHERE "fileId" = $1`,
      [fileId],
    );
    return Number(res.rows[0]?.count ?? 0);
  }
}
```

（删 PrismaService import 与构造注入——PrismaModule 全局提供本就未显式 import，无残留引用即无破坏）

- [ ] **Step 2: 重写 vector-init.service.ts**（目标库上幂等建全套——sidecar 库没有迁移文件，PG 主库上这些 IF NOT EXISTS 天然幂等无副作用）

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VectorDbService } from './vector-db.service';

@Injectable()
export class VectorInitService implements OnModuleInit {
  private readonly logger = new Logger(VectorInitService.name);

  constructor(
    private vectorDb: VectorDbService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    if (this.config.get<string>('PGVECTOR_ENABLED') !== 'true') {
      this.logger.log('PGVector disabled, skipping vector extension init');
      return;
    }

    const pool = this.vectorDb.getPool();
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      this.logger.log(
        `pgvector extension ensured @ ${this.vectorDb.describeTarget()}`,
      );
    } catch (e) {
      this.logger.error(
        'Failed to create pgvector extension on vector DB. Check VECTOR_DATABASE_URL.',
        e,
      );
      return;
    }

    // sidecar 形态：目标库可能为空库（金仓主库无此表）——幂等建全套
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "DocumentChunk" (
          "id" TEXT NOT NULL,
          "collectionName" TEXT NOT NULL,
          "fileId" TEXT NOT NULL,
          "content" TEXT NOT NULL,
          "metadata" JSONB NOT NULL DEFAULT '{}',
          "embedding" vector(1024),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
      )`);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS "DocumentChunk_collectionName_idx" ON "DocumentChunk"("collectionName")`,
    );
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_idx" ON "DocumentChunk"
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)`);

    this.logger.log(
      `HNSW embedding indexes ensured @ ${this.vectorDb.describeTarget()}`,
    );
  }
}
```

（DDL 列定义与迁移 `20260701030336_procurement_merge_phase2` 建表 + `20260727020000` 加列严格一致；embedding 可空 = schema 的 `Unsupported("vector")?`）

- [ ] **Step 3: 编译闸**

```bash
cd /home/asus/桌面/ERP/water-erp && pnpm --filter api exec tsc --noEmit
```
预期：无错误（如有 PrismaService 残留引用在此暴露）

- [ ] **Step 4: 全量单测回归**

```bash
pnpm --filter api test
```
预期：与基线一致全绿（这两个服务无既有 spec；若有依赖 PrismaService 的隐式引用会在此炸）

- [ ] **Step 5: Commit**

```bash
cd /home/asus/桌面/ERP && git add water-erp/apps/api/src/knowledge/services/vector-search.service.ts water-erp/apps/api/src/knowledge/services/vector-init.service.ts
git commit -m "feat(vector): VectorSearchService 切换 pg 池执行器；VectorInit 幂等 bootstrap（sidecar 空库自建表+HNSW）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Reviewer 软兜底（向量检索不可用 → 无 RAG 上下文继续跑）

**Files:**
- Modify: `apps/api/src/tender-review/services/semantic-reviewer.service.ts:117-128`（检索循环）
- Modify: `apps/api/src/tender-review/services/general-reviewer.service.ts:126-131`（检索调用）
- Test: `apps/api/src/tender-review/services/semantic-reviewer.service.spec.ts`（新建）

**Interfaces:**
- Consumes: `VectorSearchService.search(query, collectionName, topK): Promise<ChunkSearchResult[]>`（签名不变，仅 mock 其抛错）
- Produces: 行为契约——`search` 抛错时 `review()` 不再 reject，改为空检索结果 + 一次 warn 日志；`signal.aborted` 时仍上抛

- [ ] **Step 1: 写失败测试**（`semantic-reviewer.service.spec.ts`）

```typescript
import { SemanticReviewerService } from './semantic-reviewer.service';

describe('SemanticReviewerService 向量检索软兜底', () => {
  const rules = [
    { id: 'r1', name: '规则一', source: '测试制度', logicExpression: { description: '检查要求描述' } },
  ] as any;

  function make(vectorSearchOverrides: any) {
    const llm = {
      chatJson: jest.fn().mockResolvedValue({ results: [] }),
    } as any;
    const clauseParser = { parse: () => ({ clauses: [] }) } as any;
    const vectorSearch = {
      search: jest.fn(),
      ...vectorSearchOverrides,
    } as any;
    const svc = new SemanticReviewerService(llm, vectorSearch, clauseParser);
    return { svc, llm, vectorSearch };
  }

  it('向量检索抛错时 review() 不 reject，退化为无 RAG 上下文（提示词含「无相关检索结果」）', async () => {
    const { svc, llm, vectorSearch } = make({
      search: jest
        .fn()
        .mockRejectedValue(new Error('column "embedding" does not exist')),
    });
    const out = await svc.review(rules, '第一章 总则\n文档内容', 'kb1');
    expect(out).toHaveLength(1);
    expect(llm.chatJson).toHaveBeenCalledTimes(1);
    const userPrompt = llm.chatJson.mock.calls[0][1] as string;
    expect(userPrompt).toContain('无相关检索结果');
  });

  it('向量检索正常时提示词携带 KB 段落', async () => {
    const { svc, llm } = make({
      search: jest.fn().mockResolvedValue([
        { id: 'c1', content: '制度原文片段甲', metadata: {}, fileId: 'f1', score: 0.9 },
      ]),
    });
    await svc.review(rules, '第一章 总则\n文档内容', 'kb1');
    const userPrompt = llm.chatJson.mock.calls[0][1] as string;
    expect(userPrompt).toContain('制度原文片段甲');
  });

  it('软兜底不吞 AbortError：signal 已中止时上抛', async () => {
    const { svc, vectorSearch } = make({
      search: jest.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
    });
    const ac = new AbortController();
    ac.abort();
    await expect(
      svc.review(rules, '文档', 'kb1', ac.signal),
    ).rejects.toThrow('Aborted');
  });
});
```

（第三个用例：review 入口首个 abort 检查先于检索——确认走 DOMException 路径；若首查未触发则由 catch 内 `signal?.aborted` 再抛，两者任一使测试成立）

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter api test -- semantic-reviewer
```
预期：第 1/3 用例 FAIL（当前 search 抛错直接 reject 出 review()）

- [ ] **Step 3: semantic-reviewer 打补丁**（117-128 行检索循环替换为）

```typescript
    // 1. 预先收集每条规则的 KB 检索结果（向量库不可用时软降级为无 RAG 上下文）
    const ruleSearchResults = new Map<number, ChunkSearchResult[]>();
    let warnedVectorDown = false;
    for (let i = 0; i < rules.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const description =
        (rules[i].logicExpression.description as string) ?? rules[i].name;
      let results: ChunkSearchResult[] = [];
      try {
        results = await this.vectorSearch.search(
          description,
          knowledgeBaseId,
          5,
        );
      } catch (err) {
        if (signal?.aborted) throw err;
        if (!warnedVectorDown) {
          this.logger.warn(
            `向量检索不可用，语义审查退化为无 RAG 上下文（语义规则此时基本失效）：${String(err).slice(0, 200)}`,
          );
          warnedVectorDown = true;
        }
      }
      ruleSearchResults.set(i, results);
    }
```

同时：类里加 `private readonly logger = new Logger(SemanticReviewerService.name);`，`@nestjs/common` 的 `Logger` 未 import 则补 import。

- [ ] **Step 4: general-reviewer 打补丁**（126-131 行替换为）

```typescript
      const searchQuery = this.sampleSectionText(section.content);
      let searchResults: ChunkSearchResult[] = [];
      try {
        searchResults = await this.vectorSearch.search(
          searchQuery,
          knowledgeBaseId,
          25,
        );
      } catch (err) {
        if (signal?.aborted) throw err;
        if (!warnedVectorDown) {
          new Logger(GeneralReviewerService.name).warn(
            `向量检索不可用，通用审查退化为无 RAG 上下文：${String(err).slice(0, 200)}`,
          );
          warnedVectorDown = true;
        }
      }
```

并在 `review()` 方法开头（`const sections = ...` 之前）加 `let warnedVectorDown = false;`（Logger 该文件 169 行已在用，import 已存在）。

- [ ] **Step 5: 跑测试确认通过 + 全量回归**

```bash
pnpm --filter api test -- semantic-reviewer && pnpm --filter api test
```
预期：新增 3 用例绿；全量与基线一致

- [ ] **Step 6: Commit**

```bash
cd /home/asus/桌面/ERP && git add water-erp/apps/api/src/tender-review/services/semantic-reviewer.service.ts water-erp/apps/api/src/tender-review/services/semantic-reviewer.service.spec.ts water-erp/apps/api/src/tender-review/services/general-reviewer.service.ts
git commit -m "feat(tender-review): 语义/通用审查向量检索软兜底——sidecar 不可用时退化为无 RAG 上下文而非任务红失败

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: compose sidecar 服务 + 金仓迁移脚本 + 文档

**Files:**
- Modify: `water-erp/docker-compose.yml`（services 段加 `pgvector`，volumes 段加 `pgvector-data`）
- Create: `water-erp/scripts/db-migrate-kingbase.sh`（chmod +x）
- Modify: `water-erp/CLAUDE.md`（ENV 段加一行——**必须走 Bash**）

**Interfaces:**
- Produces: `docker compose --profile vector-sidecar up -d pgvector`（宿主 5434）；`scripts/db-migrate-kingbase.sh`（env：DATABASE_URL/DIRECT_URL 指金仓）

- [ ] **Step 1: compose 加服务**（services 段 minio 之后、volumes 之前；volumes 段加 `pgvector-data:`）

```yaml
  # 向量检索 sidecar（金仓/国产化形态用；纯 PG 形态不需要——VectorDbService 默认回退主库 DIRECT_URL）
  # 启用：docker compose --profile vector-sidecar up -d pgvector
  # API 侧配套：VECTOR_DATABASE_URL=postgresql://water_erp:water_erp_dev@localhost:5434/water_erp
  pgvector:
    profiles: ["vector-sidecar"]
    image: pgvector/pgvector:pg16
    container_name: water-erp-pgvector
    environment:
      POSTGRES_USER: water_erp
      POSTGRES_PASSWORD: water_erp_dev
      POSTGRES_DB: water_erp
    ports:
      - "5434:5432" # 生产可去掉宿主映射，仅内网访问
    volumes:
      - pgvector-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U water_erp -d water_erp"]
      interval: 5s
      timeout: 3s
      retries: 10
```

volumes 段追加：`  pgvector-data:`

- [ ] **Step 2: 验证 compose 语法与 profile 隔离**

```bash
cd /home/asus/桌面/ERP/water-erp && docker compose config --profiles && docker compose --profile vector-sidecar config --services | grep pgvector
```
预期：默认 profiles 为空（不新增）；带 profile 时列出 pgvector

- [ ] **Step 3: 写金仓迁移脚本**（`scripts/db-migrate-kingbase.sh`，chmod +x）

```bash
#!/usr/bin/env bash
# 金仓(KingbaseES PG 模式)迁移部署——自动处理两个已知的金仓差异，其余失败原样上抛人工介入：
#   1) gen_random_uuid() 缺失      → CREATE EXTENSION kbcrypto 后重试（老内核无 PG13+ 内建 UUID）
#   2) pgvector 迁移(20260727...)   → 向量由 sidecar 承载，主库跳过（migrate resolve --applied）
# 前置：向量侧另起 sidecar（docker compose --profile vector-sidecar up -d pgvector），
#       API 设 VECTOR_DATABASE_URL 指向它。
# 用法（在 water-erp/ 下）：
#   DATABASE_URL='postgresql://system:PWD@HOST:54321/water_erp?schema=public' \
#   DIRECT_URL='postgresql://system:PWD@HOST:54321/water_erp' \
#   ./scripts/db-migrate-kingbase.sh
set -uo pipefail
cd "$(dirname "$0")/../apps/api"

: "${DIRECT_URL:?需设置 DIRECT_URL（金仓直连，prisma migrate 用）}"
: "${DATABASE_URL:?需设置 DATABASE_URL}"

log=$(mktemp)
trap 'rm -f "$log"' EXIT

for attempt in 1 2 3 4; do
  echo "▶ prisma migrate deploy（第 ${attempt} 次）"
  if npx prisma migrate deploy 2>&1 | tee "$log"; then
    echo "✔ 全部迁移已应用"
    exit 0
  fi
  mig=$(grep -o 'Migration name: [^ ]*' "$log" | tail -1 | cut -d' ' -f3)
  if grep -q 'gen_random_uuid' "$log"; then
    echo "▶ 金仓缺 gen_random_uuid()，启用 kbcrypto 后重试"
    npx prisma db execute --url "$DIRECT_URL" --stdin <<'SQL'
CREATE EXTENSION IF NOT EXISTS kbcrypto;
SQL
    [ -n "$mig" ] && npx prisma migrate resolve --rolled-back "$mig"
  elif grep -q 'vector.control' "$log"; then
    echo "▶ 金仓无 pgvector（向量由 sidecar 承载），主库跳过该迁移：$mig"
    [ -n "$mig" ] && npx prisma migrate resolve --applied "$mig"
  else
    echo "✘ 未预期的迁移失败（$mig），人工介入；日志："
    tail -30 "$log"
    exit 1
  fi
done
echo "✘ 重试次数用尽"
exit 1
```

- [ ] **Step 4: 脚本实测**（对着 54323 的 V8R6 容器——库里已 190 条全绿，脚本应首跑即 OK；另可对 54322 的 V9 库验证 kbcrypto 分支？V9 库已处理过——只验 happy path）

```bash
cd /home/asus/桌面/ERP/water-erp && chmod +x scripts/db-migrate-kingbase.sh && \
DATABASE_URL='postgresql://system:kdb123456@localhost:54323/water_erp' \
DIRECT_URL='postgresql://system:kdb123456@localhost:54323/water_erp' \
./scripts/db-migrate-kingbase.sh
```
预期：`✔ 全部迁移已应用`（exit 0）
（注意：54323 库的两条迁移 checksum 是 /tmp 副本口径——脚本用仓库 schema 跑，`migrate deploy` 不校验已应用条目的 checksum，不受影响）

- [ ] **Step 5: CLAUDE.md 补一行**（Bash 追加到 ENV 配置块的 KMS_SECRET 行之后）

在 `ADMIN_KEYSTORE_DIR=...` 行后插入：

```
VECTOR_DATABASE_URL=postgresql://... # 可选：向量检索独立库（金仓/国产化形态配 sidecar；缺省回退 DIRECT_URL→主库）
```

```bash
cd /home/asus/桌面/ERP/water-erp && grep -n 'ADMIN_KEYSTORE_DIR' CLAUDE.md | head -1
# 用 sed 在该行后插入上述一行（单引号内原样）
```

- [ ] **Step 6: Commit**

```bash
cd /home/asus/桌面/ERP && git add water-erp/docker-compose.yml water-erp/scripts/db-migrate-kingbase.sh water-erp/CLAUDE.md
git commit -m "feat(kingbase): pgvector sidecar compose 服务(--profile vector-sidecar@5434)与金仓迁移部署脚本(kbcrypto/向量迁移自动处置)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 双环境端到端验证（dev PG 回归 + 金仓+sidecar 全链）

**Files:** 无代码改动（验证任务；发现问题回改对应 Task 并补测试）

- [ ] **Step 1: 全量闸**

```bash
cd /home/asus/桌面/ERP/water-erp && pnpm --filter api exec tsc --noEmit && pnpm --filter api lint && pnpm --filter api test
```
预期：全绿

- [ ] **Step 2: dev-PG 回归冒烟（不设 VECTOR_DATABASE_URL，验证回退链直连主库）**

```bash
cd apps/api && PORT=4099 node dist/main.js   # 后台；.env 的 DATABASE_URL/DIRECT_URL 原样
```
日志预期：`Vector DB → localhost:5432/water_erp [DIRECT_URL(主库直连)]` + `pgvector extension ensured @ localhost:5432/water_erp` + `HNSW embedding indexes ensured`
curl `http://localhost:4099/api/docs` → 200；验证后 kill

- [ ] **Step 3: 起 sidecar 并金仓全链验证**

```bash
cd /home/asus/桌面/ERP/water-erp && docker compose --profile vector-sidecar up -d pgvector
cd apps/api && PORT=4099 PGVECTOR_ENABLED=true \
  DATABASE_URL='postgresql://system:kdb123456@localhost:54323/water_erp' \
  DIRECT_URL='postgresql://system:kdb123456@localhost:54323/water_erp' \
  VECTOR_DATABASE_URL='postgresql://water_erp:water_erp_dev@localhost:5434/water_erp' \
  node dist/main.js   # 后台
```
日志预期：`Vector DB → localhost:5434/water_erp [VECTOR_DATABASE_URL(sidecar)]` + extension/HNSW ensured 指 5434

- [ ] **Step 4: 写路径端到端（知识库上传 → chunks 落 sidecar 而非金仓）**

```bash
# admin 登录（web 门户）
TOKEN=$(curl -s -X POST http://localhost:4099/api/auth/login -H 'Content-Type: application/json' \
  -H 'X-Portal: web' -d '{"username":"Swhi-CGZX-admin","password":"Swhi-CGZX-admin@2026"}' | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)
# 建知识库 + 传 txt
KB=$(curl -s -X POST http://localhost:4099/api/knowledge -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"sidecar验证","isShared":true}' | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
echo "第一章 采购制度总则。本制度适用于集团所有采购活动。第二条 采购应遵循公开公平公正原则。" > /tmp/kb-sidecar-test.txt
curl -s -X POST "http://localhost:4099/api/knowledge/$KB/files" -H "Authorization: Bearer $TOKEN" -F "file=@/tmp/kb-sidecar-test.txt"
# 核对：sidecar 有行、金仓无表
docker exec water-erp-pgvector psql -U water_erp -d water_erp -c 'SELECT count(*) FROM "DocumentChunk";'        # 预期 >0
docker exec kingbase-v8r6-test ksql -U system -d water_erp -c 'SELECT count(*) FROM "DocumentChunk";' 2>&1 | head -1  # 预期 relation 不存在（隔离成立）
```
（依赖 bge-m3 :8003 在跑做 embedding；上传解析失败则查 API 日志）

- [ ] **Step 5: 读路径验证**（sidecar 上直接跑 `<=>` 余弦算子，证明检索 SQL 可用）

```bash
docker exec water-erp-pgvector psql -U water_erp -d water_erp -c \
  'SELECT id, 1 - (embedding <=> (SELECT embedding FROM "DocumentChunk" LIMIT 1)) AS score FROM "DocumentChunk" ORDER BY embedding <=> (SELECT embedding FROM "DocumentChunk" LIMIT 1) LIMIT 3;'
```
预期：返回行与 score

- [ ] **Step 6: 收尾**

kill 冒烟实例、释放 4099；sidecar 容器保留（金仓形态验证资产）；`git status` 确认无意外脏文件；向用户报告验证矩阵与未推送提交数（不主动 push）

---

## Self-Review 记录

- 覆盖检查：评估 6 处改动 ↔ Task1(池+依赖+模块) / Task2(检索+初始化) / Task3(软兜底) / Task4(compose+脚本+文档) / Task5(双环境验证) —— 全对应；D1/D2/D3 决策在 Global Constraints 与 Task4 固化
- 类型一致性：VectorDbService 的 connectionString/sourceLabel/getPool/describeTarget 在 Task1 定义、Task2 消费一致；VectorSearchService 公共签名不变（Task3 mock 依赖此契约）
- Review Focus 5 条 ↔ Task1 测试×2（pgbouncer 回退/脱敏）、Task3 测试（软兜底+abort）、Task5 Step3/4（隔离性/形态核对）、Task5 Step1/2（双形态回归）全钉住
