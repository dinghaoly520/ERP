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

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;
type Call = { cmd: string; args: string[]; opts: { timeout?: number } };

const FAKE_PDF = '%PDF-1.4 fake';

/** 假 LibreOffice 写出的输出文件：源文件恒为 input.<ext>，输出恒为 input.pdf */
const outputOf = (args: string[]) => args[args.length - 1].replace(/input\.docx?$/, 'input.pdf');

/** 假 LibreOffice（立即完成版）：记录收到的参数，马上写出 input.pdf 并回调成功 */
function fakeLibreOffice(onCall?: (call: Call) => void) {
  mockExecFile.mockImplementation((cmd: string, args: string[], opts: { timeout?: number }, cb: ExecCallback) => {
    onCall?.({ cmd, args, opts });
    fs.writeFileSync(outputOf(args), FAKE_PDF);
    cb(null, '', '');
  });
}

/**
 * 假 LibreOffice（停泊版）：每个调用进来就停住、占着槽，直到 releaseAll() 才写出 input.pdf 并回调。
 * 并发用例靠它控制先后，不靠计时——慢 CI 上事件循环卡多久都不会改变结果。
 * failFirst：前 N 个调用经 setImmediate 回调失败（模拟 LibreOffice 崩溃），不停泊。
 */
function parkingLibreOffice(opts: { failFirst?: number } = {}) {
  let failuresLeft = opts.failFirst ?? 0;
  const parked: Array<{ args: string[]; cb: ExecCallback }> = [];
  let total = 0;
  let peak = 0;
  mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: ExecCallback) => {
    total += 1;
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      setImmediate(() => cb(new Error('soffice crashed'), '', ''));
      return;
    }
    parked.push({ args, cb });
    peak = Math.max(peak, parked.length);
  });
  /**
   * 等到累计有 n 个转换真正进到 LibreOffice（即拿到了槽）。
   * 上限按真实时间设，不按让出事件循环的次数：全量并行跑时 CPU 被抢，一次 1 字节的落盘也可能
   * 迟迟不回来，按次数数会在正常实现上误报（2026-11-24 实录）。正常实现下这个等待只有几毫秒。
   */
  const waitStarted = async (n: number): Promise<void> => {
    const deadline = Date.now() + 8000;
    while (total < n && Date.now() < deadline) await new Promise<void>((r) => setImmediate(r));
    if (total < n) throw new Error(`只有 ${total}/${n} 个转换拿到槽`);
  };
  const releaseAll = (): void => {
    for (const p of parked.splice(0)) {
      fs.writeFileSync(outputOf(p.args), FAKE_PDF);
      p.cb(null, '', '');
    }
  };
  return { waitStarted, releaseAll, running: () => parked.length, total: () => total, peak: () => peak };
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
  beforeEach(() => { call = undefined; fakeLibreOffice((c) => { call = c; }); });

  it('文件名带反引号载荷：数组参数、源文件名固定、载荷不进任何参数、不走 execSync', async () => {
    const result = await convertOfficeToPdf(Buffer.from('x'), DOC_MIME, PAYLOAD_NAME);
    expect(result).not.toBeNull();
    expect(result!.buffer.toString()).toBe(FAKE_PDF);
    expect(result!.mimeType).toBe('application/pdf');
    expect(mockExecSync).not.toHaveBeenCalled();
    expect(call!.cmd).toBe('libreoffice');
    expect(path.basename(call!.args[call!.args.length - 1])).toBe('input.doc');
    expect(call!.args.join(' ')).not.toContain('poc-marker');
    expect(call!.opts.timeout).toBe(60_000);
    // 展示名沿用现行为：文件名不以 .doc/.docx 结尾就保持原样
    expect(result!.fileName).toBe(PAYLOAD_NAME);
  });

  // 设计文档 3.1 的验收：反引号、$()、分号、引号四类载荷
  it.each([
    ['a.`>poc-marker`', '反引号'],
    ['a.$(poc-marker)', '$()'],
    ['a.;poc-marker', '分号'],
    ['a."poc-marker"', '双引号'],
  ])('文件名带%s载荷（%s）：载荷不进任何参数，源文件名固定', async (payloadName, _kind) => {
    const result = await convertOfficeToPdf(Buffer.from('x'), DOC_MIME, payloadName);
    expect(result).not.toBeNull();
    expect(path.basename(call!.args[call!.args.length - 1])).toBe('input.doc');
    expect(call!.args.join(' ')).not.toContain('poc-marker');
    expect(mockExecSync).not.toHaveBeenCalled();
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
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    // 等槽超时会打真实警告：接住它，不让输出变脏；要断言日志的用例从 warnSpy 里读
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => { warnSpy.mockRestore(); });

  const convert = (name: string, limits?: { slotWaitMs?: number }) =>
    convertOfficeToPdf(Buffer.from('x'), DOC_MIME, name, limits);

  /**
   * 跑一个并发用例并保证收尾：无论断言是否通过，都放行停泊的调用。
   * 槽位是模块级状态，一个失败的用例若把占着的槽漏出去，后面的用例会连锁误报。
   */
  const withParking = async (
    opts: { failFirst?: number },
    body: (lib: ReturnType<typeof parkingLibreOffice>) => Promise<void>,
  ): Promise<void> => {
    const lib = parkingLibreOffice(opts);
    try { await body(lib); } finally { lib.releaseAll(); }
  };

  it('同时 5 个转换：在跑的恰为 2 个、其余排队；放行后依次补位，全部完成', () => withParking({}, async (lib) => {
    const all = Promise.all(['f0', 'f1', 'f2', 'f3', 'f4'].map((n) => convert(`${n}.doc`)));
    await lib.waitStarted(2);
    await new Promise((r) => setTimeout(r, 25)); // 给「如果有第 3 个被放进来」留出到达的时间
    expect(lib.total()).toBe(2);
    lib.releaseAll();
    await lib.waitStarted(4);
    expect(lib.running()).toBe(2);
    lib.releaseAll();
    await lib.waitStarted(5);
    expect(lib.running()).toBe(1);
    lib.releaseAll();
    expect((await all).every((r) => r !== null)).toBe(true);
    expect(lib.peak()).toBe(2);
  }));

  it('两槽都忙且等槽超时 → null；槽释放后后续转换照常拿到槽', () => withParking({}, async (lib) => {
    const busy = [convert('a.doc'), convert('b.doc')];
    await lib.waitStarted(2);
    // a、b 没被放行，一直占着槽：c 无论机器多慢都等不到
    await expect(convert('c.doc', { slotWaitMs: 20 })).resolves.toBeNull();
    expect(lib.running()).toBe(2);
    lib.releaseAll();
    await Promise.all(busy);

    const next = convert('d.doc');
    await lib.waitStarted(3);
    lib.releaseAll();
    expect(await next).not.toBeNull();
  }));

  it('等槽者拿不到槽不会占着名额：被拒后两个槽都还能立即交出去', () => withParking({}, async (lib) => {
    const busy = [convert('a.doc'), convert('b.doc')];
    await lib.waitStarted(2);
    await expect(convert('c.doc', { slotWaitMs: 20 })).resolves.toBeNull();
    lib.releaseAll();
    await Promise.all(busy);

    const again = [convert('e.doc'), convert('f.doc')];
    await lib.waitStarted(4);
    expect(lib.running()).toBe(2);
    lib.releaseAll();
    expect((await Promise.all(again)).every((r) => r !== null)).toBe(true);
    expect(lib.peak()).toBe(2);
  }));

  it('转换抛错后槽位归还：连续两次失败之后，接着两个转换立即拿到槽', () => withParking({ failFirst: 2 }, async (lib) => {
    await expect(convert('a.doc')).resolves.toBeNull();
    await expect(convert('b.doc')).resolves.toBeNull();
    // 如果失败路径漏还槽，下面这两个只能干等——waitStarted 会直接报「拿不到槽」，而不是等满等槽时限
    const next = [convert('c.doc'), convert('d.doc')];
    await lib.waitStarted(4);
    expect(lib.running()).toBe(2);
    lib.releaseAll();
    expect((await Promise.all(next)).every((r) => r !== null)).toBe(true);
  }));

  it('默认等槽 5 秒：到 4999 毫秒仍在等，满 5000 毫秒才放弃', async () => {
    // 只假化计时器：setImmediate 与 Date 保持真实——夹具靠真实时间设等待上限
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'Date'] });
    try {
      await withParking({}, async (lib) => {
        const busy = [convert('a.doc'), convert('b.doc')];
        await lib.waitStarted(2);
        let outcome = 'waiting';
        const third = convert('c.doc').then((r) => { outcome = r === null ? 'gave-up' : 'got-slot'; return r; });
        await jest.advanceTimersByTimeAsync(4999);
        expect(outcome).toBe('waiting');
        await jest.advanceTimersByTimeAsync(1);
        await third;
        expect(outcome).toBe('gave-up');
        lib.releaseAll();
        await Promise.all(busy);
      });
    } finally { jest.useRealTimers(); }
  });

  it('等槽超时打一条警告，带上在跑数与等了多久（新增的降级路径不能没有痕迹）', () => withParking({}, async (lib) => {
    const busy = [convert('a.doc'), convert('b.doc')];
    await lib.waitStarted(2);
    await expect(convert('c.doc', { slotWaitMs: 20 })).resolves.toBeNull();
    const lines = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('在跑 2 个') && l.includes('等槽 20ms'))).toBe(true);
    lib.releaseAll();
    await Promise.all(busy);
  }));
});
