<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useBidStore } from '@/stores/bid'
import CountdownTimer from '@/components/CountdownTimer.vue'
import dayjs from 'dayjs'

const router = useRouter()
const bidStore = useBidStore()
const loading = ref(true)
const firstLoad = ref(true)
const error = ref(false)
const search = ref('')
const filterStage = ref('')

const stageMap: Record<string, { label: string; color: string }> = {
  DOWNLOAD: { label: '文件下载', color: '#0891b2' },
  SUBMIT: { label: '加密投递', color: '#0a5eb8' },
  OPENING: { label: '在线开标', color: '#d97706' },
  EVALUATING: { label: '专家评标', color: '#7c3aed' },
  ARCHIVED: { label: '已归档', color: '#059669' },
}
const stageFilters = [
  { label: '全部', value: '' }, { label: '下载', value: 'DOWNLOAD' }, { label: '投递', value: 'SUBMIT' },
  { label: '开标', value: 'OPENING' }, { label: '评标', value: 'EVALUATING' }, { label: '归档', value: 'ARCHIVED' },
]

const page = ref(1)
const pageSize = ref(10)
const filteredProjects = computed(() => {
  let list = bidStore.projects
  if (filterStage.value) list = list.filter((p: any) => p.stage === filterStage.value)
  if (search.value) { const s = search.value.toLowerCase(); list = list.filter((p: any) => p.name?.toLowerCase().includes(s) || p.projectCode?.toLowerCase().includes(s)) }
  return list
})
const totalPages = computed(() => Math.ceil(filteredProjects.value.length / pageSize.value))
const paginatedProjects = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredProjects.value.slice(start, start + pageSize.value)
})
const submitCount = computed(() => bidStore.projects.filter((p: any) => p.stage === 'SUBMIT').length)
const activeCount = computed(() => bidStore.projects.filter((p: any) => ['DOWNLOAD','SUBMIT','OPENING'].includes(p.stage)).length)
function stageCount(stage: string) { if (!stage) return bidStore.projects.length; return bidStore.projects.filter((p: any) => p.stage === stage).length }
onMounted(async () => { try { await bidStore.fetchProjects() } catch { error.value = true } finally { loading.value = false; firstLoad.value = false } })
function retryLoad() { error.value = false; loading.value = true; bidStore.fetchProjects().catch(() => { error.value = true }).finally(() => { loading.value = false }) }
function isDeadlinePassed(deadline: string) { return new Date(deadline) < new Date() }
</script>

<template>
  <div class="page-container">
    <div v-if="loading && firstLoad" class="skel-wrap">
      <div class="skel-hero"><span class="sp-skel" style="width:120px;height:13px"></span><span class="sp-skel" style="width:220px;height:24px;margin-top:12px"></span><span class="sp-skel" style="width:320px;height:14px;margin-top:10px"></span></div>
      <div class="skel-filter"><span class="sp-skel" style="width:300px;height:36px"></span><span class="sp-skel" style="flex:1;height:36px"></span></div>
      <div v-for="i in 5" :key="i" class="skel-row"><div style="flex:1"><span class="sp-skel" style="width:60%;height:18px"></span><span class="sp-skel" style="width:40%;height:12px;margin-top:10px"></span></div><span class="sp-skel" style="width:120px;height:36px"></span></div>
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
          <h1 class="sp-modern-title">投标机会</h1>
          <p class="sp-modern-desc">按项目关键节点快速筛选与进入详情，持续关注最新招标公告。</p>
        </div>
        <div class="sp-page-hero-actions">
          <div class="header-stat"><strong>{{ bidStore.projects.length }}</strong><span>全部</span></div>
          <div class="header-stat"><strong>{{ activeCount }}</strong><span>进行中</span></div>
          <div class="header-stat"><strong>{{ submitCount }}</strong><span>可投递</span></div>
        </div>
      </div>
    </div>

    <div class="compact-filter">
      <el-input v-model="search" placeholder="搜索项目名称或编号" prefix-icon="Search" clearable />
      <div class="stage-tabs">
        <button v-for="f in stageFilters" :key="f.value" :class="{ active: filterStage === f.value }" @click="filterStage = f.value">{{ f.label }} <span>{{ stageCount(f.value) }}</span></button>
      </div>
    </div>

    <div v-if="paginatedProjects.length > 0" class="opportunity-list">
      <div v-for="p in paginatedProjects" :key="p.id" class="opportunity-row" @click="router.push(`/bids/${p.id}`)">
        <div class="row-main">
          <div class="row-title-line"><h3>{{ p.name }}</h3>
            <span class="sp-status" :style="{ background: (stageMap[p.stage]?.color || '#94a3b8') + '18', color: stageMap[p.stage]?.color || '#94a3b8' }">{{ stageMap[p.stage]?.label || p.stage }}</span>
          </div>
          <div class="row-meta"><span>{{ p.projectCode }}</span><span>{{ p.procurementMethod }}</span><span>开标 {{ dayjs(p.openTime).format('MM-DD HH:mm') }}</span></div>
        </div>
        <div class="row-deadline" :class="{ expired: isDeadlinePassed(p.deadline) }">
          <small>投递截止</small><strong>{{ dayjs(p.deadline).format('MM-DD HH:mm') }}</strong>
          <CountdownTimer :deadline="p.deadline" />
        </div>
        <el-button type="primary" plain size="small">详情</el-button>
      </div>
    </div>

    <div v-if="totalPages > 1" class="pagination-wrap">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="filteredProjects.length"
        layout="prev, pager, next"
        background
      />
    </div>

    <div v-else class="sp-empty-panel">
      <el-icon :size="32"><Document /></el-icon>
      <p class="sp-empty-text">暂无招标项目</p>
      <p class="sp-empty-desc">当前没有符合条件的招标项目</p>
    </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.header-stat { padding: 12px 16px; border: 1px solid rgba(255,255,255,0.42); border-radius: var(--sp-radius-sm); background: rgba(255,255,255,0.62); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); text-align: center; min-width: 80px; }
