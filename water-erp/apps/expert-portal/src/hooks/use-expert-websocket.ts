'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { joinProjectOnConnect, onDisconnectedBeforeJoin, type JoinPolicyDeps } from '../lib/ws-join';
import type { ConnectionState, ExpertPresenceAggregatePayload, ExpertPresencePayload, DecryptStatusPayload, StageChangePayload, ClarificationCreatedPayload, ClarificationRepliedPayload, BidValidityChangePayload, HallMessagePayload, ScoresSubmittedPayload, DraftSavedPayload, EvaluationExtendedPayload, RoomCodeRotatedPayload, ScoringReopenedPayload, LeadReviewSuggestedPayload, MotionCreatedPayload } from '@water-erp/shared';
import { BID_EVENT } from '@water-erp/shared';
import { bidWsUrl } from '@water-erp/config';

interface Handlers {
  onAggregatePresence?: (d: ExpertPresenceAggregatePayload) => void;
  /** EXP-P2-02：个体在场里程碑（role_changed 等）——网关仅对 role_changed 补发专家房，
   *  候补被递补转正时停留页面据此刷新解锁，无需手动重载 */
  onExpertPresence?: (d: ExpertPresencePayload) => void;
  onDecryptStatus?: (d: DecryptStatusPayload) => void;
  onStageChange?: (d: StageChangePayload) => void;
  onClarificationCreated?: (d: ClarificationCreatedPayload) => void;
  onClarificationReplied?: (d: ClarificationRepliedPayload) => void;
  onBidValidityChange?: (d: BidValidityChangePayload) => void;
  /** D1: 开标大厅公聊消息 */
  onHallMessage?: (d: HallMessagePayload) => void;
  /** G1: 重连后回调——组件可执行全量数据刷新补偿丢失的事件 */
  onReconnected?: () => void;
  /** 评分提交通知（不含分数值）——同项目其他专家提交了评分，接收端自行刷新 */
  onScoresSubmitted?: (d: ScoresSubmittedPayload) => void;
  /** 草稿保存通知——对方设备保存了草稿，本端自行从服务端拉取合并 */
  onDraftSaved?: (d: DraftSavedPayload) => void;
  /** P2-9（中断审查）：评标时限已延长——陈旧「已截止/已锁定」态据此重拉解锁 */
  onEvaluationExtended?: (d: EvaluationExtendedPayload) => void;
  /** P2-10（中断审查）：评标室口令已轮换（不含口令本体）——刷新后口令门重现重验 */
  onRoomCodeRotated?: (d: RoomCodeRotatedPayload) => void;
  /** P2-11（中断审查）：评审确认已重开——陈旧「已确认/已锁定」态据此重拉解锁 */
  onScoringReopened?: (d: ScoringReopenedPayload) => void;
  /** B2（2026-11-12）：过半废标复议召集——定向推组长，载荷含逐票理由 */
  onLeadReviewSuggested?: (d: LeadReviewSuggestedPayload) => void;
  /** B3（2026-11-12）：动议已发起——全员提醒投票 */
  onMotionCreated?: (d: MotionCreatedPayload) => void;
  /** TAB-SYNC-02 P2-2：配对已吊销（桌面自解绑/主持端远程解绑广播；服务端 bid.gateway
   *  字面量 'pairing:revoked'——事件名不进 @water-erp/shared（共享包避让），两端常量交叉注释互指） */
  onPairingRevoked?: (d: { projectId: string; expertId: string }) => void;
  /** TAB-SYNC-02 P2-3：配对在线态翻转（'pairing:presence'——平板 scoped 连接建立/断开） */
  onPairingPresence?: (d: { projectId: string; expertId: string; online: boolean }) => void;
}

