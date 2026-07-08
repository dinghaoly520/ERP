import * as path from 'path';
import * as mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

export type ParsedFile = {
  name: string;
  text: string;
};

export async function parseUploadedFile(
  fileBuffer: Buffer,
  originalName?: string,
): Promise<ParsedFile> {
  const safeName = originalName || 'unknown.bin';
  const ext = path.extname(safeName).toLowerCase();
  const name = originalName || safeName;

  if (ext === '.doc') {
    throw new Error(
      `暂不支持 .doc 文件"${originalName}"，请另存为 .docx 后再上传。`,
    );
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    const text = result.value.trim();
    if (!text) {
      throw new Error(`文件"${originalName}"未提取到文本内容。`);
    }
    return { name, text };
  }

  if (ext === '.pdf') {
    const data = await pdfParse(fileBuffer);
    const text = data.text.trim();
    if (!text || text.length < 20) {
      throw new Error(
        `文件"${originalName}"未提取到足够文本内容，可能为扫描件。暂不支持扫描件 OCR。`,
      );
    }
    return { name, text };
  }

  if (ext === '.md' || ext === '.txt') {
    const text = fileBuffer.toString('utf-8').trim();
    if (!text) {
      throw new Error(`文件"${originalName}"内容为空。`);
    }
    return { name, text };
  }

  throw new Error(`不支持的文件类型"${ext}"。`);
}
