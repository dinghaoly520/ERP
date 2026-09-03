import * as crypto from 'crypto';
import { BidSignPacketService } from './bid-sign-packet.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertSignGateClosed } from './bid-state';

const prisma = {
  $queryRaw: jest.fn().mockResolvedValue([]), // lockAndReassertStage 首步 FOR UPDATE（缺失则事务用例 TypeError）
  bidProject: { findUnique: jest.fn() },
  bidSignPacket: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() },
  bidExpert: { findFirst: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  bidEvaluationResult: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
  auditLog: { create: jest.fn().mockResolvedValue({}) },
  fileAsset: { create: jest.fn(), upsert: jest.fn() },
  // buildSnapshot 的 12 个 delegate：findMany 必须回数组（快照代码直接 .map/断言）
  bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]) },
  bidSupplier: { findMany: jest.fn().mockResolvedValue([]) },
  bidInvalidBid: { findMany: jest.fn().mockResolvedValue([]) },
  bidScoreItem: { findMany: jest.fn().mockResolvedValue([]) },
  bidScoreRecord: { findMany: jest.fn().mockResolvedValue([]) },
  bidScoreRecordHistory: { findMany: jest.fn().mockResolvedValue([]) },
  bidScorePointDecision: { findMany: jest.fn().mockResolvedValue([]) },
  bidScoreReview: { findMany: jest.fn().mockResolvedValue([]) },
  expertDispute: { findMany: jest.fn().mockResolvedValue([]) },
  bidClarification: { findMany: jest.fn().mockResolvedValue([]) },
  bidMotion: { findMany: jest.fn().mockResolvedValue([]) },
  $transaction: jest.fn(async (fn: any) => fn(prisma)),
};

const projectId = 'p1';
const expertId = 'e1';

function makeService(): BidSignPacketService {
  return new BidSignPacketService(
    prisma as unknown as PrismaService,
    { upload: jest.fn() } as any,          // storage：Task 3/4 才用到
    { generateDocument: jest.fn() } as any, // docx：Task 3 才用到
    { buildEvaluationPackage: jest.fn() } as any, // bidService（handover 用例挂 buildEvaluationPackage mock；空对象会 TypeError）
  );
}

/** 事务/尾部 getStatus 共用底座：进入事务的用例必须先调（lockAndReassertStage 走 $queryRaw + bidProject.findUnique，
 *  未 mock 会 TypeError/NOT_FOUND）；getStatus 尾部 findMany 必须回数组否则 .map 崩。
 *  packet 用全字段（尾部组装走 generatedAt.toISOString 等）；各用例在其上覆盖单个 mock。 */
function baseArrange() {
  (prisma.bidProject.findUnique as jest.Mock).mockResolvedValue({ id: projectId, stage: 'EVALUATING', name: '测试项目' });
  (prisma.bidSignPacket.findUnique as jest.Mock).mockResolvedValue({
    id: 'pk1', projectId, sha256: 'sha-a', generatedAt: new Date(), fileAssetId: 'fa1',
    signPageScanFileId: null, closedAt: null, handoverFileAssetId: null, handoverSha256: null,
  });
  (prisma.bidExpert.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.bidEvaluationResult.count as jest.Mock).mockResolvedValue(0);
}

