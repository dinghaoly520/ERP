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
      },
      assistantMessage: {
        create: jest.fn(),
      },
      assistantActionLog: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
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

    it('有 conversationId 时应追加消息到已有会话', async () => {
      prisma.assistantConversation.findUnique.mockResolvedValue({
        ...mockConversation,
        messages: [{ id: 'm1', role: 'user', content: '之前的问题' }],
      });
      prisma.assistantMessage.create.mockResolvedValue({ id: 'msg-2' });

      const result = await service.chat({
        conversationId: 'conv-1',
        message: '继续',
      });

      expect(prisma.assistantConversation.findUnique).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
      });
      expect(result.conversationId).toBe('conv-1');
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
    it('应返回最近 20 条会话，含首条用户消息摘要', async () => {
      prisma.assistantConversation.findMany.mockResolvedValue([
        { id: 'c1', title: '对话1', createdAt: new Date(), updatedAt: new Date(), messages: [{ content: '你好，系统有多少采购项目' }] },
      ]);

      const result = await service.listConversations();

      expect(prisma.assistantConversation.findMany).toHaveBeenCalledWith({
        orderBy: { updatedAt: 'desc' },
        include: {
          messages: { where: { role: 'user' }, orderBy: { createdAt: 'asc' }, take: 1, select: { content: true } },
        },
        take: 20,
      });
      expect(result).toHaveLength(1);
      expect(result[0].firstMessage).toBe('你好，系统有多少采购项目');
    });

    it('会话无 messages 关联时不报错（firstMessage 为空）', async () => {
      prisma.assistantConversation.findMany.mockResolvedValue([
        { id: 'c2', title: '空对话', createdAt: new Date(), updatedAt: new Date() },
      ]);

      const result = await service.listConversations();

      expect(result).toHaveLength(1);
      expect(result[0].firstMessage).toBe('');
    });
  });

  describe('getConversation', () => {
    it('应返回含消息的会话详情', async () => {
      prisma.assistantConversation.findUnique.mockResolvedValue({
        ...mockConversation,
        messages: [
          { id: 'm1', role: 'user', content: '你好' },
          { id: 'm2', role: 'assistant', content: '你好，董事长' },
        ],
      });

      const result = await service.getConversation('conv-1');

      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(2);
      expect(result!.id).toBe('conv-1');
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

      const result = await service.confirmAction('act-1');

      expect(result.status).toBe('success');
    });

    it('非 pending 状态的日志确认应返回错误', async () => {
      prisma.assistantActionLog.findUnique.mockResolvedValue({
        id: 'act-1',
        status: 'success',
      });

      const result = await service.confirmAction('act-1');

      expect(result.status).toBe('failed');
      expect(result.message).toContain('已处理');
    });

    it('不存在的日志确认应返回错误', async () => {
      prisma.assistantActionLog.findUnique.mockResolvedValue(null);

      const result = await service.confirmAction('nonexistent');

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

      const result = await service.cancelAction('act-1');

      expect(result.status).toBe('success');
      expect(prisma.assistantActionLog.update).toHaveBeenCalledWith({
        where: { id: 'act-1' },
        data: { status: 'cancelled' },
      });
    });
  });
});
