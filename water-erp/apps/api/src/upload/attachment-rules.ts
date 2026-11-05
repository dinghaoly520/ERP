import { BadRequestException } from '@nestjs/common';

/**
 * 单文件统一上限 500MB（2026-11-05 用户裁定：800 页扫描标书 ~200-400MB，旧 50/100MB 分档截断大件）。
 * 内存模型：multer 内存存储按实际文件大小增长（解析瞬时 ~2×，请求结束归还 OS），
 * 32G 生产机并发 2-3 个大件上传峰值 +2-3GB，余量充足。
 */
export const ATTACHMENT_MAX_BYTES = 500 * 1024 * 1024;
/** 其余类目同口径（历史分档 50/100MB 已统一） */
export const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;

export const ATTACHMENT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx', 'pdf', 'zip', 'rar'] as const;

export function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

export function isAttachmentExtensionAllowed(name: string): boolean {
  const ext = getFileExtension(name);
  return (ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext);
}

const HINT = '支持 PNG/JPG/Word/PDF/Excel/ZIP/RAR';

/**
 * 服务层附件大小/格式闸（multer 之后、落 MinIO 之前）。
 * 大小：全类目统一 500MB（2026-11-05）；
 * 格式：仅 announcement 类目套 10 扩展白名单（contract_document 的格式由
 * matchesFileContentPolicy 内容闸把守，勿在此放松）。
 * size 取 file.size ?? buffer.length（内存存储下二者一致，测试可只给其一）。
 */
export function assertAttachmentRules(
  file: { originalname: string; size?: number; buffer?: Buffer },
  category: string,
): void {
  const size = file.size ?? file.buffer?.length ?? 0;
  const maxBytes =
    category === 'announcement' || category === 'contract_document'
      ? ATTACHMENT_MAX_BYTES
      : DEFAULT_MAX_BYTES;
  if (size > maxBytes) {
    throw new BadRequestException({
      error: `单个文件不能超过 ${maxBytes / (1024 * 1024)}MB（当前 ${(size / (1024 * 1024)).toFixed(1)}MB）`,
      code: 'ATTACHMENT_FILE_TOO_LARGE',
    });
  }
  if (category === 'announcement' && !isAttachmentExtensionAllowed(file.originalname)) {
    throw new BadRequestException({
      error: `不支持的附件格式，${HINT}（当前文件：${file.originalname}）`,
      code: 'ATTACHMENT_FILE_TYPE_INVALID',
    });
  }
}
