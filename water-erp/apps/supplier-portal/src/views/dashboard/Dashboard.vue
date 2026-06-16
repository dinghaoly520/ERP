<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { useNotificationStore } from '@/stores/notification'
import { useBidStore } from '@/stores/bid'
import { useAuthStore } from '@/stores/auth'
import { supplierApi } from '@/api/supplier'
import SkeletonCard from '@/components/SkeletonCard.vue'
import CountdownTimer from '@/components/CountdownTimer.vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'

const router = useRouter()
const supplierStore = useSupplierStore()
const notifStore = useNotificationStore()
const bidStore = useBidStore()
const authStore = useAuthStore()

const loading = ref(true)
const error = ref(false)
const pwdDialog = ref(false)
const pwdLoading = ref(false)
const pwdForm = ref({ old: '', newPwd: '', confirm: '' })

onMounted(async () => {
  try {
    await Promise.all([
      supplierStore.fetchDashboardStats(),
      supplierStore.fetchStatus(),
      bidStore.fetchProjects(1, 5),
      notifStore.fetchNotifications(1, 5),
    ])
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
})

async function retryLoad() {
  error.value = false
  loading.value = true
  try {
    await Promise.all([
      supplierStore.fetchDashboardStats(),
      supplierStore.fetchStatus(),
      bidStore.fetchProjects(1, 5),
      notifStore.fetchNotifications(1, 5),
    ])
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

const stats = computed(() => supplierStore.dashboardStats)
const statusInfo = computed(() => supplierStore.status)

const statusLabel: Record<string, string> = {
  PENDING: '待审核', RETURNED: '退回补正', APPROVED: '已入库',
  REJECTED: '审核不通过', DISABLED: '已停用', BLACKLIST: '黑名单',
}
const statusType: Record<string, string> = {
  PENDING: 'pending', RETURNED: 'returned', APPROVED: 'approved',
  REJECTED: 'rejected', DISABLED: 'disabled', BLACKLIST: 'disabled',
}
const stageMap: Record<string, { label: string; color: string }> = {
  DOWNLOAD: { label: '文件下载', color: '#0891b2' },
  SUBMIT: { label: '加密投递', color: '#0a5eb8' },
  OPENING: { label: '在线开标', color: '#d97706' },
  EVALUATING: { label: '专家评标', color: '#7c3aed' },
  ARCHIVED: { label: '已归档', color: '#059669' },
}

const visibleProjects = computed(() => bidStore.projects.slice(0, 5))
const visibleNotifications = computed(() => notifStore.notifications.slice(0, 5))

// 6-cell stat row: precise, high-density, tabular-nums
interface StatCell { key: string; value: number; label: string; path: string }
const statCells = computed<StatCell[]>(() => {
  const s = stats.value
  if (!s) return []
  return [
    { key: 'submissions', value: s.submissionCount,   label: '投标记录', path: '/my-bids' },
    { key: 'quals',      value: s.qualificationCount, label: '资质证照', path: '/qualifications' },
    { key: 'changes',    value: s.pendingChanges,     label: '待审变更', path: '/change-records' },
    { key: 'expiring',   value: s.expiringQualifications, label: '到期风险', path: '/qualifications' },
    { key: 'completeness', value: s.profileCompleteness?.score ?? 0, label: '资料完整度', path: '/profile' },
    { key: 'unread',     value: s.unreadNotifications, label: '未读消息', path: '/notifications' },
  ]
})

function statTone(key: string): string {
  if (key === 'expiring') return 'var(--sp-red)'
  if (key === 'completeness') return 'var(--sp-primary)'
  if (key === 'unread') return 'var(--sp-cyan)'
  return ''
}

function statSuffix(key: string): string {
  if (key === 'completeness') return '%'
  return ''
}

async function handleChangePassword() {
  if (pwdForm.value.newPwd !== pwdForm.value.confirm) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }
  if (pwdForm.value.newPwd.length < 6) {
    ElMessage.warning('新密码不少于6位')
    return
  }
  pwdLoading.value = true
  try {
    await supplierApi.changePassword(pwdForm.value.old, pwdForm.value.newPwd)
    ElMessage.success('密码修改成功')
    pwdDialog.value = false
    pwdForm.value = { old: '', newPwd: '', confirm: '' }
  } catch {
    ElMessage.error('密码修改失败，请检查原密码')
  } finally {
    pwdLoading.value = false
  }
}
</script>

<template>
  <div class="page-container">
    <!-- Error state -->
    <div v-if="error && !loading" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>

    <!-- Skeleton loading -->
    <template v-else-if="loading">
      <SkeletonCard :lines="2" style="margin-bottom:20px" />
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:0;margin-bottom:20px">
        <SkeletonCard v-for="i in 6" :key="i" :lines="1" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <SkeletonCard :lines="4" />
        <SkeletonCard :lines="4" />
      </div>
    </template>

    <template v-else-if="statusInfo">
      <!-- Hero -->
      <div class="sp-page-hero-card">
        <div class="sp-page-hero-inner">
          <div class="sp-page-hero-body">
            <h1 class="sp-modern-title">
              {{ authStore.displayName || statusInfo.name }}
              <span class="db-hero-greet">{{ new Date().getHours() < 12 ? '上午好' : new Date().getHours() < 18 ? '下午好' : '晚上好' }}</span>
            </h1>
            <p class="sp-modern-desc">
              <span class="sp-status" :class="statusType[statusInfo.status] || 'pending'">{{ statusLabel[statusInfo.status] || statusInfo.status }}</span>
              <template v-if="statusInfo.status === 'RETURNED' && statusInfo.returnReason"> — {{ statusInfo.returnReason }}</template>
            </p>
          </div>
          <div class="sp-page-hero-actions">
            <el-button type="primary" @click="router.push('/bids')">招标机会</el-button>
            <el-button @click="router.push('/my-bids')">投标进展</el-button>
            <el-button @click="router.push('/profile')">完善档案</el-button>
          </div>
        </div>
      </div>

      <!-- Stat row: unified border strip, no individual card wrapping -->
      <div class="sp-stat-row db-stat-row" v-if="stats">
        <div
          v-for="cell in statCells"
          :key="cell.key"
          class="sp-stat-cell db-stat-cell"
          :class="{ 'db-stat-clickable': !!cell.path }"
          @click="cell.path && router.push(cell.path)"
        >
          <div class="sp-stat-cell-value" :style="statTone(cell.key) ? { color: statTone(cell.key) } : {}">
            {{ cell.value }}<span v-if="statSuffix(cell.key)" class="db-stat-suffix">{{ statSuffix(cell.key) }}</span>
          </div>
          <div class="sp-stat-cell-label">{{ cell.label }}</div>
        </div>
      </div>

      <!-- Two-column body: symmetric, hairline-divided -->
      <div class="db-grid">
        <!-- Left: projects -->
        <section class="sp-module">
          <div class="sp-module-header">
            <h2 class="sp-module-title">招标机会</h2>
            <el-button link type="primary" @click="router.push('/bids')">全部<el-icon style="margin-left:2px;font-size:12px"><ArrowRight /></el-icon></el-button>
          </div>
          <div v-if="visibleProjects.length === 0" class="sp-empty">
            <div class="sp-empty-icon"><el-icon :size="20"><Folder /></el-icon></div>
            <div class="sp-empty-text">暂无招标项目</div>
            <div class="sp-empty-desc">关注平台公告，及时获取招标信息</div>
          </div>
          <template v-else>
            <div
              v-for="(p, idx) in visibleProjects"
              :key="p.id"
              class="db-project-row"
              :class="{ 'is-last': idx === visibleProjects.length - 1 }"
              @click="router.push(`/bids/${p.id}`)"
            >
              <div class="db-project-info">
                <span class="db-project-name">{{ p.name }}</span>
                <span class="db-project-code">{{ p.projectCode }}</span>
              </div>
              <div class="db-project-meta">
                <span
                  class="db-project-stage"
                  :style="{ background: (stageMap[p.stage]?.color || '#94a3b8') + '12', color: stageMap[p.stage]?.color || '#94a3b8' }"
                >{{ stageMap[p.stage]?.label || p.stage }}</span>
                <CountdownTimer :deadline="p.deadline" />
              </div>
            </div>
          </template>
        </section>

        <!-- Right: notifications -->
        <section class="sp-module">
          <div class="sp-module-header">
            <h2 class="sp-module-title">最近消息</h2>
            <el-button link type="primary" @click="router.push('/notifications')">全部<el-icon style="margin-left:2px;font-size:12px"><ArrowRight /></el-icon></el-button>
          </div>
          <div v-if="visibleNotifications.length === 0" class="sp-empty">
            <div class="sp-empty-icon"><el-icon :size="20"><Bell /></el-icon></div>
            <div class="sp-empty-text">暂无消息</div>
            <div class="sp-empty-desc">平台通知和系统消息会出现在这里</div>
          </div>
          <template v-else>
            <div
              v-for="(n, idx) in visibleNotifications"
              :key="n.id"
              class="db-msg-row"
              :class="{ 'is-last': idx === visibleNotifications.length - 1 }"
              @click="router.push('/notifications')"
            >
              <div class="db-msg-left">
                <span class="db-msg-dot" :class="{ unread: !n.isRead }"></span>
                <span class="db-msg-title" :class="{ 'is-unread': !n.isRead }">{{ n.title }}</span>
              </div>
              <span class="db-msg-time">{{ dayjs(n.createdAt).format('MM-DD HH:mm') }}</span>
            </div>
          </template>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ─── Hero refinements ─── */
.db-hero-greet {
  font-size: 14px;
  font-weight: 500;
  color: var(--sp-gray-400);
  margin-left: 10px;
  letter-spacing: 0;
}

/* ─── Stat row: 6-cell unified strip ─── */
.db-stat-row {
  grid-template-columns: repeat(6, 1fr);
  margin-bottom: 20px;
}
.db-stat-cell {
  position: relative;
  padding: 16px 18px;
  cursor: default;
}
.db-stat-clickable {
  cursor: pointer;
  transition: background var(--sp-duration-fast) var(--sp-ease);
}
.db-stat-clickable:hover {
  background: var(--sp-gray-50);
}
.db-stat-suffix {
  font-size: 14px;
  font-weight: 600;
  color: var(--sp-gray-400);
  margin-left: 1px;
}

/* ─── Two-column grid ─── */
.db-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}

/* ─── Project rows ─── */
.db-project-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--sp-border-light);
  cursor: pointer;
  transition: background var(--sp-duration-fast) var(--sp-ease);
}
.db-project-row.is-last { border-bottom: none; }
.db-project-row:hover { background: var(--sp-gray-50); margin: 0 -16px; padding: 12px 16px; }
.db-project-info { min-width: 0; }
.db-project-name {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--sp-gray-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-project-code {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--sp-gray-400);
  font-family: 'SF Mono', 'JetBrains Mono', 'Cascadia Code', monospace;
}
.db-project-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.db-project-stage {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

/* ─── Message rows ─── */
.db-msg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--sp-border-light);
  cursor: pointer;
  transition: background var(--sp-duration-fast) var(--sp-ease);
}
.db-msg-row.is-last { border-bottom: none; }
.db-msg-row:hover { background: var(--sp-gray-50); margin: 0 -16px; padding: 10px 16px; }
.db-msg-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.db-msg-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--sp-gray-300);
  flex-shrink: 0;
}
.db-msg-dot.unread {
  background: var(--sp-primary);
}
.db-msg-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--sp-gray-600);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-msg-title.is-unread {
  font-weight: 700;
  color: var(--sp-gray-900);
}
.db-msg-time {
  font-size: 11px;
  color: var(--sp-gray-400);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* ─── Responsive ─── */
@media (max-width: 1100px) {
  .db-stat-row { grid-template-columns: repeat(3, 1fr); }
  .db-stat-cell { border-bottom: 1px solid var(--sp-border-light); }
  .db-stat-cell:nth-child(n+4) { border-bottom: none; }
  .db-stat-cell:nth-child(3) { border-right: none; }
}
@media (max-width: 768px) {
  .db-stat-row { grid-template-columns: repeat(2, 1fr); }
  .db-stat-cell:nth-child(3) { border-right: 1px solid var(--sp-border-light); border-bottom: 1px solid var(--sp-border-light); }
  .db-stat-cell:nth-child(n+5) { border-bottom: none; }
  .db-grid { grid-template-columns: 1fr; }
}
</style>
