<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import { bidApi } from '@/api/bid'
import { openingHallApi } from '@/api/openingHall'
import { useBidWebSocket } from '@/composables/useBidWebSocket'
import ChatPanel from '@/components/bid/ChatPanel.vue'

const route = useRoute()
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

async function refresh() {
  // supplier-portal 的 axios 拦截器已解包 response.data（src/api/index.ts），返回值即响应体
  const [p, r] = await Promise.all([
    bidApi.getProject(projectId),
    supplierApi.getOpeningRecord(projectId).catch(() => null),
  ])
  project.value = p
  record.value = r
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
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '签到失败')
  }
}

async function confirmRecord() {
  try {
    await ElMessageBox.confirm('确认开标记录（唱标信息）无误？', '确认开标记录', { type: 'info' })
    await supplierApi.confirmOpening(projectId)
    ElMessage.success('已确认开标记录')
    await refresh()
  } catch (e: any) {
    // ElMessageBox：取消按钮 reject 'cancel'，ESC/X 关闭 reject 'close'——都属用户关闭，不报错
    if (e === 'cancel' || e === 'close' || e?.toString?.().includes('cancel') || e?.toString?.().includes('close')) return
    ElMessage.error(e?.response?.data?.error || '确认失败')
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
    ElMessage.error(e?.response?.data?.error || '提交失败')
  }
}

useBidWebSocket(projectId, {
  onStageChange: () => refresh(),
  onDecryptStatus: d => { if (d.supplierId === supplierId.value) decryptStatus.value = d.decryptStatus },
  onHallPresence: d => { onlineCount.value = d.onlineCount },
  onOpeningDisputeResolved: d => {
    ElMessage.info(d.confirm ? `异议已处理（确认）：${d.result}` : `异议已处理（退回）：${d.result}`)
    refresh()
  },
})

onMounted(async () => {
  const profile = await supplierApi.getProfile().catch(() => null)
  supplierId.value = profile?.id ?? ''
  supplierName.value = profile?.name ?? ''
  await refresh()
  await loadPresence()
})
</script>

<template>
  <div class="hall">
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
      <ChatPanel v-if="supplierId" :project-id="projectId" :supplier-id="supplierId" :supplier-name="supplierName" />
      <el-card v-else shadow="never"><div class="empty">加载供应商信息中…</div></el-card>
    </div>
  </div>
</template>

<style scoped>
.hall { display: grid; grid-template-columns: minmax(360px, 1fr) minmax(380px, 1.2fr); gap: 16px; }
.head { display: flex; align-items: center; gap: 12px; }
.online { margin-left: auto; color: #909399; font-size: 12px; }
.actions { margin-top: 16px; display: flex; gap: 8px; align-items: center; }
.stage-hint { margin-top: 8px; color: #909399; font-size: 12px; }
.empty { padding: 40px; text-align: center; color: #999; }
@media (max-width: 960px) { .hall { grid-template-columns: 1fr; } }
</style>
