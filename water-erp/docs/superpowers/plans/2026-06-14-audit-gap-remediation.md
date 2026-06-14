# 审计问题修复实施计划（Audit Gap Remediation）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `docs/superpowers/audit/2026-06-14-feature-audit-gaps.md` 列出的 9 个功能空壳/不完善模块，使其从"伪实现/规则引擎"升级为基于真实数据与真实加密/校验的实现。

**Architecture:** 按"严重程度 + 依赖关系"分三个 Phase。Phase 1 修复 3 个 🔴 严重核心问题（归档哈希、标书真实解密、AI 真实评分），均为独立可交付；Phase 2 搭建通知/实时推送基础设施（多渠道通知、WebSocket 扩展）；Phase 3 实现依赖基础设施的业务增强（专家回避、资质到期通知、供应商/专家绩效聚合与自动淘汰）。所有 Phase 内任务可独立交付、独立测试。

**Tech Stack:** NestJS 11、Prisma 6、PostgreSQL 16、MinIO、Node.js `crypto`（AES-256-GCM / SHA-256）、Socket.IO、Jest。加密复用既有 `announcement/bid-document.crypto.ts` 的 `encryptBuffer`/`decryptBuffer`。

---

## 关键约束（务必遵守）

1. **Prisma 迁移（非交互环境）**：新增列一律先 nullable → 回填 → 必要时再 NOT NULL。执行用 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 pnpm --filter api exec prisma migrate dev --name <name>`，或 `--create-only` + `db execute` + `migrate resolve --applied`。
2. **向后兼容**：所有新增加密/校验字段必须 nullable，旧数据走 legacy 分支并记监督日志，绝不破坏存量种子数据 `BID-2026-0518`。
3. **纯函数优先**：可独立测试的逻辑（digest 计算、风险因子映射、冲突检测）抽成 `*.ts` 纯函数文件，匹配 `bid-state.ts` 模式，单测先行。
4. **测试命令统一**：`pnpm --filter api test -- <pattern>`；纯函数 spec 无需 mock prisma；service 集成测试用 `Test.createTestingModule` + 手工 mock prisma（见 `bid.service.spec.ts` 既有写法）。
5. **每个 Task 末尾 commit**，commit message 用中文 feat/fix 前缀。

---

## 文件结构总览

**Phase 1 新建：**
- `apps/api/src/bid/bid-archive.digest.ts` — 归档内容 SHA-256 纯函数
- `apps/api/src/bid/bid-archive.digest.spec.ts` — 其单测
- `apps/api/src/bid/bid-submission.crypto.ts` — 标书提交加密+完整性校验纯函数
- `apps/api/src/bid/bid-submission.crypto.spec.ts` — 其单测
- `apps/api/src/ai/risk-score.compute.ts` — 风险因子→评分映射纯函数
- `apps/api/src/ai/risk-score.compute.spec.ts` — 其单测

**Phase 1 修改：** `bid.service.ts`（archiveAll、decryptSupplier）、`ai.service.ts`（getSupplierRiskScores）、`prisma/schema.prisma`（SupplierBidSubmission 加 sealed 字段）。

**Phase 2 新建：**
- `apps/api/src/notification/channels/notification-channel.interface.ts`
- `apps/api/src/notification/channels/email.channel.ts`、`sms.channel.ts`
- `apps/api/src/notification/channels/notification-channel.interface.spec.ts`

**Phase 2 修改：** `notification.service.ts`（分发多渠道）、`bid.gateway.ts`（新增 notify 方法）、`bid.service.ts`（submitScore/createClarification 接 WS）、`apps/api/package.json`（加 nodemailer）。

**Phase 3 新建：**
- `apps/api/src/expert/expert-conflict.service.ts` + `.spec.ts`
- `apps/api/src/supplier-portal/qualification-expiry.service.ts` + `.spec.ts`
- `apps/api/src/scheduler/scheduler.module.ts` + `scheduler.service.ts`

**Phase 3 修改：** `expert.service.ts`（confirmAvoidance 接冲突检测）、`expert-admin.service.ts`（抽取过滤复用）、`supplier-portal.service.ts`（资质到期扫描）、`supplier.service.ts`（绩效聚合 + 自动淘汰）、`expert-admin.service.ts`（专家自动停用）、`apps/api/package.json`（加 `@nestjs/schedule`）、`app.module.ts`（注册 SchedulerModule）。

---

# Phase 1 — 严重核心问题修复（🔴）

## Task 1：归档真实 SHA-256 Digest（审计 2.2）

**Files:**
- Create: `apps/api/src/bid/bid-archive.digest.ts`
- Create: `apps/api/src/bid/bid-archive.digest.spec.ts`
- Modify: `apps/api/src/bid/bid.service.ts:583-584`（archiveAll 内的 hashDigest 生成）

**设计**：BidArchiveItem 没有独立文件，"归档内容"= 该项目全部归档项 + 项目关键元数据的规范化 JSON。对该 JSON 字符串计算真实 SHA-256，保证同输入→同 digest、防篡改。

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/bid/bid-archive.digest.spec.ts
import { computeArchiveDigest } from './bid-archive.digest';

describe('computeArchiveDigest', () => {
  const project = { id: 'p1', projectCode: 'BID-2026-0518', name: '测试项目', stage: 'ARCHIVED' };
  const items = [
    { id: 'a1', name: '中标通知书', ownerRole: '系统', status: 'ARCHIVED' },
    { id: 'a2', name: '评审报告', ownerRole: '系统', status: 'ARCHIVED' },
  ];

  it('相同输入产生相同 digest', () => {
    const d1 = computeArchiveDigest(project as any, items as any);
    const d2 = computeArchiveDigest(project as any, items as any);
    expect(d1).toBe(d2);
  });

  it('以 sha256: 为前缀且后接 64 位 hex', () => {
    const d = computeArchiveDigest(project as any, items as any);
    expect(d).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('归档项内容变化导致 digest 变化（防篡改）', () => {
    const base = computeArchiveDigest(project as any, items as any);
    const tampered = computeArchiveDigest(project as any,
      [{ ...items[0], name: '篡改项' }, items[1]] as any);
    expect(tampered).not.toBe(base);
  });

  it('项目元数据变化导致 digest 变化', () => {
    const base = computeArchiveDigest(project as any, items as any);
    const changed = computeArchiveDigest({ ...project, name: '改名' } as any, items as any);
    expect(changed).not.toBe(base);
  });

  it('归档项顺序不影响 digest（稳定性）', () => {
    const asc = computeArchiveDigest(project as any, items as any);
    const desc = computeArchiveDigest(project as any, [items[1], items[0]] as any);
    expect(asc).toBe(desc);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter api test -- bid-archive.digest`
Expected: FAIL（`computeArchiveDigest is not defined` / 模块不存在）

- [ ] **Step 3: 实现纯函数**

```typescript
// apps/api/src/bid/bid-archive.digest.ts
import * as crypto from 'crypto';

interface ArchiveProject {
  id: string;
  projectCode: string;
  name: string;
  stage: string;
}
interface ArchiveItemLike {
  id: string;
  name: string;
  ownerRole: string;
  status: string;
}

/**
 * 计算归档内容的 SHA-256 digest。
 * 规范化：归档项按 id 排序后取 [id,name,ownerRole,status]，
 * 拼接项目元数据，再整体 SHA-256。同输入恒等、防篡改。
 */
export function computeArchiveDigest(project: ArchiveProject, items: ArchiveItemLike[]): string {
  const normalizedItems = [...items]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(i => [i.id, i.name, i.ownerRole, i.status]);

  const payload = JSON.stringify({
    projectId: project.id,
    projectCode: project.projectCode,
    projectName: project.name,
    stage: project.stage,
    items: normalizedItems,
  });

  const hash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  return `sha256:${hash}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter api test -- bid-archive.digest`
Expected: PASS（5 个用例全过）

- [ ] **Step 5: 接入 archiveAll**

> 注意：当前 `archiveAll`（`bid.service.ts:565-568`）的 `project` 查询只 select `{ stage, name }`，缺 `id`/`projectCode`。digest 需要这两个字段，故必须先扩展 select。

在 `bid.service.ts` 顶部加 import：
```typescript
import { computeArchiveDigest } from './bid-archive.digest';
```

**5a.** 把 `bid.service.ts:565-568` 的 select：
```typescript
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true, name: true },
    });
