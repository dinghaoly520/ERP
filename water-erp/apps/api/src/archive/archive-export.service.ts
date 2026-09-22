import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
// jszip 是 CJS 包，无 esModuleInterop 时默认 import 编译为 .default → 运行时非构造器（见 CLAUDE.md TS import 约定）
import JSZip = require('jszip');
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ArchiveScopeService } from './archive-scope.service';
import { ArchiveCheckService } from './archive-check.service';
import { ApprovalTrailExporter } from './approval-trail.exporter';

/**
 * C4 归档信息包（ASIP）导出（§8.2 + 附录 D）：
 * 说明文件.TXT + 项目管理/（卷内按阶段组合）+ 其他/（移交清单、元数据、固化验证、审批留痕、登记表）。
 * 双源取件：PMI 附件（本地 uploads/）+ 开评标回流件（MinIO）。一卷一包，重导覆盖同 key 前缀。
 */
// 2026-09-22 P1-1：取件常量/分页函数迁至单一取件源收集器（检测/导出/勾稽共用），
// 此处 re-export 保持既有外部 import（archive-pickup-categories.spec / guards.spec）不变
export { ARCHIVE_PICKUP_CATEGORIES, HANDOVER_PICKUP_PAGE_SIZE, fetchAllPaged } from './archive-evidence.collector';
import { collectBidEvidenceAssets } from './archive-evidence.collector';

/** 引用件缺行对账（2026-09-20 审查修复）：FileAsset 行缺失 = 引用悬空，与下载失败同口径整体拒绝 */
export function assertNoMissingRefs(refIds: ReadonlySet<string>, foundIds: ReadonlySet<string>): void {
  const missing = [...refIds].filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new BadRequestException({
      error: `开评标引用件缺失 ${missing.length} 件（FileAsset 行不存在）：${missing.slice(0, 3).join('、')}${missing.length > 3 ? '…' : ''}，已中止导出（防止缺件残包）`,
      code: 'ARCHIVE_HANDOVER_FETCH_FAILED',
    });
  }
}