describe('BidSignPacketService.register（§43 语义）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('REFUSED_DISSENT 未填不同意见 → 400 SIGN_DISSENT_REQUIRED', async () => {
    baseArrange(); // 走到 dissent 检查前需要 packet + expert 都命中
    (prisma.bidExpert.findFirst as jest.Mock).mockResolvedValue({ id: expertId, projectId, expertRole: '正选', expertName: '张三' });
    const svc = makeService();
    await expect(
      svc.register(projectId, expertId, { status: 'REFUSED_DISSENT' }, 'u1'),
    ).rejects.toMatchObject({ response: { code: 'SIGN_DISSENT_REQUIRED' } });
  });

  it('拒绝且未陈述理由 → DEEMED_AGREED 清空不同意见并登记', async () => {
    baseArrange(); // packet 已含 closedAt:null 全字段；覆盖进入事务 + getStatus 尾部
    (prisma.bidExpert.findFirst as jest.Mock).mockResolvedValue({ id: expertId, projectId, expertRole: '正选', expertName: '张三' });
    (prisma.bidExpert.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.bidExpert.count as jest.Mock).mockResolvedValue(1); // 还剩 1 名 PENDING → 不闭环

    const svc = makeService();
    await svc.register(projectId, expertId, { status: 'DEEMED_AGREED', dissentingOpinion: '不该出现的意见' }, 'u1');

    expect(prisma.bidExpert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: expertId, projectId, signStatus: 'PENDING' },
        data: expect.objectContaining({
          signStatus: 'DEEMED_AGREED',
          dissentingOpinion: null,
          dissentingReason: null,
          signRegisteredBy: 'u1',
        }),
      }),
    );
    expect(prisma.bidSignPacket.update).not.toHaveBeenCalled(); // 未闭环
  });

  it('最后一名正选登记成功 → 自动闭环 packet.closedAt', async () => {
    baseArrange();
    (prisma.bidExpert.findFirst as jest.Mock).mockResolvedValue({ id: expertId, projectId, expertRole: '正选', expertName: '张三' });
    (prisma.bidExpert.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.bidExpert.count as jest.Mock).mockResolvedValue(0); // 无 PENDING → 闭环

    const svc = makeService();
    await svc.register(projectId, expertId, { status: 'SIGNED' }, 'u1');

    expect(prisma.bidSignPacket.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId }, data: expect.objectContaining({ closedById: 'u1' }) }),
    );
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
  });

  it('已闭环 → 409 SIGN_PACKET_CLOSED', async () => {
    (prisma.bidSignPacket.findUnique as jest.Mock).mockResolvedValue({ projectId, closedAt: new Date() });
    const svc = makeService();
    await expect(svc.register(projectId, expertId, { status: 'SIGNED' }, 'u1'))
      .rejects.toMatchObject({ response: { code: 'SIGN_PACKET_CLOSED' } });
  });

  it('并发重登 → updateMany count=0 → 409 SIGN_ALREADY_REGISTERED', async () => {
    baseArrange(); // SIGN_ALREADY_REGISTERED 在事务内抛出 → 必须铺好 $queryRaw + findUnique
    (prisma.bidExpert.findFirst as jest.Mock).mockResolvedValue({ id: expertId, projectId, expertRole: '正选', expertName: '张三' });
    (prisma.bidExpert.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const svc = makeService();
    await expect(svc.register(projectId, expertId, { status: 'SIGNED' }, 'u1'))
      .rejects.toMatchObject({ response: { code: 'SIGN_ALREADY_REGISTERED' } });
  });

  it('候补专家登记 → 400 SIGN_EXPERT_NOT_FORMAL', async () => {
    baseArrange();
    (prisma.bidExpert.findFirst as jest.Mock).mockResolvedValue({ id: expertId, projectId, expertRole: '候补' });
    const svc = makeService();
    await expect(svc.register(projectId, expertId, { status: 'SIGNED' }, 'u1'))
      .rejects.toMatchObject({ response: { code: 'SIGN_EXPERT_NOT_FORMAL' } });
  });

  it('专家不属于项目 → 400 EXPERT_NOT_IN_PROJECT', async () => {
    baseArrange();
    (prisma.bidExpert.findFirst as jest.Mock).mockResolvedValue(null);
    const svc = makeService();
    await expect(svc.register(projectId, expertId, { status: 'SIGNED' }, 'u1'))
      .rejects.toMatchObject({ response: { code: 'EXPERT_NOT_IN_PROJECT' } });
  });

  it('签字包未生成 → 409 SIGN_PACKET_NOT_GENERATED', async () => {
    (prisma.bidSignPacket.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = makeService();
    await expect(svc.register(projectId, expertId, { status: 'SIGNED' }, 'u1'))
      .rejects.toMatchObject({ response: { code: 'SIGN_PACKET_NOT_GENERATED' } });
  });
});

