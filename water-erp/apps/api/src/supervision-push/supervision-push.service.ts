// apps/api/src/supervision-push/supervision-push.service.ts
import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { BidSignPacketService } from '../bid/bid-sign-packet.service';
import { PlatformSigningService } from './platform-signing.service';
import {
  buildPushEnvelope, envelopeFingerprint,
  SupervisionPayloadType, SupervisionPushEnvelope, SupervisionAttachmentRef,
} from './supervision-push-payload';
import { SaveSupervisionConfigDto } from './dto/supervision-push.dto';

const CONFIG_KEY = 'supervision_push_config';

export interface SupervisionPushConfig {
  enabled: boolean;
  endpoint: string;
  authToken: string;
  timeoutMs: number;
  platformCode: string;
}

@Injectable()
export class SupervisionPushService {
  private readonly logger = new Logger(SupervisionPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly systemConfig: SystemConfigService,
    private readonly bidSignPacketService: BidSignPacketService,
    private readonly platformSigning: PlatformSigningService,
  ) {}

  // ── 配置（SystemConfig + env 兜底，spec §4.3）──

  async getConfig(): Promise<SupervisionPushConfig> {
    const row = await this.systemConfig.get(CONFIG_KEY);
    let cfg: Partial<SupervisionPushConfig> = {};
    try { cfg = row?.value ? JSON.parse(row.value) : {}; } catch { cfg = {}; }
    let platformCode = cfg.platformCode ?? '';
    if (!platformCode) {
      // 联动 gb_code_config 占位（common/gb-code.service.ts 的 SystemConfig key）
      const gb = await this.systemConfig.get('gb_code_config');
      if (gb?.value) { try { platformCode = JSON.parse(gb.value).platformCode ?? ''; } catch { /* 忽略格式异常 */ } }
    }
    return {
      enabled: cfg.enabled ?? false,
      endpoint: cfg.endpoint || process.env.SUPERVISION_PUSH_URL || '',
      authToken: cfg.authToken || '',
      timeoutMs: cfg.timeoutMs ?? 8000,
      platformCode,
    };
  }

  /** 对外（GET config）掩码 token */
  async getMaskedConfig() {
    const c = await this.getConfig();
    return { ...c, authToken: c.authToken ? '******' : '' };
  }

  async saveConfig(dto: SaveSupervisionConfigDto, updatedBy?: string) {
    const current = await this.getConfig();
    const merged: SupervisionPushConfig = {
      enabled: dto.enabled,
      endpoint: dto.endpoint ?? '',
      // 前端传 '******' 或空表示不改动现有 token
      authToken: !dto.authToken || dto.authToken === '******' ? current.authToken : dto.authToken,
      timeoutMs: dto.timeoutMs ?? 8000,
      platformCode: dto.platformCode ?? '',
    };
    await this.systemConfig.set(CONFIG_KEY, JSON.stringify(merged), updatedBy);
    return { ...merged, authToken: merged.authToken ? '******' : '' };
  }

  // ── 闸门 + 信封（spec §4.5/§4.7）──

  /** EVALUATION_REPORT 闸门：签字包已生成 + 闭环 + 回流已生成（复用归档闸门口径） */
  private async loadEvaluationReport(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException({ error: '项目不存在', code: 'PROJECT_NOT_FOUND' });
    const packet = await this.prisma.bidSignPacket.findUnique({ where: { projectId } });
    if (!packet) throw new ConflictException({ error: '评标签字包未生成，无法推送评标报告', code: 'SIGN_PACKET_NOT_GENERATED' });
    if (!packet.closedAt) throw new ConflictException({ error: '评标签字未闭环，无法推送评标报告', code: 'SIGN_NOT_CLOSED' });
    if (!packet.handoverFileAssetId) throw new ConflictException({ error: '评标回流包未生成，无法推送评标报告', code: 'HANDOVER_NOT_GENERATED' });
    const snapshot = await this.bidSignPacketService.buildSnapshot(projectId);
    return { project, packet, snapshot };
  }