/** ZIP 同目录同名消歧（2026-09-20 审查修复）：JSZip file() 同路径是覆盖语义，撞名加 _2/_3 序号 */
export function uniqueEntryName(category: string, originalName: string, used: Set<string>): string {
  const base = `${category}/${originalName}`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = originalName.lastIndexOf('.');
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  const ext = dot > 0 ? originalName.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${category}/${stem}_${i}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

@Injectable()
export class ArchiveExportService {
  private readonly logger = new Logger(ArchiveExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly scope: ArchiveScopeService,
    private readonly check: ArchiveCheckService,
    private readonly trail: ApprovalTrailExporter,
  ) {}

  async exportAsip(pmiId: string, actorId?: string, retentionPeriod?: 'PERMANENT' | 'Y30' | 'Y10') {
    // ── 前置：四性检测通过（generated 必选项除外——导出本身会产出） ──
    const snapshot = await this.scope.snapshot(pmiId, { enrichMeta: true });
    const blocking = snapshot.requiredMissing;
    if (blocking.length > 0) {
      throw new BadRequestException({
        error: `归档必选材料缺失，无法导出：${blocking.join('、')}`,
        code: 'ARCHIVE_SCOPE_INCOMPLETE',
      });
    }
    const lastCheck = await this.check.latest(pmiId);
    if (!lastCheck || lastCheck.overall !== 'PASSED') {
      throw new BadRequestException({
        error: '导出前需先通过四性检测（归档质检页「运行检测」）',
        code: 'ARCHIVE_CHECK_REQUIRED',
      });
    }

    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: pmiId },
      select: {
        id: true,
        title: true, projectCode: true, requesterName: true, requesterDepartment: true,
        procurementMethod: true, createdAt: true,
        stages: { orderBy: { stageOrder: 'asc' }, include: { attachments: true } },
        bidProjects: { select: { id: true, projectCode: true } },
      },
    });
    if (!item) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    const zip = new JSZip();
    const volName = item.projectCode ?? pmiId;
    const root = zip.folder(volName)!;
    const manifest: Array<{ path: string; sha256: string; size: number; source: string }> = [];

    // ── 卷内：项目管理/ 阶段组合文件夹（§9.2 按程序先后） ──
    const pmDir = root.folder('项目管理')!;
    const uploadDir = path.resolve(process.cwd(), 'uploads', 'project-management');

    for (const st of item.stages) {
      if (st.attachments.length === 0) continue;
      const dir = pmDir.folder(`${String(st.stageOrder).padStart(2, '0')}_${st.stageName.replace(/\//g, '-')}`)!;
      let seq = 1;
      for (const att of st.attachments) {
        const abs = path.join(uploadDir, path.basename(att.objectKey));
        const buf = await fs.readFile(abs).catch(() => {
          // H2/M6：检测通过后文件又变动（TOCTOU）——明确拒绝而非 500 或带病组包
          throw new BadRequestException({
            error: `阶段附件「${st.stageName}/${att.fileName}」在服务器上不可读（可能已被移动或删除），请重新运行四性检测`,
            code: 'ARCHIVE_FILE_MISSING',
          });
        });
        const name = `${String(seq).padStart(2, '0')}_${att.fileName}`;
        dir.file(name, buf);
        manifest.push({
          path: `${volName}/项目管理/${String(st.stageOrder).padStart(2, '0')}_${st.stageName}/${name}`,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          size: buf.length,
          source: `attachment/${st.stageKey}`,
        });
        seq += 1;
      }
    }

    // ── 09 开评标接收件（回流包，MinIO）── H2：取件失败一律整体拒绝（缺行立即拒绝 / 下载失败收集报错），绝不导出缺件残包 ──
    const bpIds = item.bidProjects;
    const fetchFailures: string[] = [];
    // 2026-09-22 P2-1：证据件行累积——供「其他/元数据.json」覆盖与兜底建档（fileAsset 源元数据此前缺席）
    const evidenceAssetRows: Array<{ id: string; key: string; originalName: string | null; category: string | null }> = [];
    if (bpIds.length > 0) {
      const dir = pmDir.folder('09_开评标接收件')!;
      // 2026-09-20 审查修复：同卷多项目/多专家证据件同名频发（JSZip file() 覆盖语义）——按已用路径消歧
      const usedPaths = new Set<string>();
      for (const bp of bpIds) {
        // 2026-09-22 P1-1：取件走共享收集器（检测/勾稽同源，清单永不漂移）；
        // 引用件（笔迹图/签到照/澄清附件/AI 报告）key 不含项目 ID，按引用 id 反查收集，
        // 保证「包内引用 ↔ 案卷文件」一一对应（防引用悬空，2026-09-18 完整性扩展 v2 配套）。
        const { assets, refIds } = await collectBidEvidenceAssets(this.prisma, bp.id);
        assertNoMissingRefs(refIds, new Set(assets.map(a => a.id)));
        evidenceAssetRows.push(...assets.filter(a => !evidenceAssetRows.some(x => x.id === a.id)));
        for (const fa of assets) {
          try {
            const buf = await this.storage.download(fa.key);
            // 2026-09-22 P1-1：内容与 DB 登记指纹比对——不符即拒（防篡改对象被 manifest 新算指纹「合法化」）
            if (fa.sha256) {
              const digest = crypto.createHash('sha256').update(buf).digest('hex');
              if (digest !== fa.sha256) {
                fetchFailures.push(`${fa.originalName ?? fa.key}（内容与登记指纹不符，可能被篡改或损坏）`);
                continue;
              }
            }
            const name = uniqueEntryName(fa.category ?? '未分类', fa.originalName ?? fa.key, usedPaths);
            dir.file(name, buf);
            manifest.push({
              path: `${volName}/项目管理/09_开评标接收件/${name}`,
              sha256: crypto.createHash('sha256').update(buf).digest('hex'),
              size: buf.length,
              source: `fileAsset/${fa.category}`,
            });
          } catch (err) {
            fetchFailures.push(`${fa.originalName ?? fa.key}（${err instanceof Error ? err.message : String(err)}）`);
          }
        }
      }
    }
    if (fetchFailures.length > 0) {
      throw new BadRequestException({
        error: `开评标回流件取件失败 ${fetchFailures.length} 件，已中止导出（防止缺件残包）：${fetchFailures.slice(0, 3).join('、')}${fetchFailures.length > 3 ? '…' : ''}`,
        code: 'ARCHIVE_HANDOVER_FETCH_FAILED',
      });
    }

    // ── 其他/ 目录（附录 D） ──
    const other = root.folder('其他')!;
    const attIds = item.stages.flatMap((s) => s.attachments.map((a) => a.id));
    // §8.4 完整捕获元数据：入包但未命中范围项的附件（阶段杂件）兜底建档，
    // 保证包内每个文件在「其他/元数据.json」都有记录
    {
      const existing = await this.prisma.archiveMetadata.findMany({
        where: { attachmentId: { in: attIds.length > 0 ? attIds : ['none'] } },
        select: { attachmentId: true },
      });
      const have = new Set(existing.map((m) => m.attachmentId));
      for (const st of item.stages) {
        for (const att of st.attachments) {
          if (have.has(att.id)) continue;
          await this.prisma.archiveMetadata.create({
            data: {
              attachmentId: att.id,
              title: `${item.title}·${st.stageName}·${att.fileName}`,
              responsibles: [item.requesterDepartment, item.requesterName].filter(Boolean),
              formedAt: att.createdAt,
              sourceModule: 'export-fallback',
              autoCapturedAt: new Date(),
            },
          }).catch(() => undefined); // 兜底失败不阻断导出
        }
      }
      // 2026-09-22 P2-1：证据件（fileAsset 源）兜底建档——fileAssetId 唯一，先查后建防双写撞约束
      if (evidenceAssetRows.length > 0) {
        const existingFa = await this.prisma.archiveMetadata.findMany({
          where: { fileAssetId: { in: evidenceAssetRows.map(a => a.id) } },
          select: { fileAssetId: true },
        });
        const haveFa = new Set(existingFa.map(m => m.fileAssetId));
        for (const fa of evidenceAssetRows) {
          if (haveFa.has(fa.id)) continue;
          const meta = await this.prisma.fileAsset.findUnique({
            where: { id: fa.id }, select: { createdAt: true },
          }).catch(() => null);
          await this.prisma.archiveMetadata.create({
            data: {
              fileAssetId: fa.id,
              title: `${item.title}·开评标接收件·${fa.originalName ?? fa.key}`,
              responsibles: [item.requesterDepartment, item.requesterName].filter(Boolean),
              formedAt: meta?.createdAt ?? null,
              sourceModule: 'export-fallback',
              autoCapturedAt: new Date(),
            },
          }).catch(() => undefined); // 兜底失败不阻断导出
        }
      }
    }
    // 2026-09-22 P2-1：元数据覆盖卷内全部文件——attachment 源之外并查证据件（fileAsset 源）
    const metas = await this.prisma.archiveMetadata.findMany({
      where: {
        OR: [
          { attachmentId: { in: attIds.length > 0 ? attIds : ['none'] } },
          ...(evidenceAssetRows.length > 0 ? [{ fileAssetId: { in: evidenceAssetRows.map(a => a.id) } }] : []),
        ],
      },
      include: {
        attachment: { select: { fileName: true, objectKey: true } },
        fileAsset: { select: { originalName: true } },
      },
      take: 500,
    });
    const metaPayload = metas.map((m) => ({
      fileName: m.attachment?.fileName ?? m.fileAsset?.originalName ?? m.fileAssetId,
      title: m.title, // M22
      persons: m.persons, // M28
      responsibles: m.responsibles, // M32
      formedAt: m.formedAt?.toISOString() ?? null, // M33
      scopeItemId: m.scopeItemId,
      archivedAt: m.archivedAt?.toISOString() ?? null,
    }));
    other.file('元数据.json', JSON.stringify(metaPayload, null, 2));

    // C3（CTS-EBS01 A-199）：非招标成交记录——流标转非招标的项目补记成交方式与结果
    const deal = await this.prisma.nonTenderDealRecord.findFirst({
      where: { pmItemId: item.id },
      orderBy: { recordedAt: 'desc' },
    });
    if (deal) {
      const dealPayload = JSON.stringify(
        {
          登记依据: 'CTS-EBS01-2016 A-199 变更为非招标方式的处理',
          方式: deal.method,
          成交供应商: deal.winnerName,
          成交金额: deal.dealAmount != null ? Number(deal.dealAmount) : null,
          成交文件: deal.fileAssetId ?? null,
          备注: deal.note,
          登记时间: deal.recordedAt.toISOString(),
        },
        null,
        2,
      );
      other.file('非招标成交记录.json', dealPayload);
      manifest.push({
        path: `${volName}/其他/非招标成交记录.json`,
        sha256: crypto.createHash('sha256').update(dealPayload).digest('hex'),
        size: Buffer.byteLength(dealPayload),
        source: 'generated/非招标成交记录',
      });
    }

    const trailBuf = await this.trail.build(pmiId);
    other.file(`审批留痕_${volName}.json`, trailBuf);
    manifest.push({
      path: `${volName}/其他/审批留痕_${volName}.json`,
      sha256: crypto.createHash('sha256').update(trailBuf).digest('hex'),
      size: trailBuf.length,
      source: 'generated/审批留痕',
    });

    const verifyTxt = [
      '固化验证信息（DA/T 103-2024 §8.3 完整性）',
      `生成时间：${new Date().toISOString()}`,
      `文件总数：${manifest.length}`,
      '',
      ...manifest.map((m) => `${m.sha256}  ${String(m.size).padStart(10)}  ${m.path}`),
    ].join('\n');
    other.file('固化验证信息.txt', verifyTxt);

    other.file('电子档案移交清单.txt', [
      '电子档案移交清单（DA/T 103-2024 附录D）',
      `卷号：${volName}`,
      `项目名称：${item.title}`,
      `采购方式：${item.procurementMethod}`,
      `移交单位：${item.requesterDepartment ?? ''}`,
      `归档文件数：${manifest.length}`,
      `起止时间：${item.createdAt.toISOString().slice(0, 10)} ~ ${new Date().toISOString().slice(0, 10)}`,
    ].join('\n'));

    // M3：zip 自身哈希无法写入包内（先有包后有哈希）——指纹核对指向包内固化验证清单
    other.file('移交接收登记表.txt', [
      '移交接收登记表（双套制线下用：打印→双方签章→扫描回传至归档管理页）',
      `项目：${item.title}（${volName}）`,
      '本包完整性凭据：见同目录「固化验证信息.txt」（逐文件 sha256 清单，共 ' + manifest.length + ' 项）',
      '包级 sha256 由归档系统在导出回执中记录，可在「归档管理」页面查验',
      '移交人（签字）：＿＿＿＿＿＿    接收人（签字）：＿＿＿＿＿＿',
      '移交日期：＿＿＿＿年＿＿月＿＿日',
    ].join('\n'));

    // ── 说明文件.TXT（附录 D 图 D.1 顶层） ──
    root.file('说明文件.TXT', [
      '说 明 文 件',
      '（DA/T 103-2024 招标投标电子文件归档规范 · 附录D 归档信息包）',
      '',
      `移交单位：${item.requesterDepartment ?? '四川水发勘测设计研究有限公司'}（${item.requesterName ?? ''}）`,
      `内容描述：${item.title} 全流程招标投标电子档案（一卷）`,
      `卷号/起止档号：${volName}`,
      `档案数量：${manifest.length} 件电子文件`,
      `形成起止：${item.createdAt.toISOString().slice(0, 10)} ~ ${new Date().toISOString().slice(0, 10)}`,
      '',
      '载体类型：ZIP 压缩包（在线传输/光盘刻录均可）；',
      `载体容量：卷内文件合计约 ${Math.round(manifest.reduce((n, m) => n + m.size, 0) / 1024 / 1024)} MB（未压缩；刻录载体建议单层 DVD 4.7GB 起）；`,
      '读取环境：任意支持 ZIP 解压的软件；卷内文件为 PDF/DOCX/XLSX/图片等通用格式；',
      '「其他/固化验证信息.txt」含全部文件 sha256 指纹，可用任意校验工具复核完整性。',
    ].join('\n'));

    // ── 组包 → MinIO → 落库 ──
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const zipSha = crypto.createHash('sha256').update(zipBuf).digest('hex');
    const packageKey = `archive-asip/${pmiId}/${Date.now()}.zip`;
    await this.storage.upload(packageKey, zipBuf, 'application/zip');

    await this.prisma.projectManagementItem.update({
      where: { id: pmiId },
      data: {
        archiveExportedAt: new Date(),
        archivePackageKey: packageKey,
        ...(retentionPeriod ? { retentionPeriod } : {}),
      },
    });

    // 文件级已归档标记（A.2d：防重复归档；质检页可取消重归）— attIds 见上方元数据查询
    if (attIds.length > 0) {
      await this.prisma.archiveMetadata.updateMany({
        where: { attachmentId: { in: attIds }, archivedAt: null },
        data: { archivedAt: new Date() },
      });
    }

    this.logger.log(`ASIP 导出完成 ${volName}: ${manifest.length} 件, sha256=${zipSha.slice(0, 16)}…`);
    return {
      packageKey,
      zipSha256: zipSha,
      fileCount: manifest.length,
      sizeBytes: zipBuf.length,
    };
  }

  /** 下载已导出的 ASIP 包 */
  async downloadPackage(pmiId: string) {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: pmiId },
      select: { archivePackageKey: true, projectCode: true },
    });
    if (!item?.archivePackageKey) {
      throw new BadRequestException({ error: '该项目尚未导出归档信息包', code: 'NO_PACKAGE' });
    }
    const buf = await this.storage.download(item.archivePackageKey);
    return { buffer: buf, fileName: `归档信息包-${item.projectCode ?? pmiId}.zip` };
  }
}
