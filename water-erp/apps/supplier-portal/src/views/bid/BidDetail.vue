<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBidStore } from '@/stores/bid'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage } from 'element-plus'
import { announcementApi } from '@/api/announcement'
import { bidApi } from '@/api/bid'
import BidStageTimeline from '@/components/BidStageTimeline.vue'
import SpPageHero from '@/components/SpPageHero.vue'
import { FileText, AlertTriangle, Lock, MessageCircle } from 'lucide-vue-next'
import dayjs from 'dayjs'

const route = useRoute()
const router = useRouter()
const bidStore = useBidStore()
const supplierStore = useSupplierStore()
const loading = ref(true)
const error = ref(false)
const activeTab = ref('info')
const tabList = [
  { key: 'info', label: '项目信息' },
  { key: 'clarifications', label: '澄清答疑' },
  { key: 'bidDoc', label: '招标文件' },
]
const projectId = computed(() => route.params.id as string)

const stageMap: Record<string, { label: string; color: string }> = {
  DOWNLOAD: { label: '文件下载', color: '#0891b2' }, SUBMIT: { label: '加密投递', color: '#064ea2' },
  OPENING: { label: '在线开标', color: '#d97706' }, EVALUATING: { label: '专家评标', color: '#7c3aed' }, ARCHIVED: { label: '已归档', color: '#059669' },
}
const project = computed(() => bidStore.currentProject)
const heroSub = computed(() => {
  const p = project.value
  return p ? `${p.projectCode} · ${p.procurementMethod} · 截止 ${dayjs(p.deadline).format('MM-DD HH:mm')} · 开标 ${dayjs(p.openTime).format('MM-DD HH:mm')}` : ''
})
const isApproved = computed(() => supplierStore.profile?.status === 'APPROVED')
const canSubmit = computed(() => { if (!project.value || !isApproved.value) return false; const p = project.value; return p.stage === 'SUBMIT' && new Date(p.deadline) > new Date() })
const supplierCount = computed(() => project.value?.suppliers?.length || project.value?._count?.suppliers || 0)
// 开标前隐藏投标方数量，防止串标围标
const showSupplierCount = computed(() => {
  const stage = project.value?.stage
  return stage === 'OPENING' || stage === 'EVALUATING' || stage === 'ARCHIVED'
})

const bidDoc = ref<any>(null); const bidDocLoading = ref(false); const paying = ref(false); const downloading = ref(false); const payDialog = ref(false); const paymentRef = ref('')
async function loadBidDoc() { bidDocLoading.value = true; try { bidDoc.value = await bidApi.getProjectBidDocument(projectId.value) as any } catch { bidDoc.value = null } bidDocLoading.value = false }
async function doPay() { if (!bidDoc.value?.announcementId) return; paying.value = true; try { await announcementApi.payBidDocument(bidDoc.value.announcementId, paymentRef.value || undefined); ElMessage.success('付款凭证已提交'); payDialog.value = false; paymentRef.value = ''; await loadBidDoc() } catch (e: any) { ElMessage.error(e?.message || '提交失败') } paying.value = false }
async function doDownload() { if (!bidDoc.value?.announcementId) return; downloading.value = true; try { const { blob, fileName } = await announcementApi.downloadBidDocument(bidDoc.value.announcementId); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fileName; a.click(); URL.revokeObjectURL(url); await loadBidDoc() } catch (e: any) { ElMessage.error(e?.message || '下载失败') } downloading.value = false }
function scopeHint(scope: string) { if (scope === 'DESIGNATED') return '仅指定供应商可下载'; if (scope === 'INVITED') return '仅受邀供应商可下载'; return '全库供应商可下载' }

// 澄清答疑 — 提问
const questionText = ref('')
const questionPosting = ref(false)
async function postQuestion() {
  if (!questionText.value.trim()) { ElMessage.warning('请输入问题'); return }
  questionPosting.value = true
  try {
    await bidApi.createQuestion(projectId.value, questionText.value.trim())
    ElMessage.success('问题已提交，等待回复')
    questionText.value = ''
    await bidStore.fetchProject(projectId.value) // refresh clarifications
  } catch (e: any) { ElMessage.error(e?.message || '提交失败') }
  questionPosting.value = false
}
onMounted(async () => { try { await Promise.all([bidStore.fetchProject(projectId.value), supplierStore.fetchProfile()]); loadBidDoc() } catch { error.value = true } finally { loading.value = false } })
async function retryLoad() { error.value = false; loading.value = true; try { await Promise.all([bidStore.fetchProject(projectId.value), supplierStore.fetchProfile()]); loadBidDoc() } catch { error.value = true } finally { loading.value = false } }
function goToSubmit() { if (!supplierStore.profile || supplierStore.profile?.status !== 'APPROVED') { ElMessage.warning('只有已入库供应商可以提交标书'); return } router.push(`/bids/${projectId.value}/submit`) }
</script>

