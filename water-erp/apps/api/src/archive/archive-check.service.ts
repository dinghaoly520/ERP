import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ArchiveScopeService, ScopeMatchRow } from './archive-scope.service';
import { collectBidEvidenceAssets } from './archive-evidence.collector';

export interface CheckDetail {
  code: string;
  materialName: string;
  check: '完整性-范围' | '完整性-哈希' | '可用性-格式' | '可用性-可读' | '安全性-加密态';
  status: 'PASS' | 'FAIL';
  message: string;
}

/** §7.1 推荐归档格式白名单（通用格式路线——规范允许 DOCX/XLSX/图片等，版式件后补） */
const FORMAT_WHITELIST = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
  'application/json',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/svg+xml',
  'audio/mpeg',
  'audio/wav',
  'video/mp4',
  'video/x-msvideo',
  'application/zip',
]);

function extFallbackOk(mimeType: string, fileName: string): boolean {
  const exts = ['.pdf', '.docx', '.xlsx', '.doc', '.xls', '.json', '.txt', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.svg', '.mp3', '.wav', '.mp4', '.avi', '.zip', '.ofd'];
  return exts.some((e) => fileName.toLowerCase().endsWith(e)) || mimeType.startsWith('text/');
}

/**
 * 四性检测（§8.3/§10.3 + A.1f）——完整性/可用性/安全性自动检测；
 * 真实性走「弱对齐」：sha256 哈希比对 + 版本链 + OperationLog 操作链（CA 签章不在本期范围）。
 */
@Injectable()
export class ArchiveCheckService {
  private readonly logger = new Logger(ArchiveCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly scope: ArchiveScopeService,
  ) {}

  async run(pmiId: string, ranById?: string) {
    const snapshot = await this.scope.snapshot(pmiId);
    const details: CheckDetail[] = [];

    // ── 完整性-范围：必选项齐件检查 ──
    for (const row of snapshot.rows) {
      if (row.blocking) {
        details.push({
          code: row.code, materialName: row.materialName, check: '完整性-范围',
          status: 'FAIL', message: '必备归档材料缺失，请在归档质检页补传',
        });
      } else if (row.isRequired && row.sourceType === 'generated' && row.status !== 'MATCHED') {
        // 系统生成件由导出流程产出，检测放行（导出成功即视为归集）
        details.push({ code: row.code, materialName: row.materialName, check: '完整性-范围', status: 'PASS', message: '导出时自动生成' });
      } else if (row.isRequired) {
        details.push({ code: row.code, materialName: row.materialName, check: '完整性-范围', status: 'PASS', message: '' });
      }
    }

    // ── 逐文件检测（哈希/格式/可读）──
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: pmiId },
      select: { title: true, stages: { include: { attachments: { include: { versions: true } } } }, bidProjects: { select: { id: true } } },
    });
    if (!item) throw new Error('项目不存在');

    // ── M4：回流件（FileAsset，MinIO）参与检测——§8.3 检测对象不应只有 PMI 附件 ──
    // 2026-09-22 P1-1：改走共享收集器（与导出同源），回流包/签字扫描/开标签字页/AI 报告
    // 及全部引用件（笔迹图/签到照/澄清附件）纳入哈希+可读检测；引用悬空记 FAIL（导出会被拒）。
    const seenIds = new Set<string>();
    for (const bp of item.bidProjects) {
      const { assets, missingRefIds } = await collectBidEvidenceAssets(this.prisma, bp.id);
      for (const missingId of missingRefIds) {
        details.push({
          code: '-', materialName: `证据件引用缺失（FileAsset ${missingId.slice(0, 8)}…）`,
          check: '完整性-范围', status: 'FAIL',
          message: '回流包引用的证据件在 FileAsset 中无行（可能已被删除），归档导出将被拒绝',
        });
      }
      for (const fa of assets) {
        if (seenIds.has(fa.id)) continue;
        seenIds.add(fa.id);
        const label = `回流件/${fa.originalName ?? fa.key}`;
        try {
          const buf = await this.storage.download(fa.key);
          if (buf.length === 0) throw new Error('对象为空');
          const digest = crypto.createHash('sha256').update(buf).digest('hex');
          const hashOk = fa.sha256 ? fa.sha256 === digest : true;
          details.push({ code: '-', materialName: label, check: '可用性-可读', status: 'PASS', message: '' });
          if (fa.sha256) {
            details.push({
              code: '-', materialName: label, check: '完整性-哈希',
              status: hashOk ? 'PASS' : 'FAIL',
              message: hashOk ? '' : 'MinIO 内容与上传时登记的 sha256 不符（对象可能被篡改或损坏）',
            });
          }
        } catch (err: any) {
          details.push({
            code: '-', materialName: label, check: '可用性-可读',
            status: 'FAIL', message: `回流对象不可读：${err?.message ?? err}`,
          });
        }
      }
    }

    const uploadDir = path.resolve(process.cwd(), 'uploads', 'project-management');
    for (const st of item.stages) {
      for (const att of st.attachments) {
        const label = `${st.stageKey}/${att.fileName}`;

        // 可用性-格式
        const fmtOk = FORMAT_WHITELIST.has(att.mimeType) || extFallbackOk(att.mimeType, att.fileName);
        details.push({
          code: '-', materialName: label, check: '可用性-格式',
          status: fmtOk ? 'PASS' : 'FAIL',
          message: fmtOk ? '' : `格式 ${att.mimeType} 不在归档推荐格式白名单（DA/T 103-2024 §7.1）`,
        });

        // 可用性-可读 + 完整性-哈希（本地文件重算）
        const abs = path.join(uploadDir, path.basename(att.objectKey));
        try {
          const buf = await fs.readFile(abs);
          if (buf.length === 0) throw new Error('文件为空');
          const digest = crypto.createHash('sha256').update(buf).digest('hex');
          const versionHash = [...att.versions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.originalHash ?? null;
          const hashOk = versionHash ? versionHash === digest : true; // 无版本哈希的存量件不判 FAIL（记 PASS，导出时固化新指纹）
          details.push({ code: '-', materialName: label, check: '可用性-可读', status: 'PASS', message: '' });
          if (versionHash) {
            details.push({
              code: '-', materialName: label, check: '完整性-哈希',
              status: hashOk ? 'PASS' : 'FAIL',
              message: hashOk ? '' : `sha256 与版本链指纹不符（${digest.slice(0, 12)}…）`,
            });
          }
        } catch (err: any) {
          details.push({
            code: '-', materialName: label, check: '可用性-可读',
            status: 'FAIL', message: `对象不可读：${err?.message ?? err}`,
          });
        }
      }
    }

    const failed = details.filter((d) => d.status === 'FAIL');
    const result = await this.prisma.archiveCheckResult.create({
      data: {
        pmiId,
        overall: failed.length === 0 ? 'PASSED' : 'FAILED',
        passedCount: details.length - failed.length,
        failedCount: failed.length,
        details: details as unknown as object,
        ranById: ranById ?? null,
      },
    });
    return result;
  }

  /** 导出前置：最近一次检测是否 PASSED（无记录视为未检） */
  async latest(pmiId: string) {
    return this.prisma.archiveCheckResult.findFirst({ where: { pmiId }, orderBy: { ranAt: 'desc' } });
  }
}
