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

/**
 * 通知实时推送网关（2026-09-22）：站内通知创建后即时推送到目标账号的页面，
 * 前端右下角小窗弹出（10s 自动消失）——无需刷新页面。
 *
 * 鉴权：复用 portal-cookie 同链的握手 cookie 解析（token_web/token_supplier/token_expert/token_bid），
 * 连接后自动加入 `user:{userId}` 房间；推送按 userId 定向，跨门户互不可见。
 * 推送入口：`NotificationGateway.pushToUser(userId, payload)`（NotificationService.create 统一调用）。
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
    map.get('token_supplier') ||
    map.get('token_expert') ||
    map.get('token_bid') ||
    map.get('token')
  );
}

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

  constructor(private readonly jwt: JwtService) {}

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
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token).catch(() => null);
      if (!payload?.sub) {
        client.disconnect(true);
        return;
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
}
