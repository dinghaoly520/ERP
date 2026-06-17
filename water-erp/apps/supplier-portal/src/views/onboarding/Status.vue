<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import dayjs from 'dayjs'

const router = useRouter(); const supplierStore = useSupplierStore(); const loading = ref(true); const error = ref(false)
onMounted(async () => { try { await supplierStore.fetchStatus() } catch { error.value = true } finally { loading.value = false } })
async function retryLoad() { error.value = false; loading.value = true; try { await supplierStore.fetchStatus() } catch { error.value = true } finally { loading.value = false } }
const status = computed(() => supplierStore.status)
const statusConfig: Record<string,{step:number;label:string;desc:string;icon:string;color:string}> = {
  PENDING:{step:2,label:'审核中',desc:'申请已提交，平台正在审核。',icon:'Clock',color:'#d97706'},
  RETURNED:{step:1,label:'退回补正',desc:'请根据审核意见补正资料后重新提交。',icon:'EditPen',color:'#92400e'},
  APPROVED:{step:3,label:'已入库',desc:'供应商资质已通过，可参与平台招标项目。',icon:'CircleCheckFilled',color:'#059669'},
  REJECTED:{step:2,label:'审核不通过',desc:'申请未通过审核，请查看原因。',icon:'CircleCloseFilled',color:'#dc2626'},
  DISABLED:{step:3,label:'已停用',desc:'账号已停用，请联系平台管理员。',icon:'WarningFilled',color:'#64748b'},
  BLACKLIST:{step:3,label:'黑名单',desc:'账号已列入黑名单。',icon:'WarningFilled',color:'#dc2626'},
}
const currentConfig = computed(() => { const s = status.value?.status; return s ? statusConfig[s]||statusConfig.PENDING : statusConfig.PENDING })
function elapsedLabel(ms: number): string { if (ms<0) ms=0; const mins=Math.floor(ms/60000); if (mins<60) return `${mins} 分钟`; const hours=Math.floor(mins/60); if (hours<24) return `${hours} 小时 ${mins%60} 分`; const days=Math.floor(hours/24); return `${days} 天 ${hours%24} 小时` }
const progressDetail = computed<{ tone: string; text: string } | null>(() => { const s = status.value; if (!s) return null; const now = Date.now(); if (s.status==='PENDING') return { tone:'info', text:`已审核 ${elapsedLabel(now-new Date(s.createdAt).getTime())} · 通常 3 个工作日内完成 · 下一步：审核通过后正式入库，即可参与投标` }; if (s.status==='RETURNED') return { tone:'warning', text:'需要您补正资料后重新提交，补正后将重新进入审核流程' }; if (s.status==='APPROVED') { const end=s.updatedAt?new Date(s.updatedAt).getTime():now; return { tone:'success', text:`审核已完成，全程耗时 ${elapsedLabel(end-new Date(s.createdAt).getTime())}。您现在可以参与平台所有招标项目` } }; if (s.status==='REJECTED') return { tone:'error', text:'申请未通过，请查看下方原因。如有异议可联系平台管理员申诉' }; return null })
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="sp-page-hero-card">
      <div class="sp-page-hero-inner">
        <div class="sp-page-hero-body">
          <h1 class="sp-modern-title">入驻状态</h1>
          <p class="sp-modern-desc">集中查看审核状态、关键时间和需要处理的补正事项。</p>
        </div>
      </div>
    </div>

    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <div class="onboarding-card" v-else-if="status" :style="{'--status-color':currentConfig.color}">
      <div class="status-summary">
        <div class="status-icon-wrap"><el-icon :size="36" :color="currentConfig.color"><component :is="currentConfig.icon" /></el-icon></div>
        <div><h2>{{ currentConfig.label }}</h2><p>{{ currentConfig.desc }}</p></div>
        <div class="status-date"><span>提交时间</span><strong>{{ dayjs(status.createdAt).format('YYYY-MM-DD HH:mm') }}</strong></div>
      </div>
      <div class="status-steps">
        <div class="step" :class="{active:currentConfig.step>=1}"><span>1</span><strong>提交注册</strong></div><div class="line" :class="{active:currentConfig.step>=2}"></div>
        <div class="step" :class="{active:currentConfig.step>=2}"><span>2</span><strong>平台审核</strong></div><div class="line" :class="{active:currentConfig.step>=3}"></div>
        <div class="step" :class="{active:currentConfig.step>=3}"><span>3</span><strong>入库完成</strong></div>
      </div>
      <div v-if="progressDetail" class="progress-detail" :class="progressDetail.tone"><el-icon><component :is="progressDetail.tone==='success'?'CircleCheckFilled':progressDetail.tone==='warning'?'WarningFilled':progressDetail.tone==='error'?'CircleCloseFilled':'InfoFilled'" /></el-icon><span>{{ progressDetail.text }}</span></div>
      <div v-if="status.status==='REJECTED'&&status.rejectReason" class="reason-card error"><strong>审核不通过原因</strong><p>{{ status.rejectReason }}</p></div>
      <div v-if="status.status==='RETURNED'&&status.returnReason" class="reason-card warning"><strong>退回补正原因</strong><p>{{ status.returnReason }}</p></div>
      <div class="status-actions">
        <el-button v-if="status.status==='APPROVED'" type="primary" @click="router.push('/bids')">浏览招标机会</el-button>
        <el-button v-if="status.status==='RETURNED'" type="primary" @click="router.push('/profile')">修改企业信息</el-button>
        <el-button v-if="status.status==='PENDING'" @click="router.push('/dashboard')">返回工作台</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboarding-card { padding: 28px; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); background: #fff; }
