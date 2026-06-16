<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import BidStageTimeline from '@/components/BidStageTimeline.vue'
import dayjs from 'dayjs'

const router = useRouter()
const supplierStore = useSupplierStore()
const loading = ref(true)
const firstLoad = ref(true)
const error = ref(false)
const summary = computed(() => {
  const list = supplierStore.bidSubmissions
  return { total: list.length, draft: list.filter((i: any) => i.status === 'draft').length, submitted: list.filter((i: any) => i.status === 'submitted').length, withdrawn: list.filter((i: any) => i.status === 'withdrawn').length }
})
onMounted(async () => { try { await supplierStore.fetchBidSubmissions() } catch { error.value = true } finally { loading.value = false; firstLoad.value = false } })
function retryLoad() { error.value = false; loading.value = true; supplierStore.fetchBidSubmissions().catch(() => { error.value = true }).finally(() => { loading.value = false }) }
const statusMap: Record<string, { label: string; cls: string; tone: string }> = { draft: { label: '草稿', cls: 'draft', tone: 'orange' }, submitted: { label: '已提交', cls: 'submitted', tone: 'green' }, withdrawn: { label: '已撤回', cls: 'disabled', tone: 'gray' } }
async function handleWithdraw(id: string) { await ElMessageBox.confirm('确定要撤回此标书吗？', '确认撤回', { type: 'warning' }); try { await supplierApi.withdrawSubmission(id); ElMessage.success('投标已撤回'); await supplierStore.fetchBidSubmissions() } catch (err: any) { ElMessage.error(err?.response?.data?.error || '撤回失败') } }
function canWithdraw(row: any) { return row.status === 'submitted' && row.project?.stage === 'SUBMIT' }
function canConfirmOpening(row: any) { const stage = row.project?.stage; return row.status === 'submitted' && (stage === 'OPENING' || stage === 'EVALUATING' || stage === 'ARCHIVED') }
</script>

<template>
  <div class="page-container">
    <div v-if="loading && firstLoad" class="skel-wrap">
      <div class="skel-hero"><span class="sp-skel" style="width:100px;height:13px"></span><span class="sp-skel" style="width:200px;height:24px;margin-top:12px"></span><span class="sp-skel" style="width:280px;height:14px;margin-top:10px"></span></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px"><div class="skel-cell" v-for="i in 4" :key="i"><span class="sp-skel" style="width:40px;height:26px"></span><span class="sp-skel" style="width:60px;height:12px;margin-top:6px"></span></div></div>
      <div class="skel-row" v-for="i in 3" :key="i"><div style="flex:1"><span class="sp-skel" style="width:50%;height:16px"></span><span class="sp-skel" style="width:35%;height:12px;margin-top:8px"></span></div><span class="sp-skel" style="width:80px;height:28px"></span></div>
    </div>
    <div v-else-if="error" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else>
    <div v-loading="loading">
    <div class="sp-page-hero-card">
      <div class="sp-page-hero-inner">
        <div class="sp-page-hero-body">
          <div class="sp-page-eyebrow blue"><el-icon :size="13"><DocumentChecked /></el-icon>Bid Progress</div>
          <h1 class="sp-modern-title">投标进展</h1>
          <p class="sp-modern-desc">跟踪已提交的投标记录与当前状态。</p>
        </div>
        <div class="sp-page-hero-actions">
          <el-button type="primary" @click="router.push('/bids')"><el-icon><Plus /></el-icon>浏览招标机会</el-button>
        </div>
      </div>
    </div>

    <div class="progress-summary">
      <div class="summary-cell"><strong>{{ summary.total }}</strong><span>全部</span></div>
      <div class="summary-cell"><strong>{{ summary.draft }}</strong><span>草稿</span></div>
      <div class="summary-cell"><strong>{{ summary.submitted }}</strong><span>已提交</span></div>
      <div class="summary-cell"><strong>{{ summary.withdrawn }}</strong><span>已撤回</span></div>
    </div>

    <div v-if="supplierStore.bidSubmissions.length > 0" class="progress-list">
      <div v-for="row in supplierStore.bidSubmissions" :key="row.id" class="progress-row">
        <div class="status-dot" :class="statusMap[row.status]?.tone || 'gray'"></div>
        <div class="progress-main">
          <div class="progress-title-line"><h3>{{ row.project?.name || '-' }}</h3><span class="sp-status" :class="statusMap[row.status]?.cls || 'draft'">{{ statusMap[row.status]?.label || row.status }}</span></div>
          <div class="progress-meta"><span>{{ row.project?.projectCode || '-' }}</span><span>报价：{{ row.bidPrice || '-' }}</span><span>工期：{{ row.deliveryPeriod || '-' }}</span><span v-if="row.submittedAt">提交：{{ dayjs(row.submittedAt).format('MM-DD HH:mm') }}</span></div>
          <div v-if="row.status === 'submitted' && row.project?.stage" class="progress-timeline-wrap"><BidStageTimeline :stage="row.project.stage" /></div>
        </div>
        <div class="progress-actions">
          <el-button type="primary" plain size="small" @click="router.push(`/bids/${row.projectId}`)">详情</el-button>
          <el-button v-if="canConfirmOpening(row)" type="success" plain size="small" @click="router.push(`/my-bids/${row.projectId}/opening-confirm`)">开标确认</el-button>
          <el-button v-if="canWithdraw(row)" type="warning" plain size="small" @click="handleWithdraw(row.id)">撤回</el-button>
        </div>
      </div>
    </div>

    <div v-else class="sp-empty-panel"><el-icon :size="32"><Document /></el-icon><p class="sp-empty-text">暂无投标记录</p><p class="sp-empty-desc">浏览招标项目并提交您的标书</p><el-button type="primary" style="margin-top:16px" @click="router.push('/bids')">浏览招标机会</el-button></div>
    </div>
    </template>
  </div>
