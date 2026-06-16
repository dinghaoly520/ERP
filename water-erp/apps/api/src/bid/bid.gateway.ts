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
  type StageChangePayload,
  type EvaluationStartedPayload,
  type ExpertPresencePayload,
  type ExpertPresenceAggregatePayload,
  type ClarificationCreatedPayload,
  type ClarificationRepliedPayload,
  type SupervisionLogPayload,
  type AnomalyDetectedPayload,
} from '@water-erp/shared';

/** Roles that may see individual presence / supervision / anomalies (command center). */
const HOST_ROLES = new Set(['admin', 'bid_host', 'procurement_staff']);

/** Parse the auth token from the raw handshake cookie header. */
function tokenFromHandshake(socket: Socket): string | undefined {
  const raw = socket.handshake.headers.cookie;
  if (!raw) return undefined;
  const map = new Map<string, string>();
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) map.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  return map.get('token_web') || map.get('token_expert') || map.get('token');
}

@WebSocketGateway({
  namespace: 'bid',
  cors: { origin: '*', credentials: true },
})
@Injectable()
export class BidGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(BidGateway.name);

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
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync(token);
        role = payload?.role;
      } catch {
        role = undefined;
      }
    }
    (socket.data as any).role = role;
    (socket.data as any).isHost = !!role && HOST_ROLES.has(role);
    this.logger.debug(`WS connected role=${role || 'unknown'} host=${(socket.data as any).isHost}`);
  }

  handleDisconnect(socket: Socket) {
    void socket; // socket.io cleans rooms automatically
  }

  // ── Room management: role-segregated routing ──

  @SubscribeMessage('join:project')
  handleJoinProject(client: Socket, projectId: string) {
    client.join(`project:${projectId}`);
    if ((client.data as any).isHost) client.join(`host:${projectId}`);
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
    this.server.to(`project:${projectId}`).emit(BID_EVENT.EXPERT_PRESENCE_AGGREGATE, payload);
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
}
