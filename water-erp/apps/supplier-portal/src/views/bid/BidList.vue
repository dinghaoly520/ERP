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
  { label: '全部', value: '' },
  { label: '下载', value: 'DOWNLOAD' },
  { label: '投递', value: 'SUBMIT' },
  { label: '开标', value: 'OPENING' },
  { label: '评标', value: 'EVALUATING' },
  { label: '归档', value: 'ARCHIVED' },
]

const filteredProjects = computed(() => {
  let list = bidStore.projects
  if (filterStage.value) list = list.filter((p: any) => p.stage === filterStage.value)
  if (search.value) {
    const s = search.value.toLowerCase()
    list = list.filter((p: any) => p.name?.toLowerCase().includes(s) || p.projectCode?.toLowerCase().includes(s))
  }
  return list
})

const submitCount = computed(() => bidStore.projects.filter((p: any) => p.stage === 'SUBMIT').length)
const activeCount = computed(() => bidStore.projects.filter((p: any) => ['DOWNLOAD', 'SUBMIT', 'OPENING'].includes(p.stage)).length)

function stageCount(stage: string) {
  if (!stage) return bidStore.projects.length
  return bidStore.projects.filter((p: any) => p.stage === stage).length
}

onMounted(async () => {
  try {
    await bidStore.fetchProjects()
  } finally {
    loading.value = false
  }
})

function isDeadlinePassed(deadline: string) {
  return new Date(deadline) < new Date()
}

function getCountdown(deadline: string) {
  const diff = new Date(deadline).getTime() - Date.now()
  if (diff <= 0) return '已截止'
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  if (days > 0) return `${days}天${hours}时`
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}时${mins}分`
}
</script>

<template>
  <div class="page-container bid-opportunity-page" v-loading="loading">
    <div class="opportunity-header">
      <div>
        <div class="sp-page-eyebrow">Tender Opportunities</div>
        <h1 class="sp-modern-title">招标机会</h1>
        <p class="sp-modern-desc">减少卡片堆叠，按项目关键节点快速筛选与进入详情。</p>
      </div>
      <div class="header-stats">
        <div><strong>{{ bidStore.projects.length }}</strong><span>全部项目</span></div>
        <div><strong>{{ activeCount }}</strong><span>进行中</span></div>
        <div><strong>{{ submitCount }}</strong><span>可投递</span></div>
      </div>
    </div>

    <div class="compact-filter">
      <el-input v-model="search" placeholder="搜索项目名称或编号" prefix-icon="Search" clearable />
      <div class="stage-tabs">
        <button v-for="f in stageFilters" :key="f.value" :class="{ active: filterStage === f.value }" @click="filterStage = f.value">
          {{ f.label }} <span>{{ stageCount(f.value) }}</span>
        </button>
      </div>
    </div>

    <div v-if="filteredProjects.length > 0" class="opportunity-list">
      <div v-for="p in filteredProjects" :key="p.id" class="opportunity-row" @click="router.push(`/bids/${p.id}`)">
        <div class="row-main">
          <div class="row-title-line">
            <h3>{{ p.name }}</h3>
            <span class="sp-status" :style="{ background: (stageMap[p.stage]?.color || '#94a3b8') + '18', color: stageMap[p.stage]?.color || '#94a3b8' }">
              {{ stageMap[p.stage]?.label || p.stage }}
            </span>
          </div>
          <div class="row-meta">
            <span>{{ p.projectCode }}</span>
            <span>{{ p.procurementMethod }}</span>
            <span>开标 {{ dayjs(p.openTime).format('MM-DD HH:mm') }}</span>
          </div>
        </div>
        <div class="row-deadline" :class="{ expired: isDeadlinePassed(p.deadline) }">
          <small>投递截止</small>
          <strong>{{ dayjs(p.deadline).format('MM-DD HH:mm') }}</strong>
          <CountdownTimer :deadline="p.deadline" />
        </div>
        <el-button type="primary" plain size="small">详情</el-button>
      </div>
    </div>

    <div v-else class="sp-card">
      <div class="sp-empty">
        <div class="sp-empty-icon">📋</div>
        <div class="sp-empty-text">暂无招标项目</div>
        <div class="sp-empty-desc">当前没有符合条件的招标项目</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bid-opportunity-page { max-width: 1440px; }
.opportunity-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
.header-stats { display: grid; grid-template-columns: repeat(3, 92px); gap: 10px; }
.header-stats div { padding: 12px; border: 1px solid var(--sp-border); border-radius: 14px; background: rgba(255,255,255,.88); text-align: center; }
.header-stats strong { display: block; color: var(--sp-gray-900); font-size: 22px; line-height: 1; }
.header-stats span { display: block; margin-top: 5px; color: var(--sp-gray-500); font-size: 12px; }
.compact-filter { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 14px; align-items: center; padding: 14px; border: 1px solid var(--sp-border); border-radius: 18px; background: rgba(255,255,255,.92); box-shadow: var(--sp-shadow-sm); }
.stage-tabs { display: flex; gap: 8px; overflow-x: auto; }
.stage-tabs button { border: 1px solid var(--sp-border); border-radius: 999px; background: #fff; color: var(--sp-gray-600); padding: 8px 12px; font-weight: 800; cursor: pointer; white-space: nowrap; }
.stage-tabs button span { margin-left: 5px; color: var(--sp-gray-400); }
.stage-tabs button.active { border-color: var(--sp-primary); background: var(--sp-primary); color: #fff; }
.stage-tabs button.active span { color: rgba(255,255,255,.76); }
.opportunity-list { display: grid; gap: 10px; margin-top: 16px; }
.opportunity-row { display: grid; grid-template-columns: minmax(0, 1fr) 170px auto; gap: 18px; align-items: center; padding: 16px 18px; border: 1px solid var(--sp-border); border-radius: 16px; background: rgba(255,255,255,.94); box-shadow: var(--sp-shadow-xs); cursor: pointer; transition: all .18s ease; }
.opportunity-row:hover { transform: translateY(-1px); border-color: rgba(22,132,216,.45); box-shadow: var(--sp-shadow-sm); }
.row-title-line { display: flex; align-items: center; gap: 10px; min-width: 0; }
.row-title-line h3 { margin: 0; color: var(--sp-gray-900); font-size: 16px; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 7px; color: var(--sp-gray-500); font-size: 12px; }
.row-deadline { padding-left: 18px; border-left: 1px solid var(--sp-border-light); }
.row-deadline small { display: block; color: var(--sp-gray-400); font-size: 11px; }
.row-deadline strong { display: block; color: var(--sp-gray-900); font-size: 14px; }
.row-deadline.expired strong { color: var(--sp-red); }
@media (max-width: 900px) { .opportunity-header, .compact-filter { grid-template-columns: 1fr; flex-direction: column; align-items: stretch; } .header-stats { grid-template-columns: repeat(3, 1fr); } .opportunity-row { grid-template-columns: 1fr; } .row-deadline { padding-left: 0; border-left: 0; } }
</style>
