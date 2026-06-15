<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { useNotificationStore } from '@/stores/notification'
import { useBidStore } from '@/stores/bid'
import { useAuthStore } from '@/stores/auth'
import { supplierApi } from '@/api/supplier'
import SkeletonCard from '@/components/SkeletonCard.vue'
import ProfileCompletenessBanner from '@/components/ProfileCompletenessBanner.vue'
import CountdownTimer from '@/components/CountdownTimer.vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'

const router = useRouter()
const supplierStore = useSupplierStore()
const notifStore = useNotificationStore()
const bidStore = useBidStore()
const authStore = useAuthStore()

const loading = ref(true)
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
  } finally {
    loading.value = false
  }
})

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

const completeness = computed(() => stats.value?.profileCompleteness || { score: 0, missing: [] })
const visibleProjects = computed(() => bidStore.projects.slice(0, 4))
const visibleNotifications = computed(() => notifStore.notifications.filter((n: any) => !n.isRead).slice(0, 3))

const metrics = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    { icon: 'DocumentChecked', label: '投标记录', value: s.submissionCount, color: 'green', path: '/my-bids' },
    { icon: 'Folder', label: '资质证照', value: s.qualificationCount, color: 'orange', path: '/qualifications' },
    { icon: 'EditPen', label: '待审变更', value: s.pendingChanges, color: 'cyan', path: '/change-records' },
    { icon: 'WarningFilled', label: '到期风险', value: s.expiringQualifications, color: 'red', path: '/qualifications' },
  ]
})

const tasks = computed(() => {
  const s = stats.value
  const status = statusInfo.value
  if (!s || !status) return []

  const items = []
  if (status.status === 'RETURNED') {
    items.push({ icon: 'EditPen', title: '处理资料补正', desc: status.returnReason || '根据审核意见补齐入驻资料', path: '/onboarding', tone: 'orange' })
  }
  if ((s.profileCompleteness?.score || 0) < 100) {
    items.push({ icon: 'OfficeBuilding', title: '完善企业档案', desc: `企业评分 ${s.profileCompleteness?.score || 0}分`, path: '/profile', tone: 'blue' })
  }
  if (s.expiringQualifications > 0) {
    items.push({ icon: 'WarningFilled', title: '更新到期资质', desc: `${s.expiringQualifications} 项证照临近有效期`, path: '/qualifications', tone: 'red' })
  }
  if (s.pendingChanges > 0) {
    items.push({ icon: 'EditPen', title: '跟踪变更审核', desc: `${s.pendingChanges} 条资料变更待审核`, path: '/change-records', tone: 'cyan' })
  }
  if (s.unreadNotifications > 0) {
    items.push({ icon: 'ChatDotRound', title: '处理未读消息', desc: `${s.unreadNotifications} 条平台通知待查看`, path: '/notifications', tone: 'red' })
  }
  if (items.length === 0) {
    items.push({ icon: 'CircleCheckFilled', title: '暂无紧急待办', desc: '可继续查看招标机会或维护企业档案', path: '/bids', tone: 'green' })
  }
  return items.slice(0, 4)
})

