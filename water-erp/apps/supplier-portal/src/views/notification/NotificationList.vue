<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, type Component } from 'vue'

import { useNotificationStore } from '@/stores/notification'
import { ElMessage } from 'element-plus'
import SpPageHero from '@/components/SpPageHero.vue'
import { Bell, AlertTriangle, CircleCheck, CircleX, ClipboardList, AlarmClock, MessageSquare, LockOpen, BarChart3, Inbox, Send, Trophy } from 'lucide-vue-next'
import dayjs from 'dayjs'

const store = useNotificationStore(); const loading = ref(true); const error = ref(false); const currentPage = ref(1); const typeFilter = ref('')
const typeIconMap: Record<string, Component> = {SUPPLIER_APPROVED:CircleCheck,SUPPLIER_REJECTED:CircleX,SUPPLIER_RETURNED:AlertTriangle,BID_PUBLISHED:ClipboardList,BID_INVITED:Send,BID_REMINDER:AlarmClock,SYSTEM:Bell,CLARIFICATION_REPLIED:MessageSquare,BID_OPENING:LockOpen,BID_EVALUATION_RESULT:BarChart3,AWARD_LETTER:Trophy,BID_ROUND_OPEN:Send}
const typeColorMap: Record<string, string> = {SUPPLIER_APPROVED:'#059669',SUPPLIER_REJECTED:'#dc2626',SUPPLIER_RETURNED:'#d97706',BID_PUBLISHED:'#2563eb',BID_INVITED:'#db2777',BID_REMINDER:'#ea580c',SYSTEM:'#475569',CLARIFICATION_REPLIED:'#0d9488',BID_OPENING:'#0891b2',BID_EVALUATION_RESULT:'#7c3aed',AWARD_LETTER:'#059669',BID_ROUND_OPEN:'#2563eb'}
const typeLabels: Record<string,string> = {SUPPLIER_APPROVED:'入库审批',SUPPLIER_REJECTED:'驳回通知',SUPPLIER_RETURNED:'退回补正',BID_PUBLISHED:'采购项目发布',BID_INVITED:'采购项目邀请',BID_REMINDER:'开标提醒',SYSTEM:'系统通知',CLARIFICATION_REPLIED:'澄清答疑',BID_OPENING:'开标通知',BID_EVALUATION_RESULT:'评标结果',AWARD_LETTER:'中标通知书',BID_ROUND_OPEN:'多轮报价'}
const filteredNotifications = computed(() => {
  if (!typeFilter.value) return store.notifications
  return store.notifications.filter((n:any) => n.type === typeFilter.value)
})
async function fetchData() { loading.value = true; error.value = false; try { await store.fetchNotifications(currentPage.value,15) } catch { error.value = true } finally { loading.value = false } }
function retryLoad() { fetchData() }
onMounted(fetchData)

// 每 30s 轮询新通知，有新消息自动刷新列表
let notifTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  notifTimer = setInterval(() => {
    store.fetchNotifications(currentPage.value, 15).catch(() => {})
  }, 30_000)
})
onBeforeUnmount(() => {
  if (notifTimer) clearInterval(notifTimer)
})

