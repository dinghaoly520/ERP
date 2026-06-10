<script setup>
import { ref, computed } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { useRouter } from 'vue-router'
import {
  Clock,
  Check,
  Close,
  Warning,
  Document,
  Refresh
} from '@element-plus/icons-vue'

const supplierStore = useSupplierStore()
const router = useRouter()

// 查询条件
const searchCode = ref('')

// 模拟当前用户的注册申请
const currentApplication = computed(() => {
  return supplierStore.mockSuppliers.find(s => s.status === 'pending' || s.status === 'approved' || s.status === 'rejected')
})

// 状态映射
const statusMap = {
  pending: { label: '待审核', type: 'warning', icon: Clock, color: '#f5a623' },
  approved: { label: '审核通过', type: 'success', icon: Check, color: '#11a874' },
  rejected: { label: '审核不通过', type: 'danger', icon: Close, color: '#e74c3c' },
  draft: { label: '草稿', type: 'info', icon: Document, color: '#909399' }
}

// 状态时间线
const timeline = computed(() => {
  if (!currentApplication.value) return []
  return [
    { time: currentApplication.value.registerDate, title: '提交注册申请', status: 'completed', description: '已提交企业信息和资质材料' },
    { time: currentApplication.value.status === 'pending' ? '审核中' : currentApplication.value.approveDate || '-', title: '资质审核', status: currentApplication.value.status === 'pending' ? 'processing' : 'completed', description: '审核企业资质材料' },
    { time: currentApplication.value.status === 'approved' ? currentApplication.value.approveDate : '-', title: '审核结果', status: currentApplication.value.status === 'approved' ? 'completed' : currentApplication.value.status === 'rejected' ? 'error' : 'pending', description: currentApplication.value.status === 'approved' ? '审核通过，已入库' : currentApplication.value.status === 'rejected' ? currentApplication.value.rejectReason : '等待审核' }
  ]
})

// 重新注册
const handleReRegister = () => {
  router.push('/register/form')
}
</script>

<template>
  <div class="register-status-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1 class="page-title">审核状态查询</h1>
      <p class="page-subtitle">查看供应商注册申请的审核进度和结果</p>
    </div>

    <!-- 查询条件 -->
    <div class="search-card">
      <el-input
        v-model="searchCode"
        placeholder="请输入统一社会信用代码查询"
        style="max-width: 400px"
        clearable
      >
        <template #prefix>
          <el-icon><Document /></el-icon>
        </template>
      </el-input>
      <el-button type="primary">查询</el-button>
    </div>

    <!-- 审核结果展示 -->
    <div class="status-card" v-if="currentApplication">
      <!-- 状态头部 -->
      <div class="status-header">
        <div class="status-icon" :style="{ background: statusMap[currentApplication.status].color }">
          <el-icon :size="32"><component :is="statusMap[currentApplication.status].icon" /></el-icon>
        </div>
        <div class="status-info">
          <div class="status-title">{{ statusMap[currentApplication.status].label }}</div>
          <div class="status-desc" v-if="currentApplication.status === 'pending'">
            您的注册申请正在审核中，请耐心等待
          </div>
          <div class="status-desc" v-else-if="currentApplication.status === 'approved'">
            恭喜！您的注册申请已通过审核，现可参与平台项目
          </div>
          <div class="status-desc" v-else-if="currentApplication.status === 'rejected'">
            审核未通过：{{ currentApplication.rejectReason }}
          </div>
        </div>
      </div>

      <!-- 申请信息 -->
      <div class="application-info">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="申请编号">{{ currentApplication.id }}</el-descriptions-item>
          <el-descriptions-item label="企业名称">{{ currentApplication.name }}</el-descriptions-item>
          <el-descriptions-item label="统一社会信用代码">{{ currentApplication.creditCode }}</el-descriptions-item>
          <el-descriptions-item label="申请时间">{{ currentApplication.registerDate }}</el-descriptions-item>
          <el-descriptions-item label="供应商分类">{{ currentApplication.categoryLabel }}</el-descriptions-item>
          <el-descriptions-item label="企业类型">{{ currentApplication.type }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- 审核进度 -->
      <div class="timeline-section">
        <h3 class="section-title">审核进度</h3>
        <el-timeline>
          <el-timeline-item
            v-for="(item, index) in timeline"
            :key="index"
            :timestamp="item.time"
            :type="item.status === 'completed' ? 'success' : item.status === 'processing' ? 'primary' : item.status === 'error' ? 'danger' : 'info'"
            :hollow="item.status !== 'completed'"
            placement="top"
          >
            <div class="timeline-title">{{ item.title }}</div>
            <div class="timeline-desc">{{ item.description }}</div>
          </el-timeline-item>
        </el-timeline>
      </div>

      <!-- 操作按钮 -->
      <div class="status-actions">
        <el-button v-if="currentApplication.status === 'rejected'" type="primary" @click="handleReRegister">
          <el-icon><Refresh /></el-icon>
          重新提交申请
        </el-button>
        <el-button v-if="currentApplication.status === 'approved'" type="primary" @click="router.push('/supplier')">
          进入供应商库
        </el-button>
      </div>
    </div>

    <!-- 无申请状态 -->
    <div class="empty-card" v-else>
      <el-empty description="暂无注册申请记录">
        <el-button type="primary" @click="handleReRegister">立即注册</el-button>
      </el-empty>
    </div>
  </div>
</template>

<style scoped>
.register-status-page {
  padding: 24px;
  background: #f6f9fd;
  min-height: calc(100vh - 60px);
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 22px;
  font-weight: 800;
  color: #18243a;
  margin-bottom: 8px;
}

.page-subtitle {
  font-size: 14px;
  color: #8a9aaa;
}

.search-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 24px;
  display: flex;
  gap: 12px;
  border: 1px solid #e8f0fa;
}

.status-card {
  background: #fff;
  border-radius: 8px;
  padding: 32px;
  border: 1px solid #e8f0fa;
}

.status-header {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid #e8f0fa;
}

.status-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.status-title {
  font-size: 20px;
  font-weight: 700;
  color: #18243a;
  margin-bottom: 8px;
}

.status-desc {
  font-size: 14px;
  color: #5a6d8a;
}

.application-info {
  margin-bottom: 32px;
}

.timeline-section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
  margin-bottom: 20px;
}

.timeline-title {
  font-size: 14px;
  font-weight: 600;
  color: #18243a;
  margin-bottom: 4px;
}

.timeline-desc {
  font-size: 13px;
  color: #8a9aaa;
}

.status-actions {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding-top: 24px;
  border-top: 1px solid #e8f0fa;
}

.empty-card {
  background: #fff;
  border-radius: 8px;
  padding: 60px 20px;
  text-align: center;
  border: 1px solid #e8f0fa;
}

@media (max-width: 768px) {
  .status-header {
    flex-direction: column;
    text-align: center;
  }
}
</style>