.header-stat strong { display: block; color: var(--sp-gray-900); font-size: 22px; line-height: 1; }
.header-stat span { display: block; margin-top: 4px; color: var(--sp-gray-500); font-size: 11px; }
.compact-filter { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 14px; align-items: center; padding: 12px 16px; background: rgba(255,255,255,0.18); backdrop-filter: blur(18px) saturate(1.3); -webkit-backdrop-filter: blur(18px) saturate(1.3); border: 1px solid rgba(255,255,255,0.32); border-radius: var(--sp-radius-md); }
.compact-filter > * { position: relative; z-index: 1; }
.stage-tabs { display: flex; gap: 8px; overflow-x: auto; }
.stage-tabs button { border: 1px solid rgba(255,255,255,0.45); border-radius: 999px; background: rgba(255,255,255,0.60); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); color: var(--sp-gray-600); padding: 8px 14px; font-weight: 700; cursor: pointer; white-space: nowrap; font-size: 13px; }
.stage-tabs button span { margin-left: 5px; color: var(--sp-gray-400); }
.stage-tabs button.active { border-color: var(--sp-primary); background: var(--sp-primary); color: #fff; }
.stage-tabs button.active span { color: rgba(255,255,255,.76); }
.opportunity-list { display: grid; gap: 10px; margin-top: 18px; }
.opportunity-row { display: grid; grid-template-columns: minmax(0,1fr) 170px auto; gap: 18px; align-items: center; padding: 16px 20px; position: relative; background: rgba(255,255,255,0.58); backdrop-filter: blur(10px) saturate(1.1); -webkit-backdrop-filter: blur(12px) saturate(1.1); border: 1px solid rgba(255,255,255,0.42); border-radius: var(--sp-radius-md); cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s; }
.opportunity-row::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: 0.38; border-radius: inherit; background-image: radial-gradient(ellipse at 12% 8%, rgba(96,165,250,0.16), transparent 55%), radial-gradient(ellipse at 82% 16%, rgba(56,189,248,0.10), transparent 55%), radial-gradient(ellipse at 38% 88%, rgba(6,78,162,0.06), transparent 55%); animation: glass-glow-drift 18s ease-in-out infinite; }
.opportunity-row:hover::before { opacity: 0.55; }
.opportunity-row:hover { border-color: var(--sp-primary); box-shadow: 0 1px 8px rgba(15,47,87,0.08); }
.opportunity-row > * { position: relative; z-index: 1; }
.row-title-line { display: flex; align-items: center; gap: 10px; min-width: 0; }
.row-title-line h3 { margin: 0; color: var(--sp-gray-900); font-size: 16px; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 7px; color: var(--sp-gray-500); font-size: 12px; }
.row-deadline { padding-left: 18px; border-left: 1px solid rgba(0,0,0,0.05); }
.row-deadline small { display: block; color: var(--sp-gray-400); font-size: 11px; }
.row-deadline strong { display: block; color: var(--sp-gray-900); font-size: 14px; margin-top: 2px; }
.row-deadline.expired strong { color: var(--sp-red); }

.sp-empty-text { font-size: 15px; font-weight: 700; color: var(--sp-gray-500); margin-top: 12px; }
.sp-empty-desc { font-size: 13px; margin-top: 4px; }
.skel-wrap{display:flex;flex-direction:column;gap:14px}
.skel-hero{background:rgba(255,255,255,0.60);border:1px solid rgba(255,255,255,0.35);border-radius:var(--sp-radius-md);padding:24px;display:flex;flex-direction:column}
.skel-filter{display:flex;gap:14px;padding:12px 16px;border:1px solid rgba(255,255,255,0.35);border-radius:var(--sp-radius-md);background:rgba(255,255,255,0.60)}
.skel-row{display:flex;align-items:center;gap:18px;padding:16px 20px;border:1px solid rgba(255,255,255,0.35);border-radius:var(--sp-radius-md);background:rgba(255,255,255,0.60)}
@media (max-width: 900px) { .compact-filter { grid-template-columns: 1fr; } .opportunity-row { grid-template-columns: 1fr; } .row-deadline { padding-left: 0; border-left: 0; } }
</style>
