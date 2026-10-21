import { Injectable, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * C6（GB/T 43711 4.1.4 / 4.2.2）：供应商异议/投诉工单（登记制）。
 * 供应商对采购文件、资格预审结果、采购结果有异议的，通过本工单在线提出；采购人在线受理答复；
 * 对答复不满意的可转投诉（escalate）——投诉由监管部门线下处理，处理结果登记回工单。
 * 全程留痕：状态流转均写 AuditLog 由控制器负责，本服务负责业务与通知。
 *
 * 归属公司（2026-10-21）：供应商提交时自选归属公司（限本人 APPROVED SupplierCompanyLink，
 * 单归属自动落）——异议只出现在归属公司的 leader 受理板；管理端读写两端按公司过滤，
 * 存量 null=未归属仅 admin 可见可操作。
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
    private companyScope: CompanyScopeService,
  ) {}

  private assertPhase(phase: string): asserts phase is Phase {
    if (!PHASES.includes(phase as Phase)) {
      throw new BadRequestException({ error: `异议类型不合法（${PHASES.join('|')}）`, code: 'BAD_PHASE' });
    }
  }

  /** 供应商提交异议（4.2.2.1）。归属公司：多归属须显式选择（仅限本人 APPROVED 链接），单归属自动落 */
  async create(dto: {
    announcementId?: string; projectCode?: string; phase: string; title: string; content: string; attachments?: any; companyId?: string;
  }, supplier: { id: string; name: string; userId: string }) {
    this.assertPhase(dto.phase);
    if (!dto.title?.trim() || !dto.content?.trim()) {
      throw new BadRequestException({ error: '请填写异议标题与具体内容', code: 'EMPTY_CONTENT' });
    }

    // 归属公司解析（服务端权威校验，防伪造）：候选=本人 APPROVED SupplierCompanyLink
    const links = await this.prisma.supplierCompanyLink.findMany({
      where: { supplierId: supplier.id, status: 'APPROVED' },
      select: { companyId: true, company: { select: { name: true } } },
    });
    const wanted = dto.companyId?.trim() || '';
    let target = links.find(l => l.companyId === wanted) ?? null;
    if (!target && !wanted && links.length === 1) target = links[0]; // 单归属自动落
    if (!target) {
      throw new BadRequestException({
        error: wanted
          ? '所选公司不在您的归属公司列表内（仅限已通过审核的公司归属）'
          : links.length > 0
            ? '请选择本异议归属的公司（您加入了多家公司库）'
            : '您当前没有已通过审核的公司归属，无法提交异议（请联系采购方处理公司归属）',
        code: 'OBJECTION_COMPANY_REQUIRED',
      });
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
        companyId: target.companyId,
        companyName: target.company.name,
      },
    });
  }

  /** 供应商：我的异议列表（分页 + 状态筛选；2026-09-28 替换全量返回） */
  async listMine(supplierId: string, params: { page?: number; pageSize?: number; status?: string } = {}) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 10));
    const where: { supplierId: string; status?: string } = { supplierId };
    if (params.status) where.status = params.status;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.supplierObjection.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supplierObjection.count({ where }),
    ]);
    return { items, total };
  }

  /** 管理端：异议列表（可筛选；按归属公司过滤 2026-10-21——admin 全部/可 ?companyId= 切单公司，
   *  非 admin 仅本公司；未归属 null 仅 admin 可见）。入口按钮 :3005 已收窄 leader-only。 */
  async listAdmin(
    params: { status?: string; phase?: string; q?: string; companyId?: string },
    user?: { sub: string; role: string; companyId?: string | null },
  ) {
    const scope = await this.companyScope.resolveScope(user as any);
    // admin：全部（?companyId= 切单公司）；非 admin：本公司集合（in:[] 空集=无归属账号自然不可见）
    const where: any = scope.all
      ? (params.companyId && params.companyId !== 'all' ? { companyId: params.companyId } : {})
      : { companyId: { in: scope.companyIds } };
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

  /** 受理可见性闸：非 admin 只能操作本公司归属的异议（null=未归属仅 admin） */
  private async assertCompanyVisible(objectionId: string, user: { sub: string; role: string; companyId?: string | null }) {
    const objection = await this.prisma.supplierObjection.findUnique({ where: { id: objectionId } });
    if (!objection) throw new BadRequestException({ error: '工单不存在', code: 'NOT_FOUND' });
    const scope = await this.companyScope.resolveScope(user as any);
    if (!scope.all && objection.companyId && !scope.companyIds.includes(objection.companyId)) {
      throw new ForbiddenException({ error: '该异议归属其他公司，无权受理', code: 'COMPANY_SCOPE_FORBIDDEN' });
    }
    if (!scope.all && !objection.companyId) {
      throw new ForbiddenException({ error: '该异议未归属公司，请联系管理员处理', code: 'OBJECTION_UNSCOPED' });
    }
    return objection;
  }

  /** 采购人在线答复（4.1.4.1）——答复即通知供应商；非 admin 限本公司归属 */
  async answer(id: string, answer: string, operator: { userId: string; username: string }, actor?: { sub: string; role: string; companyId?: string | null }) {
    if (!answer?.trim()) throw new BadRequestException({ error: '请填写答复内容', code: 'EMPTY_ANSWER' });
    const objection = actor ? await this.assertCompanyVisible(id, actor) : await this.prisma.supplierObjection.findUnique({ where: { id } });
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
        type: 'OBJECTION_ANSWERED',
        title: '异议答复通知',
        content: `您提交的异议「${objection.title}」已有答复，请前往异议页查看。`,
        link: '/objections',
      });
    } catch (e) {
      this.logger.warn(`异议答复通知发送失败 objectionId=${id}: ${(e as Error).message}`);
    }
    return updated;
  }

  /** 转投诉（4.2.2.2）：供应商对答复不满意 → 升级为投诉，移交监管处理（线下），结果登记回来 */
  async escalate(id: string, note: string, actor?: { sub: string; role: string; companyId?: string | null }) {
    const objection = actor ? await this.assertCompanyVisible(id, actor) : await this.prisma.supplierObjection.findUnique({ where: { id } });
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
  async close(id: string, note: string, operator: { userId: string; username: string }, actor?: { sub: string; role: string; companyId?: string | null }) {
    const objection = actor ? await this.assertCompanyVisible(id, actor) : await this.prisma.supplierObjection.findUnique({ where: { id } });
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
