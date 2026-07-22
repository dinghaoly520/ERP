<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import { bidApi } from '@/api/bid'
import SpPageHero from '@/components/SpPageHero.vue'
import { Lock, AlertTriangle } from 'lucide-vue-next'

const route = useRoute(); const router = useRouter(); const projectId = computed(() => route.params.projectId as string)
const loading = ref(true); const error = ref(false); const acting = ref(false); const record = ref<any>(null); const projectStage = ref<string>('')
async function load() { loading.value = true; error.value = false; try { const [rec, proj] = await Promise.all([supplierApi.getOpeningRecord(projectId.value) as any, bidApi.getProject(projectId.value) as any]) as any; record.value = rec; projectStage.value = proj?.stage || '' } catch { error.value = true } finally { loading.value = false } }
async function retryLoad() { await load() }
onMounted(load)

const statusLabel: Record<string, { text: string; type: string }> = { '待供应商确认':{text:'待您确认',type:'warning'}, '供应商已确认':{text:'已确认',type:'success'}, '供应商提出异议':{text:'已提出异议',type:'danger'}, '异议已处理-确认':{text:'异议已处理',type:'success'}, '异议已处理-退回':{text:'异议已退回',type:'info'}, '待确认':{text:'待确认',type:'warning'} }
const canAct = computed(() => { const s = record.value?.confirmStatus; return (s==='待供应商确认'||s==='待确认') && projectStage.value === 'OPENING' })

async function handleConfirm() { await ElMessageBox.confirm('确认开标记录无误？','确认唱标信息',{type:'warning'}); acting.value=true; try{await supplierApi.confirmOpening(projectId.value);ElMessage.success('已确认开标信息');await load()}catch(err:any){ElMessage.error(err?.response?.data?.error||'确认失败')}finally{acting.value=false} }
async function handleDispute() { let reason=''; try{const res=await ElMessageBox.prompt('请填写异议原因','提出开标异议',{type:'warning',confirmButtonText:'提交异议',inputPlaceholder:'例如：唱标报价与我方提交的不一致',inputValidator:(v:string)=>(v&&v.trim().length>0)||'请填写异议原因'});reason=res.value}catch{return}; acting.value=true; try{await supplierApi.disputeOpening(projectId.value,reason);ElMessage.success('异议已提交');await load()}catch(err:any){ElMessage.error(err?.response?.data?.error||'提交失败')}finally{acting.value=false} }
</script>

<template>
  <div class="page-container" v-loading="loading">
    <button type="button" class="neu-link back-link" @click="router.push('/my-bids')"><el-icon><ArrowLeft /></el-icon>返回投标进展</button>
    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else-if="record">
      <SpPageHero :icon="Lock" title="开标记录确认" sub="核对开标唱标记录，确认无误后提交；如有异议可向开标主持人提出。">
        <template #actions>
          <el-tag :type="(statusLabel[record.confirmStatus]?.type as any)||'info'" effect="plain">{{ statusLabel[record.confirmStatus]?.text||record.confirmStatus||'暂无' }}</el-tag>
        </template>
      </SpPageHero>
      <div class="neu-card detail-card">
        <el-descriptions :column="2" border size="default"><el-descriptions-item label="投标单位">{{ record.supplierName }}</el-descriptions-item><el-descriptions-item label="解密结果">{{ record.decryptResult }}</el-descriptions-item><el-descriptions-item label="报价">{{ record.amount }}</el-descriptions-item><el-descriptions-item label="工期">{{ record.period }}</el-descriptions-item><el-descriptions-item label="质量目标">{{ record.qualityTarget }}</el-descriptions-item><el-descriptions-item label="保证金">{{ record.bondStatus }}</el-descriptions-item><el-descriptions-item v-if="record.objectionReason" label="异议原因" :span="2">{{ record.objectionReason }}</el-descriptions-item><el-descriptions-item v-if="record.handleResult" label="处理结果" :span="2">{{ record.handleResult }}</el-descriptions-item></el-descriptions>
        <div v-if="canAct" class="opening-actions"><el-button type="primary" size="large" :loading="acting" @click="handleConfirm"><el-icon><CircleCheck /></el-icon>确认无误</el-button><el-button type="danger" plain size="large" :loading="acting" @click="handleDispute"><el-icon><Warning /></el-icon>提出异议</el-button></div>
        <el-alert v-else-if="record.confirmStatus==='供应商已确认'" type="success" :closable="false" show-icon style="margin-top:16px" title="您已确认开标记录，项目将进入评标阶段。" />
        <el-alert v-else-if="record.confirmStatus&&String(record.confirmStatus).startsWith('异议已处理')" type="info" :closable="false" show-icon style="margin-top:16px" title="您的异议已由开标主持人处理。" />
      </div>
    </template>
    <div v-else-if="!loading" class="neu-card detail-card empty-card">
      <div class="sp-empty-icon"><Lock :size="22" :stroke-width="1.75" /></div>
      <p class="sp-empty-text">暂无开标记录</p>
    </div>
  </div>
</template>

<style scoped>
/* ─── Back link — layout only (visuals from cgzxui .neu-link) ─── */
.back-link { margin-bottom: 16px; }

/* ─── Record card — layout only (visuals from cgzxui .neu-card) ─── */
.detail-card { margin-top: 16px; padding: 24px; }
.opening-actions { display: flex; gap: 12px; margin-top: 20px; }
.empty-card { align-items: center; text-align: center; padding: 64px 20px; }
.empty-card .sp-empty-text { font-size: 15px; font-weight: 700; color: var(--muted-foreground); margin-top: 12px; }

/* ─── Element Plus Descriptions — transparent plate, token hairlines ─── */
:deep(.el-descriptions) { --el-descriptions-table-bg: transparent; }
:deep(.el-descriptions__body) { background: transparent !important; }
:deep(.el-descriptions__body .el-descriptions__table.is-bordered) { background: transparent !important; }
:deep(.el-descriptions__body .el-descriptions__table.is-bordered td) { background: transparent !important; border-color: var(--hairline) !important; }
:deep(.el-descriptions__body .el-descriptions__table.is-bordered td:first-child) { background: oklch(1 0 0 / 0.35); }
:deep(.el-descriptions__label) { font-weight: 600; color: var(--muted-foreground); }
</style>
