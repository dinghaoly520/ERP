import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** multer 默认把 multipart 文件名按 latin1 解析，中文变 mojibake；还原为 utf8 */
export function sanitizeFileName(raw: string): string {
  return Buffer.from(raw, 'latin1').toString('utf8');
}

/** 需要转为 PDF 的 Office 文档 MIME 类型 */
const OFFICE_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.ms-word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template', // .dotx
]);

const FILE_EXT_RE = /\.docx?$/i;

export interface ConversionResult {
  buffer: Buffer;
  fileName: string;
  mimeType: 'application/pdf';
}

/**
 * 把 Office Word 文档（.doc/.docx）转为 PDF。
 *
 * - 通过 MIME 或扩展名识别；非 Office 文件立即返回 null。
 * - 用 LibreOffice headless 转换（复用仓库既有模式；系统已预装 libreoffice）。
 * - 失败时返回 null，不抛异常。调用方降级使用原始文件。
 * - 使用同步 execSync（与 expert.service 保持一致，单次转换通常 < 10s）。
 */
export function convertOfficeToPdf(
  fileBuffer: Buffer,
  mimeType: string,
  originalName: string,
): ConversionResult | null {
  if (!OFFICE_MIMES.has(mimeType) && !FILE_EXT_RE.test(originalName)) {
    return null; // 非 Office 文档，跳过
  }

  const ext = originalName.includes('.') ? originalName.split('.').pop()!.toLowerCase() : 'bin';
  const pdfName = originalName.replace(/\.docx?$/i, '.pdf');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'office2pdf-'));
  const srcPath = path.join(tmpDir, `input.${ext}`);

  try {
    fs.writeFileSync(srcPath, fileBuffer);
    execSync(
      `libreoffice --headless --convert-to pdf --outdir "${tmpDir}" "${srcPath}"`,
      { timeout: 60_000, stdio: 'pipe' },
    );

    // LibreOffice 输出文件名为 input.pdf（srcPath 保持原名时叫 input.{ext}.pdf，改为 input.pdf 是因为 libreoffice 用 --outdir 时输出名固定"
    // 注意：libreoffice 把 input.docx 转为 input.pdf（保留基础名，改扩展名）
    const pdfPath = path.join(tmpDir, `input.pdf`);
    if (!fs.existsSync(pdfPath)) {
      return null;
    }

    const pdfBuffer = fs.readFileSync(pdfPath);
    return { buffer: pdfBuffer, fileName: pdfName, mimeType: 'application/pdf' };
  } catch (err: any) {
    // LibreOffice 转换失败不阻塞上传，降级存原始文件
    if (err?.stderr) {
      console.warn(`[OfficeToPdf] LibreOffice stderr: ${String(err.stderr).slice(0, 300)}`);
    }
    return null;
  } finally {
    // 清理临时文件
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
