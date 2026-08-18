<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import { bidApi } from '@/api/bid'
import { openingHallApi } from '@/api/openingHall'
import { useBidWebSocket } from '@/composables/useBidWebSocket'
import { useAuthStore } from '@/stores/auth'
import { User } from '@element-plus/icons-vue'
import ChatPanel from '@/components/bid/ChatPanel.vue'

const route = useRoute()
const authStore = useAuthStore()
const projectId = route.params.projectId as string

const project = ref<any>(null)
const record = ref<any>(null)
const records = ref<any[]>([])
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

/** 投递报价显示文本：有唱标锚点时归一为元（与唱标总表「报价（元）」单位统一）；
 *  未唱标回落投递表单口径（<10000 万元、≥10000 元，见 BidSubmit.vue formatBidPrice） */
const submittedPriceText = computed(() => {
  const s = record.value?.submitted
  if (!s?.bidPrice) return '—'
  if (s.bidPriceInYuan != null) return `${s.bidPriceInYuan} 元`
  const n = Number(s.bidPrice)
  if (!Number.isFinite(n)) return '—'
  return n >= 10000 ? `${s.bidPrice} 元` : `${s.bidPrice} 万元`
})

async function refresh() {
  // supplier-portal 的 axios 拦截器已解包 response.data（src/api/index.ts），返回值即响应体
  try {
    const [p, r, list] = await Promise.all([
      bidApi.getProject(projectId),
      supplierApi.getOpeningRecord(projectId).catch(() => null),
      // 开标前端点返回 400 OPENING_NOT_STARTED——捕获后置空列表，页面不报错
      supplierApi.getOpeningRecords(projectId).catch(() => null),
    ])
    project.value = p
    record.value = r
    records.value = list ?? []
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
            <span class="name">{{ project?.name || '加载中…' }}</span>
            <div class="meta">
              <!-- 在线数：图标 + 等宽数字，左对齐（开标阶段状态由签到按钮/阶段提示条/聊天禁言条表达，不再单设徽标） -->
              <span class="presence">
                <el-icon :size="14"><User /></el-icon>
                在线 <b class="num">{{ onlineCount }}</b> 家
              </span>
            </div>
          </div>
        </template>

        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="本司解密状态">{{ decryptStatus || record?.decryptResult || '—' }}</el-descriptions-item>
          <el-descriptions-item label="唱标金额">{{ record?.amount != null ? `${record.amount} 元` : '—' }}</el-descriptions-item>
          <el-descriptions-item label="投递报价">
            <span :class="{ 'mismatch': record?.submitted?.priceMismatch }">{{ submittedPriceText }}</span>
            <el-tag v-if="record?.submitted?.priceMismatch" size="small" type="warning" effect="plain">与唱标不一致</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="工期（唱标）">{{ record?.period || '—' }}</el-descriptions-item>
          <el-descriptions-item label="工期（投递）">
            <span :class="{ 'mismatch': record?.submitted?.periodMismatch }">{{ record?.submitted?.deliveryPeriod || '—' }}</span>
            <el-tag v-if="record?.submitted?.periodMismatch" size="small" type="warning" effect="plain">与唱标不一致</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="质量承诺（唱标）">{{ record?.qualityTarget || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="record?.submitted?.qualityCommitment" label="质量承诺（投递）">
            <span :class="{ 'mismatch': record.qualityTarget != null && record.qualityTarget !== record.submitted.qualityCommitment }">{{ record.submitted.qualityCommitment }}</span>
          </el-descriptions-item>
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

      <!-- 唱标记录总表：自开标起向本项目全体投标人公开（《电子招标投标办法》第30条），
           WS opening:record:updated → refresh() 实时更新；本司行按 bidSupplierId 高亮 -->
      <el-card shadow="never" class="records-card">
        <template #header>
          <div class="records-head">
            <span class="records-title">唱标记录（全部投标人）</span>
            <span class="records-count">{{ records.length }} 条</span>
          </div>
        </template>
        <el-table :data="records" size="small" empty-text="暂无唱标记录（开标后实时展示）">
          <el-table-column label="供应商" min-width="180" class-name="col-supplier">
            <template #default="{ row }">
              <span>{{ row.supplierName }}</span>
              <el-tag v-if="row.bidSupplierId === record?.bidSupplierId" size="small" type="info" class="self-tag">本司</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="amount" label="报价（元）" min-width="110" />
          <el-table-column prop="period" label="工期" min-width="100" />
          <el-table-column prop="qualityTarget" label="质量目标" min-width="110" />
          <el-table-column prop="bondStatus" label="保证金" min-width="90" />
          <el-table-column prop="confirmStatus" label="状态" min-width="110" />
        </el-table>
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
.left { display: flex; flex-direction: column; }
.hall { display: grid; grid-template-columns: minmax(360px, 1fr) minmax(380px, 1.2fr); gap: 16px; }
.hall-error { grid-column: 1 / -1; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.name { font-weight: 700; line-height: 1.4; flex: 1; min-width: 0; }
.meta { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
/* 在场徽标：绿色浅底 hairline 药丸（徽标不用新拟态阴影，见 .impeccable.md 反模式），左对齐 */
.presence { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; background: #f0f9eb; border: 1px solid #e1f3d8; color: #529b2e; font-size: 12px; font-weight: 600; }
.presence .num { color: #529b2e; font-weight: 800; font-variant-numeric: tabular-nums; }
.actions { margin-top: 16px; display: flex; gap: 8px; align-items: center; }
.records-card { margin-top: 16px; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.records-card :deep(.el-card__header) { flex-shrink: 0; }
.records-card :deep(.el-card__body) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.records-card :deep(.el-table) { flex: 1; }
.records-head { display: flex; align-items: center; justify-content: space-between; }
.records-title { font-weight: 600; }
.records-count { color: #909399; font-size: 12px; font-variant-numeric: tabular-nums; }
.self-tag { margin-left: 6px; }
/* 供应商名称列允许换行（el-table 单元格默认 nowrap 截断，改用整列换行而非 tooltip） */
.records-card :deep(.col-supplier .cell) { white-space: normal; word-break: break-all; line-height: 1.5; }
.stage-hint { margin-top: 8px; color: #909399; font-size: 12px; }
.empty { padding: 40px; text-align: center; color: #999; }
.mismatch { color: #e6a23c; font-weight: 600; }
@media (max-width: 960px) { .hall { grid-template-columns: 1fr; } }
/* 桌面端：网格撑满内容区高度，左右两列同高——右列聊天面板与左列唱标总表卡均延伸至页面底部（底边对齐） */
@media (min-width: 961px) {
  .hall { height: 100%; }
}
</style>
