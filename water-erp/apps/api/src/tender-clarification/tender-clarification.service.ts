import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { AnnouncementService } from '../announcement/announcement.service';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { streamToBuffer } from '../announcement/bid-document.crypto';
import { assertAskWithinWindow, assertIssueWithinWindow } from './clarification-timing.util';
import { CreateClarificationDocDto } from './dto/create-clarification-doc.dto';
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

  /** A-81：采购中心答复澄清问题（幂等：已答复不重复写）。 */
  async answer(projectId: string, questionId: string, answerText: string, answeredBy: string) {
    const q = await this.prisma.tenderClarification.findUnique({ where: { id: questionId } });
    if (!q || q.projectId !== projectId) {
      throw new BadRequestException({ error: '澄清问题不存在', code: 'NOT_FOUND' });
    }
    if (q.status !== '待答复') return q;
    return this.prisma.tenderClarification.update({
      where: { id: questionId },
      data: { answer: answerText, status: '已答复', answeredBy, answeredAt: new Date() },
    });
  }

  /** 管理端：问答 + 澄清文件（含回执名单）。 */
  async listForStaff(projectId: string) {
    const [questions, docs] = await Promise.all([
      this.prisma.tenderClarification.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.tenderClarificationDoc.findMany({
        where: { projectId },
        orderBy: { version: 'asc' },
        include: { receipts: { include: { supplier: { select: { name: true } } } } },
      }),
    ]);
    return {
      questions,
      docs: docs.map((d) => ({
        ...d,
        // 回执平铺（与 web 端 ClarificationDocReceipt 类型一致）
        receipts: d.receipts.map((r) => ({ supplierName: r.supplier?.name ?? '未知供应商', receiptedAt: r.receiptedAt })),
      })),
    };
  }

  /** A-82/A-83：新建澄清与修改文件（草稿，版本号项目内自增）。 */
  async createDoc(projectId: string, dto: CreateClarificationDocDto, createdBy: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.tenderClarificationDoc.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return tx.tenderClarificationDoc.create({
        data: {
          projectId,
          version: (last?.version ?? 0) + 1,
          title: dto.title,
          content: dto.content ?? '',
          fileAssetId: dto.fileAssetId ?? null,
          createdBy,
        },
      });
    });
  }

  /** A-82：发布澄清与修改文件（B-012 十五日窗；Task 6 追加通知/公告副作用）。 */
  async publishDoc(
    projectId: string,
    docId: string,
    actorId?: string,
    companyStamp: { companyId?: string; companyName?: string } = {},
  ) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, projectCode: true, name: true, deadline: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    const doc = await this.prisma.tenderClarificationDoc.findUnique({ where: { id: docId } });
    if (!doc || doc.projectId !== projectId) {
      throw new BadRequestException({ error: '澄清文件不存在', code: 'NOT_FOUND' });
    }
    if (doc.status === '已发布') return { ...doc, notifiedCount: 0 }; // 幂等（不再触发通知/公告）

    assertIssueWithinWindow(project.deadline);

    const updated = await this.prisma.tenderClarificationDoc.update({
      where: { id: docId },
      data: { status: '已发布', publishedAt: new Date() },
    });

    const notified = await this.notifyDownloaders(project, updated); // Task 6 实装
    await this.publishClarifyNotice(project, updated, actorId, companyStamp); // Task 6 实装
    return { ...updated, notifiedCount: notified };
  }

  /** A-82：修改澄清文件（仅草稿；已发布锁定防篡改）。 */
  async updateDoc(projectId: string, docId: string, dto: Partial<CreateClarificationDocDto>) {
    const doc = await this.prisma.tenderClarificationDoc.findUnique({ where: { id: docId } });
    if (!doc || doc.projectId !== projectId) {
      throw new BadRequestException({ error: '澄清文件不存在', code: 'NOT_FOUND' });
    }
    if (doc.status !== '草稿') {
      throw new BadRequestException({ error: '已发布的澄清文件不可修改（防篡改），请新建下一版', code: 'DOC_LOCKED' });
    }
    return this.prisma.tenderClarificationDoc.update({
      where: { id: docId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.fileAssetId !== undefined && { fileAssetId: dto.fileAssetId }),
      },
    });
  }

  /** A-82：删除澄清文件（仅草稿）。 */
  async deleteDoc(projectId: string, docId: string) {
    const doc = await this.prisma.tenderClarificationDoc.findUnique({ where: { id: docId } });
    if (!doc || doc.projectId !== projectId) {
      throw new BadRequestException({ error: '澄清文件不存在', code: 'NOT_FOUND' });
    }
    if (doc.status !== '草稿') {
      throw new BadRequestException({ error: '已发布的澄清文件不可删除', code: 'DOC_LOCKED' });
    }
    await this.prisma.tenderClarificationDoc.delete({ where: { id: docId } });
    return { ok: true };
  }

  /** 当前用户公司归属（公告写时快照用；无归属返回空对象）。 */
  async userCompany(userId: string): Promise<{ companyId?: string; companyName?: string }> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, companyRef: { select: { name: true } } },
    });
    if (!u?.companyId) return {};
    return { companyId: u.companyId, companyName: u.companyRef?.name };
  }

  /** B-013：向所有已获取招标文件的供应商发站内通知。 */
  private async notifyDownloaders(project: { id: string; name: string }, doc: { id: string; version: number; title: string }): Promise<number> {
    const rows = await this.prisma.bidSupplier.findMany({
      where: { projectId: project.id, downloadStatus: '已下载' },
      select: { supplier: { select: { userId: true } } },
    });
    let notified = 0;
    for (const r of rows) {
      const uid = r.supplier?.userId;
      if (!uid) continue; // 未关联登录账号的供应商跳过
      await this.notifications
        .create({
          userId: uid,
          type: 'CLARIFICATION',
          title: `【第${doc.version}次澄清】${project.name}`,
          content: `${doc.title}——请登录供应商门户「澄清与修改」及时查看下载。`,
        })
        .catch((err) => this.logger.warn(`通知发送失败 u=${uid}: ${err.message}`));
      notified += 1;
    }
    return notified;
  }

  /** B-014：发布置顶澄清公告（同步进入公共门户公告流）。 */
  private async publishClarifyNotice(
    project: { id: string; name: string; projectCode: string },
    doc: { id: string; version: number; title: string; content: string },
    authorId?: string,
    companyStamp: { companyId?: string; companyName?: string } = {},
  ): Promise<void> {
    await this.announcements
      .create(
        {
          title: `【澄清与修改】${project.name}（第${doc.version}次）`,
          content: doc.content || doc.title,
          type: 'CLARIFY_NOTICE' as never,
          status: 'PUBLISHED' as never,
          isTop: true,
          relatedProjectCode: project.projectCode,
          metadata: { clarificationVersion: doc.version, docId: doc.id },
        } as never,
        authorId,
        companyStamp,
      )
      .catch((err) => this.logger.error(`澄清公告发布失败: ${err.message}`));
  }

  /** 供应商视角：问答（澄清不涉密，全体可见）+ 已发布澄清文件 + 本人回执。 */
  async listForSupplier(projectId: string, supplierId: string) {
    const [questions, docs, mine] = await Promise.all([
      this.prisma.tenderClarification.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.tenderClarificationDoc.findMany({
        where: { projectId, status: '已发布' },
        orderBy: { version: 'asc' },
      }),
      this.prisma.tenderClarificationReceipt.findMany({
        where: { supplierId, doc: { projectId } },
        select: { docId: true, downloadedAt: true, receiptedAt: true },
      }),
    ]);
    const receiptMap = new Map(mine.map((r) => [r.docId, r]));
    return { questions, docs: docs.map((d) => ({ ...d, receipt: receiptMap.get(d.id) ?? null })) };
  }

  /** A-85/A-86：下载已发布澄清文件（仅已获取招标文件者），下载即回执。 */
  async downloadDoc(projectId: string, docId: string, supplier: { id: string; name: string }) {
    const doc = await this.prisma.tenderClarificationDoc.findUnique({ where: { id: docId } });
    if (!doc || doc.projectId !== projectId || doc.status !== '已发布') {
      throw new BadRequestException({ error: '澄清文件不存在或未发布', code: 'NOT_FOUND' });
    }
    const bid = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierId: supplier.id },
      select: { downloadStatus: true },
    });
    if (!bid || bid.downloadStatus !== '已下载') {
      throw new ForbiddenException({ error: '仅已获取招标文件的供应商可下载澄清文件', code: 'NOT_DOWNLOADED' });
    }
    await this.prisma.tenderClarificationReceipt.upsert({
      where: { docId_supplierId: { docId, supplierId: supplier.id } },
      create: { docId, supplierId: supplier.id },
      update: { receiptedAt: new Date() },
    });
    return {
      id: doc.id,
      version: doc.version,
      title: doc.title,
      content: doc.content,
      fileUrl: doc.fileAssetId ? `/api/upload/files/${doc.fileAssetId}` : null,
    };
  }

  /** A-136：专家视角已发布澄清/修改文件列表（评委核对招标文件澄清修改的法定输入）。 */
  async listDocsForExpert(projectId: string) {
    return this.prisma.tenderClarificationDoc.findMany({
      where: { projectId, status: '已发布' },
      orderBy: { version: 'asc' },
      select: { id: true, version: true, title: true, content: true, publishedAt: true, fileAssetId: true },
    });
  }

  /** A-136：专家下载澄清修改文件。门控=本项目 BidExpert；附件服务端流式直出（明文件，无信封，
   *  不经 /upload 下载授权链）；下载写监督日志。无附件（纯正文）同样留痕返回正文。 */
  async downloadDocForExpert(projectId: string, docId: string, expertUserId: string) {
    const doc = await this.prisma.tenderClarificationDoc.findUnique({ where: { id: docId } });
    if (!doc || doc.projectId !== projectId || doc.status !== '已发布') {
      throw new BadRequestException({ error: '澄清文件不存在或未发布', code: 'NOT_FOUND' });
    }
    const expert = await this.prisma.bidExpert.findFirst({
      where: { projectId, userId: expertUserId },
      select: { expertName: true },
    });
    if (!expert) throw new ForbiddenException({ error: '仅本项目评标专家可下载', code: 'NOT_PROJECT_EXPERT' });

    const log = () =>
      this.prisma.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '评审专家', target: expert.expertName,
          action: '下载澄清修改文件', result: `v${doc.version} ${doc.title}`, riskFlag: '无',
        },
      });

    if (doc.fileAssetId) {
      const asset = await this.prisma.fileAsset.findUnique({ where: { id: doc.fileAssetId } });
      if (asset) {
        const objStream = await minioClient.getObject(MINIO_BUCKET, asset.key);
        const buffer = await streamToBuffer(objStream);
        await log();
        return {
          buffer, fileName: asset.originalName, mimeType: asset.mimeType ?? 'application/octet-stream',
          title: doc.title, version: doc.version, content: doc.content,
        };
      }
    }
    await log();
    return { buffer: null, fileName: null, mimeType: null, title: doc.title, version: doc.version, content: doc.content };
  }
}
