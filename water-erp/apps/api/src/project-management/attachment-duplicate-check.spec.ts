import { createHash } from 'node:crypto';
import { ProjectManagementService } from './project-management.service';

/** 同文件查重（2026-11-26 用户需求）：内容 sha256 全项目比对——
 *  已有指纹行直比、无指纹行懒回填（流式读文件算指纹落列）、文件缺失跳过不误报、
 *  按入参指纹顺序返回。 */
jest.mock('node:fs', () => {
  // 部分 mock：仅替换 createReadStream——全量替换会炸依赖图里 fs.existsSync 等用法
  const actual = jest.requireActual('node:fs');
  return { ...actual, createReadStream: jest.fn() };
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createReadStream } = require('node:fs') as { createReadStream: jest.Mock };

/** 假文件流：单 chunk 异步可迭代（服务端 for-await 流式哈希消费） */
const fakeStream = (content: string) => (async function* () { yield Buffer.from(content); })();

const H = (content: string) => createHash('sha256').update(content).digest('hex');

const mk = (attachments: unknown[]) => {
  const prisma = {
    attachment: {
      findMany: jest.fn().mockResolvedValue(attachments),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const service = new ProjectManagementService(
    prisma as never,
    {} as never, // gbCode
    {} as never, // aiService
    {} as never, // llm
    {} as never, // documentParser
    {} as never, // storage
    {} as never, // archiveScope
    {} as never, // archiveFlow
    {} as never, // stageCompliance
    {} as never, // notificationService
    {} as never, // scoreStandardValidator
    {} as never, // companyScope
  );
  return { service: service as unknown as { checkDuplicateAttachments: (id: string, s: string[]) => Promise<Array<{ sha256: string; duplicates: unknown[] }>>; ensureAttachmentLocal: (k: string) => Promise<string | null> }, prisma };
};

describe('ProjectManagementService.checkDuplicateAttachments', () => {
  it('已有指纹行直比命中：返回步骤名/轮次，且不触发懒回填', async () => {
    const hash = H('same-bytes');
    const { service, prisma } = mk([
      { id: 'a1', fileName: '评审报告.pdf', objectKey: 'k1', sha256: hash, createdAt: new Date('2026-11-01'),
        projectManagementStage: { stageKey: 'BID_EVALUATION', stageName: '开标评标', round: 1 } },
      { id: 'a2', fileName: '别的.pdf', objectKey: 'k2', sha256: H('other'), createdAt: new Date('2026-11-02'),
        projectManagementStage: { stageKey: 'CONTRACT', stageName: '合同', round: 1 } },
    ]);
    const res = await service.checkDuplicateAttachments('p1', [hash]);
    expect(res).toHaveLength(1);
    expect(res[0].duplicates).toHaveLength(1);
    expect(res[0].duplicates[0]).toMatchObject({ id: 'a1', stageName: '开标评标', round: 1 });
    expect(prisma.attachment.update).not.toHaveBeenCalled();
  });

  it('无指纹行懒回填：物化文件流式计算指纹→命中→指纹落列（下次免算）', async () => {
    const hash = H('legacy-content');
    const { service, prisma } = mk([
      { id: 'old1', fileName: '立项申请表.docx', objectKey: 'legacy-key', sha256: null, createdAt: new Date(),
        projectManagementStage: { stageKey: 'INITIATION', stageName: '采购立项', round: 2 } },
    ]);
    service.ensureAttachmentLocal = jest.fn().mockResolvedValue('/uploads/legacy-key');
    createReadStream.mockReturnValue(fakeStream('legacy-content'));
    const res = await service.checkDuplicateAttachments('p1', [hash]);
    expect(res[0].duplicates).toHaveLength(1);
    expect(res[0].duplicates[0]).toMatchObject({ id: 'old1', stageName: '采购立项', round: 2 });
    expect(prisma.attachment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'old1' }, data: { sha256: hash } }),
    );
  });

  it('文件缺失（本地与 MinIO 均未物化）→ 跳过不误报', async () => {
    const { service } = mk([
      { id: 'gone', fileName: 'x.pdf', objectKey: 'missing', sha256: null, createdAt: new Date(), projectManagementStage: null },
    ]);
    service.ensureAttachmentLocal = jest.fn().mockResolvedValue(null);
    const res = await service.checkDuplicateAttachments('p1', [H('x')]);
    expect(res[0].duplicates).toHaveLength(0);
  });

  it('多指纹按入参顺序返回（未命中为空数组）', async () => {
    const h1 = H('one');
    const { service } = mk([
      { id: 'a', fileName: 'a.pdf', objectKey: 'ka', sha256: h1, createdAt: new Date(), projectManagementStage: null },
    ]);
    const res = await service.checkDuplicateAttachments('p1', [H('miss'), h1]);
    expect(res).toHaveLength(2);
    expect(res[0].duplicates).toHaveLength(0);
    expect(res[1].duplicates).toHaveLength(1);
  });
});
