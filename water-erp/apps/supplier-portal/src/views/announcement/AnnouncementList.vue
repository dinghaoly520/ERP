<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAnnouncementStore } from '@/stores/announcement'
import dayjs from 'dayjs'

const router = useRouter()
const store = useAnnouncementStore()
const loading = ref(true)
const activeType = ref('')
const search = ref('')
const currentPage = ref(1)

const typeOptions = [
  { label: '全部', value: '' },
  { label: '招标公告', value: 'BID_NOTICE' },
  { label: '中标公示', value: 'WIN_NOTICE' },
  { label: '政策法规', value: 'POLICY' },
  { label: '平台通知', value: 'PLATFORM' },
]

const typeTagMap: Record<string, { label: string; type: string }> = {
  BID_NOTICE: { label: '招标公告', type: 'primary' },
  WIN_NOTICE: { label: '中标公示', type: 'success' },
  POLICY: { label: '政策法规', type: 'warning' },
  PLATFORM: { label: '平台通知', type: 'info' },
}

async function fetchData() {
  loading.value = true
  try {
    await store.fetchAnnouncements({
      type: activeType.value || undefined,
      search: search.value || undefined,
      page: currentPage.value,
      pageSize: 10,
    })
  } finally {
    loading.value = false
  }
}

onMounted(fetchData)

function handleSearch() {
  currentPage.value = 1
  fetchData()
}

function handlePageChange(page: number) {
  currentPage.value = page
  fetchData()
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="sp-page-title-row">
      <div>
        <div class="sp-page-eyebrow">Public Notices</div>
        <h1 class="sp-modern-title">公告公示</h1>
        <p class="sp-modern-desc">集中查看招标公告、中标公示、政策法规和平台通知。</p>
      </div>
    </div>

    <!-- Filters -->
    <div class="sp-filter-panel">
      <el-row :gutter="16" align="middle">
        <el-col :xs="24" :sm="12" :md="8">
          <el-input v-model="search" placeholder="搜索公告标题" prefix-icon="Search" clearable size="large" @keyup.enter="handleSearch" @clear="handleSearch" />
        </el-col>
        <el-col :xs="24" :sm="12" :md="16">
          <div class="sp-chip-group">
            <el-button
              v-for="t in typeOptions"
              :key="t.value"
              :type="activeType === t.value ? 'primary' : 'default'"
              class="sp-chip"
              @click="activeType = t.value; handleSearch()"
            >
              {{ t.label }}
            </el-button>
          </div>
        </el-col>
      </el-row>
    </div>

    <!-- List -->
    <div class="sp-card" style="margin-top: 16px;" v-if="store.announcements.length > 0">
      <div
        v-for="a in store.announcements"
        :key="a.id"
        class="announcement-row"
        @click="router.push(`/announcements/${a.id}`)"
      >
        <div class="announcement-row-left">
          <el-tag :type="(typeTagMap[a.type]?.type as any)" size="small" effect="plain">
            {{ typeTagMap[a.type]?.label || a.type }}
          </el-tag>
          <div class="announcement-row-body">
            <span class="announcement-row-title">{{ a.title }}</span>
            <span class="announcement-row-summary" v-if="a.summary">{{ a.summary }}</span>
          </div>
        </div>
        <div class="announcement-row-right">
          <span v-if="a.isTop" class="top-badge">置顶</span>
          <span class="announcement-row-date">{{ dayjs(a.publishDate || a.createdAt).format('YYYY-MM-DD') }}</span>
          <el-button link type="primary">查看详情</el-button>
          <el-icon style="color: var(--sp-gray-300);"><ArrowRight /></el-icon>
        </div>
      </div>

      <div style="display: flex; justify-content: center; padding-top: 16px;">
        <el-pagination
          v-model:current-page="currentPage"
          :total="store.total"
          :page-size="10"
          layout="prev, pager, next"
          @current-change="handlePageChange"
        />
      </div>
    </div>

    <div v-else class="sp-card" style="margin-top: 16px;">
      <div class="sp-empty">
        <div class="sp-empty-icon">📢</div>
        <div class="sp-empty-text">暂无公告</div>
        <div class="sp-empty-desc">当前没有符合条件的公告信息</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.type-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.announcement-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: 1px solid var(--sp-border-light);
  cursor: pointer;
  transition: background 0.15s;
}

.announcement-row:last-child { border-bottom: none; }
.announcement-row:hover {
  background: var(--sp-primary-lighter);
  margin: 0 -18px;
  padding: 16px 18px;
  border-radius: var(--sp-radius-md);
}

.announcement-row-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.announcement-row-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.announcement-row-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--sp-gray-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.announcement-row-summary {
  font-size: 13px;
  color: var(--sp-gray-500);
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.announcement-row-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.top-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--sp-red);
  background: var(--sp-red-light);
  padding: 2px 8px;
  border-radius: 4px;
}

.announcement-row-date {
  font-size: 13px;
  color: var(--sp-gray-400);
  white-space: nowrap;
}
</style>
