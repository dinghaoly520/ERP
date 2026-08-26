# 唱标内容与投递内容一致性对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复唱标内容与供应商投递内容不一致的四项缺口：①唱标工期与投递工期无一致性校验（报价有 P1-4、工期没有）；②唱标「质量目标」为增项（供应商投递时从未提交质量承诺，唱标预填的是项目级 qualityRequirement）；③保证金无「不适用/免缴」档（bondRequired=false 仍必填四选一）；④供应商确认页看不到投递原值对比（无法核对唱标是否有误）。

**Architecture:** ①后端新增 `assertPeriodMatchesSubmitted`（P1-4 同构，409 PERIOD_MISMATCH + confirmSealedPeriod 确认流），比对口径抽为纯函数 `opening-compare.util.ts`（唱标录入校验与供应商回显两端同源）；②`SupplierBidSubmission` 新增 `qualityCommitment` 列，投递端可填，唱标预填优先供应商承诺、回退项目质量要求；③共享枚举 `BOND_STATUS` 增加「不适用」，后端草稿接口按 `bondRequired` 下发 `bondNotApplicable` 提示，前端默认选中；④`getMyOpeningRecord` 富化返回本人投递原值（报价解封仅限本人）+ mismatch 标志，供应商大厅回显对比。

**Tech Stack:** NestJS 11 + Prisma（后端）；Vue 3 + Element Plus（供应商门户）；Next.js 16（开评标管理端）；`@water-erp/shared`（共享枚举）。

**Spec:** 本计划即需求载体（无独立 spec 文档）。依据：《电子招标投标办法》第30条（唱标内容应为解密后投标文件所载内容，供所有投标人核对）；唱标内容 = 投标文件主要内容（名称/报价/工期/质量/保证金），不得增项、不得缺漏。上游审计结论（四项）见会话。

## Global Constraints

- **报价密封原则不变**：`bidPrice` 入库/回显仍走 `sealField`/`openField`（`KMS_SECRET`）；任何端点不得明文下发他人报价——④ 的报价解封仅限**本人**投递（P2 既有口径，supplier-portal.service.ts:1081/:1100 同模式）。
- **deliveryPeriod 明文存储不变**（本计划不为其加密封）。
- **迁移纪律**（memory `main-db-migration-drift`）：`prisma migrate dev --create-only` → **人工审查生成的 SQL**（勿让 diff 重生成 OperationLog 分区 PK / 超集索引 / pgvector 相关 DDL；若混入，只保留本次 ADD COLUMN 行）→ `prisma db execute` → `migrate resolve --applied`。**禁用 `migrate deploy`**。
- **错误形状**：统一 `{ error, code }`；409 `ConflictException` 附 `expected`/`entered` 供前端弹确认；单测断言 `.rejects.toMatchObject({ response: { code, expected, entered } })`。
- **监督日志口径**：`result` 拼接 `priceNote + periodNote`，`riskFlag` 任一 note 非空 → `'中'`；**两处写入必须同步改**（事务内 `tx.bidSupervisionLog.create` + 事务外 `gateway.notifySupervisionLog`，bid.service.ts enterOpeningRecord）。
- **shared 包改动后**（Task 3）：重建 `@water-erp/shared` + 清 `apps/supplier-portal/node_modules/.vite` + 重启 dev server（memory `vite-dep-cache-workspace-packages`：workspace 包改动不清缓存不生效）。
- **验证命令**：API 单测 `pnpm --filter api test -- <spec>`；bid-portal 无 eslint（基建在未合并分支）→ `npx tsc --noEmit`；supplier-portal → `npx vue-tsc --noEmit`（不可用则 `pnpm --filter supplier-portal build`）。
- 唱标记录表 / CSV 字段名 **不变**（`qualityTarget` 列名保留，仅 UI 文案改「质量承诺」）——避免破坏已存的开标文件包 JSON 结构。

## 设计决策（待审核确认）

1. **工期比对口径**：工期为自由文本（如「120日历天」「180 天」），无统一单位 → 去全部空白后**精确相等**才算一致，不做数值归一（与报价的万元/元归一不同）；不一致 → 409 `PERIOD_MISMATCH` → 主持人确认后重试（与报价校验**双确认流**：先报价后工期，各自独立 409 → 确认 → 重试，flag 互不丢失）。
2. **质量承诺选填**：投递端新增 `qualityCommitment` 为**选填**（不强制——避免破坏既有投递与种子数据）；唱标预填优先供应商承诺、回退项目 `qualityRequirement`。若业务后续要求强制填写，仅需 preflight 加 required 项（未纳入本方案）。
3. **保证金「不适用」**：仅当 `bondRequired=false` 时由后端草稿接口下发 `bondNotApplicable=true`，前端**默认选中**「不适用」（仍可改选）；枚举追加在选项**末尾**（既有四档顺序不变）。`isBondQualified` 不含「不适用」，但该闸门仅在 `bondRequired` 时求值（bid.service.ts:3190-3208），语义安全。
4. **回显 mismatch 由后端计算**：`opening-compare.util.ts` 为唱标录入校验与供应商回显的**单一来源**，前端只渲染（避免前后端两套归一逻辑漂移）。未唱标时接口返回 `{ submitted }`（仅本司投递原值，不暴露他人）。

---

### Task 1: 工期一致性校验（后端 util + PERIOD_MISMATCH + 前端双确认流）

