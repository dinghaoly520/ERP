// apps/api/src/platform-push/platform-push.service.ts
// 对接专项 Phase 1（doc §二/§三/§四）：pending 聚合 + 中间信封序列化 + 人工确认制
// dispatch/export（hash 校验/幂等三元组/stub 501/mock 演示/offline 导出三件套）+ 台账。
import {
  BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformPushLog as PlatformPushLogRow } from '@prisma/client';
import {
  ANNOUNCEMENT_TYPE_TO_ITEM_TYPE, PUSHABLE_ANNOUNCEMENT_TYPES, payloadFingerprint,
  PlatformPushEnvelope, PushChannelCode, PushItemType, PushMaskOptions,
} from './platform-push-payload';
import { PushChannel, PushChannelDispatchResult } from './push-channel.interface';
import { ScProvinceChannel } from './channels/sc-province.channel';
import { CebNationalChannel } from './channels/ceb-national.channel';
import { MwrWaterChannel } from './channels/mwr-water.channel';
import { MockChannel } from './channels/mock.channel';
import { OfflineExportChannel } from './channels/offline.export-channel';
import {
  DispatchPushDto, ExportPushDto, ITEM_ID_PATTERN, PendingQueryDto, PreviewPushDto,
} from './dto/platform-push.dto';

/** 待推数据项（内部统一形态：pending 行展示 / preview·dispatch·export 序列化同源） */
export interface PushItem {
  itemId: string;
  itemType: PushItemType;
  title: string;
  projectId: string | null;
  projectCode: string | null;
  gbProcureCode: string | null;
  /** 映射完整度缺口（缺 gbProcureCode / 缺 publishDate 等；非空 = 禁推） */
  missing: string[];
  announcement?: {
    type: string; title: string; content: string;
    publishDate: Date | null; publicityEnd: Date | null; relatedProjectCode: string | null;
    metadata: unknown;
  } | null;
  contract?: {
    contractCode: string; supplierName: string; amount: { toString(): string } | null;
    signedAt: Date | null; contractType: string; status: string;
  } | null;
  penalty?: {
    supplierName: string; penaltyDocNo: string; authority: string;
    decisionDate: Date; penaltyContent: string; publicUntil: Date | null;
  } | null;
  project?: {
    procurementMethod: string; deadline: Date; openTime: Date;
    ceilingPrice: { toString(): string } | null; budget: { toString(): string } | null;
  } | null;
}

interface PreparedItem { item: PushItem; envelope: PlatformPushEnvelope; hash: string; }

const dec = (d: { toString(): string } | null | undefined): string | null => (d == null ? null : d.toString());
const iso = (d: Date | null | undefined): string | null => (d == null ? null : d.toISOString());

@Injectable()
export class PlatformPushService {
  private readonly logger = new Logger(PlatformPushService.name);
  private readonly channels: ReadonlyMap<PushChannelCode, PushChannel>;

  constructor(
    private readonly prisma: PrismaService,
    scProvince: ScProvinceChannel,
    cebNational: CebNationalChannel,
    mwrWater: MwrWaterChannel,
    mock: MockChannel,
    offline: OfflineExportChannel,
  ) {
    this.channels = new Map([scProvince, cebNational, mwrWater, mock, offline].map((c) => [c.code, c]));
  }

  // ── 待推清单（doc §五：信息类别/编号/映射完整度/历史推送态）──