describe('BidSignPacketService.generate', () => {
  const projectId = 'p1';
  const fileAssetId = 'fa1';

  beforeEach(() => jest.clearAllMocks());

  it('stage 非 EVALUATING → 409', async () => {
    (prisma.bidProject.findUnique as jest.Mock).mockResolvedValue({ id: projectId, stage: 'OPENING' });
    const svc = makeService();
    await expect(svc.generate(projectId, 'u1')).rejects.toMatchObject({ response: { code: 'SIGN_PACKET_STAGE_REQUIRED' } });
  });

  it('未生成评标结果 → 409 SIGN_PACKET_RESULTS_MISSING', async () => {
    (prisma.bidProject.findUnique as jest.Mock).mockResolvedValue({ id: projectId, stage: 'EVALUATING', name: 'p', projectCode: 'c' });
    (prisma.bidEvaluationResult.count as jest.Mock).mockResolvedValue(0);
    const svc = makeService();
    await expect(svc.generate(projectId, 'u1')).rejects.toMatchObject({ response: { code: 'SIGN_PACKET_RESULTS_MISSING' } });
  });

  it('已闭环 → 409 SIGN_PACKET_CLOSED（锁定：重生成会使回流包指纹与归档哈希链失效）', async () => {
    (prisma.bidProject.findUnique as jest.Mock).mockResolvedValue({ id: projectId, stage: 'EVALUATING', name: 'p', projectCode: 'c' });
    (prisma.bidEvaluationResult.count as jest.Mock).mockResolvedValue(2);
    (prisma.bidSignPacket.findUnique as jest.Mock).mockResolvedValue({ projectId, closedAt: new Date() });
    const svc = makeService();
    await expect(svc.generate(projectId, 'u1')).rejects.toMatchObject({ response: { code: 'SIGN_PACKET_CLOSED' } });
  });

  it('生成成功：上传 MinIO、建 FileAsset、upsert 包并重置全员 PENDING（重生成语义）', async () => {
    (prisma.bidProject.findUnique as jest.Mock).mockResolvedValue({ id: projectId, stage: 'EVALUATING', name: 'p', projectCode: 'c' });
    (prisma.bidEvaluationResult.count as jest.Mock).mockResolvedValue(2);
    // 前序「已闭环」用例的实现会残留（clearAllMocks 不清 mock 实现）→ 显式复位为未生成
    (prisma.bidSignPacket.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = makeService();
    (svc as any).docxService.generateDocument.mockResolvedValue(Buffer.from('fake-docx'));
    (svc as any).storage.upload.mockResolvedValue(undefined);
    (prisma.bidExpert.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.fileAsset.upsert as jest.Mock).mockResolvedValue({ id: fileAssetId });
    (prisma.bidSignPacket.upsert as jest.Mock).mockResolvedValue({ id: 'sp1', projectId, fileAssetId });
    (prisma.bidExpert.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    await svc.generate(projectId, 'u1');

    expect((svc as any).storage.upload).toHaveBeenCalledWith(
      expect.stringContaining(`bid-sign-packet/${projectId}`),
      expect.any(Buffer),
      expect.any(String),
    );
    expect(prisma.bidExpert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId, expertRole: '正选' },
        data: expect.objectContaining({ signStatus: 'PENDING', signScanFileId: null }),
      }),
    );
  });

  it('P1-17：重复 generate（重生成）走 fileAsset.upsert 不撞 key 唯一约束（非幂等 500 修复）', async () => {
    (prisma.bidProject.findUnique as jest.Mock).mockResolvedValue({ id: projectId, stage: 'EVALUATING', name: 'p', projectCode: 'c' });
    (prisma.bidEvaluationResult.count as jest.Mock).mockResolvedValue(2);
    (prisma.bidSignPacket.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = makeService();
    (svc as any).docxService.generateDocument.mockResolvedValue(Buffer.from('fake-docx'));
    (svc as any).storage.upload.mockResolvedValue(undefined);
    (prisma.bidExpert.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.fileAsset.upsert as jest.Mock).mockResolvedValue({ id: fileAssetId });
    (prisma.bidSignPacket.upsert as jest.Mock).mockResolvedValue({ id: 'sp1', projectId, fileAssetId });
    (prisma.bidExpert.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    await svc.generate(projectId, 'u1');

    // 同 key 覆盖 MinIO 后 upsert FileAsset（旧实现 create 撞 key @unique → P2002 → 500）
    expect(prisma.fileAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: expect.stringContaining(`bid-sign-packet/${projectId}`) },
      create: expect.objectContaining({ key: expect.stringContaining(`bid-sign-packet/${projectId}`), category: 'bid_sign_packet' }),
      update: expect.objectContaining({ sha256: expect.any(String) }),
    }));
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
  });
});

