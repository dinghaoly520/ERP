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
