<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import dayjs from 'dayjs'

const router = useRouter()
const supplierStore = useSupplierStore()
const loading = ref(true)

const summary = computed(() => {
  const list = supplierStore.bidSubmissions
  return {
    total: list.length,
    draft: list.filter((item: any) => item.status === 'draft').length,
    submitted: list.filter((item: any) => item.status === 'submitted').length,
    withdrawn: list.filter((item: any) => item.status === 'withdrawn').length,
  }
})

onMounted(async () => {
  try {
    await supplierStore.fetchBidSubmissions()
  } finally {
    loading.value = false
  }
})

const statusMap: Record<string, { label: string; class: string; tone: string }> = {
  draft: { label: '草稿', class: 'draft', tone: 'orange' },
  submitted: { label: '已提交', class: 'submitted', tone: 'green' },
  withdrawn: { label: '已撤回', class: 'disabled', tone: 'gray' },
}

async function handleWithdraw(submissionId: string) {
  await ElMessageBox.confirm('确定要撤回此标书吗？撤回后可重新提交。', '确认撤回', { type: 'warning' })
  try {
    await supplierApi.withdrawSubmission(submissionId)
    ElMessage.success('投标已撤回')
    await supplierStore.fetchBidSubmissions()
  } catch (err: any) {
    const msg = err?.response?.data?.error || '撤回失败'
    ElMessage.error(msg)
  }
}

function canWithdraw(row: any) {
  return row.status === 'submitted' && row.project?.stage === 'SUBMIT'
}

function canConfirmOpening(row: any) {
  const stage = row.project?.stage
  return row.status === 'submitted' && (stage === 'OPENING' || stage === 'EVALUATING' || stage === 'ARCHIVED')
}
</script>

<template>
  <div class="page-container bid-progress-page" v-loading="loading">
    <div class="sp-page-title-row">
      <div>
        <div class="sp-page-eyebrow">Bid Progress</div>
        <h1 class="sp-modern-title">投标进展</h1>
        <p class="sp-modern-desc">用时间线层级展示投标记录，减少重复字段和卡片厚重感。</p>
      </div>
      <el-button type="primary" @click="router.push('/bids')">
        <el-icon><Plus /></el-icon>浏览招标机会
      </el-button>
    </div>

    <div class="progress-summary">
      <div><strong>{{ summary.total }}</strong><span>全部</span></div>
      <div><strong>{{ summary.draft }}</strong><span>草稿</span></div>
      <div><strong>{{ summary.submitted }}</strong><span>已提交</span></div>
      <div><strong>{{ summary.withdrawn }}</strong><span>已撤回</span></div>
    </div>

    <div v-if="supplierStore.bidSubmissions.length > 0" class="progress-list">
      <div v-for="row in supplierStore.bidSubmissions" :key="row.id" class="progress-row">
        <div class="status-rail" :class="statusMap[row.status]?.tone || 'gray'">
          <span></span>
        </div>
        <div class="progress-main">
          <div class="progress-title-line">
            <h3>{{ row.project?.name || '-' }}</h3>
            <span class="sp-status" :class="statusMap[row.status]?.class || 'draft'">{{ statusMap[row.status]?.label || row.status }}</span>
          </div>
          <div class="progress-meta">
            <span>{{ row.project?.projectCode || '-' }}</span>
            <span>报价：{{ row.bidPrice || '-' }}</span>
            <span>工期：{{ row.deliveryPeriod || '-' }}</span>
            <span>提交：{{ row.submittedAt ? dayjs(row.submittedAt).format('MM-DD HH:mm') : '-' }}</span>
            <span>截止：{{ row.project?.deadline ? dayjs(row.project.deadline).format('MM-DD HH:mm') : '-' }}</span>
          </div>
        </div>
        <div class="progress-actions">
          <el-button type="primary" plain size="small" @click="router.push(`/bids/${row.projectId}`)">项目详情</el-button>
          <el-button v-if="canConfirmOpening(row)" type="success" plain size="small" @click="router.push(`/my-bids/${row.projectId}/opening-confirm`)">开标确认</el-button>
          <el-button v-if="canWithdraw(row)" type="warning" plain size="small" @click="handleWithdraw(row.id)">撤回</el-button>
        </div>
      </div>
    </div>

    <div v-else class="sp-card">
      <div class="sp-empty">
        <div class="sp-empty-icon"><el-icon :size="48"><Document /></el-icon></div>
        <div class="sp-empty-text">暂无投标记录</div>
        <div class="sp-empty-desc">浏览招标项目并提交您的标书</div>
        <el-button type="primary" style="margin-top: 16px;" @click="router.push('/bids')">浏览招标机会</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bid-progress-page { /* full-width — shell provides padding */ }
.progress-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.progress-summary div { padding: 14px 16px; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); background: var(--sp-surface); }
.progress-summary strong { display: block; color: var(--sp-gray-900); font-size: 26px; line-height: 1; }
.progress-summary span { display: block; margin-top: 6px; color: var(--sp-gray-500); font-size: 12px; }
.progress-list { display: grid; gap: 10px; }
.progress-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 15px 18px; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); background: var(--sp-surface); }
.status-rail { width: 18px; display: flex; justify-content: center; align-self: stretch; }
.status-rail span { width: 10px; height: 10px; margin-top: 8px; border-radius: 999px; background: var(--sp-gray-300); }
.status-rail.green span { background: var(--sp-green); }
.status-rail.orange span { background: var(--sp-orange); }
.progress-title-line { display: flex; align-items: center; gap: 10px; min-width: 0; }
.progress-title-line h3 { margin: 0; color: var(--sp-gray-900); font-size: 16px; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.progress-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 7px; color: var(--sp-gray-500); font-size: 12px; }
.progress-actions { display: flex; gap: 8px; }
@media (max-width: 768px) { .progress-summary { grid-template-columns: repeat(2, 1fr); } .progress-row { grid-template-columns: 14px 1fr; } .progress-actions { grid-column: 2; } }
</style>