describe('BidSignPacketService 扫描上传', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mimetype 非 jpg/png/pdf → 400 SIGN_SCAN_TYPE_INVALID', async () => {
    baseArrange(); // assertScanUploadable 先查 packet（未 mock 会先抛 SIGN_PACKET_NOT_GENERATED）
    const svc = makeService();
    await expect(
      svc.uploadExpertScan(projectId, expertId, { buffer: Buffer.from('x'), mimetype: 'text/plain', originalname: 'a.txt' }, 'u1'),
    ).rejects.toMatchObject({ response: { code: 'SIGN_SCAN_TYPE_INVALID' } });
  });

  it('闭环后上传 → 409 SIGN_PACKET_CLOSED', async () => {
    (prisma.bidSignPacket.findUnique as jest.Mock).mockResolvedValue({ projectId, closedAt: new Date() });
    const svc = makeService();
    await expect(
      svc.uploadSignaturePageScan(projectId, { buffer: Buffer.from('x'), mimetype: 'image/png', originalname: 'a.png' }, 'u1'),
    ).rejects.toMatchObject({ response: { code: 'SIGN_PACKET_CLOSED' } });
  });

  it('专家扫描上传成功：MinIO + FileAsset(expert_sign_scan) + signScanFileId 落库', async () => {
    baseArrange(); // 尾部 getStatus 需 findUnique 全字段 packet + findMany 回数组；事务内 lockAndReassertStage 走 $queryRaw
    (prisma.bidExpert.findFirst as jest.Mock).mockResolvedValue({ id: expertId, projectId, expertRole: '正选' });
    (prisma.fileAsset.upsert as jest.Mock).mockResolvedValue({ id: 'fa9' });
    (prisma.bidExpert.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const svc = makeService();
    (svc as any).storage.upload.mockResolvedValue(undefined);

    await svc.uploadExpertScan(projectId, expertId, { buffer: Buffer.from('x'), mimetype: 'image/png', originalname: '签.png' }, 'u1');

    expect((svc as any).storage.upload).toHaveBeenCalledWith(
      expect.stringContaining(`bid-sign-packet/${projectId}/expert-${expertId}`),
      expect.any(Buffer),
      'image/png',
    );
    expect(prisma.fileAsset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ category: 'expert_sign_scan' }) }),
    );
    expect(prisma.bidExpert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: expertId, projectId }, data: { signScanFileId: 'fa9' } }),
    );
  });

  it('N2：storeScan 同 key 重传走 upsert（create 撞 @unique 的 P2002→500 已除）', async () => {
    baseArrange(); // assertScanUploadable 查 packet + 事务 lockAndReassertStage + 尾部 getStatus
    (prisma.bidExpert.findFirst as jest.Mock).mockResolvedValue({ id: expertId, projectId, expertRole: '正选' });
    (prisma.bidExpert.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.fileAsset.upsert as jest.Mock).mockResolvedValue({ id: 'asset-1' });
    const svc = makeService();
    (svc as any).storage.upload.mockResolvedValue(undefined);

    await svc.uploadExpertScan(projectId, expertId, { buffer: Buffer.from('x'), mimetype: 'image/jpeg', originalname: 'a.jpg' }, 'host-1');

    // 同 key 重传：MinIO 已覆盖，FileAsset 须 upsert 更新行（旧实现 create 撞 key @unique → P2002 → 500）
    expect(prisma.fileAsset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'bid-sign-packet/p1/expert-e1.jpg' } }),
    );
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
  });

  it('主报告签字页扫描 → packet.signPageScanFileId 落库', async () => {
    baseArrange(); // 尾部 getStatus 需全字段 packet + findMany 回数组
    (prisma.fileAsset.upsert as jest.Mock).mockResolvedValue({ id: 'fa10' });
    const svc = makeService();
    (svc as any).storage.upload.mockResolvedValue(undefined);

    await svc.uploadSignaturePageScan(projectId, { buffer: Buffer.from('x'), mimetype: 'application/pdf', originalname: '签字页.pdf' }, 'u1');

    expect(prisma.fileAsset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ category: 'sign_packet_signature_page' }) }),
    );
    expect(prisma.bidSignPacket.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId }, data: { signPageScanFileId: 'fa10' } }),
    );
  });
});

