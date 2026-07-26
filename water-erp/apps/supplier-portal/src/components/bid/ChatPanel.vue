<script setup lang="ts">
import { ref, nextTick, onMounted, computed, watch } from 'vue'
import { openingHallApi } from '@/api/openingHall'
import { useBidWebSocket } from '@/composables/useBidWebSocket'
import type { HallMessagePayload } from '@water-erp/shared'

const props = defineProps<{ projectId: string; supplierId: string; supplierName: string; userId: string }>()

type Msg = { id: string; senderId: string; senderRole: string; senderName: string; content: string; createdAt: string; roomType: string }
const tab = ref<'PUBLIC' | 'PRIVATE'>('PUBLIC')
const publicMsgs = ref<Msg[]>([])
const privateMsgs = ref<Msg[]>([])
const publicUnread = ref(0)
const privateUnread = ref(0)
const input = ref('')
const sending = ref(false)
const exchangeControl = ref<'OPEN' | 'MUTED' | 'CLOSED'>('OPEN')
const stageClosed = ref(false)   // R4：stage:change 离开 OPENING 后关闭互动
const hydrated = ref(false)      // R3：首次加载完成后才在重连时做 REST 补齐
const listEl = ref<HTMLElement | null>(null)

const current = computed(() => (tab.value === 'PUBLIC' ? publicMsgs.value : privateMsgs.value))
const canSend = computed(() => exchangeControl.value === 'OPEN' && !stageClosed.value)
const controlHint = computed(() =>
  stageClosed.value ? '开标阶段已结束，互动已关闭' :
  exchangeControl.value === 'MUTED' ? '主持人已开启全员禁言' :
  exchangeControl.value === 'CLOSED' ? '主持人已关闭互动' : '')

function pushMsg(d: HallMessagePayload) {
  const m: Msg = { id: d.id, senderId: d.senderId, senderRole: d.senderRole, senderName: d.senderName, content: d.content, createdAt: d.createdAt, roomType: d.roomType }
  if (d.roomType === 'PUBLIC') {
    publicMsgs.value.push(m)
    if (tab.value !== 'PUBLIC') publicUnread.value++
  } else if (d.supplierId === props.supplierId) {
    privateMsgs.value.push(m)
    if (tab.value !== 'PRIVATE') privateUnread.value++
  }
  void nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight })
}

const { connection, reconnectNow } = useBidWebSocket(props.projectId, {
  onHallMessage: pushMsg,
  onHallExchangeControl: d => { exchangeControl.value = d.control },
  // R4：阶段离开 OPENING → 关闭输入（大厅互动仅在开标阶段开放）
  onStageChange: d => { if (d.to && d.to !== 'OPENING') stageClosed.value = true },
})

/** 返回本次 REST 页的最后一条消息 id（items 按时序升序），供 markRead 上报游标 */
async function loadHistory(room: 'PUBLIC' | 'PRIVATE'): Promise<string | undefined> {
  // supplier-portal 的 axios 拦截器已解包 response.data（src/api/index.ts），返回值即响应体
  const res = await openingHallApi.messages(props.projectId, { roomType: room, supplierId: room === 'PRIVATE' ? props.supplierId : undefined, limit: 100 })
  const items: Msg[] = (res.items || []).map((m: any) => ({ id: m.id, senderId: m.senderId, senderRole: m.senderRole, senderName: m.senderName, content: m.content, createdAt: m.createdAt, roomType: m.roomType }))
  // 与在途 socket 增量合并（按 id 去重），避免整体赋值覆盖先到的实时消息。
  // Wave 5-5：fresh 只保留比服务端窗口最新一条还新的本地消息（真在途增量）——消息超 100 条
  // 重开面板时，窗口外的旧残留若一律追加尾部会造成尾部乱序且永不消除，故丢弃
  const target = room === 'PUBLIC' ? publicMsgs : privateMsgs
  const maxIso = items[items.length - 1]?.createdAt
  const fresh = target.value.filter(m => !items.some(i => i.id === m.id) && (!maxIso || m.createdAt > maxIso))
  target.value = [...items, ...fresh]
  void nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight })
  return items[items.length - 1]?.id
}

async function loadUnread() {
  const res = await openingHallApi.unread(props.projectId)
  publicUnread.value = res.public ?? 0
  privateUnread.value = res.private ?? 0
}

/** 首屏挂载与 R3 重连补齐共用：重拉双聊天历史 + 未读，再对当前 tab 即时 markRead */
async function hydrate() {
  const [pub, priv] = await Promise.allSettled([loadHistory('PUBLIC'), loadHistory('PRIVATE')])
  await loadUnread().catch(() => {})
  hydrated.value = true
  // U2：默认停留 PUBLIC——未读即时清零，游标定在已加载末条（避免在途消息被 now() 误判已读）
  if (tab.value === 'PUBLIC') {
    publicUnread.value = 0
    await openingHallApi.markRead(props.projectId, 'public', pub.status === 'fulfilled' ? pub.value : undefined).catch(() => {})
  } else {
    privateUnread.value = 0
    await openingHallApi.markRead(props.projectId, `supplier:${props.supplierId}`, priv.status === 'fulfilled' ? priv.value : undefined).catch(() => {})
  }
}

