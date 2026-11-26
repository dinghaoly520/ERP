import { BadRequestException } from '@nestjs/common';
import { DraftService } from './draft.service';

/** 前端各草稿面的真实键样本（apps/web 全量清点）——白名单漏登记=跨设备同步静默 400 */
const REAL_FRONTEND_KEYS = [
  'supplier-selection',
  'supplier-selection:cmwx036cx001akop366verz2y',
  'expert-extract-session:cmwsso9310971o101x52vk68i',
  'supplier-confirm-threshold',
  'direct-talk-report:cmwx036cx001akop366verz2y:2',
  'announce-wizard:cmwx036cx001akop366verz2y:BID_NOTICE',
  'tender-write-global:v1',
];

describe('DraftService 键白名单', () => {
  let service: DraftService;
  let prisma: { userDraft: { upsert: jest.Mock; findUnique: jest.Mock; deleteMany: jest.Mock } };

  beforeEach(() => {
    prisma = { userDraft: { upsert: jest.fn(), findUnique: jest.fn(), deleteMany: jest.fn() } };
    service = new DraftService(prisma as any);
  });

  it.each(REAL_FRONTEND_KEYS)('放行前端真实键 %s', async (key) => {
    prisma.userDraft.upsert.mockReturnValue({ updatedAt: new Date() });
    await expect(service.put('u1', key, { a: 1 })).resolves.toHaveProperty('savedAt');
    expect(prisma.userDraft.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_key: { userId: 'u1', key } } }),
    );
  });

  it('拒绝白名单外键（防滥用为任意 KV）', async () => {
    await expect(service.put('u1', 'arbitrary-kv:xxx', { a: 1 })).rejects.toThrow(BadRequestException);
    await expect(service.get('u1', 'expert-extract2:xxx')).rejects.toThrow(BadRequestException);
  });

  it('拒绝前缀相似但不带冒号边界的键（expert-extract-≠expert-extract:）', async () => {
    await expect(service.get('u1', 'expert-extract-session2:xxx')).rejects.toThrow(BadRequestException);
  });
});