describe('BidSignPacketService.generateHandover', () => {
  const projectId = 'p1';

  beforeEach(() => jest.clearAllMocks());

  it('未闭环 → 409 SIGN_HANDOVER_NOT_CLOSED', async () => {
    (prisma.bidSignPacket.findUnique as jest.Mock).mockResolvedValue({ projectId, closedAt: null });
    const svc = makeService();
    await expect(svc.generateHandover(projectId, 'u1'))
      .rejects.toMatchObject({ response: { code: 'SIGN_HANDOVER_NOT_CLOSED' } });
  });

  it('已闭环：上传 JSON 回流包并落 handoverFileAssetId（幂等——已有则直接返回）', async () => {
    baseArrange(); // 尾部 getStatus 需要；snapshot 里 bidProject.findUnique 也会走
    (prisma.bidSignPacket.findUnique as jest.Mock).mockResolvedValue({
      id: 'pk1', projectId, sha256: 'sha-a', generatedAt: new Date(), fileAssetId: 'fa1',
      signPageScanFileId: null, closedAt: new Date(), handoverFileAssetId: null, handoverSha256: null,
    }); // 全字段（尾部组装走 generatedAt.toISOString 等），仅 closedAt 改为已闭环
    const svc = makeService();
    (svc as any).storage.upload.mockResolvedValue(undefined);
    (prisma.fileAsset.upsert as jest.Mock).mockResolvedValue({ id: 'fa99' });
    (prisma.bidSignPacket.update as jest.Mock).mockResolvedValue({});
    // 快照 delegate（expertDispute/bidMotion/bidClarification/bidExpert.findMany）由 fake 常量 + baseArrange 回 []，无需再 mock
    // buildEvaluationPackage 由注入的 BidService 提供——spec 挂 mock
    (svc as any).bidService.buildEvaluationPackage.mockResolvedValue({ packageType: 'BID_EVALUATION_HANDOVER', fingerprint: 'x' });

    await svc.generateHandover(projectId, 'u1');

    expect((svc as any).storage.upload).toHaveBeenCalledWith(
      expect.stringContaining(`bid-sign-handover/${projectId}.json`),
      expect.any(Buffer),
      'application/json',
    );
    expect(prisma.fileAsset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ category: 'bid_evaluation_sign_handover' }) }),
    );
    expect(prisma.bidSignPacket.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId }, data: expect.objectContaining({ handoverFileAssetId: 'fa99' }) }),
    );
  });

  it('N14：generateHandover 回流包 fileAsset 走 upsert（幂等守卫外的防御性同 key 覆盖）', async () => {
    baseArrange(); // 尾部 getStatus 需要；snapshot 里 bidProject.findUnique 也会走
    (prisma.bidSignPacket.findUnique as jest.Mock).mockResolvedValue({
      id: 'pk1', projectId, sha256: 'sha-a', generatedAt: new Date(), fileAssetId: 'fa1',
      signPageScanFileId: null, closedAt: new Date(), handoverFileAssetId: null, handoverSha256: null,
    });
    const svc = makeService();
    (svc as any).storage.upload.mockResolvedValue(undefined);
    (prisma.fileAsset.upsert as jest.Mock).mockResolvedValue({ id: 'fa98' });
    (prisma.bidSignPacket.update as jest.Mock).mockResolvedValue({});
    (svc as any).bidService.buildEvaluationPackage.mockResolvedValue({ packageType: 'BID_EVALUATION_HANDOVER', fingerprint: 'x' });

    await svc.generateHandover(projectId, 'u1');

    // 回流包同 key 覆盖 MinIO；FileAsset upsert 使 DB 指纹与内容恒一致（与 N2/N3 同款，P1-17 同构）
    expect(prisma.fileAsset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: `bid-sign-handover/${projectId}.json` },
        update: expect.objectContaining({ sha256: expect.any(String) }),
      }),
    );
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
  });
});