// R3：重连成功且已首次加载过 → 重跑 hydrate 补齐断线窗口（按 id 合并保留在途增量）
watch(connection, c => { if (c === 'connected' && hydrated.value) void hydrate() })

async function switchTab(t: 'PUBLIC' | 'PRIVATE') {
  tab.value = t
  if (t === 'PUBLIC') {
    publicUnread.value = 0
    await openingHallApi.markRead(props.projectId, 'public', publicMsgs.value[publicMsgs.value.length - 1]?.id).catch(() => {})
  } else {
    privateUnread.value = 0
    await openingHallApi.markRead(props.projectId, `supplier:${props.supplierId}`, privateMsgs.value[privateMsgs.value.length - 1]?.id).catch(() => {})
  }
}

async function send() {
  const content = input.value.trim()
  if (!content || sending.value) return
  sending.value = true
  try {
    await openingHallApi.send(props.projectId, {
      roomType: tab.value,
      supplierId: tab.value === 'PRIVATE' ? props.supplierId : undefined,
      content,
    })
    input.value = ''
  } catch {
    // U5：业务错误消息已由 axios 拦截器统一弹出（data.error），此处不重复提示
  } finally {
    sending.value = false
  }
}

// 中文输入法组合期（isComposing / keyCode 229）的 Enter 是选词确认，不发送
function onEnter(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  send()
}

onMounted(() => { void hydrate() })
</script>

<template>
  <el-card shadow="never" class="chat-panel">
    <template #header>
      <div class="tabs">
        <el-badge :value="publicUnread" :hidden="publicUnread === 0" :max="99">
          <el-button :type="tab === 'PUBLIC' ? 'primary' : 'default'" size="small" @click="switchTab('PUBLIC')">大厅公聊</el-button>
        </el-badge>
        <el-badge :value="privateUnread" :hidden="privateUnread === 0" :max="99">
          <el-button :type="tab === 'PRIVATE' ? 'primary' : 'default'" size="small" @click="switchTab('PRIVATE')">与主持人私聊</el-button>
        </el-badge>
        <!-- R10：连接态徽标；断开时给手动重连入口 -->
        <span class="conn" :class="`conn-${connection}`">
          <span class="conn-dot" />
          {{ connection === 'connected' ? '实时已连' : connection === 'reconnecting' ? '重连中…' : '已断开' }}
          <el-button v-if="connection === 'disconnected'" link size="small" type="primary" @click="reconnectNow">重连</el-button>
        </span>
      </div>
    </template>

    <div ref="listEl" class="msg-list">
      <div v-if="current.length === 0" class="empty">暂无消息</div>
      <!-- U3：按 senderId 判"我发的"——senderRole 会让公聊里其他供应商的消息也显示成己方气泡 -->
      <div v-for="m in current" :key="m.id" class="msg" :class="{ mine: m.senderId === userId, system: m.senderRole === 'SYSTEM' }">
        <div class="meta">{{ m.senderName }} · {{ new Date(m.createdAt).toLocaleTimeString('zh-CN') }}</div>
        <div class="body">{{ m.content }}</div>
      </div>
    </div>

    <div v-if="!canSend" class="muted-hint">{{ controlHint }}</div>
    <div class="input-row">
      <!-- keydown 而非 keyup：Chromium 中 compositionend 先于 keyup 触发，keyup 时 isComposing 已为 false，守卫失效 -->
      <el-input v-model="input" :disabled="!canSend" maxlength="2000" placeholder="输入消息（Enter 发送）" @keydown.enter="onEnter" />
      <el-button type="primary" :disabled="!canSend || !input.trim()" :loading="sending" @click="send">发送</el-button>
    </div>
  </el-card>
</template>

<style scoped>
.chat-panel { display: flex; flex-direction: column; height: 100%; }
.tabs { display: flex; gap: 12px; align-items: center; }
.conn { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #909399; }
.conn-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.conn-connected { color: #67c23a; }
.conn-reconnecting { color: #e6a23c; }
.conn-disconnected { color: #f56c6c; }
.msg-list { flex: 1; overflow-y: auto; min-height: 320px; max-height: 480px; padding: 4px 0; }
.empty { color: #999; text-align: center; padding: 40px 0; }
.msg { margin: 8px 0; padding: 8px 12px; border-radius: 8px; background: #f5f7fa; }
.msg.mine { background: #ecf5ff; }
.msg.system { background: transparent; text-align: center; color: #909399; font-size: 12px; }
.meta { font-size: 12px; color: #909399; margin-bottom: 2px; }
.body { white-space: pre-wrap; word-break: break-all; }
.muted-hint { color: #e6a23c; font-size: 12px; padding: 4px 0; }
.input-row { display: flex; gap: 8px; margin-top: 8px; }
</style>