  private assertPayloadReady(payloadType: SupervisionPayloadType) {
    if (payloadType !== 'EVALUATION_REPORT') {
      throw new BadRequestException({ error: `载荷类型 ${payloadType} 待接入省级公共服务平台后启用`, code: 'PAYLOAD_TYPE_NOT_READY' });
    }
  }

  /** 构建评标报告信封 + 签名（push 与 voucher 同源同指纹，spec §4.7 voucher 步骤 1-2） */
  private async buildEvaluationEnvelope(projectId: string, platformCode: string) {
    const { project, packet, snapshot } = await this.loadEvaluationReport(projectId);
    const attachments: SupervisionAttachmentRef[] = [];
    if (packet.fileAssetId) {
      const a = await this.prisma.fileAsset.findUnique({ where: { id: packet.fileAssetId } });
      if (a) attachments.push({ name: '评标签字包.pdf', category: a.category, fileAssetId: a.id, sha256: a.sha256 });
    }
    if (packet.handoverFileAssetId) {
      const a = await this.prisma.fileAsset.findUnique({ where: { id: packet.handoverFileAssetId } });
      if (a) attachments.push({ name: '评标回流包.json', category: a.category, fileAssetId: a.id, sha256: a.sha256 });
    }
    const envelope: SupervisionPushEnvelope = buildPushEnvelope({
      payloadType: 'EVALUATION_REPORT',
      platformCode,
      generatedAt: new Date().toISOString(),
      project: { id: project.id, projectCode: project.projectCode, name: project.name, procurementMethod: project.procurementMethod },
      body: {
        reportSnapshot: snapshot, // 评标报告十项全量（BidSignPacketService.buildSnapshot）
        signPacket: { fileAssetId: packet.fileAssetId, sha256: packet.sha256, closedAt: packet.closedAt?.toISOString() ?? null },
      },
      attachments,
    });
    const fingerprint = envelopeFingerprint(envelope);
    const signature = this.platformSigning.signFingerprint(fingerprint);
    return { envelope, fingerprint, signature, project };
  }

  // ── 推送（spec §4.7 序列 1-7）──