**Files:**
- Create: `apps/api/src/bid/opening-compare.util.ts`（纯函数比对 util）
- Create: `apps/api/src/bid/opening-compare.util.spec.ts`（util 单测）
- Modify: `apps/api/src/bid/dto/create-opening-record.dto.ts`（+confirmSealedPeriod）
- Modify: `apps/api/src/bid/bid.service.ts`（assertPriceMatchesSealed 改用 util；新增 assertPeriodMatchesSubmitted；enterOpeningRecord 调用 + 日志拼接）
- Test: `apps/api/src/bid/bid.service.spec.ts`（P1-4 块之后追加 4 用例）
- Modify: `apps/bid-portal/src/lib/api/bid.ts`（body 类型 +confirmSealedPeriod）
- Modify: `apps/bid-portal/src/components/opening-hall.tsx`（handleEnterRecord 双确认流）

**Interfaces:**
- Produces: `resolveExpectedInYuan(expectedStr?, enteredStr?): number | null`、`isPriceMismatch(expectedInYuan, enteredStr?): boolean`、`isPeriodMismatch(expectedStr?, enteredStr?): boolean`（Task 4 复用）；DTO 字段 `confirmSealedPeriod?: boolean`。

- [ ] **Step 1: 创建比对 util**

`apps/api/src/bid/opening-compare.util.ts`：

```ts
/**
 * 唱标 vs 投递 一致性比对的纯函数（单一来源）：
 * - 报价：P1-13 万元/元归一 + ±0.5% 容差（与 assertPriceMatchesSealed 原内联逻辑同口径）
 * - 工期：自由文本去全部空白后精确比对（工期无单位体系，不做数值归一）
 * bid.service（唱标录入校验）与 supplier-portal.service（供应商确认页回显）共用，
 * 保证两端「不一致」判定永远同源。
 */

/** 投递价（万元或元）归一为元后返回；任一值不可解析 → null（调用方跳过校验）。 */
export function resolveExpectedInYuan(
  expectedStr?: string | number | null,
  enteredStr?: string | number | null,
): number | null {
  const expected = Number(String(expectedStr ?? '').replace(/,/g, ''));
  const entered = Number(String(enteredStr ?? '').replace(/,/g, ''));
  if (!Number.isFinite(expected) || !Number.isFinite(entered)) return null;
  // P1-13：供应商投递表单单位「万元」（79.8），唱标录入单位「元」（798000）。
  // 金额比 >100 且 entered≈expected×10000（±0.5%）视为同一报价。
  if (Math.abs(expected - entered) > 0.005
      && entered > expected * 100
      && Math.abs(entered - expected * 10000) <= Math.max(entered, expected * 10000) * 0.005) {
    return expected * 10000;
  }
  return expected;
}

/** 唱标录入价与投递密封价（已解封、可能万元/元）是否实质不一致（±0.5% 容差）。 */
export function isPriceMismatch(expectedInYuan: number | null, enteredStr?: string | number | null): boolean {
  const entered = Number(String(enteredStr ?? '').replace(/,/g, ''));
  if (expectedInYuan == null || !Number.isFinite(entered)) return false;
  return Math.abs(expectedInYuan - entered) > Math.max(expectedInYuan, entered) * 0.005;
}

/** 工期不一致：去全部空白后精确比对；任一侧缺失/空白 → false（不校验，向后兼容）。 */
export function isPeriodMismatch(expectedStr?: string | null, enteredStr?: string | null): boolean {
  const expected = (expectedStr ?? '').replace(/\s+/g, '');
  const entered = (enteredStr ?? '').replace(/\s+/g, '');
  if (!expected || !entered) return false;
  return expected !== entered;
}
```

- [ ] **Step 2: util 单测（先测后实现顺序——util 已实现，此步为防回归护栏）**

`apps/api/src/bid/opening-compare.util.spec.ts`：

```ts
import { resolveExpectedInYuan, isPriceMismatch, isPeriodMismatch } from './opening-compare.util';

describe('opening-compare.util', () => {
  it('resolveExpectedInYuan：万元投递价归一为元（79.8 vs 798000）', () => {
    expect(resolveExpectedInYuan('79.8', '798000')).toBe(798000);
  });
  it('resolveExpectedInYuan：同单位不做放大（950000 vs 980000 → 950000）', () => {
    expect(resolveExpectedInYuan('950000', '980000')).toBe(950000);
  });
  it('resolveExpectedInYuan：不可解析 → null', () => {
    expect(resolveExpectedInYuan(null, '980000')).toBeNull();
    expect(resolveExpectedInYuan('abc', '980000')).toBeNull();
  });
  it('isPriceMismatch：真实差异 → true（950000 vs 980000）', () => {
    expect(isPriceMismatch(resolveExpectedInYuan('950000', '980000'), '980000')).toBe(true);
  });
  it('isPriceMismatch：万元/元同一报价 → false', () => {
    expect(isPriceMismatch(resolveExpectedInYuan('79.8', '798000'), '798000')).toBe(false);
  });
  it('isPeriodMismatch：空白差异视为一致（"120 日历天" vs "120日历天"）', () => {
    expect(isPeriodMismatch('120 日历天', '120日历天')).toBe(false);
  });
  it('isPeriodMismatch：实质差异 → true；任一侧缺失 → false', () => {
    expect(isPeriodMismatch('120 日历天', '90 日历天')).toBe(true);
    expect(isPeriodMismatch(null, '90 日历天')).toBe(false);
    expect(isPeriodMismatch('', '90 日历天')).toBe(false);
  });
});
```

- [ ] **Step 3: 运行 util 单测**

```bash
cd water-erp && pnpm --filter api test -- opening-compare.util.spec
```

Expected: 7 个用例全 PASS。

- [ ] **Step 4: DTO 增加 confirmSealedPeriod**

`apps/api/src/bid/dto/create-opening-record.dto.ts`，在 `confirmSealedPrice` 之后追加：

```ts
  /** P1-4 同构：录入工期与投标投递工期不一致时，主持人显式确认按录入值唱标（前端经 409 确认后回传） */
  @IsBoolean()
  @IsOptional()
  confirmSealedPeriod?: boolean;
```