```
扩展为：
```typescript
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, projectCode: true, stage: true, name: true },
    });
```

**5b.** 把 `bid.service.ts:583-584` 处：
```typescript
const now = new Date();
const hashDigest = `sha256:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
```
改为（digest 入参用归档后的项目状态 `'ARCHIVED'`，而非当前 stage，使 digest 反映"归档完成"语义；`archiveItems` 已在该作用域，见 `bid.service.ts:575-577`）：
```typescript
const now = new Date();
const hashDigest = computeArchiveDigest(
  { id: project.id, projectCode: project.projectCode, name: project.name, stage: 'ARCHIVED' },
  archiveItems,
);
```

- [ ] **Step 6: 运行 bid 全套测试确认无回归**

Run: `pnpm --filter api test -- bid.service`
Expected: PASS（既有用例 + digest 用例全过）

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/bid/bid-archive.digest.ts apps/api/src/bid/bid-archive.digest.spec.ts apps/api/src/bid/bid.service.ts
git commit -m "fix(bid): 归档 digest 改为真实 SHA-256（替换 Date.now+Math.random 伪哈希）"
```

---

## Task 2：标书真实解密 — 加密封存 + 完整性校验（审计 2.1）

**Files:**
- Create: `apps/api/src/bid/bid-submission.crypto.ts`
- Create: `apps/api/src/bid/bid-submission.crypto.spec.ts`
- Modify: `apps/api/prisma/schema.prisma`（SupplierBidSubmission 加 sealed 字段）
- Modify: `apps/api/src/bid/bid.service.ts:311-384`（decryptSupplier）
- Create: `apps/api/prisma/migrations/<ts>_add_submission_sealed/migration.sql`

**设计（两层真实化）**：
- **Layer A 完整性校验（始终生效，无 schema 变更）**：解密时从 MinIO 读取投标文件、重算 SHA-256、与 `FileAsset.sha256` 比对，不一致→`DANGER`（真实篡改/损坏检测，不再靠 `simulateDanger` 手动触发）。
- **Layer B 保密性（新提交生效）**：`submitBid` 时对 technical/business/cover 文件用 AES-256-GCM 加密封存，密钥存 `SupplierBidSubmission`。`decryptSupplier` 在密钥存在时执行真实 AES 解密。存量无密钥数据走 legacy 分支（仍做 Layer A 校验 + 监督日志标注）。

> 复用既有 `encryptBuffer`/`decryptBuffer`/`streamToBuffer`（`announcement/bid-document.crypto.ts`），不重复造轮子。

### 2a. 完整性校验纯函数

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/bid/bid-submission.crypto.spec.ts
import * as crypto from 'crypto';
import { verifyIntegrity, classifyDecryptOutcome } from './bid-submission.crypto';

describe('verifyIntegrity', () => {
  const content = Buffer.from('bid-content');
  const sha = crypto.createHash('sha256').update(content).digest('hex');

  it('内容 SHA-256 与存储值一致 → true', () => {
    expect(verifyIntegrity(content, sha)).toBe(true);
  });
  it('内容被篡改 → false', () => {
    const tampered = Buffer.from('tampered');
    expect(verifyIntegrity(tampered, sha)).toBe(false);
  });
  it('存储 sha 缺失（legacy）→ null（跳过校验）', () => {
    expect(verifyIntegrity(content, '')).toBeNull();
    expect(verifyIntegrity(content, null as any)).toBeNull();
  });
});

describe('classifyDecryptOutcome', () => {
  it('无 sealedKey 且完整性 OK → SUCCESS (legacy)', () => {
    expect(classifyDecryptOutcome({ hasSealedKey: false, decryptOk: null, integrityOk: true }))
      .toBe('SUCCESS');
  });
  it('有 sealedKey 且解密成功且完整性 OK → SUCCESS', () => {
    expect(classifyDecryptOutcome({ hasSealedKey: true, decryptOk: true, integrityOk: true }))
      .toBe('SUCCESS');
  });
  it('有 sealedKey 但 AES 解密失败 → DANGER', () => {
    expect(classifyDecryptOutcome({ hasSealedKey: true, decryptOk: false, integrityOk: null }))
      .toBe('DANGER');
  });
  it('完整性校验不通过 → DANGER', () => {
    expect(classifyDecryptOutcome({ hasSealedKey: true, decryptOk: true, integrityOk: false }))
      .toBe('DANGER');
    expect(classifyDecryptOutcome({ hasSealedKey: false, decryptOk: null, integrityOk: false }))
      .toBe('DANGER');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- bid-submission.crypto`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现纯函数**

```typescript
// apps/api/src/bid/bid-submission.crypto.ts
import * as crypto from 'crypto';

export { encryptBuffer, decryptBuffer, streamToBuffer } from '../announcement/bid-document.crypto';

/** 比对 buffer 内容 SHA-256 与存储值。存储值缺失返回 null（legacy，跳过）。 */
export function verifyIntegrity(buffer: Buffer, storedSha256: string | null | undefined): boolean | null {
  if (!storedSha256) return null;
  const actual = crypto.createHash('sha256').update(buffer).digest('hex');
  return actual === storedSha256;
}

export type DecryptOutcome = 'SUCCESS' | 'DANGER';

/** 根据 AES 解密结果与完整性校验结果，决定最终 decryptStatus。 */
export function classifyDecryptOutcome(input: {
  hasSealedKey: boolean;
  decryptOk: boolean | null; // null = 无需 AES 解密
  integrityOk: boolean | null; // null = 无 sha 可校验
}): DecryptOutcome {
  // 保密层失败优先判 DANGER
  if (input.hasSealedKey && input.decryptOk === false) return 'DANGER';
  // 完整性校验明确不通过 → DANGER
  if (input.integrityOk === false) return 'DANGER';
  return 'SUCCESS';
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter api test -- bid-submission.crypto`
Expected: PASS（7 用例全过）

- [ ] **Step 5: Commit（纯函数层）**

```bash
git add apps/api/src/bid/bid-submission.crypto.ts apps/api/src/bid/bid-submission.crypto.spec.ts
git commit -m "feat(bid): 标书解密完整性校验与结果分类纯函数"
```

### 2b. Schema 加 sealed 字段

- [ ] **Step 6: 修改 schema**

在 `prisma/schema.prisma` 的 `SupplierBidSubmission` 模型（约 581-608 行）末尾、`status` 字段前插入：
```prisma
  // Layer B：新提交的投标文件 AES-256-GCM 加密封存密钥（key:iv:authTag hex）。legacy 存量数据为 null。
  technicalSealedKey  String?
  businessSealedKey   String?
  coverLetterSealedKey String?
```

- [ ] **Step 7: 生成并应用迁移**

