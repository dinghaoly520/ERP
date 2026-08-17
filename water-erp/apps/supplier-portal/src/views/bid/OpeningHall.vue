<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import { bidApi } from '@/api/bid'
import { openingHallApi } from '@/api/openingHall'
import { useBidWebSocket } from '@/composables/useBidWebSocket'
import { useAuthStore } from '@/stores/auth'
import ChatPanel from '@/components/bid/ChatPanel.vue'

const route = useRoute()
const authStore = useAuthStore()
const projectId = route.params.projectId as string

const project = ref<any>(null)
const record = ref<any>(null)
const checkedInAt = ref<string | null>(null)
const onlineCount = ref(0)
const decryptStatus = ref<string>('')
const stage = computed<string>(() => project.value?.stage ?? '')
const isOpening = computed(() => stage.value === 'OPENING')
const supplierId = ref('')
const supplierName = ref('')
const loadError = ref(false)
const loadErrorMsg = ref('')
const profileError = ref(false)
const bootstrapping = ref(false)

async function refresh() {
  // supplier-portal 的 axios 拦截器已解包 response.data（src/api/index.ts），返回值即响应体
  try {
    const [p, r] = await Promise.all([
      bidApi.getProject(projectId),
      supplierApi.getOpeningRecord(projectId).catch(() => null),
    ])
    project.value = p
    record.value = r
    loadError.value = false
  } catch (e: any) {
    // 失败保留上次成功数据，仅置标志；首屏（project 为空）时由错误态 + 重试展示
    loadError.value = true
    loadErrorMsg.value = e?.response?.data?.error || e?.message || '加载开标大厅数据失败'
  }
}

async function loadProfile() {
  try {
    const profile = await supplierApi.getProfile()
    supplierId.value = profile?.id ?? ''
    supplierName.value = profile?.name ?? ''
    profileError.value = !supplierId.value
  } catch {
    profileError.value = true
  }
}

async function retryProfile() {
  profileError.value = false
  await loadProfile()
  if (profileError.value) ElMessage.error('加载供应商信息失败，会话暂不可用')
}

/** 首屏加载逻辑：挂载与"重试"共用 */
async function bootstrap() {
  bootstrapping.value = true
  await Promise.all([loadProfile(), refresh(), loadPresence()])
  bootstrapping.value = false
  if (loadError.value && !project.value) ElMessage.error(loadErrorMsg.value)
}

async function loadPresence() {
  const res = await openingHallApi.presence(projectId).catch(() => null)
  if (res) onlineCount.value = res.onlineCount ?? 0
}

async function checkIn() {
  try {
    const res = await openingHallApi.checkIn(projectId)
    checkedInAt.value = res.checkInAt
    ElMessage.success('签到成功')
  } catch {
    // U5：业务错误消息已由 axios 拦截器统一弹出（data.error），此处不重复提示
  }
}

async function confirmRecord() {
  try {
    await ElMessageBox.confirm('确认开标记录（唱标信息）无误？', '确认开标记录', { type: 'info' })
    await supplierApi.confirmOpening(projectId)
    ElMessage.success('已确认开标记录')
    await refresh()
  } catch (e: any) {
    // ElMessageBox：取消按钮 reject 'cancel'，ESC/X 关闭 reject 'close'——都属用户关闭，静默
    if (e === 'cancel' || e === 'close' || e?.toString?.().includes('cancel') || e?.toString?.().includes('close')) return
    // U5：其余业务错误消息已由 axios 拦截器统一弹出（data.error），此处不重复提示
  }
}

async function disputeRecord() {
  try {
    const { value } = await ElMessageBox.prompt('请输入异议原因', '提出开标异议', {
      inputType: 'textarea',
      inputValidator: (v: string) => (v?.trim() ? true : '请填写异议原因'),
    })
    await supplierApi.disputeOpening(projectId, value)
    ElMessage.success('异议已提交，请等待主持人处理')
    await refresh()
  } catch (e: any) {
    if (e === 'cancel' || e === 'close' || e?.toString?.().includes('cancel') || e?.toString?.().includes('close')) return
    // U5：其余业务错误消息已由 axios 拦截器统一弹出（data.error），此处不重复提示
  }
}