.status-summary { display: grid; grid-template-columns: 72px minmax(0,1fr) auto; gap: 20px; align-items: center; }
.status-icon-wrap { width: 72px; height: 72px; border-radius: var(--sp-radius-md); display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--status-color) 12%, white); }
.status-summary h2 { margin: 0; color: var(--sp-gray-900); font-size: 24px; font-weight: 900; }
.status-summary p { margin: 6px 0 0; color: var(--sp-gray-500); }
.status-date { padding: 14px 18px; border-radius: var(--sp-radius-sm); background: var(--sp-gray-50); text-align: right; border: 1px solid var(--sp-border-light); }
.status-date span { display: block; color: var(--sp-gray-400); font-size: 12px; }
.status-date strong { display: block; margin-top: 4px; color: var(--sp-gray-900); }
.status-steps { display: grid; grid-template-columns: 120px minmax(40px,1fr) 120px minmax(40px,1fr) 120px; align-items: center; margin: 32px 0; }
.step { display: grid; justify-items: center; gap: 8px; color: var(--sp-gray-400); }
.step span { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--sp-gray-100); font-weight: 900; }
.step.active span { background: var(--sp-primary); color: #fff; }
.step.active strong { color: var(--sp-gray-900); }
.line { height: 2px; background: var(--sp-gray-200); border-radius: 1px; }
.line.active { background: var(--sp-primary); }
.reason-card { margin-top: 16px; padding: 14px 18px; border-radius: var(--sp-radius-sm); }
.reason-card strong { display: block; margin-bottom: 4px; }
.reason-card p { margin: 0; }
.reason-card.error { color: var(--sp-red); background: var(--sp-red-light); }
.reason-card.warning { color: #92400e; background: var(--sp-orange-light); }
.progress-detail { display: flex; align-items: flex-start; gap: 10px; padding: 14px 18px; border-radius: var(--sp-radius-sm); margin-top: 16px; font-size: 13px; line-height: 1.6; }
.progress-detail .el-icon { flex-shrink: 0; margin-top: 1px; font-size: 16px; }
.progress-detail.info { background: #eff6ff; color: #064ea2; border: 1px solid #bfdbfe; }
.progress-detail.success { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
.progress-detail.warning { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
.progress-detail.error { background: #fef2f2; color: var(--sp-red); border: 1px solid #fecaca; }
.status-actions { display: flex; gap: 10px; justify-content: flex-end; padding-top: 20px; border-top: 1px solid var(--sp-border-light); }
.progress-detail { display: flex; align-items: center; gap: 8px; margin-top: 16px; padding: 12px 16px; border-radius: var(--sp-radius-sm); font-size: 13px; font-weight: 600; line-height: 1.5; }
.progress-detail.info { color: var(--sp-primary); background: var(--sp-primary-lighter); }
.progress-detail.success { color: #065f46; background: var(--sp-green-light); }
.progress-detail.warning { color: #92400e; background: var(--sp-orange-light); }
.progress-detail.error { color: var(--sp-red); background: var(--sp-red-light); }
@media (max-width:768px) { .status-summary { grid-template-columns: 1fr; } .status-date { text-align: left; } .status-steps { grid-template-columns: 1fr; gap: 10px; } .line { display: none; } }
</style>
