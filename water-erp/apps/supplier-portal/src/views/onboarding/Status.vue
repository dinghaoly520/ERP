<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import SpPageHero from '@/components/SpPageHero.vue'
import { Hourglass, AlertTriangle } from 'lucide-vue-next'
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
  BLACKLIST:{step:3,label:'不良供应商',desc:'账号已列入不良供应商名单，如有异议请联系采购中心申诉。',icon:'WarningFilled',color:'#dc2626'},
}
const currentConfig = computed(() => { const s = status.value?.status; return s ? statusConfig[s]||statusConfig.PENDING : statusConfig.PENDING })
function elapsedLabel(ms: number): string { if (ms < 60000) return ''; const mins = Math.floor(ms / 60000); if (mins < 60) return `${mins} 分钟`; const hours = Math.floor(mins / 60); if (hours < 24) return `${hours} 小时 ${mins % 60} 分`; const days = Math.floor(hours / 24); return `${days} 天 ${hours % 24} 小时` }
function formatDuration(ms: number): string { const label = elapsedLabel(ms); return label ? `全程耗时 ${label}` : '' }
const progressDetail = computed<{ tone: string; text: string } | null>(() => { const s = status.value; if (!s) return null; const now = Date.now(); if (s.status === 'PENDING') { const elapsed = elapsedLabel(now - new Date(s.createdAt).getTime()); return { tone: 'info', text: `${elapsed ? `已审核 ${elapsed} · ` : ''}通常 3 个工作日内完成 · 下一步：审核通过后正式入库，即可参与投标` } }; if (s.status === 'RETURNED') return { tone: 'warning', text: '需要您补正资料后重新提交，补正后将重新进入审核流程' }; if (s.status === 'APPROVED') { const end = s.updatedAt ? new Date(s.updatedAt).getTime() : now; const duration = formatDuration(end - new Date(s.createdAt).getTime()); return { tone: 'success', text: `审核已完成${duration ? '，' + duration : ''}。您现在可以参与平台所有招标项目` } }; if (s.status === 'REJECTED') return { tone: 'error', text: '申请未通过，请查看下方原因。如有异议可联系平台管理员申诉' }; return null })
</script>

<template>
  <div class="page-container" v-loading="loading">
    <SpPageHero :icon="Hourglass" title="入驻状态" sub="集中查看审核状态、关键时间和需要处理的补正事项。" />

    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <div class="onboarding-card" v-else-if="status" :style="{ '--c': currentConfig.color } as any">
      <div class="status-summary">
        <div class="status-icon-wrap"><el-icon :size="36"><component :is="currentConfig.icon" /></el-icon></div>
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
        <el-button v-if="status.status==='APPROVED'" type="primary" @click="router.push('/bids')">浏览投标机会</el-button>
        <el-button v-if="status.status==='RETURNED'" type="primary" @click="router.push('/profile')">修改企业信息</el-button>
        <el-button v-if="status.status==='PENDING'" @click="router.push('/dashboard')">返回工作台</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Onboarding card — neumorphic plate (no glass / no drift) */
.onboarding-card {
  padding: 28px; border: none; border-radius: 16px;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.status-summary { display: grid; grid-template-columns: 72px minmax(0,1fr) auto; gap: 20px; align-items: center; }
.status-icon-wrap {
  width: 72px; height: 72px; border-radius: 16px;
  display: flex; align-items: center; justify-content: center;
  color: var(--c); background: color-mix(in oklab, var(--c) 12%, transparent);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6);
}
.status-summary h2 { margin: 0; color: var(--foreground); font-size: 24px; font-weight: 900; }
.status-summary p { margin: 6px 0 0; color: var(--muted-foreground); }
/* Concave date well */
.status-date {
  padding: 14px 18px; border: none; border-radius: 12px; text-align: right;
  background: var(--surface);
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.12), inset -3px -3px 7px oklch(1 0 0 / 0.8);
}
.status-date span { display: block; color: var(--muted-foreground); font-size: 12px; }
.status-date strong { display: block; margin-top: 4px; color: var(--foreground); font-variant-numeric: tabular-nums; }
/* Steps — concave wells + raised brand nodes */
.status-steps { display: grid; grid-template-columns: 120px minmax(40px,1fr) 120px minmax(40px,1fr) 120px; align-items: center; margin: 32px 0; }
.step { display: grid; justify-items: center; gap: 8px; color: var(--muted-foreground); }
.step span {
  width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; font-weight: 900; color: var(--muted-foreground);
  background: var(--surface);
  box-shadow: inset 2px 2px 5px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 5px oklch(1 0 0 / 0.8);
}
.step.active span {
  color: #fff;
  background: linear-gradient(180deg, oklch(0.55 0.16 258), oklch(0.45 0.15 258));
  box-shadow: 3px 3px 7px oklch(0.4 0.1 258 / 0.28), -2px -2px 5px oklch(1 0 0 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.3);
}
.step.active strong { color: var(--foreground); }
.line { height: 2px; background: var(--hairline); border-radius: 1px; }
.line.active { background: var(--brand); }
/* Semantic callouts — tinted surfaces, no glass */
.reason-card { margin-top: 16px; padding: 14px 18px; border: none; border-radius: 12px; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.reason-card strong { display: block; margin-bottom: 4px; }
.reason-card p { margin: 0; }
.reason-card.error { color: var(--danger); background: color-mix(in oklab, var(--danger) 8%, transparent); }
.reason-card.warning { color: color-mix(in oklab, var(--warning) 55%, #000); background: color-mix(in oklab, var(--warning) 12%, transparent); }
.progress-detail { display: flex; align-items: flex-start; gap: 8px; padding: 12px 16px; border: none; border-radius: 12px; margin-top: 16px; font-size: 13px; font-weight: 600; line-height: 1.5; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.progress-detail .el-icon { flex-shrink: 0; margin-top: 1px; font-size: 16px; }
.progress-detail.info { color: var(--brand); background: color-mix(in oklab, var(--brand) 8%, transparent); }
.progress-detail.success { color: color-mix(in oklab, var(--success) 55%, #000); background: color-mix(in oklab, var(--success) 10%, transparent); }
.progress-detail.warning { color: color-mix(in oklab, var(--warning) 55%, #000); background: color-mix(in oklab, var(--warning) 12%, transparent); }
.progress-detail.error { color: var(--danger); background: color-mix(in oklab, var(--danger) 8%, transparent); }
.status-actions { display: flex; gap: 10px; justify-content: flex-end; padding-top: 20px; border-top: 1px solid var(--hairline); }
@media (max-width:768px) { .status-summary { grid-template-columns: 1fr; } .status-date { text-align: left; } .status-steps { grid-template-columns: 1fr; gap: 10px; } .line { display: none; } }
</style>
