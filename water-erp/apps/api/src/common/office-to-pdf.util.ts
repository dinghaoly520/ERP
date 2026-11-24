import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as os from 'node:os';

/** multer 默认把 multipart 文件名按 latin1 解析，中文变 mojibake；还原为 utf8 */
/**
 * ⚠️ 已删除（2026-11-13）：无条件 latin1→utf8 的 sanitizeFileName 对正确 UTF-8 输入
 * （filename* 扩展参数/程序直写）会二次毁伤。multipart 文件名归一化统一改用
 * common/filename-encoding.util.ts 的条件式安全版 normalizeMultipartFilename。
 * （project-management/docx/file-utils.ts 有同名的另一份文件名清洗函数，职责不同，未动。）
 */

/**
 * Office 转 PDF（2026-11-24 审计第 1 处重写，封 P1-1／P1-2 前半／P1-3）。
 *
 * 安全要点——用户可控的文件名绝不能进入 shell 命令或落盘路径：
 *  - 子进程用 execFile 数组参数，不经 shell（旧实现把文件名最后一个点之后的部分拼进
 *    execSync 字符串，任何登录角色可借反引号在 API 服务器执行命令）；
 *  - 临时文件名固定为 input.doc / input.docx，扩展名只取自声明 MIME 与文件名后缀的
 *    「是否 Word」判定，永远是两个常量之一；
 *  - 返回的 fileName 只用于展示与存储元数据，不参与任何路径或命令。
 *
 * 运行形态：
 *  - 异步。旧实现的同步 execSync 在请求线程里最长阻塞 60 秒，任何供应商上传一个大 Word
 *    就能卡住整个 API；
 *  - 进程内并发上限 2。两个槽都忙时最多等 5 秒，仍拿不到槽就返回 null——不排长队，
 *    :3005 代理对 /api/upload 是 15 秒超时，等久了代理先报超时而 API 仍在转换并存盘；
 *  - 每次转换用独立的 LibreOffice 配置目录，多个实例互不抢 profile 锁；
 *  - 失败一律返回 null，不抛；调用方按各自既有语义降级。
 */

/** docx 系（.docx 正文与 .dotx 模板） */
const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
]);
/** doc 系 */
const DOC_MIMES = new Set(['application/msword', 'application/vnd.ms-word']);

export interface ConversionResult {
  buffer: Buffer;
  fileName: string;
  mimeType: 'application/pdf';
}

export type OfficeExtension = 'doc' | 'docx';

/** 该不该转换、落成哪种临时扩展名；返回 null 表示非 Office 文档、不转换 */
export function resolveOfficeExtension(mimeType: string, originalName: string): OfficeExtension | null {
  if (DOCX_MIMES.has(mimeType)) return 'docx';
  if (DOC_MIMES.has(mimeType)) return 'doc';
  if (/\.docx$/i.test(originalName)) return 'docx';
  if (/\.doc$/i.test(originalName)) return 'doc';
  return null;
}

export interface OfficeConvertLimits {
  maxConcurrent: number;
  slotWaitMs: number;
  convertTimeoutMs: number;
}

export const OFFICE_CONVERT_LIMITS_DEFAULT: Readonly<OfficeConvertLimits> = Object.freeze({
  maxConcurrent: 2,
  slotWaitMs: 5_000,
  convertTimeoutMs: 60_000,
});

let active = 0;
const waiters: Array<{ timer: NodeJS.Timeout; resolve: (got: boolean) => void }> = [];

function acquireSlot(maxConcurrent: number, waitMs: number): Promise<boolean> {
  if (active < maxConcurrent) {
    active += 1;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const waiter = {
      timer: setTimeout(() => {
        const i = waiters.indexOf(waiter);
        if (i >= 0) waiters.splice(i, 1);
        resolve(false);
      }, waitMs),
      resolve,
    };
    waiters.push(waiter);
  });
}

function releaseSlot(): void {
  active -= 1;
  while (active < OFFICE_CONVERT_LIMITS_DEFAULT.maxConcurrent && waiters.length > 0) {
    const next = waiters.shift()!;
    clearTimeout(next.timer);
    active += 1;
    next.resolve(true);
  }
}

function runLibreOffice(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'libreoffice',
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) {
          (err as Error & { stderr?: string }).stderr = stderr?.toString() ?? '';
          reject(err);
          return;
        }
        resolve();
      },
    );
  });
}

/**
 * 把 Office Word 文档（.doc/.docx）转为 PDF。
 *
 * - 通过 MIME 或文件名后缀识别；非 Office 文件返回 null。
 * - 用 LibreOffice headless 转换（系统已预装 libreoffice）。
 * - 不该转换、转换失败、超时、等槽超时都返回 null，不抛异常；调用方降级使用原始文件。
 * - 异步，调用方必须 await。
 */
export async function convertOfficeToPdf(
  fileBuffer: Buffer,
  mimeType: string,
  originalName: string,
  limits?: Partial<OfficeConvertLimits>,
): Promise<ConversionResult | null> {
  const ext = resolveOfficeExtension(mimeType, originalName);
  if (!ext) return null; // 非 Office 文档，跳过

  const maxConcurrent = limits?.maxConcurrent ?? OFFICE_CONVERT_LIMITS_DEFAULT.maxConcurrent;
  const slotWaitMs = limits?.slotWaitMs ?? OFFICE_CONVERT_LIMITS_DEFAULT.slotWaitMs;
  const gotSlot = await acquireSlot(maxConcurrent, slotWaitMs);
  if (!gotSlot) {
    // 降级路径要留痕（2026-11-24 终审）：不留的话，供应商的 Word 被静默存成未转换的原件、
    // 现场签字页报「转换失败」，事后在日志里查不到任何线索
    console.warn(
      `[OfficeToPdf] LibreOffice 转换并发已满：在跑 ${active} 个，等槽 ${slotWaitMs}ms 未果——降级存原文件`,
    );
    return null; // 两个槽都忙：降级存原文件，不排长队
  }

  let tmpDir: string | null = null;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'office2pdf-'));
    const srcPath = path.join(tmpDir, `input.${ext}`);
    await fs.promises.writeFile(srcPath, fileBuffer);
    await runLibreOffice(
      [
        '--headless',
        // 独立 profile：并发的多个 LibreOffice 实例不抢同一个用户配置目录的锁
        `-env:UserInstallation=${pathToFileURL(path.join(tmpDir, 'profile')).href}`,
        '--convert-to',
        'pdf',
        '--outdir',
        tmpDir,
        srcPath,
      ],
      limits?.convertTimeoutMs ?? OFFICE_CONVERT_LIMITS_DEFAULT.convertTimeoutMs,
    );

    // LibreOffice 的输出名固定为 input.pdf（源名恒为 input.<ext>）
    const pdfPath = path.join(tmpDir, 'input.pdf');
    if (!fs.existsSync(pdfPath)) return null;

    return {
      buffer: await fs.promises.readFile(pdfPath),
      fileName: originalName.replace(/\.docx?$/i, '.pdf'),
      mimeType: 'application/pdf',
    };
  } catch (err: any) {
    // LibreOffice 转换失败不阻塞上传，降级存原始文件
    if (err?.stderr) {
      console.warn(`[OfficeToPdf] LibreOffice stderr: ${String(err.stderr).slice(0, 300)}`);
    }
    return null;
  } finally {
    // 清理临时文件，并归还槽位（异常路径也要归还，否则后续转换会被卡死）
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    releaseSlot();
  }
}
