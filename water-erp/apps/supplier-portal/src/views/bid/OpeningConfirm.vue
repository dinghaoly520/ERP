<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'

const route = useRoute()
const router = useRouter()
const projectId = computed(() => route.params.projectId as string)

const loading = ref(true)
const acting = ref(false)
const record = ref<any>(null)

async function load() {
  loading.value = true
  try {
    record.value = await supplierApi.getOpeningRecord(projectId.value) as any
  } catch {
    record.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)

const statusLabel: Record<string, { text: string; type: string }> = {
  '待供应商确认': { text: '待您确认', type: 'warning' },
  '供应商已确认': { text: '已确认', type: 'success' },
  '供应商提出异议': { text: '已提出异议', type: 'danger' },
  '异议已处理-确认': { text: '异议已处理', type: 'success' },
  '异议已处理-退回': { text: '异议已退回', type: 'info' },
  '待确认': { text: '待确认', type: 'warning' },
}

const canAct = computed(() => {
  const s = record.value?.confirmStatus
  return s === '待供应商确认' || s === '待确认'
})

async function handleConfirm() {
  await ElMessageBox.confirm('确认开标记录中的报价、工期、质量目标等信息无误？确认后将进入评标。', '确认唱标信息', { type: 'warning' })
  acting.value = true
  try {
    await supplierApi.confirmOpening(projectId.value)
    ElMessage.success('已确认开标信息')
    await load()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '确认失败')
  } finally {
    acting.value = false
  }
}

async function handleDispute() {
  let reason = ''
  try {
    const res = await ElMessageBox.prompt('请填写异议原因（将提交给开标主持人处理）', '提出开标异议', {
      type: 'warning', confirmButtonText: '提交异议', cancelButtonText: '取消',
      inputPlaceholder: '例如：唱标报价与我方提交的不一致',
      inputValidator: (v: string) => (v && v.trim().length > 0) || '请填写异议原因',
    })
    reason = res.value
  } catch {
    return
  }
  acting.value = true
  try {
    await supplierApi.disputeOpening(projectId.value, reason)
    ElMessage.success('异议已提交')
    await load()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '提交失败')
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <el-button link @click="router.push('/my-bids')" style="margin-bottom: 16px;">
      <el-icon><ArrowLeft /></el-icon> 返回投标进展
    </el-button>

    <template v-if="record">
      <div class="sp-card">
        <div class="sp-card-header">
          <span class="sp-card-title">开标记录确认</span>
          <el-tag :type="(statusLabel[record.confirmStatus]?.type as any) || 'info'" effect="plain">
            {{ statusLabel[record.confirmStatus]?.text || record.confirmStatus || '暂无' }}
          </el-tag>
        </div>

        <el-descriptions :column="2" border size="default" style="margin-top: 8px;">
          <el-descriptions-item label="投标单位">{{ record.supplierName }}</el-descriptions-item>
          <el-descriptions-item label="解密结果">{{ record.decryptResult }}</el-descriptions-item>
          <el-descriptions-item label="报价">{{ record.amount }}</el-descriptions-item>
          <el-descriptions-item label="工期">{{ record.period }}</el-descriptions-item>
          <el-descriptions-item label="质量目标">{{ record.qualityTarget }}</el-descriptions-item>
          <el-descriptions-item label="保证金">{{ record.bondStatus }}</el-descriptions-item>
          <el-descriptions-item v-if="record.objectionReason" label="异议原因" :span="2">
            {{ record.objectionReason }}
          </el-descriptions-item>
          <el-descriptions-item v-if="record.handleResult" label="处理结果" :span="2">
            {{ record.handleResult }}
          </el-descriptions-item>
        </el-descriptions>

        <div v-if="canAct" class="opening-actions">
          <el-button type="primary" size="large" :loading="acting" @click="handleConfirm">
            <el-icon><CircleCheck /></el-icon>确认无误
          </el-button>
          <el-button type="danger" plain size="large" :loading="acting" @click="handleDispute">
            <el-icon><Warning /></el-icon>提出异议
          </el-button>
        </div>

        <el-alert
          v-else-if="record.confirmStatus === '供应商已确认'"
          type="success" :closable="false" show-icon style="margin-top: 16px;"
          title="您已确认开标记录，项目将进入评标阶段。"
        />
        <el-alert
          v-else-if="record.confirmStatus && String(record.confirmStatus).startsWith('异议已处理')"
          type="info" :closable="false" show-icon style="margin-top: 16px;"
          title="您的异议已由开标主持人处理。"
        />
      </div>
    </template>

    <div v-else-if="!loading" class="sp-card">
      <el-empty description="暂无开标记录，可能尚未解密或未进入开标阶段" />
    </div>
  </div>
</template>

<style scoped>
.sp-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.sp-card-title { font-size: 16px; font-weight: 800; color: var(--sp-gray-900); }
.opening-actions { display: flex; gap: 12px; margin-top: 20px; }
</style>
