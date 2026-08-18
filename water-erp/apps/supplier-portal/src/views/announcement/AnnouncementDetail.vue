<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAnnouncementStore } from '@/stores/announcement'
import { announcementApi } from '@/api/announcement'
import { ElMessage } from 'element-plus'
import SpPageHero from '@/components/SpPageHero.vue'
import { ScrollText, AlertTriangle } from 'lucide-vue-next'
import dayjs from 'dayjs'

const route = useRoute(); const router = useRouter(); const store = useAnnouncementStore()
const loading = ref(true); const error = ref(false); const id = computed(() => route.params.id as string)
const typeLabel: Record<string,string> = {BID_NOTICE:'采购公告',WIN_NOTICE:'中标公告',POLICY:'政策法规',PLATFORM:'平台通知'}
const typeTagType: Record<string,string> = {BID_NOTICE:'primary',WIN_NOTICE:'success',POLICY:'warning',PLATFORM:'info'}

// ── 结构化元数据字段定义（与采购管理工作台 :3005 保持一致）──
interface MetaField { key: string; label: string; area?: boolean; date?: boolean }
const ANNO_TYPE_META: Record<string, MetaField[]> = {
  BID_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'method', label: '招标方式' }, { key: 'budget', label: '预算金额' },
    { key: 'downloadDeadline', label: '采购文件下载时间' },
    { key: 'deadline', label: '报名/投标截止', date: true }, { key: 'openTime', label: '开标时间', date: true }, { key: 'contact', label: '联系方式' },
    { key: 'scope', label: '采购内容/范围', area: true }, { key: 'qualification', label: '投标人资格要求', area: true },
  ],
  WIN_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'winner', label: '中标供应商' }, { key: 'amount', label: '中标金额' },
    { key: 'period', label: '工期/交货期' }, { key: 'quality', label: '质量标准' }, { key: 'experts', label: '评审专家' },
    { key: 'publicityPeriod', label: '公示期' }, { key: 'objection', label: '异议渠道', area: true },
  ],
  POLICY: [
    { key: 'docNo', label: '文号' }, { key: 'issuer', label: '发布机关' }, { key: 'effectiveDate', label: '生效日期' },
    { key: 'scope', label: '适用范围', area: true },
  ],
  PLATFORM: [
    { key: 'impactScope', label: '影响范围' }, { key: 'changes', label: '功能变化', area: true }, { key: 'schedule', label: '时间安排' },
    { key: 'guide', label: '操作指引', area: true }, { key: 'support', label: '支持渠道' },
  ],
}
function fmtMeta(field: MetaField, raw: any): string {
  if (raw == null || raw === '') return ''
  if (field.date) {
    const d = new Date(raw)
    if (isNaN(d.getTime())) return '待定'
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }
  if ((field.key === 'budget' || field.key === 'amount') && raw) {
    const n = Number(raw)
    if (!isNaN(n) && n >= 10000) return (n / 10000).toFixed(0) + ' 万元'
  }
  return String(raw)
}
function metaLabelColor(f: MetaField): string {
  if (f.key === 'projectCode' || f.key === 'docNo') return 'var(--brand)'
  if (f.key === 'budget' || f.key === 'amount') return 'var(--success)'
  if (f.date) return 'var(--warning)'
  return 'var(--muted-foreground)'
}
const metaFields = computed(() => {
  const a = store.currentAnnouncement as any
  const meta = (a?.metadata || {}) as Record<string, any>
  const fields = (ANNO_TYPE_META[a?.type] || []).filter(f => meta[f.key])
  return { short: fields.filter(f => !f.area), area: fields.filter(f => f.area), meta }
})

const bidDoc = ref<any>(null); const bidDocLoading = ref(false); const paying = ref(false); const downloading = ref(false); const payDialog = ref(false); const paymentRef = ref('')
const isBidNotice = computed(() => store.currentAnnouncement?.type==='BID_NOTICE')

