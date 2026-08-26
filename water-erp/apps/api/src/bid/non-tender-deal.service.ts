import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** C3 非招标方式三类（CTS-EBS01 A-199：变更为非招标方式后记录其他交易方式和成交结果） */
export const NON_TENDER_METHODS = ['竞争性谈判', '询价', '单一来源'] as const;
export type NonTenderMethod = (typeof NON_TENDER_METHODS)[number];

export interface RegisterNonTenderDealDto {
  method: string;
  winnerName: string;
  winnerSupplierId?: string;
  dealAmount?: number;
  fileAssetId?: string;
  note?: string;
}

/**
 * C3 转非招标方式成交登记：流标（ABORTED）项目改用非招标方式后的成交结果入档。
 * - 结构化记录（方式/成交人/金额）持久化，导出 ASIP 时写入「其他/非招标成交记录.json」
 * - 成交文件（FileAsset）同步挂 PMI「定标」阶段 Attachment——随既有归档范围/ASIP 机器自动入档
 * - 登记动作写监督日志留痕
 */
@Injectable()
export class NonTenderDealService {
  private readonly logger = new Logger(NonTenderDealService.name);

  constructor(private readonly prisma: PrismaService) {}

  async register(bidProjectId: string, dto: RegisterNonTenderDealDto, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: bidProjectId },
      select: { id: true, stage: true, projectManagementItemId: true, round: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'ABORTED') {
      throw new ConflictException({ error: '仅流标项目可登记非招标成交', code: 'NOT_ABORTED' });
    }
    if (!(NON_TENDER_METHODS as readonly string[]).includes(dto.method)) {
      throw new BadRequestException({ error: '非招标方式须为：竞争性谈判 / 询价 / 单一来源', code: 'BAD_METHOD' });
    }
    if (!dto.winnerName?.trim()) {
      throw new BadRequestException({ error: '成交供应商名称必填', code: 'WINNER_REQUIRED' });
    }
    const existing = await this.prisma.nonTenderDealRecord.findUnique({ where: { bidProjectId } });
    if (existing) {
      throw new ConflictException({ error: '该项目已登记非招标成交记录', code: 'ALREADY_REGISTERED' });
    }

    // 成交文件挂 PMI「定标」阶段附件（AWARD_DECISION）——ASIP/归档范围机器自动收纳
    let attachmentId: string | null = null;
    if (dto.fileAssetId && project.projectManagementItemId) {
      const fa = await this.prisma.fileAsset.findUnique({ where: { id: dto.fileAssetId } });
      if (!fa) throw new BadRequestException({ error: '成交文件不存在', code: 'FILE_NOT_FOUND' });
      const stage = await this.prisma.projectManagementStage.findFirst({
        where: {
          projectManagementItemId: project.projectManagementItemId,
          stageKey: 'AWARD_DECISION',
          round: project.round,
        },
        select: { id: true },
      });
      if (stage) {
        const att = await this.prisma.attachment.create({
          data: {
            attachmentType: 'AWARD_NOTICE',
            fileName: fa.originalName,
            objectKey: fa.key,
            mimeType: fa.mimeType,
            fileSize: fa.size,
            uploadedById: actorId ?? null,
            projectManagementItemId: project.projectManagementItemId,
            projectManagementStageId: stage.id,
          },
        });
        attachmentId = att.id;
      }
    }

    const record = await this.prisma.nonTenderDealRecord.create({
      data: {
        bidProjectId,
        pmItemId: project.projectManagementItemId,
        method: dto.method,
        winnerSupplierId: dto.winnerSupplierId ?? null,
        winnerName: dto.winnerName.trim(),
        dealAmount: dto.dealAmount ?? null,
        fileAssetId: dto.fileAssetId ?? null,
        note: dto.note?.trim() || null,
        recordedById: actorId ?? null,
      },
    });

    await this.prisma.bidSupervisionLog
      .create({
        data: {
          projectId: bidProjectId,
          time: new Date(),
          role: '系统',
          target: project.name,
          action: '转非招标方式成交登记',
          result: `${dto.method} → ${dto.winnerName.trim()}`,
          riskFlag: '无',
        },
      })
      .catch((err) => this.logger.warn(`监督日志写入失败: ${err.message}`));

    return { ...record, attachmentId };
  }

  async get(bidProjectId: string) {
    return this.prisma.nonTenderDealRecord.findUnique({ where: { bidProjectId } });
  }
}
