import * as fs from 'node:fs';
import * as path from 'node:path';
import { DocumentParserService } from './document-parser.service';

/**
 * .doc 老格式的文本提取靠 LibreOffice（2026-11-25 审查）：此前这次调用不设超时——
 * LibreOffice 一旦卡死，这次解析（以及它所在的请求或 worker 任务）就永久挂住。
 */
const execFileMock = jest.fn();
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;

const ocrService = { isAvailable: async () => false } as never;

describe('DocumentParserService — .doc 经 LibreOffice 提取文本', () => {
  let parser: DocumentParserService;
  const tmpDirs: string[] = [];

  beforeEach(() => {
    execFileMock.mockReset();
    tmpDirs.length = 0;
    parser = new DocumentParserService(ocrService);
  });
  afterEach(async () => {
    for (const dir of tmpDirs) await fs.promises.rm(dir, { recursive: true, force: true });
  });

  /** 假 LibreOffice：从参数里取输出目录，按给定的错误回调。兼容「带选项」与「不带选项」两种调用形态 */
  function fakeLibreOffice(err: Error | null = null) {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const [cmd, argv, third, fourth] = args as [string, string[], unknown, unknown];
      const cb = (typeof third === 'function' ? third : fourth) as ExecCallback;
      const outdir = String(argv[argv.indexOf('--outdir') + 1]);
      tmpDirs.push(outdir);
      if (!err) fs.writeFileSync(path.join(outdir, 'input.txt'), '转换出的正文');
      cb(err, '', '');
      return cmd;
    });
  }

  /** 第三个参数是回调说明调用方没传选项 */
  const optionsOf = (call: unknown[]) => (call.length >= 4 ? (call[2] as Record<string, unknown>) : {});

  it('.doc 转成文本后读回', async () => {
    fakeLibreOffice();
    await expect(parser.parse(Buffer.from('doc-bytes'), 'application/msword', '旧件.doc')).resolves.toBe('转换出的正文');
    expect(execFileMock.mock.calls[0][0]).toBe('libreoffice');
  });

  it('LibreOffice 调用带超时——卡死的转换到点被杀，不会把这次解析永久挂住（时限与共享的 Word→PDF 转换一致：60 秒）', async () => {
    fakeLibreOffice();
    await parser.parse(Buffer.from('doc-bytes'), 'application/msword', '旧件.doc');
    expect(optionsOf(execFileMock.mock.calls[0]).timeout).toBe(60_000);
  });

  it('LibreOffice 失败或被杀 → 这次解析报错，不拿空文本冒充成功', async () => {
    fakeLibreOffice(Object.assign(new Error('Command was killed'), { killed: true, signal: 'SIGTERM' }));
    await expect(parser.parse(Buffer.from('doc-bytes'), 'application/msword', '旧件.doc')).rejects.toThrow('killed');
  });

  it('转换之后临时目录已清理', async () => {
    fakeLibreOffice();
    await parser.parse(Buffer.from('doc-bytes'), 'application/msword', '旧件.doc');
    expect(tmpDirs).toHaveLength(1);
    expect(fs.existsSync(tmpDirs[0])).toBe(false);
  });
});
