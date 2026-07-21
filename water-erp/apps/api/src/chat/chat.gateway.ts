import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { ChatService, SendMessageInput } from './chat.service';

/**
 * 从握手 cookie 中解析 JWT。各门户的命名 cookie 都识别，
 * 与 bid.gateway 的 tokenFromHandshake 同源 —— 允许跨门户聊天。
 */
function tokenFromHandshake(socket: Socket): string | undefined {
  const raw = socket.handshake.headers.cookie;
  if (!raw) return undefined;
  const map = new Map<string, string>();
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) map.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  return (
    map.get('token_web') ||
    map.get('token_expert') ||
    map.get('token_supplier') ||
    map.get('token_mall') ||
    map.get('token')
  );
}

/**
 * 一对一即时聊天网关。namespace `/chat`。
 *
 * 设计要点：
 * - 每个用户加入个人 room `user:${userId}`，按 userId 推送（不关心对方在哪个 socket）。
 * - 在线状态用内存 Map 维护（userId → Set<socketId>），支持同账号多端登录。
 * - 发送消息：service 落库 → 给接收方 room 和发送方其他端广播；当前 socket 通过 ack 拿到消息。
 */
@WebSocketGateway({
  namespace: 'chat',
  cors: { origin: true, credentials: true },
})
@Injectable()
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);
  private readonly sockets = new Map<string, Set<string>>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly chatService: ChatService,
  ) {}

  // ── Lifecycle ──

  async handleConnection(socket: Socket) {
    const token = tokenFromHandshake(socket);
    let userId: string | undefined;
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync(token);
        userId = payload?.sub;
      } catch {
        userId = undefined;
      }
    }
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    (socket.data as any).userId = userId;
    let set = this.sockets.get(userId);
    const wasEmpty = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
    }
    set.add(socket.id);
    void socket.join(`user:${userId}`);

    // 仅 0→1 时广播上线，避免抖动
    if (wasEmpty) this.server.emit('presence:online', { userId });
    this.logger.debug(`WS connect userId=${userId} socket=${socket.id}`);
  }

  handleDisconnect(socket: Socket) {
    const userId: string | undefined = (socket.data as any).userId;
    if (!userId) return;
    const set = this.sockets.get(userId);
    if (!set) return;
    set.delete(socket.id);
    if (set.size === 0) {
      this.sockets.delete(userId);
      this.server.emit('presence:offline', { userId });
    }
  }

  /** 当前在线的 userId 集合（供 controller 查询） */
  getOnlineUserIds(): Set<string> {
    return new Set(this.sockets.keys());
  }

  /** 由 controller 主动调用：通知对方"你的消息已被读" */
  notifyRead(byId: string, peerId: string, updated: number) {
    this.server.to(`user:${peerId}`).emit('message:read', { by: byId, updated });
  }

  // ── 收发消息 ──

  @SubscribeMessage('message:send')
  async handleSendMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: SendMessageInput,
  ) {
    const senderId: string | undefined = (socket.data as any).userId;
    if (!senderId) return { error: 'UNAUTHORIZED' };
    if (!body || !body.receiverId) return { error: 'MISSING_RECEIVER' };

    try {
      const msg = await this.chatService.send(senderId, body);
      // 给接收者所有端
      socket.to(`user:${body.receiverId}`).emit('message:new', msg);
      // 给发送者其他端（多端同步）；当前 socket 通过 ack 收到 msg
      socket.to(`user:${senderId}`).emit('message:new', msg);
      return { ok: true, message: msg };
    } catch (err: any) {
      const code = err?.response?.code || err?.message || 'SEND_FAILED';
      return { error: code };
    }
  }

  @SubscribeMessage('message:read')
  async handleMarkRead(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { peerId: string },
  ) {
    const meId: string | undefined = (socket.data as any).userId;
    if (!meId || !body?.peerId) return { error: 'INVALID_PAYLOAD' };
    const result = await this.chatService.markRead(meId, body.peerId);
    this.notifyRead(meId, body.peerId, result.updated);
    return { ok: true, ...result };
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() socket: Socket, @MessageBody() ts: number) {
    socket.emit('pong', ts);
  }
}