- [ ] **Step 5: 写失败测试（bid.service.spec.ts）**

在 P1-4 测试块之后（约 :2560，`密封报价缺失（null）` 用例后）追加：

```ts
  // ── 工期一致性校验（P1-4 同构；deliveryPeriod 明文，无需 KMS）──
  it('工期与投递不一致且未确认 → 409 PERIOD_MISMATCH（附 expected/entered）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 's1' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: null, deliveryPeriod: '180天' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);

    await expect(service.enterOpeningRecord('p1', { ...dto, period: '90天' } as any)).rejects.toMatchObject({
      response: { code: 'PERIOD_MISMATCH', expected: '180天', entered: '90天' },
    });
    expect(prisma.bidOpeningRecord.upsert).not.toHaveBeenCalled();
  });

  it('工期不一致但 confirmSealedPeriod=true → 按录入值落库且监督日志注明差异', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 's1' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: null, deliveryPeriod: '180天' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
    prisma.bidOpeningRecord.upsert.mockResolvedValue({ id: 'r2' });
    prisma.bidSupervisionLog.create.mockResolvedValue({});

    const res = await service.enterOpeningRecord('p1', { ...dto, period: '90天', confirmSealedPeriod: true } as any);
    expect(res).toBeDefined();
    expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ period: '90天' }),
    }));
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ result: expect.stringContaining('180天') }),
    }));
  });

  it('工期空白差异归一（投递 "120 日历天" vs 录入 "120日历天"）→ 视为一致', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 's1' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: null, deliveryPeriod: '120 日历天' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
    prisma.bidOpeningRecord.upsert.mockResolvedValue({ id: 'r1' });

    await expect(service.enterOpeningRecord('p1', { ...dto, period: '120日历天' } as any)).resolves.toBeDefined();
  });

  it('投递记录无工期（legacy）→ 跳过校验', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 's1' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: null, deliveryPeriod: null });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
    prisma.bidOpeningRecord.upsert.mockResolvedValue({ id: 'r1' });

    await expect(service.enterOpeningRecord('p1', dto as any)).resolves.toBeDefined();
  });
```

（`dto` const 在 :2406，`period: '180天'`；`prisma.bidSupplier.findUnique` 基座 mock 已存在（:114），P1-4 用例同款赋值。）

- [ ] **Step 6: 运行确认 4 个新用例失败**

```bash
cd water-erp && pnpm --filter api test -- bid.service.spec
```

Expected: 4 个新用例 FAIL（工期不一致却未抛 409）；P1-4 既有用例仍 PASS。

- [ ] **Step 7: 实现后端校验**

`apps/api/src/bid/bid.service.ts`：

(a) 文件顶部 import 区（`openField` 等 import 附近）加：

```ts
import { isPeriodMismatch, isPriceMismatch, resolveExpectedInYuan } from './opening-compare.util';
```

(b) 重构 `assertPriceMatchesSealed`（:2775-2811）——比对部分改用 util，行为等价（既有 P1-4/P1-13 测试为护栏）：

```ts
    const sealed = sub?.bidPrice ? openField(sub.bidPrice, process.env.KMS_SECRET!) : null;
    if (sealed == null) return null;
    // P1-13 归一 + 容差比对统一走 opening-compare.util（供应商端回显同源）
    const expectedInYuan = resolveExpectedInYuan(sealed, amount);
    if (isPriceMismatch(expectedInYuan, amount)) {
      if (!confirmed) {
        throw new ConflictException({
          error: `录入报价 ${Number(String(amount).replace(/,/g, ''))} 与投标文件密封报价 ${expectedInYuan} 不一致；如确认以录入值为准，请勾选「确认按录入值唱标」后重试`,
          code: 'PRICE_MISMATCH',
          expected: expectedInYuan,
          entered: Number(String(amount).replace(/,/g, '')),
        });
      }
      return `（与密封报价 ${expectedInYuan} 不一致，主持人确认按录入值唱标）`;
    }
    return null;
```

（删除原 `const expected = ...` / `const entered = ...` / `!Number.isFinite` 三行——`resolveExpectedInYuan` 返回 null 时 `isPriceMismatch` 返回 false，与原「不可解析 → 不校验」行为一致。）

(c) 在 `assertPriceMatchesSealed` 之后新增：

```ts
  /**
   * 工期一致性校验（P1-4 同构，2026-08-17）：唱标录入工期与投递提交工期（deliveryPeriod 明文）
   * 去空白后精确比对，不一致且未显式确认 → 409 PERIOD_MISMATCH（附 expected/entered 供前端弹确认）；
   * 投递无工期（legacy）→ 不校验。返回不一致说明供监督日志拼接（一致时 null）。
   */
  private async assertPeriodMatchesSubmitted(
    projectId: string,
    bidSupplierId: string,
    period: string,
    confirmed?: boolean,
  ): Promise<string | null> {
    const bs = await this.prisma.bidSupplier.findUnique({ where: { id: bidSupplierId }, select: { supplierId: true } });
    if (!bs?.supplierId) return null;
    const sub = await this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId: bs.supplierId, projectId } },
      select: { deliveryPeriod: true },
    });
    if (!sub?.deliveryPeriod || !isPeriodMismatch(sub.deliveryPeriod, period)) return null;
    if (!confirmed) {
      throw new ConflictException({
        error: `录入工期 ${period} 与投标文件投递工期 ${sub.deliveryPeriod} 不一致；如确认以录入值为准，请勾选「确认按录入值唱标」后重试`,
        code: 'PERIOD_MISMATCH',
        expected: sub.deliveryPeriod,
        entered: period,
      });
    }
    return `（与投递工期 ${sub.deliveryPeriod} 不一致，主持人确认按录入值唱标）`;
  }
```

