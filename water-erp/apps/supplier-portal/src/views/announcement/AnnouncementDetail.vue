<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAnnouncementStore } from '@/stores/announcement'
import { announcementApi } from '@/api/announcement'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'

const route = useRoute(); const router = useRouter(); const store = useAnnouncementStore()
const loading = ref(true); const error = ref(false); const id = computed(() => route.params.id as string)
const typeLabel: Record<string,string> = {BID_NOTICE:'招标公告',WIN_NOTICE:'中标公示',POLICY:'政策法规',PLATFORM:'平台通知'}
const typeTagType: Record<string,string> = {BID_NOTICE:'primary',WIN_NOTICE:'success',POLICY:'warning',PLATFORM:'info'}

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
    <el-button link @click="router.push('/announcements')" style="margin-bottom:16px"><el-icon><ArrowLeft /></el-icon>返回公告列表</el-button>

    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
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
      <div class="detail-content" v-html="store.currentAnnouncement.content"></div>

      <el-divider v-if="store.currentAnnouncement.relatedProjectCode" />
      <div v-if="store.currentAnnouncement.relatedProjectCode" class="detail-related"><el-icon><Link /></el-icon><span>关联项目：{{ store.currentAnnouncement.relatedProjectCode }}</span><el-button link type="primary" size="small" @click="router.push('/bids')">查看项目</el-button></div>

      <template v-if="isBidNotice"><el-divider /><div class="bid-doc-section" v-loading="bidDocLoading">
        <template v-if="bidDoc">
          <div class="bid-doc-head"><el-icon color="var(--sp-primary)"><Lock /></el-icon><strong>招标文件</strong><span class="bid-doc-title">{{ bidDoc.title }}</span><el-tag v-if="bidDoc.requirePayment" type="warning" size="small">付费 ¥{{ bidDoc.price }}</el-tag><el-tag v-else type="success" size="small">免费</el-tag></div>
          <p class="bid-doc-hint">{{ scopeHint(bidDoc.accessScope) }} · 已下载 {{ bidDoc.downloadCount }} 次</p>
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
.detail-card { background: #fff; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); padding: 28px; }
.detail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.detail-meta { display: flex; align-items: center; gap: 16px; font-size: 13px; color: var(--sp-gray-500); }
.top-badge { font-size: 11px; font-weight: 700; color: var(--sp-red); background: var(--sp-red-light); padding: 2px 8px; border-radius: 6px; }
@media print { .detail-card { border: none; box-shadow: none; font-size: 12pt; } }
.detail-title { font-size: 24px; font-weight: 800; color: var(--sp-gray-900); line-height: 1.4; }
.detail-content { font-size: 15px; line-height: 1.8; color: var(--sp-gray-700); }
.detail-content :deep(p) { margin-bottom: 12px; }
.detail-content :deep(h2),.detail-content :deep(h3) { margin: 24px 0 12px; color: var(--sp-gray-900); }
.detail-content :deep(table) { width: 100%; border-collapse: collapse; margin: 16px 0; }
.detail-content :deep(td),.detail-content :deep(th) { border: 1px solid var(--sp-border); padding: 10px 14px; font-size: 14px; }
.detail-content :deep(th) { background: var(--sp-gray-50); font-weight: 600; }
.detail-related { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: var(--sp-primary-lighter); border-radius: var(--sp-radius-sm); font-size: 14px; color: var(--sp-gray-700); }
.bid-doc-section { padding: 16px; background: var(--sp-gray-50); border-radius: var(--sp-radius-sm); border: 1px solid var(--sp-border); }
.bid-doc-head { display: flex; align-items: center; gap: 8px; font-size: 15px; color: var(--sp-gray-900); flex-wrap: wrap; }
.bid-doc-title { font-weight: 600; }
.bid-doc-hint { font-size: 12px; color: var(--sp-gray-500); margin: 8px 0 12px; }
.bid-doc-actions { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
</style>
