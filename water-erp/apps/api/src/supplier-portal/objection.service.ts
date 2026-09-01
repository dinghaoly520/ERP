import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

/**
 * C6（GB/T 43711 4.1.4 / 4.2.2）：供应商异议/投诉工单（登记制）。
 * 供应商对采购文件、资格预审结果、采购结果有异议的，通过本工单在线提出；采购人在线受理答复；
 * 对答复不满意的可转投诉（escalate）——投诉由监管部门线下处理，处理结果登记回工单。
 * 全程留痕：状态流转均写 AuditLog 由控制器负责，本服务负责业务与通知。
 */

// GB/T 43711 + 平台实践：覆盖全流程异议与投诉场景（result 走公示期窗口校验，其余即收）
const PHASES = ['document', 'prequalification', 'result', 'procedure', 'evaluation', 'contract', 'service', 'other'] as const;
type Phase = (typeof PHASES)[number];

@Injectable()
export class ObjectionService {
  private readonly logger = new Logger(ObjectionService.name);

  constructor(
    private prisma: PrismaService,
    private notification: NotificationService,
  ) {}

  private assertPhase(phase: string): asserts phase is Phase {
    if (!PHASES.includes(phase as Phase)) {
      throw new BadRequestException({ error: `异议类型不合法（${PHASES.join('|')}）`, code: 'BAD_PHASE' });
    }
  }

  /** 供应商提交异议（4.2.2.1） */
  async create(dto: {
    announcementId?: string; projectCode?: string; phase: string; title: string; content: string; attachments?: any;
  }, supplier: { id: string; name: string; userId: string }) {
    this.assertPhase(dto.phase);
    if (!dto.title?.trim() || !dto.content?.trim()) {
      throw new BadRequestException({ error: '请填写异议标题与具体内容', code: 'EMPTY_CONTENT' });
    }

    // 异议对象必须可定位：公告 ID 或业务编号至少其一
    let projectId: string | null = null;
    let relatedCode: string | null = null;
    if (dto.announcementId) {
      const ann = await this.prisma.announcement.findUnique({
        where: { id: dto.announcementId },
        select: { id: true, relatedProjectCode: true },
      });
      if (!ann) throw new BadRequestException({ error: '异议对象公告不存在', code: 'ANN_NOT_FOUND' });
      relatedCode = ann.relatedProjectCode ?? null;
    }

    // 4.1.4.1/4.2.2.1：异议应在采购文件约定的时间内提出——
    // 结果异议（result）默认窗口 = 预成交公示期；公示期满后引导走投诉渠道（escalate 登记制）
    if (dto.phase === 'result') {
      const code = dto.projectCode?.trim() || relatedCode;
      const notice = code
        ? await this.prisma.announcement.findFirst({
            where: { relatedProjectCode: code, type: { in: ['PRE_WIN_NOTICE', 'WIN_NOTICE'] } },
            orderBy: { createdAt: 'desc' },
            select: { publicityEnd: true },
          })
        : null;
      if (notice?.publicityEnd && new Date() > new Date(notice.publicityEnd)) {
        throw new BadRequestException({
          error: `结果异议应在预成交公示期内提出（公示截止 ${new Date(notice.publicityEnd).toLocaleDateString('zh-CN')}，GB/T 43711 4.2.2.1）；如对结果仍有异议，请通过异议工单备注说明并联系采购人转投诉处理`,
          code: 'OBJECTION_WINDOW_CLOSED',
        });
      }
    }
    const code = dto.projectCode?.trim() || null;
    if (code) {
      const project = await this.prisma.bidProject.findUnique({ where: { projectCode: code }, select: { id: true } });
      projectId = project?.id ?? null;
    }

    return this.prisma.supplierObjection.create({
      data: {
        announcementId: dto.announcementId ?? null,
        projectId,
        projectCode: code,
        supplierId: supplier.id,
        supplierName: supplier.name,
        userId: supplier.userId,
        phase: dto.phase,
        title: dto.title.trim(),
        content: dto.content.trim(),
        attachments: dto.attachments ?? null,
      },
    });
  }

  /** 供应商：我的异议列表 */
  listMine(supplierId: string) {
    return this.prisma.supplierObjection.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 管理端：异议列表（可筛选） */
  listAdmin(params: { status?: string; phase?: string; q?: string }) {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.phase) where.phase = params.phase;
    if (params.q) {
      where.OR = [
        { title: { contains: params.q, mode: 'insensitive' } },
        { supplierName: { contains: params.q, mode: 'insensitive' } },
        { projectCode: { contains: params.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.supplierObjection.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  /** 采购人在线答复（4.1.4.1）——答复即通知供应商 */
  async answer(id: string, answer: string, operator: { userId: string; username: string }) {
    if (!answer?.trim()) throw new BadRequestException({ error: '请填写答复内容', code: 'EMPTY_ANSWER' });
    const objection = await this.prisma.supplierObjection.findUnique({ where: { id } });
    if (!objection) throw new BadRequestException({ error: '工单不存在', code: 'NOT_FOUND' });
    if (objection.status === 'closed') throw new BadRequestException({ error: '工单已办结，不可再答复', code: 'CLOSED' });

    const updated = await this.prisma.supplierObjection.update({
      where: { id },
      data: {
        answer: answer.trim(),
        status: 'answered',
        answeredBy: operator.userId,
        answeredByName: operator.username,
        answeredAt: new Date(),
      },
    });

    try {
      await this.notification.create({
        userId: objection.userId,
        type: 'SYSTEM',
        title: '异议答复通知',
        content: `您提交的异议「${objection.title}」已有答复，请前往供应商门户异议页查看。`,
        link: '/objections',
      });
    } catch (e) {
      this.logger.warn(`异议答复通知发送失败 objectionId=${id}: ${(e as Error).message}`);
    }
    return updated;
  }

  /** 转投诉（4.2.2.2）：供应商对答复不满意 → 升级为投诉，移交监管处理（线下），结果登记回来 */
  async escalate(id: string, note: string) {
    const objection = await this.prisma.supplierObjection.findUnique({ where: { id } });
    if (!objection) throw new BadRequestException({ error: '工单不存在', code: 'NOT_FOUND' });
    if (objection.status !== 'answered') {
      throw new BadRequestException({ error: '仅已答复的异议可转投诉', code: 'NOT_ANSWERED' });
    }
    return this.prisma.supplierObjection.update({
      where: { id },
      data: { status: 'complaint', escalatedAt: new Date(), escalationNote: note?.trim() || null },
    });
  }

  /** 投诉处理结果登记 / 办结 */
  async close(id: string, note: string, operator: { userId: string; username: string }) {
    const objection = await this.prisma.supplierObjection.findUnique({ where: { id } });
    if (!objection) throw new BadRequestException({ error: '工单不存在', code: 'NOT_FOUND' });
    return this.prisma.supplierObjection.update({
      where: { id },
      data: {
        status: 'closed',
        escalationNote: note?.trim() ? `${objection.escalationNote ? objection.escalationNote + '\n' : ''}处理结果：${note.trim()}` : objection.escalationNote,
        // 办结人复用答复人字段留痕（不新增列）
        answeredBy: operator.userId,
        answeredByName: operator.username,
        answeredAt: objection.answeredAt ?? new Date(),
      },
    });
  }
}