(d) `enterOpeningRecord`（:2838 之后，`priceNote` 行下）加：

```ts
    // P1-4 同构：与投递工期比对（误录工期一路进评标/公示的防线）
    const periodNote = await this.assertPeriodMatchesSubmitted(projectId, bidSupplier.id, dto.period, dto.confirmSealedPeriod);
```

(e) 监督日志拼接（**两处**：事务内 `tx.bidSupervisionLog.create` 与事务外 `gateway.notifySupervisionLog`，`result: \`报价 ${dto.amount} / 工期 ${dto.period}${priceNote ?? ''}\``）：

```ts
result: `报价 ${dto.amount} / 工期 ${dto.period}${priceNote ?? ''}${periodNote ?? ''}`,
riskFlag: priceNote || periodNote ? '中' : '无',
```

- [ ] **Step 8: 运行全量 bid.service.spec**

```bash
cd water-erp && pnpm --filter api test -- bid.service.spec
```

Expected: 全部 PASS（4 个新用例转绿；P1-4/P1-13 既有用例验证重构无回归）。

- [ ] **Step 9: 前端双确认流**

`apps/bid-portal/src/lib/api/bid.ts`（:85-90 body 类型）：

```ts
export function enterOpeningRecord(projectId: string, body: {
  bidSupplierId: string; amount: string; period: string; qualityTarget: string; bondStatus: string;
  /** P1-4：录入价与密封报价不一致时的主持人显式确认（409 PRICE_MISMATCH 后回传） */
  confirmSealedPrice?: boolean;
  /** P1-4 同构：录入工期与投递工期不一致时的主持人显式确认（409 PERIOD_MISMATCH 后回传） */
  confirmSealedPeriod?: boolean;
}) {
```

`apps/bid-portal/src/components/opening-hall.tsx` `handleEnterRecord`（:296-319）替换为：

```tsx
  const handleEnterRecord = async (confirmSealedPrice = false, confirmSealedPeriod = false) => {
    if (!projectId || !recordEntry) return;
    const { amount, period, qualityTarget, bondStatus } = recordDraft;
    if (!amount.trim() || !period.trim() || !qualityTarget.trim() || !bondStatus.trim()) {
      toast.error('请完整填写唱标信息'); return;
    }
    try {
      await enterOpeningRecord(projectId, { bidSupplierId: recordEntry.bidSupplierId, amount, period, qualityTarget, bondStatus, confirmSealedPrice: confirmSealedPrice || undefined, confirmSealedPeriod: confirmSealedPeriod || undefined });
      toast.success('唱标信息已录入，待供应商确认');
      setRecordEntry(null);
      onRefresh();
    } catch (e: any) {
      // M9：唱标重录对锁定态记录后端返回 409 code=RECORD_LOCKED
      if (e?.code === 'RECORD_LOCKED') { toast.error('该开标记录已锁定，无法重录'); return; }
      // P1-4：录入价与投标文件密封报价不一致——主持人显式确认后带 flag 重试（保留工期 flag 状态）
      if (e?.code === 'PRICE_MISMATCH' && !confirmSealedPrice) {
        if (window.confirm(`${e?.message ?? '录入报价与密封报价不一致'}\n\n是否确认按录入值唱标？（差异将记入监督日志）`)) {
          void handleEnterRecord(true, confirmSealedPeriod);
        }
        return;
      }
      // 工期一致性校验（P1-4 同构）：录入工期与投递工期不一致——确认后带 flag 重试（保留报价 flag 状态）
      if (e?.code === 'PERIOD_MISMATCH' && !confirmSealedPeriod) {
        if (window.confirm(`${e?.message ?? '录入工期与投递工期不一致'}\n\n是否确认按录入值唱标？（差异将记入监督日志）`)) {
          void handleEnterRecord(confirmSealedPrice, true);
        }
        return;
      }
      toast.error(e?.message || '录入失败');
    }
  };
```

- [ ] **Step 10: 类型检查**

```bash
cd water-erp/apps/bid-portal && npx tsc --noEmit
```

Expected: 0 error。

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/bid/opening-compare.util.ts apps/api/src/bid/opening-compare.util.spec.ts apps/api/src/bid/dto/create-opening-record.dto.ts apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts apps/bid-portal/src/lib/api/bid.ts apps/bid-portal/src/components/opening-hall.tsx
git commit -m "feat(bid): 唱标工期一致性校验——PERIOD_MISMATCH 409 + confirmSealedPeriod 确认流（P1-4 同构）"
```

---

### Task 2: 投递端质量承诺字段（qualityCommitment）——唱标「质量目标」改口径

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（SupplierBidSubmission +qualityCommitment）
- Create: 迁移（CLI create-only 生成，人工审查 SQL 后 apply）
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（BidSubmissionData + pickBidSubmissionFields）
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`（draft/submit 两处 inline body 类型）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`（submitBid describe 内 1 用例）
- Modify: `apps/api/src/bid/bid.service.ts`（getOpeningRecordDraft：select + qualityTarget 来源）
- Modify: `apps/supplier-portal/src/views/bid/BidSubmit.vue`（表单字段 + 回填 + preflight）
- Modify: `apps/bid-portal/src/components/opening-hall.tsx`（弹窗标签「质量目标」→「质量承诺」+ 表头「质量」→「质量承诺」）

**Interfaces:**
- Consumes: 无（利用 Task 1 已合并的 util 无依赖；本任务独立）
- Produces: `SupplierBidSubmission.qualityCommitment String?`（DB 列）；`pickBidSubmissionFields` 输出含 `qualityCommitment`；`getOpeningRecordDraft().qualityTarget` 来源 = `submission.qualityCommitment || project.qualityRequirement`；投递 body `{ qualityCommitment?: string }`（draft 与 submit 两路由）。

- [ ] **Step 1: schema + 迁移（create-only → 人工审查 → apply）**

`apps/api/prisma/schema.prisma`，`model SupplierBidSubmission`（:1353-1383）内 `deliveryPeriod String?` 之后加：

```prisma
  qualityCommitment     String?   // 供应商投递的质量承诺（2026-08-17）：唱标「质量目标」改自此取，缺失回退项目 qualityRequirement
