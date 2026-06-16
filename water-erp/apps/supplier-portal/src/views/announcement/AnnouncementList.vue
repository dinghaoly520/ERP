<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAnnouncementStore } from '@/stores/announcement'
import dayjs from 'dayjs'

const router = useRouter(); const store = useAnnouncementStore(); const loading = ref(true); const error = ref(false); const activeType = ref(''); const search = ref(''); const currentPage = ref(1)

const typeOptions = [{label:'全部',value:''},{label:'招标公告',value:'BID_NOTICE'},{label:'中标公示',value:'WIN_NOTICE'},{label:'政策法规',value:'POLICY'},{label:'平台通知',value:'PLATFORM'}]
const typeTagMap: Record<string,{label:string;type:string}> = {BID_NOTICE:{label:'招标公告',type:'primary'},WIN_NOTICE:{label:'中标公示',type:'success'},POLICY:{label:'政策法规',type:'warning'},PLATFORM:{label:'平台通知',type:'info'}}
const lastVisit = ref<number>(0); try { const v = localStorage.getItem('supplier_announce_visit'); if (v) lastVisit.value = parseInt(v, 10) } catch {}
function isNew(ts: string): boolean { if (!ts || !lastVisit.value) return false; return new Date(ts).getTime() > lastVisit.value }

async function fetchData() { loading.value = true; error.value = false; try { await store.fetchAnnouncements({type:activeType.value||undefined,search:search.value||undefined,page:currentPage.value,pageSize:10}); localStorage.setItem('supplier_announce_visit', String(Date.now())); lastVisit.value = Date.now() } catch { error.value = true } finally { loading.value = false } }
function retryLoad() { fetchData() }
onMounted(fetchData)
function handleSearch() { currentPage.value = 1; fetchData() }
function handlePageChange(page:number) { currentPage.value = page; fetchData() }
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else>
    <div class="sp-page-hero-card">
      <div class="sp-page-hero-inner">
        <div class="sp-page-hero-body">
          <div class="sp-page-eyebrow blue"><el-icon :size="13"><Bell /></el-icon>Public Notices</div>
          <h1 class="sp-modern-title">公告公示</h1>
          <p class="sp-modern-desc">集中查看招标公告、中标公示、政策法规和平台通知。</p>
        </div>
      </div>
    </div>

    <div class="sp-filter-bar">
      <el-input v-model="search" placeholder="搜索公告标题" prefix-icon="Search" clearable size="default" style="width:280px" @keyup.enter="handleSearch" @clear="handleSearch" />
      <div class="sp-chip-group"><el-button v-for="t in typeOptions" :key="t.value" :type="activeType===t.value?'primary':'default'" class="sp-chip" size="small" @click="activeType=t.value;handleSearch()">{{ t.label }}</el-button></div>
    </div>

    <div v-if="store.announcements.length>0" class="announcement-list">
      <div v-for="a in store.announcements" :key="a.id" class="announcement-row" @click="router.push(`/announcements/${a.id}`)">
        <div class="ann-row-left"><el-tag :type="(typeTagMap[a.type]?.type as any)" size="small" effect="plain">{{ typeTagMap[a.type]?.label||a.type }}</el-tag><div class="ann-row-body"><span class="ann-row-title">{{ a.title }}</span><span class="ann-row-summary" v-if="a.summary">{{ a.summary }}</span></div></div>
        <div class="ann-row-right"><span v-if="a.isTop" class="top-badge">置顶</span><span v-if="isNew(a.publishDate||a.createdAt)" class="new-badge">新</span><span class="ann-row-date">{{ dayjs(a.publishDate||a.createdAt).format('YYYY-MM-DD') }}</span><el-icon class="ann-arrow"><ArrowRight /></el-icon></div>
      </div>
      <div style="display:flex;justify-content:center;padding-top:16px"><el-pagination v-model:current-page="currentPage" :total="store.total" :page-size="10" layout="prev,pager,next" @current-change="handlePageChange" /></div>
    </div>

    <div v-else class="sp-empty-panel"><el-icon :size="32"><Bell /></el-icon><p class="sp-empty-text">暂无公告</p><p class="sp-empty-desc">当前没有符合条件的公告信息</p></div>
    </template>
  </div>
</template>

<style scoped>
.announcement-list { background: #fff; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); overflow: hidden; }
.announcement-row { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--sp-border-light); cursor: pointer; transition: background 0.15s; }
.announcement-row:last-child { border-bottom: none; }
.announcement-row:hover { background: var(--sp-surface-hover); }
.ann-row-left { display: flex; align-items: flex-start; gap: 12px; flex: 1; min-width: 0; }
.ann-row-body { display: flex; flex-direction: column; min-width: 0; }
.ann-row-title { font-size: 15px; font-weight: 700; color: var(--sp-gray-900); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ann-row-summary { font-size: 13px; color: var(--sp-gray-500); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ann-row-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.top-badge { font-size: 11px; font-weight: 700; color: var(--sp-red); background: var(--sp-red-light); padding: 2px 8px; border-radius: 6px; }
.new-badge { font-size: 11px; font-weight: 700; color: var(--sp-primary); background: var(--sp-primary-lighter); padding: 2px 8px; border-radius: 6px; margin-right: 8px; }
.ann-row-date { font-size: 13px; color: var(--sp-gray-400); white-space: nowrap; }
.ann-arrow { color: var(--sp-gray-300); }
.sp-empty-panel { background: #fff; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); padding: 64px 20px; text-align: center; color: var(--sp-gray-400); }
.sp-empty-text { font-size: 15px; font-weight: 700; color: var(--sp-gray-500); margin-top: 12px; }
.sp-empty-desc { font-size: 13px; margin-top: 4px; }
</style>