</template>

<style scoped>
.skel-wrap{display:flex;flex-direction:column;gap:14px}.skel-hero{background:#fff;border:1px solid var(--sp-border);border-radius:var(--sp-radius-md);padding:24px;display:flex;flex-direction:column}.skel-cell{padding:16px 18px;border:1px solid var(--sp-border);border-radius:var(--sp-radius-md);background:#fff;display:flex;flex-direction:column}.skel-row{display:flex;align-items:center;gap:14px;padding:16px 20px;border:1px solid var(--sp-border);border-radius:var(--sp-radius-md);background:#fff}
.progress-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.summary-cell { padding: 16px 18px; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); background: #fff; }
.summary-cell strong { display: block; color: var(--sp-gray-900); font-size: 26px; line-height: 1; }
.summary-cell span { display: block; margin-top: 6px; color: var(--sp-gray-500); font-size: 12px; }
.progress-list { display: grid; gap: 10px; }
.progress-row { display: flex; gap: 14px; align-items: center; padding: 16px 20px; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); background: #fff; transition: border-color 0.15s; }
.progress-row:hover { border-color: var(--sp-primary); }
.status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; background: var(--sp-gray-300); }
.status-dot.green { background: var(--sp-green); }
.status-dot.orange { background: var(--sp-orange); }
.progress-main { flex: 1; min-width: 0; }
.progress-title-line { display: flex; align-items: center; gap: 10px; }
.progress-title-line h3 { margin: 0; font-size: 15px; font-weight: 800; color: var(--sp-gray-900); }
.progress-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; font-size: 12px; color: var(--sp-gray-500); }
.progress-timeline-wrap{margin-top:12px;padding-top:12px;border-top:1px dashed var(--sp-border-light);max-width:420px}
.progress-actions { display: flex; gap: 8px; flex-shrink: 0; }
.sp-empty-panel { background: #fff; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); padding: 64px 20px; text-align: center; color: var(--sp-gray-400); }
.sp-empty-text { font-size: 15px; font-weight: 700; color: var(--sp-gray-500); margin-top: 12px; }
.sp-empty-desc { font-size: 13px; margin-top: 4px; }
@media (max-width: 768px) { .progress-summary { grid-template-columns: repeat(2, 1fr); } .progress-row { flex-direction: column; align-items: stretch; } }
</style>