<template>
  <div class="page-container" v-loading="loading">
    <button type="button" class="neu-link back-link" @click="router.push('/bids')"><el-icon><ArrowLeft /></el-icon>返回可投标项目列表</button>
    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else-if="project">
      <SpPageHero :icon="FileText" :title="project.name" :sub="heroSub">
        <template #actions>
          <el-button type="primary" size="large" :disabled="!canSubmit" @click="goToSubmit"><el-icon><Upload /></el-icon>{{ canSubmit ? '提交标书' : '不可投标' }}</el-button>
        </template>
      </SpPageHero>

      <div class="neu-tab-bar detail-tabs">
        <button
          v-for="t in tabList"
          :key="t.key"
          type="button"
          class="neu-tab"
          :class="{ active: activeTab === t.key, 'is-active': activeTab === t.key }"
          @click="activeTab = t.key"
        >{{ t.label }}</button>
      </div>

      <div v-if="activeTab === 'info'" class="detail-pane">
        <div class="neu-card detail-card">
          <el-descriptions :column="2" border size="large">
            <el-descriptions-item label="项目编号">{{ project.projectCode }}</el-descriptions-item>
            <el-descriptions-item label="采购方式">{{ project.procurementMethod }}</el-descriptions-item>
            <el-descriptions-item label="投标截止">{{ dayjs(project.deadline).format('YYYY-MM-DD HH:mm:ss') }}</el-descriptions-item>
            <el-descriptions-item label="开标时间">{{ dayjs(project.openTime).format('YYYY-MM-DD HH:mm:ss') }}</el-descriptions-item>
            <el-descriptions-item label="当前阶段">{{ stageMap[project.stage]?.label || project.stage }}</el-descriptions-item>
            <el-descriptions-item label="投标保证金">
              <template v-if="project.bondRequired">
                要求缴纳<span v-if="project.bondAmount != null" class="bond-amount">¥{{ Number(project.bondAmount).toLocaleString() }}</span>
              </template>
              <span v-else class="bond-none">不要求</span>
            </el-descriptions-item>
            <el-descriptions-item v-if="showSupplierCount" label="投标方">{{ supplierCount }} 家</el-descriptions-item>
            <el-descriptions-item label="风险提示" :span="2" v-if="project.riskNote"><span class="risk-note">{{ project.riskNote }}</span></el-descriptions-item>
          </el-descriptions>
        </div>
        <div class="neu-card detail-card timeline-card">
          <div class="timeline-title">项目进度</div>
          <BidStageTimeline :stage="project.stage" />
        </div>
      </div>

      <div v-if="activeTab === 'clarifications'" class="detail-pane">
        <div class="neu-card detail-card clarifications-card">
          <!-- 我要提问 -->
          <div class="question-box">
            <div class="question-title">我要提问</div>
            <div style="display:flex;gap:10px">
              <el-input v-model="questionText" placeholder="对招标文件或项目有疑问？在此向招标人提问…" :rows="2" type="textarea" style="flex:1" />
              <el-button type="primary" :loading="questionPosting" @click="postQuestion" style="align-self:flex-end">提交问题</el-button>
            </div>
          </div>
          <!-- 澄清答疑列表 -->
          <div v-if="project.clarifications?.length">
            <div v-for="c in project.clarifications" :key="c.id" class="clarification-item">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                <el-tag :type="c.type === 'question' ? 'info' : 'warning'" size="small" effect="plain">{{ c.type === 'question' ? '答疑' : '澄清' }}</el-tag>
                <span class="clarification-issuer">— {{ c.issuer }}</span>
                <span class="clarification-time">{{ new Date(c.createdAt).toLocaleString('zh-CN') }}</span>
              </div>
              <div class="clarification-q"><span>{{ c.question }}</span></div>
              <div class="clarification-a" v-if="c.reply"><el-tag type="success" size="small" effect="plain">回复</el-tag><span>{{ c.reply }}</span></div>
            </div>
          </div>
          <div v-else class="sp-empty">
            <div class="sp-empty-icon"><MessageCircle :size="22" :stroke-width="1.75" /></div>
            <div class="sp-empty-text">暂无澄清答疑</div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'bidDoc'" class="detail-pane">
        <div class="neu-card detail-card" v-loading="bidDocLoading">
          <template v-if="bidDoc">
            <div class="bid-doc-head"><Lock :size="17" :stroke-width="1.75" class="bid-doc-lock" /><strong>{{ bidDoc.title }}</strong><el-tag v-if="bidDoc.requirePayment" type="warning" size="small">付费 ¥{{ bidDoc.price }}</el-tag><el-tag v-else type="success" size="small">免费</el-tag></div>
            <p class="bid-doc-hint">{{ scopeHint(bidDoc.accessScope) }} · 已下载 {{ bidDoc.downloadCount }} 次</p>
            <div class="bid-doc-actions">
              <el-alert v-if="!bidDoc.eligible" :title="'无法下载：' + bidDoc.reason" type="error" :closable="false" show-icon />
              <template v-else>
                <template v-if="bidDoc.needPayment"><el-alert title="该招标文件需付费下载" type="warning" :closable="false" show-icon /><el-button type="primary" @click="payDialog = true">提交付款凭证</el-button></template>
                <el-alert v-else-if="bidDoc.requirePayment && !bidDoc.paid" title="付款凭证已提交，等待确认到账" type="info" :closable="false" show-icon />
                <el-button v-if="bidDoc.canDownload" type="primary" :loading="downloading" @click="doDownload"><el-icon><Download /></el-icon>下载招标文件</el-button>
              </template>
            </div>
          </template>
          <div v-else-if="!bidDocLoading" class="sp-empty">
            <div class="sp-empty-icon"><FileText :size="22" :stroke-width="1.75" /></div>
            <div class="sp-empty-text">暂无招标文件</div>
          </div>
        </div>
      </div>

      <el-dialog v-model="payDialog" title="提交付款凭证" width="420px"><el-form><el-form-item label="付款凭证/流水号"><el-input v-model="paymentRef" placeholder="如：银行流水号" /></el-form-item></el-form><template #footer><el-button @click="payDialog = false">取消</el-button><el-button type="primary" :loading="paying" @click="doPay">提交</el-button></template></el-dialog>
    </template>
  </div>