async function loadBidDoc() { if (!isBidNotice.value) return; bidDocLoading.value = true; try { bidDoc.value = await announcementApi.getBidDocument(id.value) as any } catch { bidDoc.value = null } bidDocLoading.value = false }
async function doPay() { paying.value = true; try { await announcementApi.payBidDocument(id.value, paymentRef.value||undefined); ElMessage.success('付款凭证已提交'); payDialog.value = false; paymentRef.value = ''; await loadBidDoc() } catch (e:any) { ElMessage.error(e?.message||'提交失败') } paying.value = false }
async function doDownload() { downloading.value = true; try { const {blob,fileName} = await announcementApi.downloadBidDocument(id.value); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fileName; a.click(); URL.revokeObjectURL(url); await loadBidDoc() } catch (e:any) { ElMessage.error(e?.message||'下载失败') } downloading.value = false }
function scopeHint(scope:string) { if (scope==='DESIGNATED') return '仅指定供应商可下载'; if (scope==='INVITED') return '仅受邀供应商可下载'; return '全库供应商可下载' }
onMounted(async () => { try { await store.fetchAnnouncement(id.value); await loadBidDoc() } catch { error.value = true } finally { loading.value = false } })
async function retryLoad() { error.value = false; loading.value = true; try { await store.fetchAnnouncement(id.value); await loadBidDoc() } catch { error.value = true } finally { loading.value = false } }
</script>

<template>
  <div class="page-container" v-loading="loading">
    <SpPageHero :icon="ScrollText" title="公告详情" sub="阅读公告全文，采购公告可在此查阅并下载招标文件。" />

    <button class="flow-back" @click="router.push('/announcements')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flow-back-arrow"><path d="M15 18l-6-6 6-6"/></svg>
      返回公告列表
    </button>

    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <div class="detail-card" v-else-if="store.currentAnnouncement">
      <div class="detail-header">
        <el-tag :type="(typeTagType[store.currentAnnouncement.type] as any)" effect="plain" size="large">{{ typeLabel[store.currentAnnouncement.type]||store.currentAnnouncement.type }}</el-tag>
        <div class="detail-meta"><span v-if="store.currentAnnouncement.isTop" class="top-badge">置顶</span><span>发布时间：{{ dayjs(store.currentAnnouncement.publishDate||store.currentAnnouncement.createdAt).format('YYYY年MM月DD日 HH:mm') }}</span><span>阅读：{{ store.currentAnnouncement.viewCount }}次</span></div>
      </div>
      <h1 class="detail-title">{{ store.currentAnnouncement.title }}</h1>
      <el-divider />

      <!-- 结构化元数据（项目编号/招标方式/预算金额/时间等）—— 与采购管理工作台一致 -->
      <div v-if="metaFields.short.length || metaFields.area.length" class="meta-block">
        <div v-if="metaFields.short.length" class="meta-chips">
          <span v-for="f in metaFields.short" :key="f.key" class="meta-chip">
            <span class="meta-chip-label" :style="{ color: metaLabelColor(f) }">{{ f.label }}</span>
            <span class="meta-chip-value">{{ fmtMeta(f, metaFields.meta[f.key]) }}</span>
          </span>
        </div>
        <div v-for="f in metaFields.area" :key="f.key" class="meta-area">
          <span class="meta-area-label">{{ f.label }}</span>
          <p class="meta-area-text">{{ metaFields.meta[f.key] }}</p>
        </div>
      </div>

      <div class="detail-content" v-html="store.currentAnnouncement.content"></div>

      <el-divider v-if="store.currentAnnouncement.relatedProjectCode" />
      <div v-if="store.currentAnnouncement.relatedProjectCode" class="detail-related"><el-icon class="detail-related-icon"><Link /></el-icon><span>关联项目：{{ store.currentAnnouncement.relatedProjectCode }}</span><el-button link type="primary" size="small" @click="router.push('/bids')">查看项目</el-button></div>

      <template v-if="isBidNotice"><el-divider /><div class="bid-doc-section" v-loading="bidDocLoading">
        <template v-if="bidDoc">
          <div class="bid-doc-head"><el-icon class="bid-doc-lock"><Lock /></el-icon><strong>招标文件</strong><span class="bid-doc-title">{{ bidDoc.title }}</span><el-tag v-if="bidDoc.requirePayment" type="warning" size="small">付费 ¥{{ bidDoc.price }}</el-tag><el-tag v-else type="success" size="small">免费</el-tag></div>
          <p class="bid-doc-hint">{{ scopeHint(bidDoc.accessScope) }}</p>
          <div class="bid-doc-actions">
            <el-alert v-if="!bidDoc.eligible" :title="'无法下载：'+bidDoc.reason" type="error" :closable="false" show-icon />
            <template v-else>
              <template v-if="bidDoc.needPayment"><el-alert title="该招标文件需付费下载" type="warning" :closable="false" show-icon /><el-button type="primary" @click="payDialog=true">提交付款凭证</el-button></template>
              <el-alert v-else-if="bidDoc.requirePayment&&!bidDoc.paid" title="付款凭证已提交，等待确认到账" type="info" :closable="false" show-icon />
              <el-button v-if="bidDoc.canDownload" type="primary" :loading="downloading" @click="doDownload"><el-icon><Download /></el-icon>下载招标文件</el-button>
            </template>
          </div>
        </template>
        <el-empty v-else-if="!bidDocLoading" description="暂无招标文件" :image-size="60" />
      </div></template>
    </div>

    <el-dialog v-model="payDialog" title="提交付款凭证" width="420px"><el-form><el-form-item label="付款凭证/流水号"><el-input v-model="paymentRef" placeholder="如：银行流水号" /></el-form-item></el-form><template #footer><el-button @click="payDialog=false">取消</el-button><el-button type="primary" :loading="paying" @click="doPay">提交</el-button></template></el-dialog>
  </div>
