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
import { PORTS } from '@water-erp/config';
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
  type OpeningRecordUpdatedPayload,
  type OpeningCompletedPayload,
  type RoundStatusChangePayload,
  type ScoresSubmittedPayload,
  type DraftSavedPayload,
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

/**
 * Parse the auth token from the raw handshake cookie header.
 *
 * 同源多门户 cookie 可能共存（localhost 各门户跨端口共享 cookie；同域部署同理）：
 * 优先按 X-Portal 头、其次 Origin 端口判定门户归属（与 HTTP 侧 portal-cookie.ts 的
 * 解析链一致），避免 token_web 永远压过 token_supplier 导致供应商 socket 被误判为主持人。
 * bid（:3007）自 2026-08-14 起为独立门户（token_bid），必须显式分支，
 * 否则现场端 socket 拿不到 token、join:project 被硬门控 UNAUTHORIZED。
 *
 * 安全说明（2026-08 加固）：供应商/专家门户**不再回退**到 token_web。
 * 历史回退链 `token_supplier → token_web → token` 在 localhost 跨端口共享 cookie 的场景下，
 * 会让残留 token_web 的供应商浏览器被识别为主持人角色——虽 join:project 房间隔离兜底，
 * 但纵深防御失效。各门户现严格只读对应命名空间的 cookie。
 */
export function tokenFromHandshake(socket: Socket): string | undefined {
  const raw = socket.handshake.headers.cookie;
  if (!raw) return undefined;
  const map = new Map<string, string>();
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) map.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  const xPortal = (socket.handshake.headers['x-portal'] as string | undefined)?.toLowerCase();
  const originPort = (socket.handshake.headers.origin ?? '').split(':')[2]?.split('/')[0];
  if (xPortal === 'bid' || originPort === String(PORTS.bid)) {
    // :3007 独立门户：优先 token_bid；回退 token_web/token 兼容旧会话（admin 经 :3005 登录）
    return map.get('token_bid') || map.get('token_web') || map.get('token');
  }
  if (
    xPortal === 'supplier' ||
    originPort === String(PORTS.supplier) ||
    originPort === String(PORTS.supplierNext) // :3020 supplier-portal-next（迁移期与 :3004 并行，同一 token_supplier 命名空间）
  ) {
    return map.get('token_supplier');
  }
  if (xPortal === 'expert' || originPort === String(PORTS.expert)) {
    return map.get('token_expert');
  }
  // 默认分支：web/bid-portal 共用 token_web 命名空间；保留 legacy `token` 兜底
  // 仅用于直接访问 API（如 Swagger）的场景，与 HTTP 侧 portal-cookie.ts 一致。
  return map.get('token_web') || map.get('token');
}

/**
 * WS CORS origin 解析（镜像 main.ts 的 corsOrigins 逻辑，避免 origin:true 全放行）。
 *
 * - 生产环境：读 CORS_ORIGINS（逗号分隔），未设则回退到本地门户端口列表；
 * - 非生产环境：放行任意 origin（局域网设备访问，与 HTTP 侧 CORS 一致）。
 */
function wsCorsOrigin(): string | string[] | ((origin: string, cb: (err: Error | null, ok?: boolean) => void) => void) {
  if (process.env.NODE_ENV !== 'production') {
    return (_origin: string, cb: (err: Error | null, ok?: boolean) => void) => cb(null, true);
  }
  const envOrigins = process.env.CORS_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(',').map((o) => o.trim()).filter(Boolean);
  }
  const origins: string[] = [];
  for (const port of Object.values(PORTS)) {
    origins.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
  }
  return origins;
}

