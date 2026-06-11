<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useNotificationStore } from '@/stores/notification'
import dayjs from 'dayjs'

const router = useRouter()
const store = useNotificationStore()
const loading = ref(true)
const currentPage = ref(1)

const typeIconMap: Record<string, string> = {
  SUPPLIER_APPROVED: '✅',
  SUPPLIER_REJECTED: '❌',
  SUPPLIER_RETURNED: '⚠️',
  BID_PUBLISHED: '📋',
  BID_REMINDER: '⏰',
  SYSTEM: '🔔',
}

async function fetchData() {
  loading.value = true
  try {
    await store.fetchNotifications(currentPage.value, 15)
  } finally {
    loading.value = false
  }
}

onMounted(fetchData)

async function handleRead(id: string) {
  await store.markAsRead(id)
}

async function handleReadAll() {
  await store.markAllAsRead()
}

function handleClick(n: any) {
  if (!n.isRead) handleRead(n.id)
  if (n.link) router.push(n.link)
}

function handlePageChange(page: number) {
  currentPage.value = page
  fetchData()
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="sp-section-header">
      <div>
        <h1 class="page-title">消息中心</h1>
        <p class="page-desc">查看系统通知和业务消息</p>
      </div>
      <el-button @click="handleReadAll" :disabled="store.unreadCount === 0">
        <el-icon><Check /></el-icon>全部标为已读
      </el-button>
    </div>

    <div class="sp-card" v-if="store.notifications.length > 0">
      <div
        v-for="n in store.notifications"
        :key="n.id"
        class="notif-row"
        :class="{ unread: !n.isRead }"
        @click="handleClick(n)"
      >
        <div class="notif-icon">
          {{ typeIconMap[n.type] || '📬' }}
        </div>
        <div class="notif-body">
          <div class="notif-row-title">{{ n.title }}</div>
          <div class="notif-row-content">{{ n.content }}</div>
        </div>
        <div class="notif-right">
          <div class="notif-row-time">{{ dayjs(n.createdAt).format('MM-DD HH:mm') }}</div>
          <el-button v-if="!n.isRead" text type="primary" size="small" @click.stop="handleRead(n.id)">标为已读</el-button>
        </div>
      </div>

      <div style="display: flex; justify-content: center; padding-top: 16px;">
        <el-pagination
          v-model:current-page="currentPage"
          :total="store.total"
          :page-size="15"
          layout="prev, pager, next"
          @current-change="handlePageChange"
        />
      </div>
    </div>

    <div v-else class="sp-card">
      <div class="sp-empty">
        <div class="sp-empty-icon">📭</div>
        <div class="sp-empty-text">暂无消息</div>
        <div class="sp-empty-desc">您没有未读消息</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notif-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px 0;
  border-bottom: 1px solid var(--sp-border-light);
  cursor: pointer;
  transition: background 0.15s;
}

.notif-row:last-child { border-bottom: none; }
.notif-row:hover { background: var(--sp-gray-50); margin: 0 -24px; padding: 16px 24px; border-radius: 8px; }
.notif-row.unread { background: #f0f7ff; }
.notif-row.unread:hover { background: #e6f0ff; }

.notif-icon {
  font-size: 28px;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.notif-body {
  flex: 1;
  min-width: 0;
}

.notif-row-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--sp-gray-900);
  margin-bottom: 4px;
}

.notif-row-content {
  font-size: 13px;
  color: var(--sp-gray-500);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.notif-right {
  text-align: right;
  flex-shrink: 0;
}

.notif-row-time {
  font-size: 12px;
  color: var(--sp-gray-400);
  margin-bottom: 4px;
}
</style>
