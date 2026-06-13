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
  PENDING: { step: 2, label: '审核中', desc: '申请已提交，平台正在审核。', icon: 'Clock', color: '#d97706' },
  RETURNED: { step: 1, label: '退回补正', desc: '请根据审核意见补正资料后重新提交。', icon: 'EditPen', color: '#92400e' },
  APPROVED: { step: 3, label: '已入库', desc: '供应商资质已通过，可参与平台招标项目。', icon: 'CircleCheckFilled', color: '#059669' },
  REJECTED: { step: 2, label: '审核不通过', desc: '申请未通过审核，请查看原因。', icon: 'CircleCloseFilled', color: '#dc2626' },
  DISABLED: { step: 3, label: '已停用', desc: '账号已停用，请联系平台管理员。', icon: 'WarningFilled', color: '#64748b' },
  BLACKLIST: { step: 3, label: '黑名单', desc: '账号已列入黑名单。', icon: 'WarningFilled', color: '#dc2626' },
}

const currentConfig = computed(() => {
  const s = status.value?.status
  return s ? statusConfig[s] || statusConfig.PENDING : statusConfig.PENDING
})
</script>

<template>
  <div class="page-container onboarding-page" v-loading="loading">
    <div class="sp-page-title-row">
      <div>
        <div class="sp-page-eyebrow">Supplier Onboarding</div>
        <h1 class="sp-modern-title">入驻状态</h1>
        <p class="sp-modern-desc">集中查看审核状态、关键时间和需要处理的补正事项。</p>
      </div>
    </div>

    <div class="onboarding-card" v-if="status" :style="{ '--status-color': currentConfig.color }">
      <div class="status-summary">
        <div class="status-icon-wrap">
          <el-icon :size="34" :color="currentConfig.color"><component :is="currentConfig.icon" /></el-icon>
        </div>
        <div>
          <h2>{{ currentConfig.label }}</h2>
          <p>{{ currentConfig.desc }}</p>
        </div>
        <div class="status-date">
          <span>提交时间</span>
          <strong>{{ dayjs(status.createdAt).format('YYYY-MM-DD HH:mm') }}</strong>
        </div>
      </div>

      <div class="status-steps">
        <div class="step" :class="{ active: currentConfig.step >= 1 }"><span>1</span><strong>提交注册</strong></div>
        <div class="line" :class="{ active: currentConfig.step >= 2 }"></div>
        <div class="step" :class="{ active: currentConfig.step >= 2 }"><span>2</span><strong>平台审核</strong></div>
        <div class="line" :class="{ active: currentConfig.step >= 3 }"></div>
        <div class="step" :class="{ active: currentConfig.step >= 3 }"><span>3</span><strong>入库完成</strong></div>
      </div>

      <div v-if="status.status === 'REJECTED' && status.rejectReason" class="reason-card error">
        <strong>审核不通过原因</strong>
        <p>{{ status.rejectReason }}</p>
      </div>
      <div v-if="status.status === 'RETURNED' && status.returnReason" class="reason-card warning">
        <strong>退回补正原因</strong>
        <p>{{ status.returnReason }}</p>
      </div>

      <div class="status-actions">
        <el-button v-if="status.status === 'APPROVED'" type="primary" @click="router.push('/bids')">浏览招标机会</el-button>
        <el-button v-if="status.status === 'RETURNED'" type="primary" @click="router.push('/profile')">修改企业信息</el-button>
        <el-button v-if="status.status === 'PENDING'" @click="router.push('/dashboard')">返回工作台</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboarding-page { max-width: 1180px; }
.onboarding-card { padding: 24px; border: 1px solid var(--sp-border); border-radius: 20px; background: rgba(255,255,255,.94); box-shadow: var(--sp-shadow-sm); }
.status-summary { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 16px; align-items: center; }
.status-icon-wrap { width: 64px; height: 64px; border-radius: 18px; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--status-color) 12%, white); }
.status-summary h2 { margin: 0; color: var(--sp-gray-900); font-size: 24px; font-weight: 900; }
.status-summary p { margin: 6px 0 0; color: var(--sp-gray-500); }
.status-date { padding: 12px 16px; border-radius: 14px; background: var(--sp-gray-50); text-align: right; }
.status-date span { display: block; color: var(--sp-gray-400); font-size: 12px; }
.status-date strong { display: block; margin-top: 4px; color: var(--sp-gray-900); }
.status-steps { display: grid; grid-template-columns: 120px minmax(40px, 1fr) 120px minmax(40px, 1fr) 120px; align-items: center; margin: 28px 0; }
.step { display: grid; justify-items: center; gap: 8px; color: var(--sp-gray-400); }
.step span { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: var(--sp-gray-100); font-weight: 900; }
.step.active span { background: var(--sp-primary); color: #fff; }
.step.active strong { color: var(--sp-gray-900); }
.line { height: 2px; background: var(--sp-gray-200); }
.line.active { background: var(--sp-primary); }
.reason-card { margin-top: 14px; padding: 14px 16px; border-radius: 14px; }
.reason-card strong { display: block; margin-bottom: 4px; }
.reason-card p { margin: 0; }
.reason-card.error { color: var(--sp-red); background: var(--sp-red-light); }
.reason-card.warning { color: #92400e; background: var(--sp-orange-light); }
.status-actions { display: flex; gap: 10px; justify-content: flex-end; padding-top: 18px; border-top: 1px solid var(--sp-border-light); }
@media (max-width: 768px) { .status-summary { grid-template-columns: 1fr; } .status-date { text-align: left; } .status-steps { grid-template-columns: 1fr; gap: 10px; } .line { display: none; } }
</style>
