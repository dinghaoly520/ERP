import { KnowledgeController } from './knowledge.controller';

/** §五.4-2（2026-11-18）：上传文件名过 multipart 铁律 util（条件式安全版）——
 *  旧实现无条件 latin1→utf8，对 filename* 扩展参数来的正确 UTF-8 名会二次毁伤。 */
describe('KnowledgeController 上传文件名归一化（multipart 铁律）', () => {
  const service: any = { uploadFile: jest.fn().mockResolvedValue({ id: 'f1' }) };
  const ctrl = new KnowledgeController(service);
  const file = (originalname: string): Express.Multer.File =>
    ({ buffer: Buffer.from('x'), originalname }) as Express.Multer.File;

  beforeEach(() => jest.clearAllMocks());

  it('mojibake 名（latin1 误读形态）→ 还原 UTF-8', async () => {
    const mojibake = Buffer.from('技术规范.pdf', 'utf8').toString('latin1'); // busboy 普通参数恒定形态
    await ctrl.uploadFile('kb-1', file(mojibake), { id: 'u1' } as any);
    expect(service.uploadFile.mock.calls[0][1].originalname).toBe('技术规范.pdf');
  });

  it('正确 UTF-8 名（filename* 扩展参数来源）→ 原样透传不被二次毁伤', async () => {
    await ctrl.uploadFile('kb-1', file('技术要求.docx'), { id: 'u1' } as any);
    expect(service.uploadFile.mock.calls[0][1].originalname).toBe('技术要求.docx');
  });

  it('纯 ASCII 名 → 原样透传', async () => {
    await ctrl.uploadFile('kb-1', file('rules-v3.pdf'), { id: 'u1' } as any);
    expect(service.uploadFile.mock.calls[0][1].originalname).toBe('rules-v3.pdf');
  });
});
