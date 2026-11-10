import { DocumentParserService } from './document-parser.service';
import { OcrService, OCR_UNLIMITED_PAGES } from '../../local-ai/ocr.service';

/** 解析异步化（2026-11-06）：DocumentParser 把 onProgress 原样转发给 OCR 服务——
 *  知识库后台解析按此回写 processedPages/totalPages。 */
jest.mock('pdf-parse', () => jest.fn(async () => ({ text: '', numpages: 100 })));

describe('DocumentParserService onProgress 转发', () => {
  const mkParser = () => {
    const ocr = {
      isAvailable: jest.fn().mockResolvedValue(true),
      ocrPdf: jest.fn().mockResolvedValue({
        text: 'OCR 正文'.repeat(60),
        processedPages: 100,
        pageCount: 100,
        pages: [],
      }),
      ocrImage: jest.fn(),
    };
    return { parser: new DocumentParserService(ocr as unknown as OcrService), ocr };
  };
  const buf = Buffer.from('fake-pdf');

  it('parse 稀疏 PDF 回退 OCR：onProgress 作第三参转发（maxPages 保持默认，勿传 0——服务端 0=仅探测）', async () => {
    const { parser, ocr } = mkParser();
    const cb = jest.fn();
    const text = await parser.parse(buf, 'application/pdf', 'scan.pdf', cb);
    expect(text).toContain('OCR 正文');
    expect(ocr.ocrPdf).toHaveBeenCalledWith(expect.any(Buffer), OCR_UNLIMITED_PAGES, cb);
  });

  it('parseWithOcr 同样转发 onProgress', async () => {
    const { parser, ocr } = mkParser();
    const cb = jest.fn();
    await parser.parseWithOcr(buf, 'application/pdf', 'scan.pdf', cb);
    expect(ocr.ocrPdf).toHaveBeenCalledWith(expect.any(Buffer), OCR_UNLIMITED_PAGES, cb);
  });
});

describe('DocumentParserService onProgress 快速路径回填（2026-11-06 显示缺口修复）', () => {
  const pdfParseMock = require('pdf-parse') as jest.Mock;
  const mkParser = (ocrAvailable = false) => {
    const ocr = {
      isAvailable: jest.fn().mockResolvedValue(ocrAvailable),
      ocrPdf: jest.fn(),
      ocrImage: jest.fn().mockResolvedValue({ text: '图文字' }),
    };
    return { parser: new DocumentParserService(ocr as unknown as OcrService), ocr };
  };

  it('文字型 PDF（pdf-parse 原生路径）：onProgress 回填 (numpages, numpages)', async () => {
    pdfParseMock.mockResolvedValueOnce({ text: 'A'.repeat(500), numpages: 5 });
    const { parser } = mkParser();
    const cb = jest.fn();
    const text = await parser.parse(Buffer.from('pdf'), 'application/pdf', 't.pdf', cb);
    expect(text).toBe('A'.repeat(500));
    expect(cb).toHaveBeenCalledWith(5, 5);
  });

  it('稀疏 PDF 但 OCR 不可用（pdf-parse 兜底）：同样回填页数', async () => {
    pdfParseMock.mockResolvedValueOnce({ text: '稀', numpages: 8 });
    const { parser } = mkParser(false);
    const cb = jest.fn();
    await parser.parse(Buffer.from('pdf'), 'application/pdf', 's.pdf', cb);
    expect(cb).toHaveBeenCalledWith(8, 8);
  });

  it('txt/docx/image 等单件类型：onProgress 回填 (1, 1)', async () => {
    const { parser } = mkParser();
    const cb = jest.fn();
    await parser.parse(Buffer.from('hello'), 'text/plain', 'a.txt', cb);
    expect(cb).toHaveBeenCalledWith(1, 1);
  });
});

/** strictOcr 严格模式（2026-11-10 生产实录：476 页扫描件 OCR 批 fetch failed 被 parsePdf 吞掉，
 *  返回 pdf-parse 残稀文本 → processor 误标 READY(1 chunk, indexed=true) → 前端永不见失败提示）。
 *  严格模式三失败（服务不可用/抛错/空结果）必须抛错穿透，由 KnowledgeParseProcessor 落 FAILED。 */
describe('DocumentParserService strictOcr 严格模式（2026-11-10）', () => {
  const pdfParseMock = require('pdf-parse') as jest.Mock;
  const buf = Buffer.from('scanned-pdf');

  const mkParser = (ocr: {
    available?: boolean;
    ocrPdf?: jest.Mock;
  }) => {
    const ocrAny: any = {
      isAvailable: jest.fn().mockResolvedValue(ocr.available ?? true),
      ocrPdf: ocr.ocrPdf ?? jest.fn(),
      ocrImage: jest.fn().mockResolvedValue({ text: '图文字' }),
    };
    return { parser: new DocumentParserService(ocrAny as unknown as OcrService), ocr: ocrAny };
  };

  beforeEach(() => {
    pdfParseMock.mockReset();
    pdfParseMock.mockResolvedValue({ text: '稀', numpages: 476 }); // 476 页仅 1 字 = 稀疏扫描件
  });

  it('稀疏 PDF + OCR 抛错 + strictOcr → 抛错穿透（消息含「OCR 解析失败」与原始错误）', async () => {
    const { parser } = mkParser({
      ocrPdf: jest.fn().mockRejectedValue(new TypeError('fetch failed')),
    });
    await expect(
      parser.parse(buf, 'application/pdf', 'scan.pdf', undefined, { strictOcr: true }),
    ).rejects.toThrow(/OCR 解析失败.*fetch failed/);
  });

  it('稀疏 PDF + OCR 抛错 + 默认（不传 options）→ 仍宽容降级返回 pdf-parse 残文本（存量行为锁定，project-management 等依赖）', async () => {
    const { parser, ocr } = mkParser({
      ocrPdf: jest.fn().mockRejectedValue(new TypeError('fetch failed')),
    });
    await expect(
      parser.parse(buf, 'application/pdf', 'scan.pdf'),
    ).resolves.toBe('稀');
    expect(ocr.ocrPdf).toHaveBeenCalledTimes(1);
  });

  it('稀疏 PDF + OCR 空结果 + strictOcr → 抛错（不得以空内容冒充解析成功）', async () => {
    const { parser } = mkParser({
      ocrPdf: jest.fn().mockResolvedValue({ text: '  ', processedPages: 476, pageCount: 476, pages: [] }),
    });
    await expect(
      parser.parse(buf, 'application/pdf', 'scan.pdf', undefined, { strictOcr: true }),
    ).rejects.toThrow(/未从该文档提取到文本/);
  });

  it('稀疏 PDF + OCR 服务不可用 + strictOcr → 抛错（扫描件唯一可读来源缺失）', async () => {
    const { parser } = mkParser({ available: false });
    await expect(
      parser.parse(buf, 'application/pdf', 'scan.pdf', undefined, { strictOcr: true }),
    ).rejects.toThrow(/OCR 服务不可用/);
  });

  it('原生密文本 PDF + strictOcr → 不走 OCR 不受影响，正常返回', async () => {
    pdfParseMock.mockResolvedValueOnce({ text: 'A'.repeat(500), numpages: 5 }); // 100 字/页 ≥ 50
    const { parser, ocr } = mkParser({ available: false });
    await expect(
      parser.parse(buf, 'application/pdf', 'native.pdf', undefined, { strictOcr: true }),
    ).resolves.toBe('A'.repeat(500));
    expect(ocr.ocrPdf).not.toHaveBeenCalled();
  });
});