describe('assertSignGateClosed（归档闸门）', () => {
  it('scope=full 三缺一 → 对应 409 明细', () => {
    expect(() => assertSignGateClosed('full', null, [])).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'SIGN_PACKET_NOT_GENERATED' }) }));
    expect(() => assertSignGateClosed('full', { closedAt: null, handoverFileAssetId: null }, ['张三'])).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'SIGN_NOT_CLOSED', error: expect.stringContaining('张三') }) }));
    expect(() => assertSignGateClosed('full', { closedAt: new Date(), handoverFileAssetId: null }, [])).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'HANDOVER_NOT_GENERATED' }) }));
  });
  it('scope=opening 流标归档豁免', () => {
    expect(() => assertSignGateClosed('opening', null, [])).not.toThrow();
  });
  it('闭环+回流齐全 → 放行', () => {
    expect(() => assertSignGateClosed('full', { closedAt: new Date(), handoverFileAssetId: 'fa' }, [])).not.toThrow();
  });
});

describe('BidSignPacketService.unregister', () => {
  it('未登记 → 400 SIGN_NOT_REGISTERED', async () => {
    baseArrange(); // SIGN_NOT_REGISTERED 在事务内抛出 → 铺好 $queryRaw + findUnique
    (prisma.bidExpert.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const svc = makeService();
    await expect(svc.unregister(projectId, expertId, 'u1'))
      .rejects.toMatchObject({ response: { code: 'SIGN_NOT_REGISTERED' } });
  });

  it('闭环后撤销 → 409 SIGN_PACKET_CLOSED', async () => {
    (prisma.bidSignPacket.findUnique as jest.Mock).mockResolvedValue({ projectId, closedAt: new Date() });
    const svc = makeService();
    await expect(svc.unregister(projectId, expertId, 'u1'))
      .rejects.toMatchObject({ response: { code: 'SIGN_PACKET_CLOSED' } });
  });

  it('闭环前撤销 → 原子回退 PENDING 并清空意见字段', async () => {
    baseArrange(); // 尾部 getStatus 需 findMany 回数组 + 全字段 packet
    (prisma.bidExpert.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const svc = makeService();
    await svc.unregister(projectId, expertId, 'u1');
    expect(prisma.bidExpert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: expertId, projectId, signStatus: { not: 'PENDING' } },
        data: { signStatus: 'PENDING', signStatusAt: null, signRegisteredBy: null, dissentingOpinion: null, dissentingReason: null },
      }),
    );
  });
});

describe('BidSignPacketService.buildSnapshot（A-132 分工入委员会名单）', () => {
  const projectId = 'p1';

  beforeEach(() => jest.clearAllMocks());

  it('committee 行携带 reviewGroup/dutyRole（未设置透传 null）', async () => {
    // buildSnapshot 首个 Promise.all：bidProject.findUnique 需项目 select 全字段；其余 findMany 系 fake 默认回 []
    (prisma.bidProject.findUnique as jest.Mock).mockResolvedValue({
      name: '测试项目', projectCode: 'BID-1', procurementMethod: '公开招标',
      openTime: null, deadline: null, scope: null, qualification: null, budget: null, leaderCoSignedAt: null,
    });
    (prisma.bidExpert.findMany as jest.Mock).mockResolvedValue([
      { id: 'e1', expertName: '张三', major: '水利水电', expertRole: '正选', isLead: true, reviewGroup: '技术组', dutyRole: '主审',
        isPurchaserRepresentative: false, signInIp: null, signInMeta: null, confidentialityAgreedAt: null, disciplineAgreedAt: null, reportConfirmedAt: null },
      { id: 'e2', expertName: '李四', major: '工程造价', expertRole: '正选', isLead: false, reviewGroup: null, dutyRole: null,
        isPurchaserRepresentative: true, signInIp: null, signInMeta: null, confidentialityAgreedAt: null, disciplineAgreedAt: null, reportConfirmedAt: null },
    ]);
    const svc = makeService();
    const snapshot = await svc.buildSnapshot(projectId);
    // select 必须带出两列（缺列则映射 undefined，报告名单显示 '—' 失真）
    const committeeSelect = (prisma.bidExpert.findMany as jest.Mock).mock.calls[0]?.[0]?.select;
    expect(committeeSelect?.reviewGroup).toBe(true);
    expect(committeeSelect?.dutyRole).toBe(true);
    expect(snapshot.committee).toHaveLength(2);
    expect(snapshot.committee[0]).toMatchObject({ name: '张三', reviewGroup: '技术组', dutyRole: '主审' });
    expect(snapshot.committee[1]).toMatchObject({ name: '李四', reviewGroup: null, dutyRole: null });
  });
});
