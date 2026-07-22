import {
  Injectable,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OcrService } from '../local-ai/ocr.service';

/**
 * ExpertMemoService — 评审专家手写备忘 CRUD + 墨迹原图上传 + OCR 降级
 *
 *  - 墨迹 PNG 通过 StorageService 上传 MinIO，并写 FileAsset（category='expert_memo_ink'）
 *  - OCR 仅在 OcrService.isAvailable() 为真时尝试；失败仅降级（保留墨迹原图，不阻塞）
 *  - 所有方法均校验：当前用户必须是该项目的评审专家（NOT_PROJECT_EXPERT）
 *    且备忘必须属于该专家（NOT_FOUND / NO_INK）
 */
@Injectable()
export class ExpertMemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
  ) {}

  async createMemo(
    userId: string,
    projectId: string,
    dto: {
      supplierId?: string;
      scoreItemId?: string;
      scorePointId?: string;
      contentText?: string;
      inkBuffer?: Buffer;
      sourceDevice?: string;
    },
  ) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert)
      throw new ForbiddenException({
        error: '您不是该项目的评审专家',
        code: 'NOT_PROJECT_EXPERT',
      });

    // P2：归属校验——supplierId/scoreItemId/scorePointId 须属于本项目（防备忘挂到别项目实体）
    if (dto.supplierId) {
      const supplier = await this.prisma.bidSupplier.findFirst({ where: { id: dto.supplierId, projectId } });
      if (!supplier) throw new BadRequestException({ error: '供应商不属于此项目', code: 'SUPPLIER_NOT_IN_PROJECT' });
    }
    if (dto.scoreItemId) {
      const item = await this.prisma.bidScoreItem.findFirst({ where: { id: dto.scoreItemId, projectId } });
      if (!item) throw new BadRequestException({ error: '评分项不属于此项目', code: 'SCORE_ITEM_NOT_IN_PROJECT' });
    }
    if (dto.scorePointId) {
      const point = await this.prisma.bidScorePoint.findFirst({ where: { id: dto.scorePointId, scoreItem: { projectId } } });
      if (!point) throw new BadRequestException({ error: '得分点不属于此项目', code: 'SCORE_POINT_NOT_IN_PROJECT' });
    }

    let inkFileId: string | undefined;
    let contentText = dto.contentText;
    if (dto.inkBuffer) {
      const objectKey = `expert-memo/${projectId}/${expert.id}/${Date.now()}.png`;
      const sha256 = createHash('sha256')
        .update(dto.inkBuffer)
        .digest('hex');
      await this.storage.upload(objectKey, dto.inkBuffer, 'image/png');
      const asset = await this.prisma.fileAsset.create({
        data: {
          key: objectKey,
          originalName: 'memo-ink.png',
          mimeType: 'image/png',
          size: dto.inkBuffer.length,
          sha256,
          category: 'expert_memo_ink',
          uploaderId: userId,
        },
      });
      inkFileId = asset.id;

      // OCR 可用则识别，不可用或失败均降级（仅保留墨迹原图）
      if (await this.ocr.isAvailable()) {
        try {
          const r = await this.ocr.ocrImage(
            dto.inkBuffer,
            'image/png',
            'memo-ink.png',
          );
          if (r.text?.trim())
            contentText = (contentText ? contentText + '\n' : '') + r.text.trim();
        } catch {
          /* OCR 失败不阻塞，仅存墨迹 */
        }
      }
    }

    return this.prisma.expertMemo.create({
      data: {
        expertId: expert.id,
        projectId,
        supplierId: dto.supplierId,
        scoreItemId: dto.scoreItemId,
        scorePointId: dto.scorePointId,
        contentText,
        inkFileId,
        sourceDevice: dto.sourceDevice,
      },
    });
  }

  async getMemos(userId: string, projectId: string, supplierId?: string, scorePointId?: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert)
      throw new ForbiddenException({
        error: '您不是该项目的评审专家',
        code: 'NOT_PROJECT_EXPERT',
      });
    return this.prisma.expertMemo.findMany({
      where: {
        expertId: expert.id,
        projectId,
        ...(supplierId ? { supplierId } : {}),
        ...(scorePointId ? { scorePointId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateMemo(
    userId: string,
    projectId: string,
    memoId: string,
    dto: { contentText?: string },
  ) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert)
      throw new ForbiddenException({
        error: '您不是该项目的评审专家',
        code: 'NOT_PROJECT_EXPERT',
      });
    const existing = await this.prisma.expertMemo.findFirst({
      where: { id: memoId, expertId: expert.id, projectId },
    });
    if (!existing)
      throw new BadRequestException({
        error: '备忘不存在',
        code: 'NOT_FOUND',
      });
    return this.prisma.expertMemo.update({
      where: { id: memoId },
      data: { ...(dto.contentText !== undefined && { contentText: dto.contentText }) },
    });
  }

  async deleteMemo(userId: string, projectId: string, memoId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert)
      throw new ForbiddenException({
        error: '您不是该项目的评审专家',
        code: 'NOT_PROJECT_EXPERT',
      });
    const existing = await this.prisma.expertMemo.findFirst({
      where: { id: memoId, expertId: expert.id, projectId },
    });
    if (!existing)
      throw new BadRequestException({
        error: '备忘不存在',
        code: 'NOT_FOUND',
      });
    await this.prisma.expertMemo.delete({ where: { id: memoId } });
    return { deleted: true };
  }

  async getInkUrl(userId: string, projectId: string, memoId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (!expert)
      throw new ForbiddenException({
        error: '您不是该项目的评审专家',
        code: 'NOT_PROJECT_EXPERT',
      });
    const memo = await this.prisma.expertMemo.findFirst({
      where: { id: memoId, expertId: expert.id, projectId },
      include: { inkFile: true },
    });
    if (!memo?.inkFile)
      throw new BadRequestException({
        error: '无墨迹原图',
        code: 'NO_INK',
      });
    return { url: await this.storage.getPresignedUrl(memo.inkFile.key) };
  }
}
