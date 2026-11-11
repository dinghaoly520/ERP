import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CHANGE_FIELD_GROUPS, FORBIDDEN_FIELDS, findFieldGroup, stageReached } from './change-fields';
import { ProjectManagementService } from './project-management.service';

/** 项目变更登记服务（2026-11-11 spec §3/§4）——项目基本信息唯一人工编辑通道。
 *  每次变更/补遗一条 ProjectChangeRecord：轮次项目内自增（两类共序）、字段级 diff、必填理由。
 *  例外（spec §2）：供应商/专家名单不在白名单；系统提取写入走既有端点不经此。 */
@Injectable()
export class ProjectChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pmiService: ProjectManagementService,
  ) {}

  /** Date → PMI 中文开标时间（固定 +08 墙钟——beijing-wallclock 裁定，禁本地时区构造） */
  private static formatBeijingCn(d: Date): string {
    const p = (x: number) => String(x).padStart(2, '0');
    const bj = new Date(d.getTime() + 8 * 3600_000);
    return `${bj.getUTCFullYear()}年${bj.getUTCMonth() + 1}月${bj.getUTCDate()}日 ${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}`;
  }

  async register(
    projectId: string,
    operatorId: string,
    operatorName: string,
    dto: { type: 'CHANGE' | 'ADDENDUM'; reason: string; fields: Record<string, string | number | null> },
  ): Promise<{ record: { id: string; round: number; type: string; changeset: unknown }; needsAnnouncement: boolean }> {
    const reason = (dto.reason ?? '').trim();
    if (!reason) {
      throw new BadRequestException({ error: '请填写变更理由', code: 'REASON_REQUIRED' });
    }

    const pmi = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      include: { stages: { select: { stageKey: true } } },
    });
    if (!pmi) throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });

    // 当前轮未终局的 BidProject（标段分区闸判定依据，2026-11-12 用户裁定：
    // 开标确认前标后锁死；开标确认后标前锁死）
    const bp = await this.prisma.bidProject.findFirst({
      where: { projectManagementItemId: projectId, stage: { notIn: ['ABORTED'] } },
      orderBy: { round: 'desc' },
      select: { id: true, stage: true },
    });
    const bidOpened = !!bp && ['OPENING', 'EVALUATING', 'ARCHIVED'].includes(bp.stage);

    const stageKeys = pmi.stages.map(s => s.stageKey);
    const pmiData: Record<string, unknown> = {};
    const diffs: Array<{ field: string; label: string; from: string; to: string; stageKey: string }> = [];
    let needsAnnouncement = false;

    if (dto.type === 'CHANGE') {
      for (const [field, raw] of Object.entries(dto.fields ?? {})) {
        if ((FORBIDDEN_FIELDS as readonly string[]).includes(field)) {
          throw new BadRequestException({
            error: `「${field}」属供应商/专家名单，请在对应流程卡（供应商邀请/专家抽取）中维护，不走变更`,
            code: 'FIELD_NOT_ALLOWED',
          });
        }
        const group = findFieldGroup(field);
        if (!group) {
          throw new BadRequestException({ error: `字段「${field}」不在可变更范围`, code: 'FIELD_NOT_ALLOWED' });
        }
        const def = group.fields.find(f => f.field === field)!;
        // 标段分区闸：标前（basic/采购文件）开标确认后锁死；标后（定标/合同）开标确认前锁死
        if (group.zone === 'pre' && bidOpened) {
          throw new BadRequestException({ error: '开标后不可修改标前数据', code: 'BID_LOCKED' });
        }
        if (group.zone === 'post' && !bidOpened) {
          throw new BadRequestException({ error: '开标确认前，不能编辑标后', code: 'POST_BID_LOCKED' });
        }
        if (group.zone === 'pre' && !stageReached(stageKeys, pmi.currentStage, group.stageKey)) {
          throw new BadRequestException({
            error: `未进入 ${group.label} 阶段，不可变更`,
            code: 'STAGE_LOCKED',
          });
        }

        // 现值与目标值归一比对（开标时间统一中文格式；数值统一 Number）
        let from: string;
        let to: string;
        if (field === 'bidOpeningTime') {
          const d = new Date(String(raw));
          if (Number.isNaN(d.getTime())) {
            throw new BadRequestException({ error: '开标时间格式不正确', code: 'BAD_FIELD_VALUE' });
          }
          from = (pmi as Record<string, unknown>).bidOpeningTime as string ?? '';
          to = ProjectChangeService.formatBeijingCn(d);
          pmiData.bidOpeningTime = to;
          needsAnnouncement = true;
        } else {
          from = String((pmi as Record<string, unknown>)[field] ?? '');
          to = def.kind === 'number' ? String(Number(raw)) : String(raw ?? '');
          (pmiData as Record<string, unknown>)[field] = def.kind === 'number' ? Number(raw) : to;
        }
        if (from === to) continue; // 同值跳过；全表无差异 → NO_CHANGE
        diffs.push({ field, label: def.label, from, to, stageKey: group.stageKey });
      }
      if (diffs.length === 0) {
        throw new BadRequestException({ error: '所填内容与当前值一致，无变更可登记', code: 'NO_CHANGE' });
      }
    }

    // 操作人留痕：displayName 优先（调用方传名缺省时回查）
    const operator = operatorName || (await this.prisma.user.findUnique({
      where: { id: operatorId },
      select: { displayName: true },
    }))?.displayName || operatorId;

    const maxRound = await this.prisma.projectChangeRecord.aggregate({
      where: { projectManagementItemId: projectId },
      _max: { round: true },
    });
    const round = (maxRound._max.round ?? 0) + 1;

    // 业务表写入与登记同事务（留痕与数据一致）；开标时间同步在事务外走既有 sync（幂等、失败不阻断）
    const record = await this.prisma.$transaction(async (tx) => {
      if (Object.keys(pmiData).length > 0) {
        await tx.projectManagementItem.update({ where: { id: projectId }, data: pmiData });
      }
      return tx.projectChangeRecord.create({
        data: {
          projectManagementItemId: projectId,
          round,
          type: dto.type,
          reason,
          changeset: diffs as unknown as object[],
          needsAnnouncement,
          operatorId,
          operatorName: operator,
        },
      });
    });

    if (pmiData.bidOpeningTime) {
      await this.pmiService.syncBidProjectOpeningFromPmi(projectId, pmiData.bidOpeningTime as string);
    }

    return { record, needsAnnouncement };
  }

  /** 变更流水（round 倒序；弹窗记录视图数据源） */
  async list(projectId: string) {
    return this.prisma.projectChangeRecord.findMany({
      where: { projectManagementItemId: projectId },
      orderBy: { round: 'desc' },
      take: 100,
    });
  }

  /** 变更公告发布后回填关联（闭环「公告待发」状态） */
  async bindAnnouncement(recordId: string, announcementId: string) {
    await this.prisma.projectChangeRecord.update({
      where: { id: recordId },
      data: { announcementId },
    });
  }
}
