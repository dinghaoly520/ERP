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
