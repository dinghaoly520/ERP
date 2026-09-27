import { ProjectManagementService } from './project-management.service';
import { ScoreStandardValidator } from '../bid/score-standard-validator.service';

/** 正式盖章版冻结锁（2026-09-27 用户裁定：03 确认即冻结）：已完成 03 阶段的正式盖章版
 *  指针目标附件，禁止 saveAttachmentHtml 原地替换内容与 deleteAttachment 删除——
 *  保 04 公告引用与 03 确认时刻一致（身份一致由指针保证，本闸补内容时点）。
 *  解锁路径 = 重开该步骤（updateStage 回退未完成）。 */
describe('正式盖章版冻结锁（OFFICIAL_TENDER_FROZEN）', () => {
  const mkService = (prisma: Record<string, any>) =>
    new ProjectManagementService(
      prisma as never,
      {} as never,
      { analyzeProjectDetail: jest.fn().mockResolvedValue({ summary: {}, fileAnalyses: [] }) } as never,
      {} as never,
      {} as never,
      {} as never,
      { checkStageGate: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {} as never,
      {} as never,
      { assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } as never as ScoreStandardValidator,
    );

  const ATT = (over: Record<string, unknown> = {}) => ({
    id: 'att-official',
    fileName: '采购文件-盖章版.docx',
    objectKey: 'pm/xxx-tender_document-采购文件.docx',
    projectManagementItemId: 'pmi-1',
    projectManagementStageId: 'st-td',
    ...over,
  });

  /** 阶段行 mock：默认=已完成 03 且指针指向 ATT */
  const mkPrisma = (stageOver: Record<string, unknown> = {}) => ({
    attachment: {
      findUnique: jest.fn().mockResolvedValue(ATT()),
      findMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ id: 'att-official' }),
      update: jest.fn().mockResolvedValue({ id: 'att-official' }),
    },
    projectManagementStage: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'st-td',
        stageKey: 'TENDER_DOCUMENT',
        status: 'COMPLETED',
        officialTenderAttachmentId: 'att-official',
        ...stageOver,
      }),
    },
    // deleteAttachment 尾部「删采购文件清空提取信息」链（clearData 落 item.update）
    projectManagementItem: { update: jest.fn().mockResolvedValue({ id: 'pmi-1' }) },
  });

  const errOf = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

  // ── saveAttachmentHtml：内容替换冻结 ──

  it('已完成 03 的正式盖章版 saveAttachmentHtml → 400 OFFICIAL_TENDER_FROZEN，attachment.update 不触发', async () => {
    const prisma = mkPrisma();
    const svc = mkService(prisma);
    const err: any = await errOf(
      svc.saveAttachmentHtml('pmi-1', { attachmentId: 'att-official', html: '<p>x</p>' }),
    );
    expect(err?.response?.code).toBe('OFFICIAL_TENDER_FROZEN');
    expect(prisma.attachment.update).not.toHaveBeenCalled();
  });

  // ── deleteAttachment：删除冻结 ──

  it('已完成 03 的正式盖章版 deleteAttachment → 400 OFFICIAL_TENDER_FROZEN，attachment.delete 不触发', async () => {
    const prisma = mkPrisma();
    const svc = mkService(prisma);
    const err: any = await errOf(svc.deleteAttachment('pmi-1', 'att-official'));
    expect(err?.response?.code).toBe('OFFICIAL_TENDER_FROZEN');
    expect(prisma.attachment.delete).not.toHaveBeenCalled();
  });

  it('03 未完成（IN_PROGRESS）→ 冻结不生效，删除放行（候选期可换选）', async () => {
    const prisma = mkPrisma({ status: 'IN_PROGRESS' });
    const svc = mkService(prisma);
    await expect(svc.deleteAttachment('pmi-1', 'att-official')).resolves.toBeTruthy();
    expect(prisma.attachment.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'att-official' } }),
    );
  });

  it('同阶段非指针附件（officialTenderAttachmentId 不同）→ 放行：只冻正式版本体', async () => {
    const prisma = mkPrisma({ officialTenderAttachmentId: 'att-other' });
    const svc = mkService(prisma);
    await expect(svc.deleteAttachment('pmi-1', 'att-official')).resolves.toBeTruthy();
    expect(prisma.attachment.delete).toHaveBeenCalled();
  });

  it('非 03 阶段附件 → 放行（冻结仅约束 TENDER_DOCUMENT）', async () => {
    const prisma = mkPrisma({ stageKey: 'PUBLIC_ANNOUNCEMENT' });
    const svc = mkService(prisma);
    await expect(svc.deleteAttachment('pmi-1', 'att-official')).resolves.toBeTruthy();
    expect(prisma.attachment.delete).toHaveBeenCalled();
  });

  it('附件无阶段归属（projectManagementStageId=null）→ 放行（查不到阶段即无冻结语义）', async () => {
    const prisma = mkPrisma();
    prisma.attachment.findUnique.mockResolvedValue(ATT({ projectManagementStageId: null }));
    const svc = mkService(prisma);
    await expect(svc.deleteAttachment('pmi-1', 'att-official')).resolves.toBeTruthy();
    expect(prisma.attachment.delete).toHaveBeenCalled();
  });
});