```

生成迁移：

```bash
cd water-erp/apps/api && npx prisma migrate dev --create-only --name add_bid_submission_quality_commitment
```

**人工审查** `apps/api/prisma/migrations/<时间戳>_add_bid_submission_quality_commitment/migration.sql`：
- 必须仅含一行 `ALTER TABLE "SupplierBidSubmission" ADD COLUMN "qualityCommitment" TEXT;`（对齐文件内既有列类型风格）；
- 若 diff 混入 OperationLog 分区 PK / 超集索引 / pgvector 相关 DDL（memory `main-db-migration-drift` 的 4 处刻意偏离），**删除无关行**只保留 ADD COLUMN。

执行并标记：

```bash
cd water-erp/apps/api && npx prisma db execute --file prisma/migrations/<时间戳>_add_bid_submission_quality_commitment/migration.sql
npx prisma migrate resolve --applied <时间戳>_add_bid_submission_quality_commitment
cd .. && pnpm db:generate
```

（schema 变更后需重启 API dev，否则 Prisma Client 不知新列——`pnpm dev` 的 watch 会重编，但稳妥起见按 memory `stale-dev-servers-eaddrinuse` 处理端口。）

- [ ] **Step 2: 写失败测试（supplier-portal.service.spec.ts）**

`submitBid` describe 内（「放宽门控：OPENING 阶段 → 400」用例后，:300 附近）追加：

```ts
    it('提交时落库质量承诺（qualityCommitment）', async () => {
      prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', projectCode: 'BID-X', stage: 'DOWNLOAD',
        deadline: new Date(Date.now() + 3600_000),
      });
      prisma.announcement.findFirst.mockResolvedValue({ id: 'notice-1' });
      prisma.supplierBidSubmission.create.mockResolvedValue({ id: 'sub-2', status: 'submitted' });
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      prisma.bidSupplier.create.mockResolvedValue({ id: 'bs-2' });

      await service.submitBid('supplier-1', 'project-1', { bidPrice: '100', qualityCommitment: '满足招标文件要求，一次验收合格' } as any);

      expect(prisma.supplierBidSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ qualityCommitment: '满足招标文件要求，一次验收合格' }) }),
      );
    });
```

- [ ] **Step 3: 运行确认失败**

```bash
cd water-erp && pnpm --filter api test -- supplier-portal.service.spec
```

Expected: 新用例 FAIL（create data 无 qualityCommitment）。

- [ ] **Step 4: 实现 service + controller**

`supplier-portal.service.ts`：
- `BidSubmissionData`（:21-38）`deliveryPeriod?: string;` 之后加 `qualityCommitment?: string;`
- `pickBidSubmissionFields`（:46-65）`deliveryPeriod: data.deliveryPeriod,` 之后加 `qualityCommitment: data.qualityCommitment,`

`supplier-portal.controller.ts` 两处 inline body（draft :196-199、submit :215-218），`bidPrice?: string; deliveryPeriod?: string;` 行改为：

```ts
      bidPrice?: string; deliveryPeriod?: string; qualityCommitment?: string;
```

- [ ] **Step 5: 运行确认通过**

```bash
cd water-erp && pnpm --filter api test -- supplier-portal.service.spec
```

Expected: 全部 PASS。

- [ ] **Step 6: 唱标预填改口径（bid.service getOpeningRecordDraft）**

`apps/api/src/bid/bid.service.ts`：
(a) 方法 doc 注释首行改为：

```ts
  /**
   * 唱标预填草稿：聚合项目级质量目标 + 投标提交的报价/工期/质量承诺 + 已有开标记录的保证金状态。
   * 质量承诺口径（2026-08-17）：优先供应商投递的质量承诺（qualityCommitment），未填写回退项目级
   * qualityRequirement——唱标不再凭空增项。
   * 仅 OPENING 阶段且该供应商解密成功才返回真实数据（canView=true），
   * 保证金凭证（bidBondAssetId）同样仅此时可见，供主持人核对。
   */
```

(b) submission select（:2741-2744）改为：

```ts
          select: { bidPrice: true, deliveryPeriod: true, bidBondAssetId: true, qualityCommitment: true },
```

(c) 返回值 `qualityTarget: project.qualityRequirement,` 改为：

```ts
      qualityTarget: submission?.qualityCommitment || project.qualityRequirement,
```

- [ ] **Step 7: 投递端表单（BidSubmit.vue）**

(a) form 初始态（:42-49）`deliveryPeriod: '',` 之后加：

```ts
  qualityCommitment: '',
```

(b) 两处回填（:206-208 与 :235）`deliveryPeriod: sub.deliveryPeriod || ''` 之后加 `qualityCommitment: sub.qualityCommitment || '',`（:235 行尾追加同样键）。

(c) 模板「交货/工期」el-form-item（:362-364）之后加：

```vue
          <el-form-item label="质量承诺">
            <el-input v-model="form.qualityCommitment" placeholder="选填，如：满足招标文件要求，一次验收合格" />
          </el-form-item>
```

(d) `preflightItems`（:296-307）「交货工期」项之后加：

```ts
    { label:'质量承诺', detail:form.value.qualityCommitment||'未填写', ok:true, required:false },
