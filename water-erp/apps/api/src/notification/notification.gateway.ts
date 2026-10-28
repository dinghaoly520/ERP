import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PORTS } from '@water-erp/config';
import { tokenFromHandshake } from '../bid/bid.gateway';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 通知实时推送网关（2026-09-22）：站内通知创建后即时推送到目标账号的页面，
 * 前端右下角小窗弹出（10s 自动消失）——无需刷新页面。
 *
 * 鉴权：按握手 X-Portal 头 / Origin 端口判别来源门户，只读对应命名空间的 cookie
 * （复用 bid.gateway 的 tokenFromHandshake 同链；2026-09-29 X-P1-03 修复——历史
 * 无判别回退链 token_web→supplier→expert→bid 会让多门户共存浏览器串台身份：
 * 供应商页以残留 token_web 的 staff 身份加入 user:{staffId} 房间收到他人通知）。
 * 连接后自动加入 `user:{userId}` 房间；推送按 userId 定向。
 * 推送入口：`NotificationGateway.pushToUser(userId, payload)`（NotificationService.create 统一调用）。
 *
 * 会话轮换防护（2026-10-14）：带 sid 的单设备会话（web/supplier/expert）握手时与库中
 * webSessionId 对账（AuthGuard 同口径），被互踢的旧 token 拒绝入房；rotatePortalSession
 * 轮换时调 evictUser 驱逐旧订阅——否则旧页签 REST 全 401 却仍收推送弹窗，
 * 出现「通知弹窗可见、消息中心拉不到」悖论。无 sid 会话（token_bid 等
 * 不轮换命名空间）不校验此列。
 */

function wsCorsOrigin(): string | string[] | ((origin: string, cb: (err: Error | null, ok?: boolean) => void) => void) {
  if (process.env.NODE_ENV !== 'production') {
    return (_origin: string, cb: (err: Error | null, ok?: boolean) => void) => cb(null, true);
  }
  const envOrigins = process.env.CORS_ORIGINS;
  if (envOrigins) return envOrigins.split(',').map((o) => o.trim()).filter(Boolean);
  const origins: string[] = [];
  for (const port of Object.values(PORTS)) {
    origins.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
  }
  return origins;
}

export interface NotificationPushPayload {
  id: string;
  type: string;
  title: string;
  content: string;
  link?: string | null;
  createdAt: string;
}

@WebSocketGateway({
  namespace: 'notifications',
  cors: { origin: wsCorsOrigin(), credentials: true },
})
@Injectable()
export class NotificationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  @WebSocketServer()
  server!: Server;

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = tokenFromHandshake(client);
      if (!token) {
        this.logger.debug(`拒绝匿名 WS 连接 ${client.id}`);
        client.disconnect(true);
        return;
      }
      const payload = await this.jwt.verifyAsync<{ sub: string; sid?: string }>(token).catch(() => null);
      if (!payload?.sub) {
        client.disconnect(true);
        return;
      }
      // 带 sid 的单设备会话：与库中 webSessionId 对账，被轮换（互踢）的旧 token 拒绝入房
      if (payload.sid) {
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: { webSessionId: true },
        });
        if (!user || user.webSessionId !== payload.sid) {
          this.logger.debug(`拒绝已轮换会话的 WS 连接 ${client.id} → user:${payload.sub}`);
          client.disconnect(true);
          return;
        }
      }
      await client.join(`user:${payload.sub}`);
      client.data.userId = payload.sub;
      this.logger.debug(`WS 通知连接 ${client.id} → user:${payload.sub}`);
    } catch (err) {
      this.logger.warn(`WS 通知连接处理失败：${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    // socket.io 自动离开房间；无需额外清理
    void client;
  }

  /** 定向推送：目标账号所有在线门户页面立即收到（多个浏览器 tab/多门户同时弹窗）。 */
  pushToUser(userId: string, payload: NotificationPushPayload): void {
    if (!this.server) return; // 测试环境/未就绪时静默跳过
    this.server.to(`user:${userId}`).emit('notification:new', payload);
  }

  /**
   * 会话轮换驱逐（2026-10-14，AuthService.rotatePortalSession 调用）：断开该账号全部
   * 既有 WS 订阅。调用时点在轮换写库之后、新会话首页连接之前——被断开的都是旧会话页签；
   * 新页签握手带新 sid 正常入房。旧页签重连时握手 sid 对账失败即被拒。
   */
  evictUser(userId: string): void {
    if (!this.server) return; // 测试环境/未就绪时静默跳过
    this.server.in(`user:${userId}`).disconnectSockets(true);
  }
}
