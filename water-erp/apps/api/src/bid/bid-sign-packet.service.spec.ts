import { BidSignPacketService } from './bid-sign-packet.service';
import { PrismaService } from '../prisma/prisma.service';

const prisma = {
  $queryRaw: jest.fn().mockResolvedValue([]), // lockAndReassertStage 首步 FOR UPDATE（缺失则事务用例 TypeError）
  bidProject: { findUnique: jest.fn() },
  bidSignPacket: { findUnique: jest.fn(), update: jest.fn() },
  bidExpert: { findFirst: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  bidEvaluationResult: { count: jest.fn() },
  bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
  auditLog: { create: jest.fn().mockResolvedValue({}) },
  $transaction: jest.fn(async (fn: any) => fn(prisma)),
};

const projectId = 'p1';
const expertId = 'e1';

function makeService(): BidSignPacketService {
  return new BidSignPacketService(
    prisma as unknown as PrismaService,
    { upload: jest.fn() } as any,          // storage：Task 3/4 才用到
    { generateDocument: jest.fn() } as any, // docx：Task 3 才用到
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
