import { Test, TestingModule } from '@nestjs/testing';
import { AssistantService } from './assistant.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeepSeekProvider } from './model/deepseek.provider';
import { ToolRegistry } from './tools/tool-registry';
import { GlobalOverviewTool } from './tools/global-overview.tool';
import { ProcurementTool } from './tools/procurement.tool';
import { BidTool } from './tools/bid.tool';
import { SupplierTool } from './tools/supplier.tool';
import { ExpertTool } from './tools/expert.tool';
import { AnnouncementTool } from './tools/announcement.tool';
import { NotificationTool } from './tools/notification.tool';
import { MallTool } from './tools/mall.tool';
import { ActionPlannerService } from './actions/action-planner.service';
import { ActionExecutorService } from './actions/action-executor.service';

describe('AssistantService', () => {
  let service: AssistantService;
  let prisma: any;
  let model: any;

  const mockConversation = {
    id: 'conv-1',
    title: '测试会话',
    userId: null as string | null,
    guestKey: null as string | null,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      assistantConversation: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      assistantMessage: {
        create: jest.fn(),
      },
      assistantActionLog: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      announcement: { count: jest.fn() },
      catalogItem: { count: jest.fn() },
      procurementProject: { count: jest.fn() },
      bidProject: { count: jest.fn() },
      supplier: { count: jest.fn() },
      expertProfile: { count: jest.fn() },
      notification: { count: jest.fn() },
    };

    model = {
      chat: jest.fn().mockResolvedValue({
        text: '这是助手的回复，基于系统知识和数据分析。',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantService,
        { provide: PrismaService, useValue: prisma },
        { provide: DeepSeekProvider, useValue: model },
        ToolRegistry,
        { provide: GlobalOverviewTool, useValue: { name: 'global_overview', description: 'mock', execute: jest.fn() } },
        { provide: ProcurementTool, useValue: { name: 'procurement', description: 'mock', execute: jest.fn() } },
        { provide: BidTool, useValue: { name: 'bid', description: 'mock', execute: jest.fn() } },
        { provide: SupplierTool, useValue: { name: 'supplier', description: 'mock', execute: jest.fn() } },
        { provide: ExpertTool, useValue: { name: 'expert', description: 'mock', execute: jest.fn() } },
        { provide: AnnouncementTool, useValue: { name: 'announcement', description: 'mock', execute: jest.fn() } },
        { provide: NotificationTool, useValue: { name: 'notification', description: 'mock', execute: jest.fn() } },
        { provide: MallTool, useValue: { name: 'mall', description: 'mock', execute: jest.fn() } },
        { provide: ActionPlannerService, useValue: { createPlan: jest.fn() } },
        { provide: ActionExecutorService, useValue: { execute: jest.fn() } },
      ],
    }).compile();

    service = module.get<AssistantService>(AssistantService);
  });

  describe('chat', () => {
    it('无 conversationId 时应创建新会话', async () => {
      prisma.assistantConversation.create.mockResolvedValue({
        ...mockConversation,
        messages: [],
      });
      prisma.assistantMessage.create.mockResolvedValue({ id: 'msg-1' });

      const result = await service.chat({ message: '你好' });

      expect(prisma.assistantConversation.create).toHaveBeenCalled();
      expect(result.conversationId).toBe('conv-1');
      expect(result.answer).toBeDefined();
    });

    it('有 conversationId 时应追加消息到已有会话（属主匹配）', async () => {
      prisma.assistantConversation.findUnique.mockResolvedValue({
        ...mockConversation,
        guestKey: 'guest-aaaaaaaa',
        messages: [{ id: 'm1', role: 'user', content: '之前的问题' }],
      });
      prisma.assistantMessage.create.mockResolvedValue({ id: 'msg-2' });

      const result = await service.chat(
        { conversationId: 'conv-1', message: '继续' },
        { guestKey: 'guest-aaaaaaaa' },
      );

      expect(prisma.assistantConversation.findUnique).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
      });
      expect(result.conversationId).toBe('conv-1');
    });

    it('P0 会话隔离：他人的会话（userId 不匹配）应按"会话不存在"拒绝且不落消息', async () => {
      prisma.assistantConversation.findUnique.mockResolvedValue({
        ...mockConversation,
        userId: 'user-other',
        messages: [{ id: 'm1', role: 'user', content: '别人的对话' }],
      });

      const result = await service.chat(
        { conversationId: 'conv-1', message: '偷看' },
        { userId: 'user-1', role: 'staff' },
      );

      expect(result.conversationId).toBe('');
      expect(result.answer).toContain('会话不存在');
      expect(prisma.assistantMessage.create).not.toHaveBeenCalled();
    });

    it('P0 会话隔离：无任何属主（未认证且无访客键）时他人/存量无主会话不可见', async () => {
      prisma.assistantConversation.findUnique.mockResolvedValue({
        ...mockConversation,
        messages: [],
      });

      const result = await service.chat({ conversationId: 'conv-1', message: '你好' });

      expect(result.conversationId).toBe('');
      expect(result.answer).toContain('会话不存在');
    });

    it('模型调用失败时应返回错误但不抛异常', async () => {
      prisma.assistantConversation.create.mockResolvedValue({
        ...mockConversation,
        messages: [],
      });
      prisma.assistantMessage.create.mockResolvedValue({ id: 'msg-1' });
      model.chat.mockRejectedValueOnce(new Error('网络错误'));

      const result = await service.chat({ message: '测试' });

      expect(result.answer).toContain('服务暂时不可用');
      expect(result.conversationId).toBe('conv-1');
    });

    it('应创建新会话并返回回答', async () => {
      prisma.assistantConversation.create.mockResolvedValue({
        ...mockConversation,
        messages: [],
      });
      prisma.assistantMessage.create.mockResolvedValue({ id: 'msg-1' });
      model.chat.mockResolvedValueOnce({
        text: '根据当前系统数据，采购项目共有5个。',
      });

      const result = await service.chat({ message: '系统有多少个采购项目' });

      expect(result.conversationId).toBe('conv-1');
      expect(result.answer).toBeDefined();
      expect(model.chat).toHaveBeenCalledTimes(1);
    });
  });

  describe('listConversations', () => {
    it('应返回属主名下最近 20 条会话，含首条用户消息摘要', async () => {
      prisma.assistantConversation.findMany.mockResolvedValue([
        { id: 'c1', title: '对话1', createdAt: new Date(), updatedAt: new Date(), messages: [{ content: '你好，系统有多少采购项目' }] },
      ]);

      const result = await service.listConversations({ userId: 'user-1' });

      expect(prisma.assistantConversation.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { updatedAt: 'desc' },
        include: {
          messages: { where: { role: 'user' }, orderBy: { createdAt: 'asc' }, take: 1, select: { content: true } },
        },
        take: 20,
      });
      expect(result).toHaveLength(1);
      expect(result[0].firstMessage).toBe('你好，系统有多少采购项目');
    });

    it('匿名访客按 guestKey 过滤会话列表', async () => {
      prisma.assistantConversation.findMany.mockResolvedValue([]);

      await service.listConversations({ guestKey: 'guest-aaaaaaaa' });

      expect(prisma.assistantConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { guestKey: 'guest-aaaaaaaa' } }),
      );
    });

    it('P0 会话隔离：无属主（未认证且无访客键）返回空列表，不触库', async () => {
      const result = await service.listConversations(null);

      expect(result).toEqual([]);
      expect(prisma.assistantConversation.findMany).not.toHaveBeenCalled();
    });

    it('会话无 messages 关联时不报错（firstMessage 为空）', async () => {
      prisma.assistantConversation.findMany.mockResolvedValue([
        { id: 'c2', title: '空对话', createdAt: new Date(), updatedAt: new Date() },
      ]);

      const result = await service.listConversations({ userId: 'user-1' });

      expect(result).toHaveLength(1);
      expect(result[0].firstMessage).toBe('');
    });
  });

  describe('getConversation', () => {
    it('应返回属主本人含消息的会话详情', async () => {
      prisma.assistantConversation.findUnique.mockResolvedValue({
        ...mockConversation,
        userId: 'user-1',
        messages: [
          { id: 'm1', role: 'user', content: '你好' },
          { id: 'm2', role: 'assistant', content: '你好，董事长' },
        ],
      });

      const result = await service.getConversation('conv-1', { userId: 'user-1' });

      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(2);
      expect(result!.id).toBe('conv-1');
    });

    it('P0 会话隔离：他人会话与不存在同口径返回 null', async () => {
      prisma.assistantConversation.findUnique.mockResolvedValue({
        ...mockConversation,
        userId: 'user-other',
        messages: [],
      });

      expect(await service.getConversation('conv-1', { userId: 'user-1' })).toBeNull();
    });
  });

  describe('P0 工具门禁（匿名仅公开域工具）', () => {
    const DIRECT_MSG = '请调用 supplier 工具，参数 {"action":"detail","id":"s-1"}';

    const setupConv = (owner: { userId?: string; guestKey?: string }) => {
      prisma.assistantConversation.create.mockResolvedValue({
        ...mockConversation,
        ...owner,
        messages: [],
      });
      prisma.assistantMessage.create.mockResolvedValue({ id: 'msg-1' });
      return owner;
    };

    it('匿名访客直呼 supplier 工具应被拒绝且工具不执行', async () => {
      const owner = setupConv({ guestKey: 'guest-aaaaaaaa' });

      const result = await service.chat({ message: DIRECT_MSG }, owner);

      expect(result.answer).toContain('登录');
      expect(prisma.assistantConversation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ guestKey: 'guest-aaaaaaaa' }) }),
      );
    });

    it('认证用户直呼 supplier 工具正常执行', async () => {
      const owner = setupConv({ userId: 'user-1' });
      const supplierTool = (service as any)['supplierTool'];
      supplierTool.execute.mockResolvedValue({ success: true, cards: [{ type: 'metric', title: '供应商', value: 1 }] });

      const result = await service.chat({ message: DIRECT_MSG }, { ...owner, role: 'staff' });

      expect(supplierTool.execute).toHaveBeenCalled();
      expect(result.conversationId).toBe('conv-1');
    });

    it('匿名访客可用公开域工具（announcement）', async () => {
      const owner = setupConv({ guestKey: 'guest-aaaaaaaa' });
      const announcementTool = (service as any)['announcementTool'];
      announcementTool.execute.mockResolvedValue({ success: true, cards: [{ type: 'metric', title: '公告', value: 2 }] });

      const result = await service.chat(
        { message: '请调用 announcement 工具，参数 {"action":"search"}' },
        owner,
      );

      expect(announcementTool.execute).toHaveBeenCalled();
      expect(result.conversationId).toBe('conv-1');
    });

    it('认证≠授权：外部角色（supplier）登录后同样仅公开域工具（三审锁定）', async () => {
      const owner = setupConv({ userId: 'user-supplier' });
      const supplierTool = (service as any)['supplierTool'];
      supplierTool.execute.mockClear();

      const result = await service.chat(
        { message: DIRECT_MSG },
        { ...owner, role: 'supplier' },
      );

      expect(result.answer).toContain('登录');
      expect(supplierTool.execute).not.toHaveBeenCalled();
    });
  });

  describe('deleteConversation', () => {
    it('属主删除成功', async () => {
      prisma.assistantConversation.findUnique.mockResolvedValue({ ...mockConversation, userId: 'user-1' });
      prisma.assistantConversation.delete.mockResolvedValue({});

      const result = await service.deleteConversation('conv-1', { userId: 'user-1' });

      expect(result.status).toBe('success');
      expect(prisma.assistantConversation.delete).toHaveBeenCalledWith({ where: { id: 'conv-1' } });
    });

    it('P0 会话隔离：非属主删除被拒且不触 delete', async () => {
      prisma.assistantConversation.findUnique.mockResolvedValue({ ...mockConversation, userId: 'user-other' });

      const result = await service.deleteConversation('conv-1', { userId: 'user-1' });

      expect(result.status).toBe('failed');
      expect(prisma.assistantConversation.delete).not.toHaveBeenCalled();
    });
  });

  describe('getQuickStats 分层', () => {
    it('匿名访客只返回公开域数字（内部维度置 0）', async () => {
      prisma.announcement.count.mockResolvedValue(12);
      prisma.catalogItem.count.mockResolvedValue(34);

      const result = await service.getQuickStats(false);

      expect(result.announcement.published).toBe(12);
      expect(result.catalog.items).toBe(34);
      expect(result.supplier.risk).toBe(0);
      expect(result.focusAreas).toEqual([]);
      expect(prisma.supplier.count).not.toHaveBeenCalled();
    });

    it('认证用户返回全量统计', async () => {
      prisma.announcement.count.mockResolvedValue(12);
      prisma.catalogItem.count.mockResolvedValue(34);
      prisma.procurementProject.count.mockResolvedValue(5);
      prisma.bidProject.count.mockResolvedValue(3);
      prisma.supplier.count.mockResolvedValue(10);
      prisma.expertProfile.count.mockResolvedValue(7);
      prisma.notification.count.mockResolvedValue(2);

      const result = await service.getQuickStats(true);

      expect(result.procurement.total).toBe(5);
      expect(result.notification.unread).toBe(2);
    });
  });

  describe('confirmAction', () => {
    it('pending 状态的日志确认后应执行成功', async () => {
      prisma.assistantActionLog.findUnique.mockResolvedValue({
        id: 'act-1',
        status: 'pending',
        targetType: 'supplier',
        targetId: 'sup-1',
        actionType: 'update_status',
        payloadJson: { newStatus: 'RETURNED' },
      });
      prisma.assistantActionLog.update.mockResolvedValue({});
      (service as any)['actionExecutor'].execute = jest.fn().mockResolvedValue({
        status: 'success',
        message: '操作成功',
      });

      const result = await service.confirmAction('act-1', { sub: 'admin-1', role: 'admin' });

      expect(result.status).toBe('success');
    });

    it('非 pending 状态的日志确认应返回错误', async () => {
      prisma.assistantActionLog.findUnique.mockResolvedValue({
        id: 'act-1',
        status: 'success',
      });

      const result = await service.confirmAction('act-1', { sub: 'admin-1', role: 'admin' });

      expect(result.status).toBe('failed');
      expect(result.message).toContain('已处理');
    });

    it('P1 鉴权：匿名与非属主确认被拒（confirm 会执行真实写操作）', async () => {
      const { UnauthorizedException, ForbiddenException } = await import('@nestjs/common');
      await expect(service.confirmAction('act-1')).rejects.toThrow(UnauthorizedException);
      await expect(service.confirmAction('act-1', { sub: 'user-other', role: 'staff' })).rejects.toThrow(ForbiddenException);
    });

    it('不存在的日志确认应返回错误', async () => {
      prisma.assistantActionLog.findUnique.mockResolvedValue(null);

      const result = await service.confirmAction('nonexistent', { sub: 'admin-1', role: 'admin' });

      expect(result.status).toBe('failed');
      expect(result.message).toContain('不存在');
    });
  });

  describe('cancelAction', () => {
    it('pending 状态的日志取消后状态应为 cancelled', async () => {
      prisma.assistantActionLog.findUnique.mockResolvedValue({
        id: 'act-1',
        status: 'pending',
      });
      prisma.assistantActionLog.update.mockResolvedValue({});

      const result = await service.cancelAction('act-1', { sub: 'admin-1', role: 'admin' });

      expect(result.status).toBe('success');
      expect(prisma.assistantActionLog.update).toHaveBeenCalledWith({
        where: { id: 'act-1' },
        data: { status: 'cancelled' },
      });
    });
  });
});
