<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useBidStore } from '@/stores/bid'
import CountdownTimer from '@/components/CountdownTimer.vue'
import dayjs from 'dayjs'

const router = useRouter()
const bidStore = useBidStore()
const loading = ref(true)
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

const filteredProjects = computed(() => {
  let list = bidStore.projects
  if (filterStage.value) list = list.filter((p: any) => p.stage === filterStage.value)
  if (search.value) { const s = search.value.toLowerCase(); list = list.filter((p: any) => p.name?.toLowerCase().includes(s) || p.projectCode?.toLowerCase().includes(s)) }
  return list
})
const submitCount = computed(() => bidStore.projects.filter((p: any) => p.stage === 'SUBMIT').length)
const activeCount = computed(() => bidStore.projects.filter((p: any) => ['DOWNLOAD','SUBMIT','OPENING'].includes(p.stage)).length)
function stageCount(stage: string) { if (!stage) return bidStore.projects.length; return bidStore.projects.filter((p: any) => p.stage === stage).length }
onMounted(async () => { try { await bidStore.fetchProjects() } finally { loading.value = false } })
function isDeadlinePassed(deadline: string) { return new Date(deadline) < new Date() }
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="sp-page-hero-card">
      <div class="sp-page-hero-inner">
        <div class="sp-page-hero-body">
          <div class="sp-page-eyebrow blue"><el-icon :size="13"><Document /></el-icon>Tender Opportunities</div>
          <h1 class="sp-modern-title">招标机会</h1>
          <p class="sp-modern-desc">按项目关键节点快速筛选与进入详情，持续关注最新招标。</p>
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

    <div v-if="filteredProjects.length > 0" class="opportunity-list">
      <div v-for="p in filteredProjects" :key="p.id" class="opportunity-row" @click="router.push(`/bids/${p.id}`)">
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

    <div v-else class="sp-empty-panel">
      <el-icon :size="32"><Document /></el-icon>
      <p class="sp-empty-text">暂无招标项目</p>
      <p class="sp-empty-desc">当前没有符合条件的招标项目</p>
    </div>
  </div>
</template>

<style scoped>
.header-stat { padding: 12px 16px; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-sm); background: #fff; text-align: center; min-width: 80px; }
.header-stat strong { display: block; color: var(--sp-gray-900); font-size: 22px; line-height: 1; }
.header-stat span { display: block; margin-top: 4px; color: var(--sp-gray-500); font-size: 11px; }
.compact-filter { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 14px; align-items: center; padding: 12px 16px; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); background: #fff; }
.stage-tabs { display: flex; gap: 8px; overflow-x: auto; }
.stage-tabs button { border: 1px solid var(--sp-border); border-radius: 999px; background: #fff; color: var(--sp-gray-600); padding: 8px 14px; font-weight: 700; cursor: pointer; white-space: nowrap; font-size: 13px; }
.stage-tabs button span { margin-left: 5px; color: var(--sp-gray-400); }
.stage-tabs button.active { border-color: var(--sp-primary); background: var(--sp-primary); color: #fff; }
.stage-tabs button.active span { color: rgba(255,255,255,.76); }
.opportunity-list { display: grid; gap: 10px; margin-top: 18px; }
.opportunity-row { display: grid; grid-template-columns: minmax(0,1fr) 170px auto; gap: 18px; align-items: center; padding: 16px 20px; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); background: #fff; cursor: pointer; transition: border-color 0.15s; }
.opportunity-row:hover { border-color: var(--sp-primary); }
.row-title-line { display: flex; align-items: center; gap: 10px; min-width: 0; }
.row-title-line h3 { margin: 0; color: var(--sp-gray-900); font-size: 16px; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 7px; color: var(--sp-gray-500); font-size: 12px; }
.row-deadline { padding-left: 18px; border-left: 1px solid var(--sp-border-light); }
.row-deadline small { display: block; color: var(--sp-gray-400); font-size: 11px; }
.row-deadline strong { display: block; color: var(--sp-gray-900); font-size: 14px; margin-top: 2px; }
.row-deadline.expired strong { color: var(--sp-red); }
.sp-empty-panel { background: #fff; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); padding: 64px 20px; text-align: center; color: var(--sp-gray-400); }
.sp-empty-text { font-size: 15px; font-weight: 700; color: var(--sp-gray-500); margin-top: 12px; }
.sp-empty-desc { font-size: 13px; margin-top: 4px; }
@media (max-width: 900px) { .compact-filter { grid-template-columns: 1fr; } .opportunity-row { grid-template-columns: 1fr; } .row-deadline { padding-left: 0; border-left: 0; } }
</style>