useBidWebSocket(projectId, {
  // refresh 内部已 try/catch（失败置标志、保留上次数据），.catch 仅作兜底，避免 unhandled rejection
  onStageChange: () => { refresh().catch(() => {}) },
  onDecryptStatus: d => { if (d.supplierId === supplierId.value) decryptStatus.value = d.decryptStatus },
  onHallPresence: d => { onlineCount.value = d.onlineCount },
  onOpeningDisputeResolved: d => {
    ElMessage.info(d.confirm ? `异议已处理（确认）：${d.result}` : `异议已处理（退回）：${d.result}`)
    refresh().catch(() => {})
  },
  // 唱标录入/更新 → 实时刷新开标记录（此前无此事件，唱标后供应商页不更新，只能手动刷新）
  onOpeningRecordUpdated: () => { refresh().catch(() => {}) },
})

onMounted(bootstrap)
</script>

<template>
  <div class="hall">
    <!-- 首屏加载失败（尚无项目数据）：错误态 + 重试 -->
    <el-empty v-if="loadError && !project" class="hall-error" :description="loadErrorMsg || '加载开标大厅数据失败'">
      <el-button type="primary" :loading="bootstrapping" @click="bootstrap">重试</el-button>
    </el-empty>
    <template v-else>
    <div class="left">
      <el-card shadow="never">
        <template #header>
          <div class="head">
            <span>{{ project?.name || '加载中…' }}</span>
            <el-tag v-if="isOpening" type="success">开标进行中</el-tag>
            <el-tag v-else-if="stage">阶段：{{ stage }}</el-tag>
            <span class="online">在线 {{ onlineCount }} 家</span>
          </div>
        </template>

        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="本司解密状态">{{ decryptStatus || record?.decryptResult || '—' }}</el-descriptions-item>
          <el-descriptions-item label="唱标金额">{{ record?.amount || '—' }}</el-descriptions-item>
          <el-descriptions-item label="工期">{{ record?.period || '—' }}</el-descriptions-item>
          <el-descriptions-item label="开标记录状态">{{ record?.confirmStatus || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="record?.handleResult" label="异议处理结果">{{ record.handleResult }}</el-descriptions-item>
        </el-descriptions>

        <div class="actions">
          <el-button v-if="isOpening && !checkedInAt" type="primary" @click="checkIn">签到</el-button>
          <el-tag v-else-if="checkedInAt" type="info">已签到 {{ new Date(checkedInAt).toLocaleTimeString('zh-CN') }}</el-tag>
          <!-- 后端/种子数据实际写入 '待供应商确认'（bid.service.ts:913），旧页兼容 '待确认'，两者都接受 -->
          <template v-if="isOpening && record && (record.confirmStatus === '待确认' || record.confirmStatus === '待供应商确认')">
            <el-button type="success" @click="confirmRecord">确认开标记录</el-button>
            <el-button type="warning" @click="disputeRecord">提出异议</el-button>
          </template>
        </div>
        <div v-if="!isOpening && stage" class="stage-hint">大厅互动仅在开标阶段开放。</div>
      </el-card>
    </div>

    <div class="right">
      <!-- U3：userId 取 auth store 的 User.id（消息 senderId = actor.userId，非 Supplier.id） -->
      <ChatPanel v-if="supplierId" :project-id="projectId" :supplier-id="supplierId" :supplier-name="supplierName" :user-id="authStore.user?.id ?? ''" />
      <el-card v-else-if="profileError" shadow="never">
        <el-empty description="会话加载失败" :image-size="64">
          <el-button size="small" type="primary" @click="retryProfile">重试</el-button>
        </el-empty>
      </el-card>
      <el-card v-else shadow="never"><div class="empty">加载供应商信息中…</div></el-card>
    </div>
    </template>
  </div>
</template>

<style scoped>
.hall { display: grid; grid-template-columns: minmax(360px, 1fr) minmax(380px, 1.2fr); gap: 16px; }
.hall-error { grid-column: 1 / -1; }
.head { display: flex; align-items: center; gap: 12px; }
.online { margin-left: auto; color: #909399; font-size: 12px; }
.actions { margin-top: 16px; display: flex; gap: 8px; align-items: center; }
.stage-hint { margin-top: 8px; color: #909399; font-size: 12px; }
.empty { padding: 40px; text-align: center; color: #999; }
@media (max-width: 960px) { .hall { grid-template-columns: 1fr; } }
</style>
