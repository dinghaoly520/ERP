<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage } from 'element-plus'
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
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-header">
      <h1 class="page-title">企业信息</h1>
      <p class="page-desc">查看和管理您的企业基本信息</p>
    </div>

    <div class="sp-card" v-if="supplierStore.profile">
      <!-- Company header -->
      <div class="company-header">
        <div class="company-avatar">
          {{ supplierStore.profile.name?.charAt(0) }}
        </div>
        <div class="company-meta">
          <h2 class="company-name">{{ supplierStore.profile.name }}</h2>
          <div class="company-tags">
            <el-tag effect="plain">{{ supplierStore.profile.enterpriseType }}</el-tag>
            <el-tag type="info" effect="plain">{{ supplierStore.profile.creditCode }}</el-tag>
            <span class="sp-status" :class="{
              pending: supplierStore.profile.status === 'PENDING',
              approved: supplierStore.profile.status === 'APPROVED',
              rejected: supplierStore.profile.status === 'REJECTED',
              returned: supplierStore.profile.status === 'RETURNED',
              disabled: supplierStore.profile.status === 'DISABLED' || supplierStore.profile.status === 'BLACKLIST',
            }">
              {{ { PENDING: '待审核', APPROVED: '已入库', REJECTED: '不通过', RETURNED: '退回补正', DISABLED: '已停用', BLACKLIST: '黑名单' }[supplierStore.profile.status as string] }}
            </span>
          </div>
        </div>
      </div>

      <el-divider />

      <!-- Company details -->
      <el-descriptions :column="2" border size="large">
        <el-descriptions-item label="企业名称" :span="2">{{ supplierStore.profile.name }}</el-descriptions-item>
        <el-descriptions-item label="统一社会信用代码">{{ supplierStore.profile.creditCode }}</el-descriptions-item>
        <el-descriptions-item label="企业类型">{{ supplierStore.profile.enterpriseType }}</el-descriptions-item>
        <el-descriptions-item label="法定代表人">{{ supplierStore.profile.legalPerson }}</el-descriptions-item>
        <el-descriptions-item label="注册时间">{{ dayjs(supplierStore.profile.createdAt).format('YYYY-MM-DD') }}</el-descriptions-item>
        <el-descriptions-item label="注册地址" :span="2">{{ supplierStore.profile.registeredAddress }}</el-descriptions-item>
        <el-descriptions-item label="经营范围" :span="2">{{ supplierStore.profile.businessScope }}</el-descriptions-item>
        <el-descriptions-item label="分类">
          <span v-if="supplierStore.profile.classification">{{ supplierStore.profile.classification.name }}</span>
          <span v-else class="text-muted">未分类</span>
        </el-descriptions-item>
        <el-descriptions-item label="更新时间">{{ dayjs(supplierStore.profile.updatedAt).format('YYYY-MM-DD HH:mm') }}</el-descriptions-item>
      </el-descriptions>

      <!-- Reject/Return reason -->
      <el-alert
        v-if="supplierStore.profile.rejectReason"
        type="error"
        :closable="false"
        show-icon
        style="margin-top: 20px;"
      >
        <template #title>审核不通过原因：{{ supplierStore.profile.rejectReason }}</template>
      </el-alert>
      <el-alert
        v-if="supplierStore.profile.returnReason"
        type="warning"
        :closable="false"
        show-icon
        style="margin-top: 20px;"
      >
        <template #title>退回补正原因：{{ supplierStore.profile.returnReason }}</template>
      </el-alert>

      <!-- Actions -->
      <div class="info-actions">
        <el-button type="primary" @click="$router.push('/change-records')">申请信息变更</el-button>
        <el-button @click="$router.push('/qualifications')">管理资质材料</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.company-header {
  display: flex;
  align-items: center;
  gap: 20px;
}

.company-avatar {
  width: 72px;
  height: 72px;
  border-radius: 16px;
  background: linear-gradient(135deg, #0a5eb8, #0891b2);
  color: #fff;
  font-size: 32px;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.company-name {
  font-size: 22px;
  font-weight: 800;
  color: var(--sp-gray-900);
  margin-bottom: 8px;
}

.company-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.info-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--sp-border-light);
}
</style>