export function useExpertWebSocket(projectId: string | undefined, handlers: Handlers) {
  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const manualClose = useRef(false);
  const joinFailStreak = useRef(0); // 连续几次连接都没能入会（重连会重置 attempt，须单独计数）
  const joinedSockets = useRef(new WeakSet<Socket>()); // 入会成功过的连接——断开的是「连上却从未入会」的连接才记一次失败
  // G1: 首次连接 vs 重连鉴别
  const hasConnectedOnce = useRef(false);
  handlersRef.current = handlers;

  /** 绑定业务事件处理（通过 ref key-based 避免闭包过期，与 bid-portal 对齐） */
  function bindBusinessEvents(socket: Socket) {
    const on = <T,>(ev: string, key: keyof Handlers) => {
      socket.on(ev, (d: T) => {
        const fn = handlersRef.current[key] as ((d: T) => void) | undefined;
        if (fn) { setLastEventAt(Date.now()); fn(d); }
      });
    };
    on(BID_EVENT.EXPERT_PRESENCE_AGGREGATE, 'onAggregatePresence');
    on(BID_EVENT.EXPERT_PRESENCE, 'onExpertPresence');
    on(BID_EVENT.DECRYPT_STATUS, 'onDecryptStatus');
    on(BID_EVENT.STAGE_CHANGE, 'onStageChange');
    on(BID_EVENT.CLARIFICATION_CREATED, 'onClarificationCreated');
    on(BID_EVENT.CLARIFICATION_REPLIED, 'onClarificationReplied');
    on(BID_EVENT.BID_VALIDITY_CHANGE, 'onBidValidityChange');
    on(BID_EVENT.HALL_MESSAGE_NEW, 'onHallMessage');
    on(BID_EVENT.SCORES_SUBMITTED, 'onScoresSubmitted');
    on(BID_EVENT.DRAFT_SAVED, 'onDraftSaved');
    on(BID_EVENT.EVALUATION_EXTENDED, 'onEvaluationExtended');
    on(BID_EVENT.ROOM_CODE_ROTATED, 'onRoomCodeRotated');
    on(BID_EVENT.SCORING_REOPENED, 'onScoringReopened');
    on(BID_EVENT.LEAD_REVIEW_SUGGESTED, 'onLeadReviewSuggested');
    on(BID_EVENT.MOTION_CREATED, 'onMotionCreated');
    on('pairing:revoked', 'onPairingRevoked');
    on('pairing:presence', 'onPairingPresence');
  }

  const clearHeartbeatTimers = useCallback(() => {
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
    if (pongTimer.current) { clearTimeout(pongTimer.current); pongTimer.current = null; }
  }, []);

  const connect = useCallback(() => {
    if (!projectId || socketRef.current?.connected) return;
    manualClose.current = false;
    setConnection(prev => (prev === 'connected' ? prev : 'reconnecting'));

    const socket = io(bidWsUrl(), { forceNew: true,
      withCredentials: true,
      // 同源反代握手（域名模式 /socket.io/ 经 nginx）无 Origin 头、XHR 轮询加不了
      // X-Portal——自报门户供 tokenFromHandshake 选对 cookie 命名空间（2026-11-09）
      query: { portal: 'expert' },
      reconnection: false,
      timeout: 10000,
    });
    socketRef.current = socket;

    // 入会失败计数在两处结算（connect 里的应答、disconnect 里的断开），共用这一份依赖
    const joinDeps: JoinPolicyDeps = {
      isCurrent: () => socketRef.current === socket && !manualClose.current,
      getFailStreak: () => joinFailStreak.current,
      setFailStreak: (n) => { joinFailStreak.current = n; },
      stopReconnect: () => { manualClose.current = true; },
    };

    socket.on('connect', () => {
      const isReconnect = hasConnectedOnce.current;
      hasConnectedOnce.current = true;
      attemptRef.current = 0;
      setConnection('connected');
      // 入会带应答（2026-11-25）：握手鉴权是异步的，入会申请偶尔比它先到，服务端回 UNAUTHORIZED，稍后重发即可；
      // 重试耗尽则断开走既有重连，连续 3 次入会失败停止自动重连（失败也在 disconnect 里结算，见下）。
      void joinProjectOnConnect(socket, projectId, joinDeps).then((joined) => { if (joined) joinedSockets.current.add(socket); });
      if (isReconnect) handlersRef.current.onReconnected?.();

      // Heartbeat: ping every 20s, expect pong within 10s
      heartbeatTimer.current = setInterval(() => {
        const now = Date.now();
        socket.emit('ping', now);
        if (pongTimer.current) clearTimeout(pongTimer.current);
        pongTimer.current = setTimeout(() => { socket.disconnect(); }, 10000);
      }, 20000);
    });

    socket.on('pong', () => { if (pongTimer.current) clearTimeout(pongTimer.current); });

    const scheduleReconnect = () => {
      if (manualClose.current || !projectId) return;
      const delays = [1000, 2000, 5000, 10000];
      attemptRef.current = Math.min(attemptRef.current + 1, 10);
      const delay = delays[Math.min(attemptRef.current - 1, delays.length - 1)];
      setConnection('reconnecting');
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(() => {
        if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
        connect();
      }, delay);
    };

    socket.on('disconnect', (reason: string) => {
      clearHeartbeatTimers();
      setConnection('disconnected');
      // 会话真正失效（被顶、登出、冻结）时服务端在握手鉴权里直接断开、不给入会应答——应答那条路看不到这次失败，
      // 在这里记一次，同样连续 3 次停止自动重连（2026-11-26 审查 I-1）
      onDisconnectedBeforeJoin(joinedSockets.current.has(socket), reason, joinDeps);
      socketRef.current = null;
      if (manualClose.current) return;
      scheduleReconnect();
    });

    socket.on('connect_error', () => {
      setConnection('disconnected');
      scheduleReconnect();
    });

    // 绑定业务事件。每次 connect() 调用都会创建全新的 socket 实例，
    // 因此旧 socket 实例在 disconnect() 后会被 GC 回收，其上绑定的监听器也随之释放，
    // 不存在"重复绑定旧事件监听器"的问题。
    bindBusinessEvents(socket);
  }, [projectId]);

  const reconnectNow = useCallback(() => {
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
    clearHeartbeatTimers();
    attemptRef.current = 0;
    joinFailStreak.current = 0;
    connect();
  }, [connect, clearHeartbeatTimers]);

  useEffect(() => {
    if (!projectId) return;
    // 重新订阅（换项目等）：入会失败计数从头记（2026-11-26 审查 M-4）——与 web / bid 版对齐
    joinFailStreak.current = 0;
    connect();
    return () => {
      manualClose.current = true;
      clearHeartbeatTimers();
      if (socketRef.current) {
        socketRef.current.emit('leave:project', projectId);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [projectId, connect, clearHeartbeatTimers]);

  return { connection, lastEventAt, reconnectNow };
}
