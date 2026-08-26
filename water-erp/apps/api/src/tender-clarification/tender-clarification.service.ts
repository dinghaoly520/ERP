import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { AnnouncementService } from '../announcement/announcement.service';
import { assertAskWithinWindow } from './clarification-timing.util';
import { AskClarificationDto } from './dto/ask-clarification.dto';

/**
 * W1 招标文件澄清与修改（CTS-EBS01 A-80~A-86，B-011~B-015）。
 * 问答（供应商提问→采购答复）+ 版本化澄清文件（草稿/发布）+ 下载回执；
 * 发布联动通知已下载供应商（B-013）与置顶 CLARIFY_NOTICE 公告（B-014）。
 */
@Injectable()
export class TenderClarificationService {
  private readonly logger = new Logger(TenderClarificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly announcements: AnnouncementService,
  ) {}

  /** A-80：供应商就招标文件提出澄清问题（须已下载、窗口内）。 */
  async askQuestion(projectId: string, supplier: { id: string; name: string }, dto: AskClarificationDto) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, stage: true, deadline: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'DOWNLOAD' && project.stage !== 'SUBMIT') {
      throw new BadRequestException({ error: '仅招标文件获取/投标阶段可提出澄清', code: 'STAGE_INVALID' });
    }
    const bid = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierId: supplier.id },
      select: { downloadStatus: true },
    });
    if (!bid || bid.downloadStatus !== '已下载') {
      throw new ForbiddenException({ error: '仅已获取招标文件的供应商可提问', code: 'NOT_DOWNLOADED' });
    }
    assertAskWithinWindow(project.deadline);
    return this.prisma.tenderClarification.create({
      data: {
        projectId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        question: dto.question,
        attachmentId: dto.attachmentId ?? null,
      },
    });
  }

  /** 供应商视角列表（Task 7 完整实现）。 */
  async listForSupplier(_projectId: string, _supplierId: string) {
    return { questions: [], docs: [] };
  }
}
