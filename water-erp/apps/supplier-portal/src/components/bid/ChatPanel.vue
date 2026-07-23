<script setup lang="ts">
import { ref, reactive, nextTick, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { openingHallApi } from '@/api/openingHall'
import { useBidWebSocket } from '@/composables/useBidWebSocket'
import type { HallMessagePayload } from '@water-erp/shared'

const props = defineProps<{ projectId: string; supplierId: string; supplierName: string }>()

type Msg = { id: string; senderRole: string; senderName: string; content: string; createdAt: string; roomType: string }
const tab = ref<'PUBLIC' | 'PRIVATE'>('PUBLIC')
const publicMsgs = ref<Msg[]>([])
const privateMsgs = ref<Msg[]>([])
const publicUnread = ref(0)
const privateUnread = ref(0)
const input = ref('')
const sending = ref(false)
const exchangeControl = ref<'OPEN' | 'MUTED' | 'CLOSED'>('OPEN')
const listEl = ref<HTMLElement | null>(null)

const current = computed(() => (tab.value === 'PUBLIC' ? publicMsgs : privateMsgs))
const canSend = computed(() => exchangeControl.value === 'OPEN')
const controlHint = computed(() =>
  exchangeControl.value === 'MUTED' ? '主持人已开启全员禁言' :
  exchangeControl.value === 'CLOSED' ? '主持人已关闭互动' : '')

function pushMsg(d: HallMessagePayload) {
  const m: Msg = { id: d.id, senderRole: d.senderRole, senderName: d.senderName, content: d.content, createdAt: d.createdAt, roomType: d.roomType }
  if (d.roomType === 'PUBLIC') {
    publicMsgs.value.push(m)
    if (tab.value !== 'PUBLIC') publicUnread.value++
  } else if (d.supplierId === props.supplierId) {
    privateMsgs.value.push(m)
    if (tab.value !== 'PRIVATE') privateUnread.value++
  }
  void nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight })
}

useBidWebSocket(props.projectId, {
  onHallMessage: pushMsg,
  onHallExchangeControl: d => { exchangeControl.value = d.control },
})

async function loadHistory(room: 'PUBLIC' | 'PRIVATE') {
  // supplier-portal 的 axios 拦截器已解包 response.data（src/api/index.ts），返回值即响应体
  const res = await openingHallApi.messages(props.projectId, { roomType: room, supplierId: room === 'PRIVATE' ? props.supplierId : undefined, limit: 100 })
  const items: Msg[] = (res.items || []).map((m: any) => ({ id: m.id, senderRole: m.senderRole, senderName: m.senderName, content: m.content, createdAt: m.createdAt, roomType: m.roomType }))
  if (room === 'PUBLIC') publicMsgs.value = items
  else privateMsgs.value = items
  void nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight })
}

async function loadUnread() {
  const res = await openingHallApi.unread(props.projectId)
  publicUnread.value = res.public ?? 0
  privateUnread.value = res.private ?? 0
}

async function switchTab(t: 'PUBLIC' | 'PRIVATE') {
  tab.value = t
  if (t === 'PUBLIC') { publicUnread.value = 0; await openingHallApi.markRead(props.projectId, 'public').catch(() => {}) }
  else { privateUnread.value = 0; await openingHallApi.markRead(props.projectId, `supplier:${props.supplierId}`).catch(() => {}) }
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
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '发送失败，请重试')
  } finally {
    sending.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadHistory('PUBLIC'), loadHistory('PRIVATE'), loadUnread()])
})
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
      </div>
    </template>

    <div ref="listEl" class="msg-list">
      <div v-if="current.length === 0" class="empty">暂无消息</div>
      <div v-for="m in current" :key="m.id" class="msg" :class="{ mine: m.senderRole === 'SUPPLIER', system: m.senderRole === 'SYSTEM' }">
        <div class="meta">{{ m.senderName }} · {{ new Date(m.createdAt).toLocaleTimeString('zh-CN') }}</div>
        <div class="body">{{ m.content }}</div>
      </div>
    </div>

    <div v-if="!canSend" class="muted-hint">{{ controlHint }}</div>
    <div class="input-row">
      <el-input v-model="input" :disabled="!canSend" maxlength="2000" placeholder="输入消息（Enter 发送）" @keyup.enter="send" />
      <el-button type="primary" :disabled="!canSend || !input.trim()" :loading="sending" @click="send">发送</el-button>
    </div>
  </el-card>
</template>

<style scoped>
.chat-panel { display: flex; flex-direction: column; height: 100%; }
.tabs { display: flex; gap: 12px; }
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
