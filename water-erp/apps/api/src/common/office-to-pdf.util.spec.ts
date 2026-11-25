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
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    // 失败路径会打真实警告：接住它，不让输出变脏；日志内容的断言在「失败留痕」里
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => { warnSpy.mockRestore(); });

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

describe('convertOfficeToPdf — 失败留痕', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => { warnSpy.mockRestore(); });
  const warnLines = () => warnSpy.mock.calls.map((c) => String(c[0]));
  const convert = (name: string) => convertOfficeToPdf(Buffer.from('x'), DOC_MIME, name);

  // 每一种返回 null 的失败都要有迹可循：生产镜像没装 LibreOffice 时，Word 上传会被静默存成
  // 未转换的原件，事后在日志里一条线索都没有（2026-11-25 审查）
  it('LibreOffice 没装（ENOENT，stderr 为空）→ 警告写明错误码与文件名', async () => {
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: ExecCallback) => {
      cb(Object.assign(new Error('spawn libreoffice ENOENT'), { code: 'ENOENT' }), '', '');
    });
    await expect(convert('采购文件.docx')).resolves.toBeNull();
    expect(warnLines().some((l) => l.includes('ENOENT') && l.includes('采购文件.docx'))).toBe(true);
  });

  it('转换超时被杀 → 警告写明是被信号终止，而不是只剩一句无关的启动告警', async () => {
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: ExecCallback) => {
      cb(
        Object.assign(new Error('Command was killed'), { killed: true, signal: 'SIGTERM' }),
        '',
        'Warning: failed to launch javaldx - 首次启动的无关告警',
      );
    });
    await expect(convert('采购文件.docx')).resolves.toBeNull();
    expect(warnLines().some((l) => l.includes('SIGTERM'))).toBe(true);
  });

  it('LibreOffice 正常退出却没有产出 PDF → 警告写明没有产物', async () => {
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: ExecCallback) => cb(null, '', ''));
    await expect(convert('采购文件.docx')).resolves.toBeNull();
    expect(warnLines().some((l) => l.includes('没有产出'))).toBe(true);
  });

  it('警告里的文件名经过转义：含换行的文件名伪造不出第二条日志', async () => {
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: ExecCallback) => {
      cb(Object.assign(new Error('spawn libreoffice ENOENT'), { code: 'ENOENT' }), '', '');
    });
    await convert('a\nFORGED log line.doc');
    expect(warnLines()).toHaveLength(1);
    expect(warnLines()[0]).not.toContain('\n');
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
   * 跑一个并发用例并保证收尾：无论断言是否通过，都把停泊与排队中的转换全部放行到结束。
   * 槽位是模块级状态。只放行已停泊的调用不够——它们结束时会把槽交给排队者，排队者随后又停泊进来；
   * 一个在「还有排队者」时失败的用例因此会把槽漏给后面的用例，造成连锁误报并留下临时目录
   * （2026-11-25 审查）。
   */
  const withParking = async (
    opts: { failFirst?: number },
    body: (lib: ReturnType<typeof parkingLibreOffice>) => Promise<void>,
  ): Promise<void> => {
    const lib = parkingLibreOffice(opts);
    try { await body(lib); } finally { await drain(lib); }
  };

  /** 反复放行，直到连续约 200 毫秒没有新的转换进到 LibreOffice。只依赖真实时钟与 setImmediate，假计时器下同样成立。 */
  const drain = async (lib: ReturnType<typeof parkingLibreOffice>): Promise<void> => {
    const deadline = Date.now() + 5000;
    let quietSince = Date.now();
    while (Date.now() < deadline) {
      lib.releaseAll();
      const before = lib.total();
      for (let i = 0; i < 5; i += 1) await new Promise<void>((r) => setImmediate(r));
      const quiet = lib.running() === 0 && lib.total() === before;
      if (quiet && Date.now() - quietSince >= 200) return;
      if (!quiet) quietSince = Date.now();
    }
    lib.releaseAll();
  };

  it('收尾会排空还在排队的转换：清理之后两个槽都是空的', async () => {
    // 模拟「用例在还有排队者时失败」：起 5 个转换，只等前 2 个进到 LibreOffice 就中止，不做任何后续放行
    await withParking({}, async (lib) => {
      void Promise.all(['f0', 'f1', 'f2', 'f3', 'f4'].map((n) => convert(`${n}.doc`)));
      await lib.waitStarted(2);
      throw new Error('模拟断言失败');
    }).catch(() => undefined);
    // 排队中的 3 个已被排空：换一个新夹具，两个槽都能立即交出去
    const fresh = parkingLibreOffice();
    const probe = [convert('p.doc'), convert('q.doc')];
    await fresh.waitStarted(2);
    fresh.releaseAll();
    expect((await Promise.all(probe)).every((r) => r !== null)).toBe(true);
  });

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

  it('并发上限不按调用方覆盖：槽位池是进程级的，各设上限没有一致的含义', () => {
    // 这条断言在类型层面：给 limits 传 maxConcurrent 必须是编译错误。
    // 函数只定义、不调用——真调一次会占着槽挂住后面的用例
    const attempt = () => {
      // @ts-expect-error maxConcurrent 不在可覆盖项里
      convertOfficeToPdf(Buffer.from('x'), DOC_MIME, 'x.doc', { maxConcurrent: 1 });
    };
    void attempt;
  });
});
