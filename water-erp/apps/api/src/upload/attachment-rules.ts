import { BadRequestException } from '@nestjs/common';

/** 附件统一限制（2026-10-19 spec：公告中心/项目管理）：单文件 ≤100MB、9 扩展名白名单 */
export const ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
/** 其余类目维持旧 50MB 口径（/api/upload multer 提至 100MB 后由服务层把住，防外溢） */
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export const ATTACHMENT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx', 'pdf', 'zip', 'rar'] as const;

/** 走 100MB+白名单的 /upload 类目（contract_document 仅 100MB，格式由 PDF_WORD_IMAGE 内容闸管） */
export const ATTACHMENT_WHITELIST_CATEGORIES: ReadonlySet<string> = new Set(['announcement']);

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
 * 大小：announcement / contract_document 100MB，其余类目 50MB；
 * 格式：仅 announcement 类目套 9 扩展白名单（contract_document 的格式由
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