</template>

<style scoped>
.flow-back { margin: 16px 0; }

/* Detail card — neumorphic plate (no glass / no drift) */
.detail-card {
  padding: 28px; border: none; border-radius: 16px;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
@media print { .detail-card { box-shadow: none; font-size: 12pt; } }
.detail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.detail-meta { display: flex; align-items: center; gap: 16px; font-size: 13px; color: var(--muted-foreground); }
.top-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; color: var(--danger); background: color-mix(in oklab, var(--danger) 10%, transparent); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.detail-title { font-size: 24px; font-weight: 800; color: var(--foreground); line-height: 1.4; }
/* 结构化元数据 chips —— 与采购管理工作台一致 */
.meta-block { margin-bottom: 8px; }
.meta-chips { display: flex; flex-wrap: wrap; gap: 12px 18px; }
.meta-chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 8px; background: oklch(1 0 0 / 0.55); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 1px 2px oklch(0.55 0.03 258 / 0.08); }
.meta-chip-label { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; }
.meta-chip-value { font-size: 13px; font-weight: 600; color: var(--foreground); }
.meta-area { margin-top: 12px; padding: 12px 16px; border-radius: 10px; background: color-mix(in oklab, var(--brand) 6%, transparent); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.5); }
.meta-area-label { font-size: 11px; font-weight: 700; color: var(--brand); }
.meta-area-text { margin: 6px 0 0; font-size: 14px; line-height: 1.7; color: var(--foreground); white-space: pre-wrap; }
.detail-content { font-size: 15px; line-height: 1.8; color: var(--foreground); }
.detail-content :deep(p) { margin-bottom: 12px; }
.detail-content :deep(h2),.detail-content :deep(h3) { margin: 24px 0 12px; color: var(--foreground); }
.detail-content :deep(table) { width: 100%; border-collapse: collapse; margin: 16px 0; }
.detail-content :deep(td),.detail-content :deep(th) { border: 1px solid var(--hairline); padding: 10px 14px; font-size: 14px; }
.detail-content :deep(th) { background: oklch(1 0 0 / 0.4); font-weight: 600; }
/* Related-project callout — brand-tinted surface */
.detail-related { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border: none; border-radius: 12px; font-size: 14px; color: var(--foreground); background: color-mix(in oklab, var(--brand) 7%, transparent); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.detail-related-icon { color: var(--brand); }
/* Bid document well — concave subsurface */
.bid-doc-section { padding: 16px; border: none; border-radius: 12px; background: var(--surface); box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.10), inset -3px -3px 7px oklch(1 0 0 / 0.8); }
.bid-doc-head { display: flex; align-items: center; gap: 8px; font-size: 15px; color: var(--foreground); flex-wrap: wrap; }
.bid-doc-lock { color: var(--brand); }
.bid-doc-title { font-weight: 600; }
.bid-doc-hint { font-size: 12px; color: var(--muted-foreground); margin: 8px 0 12px; }
.bid-doc-actions { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
</style>
