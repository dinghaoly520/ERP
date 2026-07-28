<script setup lang="ts">
import { ref, computed, onMounted, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { useNotificationStore } from '@/stores/notification'
import { ElMessage } from 'element-plus'
import SpPageHero from '@/components/SpPageHero.vue'
import { Bell, AlertTriangle, CircleCheck, CircleX, ClipboardList, AlarmClock, MessageSquare, LockOpen, BarChart3, Inbox, Send } from 'lucide-vue-next'
import dayjs from 'dayjs'

const router = useRouter(); const store = useNotificationStore(); const loading = ref(true); const error = ref(false); const currentPage = ref(1); const typeFilter = ref('')
const typeIconMap: Record<string, Component> = {SUPPLIER_APPROVED:CircleCheck,SUPPLIER_REJECTED:CircleX,SUPPLIER_RETURNED:AlertTriangle,BID_PUBLISHED:ClipboardList,BID_INVITED:Send,BID_REMINDER:AlarmClock,SYSTEM:Bell,CLARIFICATION_REPLIED:MessageSquare,BID_OPENING:LockOpen,BID_EVALUATION_RESULT:BarChart3}
const typeColorMap: Record<string, string> = {SUPPLIER_APPROVED:'#059669',SUPPLIER_REJECTED:'#dc2626',SUPPLIER_RETURNED:'#d97706',BID_PUBLISHED:'#2563eb',BID_INVITED:'#db2777',BID_REMINDER:'#ea580c',SYSTEM:'#475569',CLARIFICATION_REPLIED:'#0d9488',BID_OPENING:'#0891b2',BID_EVALUATION_RESULT:'#7c3aed'}
const typeLabels: Record<string,string> = {SUPPLIER_APPROVED:'入库审批',SUPPLIER_REJECTED:'驳回通知',SUPPLIER_RETURNED:'退回补正',BID_PUBLISHED:'采购项目发布',BID_INVITED:'采购项目邀请',BID_REMINDER:'开标提醒',SYSTEM:'系统通知',CLARIFICATION_REPLIED:'澄清答疑',BID_OPENING:'开标通知',BID_EVALUATION_RESULT:'评标结果'}
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
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else>
    <SpPageHero :icon="Bell" title="消息中心" sub="查看系统通知和业务消息，及时处理重要提醒。">
      <template #actions>
        <el-button @click="handleReadAll" :disabled="store.unreadCount===0"><el-icon><Check /></el-icon>全部标为已读</el-button>
      </template>
    </SpPageHero>

    <!-- Type filter tabs -->
    <div v-if="store.notifications.length>0" class="neu-tab-bar notif-tabs">
      <button class="neu-tab" :class="{ active: !typeFilter }" @click="typeFilter=''">全部</button>
      <button v-for="(label, key) in typeLabels" :key="key" class="neu-tab" :class="{ active: typeFilter===key }" @click="typeFilter=key">{{ label }}</button>
    </div>

    <div v-if="filteredNotifications.length>0" class="notif-list">
      <div v-for="n in filteredNotifications" :key="n.id" class="notif-row" :class="{unread:!n.isRead}" @click="handleClick(n)">
        <div class="notif-icon" :style="{ '--c': typeColorMap[n.type] || '#475569' } as any">
          <component :is="typeIconMap[n.type] || Inbox" :size="17" :stroke-width="1.75" />
        </div>
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
/* Type filter — concave tab bar (visuals from cgzxui .neu-tab*) */
.notif-tabs { display: flex; flex-wrap: wrap; margin: 16px 0; max-width: 100%; overflow-x: auto; }
.notif-tabs .neu-tab.active {
  color: var(--brand); background: var(--surface);
  box-shadow: inset 2px 2px 5px oklch(0.55 0.03 258 / 0.14), inset -2px -2px 5px oklch(1 0 0 / 0.7);
}

/* List — neumorphic plate (no glass / no drift) */
.notif-list {
  border: none; border-radius: 16px; overflow: hidden;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.notif-row { display: flex; align-items: flex-start; gap: 14px; padding: 16px 20px; border-bottom: 1px solid var(--hairline); cursor: pointer; transition: background 0.15s; }
.notif-row:last-child { border-bottom: none; }
.notif-row:hover { background: oklch(0.985 0.01 258 / 0.6); }
.notif-row.unread { background: color-mix(in oklab, var(--brand) 5%, transparent); }
.notif-row.unread:hover { background: color-mix(in oklab, var(--brand) 8%, transparent); }
.notif-icon {
  width: 38px; height: 38px; flex-shrink: 0; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: var(--c); background: color-mix(in oklab, var(--c) 12%, transparent);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6);
}
.notif-body { flex: 1; min-width: 0; }
.notif-row-title { font-size: 15px; font-weight: 700; color: var(--foreground); margin-bottom: 4px; }
.notif-row.unread .notif-row-title { font-weight: 800; }
.notif-row-content { font-size: 13px; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.notif-right { text-align: right; flex-shrink: 0; }
.notif-row-time { font-size: 12px; color: var(--muted-foreground); margin-bottom: 4px; font-variant-numeric: tabular-nums; }

.sp-empty-text { font-size: 15px; font-weight: 700; color: var(--muted-foreground); margin-top: 12px; }
.sp-empty-desc { font-size: 13px; margin-top: 4px; }
</style>
