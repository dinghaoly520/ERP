<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { useNotificationStore } from '@/stores/notification'
import { useAnnouncementStore } from '@/stores/announcement'
import { useBidStore } from '@/stores/bid'
import { useAuthStore } from '@/stores/auth'
import { supplierApi } from '@/api/supplier'
import SkeletonCard from '@/components/SkeletonCard.vue'
import ProfileCompleteness from '@/components/ProfileCompleteness.vue'
import CountdownTimer from '@/components/CountdownTimer.vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'

const router = useRouter()
const supplierStore = useSupplierStore()
const notifStore = useNotificationStore()
const announcementStore = useAnnouncementStore()
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
      announcementStore.fetchAnnouncements({ page: 1, pageSize: 5 }),
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
const typeLabel: Record<string, string> = {
  BID_NOTICE: '招标公告', WIN_NOTICE: '中标公示', POLICY: '政策法规', PLATFORM: '平台通知',
}
const typeTagType: Record<string, string> = {
  BID_NOTICE: 'primary', WIN_NOTICE: 'success', POLICY: 'warning', PLATFORM: 'info',
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
const visibleAnnouncements = computed(() => announcementStore.announcements.slice(0, 4))
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
    items.push({ icon: 'OfficeBuilding', title: '完善企业档案', desc: `资料完整度 ${s.profileCompleteness?.score || 0}%`, path: '/profile', tone: 'blue' })
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
  <div class="page-container supplier-dashboard">
    <template v-if="loading">
      <SkeletonCard :lines="2" :avatar="true" style="margin-bottom: 18px;" />
      <el-row :gutter="16">
        <el-col v-for="i in 4" :key="i" :xs="12" :md="6">
          <SkeletonCard :lines="2" />
        </el-col>
      </el-row>
    </template>

    <template v-else>
      <section class="dashboard-hero" v-if="statusInfo">
        <div class="hero-copy">
          <div class="hero-eyebrow">蜀水云采 · 供应商工作台</div>
          <h1>{{ authStore.displayName || statusInfo.name }}，{{ new Date().getHours() < 12 ? '上午好' : new Date().getHours() < 18 ? '下午好' : '晚上好' }}</h1>
          <p>
            当前状态
            <span class="sp-status hero-status" :class="statusType[statusInfo.status] || 'pending'">
              {{ statusLabel[statusInfo.status] || statusInfo.status }}
            </span>
            <template v-if="statusInfo.status === 'RETURNED' && statusInfo.returnReason">
              ，请优先处理：{{ statusInfo.returnReason }}
            </template>
            <template v-else>
              ，重点关注投标机会、资质有效期和待处理消息。
            </template>
          </p>
          <div class="hero-actions">
            <el-button type="primary" color="#ffffff" plain @click="router.push('/bids')">查看招标机会</el-button>
            <el-button color="#ffffff" plain @click="router.push('/my-bids')">投标进展</el-button>
            <el-button color="#ffffff" plain @click="router.push('/profile')">完善档案</el-button>
          </div>
        </div>
        <div class="hero-summary">
          <div class="summary-number">{{ completeness.score }}<small>%</small></div>
          <div class="summary-label">资料完整度</div>
          <div class="summary-note">{{ completeness.missing.length ? `仍有 ${completeness.missing.length} 项待完善` : '资料已完善' }}</div>
        </div>
      </section>

      <section class="dashboard-grid">
        <div class="main-column">
          <div class="metric-grid" v-if="stats">
            <div v-for="item in metrics" :key="item.label" class="metric-card" @click="router.push(item.path)">
              <div class="sp-stat-icon" :class="item.color">
                <el-icon :size="22"><component :is="item.icon" /></el-icon>
              </div>
              <div>
                <div class="metric-value">{{ item.value }}</div>
                <div class="metric-label">{{ item.label }}</div>
              </div>
            </div>
          </div>

          <div class="content-card">
            <div class="section-head">
              <div>
                <h2><el-icon><Document /></el-icon> 招标机会</h2>
                <p>只展示最近项目，避免与“招标机会”页面重复。</p>
              </div>
              <el-button link type="primary" @click="router.push('/bids')">查看全部</el-button>
            </div>
            <div v-if="visibleProjects.length === 0" class="compact-empty">暂无招标项目</div>
            <div v-else class="project-list">
              <div v-for="p in visibleProjects" :key="p.id" class="project-row" @click="router.push(`/bids/${p.id}`)">
                <div class="project-main">
                  <span class="project-title">{{ p.name }}</span>
                  <span class="project-code">{{ p.projectCode }}</span>
                </div>
                <div class="project-side">
                  <span class="sp-status" :style="{ background: (stageMap[p.stage]?.color || '#94a3b8') + '18', color: stageMap[p.stage]?.color || '#94a3b8' }">
                    {{ stageMap[p.stage]?.label || p.stage }}
                  </span>
                  <CountdownTimer :deadline="p.deadline" />
                </div>
              </div>
            </div>
          </div>

          <div class="content-card">
            <div class="section-head">
              <div>
                <h2><el-icon><Bell /></el-icon> 公告公示</h2>
                <p>压缩展示最新公告，详情进入公告公示页查看。</p>
              </div>
              <el-button link type="primary" @click="router.push('/announcements')">查看全部</el-button>
            </div>
            <div v-if="visibleAnnouncements.length === 0" class="compact-empty">暂无公告</div>
            <div v-else class="announcement-list">
              <div v-for="a in visibleAnnouncements" :key="a.id" class="announcement-row" @click="router.push(`/announcements/${a.id}`)">
                <el-tag :type="(typeTagType[a.type] as any)" size="small" effect="plain">{{ typeLabel[a.type] || a.type }}</el-tag>
                <span class="announcement-title">{{ a.title }}</span>
                <span class="announcement-date">{{ dayjs(a.publishDate || a.createdAt).format('MM-DD') }}</span>
              </div>
            </div>
          </div>
        </div>

        <aside class="side-column">
          <div class="content-card profile-card">
            <ProfileCompleteness :score="completeness.score" :missing="completeness.missing" />
          </div>

          <div class="content-card">
            <div class="section-head compact">
              <h2><el-icon><Notification /></el-icon> 今日待办</h2>
            </div>
            <div class="task-list">
              <div v-for="task in tasks" :key="task.title" class="task-row" @click="router.push(task.path)">
                <div class="task-icon" :style="toneStyle(task.tone)">
                  <el-icon><component :is="task.icon" /></el-icon>
                </div>
                <div>
                  <div class="task-title">{{ task.title }}</div>
                  <div class="task-desc">{{ task.desc }}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="content-card" v-if="visibleNotifications.length > 0">
            <div class="section-head compact">
              <h2><el-icon><ChatDotRound /></el-icon> 未读消息</h2>
              <el-button link type="primary" @click="router.push('/notifications')">处理</el-button>
            </div>
            <div class="message-list">
              <div v-for="n in visibleNotifications" :key="n.id" class="message-row" @click="router.push('/notifications')">
                <div class="message-title">{{ n.title }}</div>
                <div class="message-time">{{ dayjs(n.createdAt).format('MM-DD HH:mm') }}</div>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </template>
  </div>
</template>

<style scoped>
.supplier-dashboard {
  max-width: 1520px;
  margin: 0 auto;
  padding: 28px;
}

.dashboard-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 24px;
  align-items: stretch;
  min-height: 220px;
  padding: 30px;
  border-radius: 22px;
  color: #fff;
  background:
    radial-gradient(circle at 82% 14%, rgba(255, 255, 255, 0.24), transparent 24%),
    linear-gradient(135deg, #0756a5 0%, #0f83bd 100%);
  box-shadow: 0 20px 55px rgba(7, 86, 165, 0.18);
}

.hero-eyebrow {
  color: rgba(255, 255, 255, 0.68);
  font-size: 13px;
  font-weight: 800;
}

.hero-copy h1 {
  margin-top: 12px;
  font-size: 34px;
  font-weight: 900;
  letter-spacing: -0.04em;
}

.hero-copy p {
  max-width: 760px;
  margin-top: 10px;
  color: rgba(255, 255, 255, 0.78);
}

.hero-status {
  margin: 0 6px;
  background: rgba(255,255,255,.9) !important;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 24px;
}

.hero-summary {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.13);
  border: 1px solid rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(12px);
}

