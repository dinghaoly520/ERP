import { ref, watch, onBeforeUnmount, type Ref } from 'vue'
import { io, type Socket } from 'socket.io-client'
import { portalURL } from '@water-erp/config'
import {
  BID_EVENT,
  type ConnectionState,
  type DecryptStatusPayload,
  type StageChangePayload,
  type HallMessagePayload,
  type HallPresenceUpdatePayload,
  type HallCheckinPayload,
  type HallExchangeControlPayload,
  type OpeningDisputeResolvedPayload,
} from '@water-erp/shared'

export interface BidWsHandlers {
  onDecryptStatus?: (d: DecryptStatusPayload) => void
  onStageChange?: (d: StageChangePayload) => void
  onHallMessage?: (d: HallMessagePayload) => void
  onHallPresence?: (d: HallPresenceUpdatePayload) => void
  onHallCheckin?: (d: HallCheckinPayload) => void
  onHallExchangeControl?: (d: HallExchangeControlPayload) => void
  onOpeningDisputeResolved?: (d: OpeningDisputeResolvedPayload) => void
}

function wsUrl(): string {
  const env = (import.meta as any).env?.VITE_WS_URL as string | undefined
  return env || portalURL('api', '/bid')
}

/**
 * /bid 命名空间的供应商端 socket 工程。
 * 移植自 bid-portal use-bid-websocket.ts：重连退避 [1s,2s,5s,10s]、
 * 20s ping/10s pong 心跳、页面不可见时断开省电。
 */
export function useBidWebSocket(
  projectId: Ref<string | undefined> | string | undefined,
  handlers: BidWsHandlers,
) {
  const connection = ref<ConnectionState>('disconnected')
  const lastEventAt = ref<number | null>(null)

  let socket: Socket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let pongTimer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let manualClose = false
  // R9：holder 间接层——listener 在每次事件到达时解引用 holder.current，
  // 组件每渲染 setHandlers 即可换上最新闭包（一次性捕获会丢后续渲染的 handler）
  const holder = { current: handlers }

  const pid = () => (typeof projectId === 'string' ? projectId : projectId?.value)

  function clearTimers() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
    if (pongTimer) { clearTimeout(pongTimer); pongTimer = null }
  }

  function connect() {
    const id = pid()
    if (!id || socket?.connected) return
    manualClose = false
    connection.value = connection.value === 'connected' ? connection.value : 'reconnecting'

    const s = io(wsUrl(), { withCredentials: true, reconnection: false, timeout: 10000 })
    socket = s

    s.on('connect', () => {
      attempt = 0
      connection.value = 'connected'
      s.emit('join:project', id)
      heartbeatTimer = setInterval(() => {
        s.emit('ping', Date.now())
        if (pongTimer) clearTimeout(pongTimer)
        pongTimer = setTimeout(() => s.disconnect(), 10000)
      }, 20000)
    })

    s.on('pong', () => { if (pongTimer) clearTimeout(pongTimer) })

    const scheduleReconnect = () => {
      if (manualClose || !pid()) return
      const delays = [1000, 2000, 5000, 10000]
      attempt = Math.min(attempt + 1, 10)
      const delay = delays[Math.min(attempt - 1, delays.length - 1)]
      connection.value = 'reconnecting'
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => {
        if (socket) { socket.disconnect(); socket = null }
        connect()
      }, delay)
    }

    s.on('disconnect', () => {
      clearTimers()
      connection.value = 'disconnected'
      socket = null
      if (!manualClose) scheduleReconnect()
    })
    s.on('connect_error', () => { connection.value = 'disconnected'; scheduleReconnect() })

    // listener 内按 key 延迟解引用：事件到达时取 holder.current 上的最新 handler
    const on = <T,>(ev: string, key: keyof BidWsHandlers) => {
      s.on(ev, (d: T) => {
        const fn = holder.current[key] as ((d: T) => void) | undefined
        if (fn) { lastEventAt.value = Date.now(); fn(d) }
      })
    }
    on(BID_EVENT.DECRYPT_STATUS, 'onDecryptStatus')
    on(BID_EVENT.STAGE_CHANGE, 'onStageChange')
    on(BID_EVENT.HALL_MESSAGE_NEW, 'onHallMessage')
    on(BID_EVENT.HALL_PRESENCE_UPDATE, 'onHallPresence')
    on(BID_EVENT.HALL_CHECKIN, 'onHallCheckin')
    on(BID_EVENT.HALL_EXCHANGE_CONTROL, 'onHallExchangeControl')
    on(BID_EVENT.OPENING_DISPUTE_RESOLVED, 'onOpeningDisputeResolved')
  }

  function reconnectNow() {
    if (socket) { socket.disconnect(); socket = null }
    clearTimers()
    attempt = 0
    connect()
  }

  function teardown() {
    manualClose = true
    clearTimers()
    if (socket) {
      const id = pid()
      if (id) socket.emit('leave:project', id)
      socket.disconnect()
      socket = null
    }
    connection.value = 'disconnected'
  }

  const onVisibility = () => {
    if (!pid()) return
    if (document.hidden) teardown()
    else connect()
  }

  connect()
  document.addEventListener('visibilitychange', onVisibility)
  if (projectId && typeof projectId !== 'string') {
    watch(projectId, () => { teardown(); manualClose = false; connect() })
  }
  onBeforeUnmount(() => {
    teardown()
    document.removeEventListener('visibilitychange', onVisibility)
  })

  /** R9：handler 闭包了可变 state 的组件可每渲染调用，替换 holder 内引用 */
  function setHandlers(h: BidWsHandlers) { holder.current = h }

  return { connection, lastEventAt, reconnectNow, setHandlers }
}
