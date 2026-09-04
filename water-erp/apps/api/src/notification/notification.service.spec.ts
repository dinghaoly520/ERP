import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';
import { PhoneChannel } from './channels/phone.channel';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationService', () => {
  let service: NotificationService;
  const prisma = {
    notification: {
      count: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    notificationDeliveryLog: { create: jest.fn().mockResolvedValue({}) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const emailChannel = { send: jest.fn().mockResolvedValue({ status: 'skipped' }) } as any;
  const smsChannel = { send: jest.fn().mockResolvedValue({ status: 'skipped' }) } as any;
  const phoneChannel = { send: jest.fn().mockResolvedValue({ status: 'skipped' }) } as any;

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: EmailChannel, useValue: emailChannel },
        { provide: SmsChannel, useValue: smsChannel },
        { provide: PhoneChannel, useValue: phoneChannel },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(NotificationService);
  });

  it('list tab=todo 只返回未 resolve 的通知（where 含 resolvedAt: null）', async () => {
    prisma.notification.count.mockResolvedValue(1);
    prisma.notification.findMany.mockResolvedValue([{ id: 'n1' }]);
    const res = await service.list('u1', 1, 20, 'todo');
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: 'u1', resolvedAt: null }),
    });
    expect(res.total).toBe(1);
  });

  it('list tab=all 不加 resolvedAt 过滤', async () => {
    prisma.notification.count.mockResolvedValue(5);
    prisma.notification.findMany.mockResolvedValue([]);
    await service.list('u1', 1, 20, 'all');
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
  });

  it('list 将消息类型过滤同时用于 count 与 findMany', async () => {
    prisma.notification.count.mockResolvedValue(2);
    prisma.notification.findMany.mockResolvedValue([]);

    await service.list('u1', 2, 15, 'todo', ['AWARD_LETTER', 'CONTRACT_NOTICE']);

    const where = {
      userId: 'u1',
      resolvedAt: null,
      type: { in: ['AWARD_LETTER', 'CONTRACT_NOTICE'] },
    };
    expect(prisma.notification.count).toHaveBeenCalledWith({ where });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 15, take: 15 }));
  });

  it('resolveActionable 按 type+link 写 resolvedAt', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    await service.resolveActionable('SUPPLIER_PENDING', '/supplier/s1');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { type: 'SUPPLIER_PENDING', link: '/supplier/s1', resolvedAt: null },
      data: { resolvedAt: expect.any(Date) },
    });
  });

  it('resolveActionableForUser 仅处理指定用户和业务关联链接的通知', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });

    await service.resolveActionableForUser(
      'user-1', 'AWARD_LETTER', '/award-letters?deliveryId=delivery-1',
    );

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        type: 'AWARD_LETTER',
        link: '/award-letters?deliveryId=delivery-1',
        resolvedAt: null,
      },
      data: { resolvedAt: expect.any(Date) },
    });
  });
});
