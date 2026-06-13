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

const statusMap: Record<string, { label: string; class: string }> = {
  draft: { label: '草稿', class: 'draft' },
  submitted: { label: '已提交', class: 'submitted' },
  withdrawn: { label: '已撤回', class: 'disabled' },
}

async function handleWithdraw(submissionId: string) {
  await ElMessageBox.confirm('确定要撤回此标书吗？撤回后可重新提交。', '确认撤回', { type: 'warning' })
  try {
    await supplierApi.withdrawSubmission(submissionId)
    ElMessage.success('标书已撤回')
    await supplierStore.fetchBidSubmissions()
  } catch {
    ElMessage.error('撤回失败')
  }
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="sp-page-title-row">
      <div>
        <div class="sp-page-eyebrow">Bid Progress</div>
        <h1 class="sp-modern-title">投标进展</h1>
        <p class="sp-modern-desc">集中跟踪标书草稿、已提交记录、撤回状态和项目截止时间。</p>
      </div>
      <el-button type="primary" @click="router.push('/bids')">
        <el-icon><Plus /></el-icon>浏览招标机会
      </el-button>
    </div>

    <div class="sp-metric-grid" style="margin-bottom: 18px;">
      <div class="sp-stat"><div class="sp-stat-icon blue"><el-icon><Document /></el-icon></div><div class="sp-stat-content"><div class="sp-stat-value">{{ summary.total }}</div><div class="sp-stat-label">全部记录</div></div></div>
      <div class="sp-stat"><div class="sp-stat-icon orange"><el-icon><EditPen /></el-icon></div><div class="sp-stat-content"><div class="sp-stat-value">{{ summary.draft }}</div><div class="sp-stat-label">草稿待提交</div></div></div>
      <div class="sp-stat"><div class="sp-stat-icon green"><el-icon><DocumentChecked /></el-icon></div><div class="sp-stat-content"><div class="sp-stat-value">{{ summary.submitted }}</div><div class="sp-stat-label">已提交</div></div></div>
      <div class="sp-stat"><div class="sp-stat-icon red"><el-icon><RefreshLeft /></el-icon></div><div class="sp-stat-content"><div class="sp-stat-value">{{ summary.withdrawn }}</div><div class="sp-stat-label">已撤回</div></div></div>
    </div>

    <div v-if="supplierStore.bidSubmissions.length > 0" class="bid-progress-grid">
      <div v-for="row in supplierStore.bidSubmissions" :key="row.id" class="sp-business-card bid-progress-card">
        <div class="bid-progress-top">
          <span class="sp-status" :class="statusMap[row.status]?.class || 'draft'">{{ statusMap[row.status]?.label || row.status }}</span>
          <span class="bid-progress-code">{{ row.project?.projectCode || '-' }}</span>
        </div>
        <h3 class="bid-progress-title">{{ row.project?.name || '-' }}</h3>
        <div class="bid-progress-meta">
          <div><span>投标报价</span><strong>{{ row.bidPrice || '-' }}</strong></div>
          <div><span>交货/工期</span><strong>{{ row.deliveryPeriod || '-' }}</strong></div>
          <div><span>提交时间</span><strong>{{ row.submittedAt ? dayjs(row.submittedAt).format('YYYY-MM-DD HH:mm') : '-' }}</strong></div>
          <div><span>截止时间</span><strong>{{ row.project?.deadline ? dayjs(row.project.deadline).format('YYYY-MM-DD HH:mm') : '-' }}</strong></div>
        </div>
        <div class="bid-progress-actions">
          <el-button type="primary" @click="router.push(`/bids/${row.projectId}`)">查看项目</el-button>
          <el-button v-if="row.status === 'submitted'" type="warning" plain @click="handleWithdraw(row.id)">撤回标书</el-button>
        </div>
      </div>
    </div>

    <div v-else class="sp-card">
      <div class="sp-empty">
        <div class="sp-empty-icon">📄</div>
        <div class="sp-empty-text">暂无投标记录</div>
        <div class="sp-empty-desc">浏览招标项目并提交您的标书</div>
        <el-button type="primary" style="margin-top: 16px;" @click="router.push('/bids')">浏览招标机会</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bid-progress-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
.bid-progress-card { padding: 18px; }
.bid-progress-top,.bid-progress-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.bid-progress-code { color: var(--sp-gray-400); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.bid-progress-title { margin: 14px 0; color: var(--sp-gray-900); font-size: 17px; font-weight: 900; line-height: 1.4; }
.bid-progress-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.bid-progress-meta div { padding: 10px; border-radius: 12px; background: var(--sp-gray-50); }
.bid-progress-meta span { display: block; color: var(--sp-gray-400); font-size: 12px; }
.bid-progress-meta strong { display: block; margin-top: 3px; color: var(--sp-gray-900); font-size: 13px; }
@media (max-width: 768px) { .bid-progress-grid { grid-template-columns: 1fr; } .bid-progress-meta { grid-template-columns: 1fr; } .bid-progress-actions { align-items: stretch; flex-direction: column; } .bid-progress-actions .el-button { width: 100%; } }
</style>