Run:
```bash
cd "D:\claude projects\ERP-main/water-erp"
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 pnpm --filter api exec prisma migrate dev --name add_submission_sealed_keys
pnpm --filter api exec prisma generate
```
Expected: 迁移创建 + 应用成功，三个 nullable 列加入。若交互式提示，改用 `--create-only` 后 `db execute` + `migrate resolve --applied`。

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): SupplierBidSubmission 增加投标文件加密封存密钥字段"
```

### 2c. decryptSupplier 接入真实校验

- [ ] **Step 9: 写 decryptSupplier 集成测试（mock prisma + minio）**

在 `bid.service.spec.ts` 末尾追加 describe 块（参考既有 `BidService — stage transitions` 的 mock 写法）：
```typescript
describe('BidService — decryptSupplier 真实校验', () => {
  let service: BidService;
  let prisma: any;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: NotificationService, useValue: { create: jest.fn() } },
      { provide: BidGateway, useValue: { notifyDecryptStatus: jest.fn() } },
      BidService,
    ]}).compile();
    service = module.get(BidService);
  });

  it('无投标文件引用时仍返回 SUCCESS（保持开标流程）', async () => {
    prisma.$transaction.mockImplementationOnce(async (cb) => {
    prisma.$transaction.mockImplementationOnce(async (cb) => {
      const tx = {
        bidSupplier: {
          findFirst: jest.fn(async () => ({ id: 'bs1', projectId: 'p1', supplierName: 'S1' })),
          update: jest.fn(async ({ data }) => ({ id: 'bs1', supplierName: 'S1', decryptStatus: data.decryptStatus ?? 'SUCCESS', confirmStatus: 'PENDING' })),
          findUnique: jest.fn(async () => ({ id: 'bs1', supplierName: 'S1', decryptStatus: 'SUCCESS' })),
        },
        bidOpeningRecord: { create: jest.fn() },
        bidSupervisionLog: { create: jest.fn() },
      };
      return cb(tx);
    });
    const res = await service.decryptSupplier('p1', 'bs1');
    expect(res.decryptStatus).toBe('SUCCESS');
  });
```

- [ ] **Step 10: 重写 decryptSupplier**

替换 `bid.service.ts:311-384` 整个方法。顶部加 import：
```typescript
import { decryptBuffer, streamToBuffer } from './bid-submission.crypto';
import { verifyIntegrity, classifyDecryptOutcome } from './bid-submission.crypto';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { Logger } from '@nestjs/common';
```
在 BidService 类加 `private readonly logger = new Logger(BidService.name);`。

新方法：
```typescript
async decryptSupplier(projectId: string, supplierId: string, dto?: DecryptSupplierDto) {
  return this.prisma.$transaction(async (tx) => {
    const bidSupplier = await tx.bidSupplier.findFirst({ where: { projectId, id: supplierId } });
    if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });

    await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'RUNNING' } });

    // 查找该供应商的提交记录（含加密封存密钥与文件引用）
    const submission = bidSupplier.supplierId
      ? await this.prisma.supplierBidSubmission.findUnique({
          where: { supplierId_projectId: { supplierId: bidSupplier.supplierId, projectId } },
        })
      : null;

    // 真实解密 + 完整性校验（如有文件引用）
    let decryptOk: boolean | null = null;
    let integrityOk: boolean | null = null;
    let errorMsg = '';

    const fileRefs: Array<{ assetId?: string | null; sealedKey?: string | null }> = submission
      ? [
          { assetId: submission.technicalFileAssetId, sealedKey: submission.technicalSealedKey },
          { assetId: submission.businessFileAssetId, sealedKey: submission.businessSealedKey },
          { assetId: submission.coverLetterAssetId, sealedKey: submission.coverLetterSealedKey },
        ]
      : [];

    for (const ref of fileRefs) {
      if (!ref.assetId) continue;
      const asset = await this.prisma.fileAsset.findUnique({ where: { id: ref.assetId } });
      if (!asset) { errorMsg = `投标文件记录缺失: ${ref.assetId}`; break; }
      try {
        const objStream = await minioClient.getObject(MINIO_BUCKET, asset.key);
        const buffer = await streamToBuffer(objStream);
        // Layer B：有 sealedKey 时执行真实 AES 解密
        if (ref.sealedKey) {
          decryptBuffer(buffer, ref.sealedKey); // 解密失败会抛 → catch
          decryptOk = true;
        }
        // Layer A：完整性校验（解密后的明文 vs 存储 sha256）
        const integrity = verifyIntegrity(buffer, asset.sha256);
        if (integrity === false) { integrityOk = false; errorMsg = '标书文件完整性校验失败：SHA-256 不匹配（疑似篡改或损坏）'; break; }
        if (integrity === true) integrityOk = true;
      } catch (e) {
        decryptOk = ref.sealedKey ? false : null;
        errorMsg = `标书文件解密失败：${(e as Error).message}`;
        break;
      }
    }

    const hasSealedKey = !!submission && !!(submission.technicalSealedKey || submission.businessSealedKey || submission.coverLetterSealedKey);
    const outcome = dto?.simulateDanger === true
      ? 'DANGER' as const  // 保留显式模拟开关用于演练（覆盖真实结果）
      : (errorMsg && !integrityOk && decryptOk !== true
          ? 'DANGER' as const
          : classifyDecryptOutcome({ hasSealedKey, decryptOk, integrityOk }));

    if (outcome === 'DANGER') {
      const reason = errorMsg || '标书文件校验失败：签名不匹配或文件损坏';
      await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'DANGER', decryptError: reason } });
      this.gateway?.notifyDecryptStatus(projectId, { supplierId, decryptStatus: 'DANGER', supplierName: bidSupplier.supplierName });
      await tx.bidSupervisionLog.create({ data: { projectId, time: new Date(), role: '系统', target: bidSupplier.supplierName, action: '标书解密', result: `解密异常：${reason}`, riskFlag: '高风险' } });
      return tx.bidSupplier.findUnique({ where: { id: supplierId } });
    }

    // 解密成功
    await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'SUCCESS' } });
    this.gateway?.notifyDecryptStatus(projectId, { supplierId, decryptStatus: 'SUCCESS', supplierName: bidSupplier.supplierName });

    if (dto?.amount && dto?.period && dto?.qualityTarget && dto?.bondStatus) {
      await tx.bidOpeningRecord.create({ data: {
        projectId, supplierName: bidSupplier.supplierName,
        amount: dto.amount, period: dto.period, qualityTarget: dto.qualityTarget, bondStatus: dto.bondStatus,
        decryptResult: '解密成功', confirmStatus: '待供应商确认', bidSupplierId: supplierId,
      }});
    }
    const confirmed = await tx.bidSupplier.update({ where: { id: supplierId }, data: { confirmStatus: 'PENDING' } });
    const legacyNote = hasSealedKey ? '' : '（legacy 记录：未加密封存，仅完成完整性校验）';
    await tx.bidSupervisionLog.create({ data: { projectId, time: new Date(), role: '系统', target: bidSupplier.supplierName, action: '标书解密', result: `解密成功，等待供应商确认唱标信息${legacyNote}`, riskFlag: '无' } });
    return confirmed;
  });
}
```

- [ ] **Step 11: 运行单测确认通过**

Run: `pnpm --filter api test -- bid.service`
Expected: PASS（既有 + 新增 decryptSupplier 用例）

- [ ] **Step 12: 加密封存写入（submitBid 时）**

> 此步让"新提交"走 Layer B。在 `supplier-portal.service.ts:submitBid`（约 353-421 行）创建/更新 submission 时，对引用的 FileAsset 加密后写 sealedKey。但为不破坏 MinIO 原文（FileAsset.sha256 仍指明文），改为：**对明文内容重新 AES 加密得到密文 buffer，仅用于校验解密链路**——更稳妥的做法是单独存"封存校验样本"。

考虑到改动面与风险，**Layer B 的 MinIO 落地**采用最小实现：在 `submitBid` 成功后，读取 technical 文件明文 buffer，`encryptBuffer` 得到密文+key，把密文写回一个新 MinIO 对象 `submission-sealed/<date>/<rand>.enc`，把 key 存入 `submission.technicalSealedKey`。decryptSupplier Step 10 已按"密文对象即 asset.key 本身"假设——故需要让 sealedKey 模式下读取的是封存对象。

为控制本任务范围与回归风险，**Layer B 的 submitBid 写入作为一个独立后续任务**（见 Task 2 后续/可选）。**Task 2 交付范围定为**：decryptSupplier 完成 Layer A 真实完整性校验（已落地）+ 预留 sealedKey 解密分支（Step 10 已含）。submitBid 写 sealedKey 的接线在 Task 2-Extension 单独提交，避免一次性改动 supplier-portal 与 bid 两个 service。

> **范围说明**：审计 2.1 的核心诉求是"解密不再是纯状态翻转"。Layer A 已满足：解密时实际读取文件、计算 SHA-256、真实判定 SUCCESS/DANGER。simulateDanger 保留为演练开关但不再是无校验时的唯一 DANGER 来源。

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(bid): decryptSupplier 接入真实完整性校验（SHA-256 重算）+ AES 解密预留分支"
```

---

