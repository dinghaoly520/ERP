<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBidStore } from '@/stores/bid'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage } from 'element-plus'
import { announcementApi } from '@/api/announcement'
import { bidApi } from '@/api/bid'
import BidStageTimeline from '@/components/BidStageTimeline.vue'
import dayjs from 'dayjs'

const route = useRoute()
const router = useRouter()
const bidStore = useBidStore()
const supplierStore = useSupplierStore()
const loading = ref(true)
const error = ref(false)
const activeTab = ref('info')
const projectId = computed(() => route.params.id as string)

const stageMap: Record<string, { label: string; color: string }> = {
  DOWNLOAD: { label: '文件下载', color: '#0891b2' }, SUBMIT: { label: '加密投递', color: '#064ea2' },
  OPENING: { label: '在线开标', color: '#d97706' }, EVALUATING: { label: '专家评标', color: '#7c3aed' }, ARCHIVED: { label: '已归档', color: '#059669' },
}
const project = computed(() => bidStore.currentProject)
const isApproved = computed(() => supplierStore.profile?.status === 'APPROVED')
const canSubmit = computed(() => { if (!project.value || !isApproved.value) return false; const p = project.value; return (p.stage === 'DOWNLOAD' || p.stage === 'SUBMIT') && new Date(p.deadline) > new Date() })
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
onMounted(async () => { try { await Promise.all([bidStore.fetchProject(projectId.value), supplierStore.fetchProfile()]); loadBidDoc() } catch { error.value = true } finally { loading.value = false } })
async function retryLoad() { error.value = false; loading.value = true; try { await Promise.all([bidStore.fetchProject(projectId.value), supplierStore.fetchProfile()]); loadBidDoc() } catch { error.value = true } finally { loading.value = false } }
function goToSubmit() { if (!supplierStore.profile || supplierStore.profile?.status !== 'APPROVED') { ElMessage.warning('只有已入库供应商可以提交标书'); return } router.push(`/bids/${projectId.value}/submit`) }
</script>

<template>
  <div class="page-container" v-loading="loading">
    <el-button link @click="router.push('/bids')" style="margin-bottom: 16px;"><el-icon><ArrowLeft /></el-icon> 返回招标列表</el-button>
    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else-if="project">
      <div class="sp-page-hero-card">
        <div class="sp-page-hero-inner">
          <div class="sp-page-hero-body">
            <h1 class="sp-modern-title">{{ project.name }}</h1>
            <p class="sp-modern-desc">{{ project.projectCode }} · {{ project.procurementMethod }} · 截止 {{ dayjs(project.deadline).format('MM-DD HH:mm') }} · 开标 {{ dayjs(project.openTime).format('MM-DD HH:mm') }}</p>
          </div>
          <div class="sp-page-hero-actions">
            <el-button type="primary" size="large" :disabled="!canSubmit" @click="goToSubmit"><el-icon><Upload /></el-icon>{{ canSubmit ? '提交标书' : '不可投标' }}</el-button>
          </div>
        </div>
      </div>

      <el-tabs v-model="activeTab" style="margin-top: 0;">
        <el-tab-pane label="项目信息" name="info">
          <div class="detail-card"><el-descriptions :column="2" border size="large">
            <el-descriptions-item label="项目编号">{{ project.projectCode }}</el-descriptions-item>
            <el-descriptions-item label="采购方式">{{ project.procurementMethod }}</el-descriptions-item>
            <el-descriptions-item label="投标截止">{{ dayjs(project.deadline).format('YYYY-MM-DD HH:mm:ss') }}</el-descriptions-item>
            <el-descriptions-item label="开标时间">{{ dayjs(project.openTime).format('YYYY-MM-DD HH:mm:ss') }}</el-descriptions-item>
            <el-descriptions-item label="当前阶段">{{ stageMap[project.stage]?.label || project.stage }}</el-descriptions-item>
            <el-descriptions-item v-if="showSupplierCount" label="投标方">{{ supplierCount }} 家</el-descriptions-item>
            <el-descriptions-item label="风险提示" :span="2" v-if="project.riskNote"><span style="color: var(--sp-orange);">{{ project.riskNote }}</span></el-descriptions-item>
          </el-descriptions></div>
          <div class="detail-card timeline-card" style="margin-top:16px;padding:16px 24px"><div style="font-size:12px;font-weight:700;color:var(--sp-gray-500);margin-bottom:12px">项目进度</div><BidStageTimeline :stage="project.stage" /></div>
        </el-tab-pane>
        <el-tab-pane label="澄清答疑" name="clarifications">
          <div class="detail-card">
            <div v-if="project.clarifications?.length">
              <div v-for="c in project.clarifications" :key="c.id" class="clarification-item">
                <div class="clarification-q"><el-tag type="warning" size="small" effect="plain">问题</el-tag><span>{{ c.question }}</span><span class="clarification-issuer">— {{ c.issuer }}</span></div>
                <div class="clarification-a" v-if="c.reply"><el-tag type="success" size="small" effect="plain">回复</el-tag><span>{{ c.reply }}</span></div>
              </div>
            </div>
            <div v-else class="sp-empty" style="padding:40px"><div class="sp-empty-icon"><el-icon :size="24"><ChatDotRound /></el-icon></div><div class="sp-empty-text">暂无澄清答疑</div></div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="招标文件" name="bidDoc">
          <div class="detail-card" v-loading="bidDocLoading">
            <template v-if="bidDoc">
              <div class="bid-doc-head"><el-icon color="var(--sp-primary)" :size="20"><Lock /></el-icon><strong>{{ bidDoc.title }}</strong><el-tag v-if="bidDoc.requirePayment" type="warning" size="small">付费 ¥{{ bidDoc.price }}</el-tag><el-tag v-else type="success" size="small">免费</el-tag></div>
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
            <el-empty v-else-if="!bidDocLoading" description="暂无招标文件" :image-size="60" />
          </div>
        </el-tab-pane>
      </el-tabs>
      <el-dialog v-model="payDialog" title="提交付款凭证" width="420px"><el-form><el-form-item label="付款凭证/流水号"><el-input v-model="paymentRef" placeholder="如：银行流水号" /></el-form-item></el-form><template #footer><el-button @click="payDialog = false">取消</el-button><el-button type="primary" :loading="paying" @click="doPay">提交</el-button></template></el-dialog>
    </template>
  </div>
</template>

<style scoped>
.detail-card { background: #fff; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); padding: 20px; }
.clarification-item { padding: 16px 0; border-bottom: 1px solid var(--sp-border-light); }
.clarification-item:last-child { border-bottom: none; }
.clarification-q, .clarification-a { display: flex; align-items: flex-start; gap: 10px; line-height: 1.6; }
.clarification-a { margin-top: 10px; padding-left: 4px; }
.clarification-issuer { font-size: 12px; color: var(--sp-gray-400); margin-left: auto; flex-shrink: 0; }
.bid-doc-head { display: flex; align-items: center; gap: 8px; font-size: 15px; color: var(--sp-gray-900); flex-wrap: wrap; margin-bottom: 8px; }
.bid-doc-head strong { font-weight: 700; }
.bid-doc-hint { font-size: 12px; color: var(--sp-gray-500); margin: 0 0 16px; }
.bid-doc-actions { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
</style>
