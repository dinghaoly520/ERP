import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BidOpeningRecordService } from './bid-opening-record.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { BidGateway } from './bid.gateway';
import { sealField } from '../common/crypto/field-crypto';
import {
  DEFAULT_OPENING_FIELDS,
  assertValidOpeningFieldConfig,
  type OpeningFieldDef,
} from './opening-field-config.util';

// getOpeningRecordDraft 等暴露点用 openField 拆封 bidPrice。
// KMS_SECRET 在 jest 同进程可能被其他 spec 污染，此处显式自洽设置。
const BID_SPEC_KMS = 'test-kms-secret-from-bid-service-spec';
const BID_SPEC_ORIG_KMS = process.env.KMS_SECRET;
beforeAll(() => { process.env.KMS_SECRET = BID_SPEC_KMS; });
afterAll(() => { if (BID_SPEC_ORIG_KMS !== undefined) process.env.KMS_SECRET = BID_SPEC_ORIG_KMS; else delete process.env.KMS_SECRET; });

describe('resolveOpeningDispute', () => {
  let service: BidOpeningRecordService;
  let prisma: any;

  beforeEach(async () => {
    // setup 自 bid.service.spec.ts 共享骨架裁剪（F1c 迁移）：resolveOpeningDispute 所需模型集
    prisma = {
      bidProject: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
      bidSupervisionLog: { findMany: jest.fn(), create: jest.fn() },
      supplier: { count: jest.fn(), findUnique: jest.fn() },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
      bidOpeningRecord: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), upsert: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      supplierBidSubmission: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      bidOpeningSession: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      auditLog: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
      // Support both callback-based and batch-based $transaction patterns
      $transaction: jest.fn(async (callbackOrOps: any) => {
        if (typeof callbackOrOps === 'function') {
          // Callback-based: pass a tx client (which is the prisma mock itself)
          return callbackOrOps(prisma);
        }
        // Batch-based: execute all ops sequentially
        return Promise.all(callbackOrOps);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidOpeningRecordService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
      ],
    }).compile();

    service = module.get<BidOpeningRecordService>(BidOpeningRecordService);
  });
  it('updates record handle result and BidSupplier status on confirm', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({
      id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
      confirmStatus: '供应商提出异议',
    });
    prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 1 });
    prisma.bidOpeningRecord.findUnique.mockResolvedValue({ id: 'r1', confirmStatus: '异议已处理-确认' });
    prisma.bidSupplier.update.mockResolvedValue({});
    prisma.bidSupervisionLog.create.mockResolvedValue({});

    await service.resolveOpeningDispute('p1', 'r1', { result: '经核实无误', confirm: true });

    // M4：事务内条件更新——where 带异议态条件（并发防线，仅异议待处理行命中）
    expect(prisma.bidOpeningRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1', confirmStatus: '供应商提出异议' },
        data: expect.objectContaining({ handleResult: '经核实无误', confirmStatus: '异议已处理-确认' }),
      }),
    );
    expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'CONFIRMED' }) }),
    );
  });

  it('sets BidSupplier EXCEPTION when dispute is not confirmed', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({
      id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
      confirmStatus: '供应商提出异议',
    });
    prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 1 });
    prisma.bidOpeningRecord.findUnique.mockResolvedValue({ id: 'r1' });
    prisma.bidSupplier.update.mockResolvedValue({});
    prisma.bidSupervisionLog.create.mockResolvedValue({});

    await service.resolveOpeningDispute('p1', 'r1', { result: '异议成立', confirm: false });

    expect(prisma.bidSupplier.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ confirmStatus: 'EXCEPTION' }) }),
    );
  });

  it('rejects when record not found', async () => {
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
    await expect(service.resolveOpeningDispute('p1', 'r1', { result: 'x', confirm: true }))
      .rejects.toThrow(BadRequestException);
  });

  it.each([
    ['从未异议（待确认态）', '待确认'],
    ['从未异议（唱标录入态）', '待供应商确认'],
    ['已确认', '供应商已确认'],
    ['已处理过（防反复覆盖）', '异议已处理-确认'],
    ['已处理过（退回态）', '异议已处理-退回'],
  ])('R7 状态机：%s的记录 resolve → 400 DISPUTE_NOT_PENDING，不落库', async (_label, confirmStatus) => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({
      id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1', confirmStatus,
    });
    await expect(service.resolveOpeningDispute('p1', 'r1', { result: 'x', confirm: true }))
      .rejects.toMatchObject({ response: { code: 'DISPUTE_NOT_PENDING' } });
    expect(prisma.$transaction).not.toHaveBeenCalled(); // 事务前拦截：记录/供应商态/监督日志均不动
    expect(prisma.bidOpeningRecord.update).not.toHaveBeenCalled();
    expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
  });

  it('R7 状态机：仅「供应商提出异议」态可处理（异议→处理放行）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({
      id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
      confirmStatus: '供应商提出异议',
    });
    prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 1 });
    prisma.bidOpeningRecord.findUnique.mockResolvedValue({ id: 'r1', confirmStatus: '异议已处理-确认' });
    prisma.bidSupplier.update.mockResolvedValue({});
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 'sup-1' });
    prisma.bidSupervisionLog.create.mockResolvedValue({});
    await expect(service.resolveOpeningDispute('p1', 'r1', { result: '复核无误', confirm: true })).resolves.toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('M4：事务内条件更新抢占失败（updateMany count=0，并发双处理）→ 400 DISPUTE_NOT_PENDING，供应商态/监督日志不动', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({
      id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
      confirmStatus: '供应商提出异议',
    });
    prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 0 }); // 另一请求已在事务内抢占成功

    await expect(service.resolveOpeningDispute('p1', 'r1', { result: 'x', confirm: true }))
      .rejects.toMatchObject({ response: { code: 'DISPUTE_NOT_PENDING' } });
    expect(prisma.$transaction).toHaveBeenCalled(); // 走到了事务内并发防线（非门外快速失败）
    expect(prisma.bidSupplier.update).not.toHaveBeenCalled();
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('M5：resolve 监督日志记态迁移（供应商提出异议 → 异议已处理-确认：处理结果）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({
      id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
      confirmStatus: '供应商提出异议',
    });
    prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 1 });
    prisma.bidOpeningRecord.findUnique.mockResolvedValue({ id: 'r1', confirmStatus: '异议已处理-确认' });
    prisma.bidSupplier.update.mockResolvedValue({});
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 'sup-1' });
    prisma.bidSupervisionLog.create.mockResolvedValue({});

    await service.resolveOpeningDispute('p1', 'r1', { result: '复核无误', confirm: true });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: '处理开标异议',
        result: '供应商提出异议 → 异议已处理-确认：复核无误',
      }),
    }));
  });

  it('H6: 处理异议态记录时写入 handledBy 与 AuditLog', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({
      id: 'r1', projectId: 'p1', supplierName: '测试供应商', bidSupplierId: 'bs-1',
      confirmStatus: '供应商提出异议',
    });
    prisma.bidOpeningRecord.updateMany.mockResolvedValue({ count: 1 });
    prisma.bidOpeningRecord.findUnique.mockResolvedValue({ id: 'r1' });
    prisma.bidSupplier.update.mockResolvedValue({});
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 'sp1' });
    prisma.bidSupervisionLog.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    await service.resolveOpeningDispute('p1', 'r1', { result: '受理', confirm: true }, 'u1');

    expect(prisma.bidOpeningRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ handledBy: 'u1' }) }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', action: 'BID_DISPUTE_RESOLVE' }) }),
    );
  });
});