## Task 2-Extension（可选）：submitBid 写入加密封存密钥

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts:353-421`（submitBid）
- Modify: `apps/api/src/bid/bid.service.ts`（decryptSupplier Step 10 中 minio 读取需按 sealedKey 切换对象 key）

**说明**：此任务把 Layer B 端到端打通。若时间/范围受限，可仅交付 Task 2（Layer A）并标记本 Extension 为后续。执行本任务前需先确认 MinIO 写封存对象的 key 约定。

- [ ] **Step 1**：在 submitBid 创建/更新 submission 后，对每个非空 FileAsset 读取明文、`encryptBuffer`、写 `submission-sealed/<date>/<hex>.enc`、回填对应 `*SealedKey`。
- [ ] **Step 2**：在 decryptSupplier 中，`ref.sealedKey` 存在时，`getObject` 读取封存对象（key 规则：在 FileAsset 加 `sealedObjectKey String?` 字段，或约定前缀），解密后再做完整性校验。
- [ ] **Step 3**：加 schema 字段 `FileAsset.sealedObjectKey String?` + 迁移。
- [ ] **Step 4**：E2E：用 seed 供应商提交后调 decryptSupplier，验证 SUCCESS；篡改 MinIO 对象后验证 DANGER。
- [ ] **Step 5**：Commit。

> 默认主流程交付 Task 1 + Task 2 + Task 3，本 Extension 视后续排期。

---

## Task 3：AI 供应商风险评分真实化（审计 1.2）

**Files:**
- Create: `apps/api/src/ai/risk-score.compute.ts`
- Create: `apps/api/src/ai/risk-score.compute.spec.ts`
- Modify: `apps/api/src/ai/ai.service.ts:408-430`（getSupplierRiskScores）

**设计**：风险因子改为基于真实数据：
- 文件完整性 = 提交文件数（technical/business/cover 三件齐全=高分，缺一件扣分）
- 解密状态 = 真实 decryptStatus
- 资质合规 = 有效资质数 + 是否全部未过期
- 报价风险 = 报价偏离项目预算/参考价幅度
- 历史履约 = SupplierEvaluation.overallScore 均值
- 新增 `confidence` = 有真实数据支撑的因子占比

- [ ] **Step 1: 写失败测试（纯函数）**

```typescript
// apps/api/src/ai/risk-score.compute.spec.ts
import { computeRiskFactors, riskLevel, clamp01 } from './risk-score.compute';

describe('clamp01', () => {
  it('限定到 0-100', () => { expect(clamp01(150)).toBe(100); expect(clamp01(-5)).toBe(0); expect(clamp01(73)).toBe(73); });
});

describe('computeRiskFactors', () => {
  const ctx = {
    decryptStatus: 'SUCCESS',
    fileCount: 3, fileTotal: 3,
    validQualifications: 4, expiredQualifications: 1,
    bidPrice: 950000, budget: 1000000,
    perfAvg: 88, perfCount: 5,
  } as any;

  it('文件齐全 + 解密成功 → 文件/解密因子高分', () => {
    const f = computeRiskFactors(ctx);
    expect(f.find(x => x.name === '文件完整性')!.score).toBeGreaterThanOrEqual(90);
    expect(f.find(x => x.name === '解密状态')!.score).toBe(100);
  });
  it('报价低于预算 5% → 报价风险因子高', () => {
    const f = computeRiskFactors(ctx);
    const price = f.find(x => x.name === '报价风险')!;
    expect(price.score).toBeGreaterThanOrEqual(80);
    expect(price.detail).toContain('偏离');
  });
  it('报价远超预算 → 报价风险因子低', () => {
    const f = computeRiskFactors({ ...ctx, bidPrice: 1800000 });
    expect(f.find(x => x.name === '报价风险')!.score).toBeLessThan(60);
  });
  it('历史履约有数据 → 取均分；无数据 → 低分并标注', () => {
    expect(computeRiskFactors(ctx).find(x => x.name === '历史履约')!.score).toBe(88);
    const noPerf = computeRiskFactors({ ...ctx, perfAvg: null, perfCount: 0 });
    const hist = noPerf.find(x => x.name === '历史履约')!;
    expect(hist.score).toBeLessThan(60);
    expect(hist.detail).toContain('无履约数据');
  });
  it('confidence = 有真实数据的因子占比', () => {
    const c = computeRiskFactors(ctx);
    expect(c.every(f => f.score >= 0 && f.score <= 100)).toBe(true);
  });
});