.summary-number {
  font-size: 52px;
  line-height: 1;
  font-weight: 950;
}

.summary-number small {
  font-size: 20px;
}

.summary-label {
  margin-top: 8px;
  font-weight: 800;
}

.summary-note {
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 12px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 20px;
  margin-top: 20px;
  align-items: start;
}

.main-column,
.side-column {
  display: grid;
  gap: 20px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.metric-card,
.content-card {
  border: 1px solid var(--sp-border);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: var(--sp-shadow-sm);
}

.metric-card {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 96px;
  padding: 18px;
  cursor: pointer;
  transition: all .2s ease;
}

.metric-card:hover,
.project-row:hover,
.task-row:hover,
.announcement-row:hover,
.message-row:hover {
  transform: translateY(-1px);
  border-color: rgba(22, 132, 216, 0.34);
  background: var(--sp-surface-hover);
}

.metric-value {
  color: var(--sp-gray-900);
  font-size: 28px;
  line-height: 1;
  font-weight: 900;
}

.metric-label {
  margin-top: 5px;
  color: var(--sp-gray-500);
  font-size: 13px;
}

.content-card {
  padding: 20px 24px;
}

.profile-card {
  padding: 20px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--sp-border-light);
}

.section-head.compact {
  align-items: center;
}

.section-head h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--sp-gray-900);
  font-size: 17px;
  font-weight: 900;
}