```

（选填、不参与 canConfirm 拦截；仅提示展示。）

- [ ] **Step 8: 唱标端文案（opening-hall.tsx）**

- :702 表头 `<th ...>质量</th>` → `<th ...>质量承诺</th>`
- :828 弹窗标签 `质量目标` → `质量承诺`；:830 placeholder `placeholder="如 合格"` → `placeholder="如 满足招标文件要求（按投标承诺）"`

- [ ] **Step 9: 类型检查 + API 全量单测**

```bash
cd water-erp/apps/bid-portal && npx tsc --noEmit
cd water-erp/apps/supplier-portal && npx vue-tsc --noEmit
cd water-erp && pnpm --filter api test -- supplier-portal.service.spec
```

Expected: 0 error / 全部 PASS。（若 vue-tsc 不可用改 `pnpm --filter supplier-portal build`。）

- [ ] **Step 10: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.controller.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts apps/api/src/bid/bid.service.ts apps/supplier-portal/src/views/bid/BidSubmit.vue apps/bid-portal/src/components/opening-hall.tsx
git commit -m "feat(bid): 投递端质量承诺字段 qualityCommitment——唱标质量目标改取供应商承诺（回退项目质量要求）"
```

---

### Task 3: 保证金「不适用」档（bondRequired=false 默认）

**Files:**
- Modify: `packages/shared/src/bid-bond-status.ts`（+NA 档）
- Modify: `apps/api/src/bid/bid.service.ts`（getOpeningRecordDraft：empty + 返回值 +bondNotApplicable）
- Test: `apps/api/src/bid/bid.service.spec.ts`（修正 :3030 精确断言 + 1 新用例）
- Modify: `apps/bid-portal/src/lib/api/bid.ts`（OpeningDraftResult +bondNotApplicable）
- Modify: `apps/bid-portal/src/components/opening-hall.tsx`（openRecordEntry 默认选「不适用」）

**Interfaces:**
- Consumes: Task 2 已改的 `getOpeningRecordDraft` select（本任务在 select 中加 `bondRequired: true`）
- Produces: `BOND_STATUS.NA = '不适用'`（选项末尾追加）；`OpeningDraftResult.bondNotApplicable: boolean`

- [ ] **Step 1: shared 枚举加档**

`packages/shared/src/bid-bond-status.ts`：

```ts
export const BOND_STATUS = {
  PAID: '已缴纳',
  GUARANTEE: '保函有效',
  UNPAID: '未缴纳',
  ABNORMAL: '异常',
  /** 项目不要求保证金（bondRequired=false）时的默认档——「不适用」非不合格，仅表示免缴。 */
  NA: '不适用',
} as const;
```

`BOND_STATUS_OPTIONS` 数组末尾追加：

```ts
  BOND_STATUS.NA,
```

`QUALIFIED_STATUSES` 不变，其上方注释追加一句：

```ts
// 注意：「不适用」不入 QUALIFIED；isBondQualified 闸门仅在 bondRequired 时求值（bid.service），语义安全。
```

- [ ] **Step 2: 重建 shared + 清 Vite 缓存 + 重启 dev**

```bash
cd water-erp && pnpm --filter @water-erp/shared build
rm -rf apps/supplier-portal/node_modules/.vite
```

（memory `vite-dep-cache-workspace-packages`：workspace 包改动必须清缓存；重启 supplier-portal 与 bid-portal dev server 后生效。）

- [ ] **Step 3: 后端草稿接口下发 bondNotApplicable**

`apps/api/src/bid/bid.service.ts` `getOpeningRecordDraft`：
(a) project select 改为：

```ts
      select: { stage: true, qualityRequirement: true, bondRequired: true },
```

(b) `empty` 对象改为：

```ts
    const empty = { canView: false, amount: null, period: null, qualityTarget: null, bondStatus: null, bidBondAssetId: null, bondNotApplicable: false };
```

(c) 返回值末尾（`bidBondAssetId` 之后）加：

```ts
      bondNotApplicable: !project.bondRequired,
```

- [ ] **Step 4: 测试修正 + 新用例（bid.service.spec.ts getOpeningRecordDraft 块）**

(a) :3030-3039 用例的 `expect(draft).toEqual({...})` 精确断言加 `bondNotApplicable: false,`（该用例 project mock 为 `bondRequired: true`，追加在 `bidBondAssetId: 'fa-1',` 之后）：

```ts
      bidBondAssetId: 'fa-1',
      bondNotApplicable: false,
```

(b) 块末尾新增：

```ts
  it('项目不要求保证金 → bondNotApplicable=true（前端默认选「不适用」）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: '合格', bondRequired: false });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', supplierId: 'su1', decryptStatus: 'SUCCESS', supplierName: '甲' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: '980000', deliveryPeriod: '180天', bidBondAssetId: null });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);

    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.bondNotApplicable).toBe(true);
    expect(draft.bondStatus).toBeNull();
  });
```

- [ ] **Step 5: 运行确认通过**

```bash
cd water-erp && pnpm --filter api test -- bid.service.spec
```

Expected: 全部 PASS。

- [ ] **Step 6: 前端默认选「不适用」**

`apps/bid-portal/src/lib/api/bid.ts` `OpeningDraftResult` 类型加：

```ts
  bidBondAssetId: string | null;
  /** 项目不要求保证金（bondRequired=false）→ 前端保证金默认选「不适用」 */
  bondNotApplicable: boolean;
```

`apps/bid-portal/src/components/opening-hall.tsx` `openRecordEntry`（:284-289）draft 赋值改为：

