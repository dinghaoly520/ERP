/**
 * 文件缓存路径 / 文件名 / 归档文本 工具（纯函数，无 Nest 依赖）。
 *
 * 从 project-management.service.ts 抽离（2026-08 审计 P1：拆上帝服务）。
 *  - getUploadDir / get*CachePath           本地文件缓存目录与路径（/tmp 与 uploads/project-management）
 *  - sanitizeFileName / normalizeUploadedFileName  上传文件名清理与 latin1→utf8 修复
 *  - buildStageAnalysisFingerprint          阶段分析缓存指纹
 *  - isLabelLine / normalizeStageMatchText   归档/需求文本标签判定与阶段名归一
 *
 * 全部零依赖（node:path / node:fs 基础 API），无 prisma/AI/storage。
 */
import { mkdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

  export function getTenderTextCachePath(projectId: string): string {
    // /tmp 始终可写，避免 uploads/project-management 目录不存在
    const dir = join('/tmp', 'project-management-cache');
    mkdir(dir, { recursive: true }).catch(() => {});
    return join(dir, `tender-text-${projectId}.txt`);
  }
  export function isLabelLine(line: string) {
    return [
      '需求申请人',
      '需求部门',
      '申请采购事项名称',
      '采购方式',
      '采购类别',
      '采购组织形式',
      '是否属于年度预算',
      '申请立项事由',
      '对供方的主要要求',
      '所属项目/合同及编号',
    ].includes(line);
  }

  export function normalizeStageMatchText(stageMatch: string) {
    return stageMatch
      .replace(/INITIATION/g, '项目立项')
      .replace(/TENDER_DOCUMENT/g, '采购文件')
      .replace(/PUBLIC_ANNOUNCEMENT/g, '采购公示')
      .replace(/EXPERT_SELECTION/g, '专家抽取')
      .replace(/BID_EVALUATION/g, '评标过程')
      .replace(/AWARD_DECISION/g, '定标')
      .replace(/CONTRACT/g, '合同');
  }

  export function getUploadDir() {
    return resolve(process.cwd(), 'uploads', 'project-management');
  }

  export function getProjectSummaryCachePath(projectId: string) {
    return resolve(
      process.cwd(),
      'uploads',
      'project-management',
      `summary-${projectId}.json`,
    );
  }

  export function getStageAnalysisCachePath(projectId: string, stageKey: string) {
    return resolve(
      process.cwd(),
      'uploads',
      'project-management',
      `analysis-${projectId}-${stageKey.toLowerCase()}.json`,
    );
  }

  export function getComplianceCachePath(projectId: string, stageKey: string) {
    return resolve(
      process.cwd(),
      'uploads',
      'project-management',
      `compliance-${projectId}-${stageKey.toLowerCase()}.json`,
    );
  }

  export function getStepAnalysisCachePath(projectId: string, stageKey: string) {
    return resolve(
      process.cwd(),
      'uploads',
      'project-management',
      `step-${projectId}-${stageKey.toLowerCase()}.json`,
    );
  }

  export function buildStageAnalysisFingerprint(
    stageKey: string,
    attachments: Array<{
      objectKey: string;
      createdAt?: Date | null;
      fileSize: number;
    }>,
  ) {
    const fileSignature = attachments
      .map((attachment) =>
        [attachment.objectKey, attachment.fileSize].join('@'),
      )
      .sort()
      .join('|');

    return `${stageKey}:${fileSignature}`;
  }

  export function sanitizeFileName(fileName: string) {
    const normalizedFileName = normalizeUploadedFileName(fileName);
    const base = basename(normalizedFileName, extname(normalizedFileName));
    const extension = extname(normalizedFileName) || '.bin';
    const safeBase = base.replace(/[^a-zA-Z0-9一-龥_-]+/g, '-');
    return `${safeBase}${extension}`;
  }

  export function normalizeUploadedFileName(fileName: string) {
    if (/[\x00-\x7f]*[一-龥]/.test(fileName)) {
      return fileName;
    }

    const decoded = Buffer.from(fileName, 'latin1').toString('utf8');
    return decoded.includes('�') ? fileName : decoded;
  }

/**
 * 生成编辑器 HTML 的纯文本行 diff 摘要（旧 docx buffer vs 新 HTML）。
 * 供采购文件"修改历史"弹窗展示：每次保存记录改了什么。
 * 策略：各自提取纯文本行 → 逐行比对（简单 LCS 太重，用集合差 + 顺序敏感的逐行扫描），
 * 输出"删除 N 行 / 新增 N 行 + 前 5 条变更摘录"，截断至 600 字符。
 */
export async function summarizeHtmlDiff(
  oldDocxBuffer: Buffer,
  newHtml: string,
): Promise<string> {
  try {
    // 延迟加载 mammoth，避免 file-utils 引入时强依赖
    const mammoth = (await import('mammoth')) as any;
    const oldResult = await mammoth.extractRawText({ buffer: oldDocxBuffer });
    const oldText: string = oldResult.value || '';

    // 新 HTML → 纯文本（块级标签转行）
    const newText: string = newHtml
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

    const oldLines = oldText.split('\n').map(s => s.trim()).filter(Boolean);
    const newLines = newText.split('\n').map(s => s.trim()).filter(Boolean);

    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    const removed = oldLines.filter((l, i) => !newSet.has(l) && (i === 0 || l !== oldLines[i - 1]));
    const added = newLines.filter((l, i) => !oldSet.has(l) && (i === 0 || l !== newLines[i - 1]));

    if (removed.length === 0 && added.length === 0) return '无文本内容变更（可能仅格式调整）';

    const parts: string[] = [];
    if (added.length > 0) {
      parts.push(`新增 ${added.length} 处：` + added.slice(0, 5).map(l => `「${l.slice(0, 40)}${l.length > 40 ? '…' : ''}」`).join('、'));
    }
    if (removed.length > 0) {
      parts.push(`删除 ${removed.length} 处：` + removed.slice(0, 5).map(l => `「${l.slice(0, 40)}${l.length > 40 ? '…' : ''}」`).join('、'));
    }
    if (added.length > 5 || removed.length > 5) parts.push('……等');
    return parts.join('；').slice(0, 600);
  } catch {
    return '内容已更新';
  }
}