async function handleRead(id:string) { try { await store.markAsRead(id) } catch { ElMessage.error('标记失败，请重试') } }
async function handleReadAll() { try { await store.markAllAsRead(); store.fetchUnreadCount(); ElMessage.success('已全部标为已读') } catch { ElMessage.error('操作失败，请重试') } }
const detailNotif = ref<any>(null)
const detailVisible = ref(false)
function handleClick(n:any) { detailNotif.value = { ...n }; detailVisible.value = true }
function linkify(text: string): string {
  if (!text) return ''
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const lines = escaped.split('\n')
  const sigLen = Math.min(2, lines.length)
  const bodyLines = lines.slice(0, -sigLen)
  const sigLines = lines.slice(-sigLen)
  let html = bodyLines.join('<br>')
  html = html.replace(
    /(https?:\/\/[^\s<>"'{}|]+)/g,
    '<a href="$1" target="_blank" rel="noopener" class="notif-link">$1</a>',
  )
  if (sigLines.length > 0) {
    html += '<div class="nd-signature">' + sigLines.join('<br>') + '</div>'
  }
  return html
}
function handlePageChange(page:number) { currentPage.value = page; fetchData() }
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <button class="nd-btn nd-btn--sm nd-btn--soft" @click="retryLoad" style="margin:0 auto">重新加载</button>
    </div>
    <template v-else>
    <SpPageHero :icon="Bell" title="消息中心" sub="查看系统通知和业务消息，及时处理重要提醒。">
      <template #actions>
        <button class="nd-btn nd-btn--sm nd-btn--soft" @click="handleReadAll" :disabled="store.unreadCount===0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px"><polyline points="20 6 9 17 4 12"/></svg>全部标为已读
        </button>
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
        <div class="notif-right"><div class="notif-row-time">{{ dayjs(n.createdAt).format('MM-DD HH:mm') }}</div><button v-if="!n.isRead" class="nd-btn nd-btn--xs nd-btn--danger" @click.stop="handleRead(n.id)">标为已读</button></div>
      </div>
      <div style="display:flex;justify-content:center;padding:16px"><el-pagination v-model:current-page="currentPage" :total="store.total" :page-size="15" layout="prev,pager,next" @current-change="handlePageChange" /></div>
    </div>

    <div v-else-if="store.notifications.length>0" class="sp-empty-panel"><el-icon :size="32"><Search /></el-icon><p class="sp-empty-text">无匹配通知</p><p class="sp-empty-desc">该分类暂无通知，试试其他筛选</p></div>
    <div v-else class="sp-empty-panel"><el-icon :size="32"><ChatDotRound /></el-icon><p class="sp-empty-text">暂无消息</p><p class="sp-empty-desc">您没有未读消息</p></div>
    </template>
  </div>

  <!-- 通知详情弹窗（cgzxui neumorphic） -->
  <el-dialog v-model="detailVisible" :title="detailNotif?.title || '通知详情'" width="600px" @closed="detailNotif = null" class="neumorphic-dlg">
    <div v-if="detailNotif" class="nd-body">
      <span class="nd-time">{{ dayjs(detailNotif.createdAt).format('YYYY-MM-DD HH:mm') }}</span>
      <div class="nd-content" v-html="linkify(detailNotif.content)" />
    </div>
    <template #footer>
      <div class="nd-footer">
        <button v-if="detailNotif && !detailNotif.isRead" class="nd-btn nd-btn--danger" @click="store.markAsRead(detailNotif.id); detailNotif.isRead = true">标为已读</button>
        <button class="nd-btn nd-btn--soft" @click="detailVisible = false">关闭</button>
      </div>
    </template>
  </el-dialog>
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

/* 通知详情弹窗（scoped body） */
.nd-body { padding: 4px 0; }
.nd-time { font-size: 12px; color: var(--muted-foreground); display: block; margin-bottom: 14px; }
.nd-content { margin: 0; font-size: 14px; color: var(--foreground); line-height: 1.8; word-break: break-word; }
.nd-footer { display: flex; gap: 10px; justify-content: flex-end; }

</style>

<style>
/* ═══ cgzxui neumorphic 通知弹窗（teleported → 非 scoped）═══ */
.neumorphic-dlg { --nd-bg: oklch(0.975 0.012 258); }
.neumorphic-dlg .el-overlay { background: oklch(0.35 0.06 258 / 0.28) !important; }
.neumorphic-dlg .el-dialog {
  border: none !important;
  border-radius: 20px !important;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)) !important;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.75), 0 20px 60px oklch(0.3 0.05 258 / 0.18) !important;
}
.neumorphic-dlg .el-dialog__header {
  padding: 22px 26px 16px; margin: 0;
  border-bottom: 1px solid var(--hairline);
}
.neumorphic-dlg .el-dialog__title {
  display: block;
  padding-right: 48px;
  font-size: 18px; font-weight: 900; color: var(--foreground); letter-spacing: -0.01em;
  line-height: 1.3;
}
.neumorphic-dlg .el-dialog__headerbtn {
  position: absolute !important;
  top: 16px !important;
  right: 22px;
  width: 38px; height: 38px;
  border-radius: 10px;
  background: var(--surface);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85);
  transition: all 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.neumorphic-dlg .el-dialog__headerbtn:hover {
  color: var(--brand); transform: translateY(-1px);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9);
}
.neumorphic-dlg .el-dialog__headerbtn .el-dialog__close { color: var(--muted-foreground); font-weight: 700; }
.neumorphic-dlg .el-dialog__body { padding: 18px 26px; word-break: break-word; }
.neumorphic-dlg .el-dialog__footer {
  padding: 16px 26px; border-top: 1px solid var(--hairline);
  background: oklch(1 0 0 / 0.3); border-radius: 0 0 20px 20px;
}

