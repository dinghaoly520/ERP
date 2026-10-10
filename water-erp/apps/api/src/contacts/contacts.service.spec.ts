import { ContactsService } from './contacts.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ContactsService — 联系人公司隔离（2026-10-09）', () => {
  let service: ContactsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      company: { findUnique: jest.fn() },
      contact: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new ContactsService(prisma as unknown as PrismaService);
  });

  const staffOfC1 = { sub: 'u1' };

  it('findMany：有归属公司 → 只见本公司联系人', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: 'c1', company: '甲公司' });
    await service.findMany(staffOfC1);
    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1' } }),
    );
  });

  it('findMany：未归属公司（admin 管理视角）→ 全量可见', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: null, company: null });
    await service.findMany({ sub: 'admin1' });
    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });

  it('User.company 快照缺失时回退 Company 主数据名', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: 'c1', company: null });
    prisma.company.findUnique.mockResolvedValue({ name: '甲公司' });
    await service.findMany(staffOfC1);
    expect(prisma.company.findUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
      select: { name: true },
    });
    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1' } }),
    );
  });

  it('create：落公司写时快照（companyId + companyName）', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: 'c1', company: '甲公司' });
    await service.create({ name: '王五' } as any, staffOfC1);
    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '王五',
        companyId: 'c1',
        companyName: '甲公司',
      }),
    });
  });

  it('create：未归属公司 → 400 CONTACT_COMPANY_REQUIRED（零写入）', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.create({ name: '王五' } as any, staffOfC1),
    ).rejects.toMatchObject({ response: { code: 'CONTACT_COMPANY_REQUIRED' } });
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it('update：跨公司联系人 → 403 CONTACT_NOT_IN_COMPANY（零写入）', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: 'c1', company: '甲公司' });
    prisma.contact.findUnique.mockResolvedValue({ id: 'k1', companyId: 'c2' });
    await expect(
      service.update('k1', { name: 'x' } as any, staffOfC1),
    ).rejects.toMatchObject({ response: { code: 'CONTACT_NOT_IN_COMPANY' } });
    expect(prisma.contact.update).not.toHaveBeenCalled();
  });

  it('delete：本公司联系人 → 正常删除', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: 'c1', company: '甲公司' });
    prisma.contact.findUnique.mockResolvedValue({ id: 'k1', companyId: 'c1' });
    await service.delete('k1', staffOfC1);
    expect(prisma.contact.delete).toHaveBeenCalledWith({ where: { id: 'k1' } });
  });

  it('findByName：按本公司范围查找', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: 'c1', company: '甲公司' });
    await service.findByName('李女士', staffOfC1);
    expect(prisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: '李女士', companyId: 'c1' } }),
    );
  });
});
