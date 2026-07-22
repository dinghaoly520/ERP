<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import SpPageHero from '@/components/SpPageHero.vue'
import { Building2, AlertTriangle } from 'lucide-vue-next'

const supplierStore = useSupplierStore(); const loading = ref(true); const error = ref(false)
async function copyCreditCode() {
  if (!supplierStore.profile?.creditCode) return
  try {
    await navigator.clipboard.writeText(supplierStore.profile.creditCode)
    ElMessage.success('已复制统一社会信用代码')
  } catch { ElMessage.warning('复制失败，请手动选择') }
}
onMounted(async () => { try { await supplierStore.fetchProfile() } catch { error.value = true } finally { loading.value = false } })
async function retryLoad() { error.value = false; loading.value = true; try { await supplierStore.fetchProfile() } catch { error.value = true } finally { loading.value = false } }
const statusText: Record<string,string> = {PENDING:'待审核',APPROVED:'已入库',REJECTED:'不通过',RETURNED:'退回补正',DISABLED:'已停用',BLACKLIST:'黑名单'}
const profileRows = computed(() => {
  const p = supplierStore.profile; if (!p) return []
  return [{label:'统一社会信用代码',value:p.creditCode},{label:'企业类型',value:p.enterpriseType},{label:'法定代表人',value:p.legalPerson},{label:'注册时间',value:dayjs(p.createdAt).format('YYYY-MM-DD')},{label:'注册地址',value:p.registeredAddress,wide:true},{label:'经营范围',value:p.businessScope,wide:true},{label:'供应商分类',value:p.classification?.name||'未分类'},{label:'更新时间',value:dayjs(p.updatedAt).format('YYYY-MM-DD HH:mm')}]
})
</script>

<template>
  <div class="page-container" v-loading="loading">
    <SpPageHero :icon="Building2" title="企业信息" sub="企业抬头与详细信息，支持发起资料变更申请。">
      <template #actions>
        <el-button type="primary" @click="$router.push('/change-records')">申请资料变更</el-button>
        <el-button @click="$router.push('/qualifications')">资质与证照</el-button>
      </template>
    </SpPageHero>

    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <div class="detail-card" v-else-if="supplierStore.profile">
      <div class="company-identity">
        <div class="company-avatar">{{ supplierStore.profile.name?.charAt(0) }}</div>
        <div class="company-title"><h2>{{ supplierStore.profile.name }}</h2><div class="company-subline"><span class="company-credit-code">{{ supplierStore.profile.creditCode }}</span> <el-button link type="primary" style="padding:0;font-size:18px" @click="copyCreditCode" title="复制信用代码"><el-icon><CopyDocument /></el-icon></el-button><span class="sp-status" :class="{pending:supplierStore.profile.status==='PENDING',approved:supplierStore.profile.status==='APPROVED',rejected:supplierStore.profile.status==='REJECTED'||supplierStore.profile.status==='BLACKLIST',returned:supplierStore.profile.status==='RETURNED',disabled:supplierStore.profile.status==='DISABLED'}">{{ statusText[supplierStore.profile.status]||supplierStore.profile.status }}</span></div></div>
      </div>
      <div class="info-grid">
        <div v-for="row in profileRows" :key="row.label" class="info-item" :class="{wide:row.wide}"><span>{{ row.label }}</span><strong>{{ row.value||'-' }}</strong></div>
      </div>
      <div v-if="supplierStore.profile.rejectReason" class="reason-card error"><strong>审核不通过原因</strong>{{ supplierStore.profile.rejectReason }}</div>
      <div v-if="supplierStore.profile.returnReason" class="reason-card warning"><strong>退回补正原因</strong>{{ supplierStore.profile.returnReason }}</div>
    </div>
  </div>
</template>

<style scoped>
/* ═══ Detail surface — neumorphic plate (no glass / no drift) ═══ */
.detail-card {
  position: relative;
  padding: 28px;
  margin-top: 16px;
  border-radius: 16px;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.company-identity { display: flex; align-items: center; gap: 20px; padding-bottom: 24px; border-bottom: 1px solid var(--hairline); }
.company-avatar {
  width: 72px; height: 72px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  background: var(--brand); color: #fff; font-size: 32px; font-weight: 900;
  box-shadow: 4px 4px 10px oklch(0.4 0.1 258 / 0.28), -2px -2px 6px oklch(1 0 0 / 0.6), inset 0 1px 0 oklch(1 0 0 / 0.25);
}
.company-title h2 { margin: 0; color: var(--foreground); font-size: 24px; font-weight: 900; letter-spacing: -0.02em; }
.company-subline { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 8px; color: var(--muted-foreground); }
.company-credit-code { font-family: 'SF Mono','JetBrains Mono',monospace; font-size: 13px; font-variant-numeric: tabular-nums; }
.info-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; margin-top: 24px; }
.info-item {
  padding: 16px 18px; border-radius: 12px;
  background: oklch(0.985 0.005 258);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.85), 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.10), -2px -2px 5px oklch(1 0 0 / 0.9);
}
.info-item.wide { grid-column: 1/-1; }
.info-item span { display: block; color: var(--muted-foreground); font-size: 12px; }
.info-item strong { display: block; margin-top: 6px; color: var(--foreground); font-size: 14px; line-height: 1.6; }
.reason-card { margin-top: 16px; padding: 14px 16px; border-radius: 12px; }
.reason-card strong { margin-right: 8px; }
.reason-card.error { color: var(--danger); background: color-mix(in oklab, var(--danger) 8%, transparent); }
.reason-card.warning { color: var(--warning); background: color-mix(in oklab, var(--warning) 10%, transparent); }
@media (max-width:768px) { .company-identity { flex-direction: column; align-items: stretch; } .info-grid { grid-template-columns: 1fr; } }
</style>
