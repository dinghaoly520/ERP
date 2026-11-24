import * as fs from 'node:fs';
import * as path from 'node:path';

const mockExecFile = jest.fn();
const mockExecSync = jest.fn();
// 同时桩掉带前缀与不带前缀的两个模块名：修复前的实现 import 的是不带前缀的 'child_process'，
// 只桩一个的话，「确认失败」那一步会真的执行载荷
jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));
jest.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

import { convertOfficeToPdf, resolveOfficeExtension } from './office-to-pdf.util';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOC_MIME = 'application/msword';
/** 最后一个点之后是反引号载荷——修复前会被拼进 shell 命令并在本进程 cwd 建出 poc-marker */
const PAYLOAD_NAME = 'a.`>poc-marker`';

type Call = { cmd: string; args: string[]; opts: { timeout?: number } };

/** 假 LibreOffice：记录收到的参数，占槽 holdMs 毫秒后在源文件同目录写出 input.pdf */
function fakeLibreOffice(holdMs: number, onCall?: (call: Call) => void) {
  let inFlight = 0;
  let peak = 0;
  mockExecFile.mockImplementation((cmd: string, args: string[], opts: { timeout?: number }, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    onCall?.({ cmd, args, opts });
    const src = args[args.length - 1];
    setTimeout(() => {
      fs.writeFileSync(src.replace(/input\.docx?$/, 'input.pdf'), '%PDF-1.4 fake');
      inFlight--;
      cb(null, '', '');
    }, holdMs);
  });
  return { peak: () => peak };
}

afterEach(() => { mockExecFile.mockReset(); mockExecSync.mockReset(); });

describe('resolveOfficeExtension', () => {
  it.each([
    [DOCX_MIME, '任意名字', 'docx'],
    [DOC_MIME, '任意名字', 'doc'],
    ['application/octet-stream', '报告.docx', 'docx'],
    ['application/octet-stream', '报告.doc', 'doc'],
    ['application/pdf', '报告.pdf', null],
    ['application/octet-stream', '报告.docx.exe', null],
  ] as const)('%s + %s → %s', (mime, name, expected) => {
    expect(resolveOfficeExtension(mime, name)).toBe(expected);
  });
});