/* ── 唱标信息录入（修复开标闭环断链）── */

describe('BidOpeningRecordService — enterOpeningRecord (唱标录入)', () => {
  let service: BidOpeningRecordService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
      supplierBidSubmission: { findUnique: jest.fn() },
      bidOpeningRecord: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        BidOpeningRecordService,
      ],
    }).compile();
    service = module.get(BidOpeningRecordService);
  });

  const dto = { bidSupplierId: 'bs1', amount: '980000', period: '180天', qualityTarget: '合格', bondStatus: '已缴纳' };

  it('OPENING 阶段 + 已解密成功 → 新建开标记录（待供应商确认）并写日志', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
    prisma.bidOpeningRecord.upsert.mockResolvedValue({ id: 'r1', confirmStatus: '待供应商确认' });

    const res = await service.enterOpeningRecord('p1', dto as any);
    expect(res.confirmStatus).toBe('待供应商确认');
    expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_bidSupplierId: { projectId: 'p1', bidSupplierId: 'bs1' } },
      create: expect.objectContaining({ projectId: 'p1', bidSupplierId: 'bs1', amount: '980000', confirmStatus: '待供应商确认' }),
    }));
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
  });

  it('已存在记录时按 bidSupplierId 幂等更新', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    // findFirst 供状态门复核（非终态放行）；写入走 upsert update 分支
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ id: 'r1' });
    prisma.bidOpeningRecord.upsert.mockResolvedValue({ id: 'r1', amount: '980000' });

    await service.enterOpeningRecord('p1', dto as any);
    expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_bidSupplierId: { projectId: 'p1', bidSupplierId: 'bs1' } },
      update: expect.objectContaining({ amount: '980000' }),
    }));
    expect(prisma.bidOpeningRecord.create).not.toHaveBeenCalled();
    expect(prisma.bidOpeningRecord.update).not.toHaveBeenCalled();
  });

  it.each([
    ['供应商已确认'],
    ['供应商提出异议'],
    ['异议已处理-确认'],
    ['异议已处理-退回'],
  ])('I1 状态门：%s 态记录重录唱标 → 409 RECORD_LOCKED（防异议态被覆写后撞 R7 成楔子）', async (confirmStatus) => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ id: 'r1', confirmStatus });

    // Wave 5-2：409 文案须指向"异议处理结果闭环"（resolve 两结局均终态，旧文案"先处理异议再操作"
    // 误导主持人以为 resolve 后可重录，实际重录永久锁定）
    await expect(service.enterOpeningRecord('p1', dto as any))
      .rejects.toMatchObject({
        response: {
          code: 'RECORD_LOCKED',
          error: expect.stringContaining('请通过异议处理结果（维持/退回）完成闭环'),
        },
      });
    expect(prisma.bidOpeningRecord.update).not.toHaveBeenCalled();
    expect(prisma.bidOpeningRecord.create).not.toHaveBeenCalled();
    expect(prisma.bidOpeningRecord.upsert).not.toHaveBeenCalled();
  });

  it.each([['待供应商确认'], ['待确认']])('I1 状态门：%s 态仍可重录（正常唱标补录路径不挡）', async (confirmStatus) => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ id: 'r1', confirmStatus });
    prisma.bidOpeningRecord.upsert.mockResolvedValue({ id: 'r1', confirmStatus: '待供应商确认' });

    await expect(service.enterOpeningRecord('p1', dto as any)).resolves.toBeDefined();
    expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_bidSupplierId: { projectId: 'p1', bidSupplierId: 'bs1' } },
    }));
  });

  // ── P1-4：唱标录入与密封报价一致性校验 ──
  const T9_KMS = 't9-price-mismatch-kms';
  it('P1-4：录入价与密封报价不一致且未确认 → 409 PRICE_MISMATCH（附 expected/entered）', async () => {
    const prev = process.env.KMS_SECRET;
    process.env.KMS_SECRET = T9_KMS;
    try {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
      prisma.bidSupplier.findUnique = jest.fn().mockResolvedValue({ supplierId: 's1' });
      prisma.supplierBidSubmission = { findUnique: jest.fn().mockResolvedValue({ bidPrice: sealField('950000', T9_KMS) }) };
      prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);

      await expect(service.enterOpeningRecord('p1', { ...dto } as any)).rejects.toMatchObject({
        response: { code: 'PRICE_MISMATCH', expected: 950000, entered: 980000 },
      });
      expect(prisma.bidOpeningRecord.create).not.toHaveBeenCalled();
      expect(prisma.bidOpeningRecord.upsert).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) process.env.KMS_SECRET = prev; else delete process.env.KMS_SECRET;
    }
  });

  it('P1-4：不一致但 confirmSealedPrice=true → 按录入值落库且监督日志注明差异', async () => {
    const prev = process.env.KMS_SECRET;
    process.env.KMS_SECRET = T9_KMS;
    try {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
      prisma.bidSupplier.findUnique = jest.fn().mockResolvedValue({ supplierId: 's1' });
      prisma.supplierBidSubmission = { findUnique: jest.fn().mockResolvedValue({ bidPrice: sealField('950000', T9_KMS) }) };
      prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
      prisma.bidOpeningRecord.upsert.mockResolvedValue({ id: 'r2' });
      prisma.bidSupervisionLog.create.mockResolvedValue({});

      const res = await service.enterOpeningRecord('p1', { ...dto, confirmSealedPrice: true } as any);
      expect(res).toBeDefined();
      expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ amount: '980000' }),
      }));
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ result: expect.stringContaining('950000') }),
      }));
    } finally {
      if (prev !== undefined) process.env.KMS_SECRET = prev; else delete process.env.KMS_SECRET;
    }
  });

  it('P1-13：密封价万元单位（79.8）与录入元单位（798000）视为一致（唱标单位归一）', async () => {
    const prev = process.env.KMS_SECRET; process.env.KMS_SECRET = T9_KMS;
    try {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
      prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 's1' });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: sealField('79.8', T9_KMS) }); // 供应商表单单位=万元
      prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
      prisma.bidOpeningRecord.upsert.mockResolvedValue({ id: 'r1' });

      const res = await service.enterOpeningRecord('p1', { ...dto, amount: '798000' } as any); // 唱标录入单位=元
      expect(res).toBeDefined();
      expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ amount: '798000' }),
      }));
    } finally { if (prev !== undefined) process.env.KMS_SECRET = prev; else delete process.env.KMS_SECRET; }
  });

  it('P1-13：万元/元归一不掩盖真实差异（密封 79.8 万 vs 录入 700000 元 → 仍 409）', async () => {
    const prev = process.env.KMS_SECRET; process.env.KMS_SECRET = T9_KMS;
    try {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
      prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 's1' });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: sealField('79.8', T9_KMS) });
      prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);

      await expect(service.enterOpeningRecord('p1', { ...dto, amount: '700000' } as any)).rejects.toMatchObject({
        response: { code: 'PRICE_MISMATCH' },
      });
    } finally { if (prev !== undefined) process.env.KMS_SECRET = prev; else delete process.env.KMS_SECRET; }
  });

  it('P1-4：密封报价缺失（null）→ 不校验直接通过（向后兼容）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 's1' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: null });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
    prisma.bidOpeningRecord.upsert.mockResolvedValue({ id: 'r3' });

    const res = await service.enterOpeningRecord('p1', { ...dto } as any);
    expect(res).toBeDefined();
  });

  it('P1-4（新轨 dual-v2）：密封价源=decryptedPrice（fieldsCommit 承诺验证后的报价）→ 不一致 409 PRICE_MISMATCH', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 's1' });
    // 新轨投递 bidPrice 列恒 null——期望值必须读 decryptedPrice，读 bidPrice 会跳过校验成漏洞
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: null, envelopeVersion: 'dual-v2', decryptedPrice: '950000' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);

    await expect(service.enterOpeningRecord('p1', { ...dto } as any)).rejects.toMatchObject({
      response: { code: 'PRICE_MISMATCH', expected: 950000, entered: 980000 },
    });
    expect(prisma.bidOpeningRecord.upsert).not.toHaveBeenCalled();
  });

  it('P1-4（新轨 dual-v2）：decryptedPrice 缺失（供应商未完成解密上传）→ 跳过校验（与密封价缺失同语义）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 's1' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: null, envelopeVersion: 'dual-v2', decryptedPrice: null });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
    prisma.bidOpeningRecord.upsert.mockResolvedValue({ id: 'r5' });

    const res = await service.enterOpeningRecord('p1', { ...dto } as any);
    expect(res).toBeDefined();
    expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalled();
  });

  it('P1-4：旧明文报价（无 v1: 前缀）不一致 → 同样 409（数据可比即校验）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidSupplier.findUnique.mockResolvedValue({ supplierId: 's1' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: '950000' }); // 旧明文
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);

    await expect(service.enterOpeningRecord('p1', { ...dto } as any)).rejects.toMatchObject({
      response: { code: 'PRICE_MISMATCH', expected: 950000 },
    });
  });

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

  it('非 OPENING 阶段拒绝', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT', name: '项目A' });
    await expect(service.enterOpeningRecord('p1', dto as any)).rejects.toThrow(BadRequestException);
  });

  it('未解密成功拒绝录入唱标信息', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'PENDING' });
    await expect(service.enterOpeningRecord('p1', dto as any)).rejects.toThrow(BadRequestException);
  });

  it('投标记录不存在拒绝', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue(null);
    await expect(service.enterOpeningRecord('p1', dto as any)).rejects.toThrow(BadRequestException);
  });

  it('H11: 供应商已确认（confirmStatus=CONFIRMED）时禁止覆盖唱标信息', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲公司', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' });
    await expect(service.enterOpeningRecord('p1', dto as any)).rejects.toThrow(ConflictException);
    expect(prisma.bidOpeningRecord.update).not.toHaveBeenCalled();
    expect(prisma.bidOpeningRecord.create).not.toHaveBeenCalled();
  });
});

