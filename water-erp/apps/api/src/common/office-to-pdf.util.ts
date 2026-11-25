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
 *  - 返回的 fileName 只用于展示与存储元数据，不参与任何路径或命令；进日志时转义。
 *
 * 运行形态：
 *  - 异步。旧实现的同步 execSync 在请求线程里最长阻塞 60 秒，任何供应商上传一个大 Word
 *    就能卡住整个 API；
 *  - 进程内并发上限 2。两个槽都忙时最多等 5 秒，仍拿不到槽就返回 null——不排长队，
 *    :3005 代理对 /api/upload 是 15 秒超时，等久了代理先报超时而 API 仍在转换并存盘。
 *    开评标现场的两条路径（开标记录签字页、评标签字包）没有这层 15 秒限制，用
 *    ONSITE_CONVERT_OVERRIDES 等得更久；
 *  - 每次转换用独立的 LibreOffice 配置目录，多个实例互不抢 profile 锁；
 *  - 失败一律返回 null，不抛；调用方按各自既有语义降级。每一种失败都打一条带原因的警告——
 *    降级是静默发生的（Word 被存成未转换的原件），日志是事后唯一的线索。
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

/**
 * 调用方可覆盖的项——只有等槽时间与转换时限。
 * 并发上限不可按调用方覆盖：槽位池是进程级的，各调用方各设上限没有一致的含义
 * （按默认上限归还槽位时，会让「上限 1」的调用方跑出 2 个并发；2026-11-25 审查）。
 */
export type OfficeConvertOverrides = Partial<Pick<OfficeConvertLimits, 'slotWaitMs' | 'convertTimeoutMs'>>;

/**
 * 开评标现场两条路径（开标记录签字页、评标签字包）的等槽时间。
 * 这两处在 :3007 现场用，门户经 next.config rewrites 回源，没有 :3005 代理那 15 秒超时；
 * 而在这里拿不到 PDF 的代价是当场报「转换繁忙」、或把签字包永久存成 DOCX，所以值得多等。
 * 取 30 秒：任意登录角色（含供应商、专家）的两个大 Word 最长各占一个槽 60 秒，30 秒能覆盖
 * 绝大多数争用，同时给网关常见的 60 秒读超时留出余量。
 */
export const ONSITE_SLOT_WAIT_MS = 30_000;
export const ONSITE_CONVERT_OVERRIDES: Readonly<OfficeConvertOverrides> = Object.freeze({
  slotWaitMs: ONSITE_SLOT_WAIT_MS,
});

let active = 0;
const waiters: Array<{ timer: NodeJS.Timeout; resolve: (got: boolean) => void }> = [];

function acquireSlot(waitMs: number): Promise<boolean> {
  if (active < OFFICE_CONVERT_LIMITS_DEFAULT.maxConcurrent) {
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

/** 文件名是用户可控的：经 JSON.stringify 再截断，换行之类的控制字符伪造不出第二条日志 */
const nameForLog = (name: string): string => JSON.stringify(name).slice(0, 120);

/** 把一次失败的原因摊开成一行：错误码、是否被信号终止、消息、stderr 的末尾 */
function describeFailure(err: any): string {
  const parts = [`code=${err?.code ?? '-'}`];
  if (err?.killed) parts.push(`killed=${String(err?.signal ?? 'signal')}`);
  parts.push(`message=${String(err?.message ?? err).replace(/\s+/g, ' ').slice(0, 200)}`);
  if (err?.stderr) parts.push(`stderr=${JSON.stringify(String(err.stderr).trim().slice(-300))}`);
  return parts.join('；');
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
  limits?: OfficeConvertOverrides,
): Promise<ConversionResult | null> {
  const ext = resolveOfficeExtension(mimeType, originalName);
  if (!ext) return null; // 非 Office 文档，跳过

  const slotWaitMs = limits?.slotWaitMs ?? OFFICE_CONVERT_LIMITS_DEFAULT.slotWaitMs;
  const gotSlot = await acquireSlot(slotWaitMs);
  if (!gotSlot) {
    // 不留痕的话，供应商的 Word 被静默存成未转换的原件、现场签字页报「转换失败」，
    // 事后在日志里查不到任何线索
    console.warn(
      `[OfficeToPdf] LibreOffice 转换并发已满：在跑 ${active} 个，等槽 ${slotWaitMs}ms 未果——降级存原文件；文件=${nameForLog(originalName)}`,
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
    if (!fs.existsSync(pdfPath)) {
      console.warn(`[OfficeToPdf] LibreOffice 转换结束但没有产出 PDF；文件=${nameForLog(originalName)}`);
      return null;
    }

    return {
      buffer: await fs.promises.readFile(pdfPath),
      fileName: originalName.replace(/\.docx?$/i, '.pdf'),
      mimeType: 'application/pdf',
    };
  } catch (err: any) {
    // 转换失败不阻塞上传，降级存原始文件——留一条带原因的警告
    // （LibreOffice 没装时是 ENOENT 且 stderr 为空；超时被杀时 stderr 里往往只有一句无关的启动告警）
    console.warn(`[OfficeToPdf] LibreOffice 转换失败：${describeFailure(err)}；文件=${nameForLog(originalName)}`);
    return null;
  } finally {
    // 清理临时文件，并归还槽位（异常路径也要归还，否则后续转换会被卡死）
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    releaseSlot();
  }
}
