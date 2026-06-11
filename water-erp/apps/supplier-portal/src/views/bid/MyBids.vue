<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import dayjs from 'dayjs'

const router = useRouter()
const supplierStore = useSupplierStore()
const loading = ref(true)

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
    <div class="sp-section-header">
      <div>
        <h1 class="page-title">我的投标</h1>
        <p class="page-desc">查看和管理您已提交的所有投标记录</p>
      </div>
      <el-button type="primary" @click="router.push('/bids')">
        <el-icon><Plus /></el-icon>浏览招标项目
      </el-button>
    </div>

    <div class="sp-card" v-if="supplierStore.bidSubmissions.length > 0">
      <el-table :data="supplierStore.bidSubmissions" stripe>
        <el-table-column label="项目名称" min-width="220">
          <template #default="{ row }">
            <div>
              <div style="font-weight: 600; color: var(--sp-gray-900);">{{ row.project?.name || '-' }}</div>
              <div style="font-size: 12px; color: var(--sp-gray-400); font-family: monospace;">{{ row.project?.projectCode }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="投标报价" prop="bidPrice" width="140">
          <template #default="{ row }">
            <span style="font-weight: 700; color: var(--sp-primary);">{{ row.bidPrice || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="交货/工期" prop="deliveryPeriod" width="130">
          <template #default="{ row }">{{ row.deliveryPeriod || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110" align="center">
          <template #default="{ row }">
            <span class="sp-status" :class="statusMap[row.status]?.class || 'draft'">
              {{ statusMap[row.status]?.label || row.status }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="160">
          <template #default="{ row }">
            {{ row.submittedAt ? dayjs(row.submittedAt).format('YYYY-MM-DD HH:mm') : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="截止时间" width="160">
          <template #default="{ row }">
            {{ row.project?.deadline ? dayjs(row.project.deadline).format('YYYY-MM-DD HH:mm') : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="router.push(`/bids/${row.projectId}`)">查看项目</el-button>
            <el-button
              v-if="row.status === 'submitted'"
              link
              type="warning"
              @click="handleWithdraw(row.id)"
            >撤回</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-else class="sp-card">
      <div class="sp-empty">
        <div class="sp-empty-icon">📄</div>
        <div class="sp-empty-text">暂无投标记录</div>
        <div class="sp-empty-desc">浏览招标项目并提交您的标书</div>
        <el-button type="primary" style="margin-top: 16px;" @click="router.push('/bids')">浏览招标信息</el-button>
      </div>
    </div>
  </div>
</template>