@WebSocketGateway({
  namespace: 'bid',
  cors: { origin: wsCorsOrigin(), credentials: true },
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
    // 严格握手鉴权（2026-08 加固）：无 token 或校验失败一律拒绝连接。
    // 历史「软鉴权」依赖 join:project 的 join 层兜底（C1）——但连接本身保持匿名可挂，
    // 与"分数永不出现在事件载荷"等铁律并行的纵深防御不一致。
    // 拒绝连接后客户端会触发 socket.io 重连，重新走握手 → 用新 token 进。
    if (!token) {
      this.logger.warn(`WS 拒绝连接：无 token（origin=${socket.handshake.headers.origin ?? 'unknown'}）`);
      socket.disconnect(true);
      return;
    }
    let role: string | undefined;
    let userId: string | undefined;
    try {
      const payload = await this.jwt.verifyAsync(token);
      role = payload?.role;
      userId = payload?.sub;
    } catch (err) {
      this.logger.warn(`WS 拒绝连接：JWT 校验失败（${(err as Error).message}）`);
      socket.disconnect(true);
      return;
    }
    if (!role || !userId) {
      this.logger.warn('WS 拒绝连接：JWT 载荷缺 role/sub');
      socket.disconnect(true);
      return;
    }
    (socket.data as any).userId = userId;
    (socket.data as any).role = role;
    (socket.data as any).isHost = canJoinHostRoom(role);
    this.logger.debug(`WS connected role=${role} host=${(socket.data as any).isHost}`);
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
    // 认证兜底（C1）：handleConnection 保持软鉴权，但 join 层强制认证——
    // 无 token / 校验失败的 socket（role 或 userId 缺失）一律拒绝，不得进任何项目房。
    if (!userId || !role) return { error: 'UNAUTHORIZED' };

    if (role === 'supplier') {
      // 双层门控（设计 §4.2）：角色门（supplier 永不进 host 房）+ 成员门（须参投本项目）
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

    if (role === 'bid_expert') {
      // 指派门控（S1）：仅本项目指派的专家（BidExpert projectId×userId）可进
      // project 房 + 专家聚合进度房（§4.3 供应商不可见）；断连时 socket.io 自动移出其加入的房间。
      // 已拒邀（declined）专家不得旁观项目评标进度；候补/pending 放行（候补可递补、pending 待响应）。
      const assigned = await this.prisma.bidExpert.findFirst({
        where: { projectId, userId, invitationStatus: { not: 'declined' } },
      });
      if (!assigned) return { error: 'NOT_ASSIGNED_EXPERT' };
      client.join(`project:${projectId}`);
      client.join(`experts:${projectId}`);
      // 立即推送当前聚合进度快照（修复：专家进入时看不到专家组签到/进度信息）
      this.broadcastAggregatePresence(projectId).catch(() => {});
      return { ok: true };
    }

    if (role === 'procurement_staff') {
      // 内部采购员工：放行公开流（project 房——解密进度/阶段/公聊等开标公开信息），
      // 不进 host 房（监督日志/异常/专家个体进度仍屏蔽）；REST 敏感操作（私聊/交流控制）
      // 由 opening-hall.service 的 assertHost 另行拒绝（S8 决策：公开流放行、敏感操作收紧）。
      client.join(`project:${projectId}`);
      return { ok: true };
    }

    // 显式角色白名单（C1）：host 角色进 project + host 房；
    // mall 等其余角色不进开标实时流。
    if (canJoinHostRoom(role)) {
      client.join(`project:${projectId}`);
      client.join(`host:${projectId}`);
      return { ok: true };
    }
    return { error: 'FORBIDDEN' };
  }

  @SubscribeMessage('leave:project')
  handleLeaveProject(client: Socket, projectId: string) {
    // R8：退房同时回收连接表——旧实现只退房不清 supplierSockets/socketProjects，
    // 导致离场后仍计在线、仍收私聊定向推送。
    // Wave4a-M6：连接表清理一律以 socketProjects 登记项目为准（而非 leave 载荷）——
    // 恶意/异常端 emit leave('p1') 不得误清/漏清登记于 p2 的 socket（自伤型）。
    // 退房：载荷房 + 登记房去重后都退；presence 按涉及项目刷新。
    const supplierId: string | undefined = (client.data as any).supplierId;
    const registered: string | undefined = this.socketProjects.get(client.id);
    const requested: string | undefined = projectId || (client.data as any).projectId;
    if (supplierId && registered) {
      const set = this.supplierSockets.get(supplierId);
      if (set) {
        set.delete(client.id);
        if (set.size === 0) this.supplierSockets.delete(supplierId);
      }
    }
    this.socketProjects.delete(client.id);
    const pids = new Set<string>();
    if (requested) pids.add(requested);
    if (registered) pids.add(registered);
    for (const pid of pids) {
      client.leave(`project:${pid}`);
      client.leave(`host:${pid}`);
      client.leave(`experts:${pid}`);
      this.broadcastHallPresence(pid).catch(() => {});
    }
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

  notifyOpeningStarted(projectId: string, data: { host: string; supervisor: string | null }) {
    const payload: OpeningStartedPayload = { projectId, host: data.host, supervisor: data.supervisor, timestamp: Date.now() };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.OPENING_STARTED, payload);
  }

  notifyOpeningCompleted(projectId: string, data: { handoverAt: string; handoverAssetId: string }) {
    const payload: OpeningCompletedPayload = { projectId, handoverAt: data.handoverAt, handoverAssetId: data.handoverAssetId, timestamp: Date.now() };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.OPENING_COMPLETED, payload);
  }

  /** 唱标记录已录入/更新 → project 房广播，触发全体投标人刷新「唱标记录（全部投标人）」公开表。
   *  唱标信息自 OPENING 阶段起属公开信息（《电子招标投标办法》第30条 /《招标投标法》第36条），
   *  广播 payload 仅金额里程碑 + 名称，不含密封报价原文（评分/报价保密铁律）。
   *  计划约束：2026-08-17-supplier-opening-records-hall（WS/后端广播零改动，勿收口为定向推送）。 */
  notifyOpeningRecordUpdated(projectId: string, data: { supplierId: string; supplierName: string; recordId: string; amount: number }) {
    const payload: OpeningRecordUpdatedPayload = { projectId, ...data, timestamp: Date.now() };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.OPENING_RECORD_UPDATED, payload);
  }

  notifyClarificationCreated(projectId: string, data: { id: string; issuer: string; issuerRole: string; supplierName: string; questionPreview: string }) {
    const payload: ClarificationCreatedPayload = { ...data, timestamp: Date.now() };
    this.server.to(`project:${projectId}`).emit(BID_EVENT.CLARIFICATION_CREATED, payload);
  }

  /**
   * 答复事件：仅主持房 + 专家房（终审安全修复 2026-08-28）。
   * project 房含全体投标人（join:project 供应商成员门），而供应商门户 socket 恰在
   * EVALUATING 期间在线（round-quote/opening-hall/chat-panel 三页挂 useBidWebSocket），
   * 原先的 project 房广播会把被寻址供应商的答复文本（≤60 字预览）泄给竞争对手。
   * 供应商端本就不订阅该事件（supplier-portal-next 的 BidWsHandlers 无 onClarificationReplied），
   * 故改投 host/experts 房（与 EXPERT_PRESENCE_AGGREGATE 同拓扑）无功能回归。
   */
  notifyClarificationReplied(projectId: string, data: { id: string; replier: string; replyPreview: string }) {
    const payload: ClarificationRepliedPayload = { ...data, timestamp: Date.now() };
    this.server.to(`host:${projectId}`).emit(BID_EVENT.CLARIFICATION_REPLIED, payload);
    this.server.to(`experts:${projectId}`).emit(BID_EVENT.CLARIFICATION_REPLIED, payload);
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
    // 设计 §4.3：供应商不可见（§4.3）；主持端 + 专家端可见
    this.server.to(`host:${projectId}`).emit(BID_EVENT.EXPERT_PRESENCE_AGGREGATE, payload);
    this.server.to(`experts:${projectId}`).emit(BID_EVENT.EXPERT_PRESENCE_AGGREGATE, payload);
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

  /**
   * R8：该供应商在指定项目内的 socket 列表（按 socketProjects 过滤项目）。
   * 旧实现遍历该供应商**全部** socket → 同一供应商跨项目 tab 互收私聊/确认/异议定向事件。
   */
  private supplierSocketsIn(supplierId: string, projectId: string): string[] {
    const ids = this.supplierSockets.get(supplierId);
    if (!ids) return [];
    return [...ids].filter(sid => this.socketProjects.get(sid) === projectId);
  }

  /** 大厅消息：PUBLIC → project 房全员；PRIVATE → host 房 + 该供应商自己的连接。 */
  notifyHallMessage(projectId: string, payload: HallMessagePayload) {
    if (payload.roomType === 'PUBLIC') {
      this.server.to(`project:${projectId}`).emit(BID_EVENT.HALL_MESSAGE_NEW, payload);
      return;
    }
    this.server.to(`host:${projectId}`).emit(BID_EVENT.HALL_MESSAGE_NEW, payload);
    if (payload.supplierId) {
      for (const sid of this.supplierSocketsIn(payload.supplierId, projectId)) {
        this.server.to(sid).emit(BID_EVENT.HALL_MESSAGE_NEW, payload);
      }
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
    // Wave4a-M2：在线口径与 getOnlineSupplierIds 一致（按项目过滤 socketProjects）——
    // 旧实现按 supplierSockets 全局 size>0 判定，供应商仅连 p2 时 p1 的在场名单仍列其在线。
    const online = this.getOnlineSupplierIds(projectId);
    const rows = await this.prisma.bidSupplier.findMany({
      where: { projectId },
      select: { supplierId: true, supplierName: true, checkInAt: true },
    });
    const onlineSuppliers = rows
      .filter(r => r.supplierId && online.has(r.supplierId))
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
    for (const sid of this.supplierSocketsIn(supplierId, projectId)) {
      this.server.to(sid).emit(BID_EVENT.OPENING_CONFIRMED, payload);
    }
  }

  notifyOpeningDisputed(projectId: string, supplierId: string, payload: OpeningDisputedPayload) {
    this.server.to(`host:${projectId}`).emit(BID_EVENT.OPENING_DISPUTED, payload);
    for (const sid of this.supplierSocketsIn(supplierId, projectId)) {
      this.server.to(sid).emit(BID_EVENT.OPENING_DISPUTED, payload);
    }
  }

  notifyOpeningDisputeResolved(projectId: string, supplierId: string, payload: OpeningDisputeResolvedPayload) {
    this.server.to(`host:${projectId}`).emit(BID_EVENT.OPENING_DISPUTE_RESOLVED, payload);
    for (const sid of this.supplierSocketsIn(supplierId, projectId)) {
      this.server.to(sid).emit(BID_EVENT.OPENING_DISPUTE_RESOLVED, payload);
    }
  }

  // H2: 轮次状态变更广播——project 房间（所有参与者）
  notifyRoundStatusChange(projectId: string, payload: RoundStatusChangePayload) {
    this.server.to(`project:${projectId}`).emit(BID_EVENT.ROUND_STATUS_CHANGE, payload);
  }

  /** 评分提交里程碑：广播到专家房 + 主持房（:3007 现场进度实时化），不含分数值 */
  notifyScoresSubmitted(projectId: string, expertId: string, supplierId: string) {
    const payload: ScoresSubmittedPayload = { projectId, expertId, supplierId, timestamp: Date.now() };
    this.server.to(`experts:${projectId}`).emit(BID_EVENT.SCORES_SUBMITTED, payload);
    this.server.to(`host:${projectId}`).emit(BID_EVENT.SCORES_SUBMITTED, payload);
  }

  /** 草稿保存限流：键 `${projectId}:${expertId}`，3s 内不重复发送 */
  private draftSavedThrottle = new Map<string, number>();

  /** 草稿保存通知：广播到专家房（仅同项目其他专家），不含草稿内容 */
  notifyDraftSaved(projectId: string, expertId: string, device: 'tablet' | 'desktop') {
    const key = `${projectId}:${expertId}`;
    const last = this.draftSavedThrottle.get(key) ?? 0;
    if (Date.now() - last < 3000) return;
    this.draftSavedThrottle.set(key, Date.now());
    const payload: DraftSavedPayload = { projectId, expertId, device, timestamp: Date.now() };
    this.server.to(`experts:${projectId}`).emit(BID_EVENT.DRAFT_SAVED, payload);
  }
}
