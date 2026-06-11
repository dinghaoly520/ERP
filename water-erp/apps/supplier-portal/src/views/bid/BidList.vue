<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useBidStore } from '@/stores/bid'
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
  { label: '文件下载', value: 'DOWNLOAD' },
  { label: '加密投递', value: 'SUBMIT' },
  { label: '在线开标', value: 'OPENING' },
  { label: '专家评标', value: 'EVALUATING' },
  { label: '已归档', value: 'ARCHIVED' },
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
  <div class="page-container" v-loading="loading">
    <div class="page-header">
      <h1 class="page-title">招标信息</h1>
      <p class="page-desc">浏览当前可用的招标项目，查看详情并提交投标文件</p>
    </div>

    <!-- Filters -->
    <div class="sp-card" style="padding: 16px 20px;">
      <el-row :gutter="16" align="middle">
        <el-col :xs="24" :sm="12" :md="8">
          <el-input v-model="search" placeholder="搜索项目名称或编号" prefix-icon="Search" clearable size="large" />
        </el-col>
        <el-col :xs="24" :sm="12" :md="16">
          <div class="stage-filters">
            <el-button
              v-for="f in stageFilters"
              :key="f.value"
              :type="filterStage === f.value ? 'primary' : 'default'"
              size="default"
              round
              @click="filterStage = f.value"
            >
              {{ f.label }}
            </el-button>
          </div>
        </el-col>
      </el-row>
    </div>

    <!-- Project list -->
    <div v-if="filteredProjects.length > 0" class="project-grid" style="margin-top: 16px;">
      <div v-for="p in filteredProjects" :key="p.id" class="sp-card project-card" @click="router.push(`/bids/${p.id}`)">
        <div class="project-card-top">
          <span
            class="sp-status"
            :style="{ background: (stageMap[p.stage]?.color || '#94a3b8') + '18', color: stageMap[p.stage]?.color || '#94a3b8' }"
          >
            {{ stageMap[p.stage]?.label || p.stage }}
          </span>
          <span class="project-code">{{ p.projectCode }}</span>
        </div>
        <h3 class="project-name">{{ p.name }}</h3>
        <div class="project-meta">
          <div class="meta-item">
            <el-icon><Document /></el-icon>
            <span>{{ p.procurementMethod }}</span>
          </div>
          <div class="meta-item">
            <el-icon><Clock /></el-icon>
            <span>截止：{{ dayjs(p.deadline).format('YYYY-MM-DD HH:mm') }}</span>
          </div>
          <div class="meta-item">
            <el-icon><Calendar /></el-icon>
            <span>开标：{{ dayjs(p.openTime).format('YYYY-MM-DD HH:mm') }}</span>
          </div>
        </div>
        <div class="project-footer">
          <div class="countdown" :class="{ urgent: !isDeadlinePassed(p.deadline) && getCountdown(p.deadline) !== '已截止' }">
            <el-icon><Timer /></el-icon>
            {{ getCountdown(p.deadline) }}
          </div>
          <el-button type="primary" text size="small">
            查看详情 <el-icon><ArrowRight /></el-icon>
          </el-button>
        </div>
      </div>
    </div>

    <!-- Empty -->
    <div v-else class="sp-card" style="margin-top: 16px;">
      <div class="sp-empty">
        <div class="sp-empty-icon">📋</div>
        <div class="sp-empty-text">暂无招标项目</div>
        <div class="sp-empty-desc">当前没有符合条件的招标项目</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
}

.project-card {
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
}

.project-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--sp-shadow-md);
  border-color: var(--sp-primary);
}

.project-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.project-code {
  font-size: 12px;
  color: var(--sp-gray-400);
  font-family: monospace;
}

.project-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--sp-gray-900);
  margin-bottom: 14px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.project-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--sp-gray-500);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.meta-item .el-icon { font-size: 14px; color: var(--sp-gray-400); }

.project-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid var(--sp-border-light);
}

.countdown {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 700;
  color: var(--sp-gray-500);
}

.countdown.urgent { color: var(--sp-red); }
</style>
