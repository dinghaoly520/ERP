import { Test } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { OpeningHallService, HOST_ROLES_SET } from './opening-hall.service';
import { PrismaService } from '../prisma/prisma.service';
import { BidGateway } from '../bid/bid.gateway';
import { NotificationService } from '../notification/notification.service';

const prismaMock = {
  bidProject: { findUnique: jest.fn() },
  bidOpeningSession: { findUnique: jest.fn(), update: jest.fn() },
  bidSupplier: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  openingHallMessage: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  openingHallReadCursor: { upsert: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  bidSupervisionLog: { create: jest.fn() },
  supplier: { findFirst: jest.fn() },
} as any;
const gatewayMock = {
  notifyHallMessage: jest.fn(), notifyHallCheckin: jest.fn(),
  notifyExchangeControl: jest.fn(), broadcastHallPresence: jest.fn(),
  getOnlineSupplierIds: jest.fn().mockReturnValue(new Set()),
} as any;
const notificationMock = { create: jest.fn() } as any;

const host = { userId: 'u-host', role: 'bid_host', supplierId: undefined, supplierName: undefined };
const sup = { userId: 'u-sup', role: 'supplier', supplierId: 'sup-1', supplierName: '测试供应商' };

function setup() {
  prismaMock.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING' });
  prismaMock.bidOpeningSession.findUnique.mockResolvedValue({ projectId: 'p1', exchangeControl: 'OPEN' });
  prismaMock.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierId: 'sup-1', supplierName: '测试供应商', checkInAt: null });
  prismaMock.openingHallMessage.create.mockImplementation(async ({ data }: any) => ({ ...data, id: 'm1', createdAt: new Date('2026-07-23T00:00:00Z') }));
}

describe('OpeningHallService', () => {
  let svc: OpeningHallService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        OpeningHallService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: BidGateway, useValue: gatewayMock },
        { provide: NotificationService, useValue: notificationMock },
      ],
    }).compile();
    svc = mod.get(OpeningHallService);
    setup();
  });

  it('OPENING 阶段公聊发送成功并广播', async () => {
    const msg = await svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: '请各家准备解密' });
    expect(msg.content).toBe('请各家准备解密');
    expect(gatewayMock.notifyHallMessage).toHaveBeenCalledWith('p1', expect.objectContaining({ roomType: 'PUBLIC' }));
  });

  it('非 OPENING 阶段发消息 → 403 HALL_CLOSED', async () => {
    prismaMock.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'EVALUATING' });
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('MUTED 时供应商发言 → 403；主持人仍可发', async () => {
    prismaMock.bidOpeningSession.findUnique.mockResolvedValue({ projectId: 'p1', exchangeControl: 'MUTED' });
    await expect(svc.sendMessage(sup, 'p1', { roomType: 'PUBLIC', content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: 'x' })).resolves.toBeDefined();
  });

  it('CLOSED 时全员禁言', async () => {
    prismaMock.bidOpeningSession.findUnique.mockResolvedValue({ projectId: 'p1', exchangeControl: 'CLOSED' });
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('供应商私聊只能发自己的会话', async () => {
    await expect(svc.sendMessage(sup, 'p1', { roomType: 'PRIVATE', supplierId: 'sup-2', content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('私聊 supplierId 必须参投本项目', async () => {
    prismaMock.bidSupplier.findFirst.mockResolvedValue(null);
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PRIVATE', supplierId: 'sup-9', content: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('内容写时消毒（HTML 标签剥离）', async () => {
    const msg = await svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: '<script>alert(1)</script>你好' });
    expect(msg.content).not.toContain('<script>');
    expect(msg.content).toContain('你好');
  });

  it('签到幂等：已签到直接返回原时间', async () => {
    const t = new Date('2026-07-23T01:00:00Z');
    prismaMock.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierId: 'sup-1', supplierName: '测试供应商', checkInAt: t });
    const res = await svc.checkIn(sup, 'p1', { ip: '1.2.3.4', ua: 'test' });
    expect(res.checkInAt.toISOString()).toBe(t.toISOString());
    expect(prismaMock.bidSupplier.update).not.toHaveBeenCalled();
  });

  it('签到成功写监督日志并广播', async () => {
    const res = await svc.checkIn(sup, 'p1', { ip: '1.2.3.4', ua: 'test' });
    expect(res.checkInAt).toBeInstanceOf(Date);
    expect(prismaMock.bidSupervisionLog.create).toHaveBeenCalled();
    expect(gatewayMock.notifyHallCheckin).toHaveBeenCalled();
  });

  it('交流控制切换写库+监督日志+广播', async () => {
    await svc.setExchangeControl('p1', 'MUTED', '陈源远');
    expect(prismaMock.bidOpeningSession.update).toHaveBeenCalledWith({ where: { projectId: 'p1' }, data: { exchangeControl: 'MUTED' } });
    expect(gatewayMock.notifyExchangeControl).toHaveBeenCalled();
  });
});
