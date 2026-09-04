type FileLike = Pick<Express.Multer.File, 'originalname' | 'mimetype' | 'buffer'>;

const EXTENSIONS_BY_MIME: Record<string, readonly string[]> = {
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
};

function hasPrefix(buffer: Buffer, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function hasExpectedMagic(buffer: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'application/pdf':
      return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    case 'image/jpeg':
      return hasPrefix(buffer, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'application/msword':
      return hasPrefix(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04])
        && buffer.includes(Buffer.from('[Content_Types].xml'))
        && buffer.includes(Buffer.from('word/'));
    default:
      return false;
  }
}

/** 同时核对用途允许的 MIME、文件扩展名及魔数，避免只改文件名/MIME 伪装业务凭证。 */
export function matchesFileContentPolicy(file: FileLike, allowedMimeTypes: readonly string[]): boolean {
  if (!allowedMimeTypes.includes(file.mimetype)) return false;
  const extension = file.originalname.toLowerCase().split('.').pop() ?? '';
  return Boolean(EXTENSIONS_BY_MIME[file.mimetype]?.includes(extension))
    && hasExpectedMagic(file.buffer, file.mimetype);
}

export const PDF_WORD_IMAGE_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
] as const;

export const PDF_IMAGE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