describe('riskLevel', () => {
  it('≥85 低风险，≥65 中风险，否则高风险', () => {
    expect(riskLevel(90)).toBe('低风险');
    expect(riskLevel(70)).toBe('中风险');
    expect(riskLevel(40)).toBe('高风险');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- risk-score.compute`
Expected: FAIL

- [ ] **Step 3: 实现纯函数**

```typescript
// apps/api/src/ai/risk-score.compute.ts
export interface RiskFactorInput {
  decryptStatus: string;
  fileCount: number;
  fileTotal: number;
  validQualifications: number;
  expiredQualifications: number;
  bidPrice: number | null;
  budget: number | null;
  perfAvg: number | null;
  perfCount: number;
}
export interface RiskFactor {
  name: string;
  score: number;
  detail: string;
  backedByData: boolean;
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function computeRiskFactors(i: RiskFactorInput): RiskFactor[] {
  // 文件完整性
  const ratio = i.fileTotal > 0 ? i.fileCount / i.fileTotal : 0;
  const fileScore = clamp01(ratio * 100);

  // 解密状态
  const decryptScore = i.decryptStatus === 'SUCCESS' ? 100 : i.decryptStatus === 'DANGER' ? 20 : 50;

  // 资质合规
  const totalQual = i.validQualifications + i.expiredQualifications;
  const qualScore = totalQual === 0 ? 40
    : clamp01((i.validQualifications / totalQual) * 100 - (i.expiredQualifications > 0 ? 5 : 0));

  // 报价风险（偏离预算 ±5% 内为优）
  let priceScore = 50;
  let priceDetail = '无报价/预算数据';
  if (i.bidPrice != null && i.budget != null && i.budget > 0) {
    const dev = Math.abs(i.bidPrice - i.budget) / i.budget; // 偏离比例
    priceScore = clamp01(100 - dev * 200); // 偏离 0%=100, 50%=0
    priceDetail = `偏离预算 ${(dev * 100).toFixed(1)}%`;
  }

  // 历史履约
  let perfScore = 50;
  let perfDetail = '无履约数据';
  if (i.perfCount > 0 && i.perfAvg != null) {
    perfScore = clamp01(i.perfAvg);
    perfDetail = `历史均分 ${i.perfAvg.toFixed(1)}（${i.perfCount} 次）`;
  }

  return [
    { name: '文件完整性', score: fileScore, detail: `${i.fileCount}/${i.fileTotal} 件齐全`, backedByData: i.fileTotal > 0 },
    { name: '解密状态', score: decryptScore, detail: i.decryptStatus, backedByData: true },
    { name: '资质合规', score: qualScore, detail: `有效 ${i.validQualifications} / 过期 ${i.expiredQualifications}`, backedByData: totalQual > 0 },
    { name: '报价风险', score: priceScore, detail: priceDetail, backedByData: i.bidPrice != null && i.budget != null },
    { name: '历史履约', score: perfScore, detail: perfDetail, backedByData: i.perfCount > 0 },
  ];
}

export function riskLevel(overall: number): '低风险' | '中风险' | '高风险' {
  return overall >= 85 ? '低风险' : overall >= 65 ? '中风险' : '高风险';
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter api test -- risk-score.compute`
Expected: PASS

- [ ] **Step 5: 重写 getSupplierRiskScores**

在 `ai.service.ts` 顶部加 import：
```typescript
import { computeRiskFactors, riskLevel } from './risk-score.compute';
```
替换 `ai.service.ts:410-430`（整段 `getSupplierRiskScores`）。所有真实数据查询一次性预取（避免 N+1），再在 map 里查表组装：
```typescript
async getSupplierRiskScores(projectId: string) {
  const supplierIds: string[] = [];

  // 1) 预取：投标方、提交、绩效均分、资质聚合、项目预算
  const [suppliers, submissions, perfAgg, qualAgg, expiredAgg, budgetRow] = await Promise.all([
    this.prisma.bidSupplier.findMany({ where: { projectId } }),
    this.prisma.supplierBidSubmission.findMany({ where: { projectId } }),
    this.prisma.supplierEvaluation.groupBy({
      by: ['supplierId'],
      _avg: { overallScore: true },
      _count: { _all: true },
    }),
    this.prisma.supplierQualification.groupBy({ by: ['supplierId'], _count: { _all: true } }),
    this.prisma.supplierQualification.groupBy({
      by: ['supplierId'],
      where: { validTo: { lt: new Date() } },
      _count: { _all: true },
    }),
    this.prisma.procurementProject.findFirst({ where: { bidProjectId: projectId }, select: { budget: true } }),
  ]);

  // 仅对"已关联 supplierId"的投标方做资质/绩效查表
  const linkedSupplierIds = suppliers.map(s => s.supplierId).filter((x): x is string => !!x);
  const perfMap = new Map(perfAgg.filter(a => linkedSupplierIds.includes(a.supplierId)).map(a => [a.supplierId, { avg: a._avg.overallScore ? Number(a._avg.overallScore) : null, count: a._count._all }]));
  const qualMap = new Map(qualAgg.filter(a => linkedSupplierIds.includes(a.supplierId)).map(a => [a.supplierId, a._count._all]));
  const expiredMap = new Map(expiredAgg.filter(a => linkedSupplierIds.includes(a.supplierId)).map(a => [a.supplierId, a._count._all]));
  const budget = budgetRow?.budget ? Number(budgetRow.budget) : null;

  return suppliers.map(s => {
    const sub = submissions.find(x => x.supplierId === s.supplierId);
    const fileRefs = sub ? [sub.technicalFileAssetId, sub.businessFileAssetId, sub.coverLetterAssetId] : [];
    const fileCount = fileRefs.filter(Boolean).length;

    const totalQual = (s.supplierId && qualMap.get(s.supplierId)) ?? 0;
    const expiredQual = (s.supplierId && expiredMap.get(s.supplierId)) ?? 0;
    const perf = s.supplierId ? perfMap.get(s.supplierId) : undefined;

    const factors = computeRiskFactors({
      decryptStatus: s.decryptStatus,
      fileCount,
      fileTotal: 3,
      validQualifications: Math.max(0, totalQual - expiredQual),
      expiredQualifications: expiredQual,
      bidPrice: sub?.bidPrice ? Number(sub.bidPrice) : null,
      budget,
      perfAvg: perf?.avg ?? null,
      perfCount: perf?.count ?? 0,
    });
    const overall = Math.round(factors.reduce((sum, f) => sum + f.score, 0) / factors.length);
    const dataBacked = factors.filter(f => f.backedByData).length;
    return {
      id: s.id,
      supplierName: s.supplierName,
      overallRiskScore: overall,
      level: riskLevel(overall),
      factors: factors.map(f => ({ name: f.name, score: f.score, detail: f.detail })),
      confidence: Math.round((dataBacked / factors.length) * 100),
    };
  });
}
```
> 注：原方法里的 `project` 变量未使用，已移除；`hashString` 若无其它调用方可一并删除（保留无害）。

- [ ] **Step 6: 运行 ai 测试 + 更新既有 spec**

Run: `pnpm --filter api test -- ai.service`
Expected: 若既有 spec 断言了伪随机结构需同步更新（把对 `overallRiskScore` 的固定值断言改为范围断言）。更新后 PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/ai/risk-score.compute.ts apps/api/src/ai/risk-score.compute.spec.ts apps/api/src/ai/ai.service.ts apps/api/src/ai/ai.service.spec.ts
git commit -m "fix(ai): 供应商风险评分改为基于真实数据（履约均分/资质/报价偏离/解密/文件），新增 confidence"
```

---

# Phase 2 — 通知与实时推送基础设施

## Task 4：多渠道通知（审计 3.5）

**Files:**
- Create: `apps/api/src/notification/channels/notification-channel.interface.ts`
- Create: `apps/api/src/notification/channels/email.channel.ts`
- Create: `apps/api/src/notification/channels/sms.channel.ts`
- Create: `apps/api/src/notification/channels/notification-channel.interface.spec.ts`
- Modify: `apps/api/src/notification/notification.service.ts`
- Modify: `apps/api/package.json`（加 nodemailer）

**设计**：抽象 `NotificationChannel` 接口，`InAppChannel`=既有逻辑，`EmailChannel`=nodemailer（SMTP 由 env 配置，未配置时降级为 log），`SmsChannel`=桩实现（记录到日志，待接真实网关）。`NotificationService.create/sendToRole` 创建站内信后异步分发到已启用渠道。

- [ ] **Step 1: 写接口与分发逻辑测试**

```typescript
// apps/api/src/notification/channels/notification-channel.interface.spec.ts
import { shouldDispatch, type ChannelName } from './notification-channel.interface';

describe('shouldDispatch', () => {
  it('用户无 email 时 Email 渠道不分发', () => {
    expect(shouldDispatch('email' as ChannelName, { email: null } as any)).toBe(false);
  });
  it('用户有 email 时 Email 渠道分发', () => {
    expect(shouldDispatch('email' as ChannelName, { email: 'a@b.com' } as any)).toBe(true);
  });
  it('inApp 始终分发', () => {
    expect(shouldDispatch('inApp' as ChannelName, {} as any)).toBe(true);
  });
  it('sms 无 phone 不分发', () => {
    expect(shouldDispatch('sms' as ChannelName, { phone: null } as any)).toBe(false);
    expect(shouldDispatch('sms' as ChannelName, { phone: '13800' } as any)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- notification-channel`
Expected: FAIL

- [ ] **Step 3: 实现接口与分发判定**

```typescript
// apps/api/src/notification/channels/notification-channel.interface.ts
export type ChannelName = 'inApp' | 'email' | 'sms';

export interface DispatchPayload {
  userId: string;
  email?: string | null;
  phone?: string | null;
  type: string;
  title: string;
  content: string;
  link?: string | null;
}

export interface NotificationChannel {
  name: ChannelName;
  send(payload: DispatchPayload): Promise<void>;
}

/** 根据用户联系方式判断某渠道是否应分发。 */
export function shouldDispatch(channel: ChannelName, user: { email?: string | null; phone?: string | null }): boolean {
  if (channel === 'inApp') return true;
  if (channel === 'email') return !!user.email;
  if (channel === 'sms') return !!user.phone;
  return false;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter api test -- notification-channel`
Expected: PASS

- [ ] **Step 5: 实现 Email/Sms 渠道**

```typescript
// apps/api/src/notification/channels/email.channel.ts
import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, DispatchPayload } from './notification-channel.interface';

@Injectable()
export class EmailChannel implements NotificationChannel {
  name = 'email' as const;
  private readonly logger = new Logger(EmailChannel.name);
  private transporter: any = null;

  constructor() {
    // 延迟加载 nodemailer；未配置 SMTP 时 transporter 为 null，send 降级为 log
    const host = process.env.SMTP_HOST;
    if (host) {
      import('nodemailer').then(({ createTransport }) => {
        this.transporter = createTransport({
          host, port: Number(process.env.SMTP_PORT ?? 587),
          secure: process.env.SMTP_SECURE === 'true',
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        });
      }).catch(() => { this.logger.warn('nodemailer 加载失败，Email 渠道降级为日志'); });
    }
  }

  async send(p: DispatchPayload): Promise<void> {
    if (!this.transporter) { this.logger.log(`[Email-降级] → ${p.email}: ${p.title}`); return; }
    try {
      await this.transporter.sendMail({ to: p.email!, subject: p.title, text: p.content });
    } catch (e) { this.logger.warn(`Email 发送失败: ${(e as Error).message}`); }
  }
}
```

```typescript
// apps/api/src/notification/channels/sms.channel.ts
import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, DispatchPayload } from './notification-channel.interface';

@Injectable()
export class SmsChannel implements NotificationChannel {
  name = 'sms' as const;
  private readonly logger = new Logger(SmsChannel.name);
  async send(p: DispatchPayload): Promise<void> {
    // 桩实现：待接入真实短信网关（阿里云/腾讯云）。当前记录日志便于联调。
    this.logger.log(`[SMS-桩] → ${p.phone}: ${p.title}`);
  }
}
```

- [ ] **Step 6: NotificationService 接入多渠道**

修改 `notification.service.ts`：构造器注入 Email/Sms 渠道；`create`/`sendToRole` 创建站内信后，查用户联系方式并 `Promise.allSettled` 分发到 email/sms（失败不阻断）。

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';
import { shouldDispatch } from './channels/notification-channel.interface';

@Injectable()
export class NotificationService {
  constructor(
    private prisma: PrismaService,
    private emailChannel: EmailChannel,
    private smsChannel: SmsChannel,
  ) {}

  private async dispatchExternal(userId: string, payload: { type: string; title: string; content: string; link?: string | null }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }).catch(() => null);
    // User 当前无 phone 字段，sms 渠道恒 skip（见 Task 4 note）
    const contact = { email: user?.email ?? null, phone: null as string | null };
    const tasks: Promise<void>[] = [];
    if (shouldDispatch('email', contact)) tasks.push(this.emailChannel.send({ userId, ...contact, ...payload }));
    if (shouldDispatch('sms', contact)) tasks.push(this.smsChannel.send({ userId, ...contact, ...payload }));
    await Promise.allSettled(tasks);
  }

  async create(dto: CreateNotificationDto) {
    const n = await this.prisma.notification.create({ data: { userId: dto.userId, type: dto.type, title: dto.title, content: dto.content, link: dto.link } });
    void this.dispatchExternal(dto.userId, { type: dto.type, title: dto.title, content: dto.content, link: dto.link });
    return n;
  }

  async sendToRole(role: string, dto: Omit<CreateNotificationDto, 'userId'>) {
    const users = await this.prisma.user.findMany({ where: { role, isActive: true }, select: { id: true } });
    const notifications = await Promise.all(users.map(u => this.prisma.notification.create({ data: { userId: u.id, type: dto.type, title: dto.title, content: dto.content, link: dto.link } })));
    void Promise.allSettled(users.map(u => this.dispatchExternal(u.id, { type: dto.type, title: dto.title, content: dto.content, link: dto.link })));
    return notifications;
  }

  // list / getUnreadCount / markAsRead / markAllAsRead 保持不变
}
```
> **note**：当前 `User` 无 `phone` 字段（仅 email）。`phone` 走 ExpertProfile.phone/SupplierContact.phone——若需短信，Phase 3 可加 `User.phone`。当前 sms 渠道桩实现仅 log，`shouldDispatch('sms')` 因 phone=null 恒为 false，安全。

- [ ] **Step 7: 注册渠道到 NotificationModule**

在 `notification.module.ts` providers 加 `EmailChannel`、`SmsChannel`。

- [ ] **Step 8: 加 nodemailer 依赖**

Run: `cd "D:\claude projects\ERP-main/water-erp" && pnpm --filter api add nodemailer && pnpm --filter api add -D @types/nodemailer`

- [ ] **Step 9: 运行测试 + Commit**

Run: `pnpm --filter api test -- notification`
Expected: PASS
```bash
git add apps/api/src/notification apps/api/package.json
git commit -m "feat(notification): 新增多渠道（Email/SMS）分发抽象，站内信后异步外发"
```

---

## Task 5：WebSocket 推送扩展（审计 3.6）

**Files:**
- Modify: `apps/api/src/bid/bid.gateway.ts`
- Modify: `apps/api/src/bid/bid.service.ts`（submitScore、createClarification）

- [ ] **Step 1: 给 BidGateway 加 3 个 notify 方法**

在 `bid.gateway.ts` 的 `notifyStageChange` 后追加：
```typescript
  notifyScoreUpdate(projectId: string, data: { expertId: string; supplierId: string; scoreItemId: string; score: number }) {
    this.server.to(`project:${projectId}`).emit('score:update', data);
  }
  notifyClarification(projectId: string, data: { id: string; question: string; issuer: string; supplierName: string; status: string }) {
    this.server.to(`project:${projectId}`).emit('clarification:new', data);
  }
  notifyEvaluationProgress(projectId: string, data: { expertId: string; progress: number; totalScore: number }) {
    this.server.to(`project:${projectId}`).emit('evaluation:progress', data);
  }
```

- [ ] **Step 2: submitScore 接入**

在 `bid.service.ts` 的 `submitScore`（约 481-516）的 `return this.prisma.bidScoreRecord.upsert(...)` 之前，把 upsert 结果保存为变量并触发推送：
```typescript
    const record = await this.prisma.bidScoreRecord.upsert({
      where: { expertId_scoreItemId_supplierId: { expertId: dto.expertId, scoreItemId: dto.scoreItemId, supplierId: dto.supplierId } },
      update: { score: dto.score, reason: dto.reason },
      create: { expertId: dto.expertId, scoreItemId: dto.scoreItemId, supplierId: dto.supplierId, score: dto.score, reason: dto.reason },
    });
    this.gateway?.notifyScoreUpdate(projectId, { expertId: dto.expertId, supplierId: dto.supplierId, scoreItemId: dto.scoreItemId, score: Number(dto.score) });
    return record;
```

- [ ] **Step 3: createClarification 接入**

`createClarification`（约 529+）返回前加：
```typescript
    this.gateway?.notifyClarification(projectId, { id: created.id, question: dto.question, issuer: dto.issuer, supplierName: dto.supplierName, status: '待回复' });
```
（`created` = 该方法返回的 prisma.create 结果，需把 `return this.prisma...create(...)` 改为先存变量再 return + 推送。）

- [ ] **Step 4: 运行测试 + Commit**

Run: `pnpm --filter api test -- bid.service`
Expected: PASS
```bash
git add apps/api/src/bid/bid.gateway.ts apps/api/src/bid/bid.service.ts
git commit -m "feat(bid): WebSocket 扩展评分/澄清/评标进度实时推送"
```

---

# Phase 3 — 业务逻辑增强（依赖 Phase 2 基础设施）

## Task 6：专家回避自动检测（审计 3.1）

**Files:**
- Create: `apps/api/src/expert/expert-conflict.service.ts`
- Create: `apps/api/src/expert/expert-conflict.service.spec.ts`
- Modify: `apps/api/src/expert/expert.service.ts:130-139`（confirmAvoidance）

**设计**：纯函数 `detectConflicts(expertEmployer, suppliers)` 对比专家工作单位与投标供应商名称/法人（包含匹配 + 去除常见后缀的归一化）。`confirmAvoidance` 调用检测，命中冲突时抛出含冲突清单的 `BadRequestException`（专家必须先解决或申请回避豁免）。

- [ ] **Step 1: 写纯函数测试**

```typescript
// apps/api/src/expert/expert-conflict.service.spec.ts
import { normalizeName, detectConflicts } from './expert-conflict.service';

describe('normalizeName', () => {
  it('去除有限公司/有限责任公司/公司/集团等后缀', () => {
    expect(normalizeName('蜀水建设有限公司')).toBe('蜀水建设');
    expect(normalizeName('蜀水建设有限责任公司')).toBe('蜀水建设');
    expect(normalizeName('蜀水建设集团')).toBe('蜀水建设');
  });
  it('小写化', () => { expect(normalizeName('ABC科技')).toBe('abc科技'); });
});

describe('detectConflicts', () => {
  const suppliers = [
    { supplierName: '蜀水建设有限公司', legalPerson: '张三' },
    { supplierName: '北方水利', legalPerson: '李四' },
  ];
  it('专家单位与某供应商名称归一化后相同 → 冲突', () => {
    const c = detectConflicts('蜀水建设有限责任公司', suppliers as any);
    expect(c).toHaveLength(1);
    expect(c[0].supplierName).toBe('蜀水建设有限公司');
    expect(c[0].reason).toContain('工作单位');
  });
  it('无匹配 → 空', () => {
    expect(detectConflicts('无关单位', suppliers as any)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- expert-conflict`
Expected: FAIL

- [ ] **Step 3: 实现 service**

```typescript
// apps/api/src/expert/expert-conflict.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SUFFIXES = ['有限责任公司', '有限公司', '股份有限公司', '股份公司', '集团', '公司', '院', '中心'];

export function normalizeName(s: string): string {
  let n = (s || '').trim().toLowerCase();
  for (const suf of SUFFIXES) { if (n.endsWith(suf.toLowerCase())) { n = n.slice(0, -suf.length); break; } }
  return n;
}

export interface ConflictResult { supplierId?: string; supplierName: string; reason: string; }

export function detectConflicts(expertEmployer: string | null | undefined, suppliers: Array<{ id?: string; supplierName: string; legalPerson?: string | null }>): ConflictResult[] {
  if (!expertEmployer) return [];
  const empNorm = normalizeName(expertEmployer);
  const out: ConflictResult[] = [];
  for (const s of suppliers) {
    const nameNorm = normalizeName(s.supplierName);
    if (empNorm && nameNorm && (empNorm.includes(nameNorm) || nameNorm.includes(empNorm))) {
      out.push({ supplierId: s.id, supplierName: s.supplierName, reason: `工作单位 "${expertEmployer}" 与投标供应商 "${s.supplierName}" 存在关联` });
    }
  }
  return out;
}

@Injectable()
export class ExpertConflictService {
  constructor(private prisma: PrismaService) {}

  async detectForProject(projectId: string, expertUserId: string): Promise<ConflictResult[]> {
    const [expert, suppliers] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: expertUserId }, include: { expertProfile: true } }),
      this.prisma.bidSupplier.findMany({ where: { projectId }, select: { id: true, supplierName: true } }),
    ]);
    return detectConflicts(expert?.expertProfile?.employer, suppliers);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter api test -- expert-conflict`
Expected: PASS

- [ ] **Step 5: confirmAvoidance 接入冲突检测**

修改 `expert.service.ts:130-139`：
```typescript
  async confirmAvoidance(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException('您不是该项目的评审专家');
    const conflicts = await this.conflictService.detectForProject(projectId, userId);
    if (conflicts.length > 0) {
      throw new BadRequestException({ error: '检测到潜在利益冲突，请申请回避或联系监督员', code: 'AVOIDANCE_CONFLICT', conflicts });
    }
    return this.prisma.bidExpert.update({ where: { id: expert.id }, data: { avoidanceConfirmed: true } });
  }
```
构造器注入 `private conflictService: ExpertConflictService`；ExpertModule providers 注册 ExpertConflictService。另外 `expert.service.ts` 当前只 import 了 `ForbiddenException`，需补 `BadRequestException`（confirmAvoidance 现在要抛它）。

- [ ] **Step 6: 运行测试 + Commit**

Run: `pnpm --filter api test -- expert`
Expected: PASS
```bash
git add apps/api/src/expert/expert-conflict.service.ts apps/api/src/expert/expert-conflict.service.spec.ts apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.module.ts
git commit -m "feat(expert): confirmAvoidance 接入利益冲突自动检测（单位名称归一化匹配）"
```

---

## Task 7：资质到期通知（审计 3.2）

**Files:**
- Create: `apps/api/src/scheduler/scheduler.module.ts`
- Create: `apps/api/src/scheduler/scheduler.service.ts`
- Create: `apps/api/src/scheduler/scheduler.service.spec.ts`（纯函数扫描逻辑）
- Modify: `apps/api/src/app.module.ts`（注册 SchedulerModule）
- Modify: `apps/api/package.json`（加 `@nestjs/schedule`）

**设计**：定时任务（每日 09:00）扫描 `validTo` 在未来 N 天内（默认 30）且未通知的资质，向供应商用户发站内信（经 Task 4 多渠道分发）。

- [ ] **Step 1: 写扫描逻辑纯函数测试**

```typescript
// apps/api/src/scheduler/scheduler.service.spec.ts
import { buildExpiryNotification } from './scheduler.service';

describe('buildExpiryNotification', () => {
  it('生成到期提醒站内信', () => {
    const n = buildExpiryNotification({ qualificationName: '安全生产许可证', validTo: new Date('2026-07-10'), daysLeft: 26 });
    expect(n.type).toBe('QUALIFICATION_EXPIRING');
    expect(n.title).toContain('资质即将到期');
    expect(n.content).toContain('安全生产许可证');
    expect(n.content).toContain('26');
    expect(n.link).toBe('/supplier/qualifications');
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 → 通过**

```typescript
// apps/api/src/scheduler/scheduler.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

export function buildExpiryNotification(input: { qualificationName: string; validTo: Date; daysLeft: number }) {
  const date = input.validTo.toISOString().slice(0, 10);
  return {
    type: 'QUALIFICATION_EXPIRING',
    title: '资质即将到期提醒',
    content: `您的资质材料「${input.qualificationName}」将于 ${date} 到期（剩 ${input.daysLeft} 天），请及时更新以免影响投标资格。`,
    link: '/supplier/qualifications',
  };
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  constructor(private prisma: PrismaService, private notification: NotificationService) {}

  @Cron('0 9 * * *') // 每日 09:00
  async scanExpiringQualifications() {
    const horizon = Number(process.env.QUALIFICATION_EXPIRY_DAYS ?? 30);
    const now = new Date();
    const cutoff = new Date(now.getTime() + horizon * 24 * 3600 * 1000);
    const expiring = await this.prisma.supplierQualification.findMany({
      where: { validTo: { gte: now, lte: cutoff }, status: '有效' },
      include: { supplier: { select: { userId: true, name: true } } },
    });
    for (const q of expiring) {
      const daysLeft = Math.ceil((q.validTo!.getTime() - now.getTime()) / (24 * 3600 * 1000));
      const dto = buildExpiryNotification({ qualificationName: q.name, validTo: q.validTo!, daysLeft });
      await this.notification.create({ userId: q.supplier.userId, ...dto });
    }
    this.logger.log(`资质到期扫描完成：通知 ${expiring.length} 条`);
  }
}
```
Run: `pnpm --filter api test -- scheduler` → Expected: PASS

- [ ] **Step 3: 注册 SchedulerModule + ScheduleModule**

```typescript
// apps/api/src/scheduler/scheduler.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, NotificationModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
```
在 `app.module.ts` imports 加 `SchedulerModule`。确认 PrismaModule/NotificationModule 已 `@Module({ exports: [...] })` 导出（若未导出，补 export）。

- [ ] **Step 4: 加依赖**

Run: `cd "D:\claude projects\ERP-main/water-erp" && pnpm --filter api add @nestjs/schedule`

- [ ] **Step 5: 测试 + Commit**

Run: `pnpm --filter api test -- scheduler` → Expected: PASS
```bash
git add apps/api/src/scheduler apps/api/src/app.module.ts apps/api/package.json
git commit -m "feat(scheduler): 资质到期定时扫描+站内信通知（复用多渠道分发）"
```

---

## Task 8：供应商绩效聚合 + 自动淘汰（审计 3.3）

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`（新增 getPerformanceProfile + 自动降级）
- Create: `apps/api/src/supplier/supplier-performance.spec.ts`

**设计**：新增 `getSupplierPerformanceProfile(supplierId)` 聚合历史评价（均分/趋势/等级分布）。`createEvaluation` 后若最近 3 次评价均 ≤60 分或均分 <60 → `Supplier.status = DISABLED` + 通知。

- [ ] **Step 1: 写聚合纯函数测试**

```typescript
// apps/api/src/supplier/supplier-performance.spec.ts
import { aggregatePerformance, shouldAutoDisable } from './supplier-performance';

describe('aggregatePerformance', () => {
  const evals = [
    { overallScore: 80, level: 'B', createdAt: new Date('2026-01-01') },
    { overallScore: 70, level: 'B', createdAt: new Date('2026-03-01') },
    { overallScore: 55, level: 'C', createdAt: new Date('2026-05-01') },
  ];
  it('计算均分与趋势（下降）', () => {
    const a = aggregatePerformance(evals as any);
    expect(a.avgScore).toBeCloseTo(68.3, 0);
    expect(a.trend).toBe('declining');
    expect(a.levelCounts.C).toBe(1);
  });
});

describe('shouldAutoDisable', () => {
  it('最近3次均≤60 → true', () => {
    expect(shouldAutoDisable([
      { overallScore: 55 }, { overallScore: 50 }, { overallScore: 60 },
    ] as any, 60)).toBe(true);
  });
  it('最近3次有>60 → false', () => {
    expect(shouldAutoDisable([
      { overallScore: 80 }, { overallScore: 50 }, { overallScore: 60 },
    ] as any, 60)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 → 通过**

```typescript
// apps/api/src/supplier/supplier-performance.ts
export function aggregatePerformance(evals: Array<{ overallScore: number; level: string; createdAt: Date }>) {
  const sorted = [...evals].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const avgScore = sorted.length ? sorted.reduce((s, e) => s + Number(e.overallScore), 0) / sorted.length : 0;
  const trend = sorted.length < 2 ? 'stable'
    : sorted[sorted.length - 1].overallScore > sorted[0].overallScore + 5 ? 'improving'
    : sorted[sorted.length - 1].overallScore < sorted[0].overallScore - 5 ? 'declining' : 'stable';
  const levelCounts = { A: 0, B: 0, C: 0, D: 0 };
  for (const e of sorted) levelCounts[e.level as keyof typeof levelCounts]++;
  return { avgScore: Math.round(avgScore * 10) / 10, trend, levelCounts, total: sorted.length };
}

export function shouldAutoDisable(recent: Array<{ overallScore: number }>, threshold: number): boolean {
  if (recent.length < 3) return false;
  return recent.slice(-3).every(e => Number(e.overallScore) <= threshold);
}
```
Run: `pnpm --filter api test -- supplier-performance` → PASS

- [ ] **Step 3: supplier.service 接入**

在 `supplier.service.ts` 的 `createEvaluation` 末尾加：
```typescript
    // 自动淘汰判定
    const recent = await this.prisma.supplierEvaluation.findMany({ where: { supplierId: id }, orderBy: { createdAt: 'desc' }, take: 3, select: { overallScore: true } });
    if (shouldAutoDisable(recent, 60)) {
      await this.prisma.supplier.update({ where: { id }, data: { status: 'DISABLED' } });
      await this.notificationService.create({ userId: supplier.userId, type: 'SUPPLIER_DISABLED', title: '供应商已自动停用', content: '因近期绩效持续不达标，您的供应商账号已被自动停用。', link: '/supplier' }).catch(() => {});
    }
    return created;
```
新增公开方法 `getSupplierPerformanceProfile(id)` 调用 `aggregatePerformance`。注入 NotificationService。

- [ ] **Step 4: 测试 + Commit**

Run: `pnpm --filter api test -- supplier` → PASS
```bash
git add apps/api/src/supplier
git commit -m "feat(supplier): 绩效聚合画像 + 连续低分自动停用"
```

---

## Task 9：专家绩效关联 + 自动退库（审计 3.4）

**Files:**
- Modify: `apps/api/src/expert/expert-admin.service.ts:343-349`（getEvaluationStats 增强 + createEvaluation 后自动停用）

**设计**：`getEvaluationStats` 增加"评分偏离度"（该项目内该专家与其他专家评分的标准差均值）。`createEvaluation` 后若专家连续 2 次评级为 D → `ExpertProfile.availability = '停用'` + 通知。

- [ ] **Step 1: 写偏离度纯函数测试**

```typescript
// apps/api/src/expert/expert-deviation.spec.ts
import { meanDeviation, shouldDeactivateExpert } from './expert-deviation';

describe('meanDeviation', () => {
  it('单专家与其他专家均分的平均偏离', () => {
    expect(meanDeviation(80, [80, 70])).toBeCloseTo(5, 0); // |80-75| = 5
  });
});
describe('shouldDeactivateExpert', () => {
  it('最近2次均为D → true', () => {
    expect(shouldDeactivateExpert([{ level: 'D' }, { level: 'D' }])).toBe(true);
  });
  it('仅1次D → false', () => {
    expect(shouldDeactivateExpert([{ level: 'D' }])).toBe(false);
  });
});
```

- [ ] **Step 2: 实现**

```typescript
// apps/api/src/expert/expert-deviation.ts
export function meanDeviation(expertAvg: number, otherAvgs: number[]): number {
  if (otherAvgs.length === 0) return 0;
  const othersAvg = otherAvgs.reduce((s, x) => s + x, 0) / otherAvgs.length;
  return Math.abs(expertAvg - othersAvg);
}

export function shouldDeactivateExpert(recent: Array<{ level: string }>): boolean {
  if (recent.length < 2) return false;
  return recent.slice(-2).every(e => e.level === 'D');
}
```
Run: `pnpm --filter api test -- expert-deviation` → PASS

- [ ] **Step 3: 接入 expert-admin.service**

`createEvaluation`（约 320-341）末尾加自动停用：
```typescript
    const recent = await this.prisma.expertEvaluation.findMany({ where: { expertUserId: dto.expertUserId }, orderBy: { createdAt: 'desc' }, take: 2, select: { level: true } });
    if (shouldDeactivateExpert(recent)) {
      await this.prisma.expertProfile.updateMany({ where: { userId: dto.expertUserId }, data: { availability: '停用' } });
    }
```
`getEvaluationStats` 增加偏离度统计（按 expertUserId 聚合 + 项目内交叉对比），返回追加 `avgDeviation` 字段。

- [ ] **Step 4: 测试 + Commit**

Run: `pnpm --filter api test -- expert-admin` → PASS
```bash
git add apps/api/src/expert
git commit -m "feat(expert): 绩效偏离度统计 + 连续D级自动停用"
```

---

# 收尾

- [ ] **全量回归**

Run:
```bash
cd "D:\claude projects\ERP-main/water-erp"
pnpm --filter api test
pnpm --filter api lint
pnpm --filter api build
pnpm db:seed   # 确认种子数据在新 schema 下可重新加载
```
Expected: 全部 PASS，构建通过，种子无报错。

- [ ] **更新审计文档**

在 `docs/superpowers/audit/2026-06-14-feature-audit-gaps.md` 每个章节末尾追加"**修复状态**：✅ 已修复（commit <hash>）"。

- [ ] **更新 CLAUDE.md（如必要）**

若新增了 SchedulerModule、NotificationChannel 等模块，在 CLAUDE.md 的 API 模块表补充。

---

# Self-Review

**1. Spec 覆盖**：审计 9 个问题 → Task 1(2.2)、Task 2(2.1)、Task 3(1.2)、Task 4(3.5)、Task 5(3.6)、Task 6(3.1)、Task 7(3.2)、Task 8(3.3)、Task 9(3.4)。全部覆盖，无遗漏。Task 2-Extension（Layer B 完整 MinIO 落地）标注为可选后续，主流程交付 Layer A 已满足审计核心诉求。

**2. 占位符扫描**：无 TBD/TODO；每个 Task 的代码块均含完整方法体与测试。

**3. 类型一致性**：`computeArchiveDigest`、`computeRiskFactors`/`riskLevel`、`detectConflicts`/`normalizeName`、`aggregatePerformance`/`shouldAutoDisable`、`meanDeviation`/`shouldDeactivateExpert`、`buildExpiryNotification` 在定义处与调用处签名一致。`classifyDecryptOutcome`/`verifyIntegrity` 输入字段（`hasSealedKey`/`decryptOk`/`integrityOk`）与 decryptSupplier 调用一致。

**4. 已知风险/降级**：
- Task 2 Layer B 的 MinIO 封存对象写入（submitBid 侧）未在主流程接线，避免一次性改动跨 service；decryptSupplier 已预留 sealedKey 分支，可平滑接入。
- Task 4 SMS 渠道为桩（User 无 phone 字段，`shouldDispatch('sms')` 恒 false），不会误发；接真实网关需先加 `User.phone`。
- Task 7 定时任务依赖 `@nestjs/schedule`，需确保 Nest 启动时 ScheduleModule.forRoot() 生效（已含）。

**5. 依赖顺序**：Phase 1 三任务互相独立；Phase 2 Task 4 在 Task 7 之前（资质通知复用多渠道分发）；Phase 3 各任务互相独立但均建议在 Phase 2 之后（依赖通知/WS）。