```tsx
        setRecordDraft({
          amount: draft.amount ?? '',
          period: draft.period ?? '',
          qualityTarget: draft.qualityTarget ?? '',
          bondStatus: draft.bondStatus ?? (draft.bondNotApplicable ? '不适用' : ''),
        });
```

- [ ] **Step 7: 类型检查 + 浏览器验证**

```bash
cd water-erp/apps/bid-portal && npx tsc --noEmit
```

浏览器（前置：API/两前端 dev 已重启）：以 `陈源远 / 陈源远@2026` 登录 :3007 → 找一个 `bondRequired=false` 的 OPENING 项目 → 点某家「唱标」→ 保证金下拉默认「不适用」且选项列表末尾有「不适用」；换 `bondRequired=true` 项目 → 默认仍为空提示（无「不适用」预选）。

Expected: 符合。

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/bid-bond-status.ts apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts apps/bid-portal/src/lib/api/bid.ts apps/bid-portal/src/components/opening-hall.tsx
git commit -m "feat(bid): 保证金「不适用」档——bondRequired=false 时唱标默认选不适用"
```

---

### Task 4: 供应商确认页回显投递原值对比

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（getMyOpeningRecord 富化）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`（新增 describe 3 用例）
- Modify: `apps/supplier-portal/src/views/bid/OpeningHall.vue`（descriptions 行 + CSS）

**Interfaces:**
- Consumes: Task 1 的 `opening-compare.util.ts`（`isPriceMismatch` / `resolveExpectedInYuan` / `isPeriodMismatch`——**跨模块 import 纯函数**，同文件已 import `../bid` 内模块，有先例）；`SupplierBidSubmission.qualityCommitment`（Task 2 的列）
- Produces: `GET /api/supplier-portal/bid-submissions/:projectId/opening-record` 新响应形状 `{ ...record字段, submitted: { bidPrice, deliveryPeriod, qualityCommitment, priceMismatch, periodMismatch } | null }`；无记录时返回 `{ submitted }`；非本项目投标人仍返回 `null`

- [ ] **Step 1: 写失败测试（supplier-portal.service.spec.ts）**

新 describe 块（`getMyOpeningRecord` 无既有用例，加在开标确认相关 describe 附近）：

```ts
  describe('getMyOpeningRecord（投递原值回显）', () => {
    it('返回唱标记录 + 本人投递原值（报价解封 + mismatch 标志）', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue({
        id: 'r-1', amount: '980000', period: '120 日历天', qualityTarget: '合格', confirmStatus: '待供应商确认',
      });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        bidPrice: sealField('950000', process.env.KMS_SECRET!), deliveryPeriod: '120 日历天', qualityCommitment: '合格',
      });

      const result = await service.getMyOpeningRecord('supplier-1', 'project-1');

      expect(result).toMatchObject({ id: 'r-1', amount: '980000', confirmStatus: '待供应商确认' });
      expect(result!.submitted).toMatchObject({
        bidPrice: '950000', deliveryPeriod: '120 日历天', qualityCommitment: '合格',
        priceMismatch: true, periodMismatch: false,
      });
    });

    it('未唱标时仍返回本人投递原值（不暴露他人数据）', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({
        bidPrice: null, deliveryPeriod: '90 日历天', qualityCommitment: null,
      });

      const result = await service.getMyOpeningRecord('supplier-1', 'project-1');

      expect(result).toBeTruthy();
      expect(result!.submitted).toMatchObject({
        bidPrice: null, deliveryPeriod: '90 日历天', priceMismatch: false, periodMismatch: false,
      });
    });

    it('非本项目投标人 → null（与现状一致）', async () => {
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      await expect(service.getMyOpeningRecord('supplier-1', 'project-1')).resolves.toBeNull();
    });
  });
```

（`sealField`/`openField` 已在 spec 顶部 import（:35）；`TEST_KMS` 由 beforeAll 注入，用 `process.env.KMS_SECRET!` 取值。）

- [ ] **Step 2: 运行确认失败**

```bash
cd water-erp && pnpm --filter api test -- supplier-portal.service.spec
```

Expected: 3 个新用例 FAIL（返回仍为裸记录/null）。

- [ ] **Step 3: 实现 getMyOpeningRecord**

`apps/api/src/supplier-portal/supplier-portal.service.ts`：
(a) 顶部 import 区加：

```ts
import { isPeriodMismatch, isPriceMismatch, resolveExpectedInYuan } from '../bid/opening-compare.util';
```

(b) 替换 `getMyOpeningRecord`（:1178-1184）：

```ts
  /**
   * 供应商本司开标记录 + 本人投递原值对比（唱标内容与投递一致性核对）。
   * submitted.bidPrice 为解封后的投递报价（仅本人可见）；mismatch 标志口径与主持端
   * 唱标录入校验同源（opening-compare.util.ts 单一来源）。
   * 未唱标时仅返回 submitted（本司投递原值，不暴露任何他人数据）。
   */
  async getMyOpeningRecord(supplierId: string, projectId: string) {
    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { supplierId, projectId } });
    if (!bidSupplier) return null;
    const [record, submission] = await Promise.all([
      this.prisma.bidOpeningRecord.findFirst({ where: { projectId, bidSupplierId: bidSupplier.id } }),
      this.prisma.supplierBidSubmission.findUnique({
        where: { supplierId_projectId: { supplierId, projectId } },
        select: { bidPrice: true, deliveryPeriod: true, qualityCommitment: true },
      }),
    ]);
    const submittedBidPrice = submission?.bidPrice ? openField(submission.bidPrice, process.env.KMS_SECRET!) : null;
    return {
      ...(record ?? {}),
      submitted: submission
        ? {
            bidPrice: submittedBidPrice,
            deliveryPeriod: submission.deliveryPeriod ?? null,
            qualityCommitment: submission.qualityCommitment ?? null,
            priceMismatch: record?.amount != null
              && isPriceMismatch(resolveExpectedInYuan(submittedBidPrice, record.amount), record.amount),
            periodMismatch: isPeriodMismatch(submission.deliveryPeriod, record?.period),
          }
        : null,
    };
  }
```