describe('convertOfficeToPdf — 不经 shell', () => {
  let call: Call | undefined;
  beforeEach(() => { call = undefined; fakeLibreOffice(0, (c) => { call = c; }); });

  it('文件名带反引号载荷：数组参数、源文件名固定、载荷不进任何参数、不走 execSync', async () => {
    const result = await convertOfficeToPdf(Buffer.from('x'), DOC_MIME, PAYLOAD_NAME);
    expect(result).not.toBeNull();
    expect(result!.buffer.toString()).toBe('%PDF-1.4 fake');
    expect(result!.mimeType).toBe('application/pdf');
    expect(mockExecSync).not.toHaveBeenCalled();
    expect(call!.cmd).toBe('libreoffice');
    expect(path.basename(call!.args[call!.args.length - 1])).toBe('input.doc');
    expect(call!.args.join(' ')).not.toContain('poc-marker');
    expect(call!.opts.timeout).toBe(60_000);
    // 展示名沿用现行为：文件名不以 .doc/.docx 结尾就保持原样
    expect(result!.fileName).toBe(PAYLOAD_NAME);
  });

  it('合法中文文件名：临时名仍是固定名，展示名换 .pdf', async () => {
    const result = await convertOfficeToPdf(Buffer.from('x'), DOCX_MIME, '采购文件 终版.docx');
    expect(path.basename(call!.args[call!.args.length - 1])).toBe('input.docx');
    expect(result!.fileName).toBe('采购文件 终版.pdf');
  });

  it('非 Office 文件不启动 LibreOffice', async () => {
    await expect(convertOfficeToPdf(Buffer.from('%PDF-1.4'), 'application/pdf', '报告.pdf')).resolves.toBeNull();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('每次转换用独立的 LibreOffice 配置目录', async () => {
    await convertOfficeToPdf(Buffer.from('x'), DOC_MIME, 'x.doc');
    const outdir = call!.args[call!.args.indexOf('--outdir') + 1];
    expect(call!.args).toContain(`-env:UserInstallation=file://${outdir}/profile`);
  });
});

describe('convertOfficeToPdf — 降级与清理', () => {
  it('LibreOffice 失败 → 返回 null，临时目录已删', async () => {
    let outdir = '';
    mockExecFile.mockImplementation((_c: string, args: string[], _o: unknown, cb: (e: Error) => void) => {
      outdir = String(args[args.indexOf('--outdir') + 1]);
      cb(new Error('soffice crashed'));
    });
    await expect(convertOfficeToPdf(Buffer.from('x'), DOC_MIME, 'x.doc')).resolves.toBeNull();
    expect(fs.existsSync(outdir)).toBe(false);
  });

  it('转换超时 → 返回 null，临时目录已删，超时值来自 limits', async () => {
    let outdir = '';
    let seenTimeout: number | undefined;
    mockExecFile.mockImplementation((_c: string, args: string[], opts: { timeout?: number }, cb: (e: Error) => void) => {
      outdir = String(args[args.indexOf('--outdir') + 1]);
      seenTimeout = opts.timeout;
      setTimeout(() => cb(Object.assign(new Error('killed'), { killed: true })), opts.timeout);
    });
    await expect(convertOfficeToPdf(Buffer.from('x'), DOC_MIME, 'x.doc', { convertTimeoutMs: 30 })).resolves.toBeNull();
    expect(seenTimeout).toBe(30);
    expect(fs.existsSync(outdir)).toBe(false);
  });
});

describe('convertOfficeToPdf — 并发闸', () => {
  it('同时 5 个转换，任一时刻在跑的不超过 2 个', async () => {
    const lib = fakeLibreOffice(40);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => convertOfficeToPdf(Buffer.from('x'), DOC_MIME, `f${i}.doc`)),
    );
    expect(results.every((r) => r !== null)).toBe(true);
    expect(lib.peak()).toBe(2);
  });

  it('两槽都忙且等槽超时 → null；槽释放后后续转换照常', async () => {
    const lib = fakeLibreOffice(200);
    const busy = [
      convertOfficeToPdf(Buffer.from('x'), DOC_MIME, 'a.doc'),
      convertOfficeToPdf(Buffer.from('x'), DOC_MIME, 'b.doc'),
    ];
    await new Promise((r) => setTimeout(r, 20));
    await expect(convertOfficeToPdf(Buffer.from('x'), DOC_MIME, 'c.doc', { slotWaitMs: 50 })).resolves.toBeNull();
    await Promise.all(busy);
    await expect(convertOfficeToPdf(Buffer.from('x'), DOC_MIME, 'd.doc')).resolves.not.toBeNull();
    expect(lib.peak()).toBe(2);
  });

  it('等槽者拿不到槽不会占着名额：连续被拒后计数归零', async () => {
    const lib = fakeLibreOffice(120);
    const busy = [
      convertOfficeToPdf(Buffer.from('x'), DOC_MIME, 'a.doc'),
      convertOfficeToPdf(Buffer.from('x'), DOC_MIME, 'b.doc'),
    ];
    await new Promise((r) => setTimeout(r, 10));
    await expect(convertOfficeToPdf(Buffer.from('x'), DOC_MIME, 'c.doc', { slotWaitMs: 30 })).resolves.toBeNull();
    await Promise.all(busy);
    // 名额已全部归还：再发两个都应立即拿到槽
    const again = await Promise.all([
      convertOfficeToPdf(Buffer.from('x'), DOC_MIME, 'e.doc'),
      convertOfficeToPdf(Buffer.from('x'), DOC_MIME, 'f.doc'),
    ]);
    expect(again.every((r) => r !== null)).toBe(true);
    expect(lib.peak()).toBe(2);
  });
});