  async push(projectId: string, payloadType: SupervisionPayloadType, actorId: string) {
    const cfg = await this.getConfig();
    if (!cfg.enabled || !cfg.endpoint) {
      throw new BadRequestException({ error: '监督推送未启用或未配置端点（管理端「监督推送」配置）', code: 'SUPERVISION_PUSH_DISABLED' });
    }
    this.assertPayloadReady(payloadType);

    const { envelope, fingerprint, signature, project } = await this.buildEvaluationEnvelope(projectId, cfg.platformCode);

    // 信封物证：每次尝试一条，key 带时间戳（不 upsert）
    const ts = Date.now();
    const buffer = Buffer.from(JSON.stringify({ envelope, signature }, null, 2), 'utf8');
    const objectKey = `supervision-push/${projectId}/${payloadType.toLowerCase()}-${ts}.json`;
    await this.storage.upload(objectKey, buffer, 'application/json');
    const asset = await this.prisma.fileAsset.create({
      data: {
        key: objectKey,
        originalName: `监督推送信封-${project.projectCode}-${payloadType}.json`,
        mimeType: 'application/json',
        size: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        category: 'supervision_push_packet',
        uploaderId: actorId,
      },
    });

    let status = 'SUCCESS';
    let responseCode: number | null = null;
    let responseSnippet: string | null = null;
    let errorMessage: string | null = null;
    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.authToken ? { Authorization: `Bearer ${cfg.authToken}` } : {}),
          'X-Platform-Code': cfg.platformCode,
        },
        body: JSON.stringify({ envelope, signature }),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
      responseCode = res.status;
      const text = (await res.text()).slice(0, 2048);
      responseSnippet = text || null;
      if (!res.ok) { status = 'FAILED'; errorMessage = `HTTP ${res.status}`; }
    } catch (e) {
      status = 'FAILED';
      errorMessage = ((e as Error).message ?? '网络错误').slice(0, 500);
    }

    const attemptNo = (await this.prisma.supervisionPushLog.count({ where: { projectId, payloadType } })) + 1;
    const log = await this.prisma.supervisionPushLog.create({
      data: {
        projectId, payloadType, status, endpoint: cfg.endpoint,
        requestSha256: fingerprint, packetAssetId: asset.id,
        responseCode, responseSnippet, errorMessage, attemptNo,
        signedBy: signature.certDn, createdById: actorId,
      },
    });
    this.prisma.auditLog.create({
      data: { userId: actorId, action: 'SUPERVISION_PUSH', resourceType: `BidProject:${projectId}`, details: `${payloadType} 第 ${attemptNo} 次推送 ${status}` },
    }).catch(() => {});
    return log;
  }

  // ── 离线导出凭证（spec §4.7 voucher）──

  async exportVoucher(projectId: string, payloadType: SupervisionPayloadType, actorId: string) {
    this.assertPayloadReady(payloadType);
    const cfg = await this.getConfig();
    const { envelope, fingerprint, signature, project } = await this.buildEvaluationEnvelope(projectId, cfg.platformCode);

    const logs = await this.prisma.supervisionPushLog.findMany({
      where: { projectId, payloadType }, orderBy: { createdAt: 'desc' }, take: 50,
    });
    const voucher = {
      packageType: 'SUPERVISION_PUSH_VOUCHER' as const,
      packageVersion: 1 as const,
      envelope,
      signature,
      pushLogs: logs.map((l) => ({
        attemptNo: l.attemptNo, status: l.status, endpoint: l.endpoint,
        responseCode: l.responseCode, errorMessage: l.errorMessage, createdAt: l.createdAt,
      })),
      exportedAt: new Date().toISOString(),
      exportedBy: actorId,
    };

    const ts = Date.now();
    const buffer = Buffer.from(JSON.stringify(voucher, null, 2), 'utf8');
    const objectKey = `supervision-push/${projectId}/voucher-${payloadType.toLowerCase()}-${ts}.json`;
    await this.storage.upload(objectKey, buffer, 'application/json');
    const asset = await this.prisma.fileAsset.create({
      data: {
        key: objectKey,
        originalName: `监督推送离线凭证-${project.projectCode}.json`,
        mimeType: 'application/json',
        size: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        category: 'supervision_push_voucher',
        uploaderId: actorId,
      },
    });
    const attemptNo = (await this.prisma.supervisionPushLog.count({ where: { projectId, payloadType } })) + 1;
    const log = await this.prisma.supervisionPushLog.create({
      data: {
        projectId, payloadType, status: 'VOUCHER_EXPORTED',
        requestSha256: fingerprint, attemptNo,
        signedBy: signature.certDn, voucherAssetId: asset.id, createdById: actorId,
      },
    });
    return { voucherAssetId: asset.id, downloadUrl: `/api/upload/files/${asset.id}`, log };
  }

  // ── 查询 ──

  async getStatus(projectId: string) {
    const cfg = await this.getMaskedConfig();
    let gate: { ready: boolean; reason: string | null };
    try {
      await this.loadEvaluationReport(projectId);
      gate = { ready: true, reason: null };
    } catch (e) {
      // HttpException 以 { error: '业务中文文本', code } 构造时 e.message 只是类默认文案
      // （如 'Conflict'）；gate.reason 面向前端展示，须取响应体里的业务错误文本。
      const resp = e instanceof HttpException ? e.getResponse() : null;
      const reason = (resp && typeof resp === 'object' && 'error' in resp ? String((resp as { error?: unknown }).error) : '') || (e as Error).message;
      gate = { ready: false, reason };
    }
    const latest = await this.prisma.supervisionPushLog.findFirst({
      where: { projectId, payloadType: 'EVALUATION_REPORT' }, orderBy: { createdAt: 'desc' },
    });
    return { config: cfg, gate, latest };
  }

  listLogs(projectId: string) {
    return this.prisma.supervisionPushLog.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
}
