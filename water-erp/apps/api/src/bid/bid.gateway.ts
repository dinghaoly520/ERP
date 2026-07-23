import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import {
  BID_EVENT,
  type DecryptStatusPayload,
  type SubmissionOpenedPayload,
  type OpeningStartedPayload,
  type StageChangePayload,
  type EvaluationStartedPayload,
  type ExpertPresencePayload,
  type ExpertPresenceAggregatePayload,
  type ClarificationCreatedPayload,
  type ClarificationRepliedPayload,
  type SupervisionLogPayload,
  type AnomalyDetectedPayload,
  type BidValidityChangePayload,
  type HallMessagePayload,
  type HallPresenceUpdatePayload,
  type HallCheckinPayload,
  type HallExchangeControlPayload,
  type OpeningConfirmedPayload,
  type OpeningDisputedPayload,
  type OpeningDisputeResolvedPayload,
} from '@water-erp/shared';

/** Roles that may see individual presence / supervision / anomalies (command center). */
const HOST_ROLES = new Set(['admin', 'bid_host', 'leader', 'staff']);

export function canJoinHostRoom(role: string | undefined): boolean {
  return !!role && HOST_ROLES.has(role);
}

/** 供应商绝不可见的事件（评分过程/监督/异常——设计文档 §4.3）。 */
export const SUPPLIER_BLOCKED_EVENTS = new Set<string>([
  BID_EVENT.SUPERVISION_LOG,
  BID_EVENT.ANOMALY_DETECTED,
  BID_EVENT.EXPERT_PRESENCE,
]);

/** Parse the auth token from the raw handshake cookie header. */
export function tokenFromHandshake(socket: Socket): string | undefined {
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
    map.get('token')
  );
}

