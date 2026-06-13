<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import dayjs from 'dayjs'

const supplierStore = useSupplierStore()
const loading = ref(true)

onMounted(async () => {
  try {
    await supplierStore.fetchProfile()
  } finally {
    loading.value = false
  }
})

const statusText: Record<string, string> = {
  PENDING: '待审核', APPROVED: '已入库', REJECTED: '不通过', RETURNED: '退回补正', DISABLED: '已停用', BLACKLIST: '黑名单',
}

const profileRows = computed(() => {
  const p = supplierStore.profile
  if (!p) return []
  return [
    { label: '统一社会信用代码', value: p.creditCode },
    { label: '企业类型', value: p.enterpriseType },
    { label: '法定代表人', value: p.legalPerson },
    { label: '注册时间', value: dayjs(p.createdAt).format('YYYY-MM-DD') },
    { label: '注册地址', value: p.registeredAddress, wide: true },
    { label: '经营范围', value: p.businessScope, wide: true },
    { label: '供应商分类', value: p.classification?.name || '未分类' },
    { label: '更新时间', value: dayjs(p.updatedAt).format('YYYY-MM-DD HH:mm') },
  ]
})
</script>

<template>
  <div class="page-container company-page" v-loading="loading">
    <div class="sp-page-title-row">
      <div>
        <div class="sp-page-eyebrow">Company Profile</div>
        <h1 class="sp-modern-title">企业信息</h1>
        <p class="sp-modern-desc">合并企业抬头与详情信息，减少重复展示。</p>
      </div>
      <div class="page-actions">
        <el-button type="primary" @click="$router.push('/change-records')">申请资料变更</el-button>
        <el-button @click="$router.push('/qualifications')">资质与证照</el-button>
      </div>
    </div>

    <div class="company-card" v-if="supplierStore.profile">
      <div class="company-identity">
        <div class="company-avatar">{{ supplierStore.profile.name?.charAt(0) }}</div>
        <div class="company-title">
          <h2>{{ supplierStore.profile.name }}</h2>
          <div class="company-subline">
            <span>{{ supplierStore.profile.creditCode }}</span>
            <span class="sp-status" :class="{
              pending: supplierStore.profile.status === 'PENDING',
              approved: supplierStore.profile.status === 'APPROVED',
              rejected: supplierStore.profile.status === 'REJECTED',
              returned: supplierStore.profile.status === 'RETURNED',
              disabled: supplierStore.profile.status === 'DISABLED' || supplierStore.profile.status === 'BLACKLIST',
            }">{{ statusText[supplierStore.profile.status as string] }}</span>
          </div>
        </div>
      </div>

      <div class="info-grid">
        <div v-for="row in profileRows" :key="row.label" class="info-item" :class="{ wide: row.wide }">
          <span>{{ row.label }}</span>
          <strong>{{ row.value || '-' }}</strong>
        </div>
      </div>

      <div v-if="supplierStore.profile.rejectReason" class="reason-card error">
        <strong>审核不通过原因</strong>{{ supplierStore.profile.rejectReason }}
      </div>
      <div v-if="supplierStore.profile.returnReason" class="reason-card warning">
        <strong>退回补正原因</strong>{{ supplierStore.profile.returnReason }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.company-page { max-width: 1180px; }
.page-actions { display: flex; gap: 10px; }
.company-card { padding: 24px; border: 1px solid var(--sp-border); border-radius: 20px; background: rgba(255,255,255,.94); box-shadow: var(--sp-shadow-sm); }
.company-identity { display: flex; align-items: center; gap: 18px; padding-bottom: 20px; border-bottom: 1px solid var(--sp-border-light); }
.company-avatar { width: 68px; height: 68px; border-radius: 18px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--sp-primary), var(--sp-cyan)); color: #fff; font-size: 30px; font-weight: 900; }
.company-title h2 { margin: 0; color: var(--sp-gray-900); font-size: 24px; font-weight: 900; }
.company-subline { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 8px; color: var(--sp-gray-500); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.info-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }
.info-item { padding: 14px 16px; border-radius: 14px; background: var(--sp-gray-50); }
.info-item.wide { grid-column: 1 / -1; }
.info-item span { display: block; color: var(--sp-gray-400); font-size: 12px; }
.info-item strong { display: block; margin-top: 5px; color: var(--sp-gray-900); font-size: 14px; line-height: 1.7; }
.reason-card { margin-top: 14px; padding: 14px 16px; border-radius: 14px; }
.reason-card strong { margin-right: 8px; }
.reason-card.error { color: var(--sp-red); background: var(--sp-red-light); }
.reason-card.warning { color: #92400e; background: var(--sp-orange-light); }
@media (max-width: 768px) { .sp-page-title-row, .page-actions, .company-identity { flex-direction: column; align-items: stretch; } .info-grid { grid-template-columns: 1fr; } }
</style>