</template>

<style scoped>
/* ─── Back link — layout only (visuals from cgzxui .neu-link) ─── */
.back-link { margin-bottom: 16px; }

/* ─── Tabs + panes (visuals from cgzxui .neu-tab-bar / .neu-tab) ─── */
.detail-tabs { margin-top: 16px; }
.detail-pane { margin-top: 16px; display: grid; gap: 16px; align-items: start; }

/* ─── Detail card — layout only (visuals from cgzxui .neu-card) ─── */
.detail-card { padding: 20px; }
.timeline-card { padding: 16px 24px; }
.timeline-title { font-size: 12px; font-weight: 700; color: var(--muted-foreground); margin-bottom: 12px; }
.risk-note { color: var(--warning); font-weight: 600; }
.bond-amount { color: var(--warning); font-weight: 700; font-variant-numeric: tabular-nums; margin-left: 4px; }
.bond-none { color: var(--muted-foreground); }

/* ─── Clarifications ─── */
.clarifications-card { display: flex; flex-direction: column; gap: 16px; }
.question-box {
  background: var(--surface); border: none; border-radius: 12px; padding: 16px;
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.12), inset -3px -3px 7px oklch(1 0 0 / 0.8);
}
.question-title { font-size: 13px; font-weight: 700; color: var(--foreground); margin-bottom: 10px; }
.clarification-item { padding: 16px 0; border-bottom: 1px solid var(--hairline); }
.clarification-item:last-child { border-bottom: none; }
.clarification-q, .clarification-a { display: flex; align-items: flex-start; gap: 10px; line-height: 1.6; }
.clarification-a { margin-top: 10px; padding-left: 4px; }
.clarification-issuer { font-size: 12px; color: var(--muted-foreground); margin-left: auto; flex-shrink: 0; }
.clarification-time { font-size: 11px; color: var(--muted-foreground); margin-left: auto; }

/* ─── Bid doc section ─── */
.bid-doc-head { display: flex; align-items: center; gap: 8px; font-size: 15px; color: var(--foreground); flex-wrap: wrap; margin-bottom: 8px; }
.bid-doc-head strong { font-weight: 700; }
.bid-doc-lock { color: var(--brand); flex-shrink: 0; }
.bid-doc-hint { font-size: 12px; color: var(--muted-foreground); margin: 0 0 16px; }
.bid-doc-actions { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }

/* ─── Element Plus Descriptions — transparent plate, token hairlines ─── */
:deep(.el-descriptions) { --el-descriptions-table-bg: transparent; }
:deep(.el-descriptions__body) { background: transparent !important; }
:deep(.el-descriptions__body .el-descriptions__table.is-bordered) { background: transparent !important; }
:deep(.el-descriptions__body .el-descriptions__table.is-bordered td) { background: transparent !important; border-color: var(--hairline) !important; }
:deep(.el-descriptions__body .el-descriptions__table.is-bordered td:first-child) { background: oklch(1 0 0 / 0.35); }
:deep(.el-descriptions__label) { font-weight: 600; color: var(--muted-foreground); }
</style>