@WebSocketGateway({
  namespace: 'bid',
  cors: { origin: true, credentials: true },
})
@Injectable()
export class BidGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(BidGateway.name);

  /** supplierId(Supplier.id) → socket id 集合（私聊定向投递 + 在场感知）。 */
  private readonly supplierSockets = new Map<string, Set<string>>();
  /** socket.id → 所属项目（断连时回收在场表）。 */
  private readonly socketProjects = new Map<string, string>();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Connection lifecycle: JWT auth + role flag ──

  async handleConnection(socket: Socket) {
    const token = tokenFromHandshake(socket);
    let role: string | undefined;
    let userId: string | undefined;
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync(token);
        role = payload?.role;
        userId = payload?.sub;
      } catch {
        role = undefined;
      }
    }
    (socket.data as any).userId = userId;
    (socket.data as any).role = role;
    (socket.data as any).isHost = canJoinHostRoom(role);
    this.logger.debug(`WS connected role=${role || 'unknown'} host=${(socket.data as any).isHost}`);
  }

  handleDisconnect(socket: Socket) {
    const supplierId: string | undefined = (socket.data as any).supplierId;
    const projectId = this.socketProjects.get(socket.id);
    if (supplierId) {
      const set = this.supplierSockets.get(supplierId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) this.supplierSockets.delete(supplierId);
      }
    }
    this.socketProjects.delete(socket.id);
    if (projectId) this.broadcastHallPresence(projectId).catch(() => {});
  }

  // ── Room management: role-segregated routing ──

  @SubscribeMessage('join:project')
  async handleJoinProject(client: Socket, projectId: string) {
    const role: string | undefined = (client.data as any).role;
    const userId: string | undefined = (client.data as any).userId;

    if (role === 'supplier') {
      // 双层门控（设计 §4.2）：角色门（supplier 永不进 host 房）+ 成员门（须参投本项目）
      if (!userId) return { error: 'UNAUTHORIZED' };
      const supplier = await this.prisma.supplier.findFirst({ where: { userId } });
      if (!supplier) return { error: 'SUPPLIER_PROFILE_NOT_FOUND' };
      const member = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId: supplier.id } });
      if (!member) return { error: 'NOT_PROJECT_MEMBER' };

      (client.data as any).supplierId = supplier.id;
      (client.data as any).supplierName = member.supplierName;
      (client.data as any).projectId = projectId;

      let set = this.supplierSockets.get(supplier.id);
      if (!set) { set = new Set(); this.supplierSockets.set(supplier.id, set); }
      set.add(client.id);
      this.socketProjects.set(client.id, projectId);

      await this.prisma.bidSupplier.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
      client.join(`project:${projectId}`);
      this.broadcastHallPresence(projectId).catch(() => {});
      return { ok: true, supplierId: supplier.id, supplierName: member.supplierName };
    }

    client.join(`project:${projectId}`);
    if (canJoinHostRoom(role)) client.join(`host:${projectId}`);
    return { ok: true };
  }

  @SubscribeMessage('leave:project')
  handleLeaveProject(client: Socket, projectId: string) {
    client.leave(`project:${projectId}`);
    client.leave(`host:${projectId}`);
  }

  // ── Heartbeat ──

  @SubscribeMessage('ping')
  handlePing(client: Socket, ts: number) {
    client.emit('pong', ts);
  }

  // ── Process events (everyone): decrypt / stage / evaluation / clarification ──

  notifyDecryptStatus(projectId: string, supplierId: string, supplierName: string, decryptStatus: DecryptStatusPayload['decryptStatus']) {
    const payload: DecryptStatusPayload = { supplierId, supplierName, decryptStatus, timestamp: Date.now() };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.DECRYPT_STATUS, payload);
  }

  notifyStageChange(projectId: string, from: string, to: string, actor: string) {
    const payload: StageChangePayload = { projectId, from, to, actor };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.STAGE_CHANGE, payload);
  }

  notifyEvaluationStarted(projectId: string) {
    const payload: EvaluationStartedPayload = { projectId, timestamp: Date.now() };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.EVALUATION_STARTED, payload);
  }

  notifySubmissionOpened(projectId: string) {
    const payload: SubmissionOpenedPayload = { projectId, timestamp: Date.now() };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.SUBMISSION_OPENED, payload);
  }

  notifyOpeningStarted(projectId: string, data: { host: string; supervisor: string }) {
    const payload: OpeningStartedPayload = { projectId, host: data.host, supervisor: data.supervisor, timestamp: Date.now() };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.OPENING_STARTED, payload);
  }

  notifyClarificationCreated(projectId: string, data: { id: string; issuer: string; issuerRole: string; supplierName: string; questionPreview: string }) {
    const payload: ClarificationCreatedPayload = { ...data, timestamp: Date.now() };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.CLARIFICATION_CREATED, payload);
  }

  notifyClarificationReplied(projectId: string, data: { id: string; replier: string; replyPreview: string }) {
    const payload: ClarificationRepliedPayload = { ...data, timestamp: Date.now() };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.CLARIFICATION_REPLIED, payload);
  }

  // ── Expert presence: aggregate snapshot to everyone; individual milestone to host only ──

  notifyExpertPresence(projectId: string, data: Omit<ExpertPresencePayload, 'timestamp'>) {
    const payload: ExpertPresencePayload = { ...data, timestamp: Date.now() };
    this.server.to(`host:${projectId}`).emit(BID_EVENT.EXPERT_PRESENCE, payload);
    this.broadcastAggregatePresence(projectId).catch(() => {});
  }

  async broadcastAggregatePresence(projectId: string) {
    const experts = await this.prisma.bidExpert.findMany({
      where: { projectId },
      select: { signedIn: true, avoidanceConfirmed: true, reportConfirmed: true, progress: true },
    });
    const total = experts.length;
    const payload: ExpertPresenceAggregatePayload = {
      projectId, totalExperts: total,
      signedInCount: experts.filter(e => e.signedIn).length,
      avoidanceConfirmedCount: experts.filter(e => e.avoidanceConfirmed).length,
      reportConfirmedCount: experts.filter(e => e.reportConfirmed).length,
      averageProgressPercent: total > 0 ? Math.round(experts.reduce((s, e) => s + (e.progress ?? 0), 0) / total) : 0,
      timestamp: Date.now(),
    };
    // 设计 §4.3：评标进度聚合仅主持内部可见，供应商不可见
    this.server.to(`host:${projectId}`).emit(BID_EVENT.EXPERT_PRESENCE_AGGREGATE, payload);
  }

  // ── Bid validity: broadcast to everyone in the project room (experts grey-out the supplier) ──

  notifyBidValidity(projectId: string, data: Omit<BidValidityChangePayload, 'timestamp'>) {
    const payload: BidValidityChangePayload = { ...data, timestamp: Date.now() };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.BID_VALIDITY_CHANGE, payload);
  }

  // ── Host-only events: supervision log, anomaly ──

  notifySupervisionLog(projectId: string, log: Omit<SupervisionLogPayload, 'time'> & { time?: number }) {
    const payload: SupervisionLogPayload = {
      role: log.role, action: log.action, target: log.target,
      result: log.result, riskFlag: log.riskFlag, time: log.time ?? Date.now(),
    };
    this.server.to(`host:${projectId}`).emit(BID_EVENT.SUPERVISION_LOG, payload);
  }

  notifyAnomaly(projectId: string, data: Omit<AnomalyDetectedPayload, 'timestamp'>) {
    const payload: AnomalyDetectedPayload = { ...data, timestamp: Date.now() };
    this.server.to(`host:${projectId}`).emit(BID_EVENT.ANOMALY_DETECTED, payload);
  }

  // ── 开标大厅（迭代一）：供应商可见事件走 project 房；私聊/定向事件按连接表投递 ──

  /** 大厅消息：PUBLIC → project 房全员；PRIVATE → host 房 + 该供应商自己的连接。 */
  notifyHallMessage(projectId: string, payload: HallMessagePayload) {
    if (payload.roomType === 'PUBLIC') {
      this.server.to(`project:${projectId}`).emit(BID_EVENT.HALL_MESSAGE_NEW, payload);
      return;
    }
    this.server.to(`host:${projectId}`).emit(BID_EVENT.HALL_MESSAGE_NEW, payload);
    if (payload.supplierId) {
      const ids = this.supplierSockets.get(payload.supplierId);
      if (ids) for (const sid of ids) this.server.to(sid).emit(BID_EVENT.HALL_MESSAGE_NEW, payload);
    }
  }

  notifyHallCheckin(projectId: string, payload: HallCheckinPayload) {
    this.server.to(`project:${projectId}`).emit(BID_EVENT.HALL_CHECKIN, payload);
  }

  notifyExchangeControl(projectId: string, payload: HallExchangeControlPayload) {
    this.server.to(`project:${projectId}`).emit(BID_EVENT.HALL_EXCHANGE_CONTROL, payload);
  }

  /** 在场名单：合并内存连接表与 DB 签到状态，广播 project 房。 */
  async broadcastHallPresence(projectId: string) {
    const rows = await this.prisma.bidSupplier.findMany({
      where: { projectId },
      select: { supplierId: true, supplierName: true, checkInAt: true },
    });
    const onlineSuppliers = rows
      .filter(r => r.supplierId && (this.supplierSockets.get(r.supplierId)?.size ?? 0) > 0)
      .map(r => ({ supplierId: r.supplierId as string, supplierName: r.supplierName, checkInAt: r.checkInAt?.toISOString() ?? null }));
    const payload: HallPresenceUpdatePayload = {
      projectId, onlineSuppliers, onlineCount: onlineSuppliers.length, timestamp: Date.now(),
    };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.HALL_PRESENCE_UPDATE, payload);
  }

  getOnlineSupplierIds(projectId: string): Set<string> {
    const out = new Set<string>();
    for (const [supplierId, ids] of this.supplierSockets) {
      for (const sid of ids) if (this.socketProjects.get(sid) === projectId) { out.add(supplierId); break; }
    }
    return out;
  }

  // ── 确认/异议：host 房 + 当事供应商连接（设计 §6.3，不广播全 project 房）──

  notifyOpeningConfirmed(projectId: string, supplierId: string, payload: OpeningConfirmedPayload) {
    this.server.to(`host:${projectId}`).emit(BID_EVENT.OPENING_CONFIRMED, payload);
    const ids = this.supplierSockets.get(supplierId);
    if (ids) for (const sid of ids) this.server.to(sid).emit(BID_EVENT.OPENING_CONFIRMED, payload);
  }

  notifyOpeningDisputed(projectId: string, supplierId: string, payload: OpeningDisputedPayload) {
    this.server.to(`host:${projectId}`).emit(BID_EVENT.OPENING_DISPUTED, payload);
    const ids = this.supplierSockets.get(supplierId);
    if (ids) for (const sid of ids) this.server.to(sid).emit(BID_EVENT.OPENING_DISPUTED, payload);
  }

  notifyOpeningDisputeResolved(projectId: string, supplierId: string, payload: OpeningDisputeResolvedPayload) {
    this.server.to(`host:${projectId}`).emit(BID_EVENT.OPENING_DISPUTE_RESOLVED, payload);
    const ids = this.supplierSockets.get(supplierId);
    if (ids) for (const sid of ids) this.server.to(sid).emit(BID_EVENT.OPENING_DISPUTE_RESOLVED, payload);
  }
}
