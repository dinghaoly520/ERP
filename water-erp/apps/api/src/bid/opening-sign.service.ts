import { Injectable, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { convertOfficeToPdf } from '../common/office-to-pdf.util';
import { buildStandardFileName } from '@water-erp/shared';

/** P1-3①A：开标记录纸面签字（办法第32条——开标记录经电子签名）。
 * 主持人/监督人打印签字页 → 手写签字 → 扫描回传 → 登记闭环 → 重建开标文件包（signatures 段入哈希链）。
 * 纸面过渡方案（复用评标签字包先例）；P1-11 电子签章落地后升级为在线签名接口。 */

interface OpeningSignSnapshot {
  project: { name: string; projectCode: string; procurementMethod: string; openTime: string; deadline: string };
  host: string;
  supervisor: string | null;
  window: { start: string; end: string };
  suppliers: Array<{ supplierName: string; decryptStatus: string; confirmStatus: string; dangerAttribution: string | null }>;
  records: Array<{ supplierName: string; amount: string; period: string; qualityTarget: string; bondStatus: string; confirmStatus: string }>;
  disputes: Array<{ supplierName: string; reason: string | null; handleResult: string | null }>;
}

@Injectable()
export class OpeningSignService {
  private readonly logger = new Logger(OpeningSignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** 收集签字页快照（开标记录法定要素 + 唱标内容 + 异议）。 */
  async buildSnapshot(projectId: string): Promise<OpeningSignSnapshot> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { name: true, projectCode: true, procurementMethod: true, openTime: true, deadline: true, stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage === 'DOWNLOAD' || project.stage === 'SUBMIT') {
      throw new ForbiddenException({ error: '项目尚未开标，无法生成开标记录签字页', code: 'OPENING_NOT_STARTED' });
    }
    const session = await this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
    if (!session) throw new BadRequestException({ error: '开标会话不存在', code: 'OPENING_NOT_STARTED' });

    const [suppliers, records] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { projectId, submitStatus: { not: '已撤回' } },
        select: { supplierName: true, decryptStatus: true, confirmStatus: true, dangerAttribution: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.bidOpeningRecord.findMany({
        where: { projectId },
        select: { supplierName: true, amount: true, period: true, qualityTarget: true, bondStatus: true, confirmStatus: true, objectionReason: true, handleResult: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const disputes = records
      .filter(r => r.objectionReason)
      .map(r => ({ supplierName: r.supplierName, reason: r.objectionReason, handleResult: r.handleResult }));

    return {
      project: {
        name: project.name, projectCode: project.projectCode, procurementMethod: project.procurementMethod,
        openTime: project.openTime.toISOString(), deadline: project.deadline.toISOString(),
      },
      host: session.host,
      supervisor: session.supervisor,
      window: { start: session.decryptWindowStart.toISOString(), end: session.decryptWindowEnd.toISOString() },
      suppliers: suppliers.map(s => ({ supplierName: s.supplierName, decryptStatus: s.decryptStatus, confirmStatus: s.confirmStatus, dangerAttribution: s.dangerAttribution })),
      records: records.map(r => ({ supplierName: r.supplierName, amount: r.amount, period: r.period, qualityTarget: r.qualityTarget, bondStatus: r.bondStatus, confirmStatus: r.confirmStatus })),
      disputes,
    };
  }

  /** 生成开标记录签字页 PDF（docx → LibreOffice 转换）。返回 FileAsset。 */
  async generateSignPage(projectId: string, actorId?: string) {
    const snap = await this.buildSnapshot(projectId);
    const doc = this.buildDocx(snap);
    const docxBuffer = await Packer.toBuffer(doc);
    const pdf = convertOfficeToPdf(docxBuffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buildStandardFileName({ code: snap.project.projectCode, docType: '开标记录签字页' }));
    if (!pdf) throw new BadRequestException({ error: '签字页 PDF 转换失败（LibreOffice 不可用）', code: 'PDF_CONVERT_FAILED' });

    const buffer = pdf.buffer;
    const objectKey = `opening-sign-page/${projectId}.pdf`;
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    await this.storage.upload(objectKey, buffer, 'application/pdf');

    const asset = await this.prisma.fileAsset.upsert({
      where: { key: objectKey },
      create: {
        key: objectKey, originalName: `开标记录签字页-${snap.project.projectCode}.pdf`,
        mimeType: 'application/pdf', size: buffer.length, sha256,
        category: 'opening_sign_page', uploaderId: actorId ?? null,
      },
      update: { size: buffer.length, sha256, uploaderId: actorId ?? null },
    });
    this.logger.log(`开标记录签字页已生成：${objectKey}（sha256=${sha256.slice(0, 12)}…）`);
    return { assetId: asset.id, downloadUrl: `/api/upload/files/${asset.id}`, sha256 };
  }

  /** 上传签字扫描件（host/supervisor 分派），写会话对应列。 */
  async uploadSignScan(
    projectId: string,
    role: 'host' | 'supervisor',
    file: { buffer: Buffer; originalname: string; mimetype: string },
    actorId?: string,
  ) {
    const session = await this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
    if (!session) throw new BadRequestException({ error: '开标会话不存在', code: 'OPENING_NOT_STARTED' });
    if (role === 'supervisor' && !session.supervisor) {
      throw new BadRequestException({ error: '本项目无监督人，不可上传监督人签字', code: 'NO_SUPERVISOR' });
    }

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const objectKey = `opening-sign-scan/${projectId}/${role}.pdf`;
    await this.storage.upload(objectKey, file.buffer, 'application/pdf');
    const asset = await this.prisma.fileAsset.upsert({
      where: { key: objectKey },
      create: {
        key: objectKey, originalName: `开标签字-${role}-${session.host}.pdf`,
        mimeType: 'application/pdf', size: file.buffer.length, sha256,
        category: 'opening_sign_scan', uploaderId: actorId ?? null,
      },
      update: { size: file.buffer.length, sha256, uploaderId: actorId ?? null },
    });
    await this.prisma.bidOpeningSession.update({
      where: { projectId },
      data: role === 'host' ? { hostSignScanFileId: asset.id } : { supervisorSignScanFileId: asset.id },
    });
    this.logger.log(`开标签字扫描已上传：${role} → ${objectKey}`);
    return { assetId: asset.id, sha256 };
  }

  /** 登记闭环：签字落库 + 重建开标文件包（signatures 段入哈希链）。
   * 门控：完成开标（handoverAssetId 存在）+ 主持人扫描已上传。 */
  async registerSign(projectId: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, projectCode: true, procurementMethod: true, openTime: true, deadline: true, stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    const session = await this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
    if (!session) throw new BadRequestException({ error: '开标会话不存在', code: 'OPENING_NOT_STARTED' });
    if (!session.handoverAssetId) {
      throw new BadRequestException({ error: '尚未完成开标（无开标文件包），无法登记签字', code: 'HANDOVER_NOT_READY' });
    }
    if (!session.hostSignScanFileId) {
      throw new BadRequestException({ error: '主持人签字扫描未上传，无法登记', code: 'HOST_SCAN_MISSING' });
    }

    // 幂等：已登记 → 直接返回现状
    if (session.openingSignRegisteredAt) {
      return { registered: true, alreadyRegistered: true, registeredAt: session.openingSignRegisteredAt.toISOString() };
    }
    // 到齐才登记：有监督人时监督件必到（否则提前闭环后补传不再重建包——alreadyRegistered 早退，签字链缺监督段）；
    // 置于幂等早退之后，不影响已登记项目的现状返回
    if (session.supervisor && !session.supervisorSignScanFileId) {
      throw new BadRequestException({ error: '本项目有监督人，需主持人+监督人签字扫描均上传后再登记', code: 'SUPERVISOR_SCAN_MISSING' });
    }

    const [hostAsset, supervisorAsset] = await Promise.all([
      this.prisma.fileAsset.findUnique({ where: { id: session.hostSignScanFileId }, select: { id: true, sha256: true } }),
      session.supervisorSignScanFileId
        ? this.prisma.fileAsset.findUnique({ where: { id: session.supervisorSignScanFileId }, select: { id: true, sha256: true } })
        : Promise.resolve(null),
    ]);
    if (!hostAsset) throw new BadRequestException({ error: '主持人签字扫描资产缺失', code: 'HOST_SCAN_MISSING' });

    const now = new Date();
    // 重建开标文件包：原 JSON 重建 + signatures 段 + 重算 fingerprint → 同 key 覆盖 upsert
    const rebuilt = await this.rebuildHandoverWithSignatures(project, session, {
      host: { assetId: hostAsset.id, sha256: hostAsset.sha256, registeredAt: now.toISOString() },
      supervisor: supervisorAsset ? { assetId: supervisorAsset.id, sha256: supervisorAsset.sha256, registeredAt: now.toISOString() } : null,
    });

    await this.prisma.$transaction(async (tx: any) => {
      await tx.bidOpeningSession.update({
        where: { projectId },
        data: { openingSignRegisteredAt: now, openingSignRegisteredBy: actorId ?? null },
      });
      await tx.fileAsset.update({
        where: { id: session.handoverAssetId },
        data: { sha256: rebuilt.sha256, size: rebuilt.buffer.length },
      });
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: now, role: '开标主持人', target: project.name,
          action: '开标记录签字登记',
          result: `主持人${supervisorAsset ? '与监督人' : ''}签字扫描已登记；开标文件包已重建（新 sha256=${rebuilt.sha256.slice(0, 12)}…）`,
          riskFlag: '无',
        },
      });
      if (actorId) {
        await tx.auditLog.create({
          data: {
            userId: actorId, action: 'BID_OPENING_SIGN_REGISTERED', resourceType: `BidProject:${projectId}`,
            details: { hostScanAssetId: hostAsset.id, supervisorScanAssetId: supervisorAsset?.id ?? null, newPackageSha256: rebuilt.sha256 },
          },
        });
      }
    });
    this.logger.log(`开标记录签字登记闭环：${projectId}（包 sha256=${rebuilt.sha256.slice(0, 12)}…）`);
    return { registered: true, alreadyRegistered: false, registeredAt: now.toISOString(), packageSha256: rebuilt.sha256 };
  }

  /** 查询签字状态（前端徽标）。 */
  async getStatus(projectId: string) {
    const session = await this.prisma.bidOpeningSession.findUnique({
      where: { projectId },
      select: {
        host: true, supervisor: true, status: true, handoverAssetId: true,
        hostSignScanFileId: true, supervisorSignScanFileId: true,
        openingSignRegisteredAt: true, openingSignRegisteredBy: true,
      },
    });
    if (!session) return { hasSession: false };
    return {
      hasSession: true,
      host: session.host,
      supervisor: session.supervisor,
      sessionStatus: session.status,
      handoverReady: !!session.handoverAssetId,
      hostScanUploaded: !!session.hostSignScanFileId,
      supervisorScanUploaded: !!session.supervisorSignScanFileId,
      registeredAt: session.openingSignRegisteredAt?.toISOString() ?? null,
    };
  }

  /** 重建开标文件包：下载原包 JSON → 追加 signatures → 重算 fingerprint → 同 key 覆盖上传。 */
  private async rebuildHandoverWithSignatures(
    project: { id: string; name: string; projectCode: string; procurementMethod: string; openTime: Date; deadline: Date; stage: string },
    session: { host: string; supervisor: string | null; decryptWindowStart: Date; decryptWindowEnd: Date; status: string },
    signatures: { host: { assetId: string; sha256: string; registeredAt: string }; supervisor: { assetId: string; sha256: string; registeredAt: string } | null },
  ): Promise<{ buffer: Buffer; sha256: string }> {
    const objectKey = `bid-opening-handover/${project.id}.json`;
    const existing = await this.storage.download(objectKey);
    const pkg = JSON.parse(existing.toString('utf8'));
    // 移除旧 fingerprint 后追加 signatures 段，重算
    const { fingerprint: _old, ...body } = pkg;
    void _old;
    const withSign = { ...body, signatures };
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(withSign)).digest('hex');
    const finalPkg = { ...withSign, fingerprint };
    const buffer = Buffer.from(JSON.stringify(finalPkg, null, 2), 'utf8');
    await this.storage.upload(objectKey, buffer, 'application/json');
    return { buffer, sha256: fingerprint };
  }

  /** 签字页 docx 构建（法定要素表格 + 唱标内容 + 签字栏）。 */
  private buildDocx(snap: OpeningSignSnapshot): Document {
    const cell = (text: string, opts?: { bold?: boolean; width?: number }) => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: opts?.bold, size: 20 })] })],
      width: opts?.width ? { size: opts?.width, type: WidthType.PERCENTAGE } : undefined,
    });
    const recordRows = snap.records.map(r => new TableRow({
      children: [
        cell(r.supplierName), cell(r.amount), cell(r.period), cell(r.qualityTarget), cell(r.bondStatus), cell(r.confirmStatus),
      ],
    }));
    const disputeParas = snap.disputes.length > 0
      ? snap.disputes.map(d => new Paragraph({ children: [new TextRun({ text: `· ${d.supplierName}：${d.reason}（处理：${d.handleResult ?? '待处理'}）`, size: 20 })] }))
      : [new Paragraph({ children: [new TextRun({ text: '无', size: 20 })] })];

    return new Document({
      sections: [{
        children: [
          new Paragraph({ text: '开标记录签字页', heading: HeadingLevel.HEADING_1, alignment: 'center' }),
          new Paragraph({ text: `项目名称：${snap.project.name}`, spacing: { before: 200 } }),
          new Paragraph({ text: `项目编号：${snap.project.projectCode}　采购方式：${snap.project.procurementMethod}` }),
          new Paragraph({ text: `开标时间：${snap.project.openTime}　投标截止：${snap.project.deadline}` }),
          new Paragraph({ text: `解密窗口：${snap.window.start} 至 ${snap.window.end}` }),
          new Paragraph({ text: `主持人：${snap.host}${snap.supervisor ? `　监督人：${snap.supervisor}` : ''}`, spacing: { after: 200 } }),
          new Paragraph({ text: '一、唱标记录（投标人名称/投标报价/工期/质量/保证金/确认状态）', heading: HeadingLevel.HEADING_3 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  cell('投标人', { bold: true }), cell('投标报价', { bold: true }), cell('工期', { bold: true }),
                  cell('质量目标', { bold: true }), cell('保证金', { bold: true }), cell('确认状态', { bold: true }),
                ],
              }),
              ...recordRows,
            ],
          }),
          new Paragraph({ text: '二、开标异议记录', heading: HeadingLevel.HEADING_3, spacing: { before: 200 } }),
          ...disputeParas,
          new Paragraph({ text: '三、解密异常及归因', heading: HeadingLevel.HEADING_3, spacing: { before: 200 } }),
          ...snap.suppliers.filter(s => s.decryptStatus === 'DANGER').map(s =>
            new Paragraph({ children: [new TextRun({ text: `· ${s.supplierName}：解密异常（归因：${s.dangerAttribution ?? '未归因'}）`, size: 20 })] })),
          ...(snap.suppliers.filter(s => s.decryptStatus === 'DANGER').length === 0
            ? [new Paragraph({ children: [new TextRun({ text: '无', size: 20 })] })] : []),
          new Paragraph({ text: '四、签字确认', heading: HeadingLevel.HEADING_3, spacing: { before: 400 } }),
          new Paragraph({ text: `主持人（${snap.host}）签字：＿＿＿＿＿＿＿＿＿＿　　　日期：＿＿＿＿＿＿＿＿` }),
          ...(snap.supervisor ? [new Paragraph({ text: `监督人（${snap.supervisor}）签字：＿＿＿＿＿＿＿＿＿＿　　　日期：＿＿＿＿＿＿＿＿` })] : []),
          new Paragraph({ text: '注：本签字页为《电子招标投标办法》第32条开标记录的组成文件，签字扫描件纳入开标文件包哈希链存档。', spacing: { before: 300 } }),
        ],
      }],
    });
  }
}