- [ ] **Step 4: 运行确认通过**

```bash
cd water-erp && pnpm --filter api test -- supplier-portal.service.spec
```

Expected: 全部 PASS（含 submitBid 既有用例无回归）。

- [ ] **Step 5: 供应商大厅回显（OpeningHall.vue）**

(a) template el-descriptions（:149-155）替换为：

```vue
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="本司解密状态">{{ decryptStatus || record?.decryptResult || '—' }}</el-descriptions-item>
          <el-descriptions-item label="唱标金额">{{ record?.amount || '—' }}</el-descriptions-item>
          <el-descriptions-item label="投递报价">
            <span :class="{ 'mismatch': record?.submitted?.priceMismatch }">{{ record?.submitted?.bidPrice || '—' }}</span>
            <el-tag v-if="record?.submitted?.priceMismatch" size="small" type="warning" effect="plain">与唱标不一致</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="工期（唱标）">{{ record?.period || '—' }}</el-descriptions-item>
          <el-descriptions-item label="工期（投递）">
            <span :class="{ 'mismatch': record?.submitted?.periodMismatch }">{{ record?.submitted?.deliveryPeriod || '—' }}</span>
            <el-tag v-if="record?.submitted?.periodMismatch" size="small" type="warning" effect="plain">与唱标不一致</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="质量承诺（唱标）">{{ record?.qualityTarget || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="record?.submitted?.qualityCommitment" label="质量承诺（投递）">
            <span :class="{ 'mismatch': record.qualityTarget !== record.submitted.qualityCommitment }">{{ record.submitted.qualityCommitment }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="开标记录状态">{{ record?.confirmStatus || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="record?.handleResult" label="异议处理结果">{{ record.handleResult }}</el-descriptions-item>
        </el-descriptions>
```

(b) `<style scoped>` 追加：

```css
.mismatch { color: #e6a23c; font-weight: 600; }
```

（script 无需改动——`record.value` 新形状下：未唱标时 `record.confirmStatus` undefined → 确认/异议按钮不显示（:161 条件不变）；`record?.amount` undefined → '—'。）

- [ ] **Step 6: 类型检查**

```bash
cd water-erp/apps/supplier-portal && npx vue-tsc --noEmit
```

（若 vue-tsc 不可用则 `cd water-erp && pnpm --filter supplier-portal build`，Expected: 0 error。）

- [ ] **Step 7: 浏览器验证（真实链路）**

前置：API 与两前端 dev 运行中；项目 `y4i6qam1jqhggwpx0djg0kbn`（OPENING，已有唱标记录）。
1. `重庆蜀通岩土工程有限公司 / supplier@2026` 登录 :3004 → 进入该项目开标大厅：
   - descriptions 出现「投递报价 / 工期（投递） / 质量承诺（投递）」行，值与投递表单一致
   - 若本司唱标金额与投递价不一致 → 投递报价行橙色 + 「与唱标不一致」tag
2. 未唱标的供应商（如 `成都华西物资供应有限公司`）→ 唱标金额/工期显示 '—'，但投递原值行仍显示本司值
3. 确认/异议按钮行为不变（仅 `待供应商确认` 态显示）

Expected: 全部符合。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts apps/supplier-portal/src/views/bid/OpeningHall.vue
git commit -m "feat(supplier-portal): 开标大厅回显本司投递原值——报价/工期/质量承诺与唱标对比（mismatch 后端判定）"
```

---

## Self-Review

**1. Spec coverage:** 四项缺漏逐一对应——①工期一致性校验=Task 1（util 同源 + 409 + 确认流 + 监督日志）；②质量目标增项=Task 2（投递端补字段、唱标改口径取供应商承诺）；③保证金不适用=Task 3（枚举 + 草稿提示 + 前端默认）；④确认页无对比=Task 4（回显 + mismatch 标志）。上游「唱标内容清单未在招标文件定义」为源头文档事项，不属代码改动，未纳入（与本计划范围声明一致）。

**2. Placeholder scan:** 全部步骤含完整代码块/命令；无 TBD、无「类似 Task N」。迁移时间戳以 CLI 生成名为准（`<时间戳>` 为显式操作指令，非占位——执行者按 create-only 实际输出文件名替换）。

**3. Type consistency:** `confirmSealedPeriod`（DTO/body 类型/handleEnterRecord/assertPeriodMatchesSubmitted）四处同名；`qualityCommitment`（schema/type/pick/controller/BidSubmit/getOpeningRecordDraft/getMyOpeningRecord）一致；`bondNotApplicable`（draft 返回/OpeningDraftResult/openRecordEntry/测试断言）一致；`submitted.{bidPrice,deliveryPeriod,qualityCommitment,priceMismatch,periodMismatch}`（service 返回/spec 断言/OpeningHall 模板绑定）一致。Task 4 依赖 Task 1 util 与 Task 2 列——任务顺序已保证。

**4. 回归风险复核:** ①assertPriceMatchesSealed 重构有 P1-4/P1-13 既有测试护栏；②draft 返回值新增字段仅 :3030 一处 toEqual 精确断言需同步修（已在 Task 3 Step 4 显式列出）；③getMyOpeningRecord 新形状与 OpeningHall 既有 `record?.` 可选链全部兼容（未唱标时确认按钮条件不成立）；④迁移走 create-only + 人工审查，不触碰 4 处刻意 drift。
