<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAnnouncementStore } from '@/stores/announcement'
import dayjs from 'dayjs'

const route = useRoute()
const router = useRouter()
const store = useAnnouncementStore()
const loading = ref(true)

const id = computed(() => route.params.id as string)

const typeLabel: Record<string, string> = {
  BID_NOTICE: '招标公告',
  WIN_NOTICE: '中标公示',
  POLICY: '政策法规',
  PLATFORM: '平台通知',
}

const typeTagType: Record<string, string> = {
  BID_NOTICE: 'primary',
  WIN_NOTICE: 'success',
  POLICY: 'warning',
  PLATFORM: 'info',
}

onMounted(async () => {
  try {
    await store.fetchAnnouncement(id.value)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page-container" v-loading="loading">
    <el-button link @click="router.push('/announcements')" style="margin-bottom: 16px;">
      <el-icon><ArrowLeft /></el-icon> 返回公告列表
    </el-button>

    <div class="sp-card" v-if="store.currentAnnouncement" style="max-width: 800px; margin: 0 auto;">
      <!-- Header -->
      <div class="detail-header">
        <el-tag :type="(typeTagType[store.currentAnnouncement.type] as any)" effect="plain" size="large">
          {{ typeLabel[store.currentAnnouncement.type] || store.currentAnnouncement.type }}
        </el-tag>
        <div class="detail-meta">
          <span v-if="store.currentAnnouncement.isTop" class="top-badge">置顶</span>
          <span>发布时间：{{ dayjs(store.currentAnnouncement.publishDate || store.currentAnnouncement.createdAt).format('YYYY年MM月DD日 HH:mm') }}</span>
          <span>阅读：{{ store.currentAnnouncement.viewCount }}次</span>
        </div>
      </div>

      <h1 class="detail-title">{{ store.currentAnnouncement.title }}</h1>

      <el-divider />

      <!-- Content -->
      <div class="detail-content" v-html="store.currentAnnouncement.content"></div>

      <!-- Related project -->
      <el-divider v-if="store.currentAnnouncement.relatedProjectCode" />
      <div v-if="store.currentAnnouncement.relatedProjectCode" class="detail-related">
        <el-icon><Link /></el-icon>
        <span>关联项目编号：{{ store.currentAnnouncement.relatedProjectCode }}</span>
        <el-button link type="primary" size="small" @click="router.push('/bids')">查看项目</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: var(--sp-gray-500);
}

.top-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--sp-red);
  background: var(--sp-red-light);
  padding: 2px 8px;
  border-radius: 4px;
}

.detail-title {
  font-size: 24px;
  font-weight: 800;
  color: var(--sp-gray-900);
  line-height: 1.4;
}

.detail-content {
  font-size: 15px;
  line-height: 1.8;
  color: var(--sp-gray-700);
}

.detail-content :deep(p) {
  margin-bottom: 12px;
}

.detail-content :deep(h2),
.detail-content :deep(h3) {
  margin: 24px 0 12px;
  color: var(--sp-gray-900);
}

.detail-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
}

.detail-content :deep(td),
.detail-content :deep(th) {
  border: 1px solid var(--sp-border);
  padding: 10px 14px;
  font-size: 14px;
}

.detail-content :deep(th) {
  background: var(--sp-gray-50);
  font-weight: 600;
}

.detail-related {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--sp-primary-lighter);
  border-radius: var(--sp-radius-sm);
  font-size: 14px;
  color: var(--sp-gray-700);
}
</style>
