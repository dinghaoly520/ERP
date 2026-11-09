import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CaEvidenceService } from './ca-evidence.service';

/** 2026-11-09 生产实录：CaEvidenceService 缺 @Injectable() → 无 design:paramtypes →
 *  prisma 注入 undefined → record() 读 undefined.caVerificationRecord 崩，
 *  绑定成功但证据记录失败（controller 捕获降级只留 console.error）。 */
describe('CaEvidenceService DI 装配（@Injectable 缺失回归锁）', () => {
  it('经 Nest 容器解析后 prisma 可用，record() 正常落库', async () => {
    const created: unknown[] = [];
    const prismaMock = {
      caVerificationRecord: {
        create: jest.fn(async (args: { data: unknown }) => {
          created.push(args.data);
          return { id: 'rec-1' };
        }),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CaEvidenceService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    const svc = moduleRef.get(CaEvidenceService);

    const id = await svc.record({
      requestId: 'req-t1',
      purpose: 'bind',
      p7B64: 'cDc=',
      toSign: 'toSign',
      outcome: { ok: true, statusCoverage: 'full' } as never,
    });

    expect(id).toBe('rec-1');
    expect(prismaMock.caVerificationRecord.create).toHaveBeenCalledTimes(1);
    expect((created[0] as { requestId: string }).requestId).toBe('req-t1');
  });
});