.section-head p {
  margin-top: 3px;
  color: var(--sp-gray-500);
  font-size: 12px;
}

.project-list,
.announcement-list,
.task-list,
.message-list {
  display: grid;
}

.project-row,
.announcement-row,
.task-row,
.message-row {
  cursor: pointer;
  transition: all .18s ease;
}

.project-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--sp-border-light);
}

.project-row:last-child,
.announcement-row:last-child,
.message-row:last-child {
  border-bottom: none;
}

.project-title {
  display: block;
  color: var(--sp-gray-900);
  font-size: 15px;
  font-weight: 850;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-code {
  display: block;
  margin-top: 4px;
  color: var(--sp-gray-400);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.project-side {
  display: flex;
  align-items: center;
  gap: 12px;
}

.announcement-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid var(--sp-border-light);
}

.announcement-title {
  color: var(--sp-gray-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.announcement-date,
.message-time {
  color: var(--sp-gray-400);
  font-size: 12px;
}

.task-list {
  gap: 10px;
  margin-top: 14px;
}

.task-row {
  display: flex;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--sp-border-light);
  border-radius: 14px;
  background: var(--sp-gray-50);
}

.task-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.task-title,
.message-title {
  color: var(--sp-gray-900);
  font-weight: 850;
}

.task-desc {
  margin-top: 2px;
  color: var(--sp-gray-500);
  font-size: 12px;
}

.message-row {
  padding: 12px 0;
  border-bottom: 1px solid var(--sp-border-light);
}

.compact-empty {
  padding: 26px 0 8px;
  color: var(--sp-gray-400);
  text-align: center;
}

@media (max-width: 1280px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
  .side-column {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .profile-card {
    grid-row: span 2;
  }
}

@media (max-width: 900px) {
  .supplier-dashboard {
    padding: 16px;
  }
  .dashboard-hero,
  .metric-grid,
  .side-column {
    grid-template-columns: 1fr;
  }
  .hero-summary {
    min-height: 150px;
  }
  .project-row {
    grid-template-columns: 1fr;
  }
  .project-side {
    justify-content: space-between;
  }
}
</style>
