import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ChatUserRow {
  id: string;
  username: string;
  displayName: string;
  role: string;
  avatar: string | null;
  company: string | null;
  department: { id: string; name: string } | null;
  isOnline: boolean;
}

export interface ConversationRow {
  peerId: string;
  peer: {
    id: string;
    displayName: string;
    role: string;
    avatar: string | null;
    department: { name: string } | null;
  };
  lastMessage: {
    id: string;
    type: string;
    content: string;
    senderId: string;
    createdAt: string;
  } | null;
  unreadCount: number;
}

export interface ChatMessageRow {
  id: string;
  senderId: string;
  receiverId: string;
  type: string;
  content: string;
  fileAssetId: string | null;
  fileUrl: string | null;
  fileMime: string | null;
  fileSize: number | null;
  readAt: string | null;
  createdAt: string;
}

export interface SendMessageInput {
  receiverId: string;
  type: string; // text | image | file
  content: string;
  fileAssetId?: string | null;
  fileUrl?: string | null;
  fileMime?: string | null;
  fileSize?: number | null;
}

function toMessageRow(m: any): ChatMessageRow {
  return {
    id: m.id,
    senderId: m.senderId,
    receiverId: m.receiverId,
    type: m.type,
    content: m.content,
    fileAssetId: m.fileAssetId,
    fileUrl: m.fileUrl,
    fileMime: m.fileMime,
    fileSize: m.fileSize,
    readAt: m.readAt,
    createdAt: m.createdAt,
  };
}

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** 系统内设人员（排除供应商、评审专家等外部账号），叠加在线状态 */
  async listUsers(onlineIds: Set<string>): Promise<ChatUserRow[]> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: { notIn: ['supplier', 'bid_expert'] } },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        avatar: true,
        company: true,
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ displayName: 'asc' }],
    });
    return users.map((u) => ({ ...u, isOnline: onlineIds.has(u.id) }));
  }

  /** 我的会话列表：peer + 最后一条 + 未读数 */
  async listConversations(meId: string): Promise<ConversationRow[]> {
    const messages = await this.prisma.chatMessage.findMany({
      where: { OR: [{ senderId: meId }, { receiverId: meId }] },
      orderBy: { createdAt: 'desc' },
    });

    const peerMap = new Map<string, { lastMessage: any; unread: number }>();
    for (const m of messages) {
      const peerId = m.senderId === meId ? m.receiverId : m.senderId;
      const isUnreadToMe = m.receiverId === meId && !m.readAt;
      const entry = peerMap.get(peerId);
      if (!entry) {
        peerMap.set(peerId, { lastMessage: m, unread: isUnreadToMe ? 1 : 0 });
      } else if (isUnreadToMe) {
        entry.unread += 1;
      }
    }

    const peerIds = Array.from(peerMap.keys());
    if (peerIds.length === 0) return [];

    const peers = await this.prisma.user.findMany({
      where: { id: { in: peerIds } },
      select: {
        id: true,
        displayName: true,
        role: true,
        avatar: true,
        company: true,
        department: { select: { name: true } },
      },
    });
    const peerInfo = new Map(peers.map((p) => [p.id, p]));

    return peerIds
      .map((peerId) => {
        const entry = peerMap.get(peerId)!;
        const peer = peerInfo.get(peerId);
        return {
          peerId,
          peer: peer
            ? { ...peer }
            : { id: peerId, displayName: '未知用户', role: '', avatar: null, company: null, department: null },
          lastMessage: entry.lastMessage
            ? {
                id: entry.lastMessage.id,
                type: entry.lastMessage.type,
                content: entry.lastMessage.content,
                senderId: entry.lastMessage.senderId,
                createdAt: entry.lastMessage.createdAt,
              }
            : null,
          unreadCount: entry.unread,
        };
      })
      .sort((a, b) => {
        const at = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
        const bt = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
        return bt - at;
      });
  }

  /** 与 peer 的消息，cursor 分页（desc 取后 reverse 成 asc） */
  async listMessages(
    meId: string,
    peerId: string,
    before?: string,
    limit: number = 30,
  ): Promise<ChatMessageRow[]> {
    const where: any = {
      OR: [
        { senderId: meId, receiverId: peerId },
        { senderId: peerId, receiverId: meId },
      ],
    };
    if (before) {
      const d = new Date(before);
      if (!isNaN(d.getTime())) where.createdAt = { lt: d };
    }
    const messages = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return messages.reverse().map(toMessageRow);
  }

  /** 落库一条消息（无在线/推送逻辑，gateway 负责推送） */
  async send(senderId: string, input: SendMessageInput): Promise<ChatMessageRow> {
    if (!input?.receiverId) {
      throw new BadRequestException({ error: '缺少接收者', code: 'MISSING_RECEIVER' });
    }
    // 允许 receiverId === senderId：作为"资料备份"笔记本使用
    const type = input.type || 'text';
    if (!['text', 'image', 'file'].includes(type)) {
      throw new BadRequestException({ error: '消息类型非法', code: 'INVALID_TYPE' });
    }
    if (type === 'text' && !((input.content ?? '').trim())) {
      throw new BadRequestException({ error: '内容不能为空', code: 'EMPTY_CONTENT' });
    }

    const msg = await this.prisma.chatMessage.create({
      data: {
        senderId,
        receiverId: input.receiverId,
        type,
        content: input.content ?? '',
        fileAssetId: input.fileAssetId ?? null,
        fileUrl: input.fileUrl ?? null,
        fileMime: input.fileMime ?? null,
        fileSize: input.fileSize ?? null,
      },
    });
    return toMessageRow(msg);
  }

  /** 把 peer 发给我的、未读消息标记为已读 */
  async markRead(meId: string, peerId: string): Promise<{ updated: number }> {
    const result = await this.prisma.chatMessage.updateMany({
      where: { senderId: peerId, receiverId: meId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