  async pending(query: PendingQueryDto) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: query.projectId } });
    if (!project) throw new NotFoundException({ error: '项目不存在', code: 'PROJECT_NOT_FOUND' });

    const announcements = await this.prisma.announcement.findMany({
      where: { relatedProjectCode: project.projectCode, status: 'PUBLISHED', type: { in: PUSHABLE_ANNOUNCEMENT_TYPES } },
      orderBy: [{ publishDate: 'desc' }, { createdAt: 'desc' }],
    });
    const contracts = await this.prisma.contract.findMany({
      where: { projectCode: project.projectCode },
      orderBy: { createdAt: 'desc' },
    });
    // 处罚信息全局行（doc §三 #9：SupplierPenalty 平台级数据，不挂项目——penalty 行 projectId 留空）
    const penalties = await this.prisma.supplierPenalty.findMany({
      include: { supplier: { select: { name: true } } },
      orderBy: { decisionDate: 'desc' },
      take: 100,
    });

    const items = [
      ...announcements.map((a) => this.announcementToItem(a, project)),
      ...contracts.map((c) => this.contractToItem(c, project)),
      ...penalties.map((p) => this.penaltyToItem(p, p.supplier.name)),
    ];

    const itemIds = items.map((i) => i.itemId);
    const logs = itemIds.length
      ? await this.prisma.platformPushLog.findMany({ where: { itemId: { in: itemIds } }, orderBy: { createdAt: 'desc' } })
      : [];
    const lastPush = new Map<string, { channel: string; status: string; createdAt: Date; responseSnippet: string | null }>();
    for (const l of logs) {
      if (!lastPush.has(l.itemId)) {
        lastPush.set(l.itemId, { channel: l.channel, status: l.status, createdAt: l.createdAt, responseSnippet: l.responseSnippet });
      }
    }

    return {
      project: { id: project.id, projectCode: project.projectCode, name: project.name, gbProcureCode: project.gbProcureCode },
      channels: [...this.channels.values()].map((c) => ({ code: c.code, title: c.title, connected: c.connected })),
      items: items.map((i) => ({
        itemId: i.itemId, itemType: i.itemType, title: i.title,
        ready: i.missing.length === 0, missing: i.missing,
        lastPush: lastPush.get(i.itemId) ?? null,
      })),
    };
  }

  // ── 预览（人工确认制第一步：payload + 脱敏 + 指纹）──

  async preview(dto: PreviewPushDto) {
    const items = await this.loadItems(dto.itemIds);
    this.assertNotReady(items);
    const out: { itemId: string; itemType: PushItemType; envelope: PlatformPushEnvelope; payloadHash: string }[] = [];
    for (const item of items) {
      const envelope = await this.serialize(item, dto.mask);
      out.push({ itemId: item.itemId, itemType: item.itemType, envelope, payloadHash: payloadFingerprint(envelope) });
    }
    return { schema: 'sc-v2-preview', mask: dto.mask ?? {}, items: out };
  }

  // ── 确认推送（doc §二铁律：必须携带 preview 的 payloadHash；stub 501 引导离线导出）──

  async dispatch(dto: DispatchPushDto, actorId: string) {
    const channel = this.channels.get(dto.channel);
    if (!channel) throw new BadRequestException({ error: `未知通道：${dto.channel}`, code: 'INVALID_CHANNEL' });
    if (dto.channel === 'offline') {
      throw new BadRequestException({ error: '离线通道请使用「离线导出」端点（POST /platform-push/export）', code: 'OFFLINE_USE_EXPORT' });
    }
    const prepared = await this.prepareConfirmed(dto, dto.channel);

    // stub 期（省/国家/水利三通道）：逐项落 STUB_REFUSED 台账行，再 501 引导离线导出
    if (!channel.connected) {
      for (const p of prepared) {
        await this.writeLog(p, dto.channel, 'STUB_REFUSED', actorId, { errorMessage: `通道未连通（${channel.title}）` });
      }
      this.writeAudit(actorId, dto.channel, prepared, 'STUB_REFUSED');
      throw new HttpException({
        error: `${channel.title}未连通（省平台接口规约未发布，Phase 2 联调后启用在线推送）；请使用「离线导出」完成报送`,
        code: 'CHANNEL_NOT_CONNECTED',
      }, 501);
    }

    const results: PlatformPushLogRow[] = [];
    for (const p of prepared) {
      let res: PushChannelDispatchResult;
      try {
        res = await channel.dispatch(this.toContext(p, actorId));
      } catch (e) {
        res = { ok: false, errorMessage: ((e as Error).message ?? '通道异常').slice(0, 500) };
      }
      const log = await this.writeLog(p, dto.channel, res.ok ? 'SUCCESS' : 'FAILED', actorId, {
        responseSnippet: res.responseSnippet, errorMessage: res.errorMessage, packetAssetId: res.packetAssetId,
      });
      results.push(log);
      await this.writeSupervisionLog(p, dto.channel, channel.title, log, actorId);
    }
    this.writeAudit(actorId, dto.channel, prepared, 'DONE');
    return { channel: dto.channel, results };
  }

  // ── 离线导出（现役主出口：offline 通道 dispatch → 文件包三件套，status=EXPORTED）──

  async exportItems(dto: ExportPushDto, actorId: string) {
    const prepared = await this.prepareConfirmed(dto, 'offline');
    const channel = this.channels.get('offline')!;
    const results: {
      itemId: string; status: string; packetAssetId: string | null;
      downloadUrl: string | null; log: PlatformPushLogRow;
    }[] = [];
    for (const p of prepared) {
      let res: PushChannelDispatchResult;
      try {
        res = await channel.dispatch(this.toContext(p, actorId));
      } catch (e) {
        res = { ok: false, errorMessage: ((e as Error).message ?? '导出异常').slice(0, 500) };
      }
      const log = await this.writeLog(p, 'offline', res.ok ? 'EXPORTED' : 'FAILED', actorId, {
        responseSnippet: res.responseSnippet, errorMessage: res.errorMessage, packetAssetId: res.packetAssetId,
      });
      results.push({
        itemId: p.item.itemId, status: log.status, packetAssetId: res.packetAssetId ?? null,
        downloadUrl: res.packetAssetId ? `/api/upload/files/${res.packetAssetId}` : null, log,
      });
      await this.writeSupervisionLog(p, 'offline', channel.title, log, actorId);
    }
    this.writeAudit(actorId, 'offline', prepared, 'EXPORTED');
    return { channel: 'offline', results };
  }

  // ── 推送台账 ──

  async status(projectId?: string) {
    const logs = await this.prisma.platformPushLog.findMany({
      where: projectId ? { projectId } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const summary: Record<string, number> = {};
    for (const l of logs) summary[l.status] = (summary[l.status] ?? 0) + 1;
    return { projectId: projectId ?? null, summary, logs };
  }

  // ── 数据项装载与行构造 ──

  /** preview/dispatch/export 入口：逐项解析 itemId 前缀并回源装载（含项目上下文解析） */
  private async loadItems(itemIds: string[]): Promise<PushItem[]> {
    const items: PushItem[] = [];
    for (const raw of [...new Set(itemIds)]) {
      const m = ITEM_ID_PATTERN.exec(raw);
      if (!m) throw new BadRequestException({ error: `数据项 id 格式不合法：${raw}（应为 announcement:/contract:/penalty: 前缀）`, code: 'INVALID_ITEM_ID' });
      const [, kind, id] = m;
      if (kind === 'announcement') {
        const a = await this.prisma.announcement.findUnique({ where: { id } });
        if (!a) throw new NotFoundException({ error: `公告不存在：${raw}`, code: 'ITEM_NOT_FOUND' });
        const itemType = ANNOUNCEMENT_TYPE_TO_ITEM_TYPE[a.type];
        if (!itemType || a.status !== 'PUBLISHED') {
          throw new BadRequestException({ error: `公告不在可推送范围（须为已发布的交易类公告）：${raw}`, code: 'ITEM_NOT_PUSHABLE' });
        }
        const project = a.relatedProjectCode
          ? await this.prisma.bidProject.findUnique({ where: { projectCode: a.relatedProjectCode } })
          : null;
        items.push(this.announcementToItem(a, project));
      } else if (kind === 'contract') {
        const c = await this.prisma.contract.findUnique({ where: { id } });
        if (!c) throw new NotFoundException({ error: `合同不存在：${raw}`, code: 'ITEM_NOT_FOUND' });
        const project = c.projectId
          ? await this.prisma.bidProject.findUnique({ where: { id: c.projectId } })
          : await this.prisma.bidProject.findUnique({ where: { projectCode: c.projectCode } });
        items.push(this.contractToItem(c, project));
      } else {
        const p = await this.prisma.supplierPenalty.findUnique({
          where: { id }, include: { supplier: { select: { name: true } } },
        });
        if (!p) throw new NotFoundException({ error: `处罚记录不存在：${raw}`, code: 'ITEM_NOT_FOUND' });
        items.push(this.penaltyToItem(p, p.supplier.name));
      }
    }
    return items;
  }

  private announcementToItem(a: {
    id: string; type: keyof typeof ANNOUNCEMENT_TYPE_TO_ITEM_TYPE; title: string; content: string;
    publishDate: Date | null; publicityEnd: Date | null; relatedProjectCode: string | null; metadata: unknown;
  }, project: {
    id: string; projectCode: string; gbProcureCode: string | null;
    procurementMethod: string; deadline: Date; openTime: Date;
    ceilingPrice: { toString(): string } | null; budget: { toString(): string } | null;
  } | null): PushItem {
    const missing: string[] = [];
    if (!project?.gbProcureCode) missing.push('gbProcureCode');
    if (!a.publishDate) missing.push('publishDate');
    return {
      itemId: `announcement:${a.id}`,
      itemType: ANNOUNCEMENT_TYPE_TO_ITEM_TYPE[a.type]!,
      title: a.title,
      projectId: project?.id ?? null,
      projectCode: project?.projectCode ?? a.relatedProjectCode,
      gbProcureCode: project?.gbProcureCode ?? null,
      missing,
      announcement: {
        type: String(a.type), title: a.title, content: a.content,
        publishDate: a.publishDate, publicityEnd: a.publicityEnd,
        relatedProjectCode: a.relatedProjectCode, metadata: a.metadata,
      },
      project: project ? {
        procurementMethod: project.procurementMethod, deadline: project.deadline, openTime: project.openTime,
        ceilingPrice: project.ceilingPrice, budget: project.budget,
      } : null,
    };
  }

  private contractToItem(c: {
    id: string; contractCode: string; supplierName: string; amount: { toString(): string } | null;
    signedAt: Date | null; contractType: string; status: string; projectCode: string; projectId: string | null;
  }, project: {
    id: string; projectCode: string; gbProcureCode: string | null;
  } | null): PushItem {
    const missing: string[] = [];
    if (!project?.gbProcureCode) missing.push('gbProcureCode');
    if (c.amount == null) missing.push('amount');
    if (!c.signedAt) missing.push('signedAt');
    return {
      itemId: `contract:${c.id}`,
      itemType: 'contract',
      title: `${c.contractCode}（${c.supplierName}）`,
      projectId: project?.id ?? c.projectId ?? null,
      projectCode: project?.projectCode ?? c.projectCode,
      gbProcureCode: project?.gbProcureCode ?? null,
      missing,
      contract: {
        contractCode: c.contractCode, supplierName: c.supplierName, amount: c.amount,
        signedAt: c.signedAt, contractType: c.contractType, status: c.status,
      },
    };
  }

  private penaltyToItem(p: {
    id: string; penaltyDocNo: string; authority: string; decisionDate: Date;
    penaltyContent: string; publicUntil: Date | null;
  }, supplierName: string): PushItem {
    // 处罚信息为平台级数据（不挂项目、gbProcureCode 非必需）；结构化字段全 NOT NULL，天然 ready
    return {
      itemId: `penalty:${p.id}`,
      itemType: 'penalty',
      title: `${supplierName}·${p.penaltyDocNo}`,
      projectId: null,
      projectCode: null,
      gbProcureCode: null,
      missing: [],
      penalty: {
        supplierName, penaltyDocNo: p.penaltyDocNo, authority: p.authority,
        decisionDate: p.decisionDate, penaltyContent: p.penaltyContent, publicUntil: p.publicUntil,
      },
    };
  }

  // ── 序列化（中间信封：五通道共享；mask 在此层执行——预览与推送同源）──

  private async serialize(item: PushItem, mask?: PushMaskOptions): Promise<PlatformPushEnvelope> {
    const masked: string[] = [];
    const applyMask = (key: 'ceilingPrice' | 'contractAmount', value: unknown): unknown => {
      if (mask?.[key]) { masked.push(key); return null; }
      return value;
    };
    const fields: Record<string, unknown> = {};

    if (item.contract) {
      const c = item.contract;
      fields.contractCode = c.contractCode;
      fields.supplierName = c.supplierName;
      fields.amount = applyMask('contractAmount', dec(c.amount));
      fields.signedAt = iso(c.signedAt);
      fields.contractType = c.contractType;
      fields.status = c.status;
    } else if (item.penalty) {
      const p = item.penalty;
      fields.supplierName = p.supplierName;
      fields.penaltyDocNo = p.penaltyDocNo;
      fields.authority = p.authority;
      fields.decisionDate = iso(p.decisionDate);
      fields.penaltyContent = p.penaltyContent;
      fields.publicUntil = iso(p.publicUntil);
    } else if (item.announcement) {
      const a = item.announcement;
      fields.content = a.content;
      switch (item.itemType) {
        case 'bid_notice':
          fields.procurementMethod = item.project?.procurementMethod ?? null;
          fields.deadline = iso(item.project?.deadline);
          fields.openTime = iso(item.project?.openTime);
          fields.ceilingPrice = applyMask('ceilingPrice', dec(item.project?.ceilingPrice));
          fields.budget = dec(item.project?.budget);
          break;
        case 'failed_bid':
          fields.relatedProjectCode = a.relatedProjectCode;
          fields.category = (a.metadata as Record<string, unknown> | null)?.category ?? null;
          break;
        case 'pre_win': {
          fields.relatedProjectCode = a.relatedProjectCode;
          fields.publicityEnd = iso(a.publicityEnd);
          fields.candidates = await this.evaluationSnapshot(item.projectId, 'candidates');
          break;
        }
        case 'win':
          fields.relatedProjectCode = a.relatedProjectCode;
          fields.winner = await this.evaluationSnapshot(item.projectId, 'winner');
          break;
        default: // clarify / contract / fulfillment / prequal：直接映射+关联编号
          fields.relatedProjectCode = a.relatedProjectCode;
      }
    }

    const publishedAt = item.announcement?.publishDate
      ?? item.contract?.signedAt
      ?? item.penalty?.decisionDate
      ?? null;
    return {
      itemType: item.itemType,
      schema: 'sc-v2-preview',
      projectCode: item.projectCode,
      gbProcureCode: item.gbProcureCode,
      title: item.title,
      publishedAt: iso(publishedAt),
      fields,
      masked,
    };
  }

  /** 候选人名单（pre_win：recommended 行）/ 中标人（win：rank1）——doc §三 #5/#6；专家名单按 A-134 保密口径不推 */
  private async evaluationSnapshot(projectId: string | null, kind: 'candidates' | 'winner') {
    if (!projectId) return null;
    const rows = await this.prisma.bidEvaluationResult.findMany({ where: { projectId }, orderBy: { rank: 'asc' } });
    const toRow = (r: { supplierName: string; rank: number; bidPrice: { toString(): string } | null; totalScore: { toString(): string } }) => ({
      supplierName: r.supplierName, rank: r.rank, bidPrice: dec(r.bidPrice), totalScore: dec(r.totalScore),
    });
    if (kind === 'winner') {
      const first = rows.find((r) => r.rank === 1 && !r.disqualified);
      return first ? toRow(first) : null;
    }
    return rows.filter((r) => r.recommended && !r.disqualified).map(toRow);
  }

  // ── 确认链公共段：装载 → 完整度闸 → 逐项 hash 校验（PAYLOAD_DRIFT）→ 幂等预检（ALREADY_PUSHED）──

  private async prepareConfirmed(
    dto: PreviewPushDto & { payloadHashes: { itemId: string; payloadHash: string }[] },
    channel: PushChannelCode,
  ): Promise<PreparedItem[]> {
    const items = await this.loadItems(dto.itemIds);
    this.assertNotReady(items);

    const expected = new Map<string, string>();
    for (const h of dto.payloadHashes) {
      expected.set(h.itemId, h.payloadHash);
    }
    const prepared: PreparedItem[] = [];
    const drift: string[] = [];
    for (const item of items) {
      if (!expected.has(item.itemId)) {
        throw new BadRequestException({ error: `缺少 ${item.itemId} 的 payloadHash（人工确认制：必须携带 preview 返回的指纹）`, code: 'PAYLOAD_HASH_MISSING' });
      }
      const envelope = await this.serialize(item, dto.mask);
      const hash = payloadFingerprint(envelope);
      if (expected.get(item.itemId) !== hash) drift.push(item.itemId);
      prepared.push({ item, envelope, hash });
    }
    if (drift.length) {
      throw new BadRequestException({
        error: `载荷指纹不一致（${drift.join('、')}）——预览后数据已变化，请重新预览确认`,
        code: 'PAYLOAD_DRIFT', itemIds: drift,
      });
    }

    // 幂等三元组（channel+itemId+payloadSha256）预检：命中即 409（并发竞态由 create P2002 兜底）
    const existing = await this.prisma.platformPushLog.findMany({
      where: {
        channel, itemId: { in: prepared.map((p) => p.item.itemId) },
        payloadSha256: { in: prepared.map((p) => p.hash) },
      },
      select: { itemId: true },
    });
    if (existing.length) {
      const ids = [...new Set(existing.map((e) => e.itemId))];
      throw new ConflictException({
        error: `以下数据项在通道 ${channel} 已按相同载荷处理过：${ids.join('、')}（幂等三元组：通道+数据项+载荷指纹）`,
        code: 'ALREADY_PUSHED', itemIds: ids,
      });
    }
    return prepared;
  }

  private assertNotReady(items: PushItem[]) {
    const notReady = items.filter((i) => i.missing.length > 0);
    if (notReady.length) {
      throw new BadRequestException({
        error: `映射不完整禁推：${notReady.map((i) => `${i.itemId} 缺 ${i.missing.join('/')}`).join('；')}`,
        code: 'ITEM_NOT_READY',
        items: notReady.map((i) => ({ itemId: i.itemId, missing: i.missing })),
      });
    }
  }

  // ── 留痕（每项 PlatformPushLog + 监督日志；每请求一行 AuditLog）──

  private toContext(p: PreparedItem, actorId: string) {
    return {
      itemId: p.item.itemId, itemType: p.item.itemType, title: p.item.title,
      projectId: p.item.projectId, projectCode: p.item.projectCode,
      envelope: p.envelope, actorId,
    };
  }

  private async writeLog(
    p: PreparedItem, channel: PushChannelCode,
    status: 'SUCCESS' | 'FAILED' | 'EXPORTED' | 'STUB_REFUSED', actorId: string,
    extra: { responseSnippet?: string; errorMessage?: string; packetAssetId?: string } = {},
  ) {
    const attemptNo = (await this.prisma.platformPushLog.count({ where: { channel, itemId: p.item.itemId } })) + 1;
    try {
      return await this.prisma.platformPushLog.create({
        data: {
          channel, itemType: p.item.itemType, itemId: p.item.itemId,
          projectId: p.item.projectId, projectCode: p.item.projectCode,
          status, payloadSha256: p.hash,
          responseSnippet: extra.responseSnippet?.slice(0, 2048) ?? null,
          errorMessage: extra.errorMessage?.slice(0, 500) ?? null,
          packetAssetId: extra.packetAssetId ?? null,
          attemptNo, masked: p.envelope.masked, createdById: actorId,
        },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException({
          error: `数据项 ${p.item.itemId} 在通道 ${channel} 已按相同载荷处理过（幂等三元组重复）`,
          code: 'ALREADY_PUSHED', itemIds: [p.item.itemId],
        });
      }
      throw e;
    }
  }

  /** 监督日志（doc §二-4）：action=上级平台推送，target=数据项标题，result=通道+状态+回执摘要；处罚项无项目不写 */
  private async writeSupervisionLog(
    p: PreparedItem, channel: PushChannelCode, channelTitle: string,
    log: { status: string; responseSnippet: string | null }, actorId: string,
  ) {
    if (!p.item.projectId) return;
    const snippet = log.responseSnippet ? ` 回执:${log.responseSnippet.slice(0, 120)}` : '';
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId: p.item.projectId, time: new Date(), role: '采购工作人员',
        target: p.item.title, action: '上级平台推送',
        result: `${channelTitle}（${channel}）${log.status}${snippet}`,
        riskFlag: '无', operatorId: actorId,
      },
    }).catch((e) => {
      // 主留痕=PlatformPushLog 已落；监督日志失败不阻塞推送主链，但必须可见
      this.logger.warn(`监督日志写入失败（${p.item.itemId}@${channel}）：${(e as Error).message}`);
    });
  }

  /** AuditLog：每 dispatch/export 一行（操作者审计，doc §二-4） */
  private writeAudit(actorId: string, channel: PushChannelCode, prepared: PreparedItem[], outcome: string) {
    this.prisma.auditLog.create({
      data: {
        userId: actorId, action: 'PLATFORM_PUSH', resourceType: `PlatformPush:${channel}`,
        resourceId: prepared[0]?.item.projectId ?? null,
        details: { channel, itemCount: prepared.length, outcome, itemIds: prepared.map((p) => p.item.itemId) },
      },
    }).catch((e) => this.logger.warn(`审计日志写入失败（${channel}）：${(e as Error).message}`));
  }
}
