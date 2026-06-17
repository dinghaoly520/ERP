<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useNotificationStore } from '@/stores/notification'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'

const router = useRouter(); const store = useNotificationStore(); const loading = ref(true); const error = ref(false); const currentPage = ref(1); const typeFilter = ref('')
const typeIconMap: Record<string,string> = {SUPPLIER_APPROVED:'✅',SUPPLIER_REJECTED:'❌',SUPPLIER_RETURNED:'⚠️',BID_PUBLISHED:'📋',BID_REMINDER:'⏰',SYSTEM:'🔔'}
const typeLabels: Record<string,string> = {SUPPLIER_APPROVED:'入库审批',SUPPLIER_REJECTED:'驳回通知',SUPPLIER_RETURNED:'退回补正',BID_PUBLISHED:'招标公告',BID_REMINDER:'开标提醒',SYSTEM:'系统通知'}
const filteredNotifications = computed(() => {
  if (!typeFilter.value) return store.notifications
  return store.notifications.filter((n:any) => n.type === typeFilter.value)
})
async function fetchData() { loading.value = true; error.value = false; try { await store.fetchNotifications(currentPage.value,15) } catch { error.value = true } finally { loading.value = false } }
function retryLoad() { fetchData() }
onMounted(fetchData)
async function handleRead(id:string) { try { await store.markAsRead(id) } catch { ElMessage.error('标记失败，请重试') } }
async function handleReadAll() { try { await store.markAllAsRead(); store.fetchUnreadCount(); ElMessage.success('已全部标为已读') } catch { ElMessage.error('操作失败，请重试') } }
function handleClick(n:any) { if (!n.isRead) handleRead(n.id); if (n.link) router.push(n.link) }
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
          <h1 class="sp-modern-title">消息中心</h1>
          <p class="sp-modern-desc">查看系统通知和业务消息，及时处理重要提醒。</p>
        </div>
        <div class="sp-page-hero-actions">
          <el-button @click="handleReadAll" :disabled="store.unreadCount===0"><el-icon><Check /></el-icon>全部标为已读</el-button>
        </div>
      </div>
    </div>

    <!-- Type filter chips -->
    <div v-if="store.notifications.length>0" class="sp-chip-group" style="margin-bottom:16px">
      <el-tag :type="!typeFilter?'primary':'info'" class="sp-chip" style="cursor:pointer" @click="typeFilter=''">全部</el-tag>
      <el-tag v-for="(label, key) in typeLabels" :key="key" :type="typeFilter===key?'primary':'info'" class="sp-chip" style="cursor:pointer" @click="typeFilter=key">{{ label }}</el-tag>
    </div>

    <div v-if="filteredNotifications.length>0" class="notif-list">
      <div v-for="n in filteredNotifications" :key="n.id" class="notif-row" :class="{unread:!n.isRead}" @click="handleClick(n)">
        <div class="notif-icon">{{ typeIconMap[n.type]||'📬' }}</div>
        <div class="notif-body"><div class="notif-row-title">{{ n.title }}</div><div class="notif-row-content">{{ n.content }}</div></div>
        <div class="notif-right"><div class="notif-row-time">{{ dayjs(n.createdAt).format('MM-DD HH:mm') }}</div><el-button v-if="!n.isRead" text type="primary" size="small" @click.stop="handleRead(n.id)">标为已读</el-button></div>
      </div>
      <div style="display:flex;justify-content:center;padding:16px"><el-pagination v-model:current-page="currentPage" :total="store.total" :page-size="15" layout="prev,pager,next" @current-change="handlePageChange" /></div>
    </div>

    <div v-else-if="store.notifications.length>0" class="sp-empty-panel"><el-icon :size="32"><Search /></el-icon><p class="sp-empty-text">无匹配通知</p><p class="sp-empty-desc">该分类暂无通知，试试其他筛选</p></div>
    <div v-else class="sp-empty-panel"><el-icon :size="32"><ChatDotRound /></el-icon><p class="sp-empty-text">暂无消息</p><p class="sp-empty-desc">您没有未读消息</p></div>
    </template>
  </div>
</template>

<style scoped>
.notif-list { position: relative; background: rgba(255,255,255,0.58); backdrop-filter: blur(14px) saturate(1.15); -webkit-backdrop-filter: blur(14px) saturate(1.15); border: 1px solid rgba(255,255,255,0.50); border-radius: var(--sp-radius-md); overflow: hidden; }
.notif-list::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: 0.36; border-radius: inherit; background-image: radial-gradient(ellipse at 10% 6%, rgba(96,165,250,0.16), transparent 55%), radial-gradient(ellipse at 85% 12%, rgba(56,189,248,0.10), transparent 55%), radial-gradient(ellipse at 38% 90%, rgba(6,78,162,0.05), transparent 55%); animation: glass-glow-drift 18s ease-in-out infinite; }
.notif-list > * { position: relative; z-index: 1; }
.notif-row { display: flex; align-items: flex-start; gap: 14px; padding: 16px 20px; border-bottom: 1px solid rgba(0,0,0,0.04); cursor: pointer; transition: background 0.15s; }
.notif-row:last-child { border-bottom: none; }
.notif-row:hover { background: rgba(248,251,255,0.50); }
.notif-row.unread { background: rgba(239,246,255,0.48); }
.notif-row.unread:hover { background: rgba(224,238,255,0.55); }
.notif-icon { font-size: 28px; flex-shrink: 0; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; }
.notif-body { flex: 1; min-width: 0; }
.notif-row-title { font-size: 15px; font-weight: 700; color: var(--sp-gray-900); margin-bottom: 4px; }
.notif-row-content { font-size: 13px; color: var(--sp-gray-500); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.notif-right { text-align: right; flex-shrink: 0; }
.notif-row-time { font-size: 12px; color: var(--sp-gray-400); margin-bottom: 4px; }

.sp-empty-text { font-size: 15px; font-weight: 700; color: var(--sp-gray-500); margin-top: 12px; }
.sp-empty-desc { font-size: 13px; margin-top: 4px; }
</style>