describe('BidOpeningRecordService — enterOpeningRecord 唱标事件公开广播（合规口径）', () => {
  let service: BidOpeningRecordService;
  let prisma: any;
  const gatewayMock = { notifyOpeningRecordUpdated: jest.fn(), notifySupervisionLog: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
      supplierBidSubmission: { findUnique: jest.fn() },
      bidOpeningRecord: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        { provide: BidGateway, useValue: gatewayMock },
        BidOpeningRecordService,
      ],
    }).compile();
    service = module.get(BidOpeningRecordService);
  });

  it('通知 payload 带 Supplier.id（非 BidSupplier.id）——与其他供应商侧事件 id 语义一致', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierId: 's1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
    prisma.bidOpeningRecord.upsert.mockResolvedValue({ id: 'r1', confirmStatus: '待供应商确认' });

    await service.enterOpeningRecord('p1', { bidSupplierId: 'bs1', amount: '980000', period: '180天', qualityTarget: '合格', bondStatus: '已缴纳' } as any);

    expect(gatewayMock.notifyOpeningRecordUpdated).toHaveBeenCalledWith('p1', expect.objectContaining({
      supplierId: 's1',      // 旧实现误传 BidSupplier.id 'bs1'，两套 id 体系永不命中
      supplierName: '甲公司',
      recordId: 'r1',
      amount: 980000,
    }));
  });
});
describe('BidOpeningRecordService — getOpeningRecordDraft', () => {
  let service: BidOpeningRecordService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn() },
      supplierBidSubmission: { findUnique: jest.fn() },
      bidOpeningRecord: { findFirst: jest.fn() },
      bidBondLedger: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidOpeningRecordService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn() } },
      ],
    }).compile();
    service = module.get(BidOpeningRecordService);
  });

  it('OPENING 阶段且解密成功 → 返回预填数据', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: '合格', bondRequired: true, bondAmount: null, deadline: new Date('2026-08-01T17:00:00+08:00') });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', supplierId: 'su1', decryptStatus: 'SUCCESS', supplierName: '甲' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: '980000', deliveryPeriod: '180天', bidBondAssetId: 'fa-1' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ bondStatus: '已缴纳' });

    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft).toEqual({
      canView: true,
      amount: '980000',
      period: '180天',
      qualityTarget: '合格',
      bondStatus: '已缴纳',
      bidBondAssetId: 'fa-1',
      bondNotApplicable: false,
      // A-104：bondRequired + 无台账 → LEDGER_MISSING（凭证 fa-1 在场，凭证维不计）
      bondCompliance: { issues: [{ field: 'LEDGER_MISSING', message: '未登记到账台账' }] },
      // A-113：草稿随项目配置下发 fieldConfig（无配置=默认四字段）+ 既有记录 customFields 回读
      customFields: null,
      fieldConfig: { fields: DEFAULT_OPENING_FIELDS as OpeningFieldDef[] },
    });
  });

  it('供应商投递了质量承诺 → qualityTarget 优先取供应商承诺（回退项目 qualityRequirement）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: '合格', bondRequired: true, bondAmount: null, deadline: new Date('2026-08-01T17:00:00+08:00') });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', supplierId: 'su1', decryptStatus: 'SUCCESS', supplierName: '甲' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: '980000', deliveryPeriod: '180天', bidBondAssetId: null, qualityCommitment: '供应商承诺：一次验收合格' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);

    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.canView).toBe(true);
    expect(draft.qualityTarget).toBe('供应商承诺：一次验收合格');
  });

  it('非 OPENING 阶段 → canView=false 且不抛异常', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'SUBMIT', qualityRequirement: null, bondRequired: false });
    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.canView).toBe(false);
    expect(draft.amount).toBeNull();
  });

  it('未解密成功 → canView=false', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: null, bondRequired: false });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', decryptStatus: 'PENDING', supplierName: '甲' });
    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.canView).toBe(false);
  });

  it('密封 bidPrice（v1: 前缀）在 OPENING+SUCCESS 时被 openField 拆封为明文', async () => {
    // 入库后 bidPrice 是密封态；主持人查询唱标草稿时应当拿到明文。
    const sealedPrice = sealField('980000', BID_SPEC_KMS);
    expect(sealedPrice).toMatch(/^v1:/);

    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: '合格', bondRequired: false });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', supplierId: 'su1', decryptStatus: 'SUCCESS', supplierName: '甲' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: sealedPrice, deliveryPeriod: '180天', bidBondAssetId: null });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ bondStatus: '已缴纳' });

    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.canView).toBe(true);
    expect(draft.amount).toBe('980000'); // 拆封后明文
    expect(draft.period).toBe('180天');
  });

  it('旧明文 bidPrice（无 v1: 前缀）经 openField legacy 兼容原样返回', async () => {
    // 防回归：已存在的旧明文行不应因引入密封而被破坏。
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: '合格', bondRequired: false });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', supplierId: 'su1', decryptStatus: 'SUCCESS', supplierName: '甲' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: '770000', deliveryPeriod: '90天', bidBondAssetId: null });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);

    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.amount).toBe('770000');
  });

  it('项目不要求保证金 → bondNotApplicable=true（前端默认选「不适用」）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: '合格', bondRequired: false });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', supplierId: 'su1', decryptStatus: 'SUCCESS', supplierName: '甲' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ bidPrice: '980000', deliveryPeriod: '180天', bidBondAssetId: null });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);

    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.bondNotApplicable).toBe(true);
    expect(draft.bondStatus).toBeNull();
  });

  it('dual-v2：保证金凭证链接改指 decryptedAssets.bond 明文资产（C_outer 密文拒下载）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: '合格', bondRequired: true, bondAmount: null, deadline: new Date('2026-08-01T17:00:00+08:00') });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', supplierId: 'su1', decryptStatus: 'SUCCESS', supplierName: '甲' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({
      bidPrice: null, deliveryPeriod: '180天', bidBondAssetId: 'fa-outer-bond',
      envelopeVersion: 'dual-v2',
      decryptedAssets: { technical: 'fa-dec-t', business: 'fa-dec-b', coverLetter: 'fa-dec-c', bond: 'fa-dec-bond' },
    });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ bondStatus: '已缴纳' });

    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.bidBondAssetId).toBe('fa-dec-bond');
  });

  it('dual-v2：amount 改指 decryptedPrice（新轨 bidPrice 列恒 null——读旧列草稿价≠最终价，主持人按面板录入必撞 409 PRICE_MISMATCH）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: '合格', bondRequired: true, bondAmount: null, deadline: new Date('2026-08-01T17:00:00+08:00') });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 's1', supplierId: 'su1', decryptStatus: 'SUCCESS', supplierName: '甲' });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({
      bidPrice: null, decryptedPrice: '1234567.89', deliveryPeriod: '180天', bidBondAssetId: 'fa-1',
      envelopeVersion: 'dual-v2',
      decryptedAssets: { technical: 'fa-dec-t', business: 'fa-dec-b', coverLetter: 'fa-dec-c', bond: 'fa-dec-bond' },
    });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ bondStatus: '已缴纳' });

    const draft = await service.getOpeningRecordDraft('p1', 's1');
    expect(draft.amount).toBe('1234567.89');
  });
});
describe('BidOpeningRecordService — A-113 唱标字段动态化', () => {
  let service: BidOpeningRecordService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findFirst: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
      supplierBidSubmission: { findUnique: jest.fn() },
      bidOpeningRecord: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      bidBondLedger: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        BidOpeningRecordService,
      ],
    }).compile();
    service = module.get(BidOpeningRecordService);
  });

  const baseDto = { bidSupplierId: 'bs1', amount: '980000', period: '180天', qualityTarget: '合格', bondStatus: '已缴纳' };
  // 带动态字段的项目配置（法定四键 + text/number/select 三型动态键）
  const CFG = {
    fields: [
      ...DEFAULT_OPENING_FIELDS,
      { key: 'projectManager', label: '项目经理', type: 'text' },
      { key: 'subcontractRatio', label: '分包比例', type: 'number' },
      { key: 'paymentTerms', label: '付款方式', type: 'select', options: ['月付', '季付'] },
    ] as OpeningFieldDef[],
  };

  const mockEnterOk = (openingFieldConfig?: unknown) => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '项目A', openingFieldConfig });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierId: 's1', supplierName: '甲公司', decryptStatus: 'SUCCESS' });
    prisma.bidOpeningRecord.findFirst.mockResolvedValue(null);
    prisma.bidOpeningRecord.upsert.mockResolvedValue({ id: 'r1', confirmStatus: '待供应商确认' });
  };

  it('默认 config（项目无配置）：dto 带未定义 customFields 键 → 剥除后落 JsonNull（防脏数据），法定四字段路径零改动', async () => {
    mockEnterOk(null);
    await service.enterOpeningRecord('p1', { ...baseDto, customFields: { hacked: 'x' } } as any);
    expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ customFields: Prisma.JsonNull }),
      update: expect.objectContaining({ customFields: Prisma.JsonNull }),
    }));
  });

  it('带配置项目：customFields 写入读回——enter 落净化值（未定义键剥除），draft 回读 customFields 并下发 fieldConfig', async () => {
    mockEnterOk(CFG);
    await service.enterOpeningRecord('p1', { ...baseDto, customFields: { projectManager: '张三', paymentTerms: '月付', rogue: '应被剥除' } } as any);
    const call = prisma.bidOpeningRecord.upsert.mock.calls[0][0];
    expect(call.create.customFields).toEqual({ projectManager: '张三', paymentTerms: '月付' });
    expect(call.create.customFields).not.toHaveProperty('rogue');

    // 读回：既有记录 customFields 原样回读；fieldConfig 按项目配置下发
    prisma.bidOpeningRecord.findFirst.mockResolvedValue({ bondStatus: '已缴纳', customFields: { projectManager: '张三', paymentTerms: '月付' } });
    prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING', qualityRequirement: '合格', bondRequired: false, deadline: new Date('2026-08-01T17:00:00+08:00'), openingFieldConfig: CFG });
    const draft = await service.getOpeningRecordDraft('p1', 'bs1');
    expect(draft.customFields).toEqual({ projectManager: '张三', paymentTerms: '月付' });
    expect(draft.fieldConfig).toEqual({ fields: CFG.fields });
  });

  it('required 动态字段缺失 → 400 OPENING_FIELD_REQUIRED（文案含 label），不落库', async () => {
    mockEnterOk({ fields: [...DEFAULT_OPENING_FIELDS, { key: 'safetyGrade', label: '安全等级', type: 'text', required: true }] });
    await expect(service.enterOpeningRecord('p1', { ...baseDto } as any))
      .rejects.toMatchObject({ response: { code: 'OPENING_FIELD_REQUIRED', error: expect.stringContaining('安全等级') } });
    expect(prisma.bidOpeningRecord.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['select 越值', { key: 'paymentTerms', label: '付款方式', type: 'select', options: ['月付', '季付'] }, '年付'],
    ['number 非数值串', { key: 'subcontractRatio', label: '分包比例', type: 'number' }, '三成'],
  ])('%s → 400 OPENING_FIELD_INVALID', async (_label, def, value) => {
    mockEnterOk({ fields: [...DEFAULT_OPENING_FIELDS, def] });
    await expect(service.enterOpeningRecord('p1', { ...baseDto, customFields: { [def.key]: value } } as any))
      .rejects.toMatchObject({ response: { code: 'OPENING_FIELD_INVALID' } });
    expect(prisma.bidOpeningRecord.upsert).not.toHaveBeenCalled();
  });

  it('number 动态字段合法数值串（-12.5）放行；非 required 空值跳过不落键', async () => {
    mockEnterOk(CFG);
    await service.enterOpeningRecord('p1', { ...baseDto, customFields: { subcontractRatio: '-12.5', projectManager: '' } } as any);
    expect(prisma.bidOpeningRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ customFields: { subcontractRatio: '-12.5' } }),
    }));
  });

  describe('assertValidOpeningFieldConfig（写入端形状校验，PUT/模板 apply 复用）', () => {
    it.each([
      ['删除法定键（amount）', DEFAULT_OPENING_FIELDS.filter((f) => f.key !== 'amount')],
      ['法定键 type 被改（amount→number）', [{ ...DEFAULT_OPENING_FIELDS[0], type: 'number' }, ...DEFAULT_OPENING_FIELDS.slice(1)]],
      ['select 无 options', [...DEFAULT_OPENING_FIELDS, { key: 'x', label: 'X', type: 'select' }]],
      ['prefillFrom 非法定键', [...DEFAULT_OPENING_FIELDS, { key: 'x', label: 'X', type: 'text', prefillFrom: 'rogue' as any }]],
      ['key 重复', [...DEFAULT_OPENING_FIELDS, { key: 'amount', label: '重复', type: 'text' }]],
      ['label 空', [...DEFAULT_OPENING_FIELDS, { key: 'x', label: '', type: 'text' }]],
      ['label 超 20 字', [...DEFAULT_OPENING_FIELDS, { key: 'x', label: '超'.repeat(21), type: 'text' }]],
    ])('%s → 400 OPENING_FIELD_CONFIG_INVALID', (_label, fields) => {
      let thrown: unknown;
      try {
        assertValidOpeningFieldConfig(fields as OpeningFieldDef[]);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as BadRequestException).getResponse()).toMatchObject({ code: 'OPENING_FIELD_CONFIG_INVALID' });
    });

    it('合法配置（法定四键 + 动态字段）→ 不抛', () => {
      expect(() => assertValidOpeningFieldConfig([...DEFAULT_OPENING_FIELDS, { key: 'x', label: 'X', type: 'number' }])).not.toThrow();
    });
  });
});
