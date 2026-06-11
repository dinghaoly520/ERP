<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import dayjs from 'dayjs'

const router = useRouter()
const supplierStore = useSupplierStore()
const loading = ref(true)

onMounted(async () => {
  try {
    await supplierStore.fetchStatus()
  } finally {
    loading.value = false
  }
})

const status = computed(() => supplierStore.status)

const statusConfig: Record<string, { step: number; label: string; desc: string; icon: string; color: string }> = {
  PENDING: { step: 2, label: '审核中', desc: '您的注册申请已提交，正在等待管理员审核。', icon: 'Clock', color: '#d97706' },
  RETURNED: { step: 1, label: '已退回补正', desc: '您的注册信息需要修改，请根据退回原因进行补正。', icon: 'EditPen', color: '#92400e' },
  APPROVED: { step: 3, label: '审核通过', desc: '恭喜！您的供应商注册已审核通过，可以使用全部功能。', icon: 'CircleCheckFilled', color: '#059669' },
  REJECTED: { step: 2, label: '审核不通过', desc: '很抱歉，您的注册申请未通过审核。请查看原因后重新申请。', icon: 'CircleCloseFilled', color: '#dc2626' },
  DISABLED: { step: 3, label: '已停用', desc: '您的供应商账号已被停用，请联系管理员了解详情。', icon: 'WarningFilled', color: '#64748b' },
  BLACKLIST: { step: 3, label: '黑名单', desc: '您的供应商账号已被列入黑名单。', icon: 'WarningFilled', color: '#dc2626' },
}

const currentConfig = computed(() => {
  const s = status.value?.status
  return s ? statusConfig[s] || statusConfig.PENDING : statusConfig.PENDING
})
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-header">
      <h1 class="page-title">入驻状态</h1>
      <p class="page-desc">查看您的供应商注册审核进度</p>
    </div>

    <!-- Steps -->
    <div class="sp-card" v-if="status">
      <div class="status-hero" :style="{ '--status-color': currentConfig.color }">
        <div class="status-icon-wrap">
          <el-icon :size="48" :color="currentConfig.color"><component :is="currentConfig.icon" /></el-icon>
        </div>
        <h2 class="status-label">{{ currentConfig.label }}</h2>
        <p class="status-desc">{{ currentConfig.desc }}</p>
      </div>

      <!-- Timeline -->
      <div class="status-timeline">
        <div class="timeline-step" :class="{ active: currentConfig.step >= 1, current: currentConfig.step === 1 }">
          <div class="timeline-dot">1</div>
          <div class="timeline-body">
            <div class="timeline-title">提交注册</div>
            <div class="timeline-time">{{ dayjs(status.createdAt).format('YYYY-MM-DD HH:mm') }}</div>
          </div>
        </div>
        <div class="timeline-line" :class="{ filled: currentConfig.step >= 2 }"></div>
        <div class="timeline-step" :class="{ active: currentConfig.step >= 2, current: currentConfig.step === 2 }">
          <div class="timeline-dot">2</div>
          <div class="timeline-body">
            <div class="timeline-title">平台审核</div>
            <div class="timeline-time">
              {{ currentConfig.step >= 2 ? '审核处理中' : '等待审核' }}
            </div>
          </div>
        </div>
        <div class="timeline-line" :class="{ filled: currentConfig.step >= 3 }"></div>
        <div class="timeline-step" :class="{ active: currentConfig.step >= 3, current: currentConfig.step === 3 }">
          <div class="timeline-dot">3</div>
          <div class="timeline-body">
            <div class="timeline-title">审核{{ status.status === 'APPROVED' ? '通过' : '完成' }}</div>
            <div class="timeline-time">
              {{ status.status === 'APPROVED' ? dayjs(status.updatedAt).format('YYYY-MM-DD HH:mm') : '待完成' }}
            </div>
          </div>
        </div>
      </div>

      <!-- Reject / Return reason -->
      <el-alert
        v-if="status.status === 'REJECTED' && status.rejectReason"
        type="error"
        :closable="false"
        show-icon
        style="margin-top: 20px;"
      >
        <template #title>审核不通过原因：{{ status.rejectReason }}</template>
      </el-alert>

      <el-alert
        v-if="status.status === 'RETURNED' && status.returnReason"
        type="warning"
        :closable="false"
        show-icon
        style="margin-top: 20px;"
      >
        <template #title>退回补正原因：{{ status.returnReason }}</template>
      </el-alert>

      <!-- Actions -->
      <div class="status-actions">
        <el-button v-if="status.status === 'APPROVED'" type="primary" size="large" @click="router.push('/bids')">
          浏览招标信息
        </el-button>
        <el-button v-if="status.status === 'RETURNED'" type="primary" size="large" @click="router.push('/profile')">
          修改企业信息
        </el-button>
        <el-button v-if="status.status === 'PENDING'" @click="router.push('/dashboard')">
          返回工作台
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.status-hero {
  text-align: center;
  padding: 32px 20px;
}

.status-icon-wrap {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  margin: 0 auto 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--status-color) 12%, transparent);
}

.status-label {
  font-size: 22px;
  font-weight: 800;
  color: var(--sp-gray-900);
  margin-bottom: 8px;
}

.status-desc {
  font-size: 14px;
  color: var(--sp-gray-500);
  max-width: 420px;
  margin: 0 auto;
}

.status-timeline {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  margin-top: 36px;
  padding: 0 20px;
}

.timeline-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 140px;
  flex-shrink: 0;
}

.timeline-dot {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
  background: var(--sp-gray-100);
  color: var(--sp-gray-400);
  border: 2px solid var(--sp-gray-200);
  transition: all 0.3s;
}

.timeline-step.active .timeline-dot {
  background: var(--sp-primary);
  color: #fff;
  border-color: var(--sp-primary);
  box-shadow: 0 4px 12px rgba(10, 94, 184, 0.3);
}

.timeline-step.current .timeline-dot {
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 4px 12px rgba(10, 94, 184, 0.3); }
  50% { box-shadow: 0 4px 24px rgba(10, 94, 184, 0.5); }
}

.timeline-body { text-align: center; margin-top: 12px; }

.timeline-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--sp-gray-900);
}

.timeline-step:not(.active) .timeline-title { color: var(--sp-gray-400); }

.timeline-time {
  font-size: 12px;
  color: var(--sp-gray-500);
  margin-top: 4px;
}

.timeline-line {
  flex: 1;
  height: 2px;
  background: var(--sp-gray-200);
  margin-top: 18px;
  min-width: 40px;
  max-width: 120px;
  transition: background 0.3s;
}

.timeline-line.filled { background: var(--sp-primary); }

.status-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--sp-border-light);
}
</style>
