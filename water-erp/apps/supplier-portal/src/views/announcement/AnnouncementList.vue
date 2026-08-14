<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAnnouncementStore } from '@/stores/announcement'
import SpPageHero from '@/components/SpPageHero.vue'
import { Megaphone, AlertTriangle, Bell } from 'lucide-vue-next'
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
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else>
    <SpPageHero :icon="Megaphone" title="公告公示" sub="集中查看招标公告、中标公示、政策法规和平台通知。" />

      <div class="neu-card ann-filter">
        <div class="neu-tab-bar ann-tabs">
          <button v-for="t in typeOptions" :key="t.value" class="neu-tab" :class="{ active: activeType===t.value }" @click="activeType=t.value;handleSearch()">{{ t.label }}</button>
        </div>
        <el-input v-model="search" placeholder="搜索公告标题" prefix-icon="Search" clearable size="default" style="width:280px;flex-shrink:0" @keyup.enter="handleSearch" @clear="handleSearch" />
      </div>

    <div v-if="store.announcements.length>0" class="announcement-list">
      <div v-for="a in store.announcements" :key="a.id" class="announcement-row" @click="router.push(`/announcements/${a.id}`)">
        <div class="ann-row-left"><el-tag :type="(typeTagMap[a.type]?.type as any)" size="small" effect="plain">{{ typeTagMap[a.type]?.label||a.type }}</el-tag><div class="ann-row-body"><span class="ann-row-title">{{ a.title }}</span><span class="ann-row-summary" v-if="a.summary">{{ a.summary }}</span></div></div>
        <div class="ann-row-right"><span v-if="a.isTop" class="top-badge">置顶</span><span v-if="isNew(a.publishDate||a.createdAt)" class="new-badge">新</span><span class="ann-row-date">{{ dayjs(a.publishDate||a.createdAt).format('YYYY-MM-DD') }}</span><el-icon class="ann-arrow"><ArrowRight /></el-icon></div>
      </div>
      <div style="display:flex;justify-content:center;padding-top:16px"><el-pagination v-model:current-page="currentPage" :total="store.total" :page-size="10" layout="prev,pager,next" @current-change="handlePageChange" /></div>
    </div>

    <div v-else class="sp-empty-panel"><div class="sp-empty-icon"><Bell :size="22" :stroke-width="1.75" /></div><p class="sp-empty-text">暂无公告</p><p class="sp-empty-desc">当前没有符合条件的公告信息</p></div>
    </template>
  </div>
</template>

<style scoped>
/* Filter plate — neumorphic; layout only (visuals from cgzxui .neu-card / .neu-tab*) */
.ann-filter { display: flex; flex-direction: row; align-items: center; gap: 16px; padding: 10px 16px; margin: 16px 0; }
.ann-filter :deep(.el-input) { flex-shrink: 0; }
.ann-tabs { display: flex; flex-shrink: 0; gap: 4px; }
.ann-tabs .neu-tab { padding: 6px 12px; font-size: 12px; }
.ann-tabs .neu-tab.active {
  color: var(--brand); background: var(--surface);
  box-shadow: inset 2px 2px 5px oklch(0.55 0.03 258 / 0.14), inset -2px -2px 5px oklch(1 0 0 / 0.7);
}

/* List — neumorphic plate (no glass / no drift) */
.announcement-list {
  border: none; border-radius: 16px; overflow: hidden;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.announcement-row { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--hairline); cursor: pointer; transition: background 0.15s; }
.announcement-row:last-child { border-bottom: none; }
.announcement-row:hover { background: oklch(0.985 0.01 258 / 0.6); }
.ann-row-left { display: flex; align-items: flex-start; gap: 12px; flex: 1; min-width: 0; }
.ann-row-body { display: flex; flex-direction: column; min-width: 0; }
.ann-row-title { font-size: 15px; font-weight: 700; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ann-row-summary { font-size: 13px; color: var(--muted-foreground); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ann-row-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.top-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; color: var(--danger); background: color-mix(in oklab, var(--danger) 10%, transparent); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.new-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; margin-right: 8px; color: var(--brand); background: color-mix(in oklab, var(--brand) 10%, transparent); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.ann-row-date { font-size: 13px; color: var(--muted-foreground); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ann-arrow { color: var(--muted-foreground); }

.sp-empty-text { font-size: 15px; font-weight: 700; color: var(--muted-foreground); margin-top: 12px; }
.sp-empty-desc { font-size: 13px; margin-top: 4px; }
</style>