/* neumorphic 按钮 */
.nd-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 22px; border-radius: 9px; border: none;
  font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
  transition: all 0.18s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.nd-btn--soft {
  background: var(--surface); color: var(--foreground);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85);
}
.nd-btn--soft:hover { color: var(--brand); transform: translateY(-1px);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9); }
.nd-btn--soft:active { transform: translateY(0);
  box-shadow: inset 2px 2px 5px oklch(0.55 0.03 258 / 0.15), inset -2px -2px 5px oklch(1 0 0 / 0.5); }
.nd-btn--danger {
  background: var(--danger); color: #fff;
  box-shadow: 3px 3px 6px oklch(0.5 0.16 27 / 0.22), -2px -2px 5px oklch(1 0 0 / 0.55), inset 0 1px 0 oklch(1 0 0 / 0.2);
}
.nd-btn--danger:hover { transform: translateY(-1px);
  box-shadow: 4px 4px 10px oklch(0.45 0.16 27 / 0.28), -2px -2px 6px oklch(1 0 0 / 0.6), inset 0 1px 0 oklch(1 0 0 / 0.25); }
.nd-btn--danger:active { transform: translateY(0);
  box-shadow: inset 2px 2px 5px oklch(0.45 0.16 27 / 0.25), inset -2px -2px 5px oklch(1 0 0 / 0.4); }
.nd-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

/* 尺寸变体 */
.nd-btn--sm { padding: 8px 16px; font-size: 12px; }
.nd-btn--xs { padding: 5px 10px; font-size: 11px; border-radius: 7px; }
.nd-btn--sm.nd-btn--danger { box-shadow: 2.5px 2.5px 5px oklch(0.5 0.16 27 / 0.18), -1px -1px 3px oklch(1 0 0 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.2); }
.nd-btn--xs.nd-btn--danger { box-shadow: 2px 2px 4px oklch(0.5 0.16 27 / 0.16), -1px -1px 2px oklch(1 0 0 / 0.45), inset 0 1px 0 oklch(1 0 0 / 0.2); }
.nd-btn--sm.nd-btn--soft { box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.65), 1.5px 1.5px 3px oklch(0.55 0.03 258 / 0.08), -1px -1px 2px oklch(1 0 0 / 0.8); }
.nd-btn--xs.nd-btn--soft { box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6), 1px 1px 2px oklch(0.55 0.03 258 / 0.07), -0.5px -0.5px 2px oklch(1 0 0 / 0.75); }
.nd-btn--sm.nd-btn--soft:hover { box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.75), 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.12), -1.5px -1.5px 4px oklch(1 0 0 / 0.85); }
.nd-btn--xs.nd-btn--soft:hover { box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 1.5px 1.5px 3px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.8); }
.nd-btn--sm.nd-btn--danger:hover { box-shadow: 3px 3px 7px oklch(0.45 0.16 27 / 0.22), -1.5px -1.5px 4px oklch(1 0 0 / 0.55), inset 0 1px 0 oklch(1 0 0 / 0.25); }
.nd-btn--xs.nd-btn--danger:hover { box-shadow: 2.5px 2.5px 5px oklch(0.45 0.16 27 / 0.18), -1px -1px 3px oklch(1 0 0 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.25); }

/* 内容链接 */
.notif-link { color: var(--brand); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; word-break: break-all; }
.notif-link:hover { color: var(--brand-deep); }

/* 落款右对齐 */
.nd-signature { text-align: right; margin-top: 14px; color: var(--muted-foreground); font-size: 13px; }

@media (prefers-reduced-motion: reduce) {
  .neumorphic-dlg .el-dialog__headerbtn, .neumorphic-dlg .el-dialog, .nd-btn { transition: none; }
  .nd-btn:hover { transform: none; }
}
</style>
