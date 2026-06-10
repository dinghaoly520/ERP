<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage } from 'element-plus'
import {
  Clock,
  Check,
  Close,
  Refresh
} from '@element-plus/icons-vue'

const router = useRouter()
const supplierStore = useSupplierStore()

// 模拟当前用户的供应商状态
const currentSupplier = ref({
  id: 1,
  name: '四川水发建设工程有限公司',
  creditCode: '91510000MA6XXXXX',
  status: 'approved', // pending, approved, rejected
  submitDate: '2026-05-15',
  auditDate: '2026-05-18',
  auditor: '张三',
  reason: ''
})

const statusMap = {
  pending: {
    label: '审核中',
    color: '#f5a623',
    icon: Clock,
    desc: '您的注册申请正在审核中，请耐心等待'
  },
  approved: {
    label: '已通过',
    color: '#11a874',
    icon: Check,
    desc: '恭喜！您已通过审核，可以参与平台项目'
  },
  rejected: {
    label: '已驳回',
    color: '#e74c3c',
    icon: Close,
    desc: '您的申请未通过审核，请查看原因并重新提交'
  }
}

const currentStatus = computed(() => statusMap[currentSupplier.value.status])

const handleReapply = () => {
  router.push('/supplier/register')
}

const handleViewDetail = () => {
  router.push('/supplier/detail/' + currentSupplier.value.id)
}
</script>

<template>
  <div class="status-page">
    <div class="page-header">
      <h1 class="page-title">注册状态</h1>
      <p class="page-subtitle">查看供应商注册申请的审核状态</p>
    </div>

    <!-- 状态展示 -->
    <div class="status-container">
      <div class="status-card">
        <div class="status-icon" :style="{ background: currentStatus.color + '20' }">
          <el-icon :size="64" :color="currentStatus.color">
            <component :is="currentStatus.icon" />
          </el-icon>
        </div>
        <h2 :style="{ color: currentStatus.color }">{{ currentStatus.label }}</h2>
        <p class="status-desc">{{ currentStatus.desc }}</p>

        <!-- 审核信息 -->
        <div class="audit-info">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="企业名称">{{ currentSupplier.name }}</el-descriptions-item>
            <el-descriptions-item label="统一社会信用代码">{{ currentSupplier.creditCode }}</el-descriptions-item>
            <el-descriptions-item label="提交时间">{{ currentSupplier.submitDate }}</el-descriptions-item>
            <el-descriptions-item v-if="currentSupplier.status !== 'pending'" label="审核时间">
              {{ currentSupplier.auditDate }}
            </el-descriptions-item>
            <el-descriptions-item v-if="currentSupplier.status !== 'pending'" label="审核人">
              {{ currentSupplier.auditor }}
            </el-descriptions-item>
            <el-descriptions-item v-if="currentSupplier.status === 'rejected'" label="驳回原因">
              <span style="color: #e74c3c">{{ currentSupplier.reason || '资质材料不完整，请补充相关证明文件' }}</span>
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <!-- 操作按钮 -->
        <div class="status-actions">
          <el-button v-if="currentSupplier.status === 'rejected'" type="primary" @click="handleReapply">
            <el-icon><Refresh /></el-icon>
            重新申请
          </el-button>
          <el-button v-if="currentSupplier.status === 'approved'" type="primary" @click="handleViewDetail">
            查看供应商详情
          </el-button>
          <el-button @click="router.push('/supplier')">返回首页</el-button>
        </div>
      </div>

      <!-- 流程说明 -->
      <div class="process-section">
        <h3>审核流程说明</h3>
        <div class="process-steps">
          <div class="process-step" :class="{ active: true, done: currentSupplier.status !== 'pending' }">
            <div class="step-dot"></div>
            <div class="step-content">
              <strong>提交申请</strong>
              <span>填写企业信息并上传资质</span>
            </div>
          </div>
          <div class="process-line" :class="{ done: currentSupplier.status !== 'pending' }"></div>
          <div class="process-step" :class="{ active: true, done: currentSupplier.status === 'approved' || currentSupplier.status === 'rejected' }">
            <div class="step-dot"></div>
            <div class="step-content">
              <strong>平台审核</strong>
              <span>审核资质合规性（3-5个工作日）</span>
            </div>
          </div>
          <div class="process-line" :class="{ done: currentSupplier.status === 'approved' }"></div>
          <div class="process-step" :class="{ active: currentSupplier.status === 'approved', done: currentSupplier.status === 'approved' }">
            <div class="step-dot"></div>
            <div class="step-content">
              <strong>入驻成功</strong>
              <span>参与平台招标采购项目</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.status-page {
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

.status-container {
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: 24px;
}

.status-card {
  background: #fff;
  border-radius: 12px;
  padding: 48px;
  text-align: center;
  border: 1px solid #e8f0fa;
}

.status-icon {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 24px;
}

.status-card h2 {
  font-size: 28px;
  font-weight: 800;
  margin-bottom: 12px;
}

.status-desc {
  font-size: 15px;
  color: #5a6d8a;
  margin-bottom: 32px;
}

.audit-info {
  text-align: left;
  max-width: 500px;
  margin: 0 auto 32px;
}

.status-actions {
  display: flex;
  gap: 16px;
  justify-content: center;
}

.process-section {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  border: 1px solid #e8f0fa;
}

.process-section h3 {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
  margin-bottom: 24px;
}

.process-steps {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.process-step {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.step-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #e8f0fa;
  flex-shrink: 0;
  margin-top: 4px;
  transition: all 0.3s;
}

.process-step.active .step-dot {
  background: #064ea2;
}

.process-step.done .step-dot {
  background: #11a874;
}

.step-content {
  flex: 1;
}

.step-content strong {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #18243a;
  margin-bottom: 4px;
}

.step-content span {
  font-size: 12px;
  color: #8a9aaa;
}

.process-line {
  width: 2px;
  height: 40px;
  background: #e8f0fa;
  margin-left: 7px;
  margin-top: 8px;
  margin-bottom: 8px;
}

.process-line.done {
  background: #11a874;
}

@media (max-width: 1024px) {
  .status-container {
    grid-template-columns: 1fr;
  }
}
</style>