function toneStyle(tone: string) {
  const map: Record<string, { background: string; color: string }> = {
    blue: { background: 'var(--sp-primary-lighter)', color: 'var(--sp-primary)' },
    green: { background: 'var(--sp-green-light)', color: 'var(--sp-green)' },
    orange: { background: 'var(--sp-orange-light)', color: 'var(--sp-orange)' },
    red: { background: 'var(--sp-red-light)', color: 'var(--sp-red)' },
    cyan: { background: 'var(--sp-cyan-light)', color: 'var(--sp-cyan)' },
  }
  return map[tone] || map.blue
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
  <div class="page-container" v-loading="loading">
    <template v-if="statusInfo">
      <!-- Hero -->
      <div class="sp-page-hero-card">
        <div class="sp-page-hero-inner">
          <div class="sp-page-hero-body">
            <h1 class="sp-modern-title">{{ authStore.displayName || statusInfo.name }}，{{ new Date().getHours() < 12 ? '上午好' : new Date().getHours() < 18 ? '下午好' : '晚上好' }}</h1>
            <p class="sp-modern-desc">
              当前状态
              <span class="sp-status" :class="statusType[statusInfo.status] || 'pending'">{{ statusLabel[statusInfo.status] || statusInfo.status }}</span>
              <template v-if="statusInfo.status === 'RETURNED' && statusInfo.returnReason">，{{ statusInfo.returnReason }}</template>
              <template v-else>，关注投标机会、资质有效期和待处理消息</template>
            </p>
          </div>
          <div class="sp-page-hero-actions">
            <el-button type="primary" @click="router.push('/bids')">招标机会</el-button>
            <el-button @click="router.push('/my-bids')">投标进展</el-button>
            <el-button @click="router.push('/profile')">完善档案</el-button>
          </div>
        </div>
      </div>

      <!-- Completeness Banner -->
      <ProfileCompletenessBanner
        v-if="stats"
        :score="completeness.score"
        :missing="completeness.missing"
        class="db-completeness-banner"
      />

      <!-- Key metrics -->
      <div class="db-metrics" v-if="stats">
        <div class="db-metric" v-for="item in metrics" :key="item.label" @click="router.push(item.path)" style="cursor:pointer">
          <div class="db-metric-value">{{ item.value }}</div>
          <div class="db-metric-label">{{ item.label }}</div>
        </div>
      </div>

      <!-- Two-column body -->
      <div class="db-grid">
        <!-- Left column -->
        <div class="db-grid-col">
          <!-- Projects -->
          <section class="sp-module">
            <div class="sp-module-header">
              <h2 class="sp-module-title">招标机会</h2>
              <el-button link type="primary" @click="router.push('/bids')">全部 →</el-button>
            </div>
            <div v-if="visibleProjects.length === 0" class="db-empty">暂无招标项目</div>
            <div v-else>
              <div v-for="p in visibleProjects" :key="p.id" class="db-project-row" @click="router.push(`/bids/${p.id}`)">
                <div class="db-project-info">
                  <span class="db-project-name">{{ p.name }}</span>
                  <span class="db-project-code">{{ p.projectCode }}</span>
                </div>
                <div class="db-project-meta">
                  <span class="sp-status" :style="{ background: (stageMap[p.stage]?.color || '#94a3b8') + '14', color: stageMap[p.stage]?.color || '#94a3b8' }">{{ stageMap[p.stage]?.label || p.stage }}</span>
                  <CountdownTimer :deadline="p.deadline" />
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- Right column -->
        <div class="db-grid-col">
          <!-- Tasks -->
          <div class="sp-module">
            <div class="sp-module-header">
              <h2 class="sp-module-title">今日待办</h2>
            </div>
            <div class="db-task-list">
              <div v-for="task in tasks" :key="task.title" class="db-task-row" @click="router.push(task.path)">
                <span class="db-task-dot" :style="{background:toneStyle(task.tone).color}"></span>
                <div>
                  <div class="db-task-title">{{ task.title }}</div>
                  <div class="db-task-desc">{{ task.desc }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Unread notifications -->
          <div class="sp-module">
            <div class="sp-module-header">
              <h2 class="sp-module-title">未读消息</h2>
              <el-button link type="primary" @click="router.push('/notifications')">全部 →</el-button>
            </div>
            <div v-if="visibleNotifications.length === 0" class="db-empty">暂无未读消息</div>
            <div v-else>
              <div v-for="n in visibleNotifications" :key="n.id" class="db-msg-row" @click="router.push('/notifications')">
                <span class="db-msg-title">{{ n.title }}</span>
                <span class="db-msg-time">{{ dayjs(n.createdAt).format('MM-DD HH:mm') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Metrics row */
.db-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  margin-bottom: 20px;
}
.db-metric {
  background: #fff;
  border: 1px solid var(--sp-border);
  border-radius: var(--sp-radius-md);
  padding: 16px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.db-metric:hover { border-color: var(--sp-primary); }
.db-metric-value {
  font-size: 28px;
  font-weight: 900;
  color: var(--sp-gray-900);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.db-metric-label {
  margin-top: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--sp-gray-500);
}

/* Two-column grid */
.db-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; align-items: start; }
.db-grid-col { display: grid; gap: 20px; }

/* Banner spacing */
.db-completeness-banner { margin-bottom: 20px; }

.db-empty { padding: 20px 0 8px; text-align: center; color: var(--sp-gray-400); font-size: 13px; }

.db-project-row {
  display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; align-items: center;
  padding: 14px 0; border-bottom: 1px solid var(--sp-border-light); cursor: pointer;
}
.db-project-row:last-child { border-bottom: none; }
.db-project-row:hover { background: var(--sp-surface-hover); margin: 0 -16px; padding: 14px 16px; }
.db-project-name { display: block; font-size: 14px; font-weight: 800; color: var(--sp-gray-900); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-project-code { display: block; margin-top: 2px; font-size: 11px; color: var(--sp-gray-400); font-family: monospace; }
.db-project-meta { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.db-ann-row {
  display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 10px; align-items: center;
  padding: 12px 0; border-bottom: 1px solid var(--sp-border-light); cursor: pointer;
}
.db-ann-row:last-child { border-bottom: none; }
.db-ann-row:hover { background: var(--sp-surface-hover); margin: 0 -16px; padding: 12px 16px; }
.db-ann-title { font-size: 13px; color: var(--sp-gray-700); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-ann-date { font-size: 11px; color: var(--sp-gray-400); font-variant-numeric: tabular-nums; }

.db-task-list { display: grid; gap: 6px; }
.db-task-row {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 10px; border-radius: var(--sp-radius-sm); cursor: pointer;
}
.db-task-row:hover { background: var(--sp-surface-hover); }
.db-task-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
.db-task-title { font-size: 13px; font-weight: 800; color: var(--sp-gray-900); }
.db-task-desc { margin-top: 1px; font-size: 11px; color: var(--sp-gray-500); }

.db-msg-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 0; border-bottom: 1px solid var(--sp-border-light); cursor: pointer;
}
.db-msg-row:last-child { border-bottom: none; }
.db-msg-row:hover { background: var(--sp-surface-hover); margin: 0 -16px; padding: 10px 16px; }
.db-msg-title { font-size: 13px; font-weight: 700; color: var(--sp-gray-700); }
.db-msg-time { font-size: 11px; color: var(--sp-gray-400); font-variant-numeric: tabular-nums; }

@media (max-width: 1100px) {
  .db-grid { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .db-grid { grid-template-columns: 1fr; }
  .db-metrics { grid-template-columns: repeat(2, 1fr); }
  .db-project-row { grid-template-columns: 1fr; }
}
</style>
