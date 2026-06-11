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
import { ElMessage, ElMessageBox } from 'element-plus'
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
  PENDING: '待审核', RETURNED: '已退回补正', APPROVED: '已入库',
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

const quickActions = computed(() => {
  const s = stats.value
  if (!s) return []
  const actions = [
    { icon: 'Search', label: '浏览招标', path: '/bids', color: '#0a5eb8', desc: '查看最新招标项目' },
    { icon: 'Document', label: '我的投标', path: '/my-bids', color: '#059669', desc: '管理已提交标书' },
    { icon: 'Bell', label: '查看公告', path: '/announcements', color: '#d97706', desc: '招标公告和中标公示' },
    { icon: 'Medal', label: '资质管理', path: '/qualifications', color: '#7c3aed', desc: '维护企业资质材料' },
  ]
  if (s.unreadNotifications > 0) {
    actions.push({ icon: 'ChatDotRound', label: `${s.unreadNotifications}条未读`, path: '/notifications', color: '#dc2626', desc: '查看未读消息' })
  }
  return actions
})

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
    <!-- Loading skeleton -->
    <template v-if="loading">
      <SkeletonCard :lines="2" :avatar="true" style="margin-bottom: 20px;" />
      <el-row :gutter="16">
        <el-col v-for="i in 6" :key="i" :xs="12" :sm="8" :md="4">
          <SkeletonCard :lines="2" />
        </el-col>
      </el-row>
    </template>

    <template v-else>
      <!-- Welcome banner + Profile completeness -->
      <el-row :gutter="20">
        <el-col :xs="24" :lg="16">
          <div class="sp-card welcome-banner" v-if="statusInfo">
            <div class="welcome-content">
              <div class="welcome-text">
                <div class="welcome-greeting">
                  <span class="greeting-time">{{ new Date().getHours() < 12 ? '上午好' : new Date().getHours() < 18 ? '下午好' : '晚上好' }}</span>
                  <span class="greeting-name">{{ authStore.displayName || statusInfo.name }}</span>
                </div>
                <p class="welcome-desc">
                  <span class="sp-status" :class="statusType[statusInfo.status] || 'pending'">
                    {{ statusLabel[statusInfo.status] || statusInfo.status }}
                  </span>
                  <span v-if="statusInfo.status === 'RETURNED' && statusInfo.returnReason" class="welcome-reason">
                    退回原因：{{ statusInfo.returnReason }}
                  </span>
                </p>
                <!-- Quick actions -->
                <div class="quick-actions">
                  <div v-for="a in quickActions" :key="a.path" class="quick-action" @click="router.push(a.path)">
                    <div class="qa-icon" :style="{ background: a.color + '15', color: a.color }">
                      <el-icon :size="18"><component :is="a.icon" /></el-icon>
                    </div>
                    <div class="qa-text">
                      <span class="qa-label">{{ a.label }}</span>
                      <span class="qa-desc">{{ a.desc }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </el-col>

        <!-- Profile completeness ring -->
        <el-col :xs="24" :lg="8">
          <div class="sp-card completeness-wrapper">
            <ProfileCompleteness :score="completeness.score" :missing="completeness.missing" />
          </div>
        </el-col>
      </el-row>

      <!-- Stats -->
      <el-row :gutter="16" v-if="stats" style="margin-top: 20px;">
        <el-col :xs="12" :sm="8" :md="4" v-for="(item, idx) in [
          { icon: 'Medal', label: '评价次数', value: stats.evaluationCount, color: 'blue', path: '/evaluations' },
          { icon: 'DocumentChecked', label: '已投项目', value: stats.submissionCount, color: 'green', path: '/my-bids' },
          { icon: 'Folder', label: '资质数量', value: stats.qualificationCount, color: 'orange', path: '/qualifications' },
          { icon: 'EditPen', label: '待审变更', value: stats.pendingChanges, color: 'cyan', path: '/change-records' },
          { icon: 'ChatDotRound', label: '未读消息', value: stats.unreadNotifications, color: 'red', path: '/notifications' },
          { icon: 'WarningFilled', label: '即将到期', value: stats.expiringQualifications, color: 'orange', path: '/qualifications' },
        ]" :key="idx">
          <div class="sp-stat" @click="router.push(item.path)">
            <div class="sp-stat-icon" :class="item.color">
              <el-icon :size="26"><component :is="item.icon" /></el-icon>
            </div>
            <div class="sp-stat-content">
              <div class="sp-stat-value">{{ item.value }}</div>
              <div class="sp-stat-label">{{ item.label }}</div>
            </div>
          </div>
        </el-col>
      </el-row>

      <!-- Main content: announcements + bids -->
      <el-row :gutter="20" style="margin-top: 20px;">
        <el-col :xs="24" :lg="12">
          <div class="sp-card">
            <div class="sp-card-header">
              <span class="sp-card-title"><el-icon><Bell /></el-icon> 最新公告</span>
              <el-button link type="primary" @click="router.push('/announcements')">查看全部</el-button>
            </div>
            <div v-if="announcementStore.announcements.length === 0" class="sp-empty" style="padding: 30px;">
              <div class="sp-empty-icon">📢</div>
              <div class="sp-empty-text">暂无公告</div>
            </div>
            <div v-else class="announcement-list">
              <div v-for="a in announcementStore.announcements" :key="a.id" class="announcement-item" @click="router.push(`/announcements/${a.id}`)">
                <el-tag :type="(typeTagType[a.type] as any)" size="small" effect="plain">{{ typeLabel[a.type] || a.type }}</el-tag>
                <span class="announcement-title">{{ a.title }}</span>
                <span class="announcement-date">{{ dayjs(a.publishDate || a.createdAt).format('MM-DD') }}</span>
              </div>
            </div>
          </div>
        </el-col>
        <el-col :xs="24" :lg="12">
          <div class="sp-card">
            <div class="sp-card-header">
              <span class="sp-card-title"><el-icon><Document /></el-icon> 招标项目</span>
              <el-button link type="primary" @click="router.push('/bids')">查看全部</el-button>
            </div>
            <div v-if="bidStore.projects.length === 0" class="sp-empty" style="padding: 30px;">
              <div class="sp-empty-icon">📋</div>
              <div class="sp-empty-text">暂无招标项目</div>
            </div>
            <div v-else class="bid-list">
              <div v-for="p in bidStore.projects" :key="p.id" class="bid-item" @click="router.push(`/bids/${p.id}`)">
                <div class="bid-item-top">
                  <span class="bid-item-name">{{ p.name }}</span>
                  <span class="sp-status" :style="{ background: (stageMap[p.stage]?.color || '#94a3b8') + '18', color: stageMap[p.stage]?.color || '#94a3b8' }" style="font-size: 11px; padding: 2px 10px;">
                    {{ stageMap[p.stage]?.label || p.stage }}
                  </span>
                </div>
                <div class="bid-item-meta">
                  <span>{{ p.projectCode }}</span>
                  <span>{{ p.procurementMethod }}</span>
                  <CountdownTimer :deadline="p.deadline" />
                </div>
              </div>
            </div>
          </div>
        </el-col>
      </el-row>

      <!-- Recent notifications -->
      <div class="sp-card" style="margin-top: 20px;">
        <div class="sp-card-header">
          <span class="sp-card-title"><el-icon><ChatDotRound /></el-icon> 最新消息</span>
          <el-button link type="primary" @click="router.push('/notifications')">查看全部</el-button>
        </div>
        <div v-if="notifStore.notifications.length === 0" class="sp-empty" style="padding: 30px;">
          <div class="sp-empty-icon">🔔</div>
          <div class="sp-empty-text">暂无消息</div>
        </div>
        <div v-else>
          <div v-for="n in notifStore.notifications.slice(0, 5)" :key="n.id" class="notif-item" :class="{ unread: !n.isRead }">
            <div class="notif-dot" v-if="!n.isRead"></div>
            <div class="notif-body">
              <div class="notif-title">{{ n.title }}</div>
              <div class="notif-content">{{ n.content }}</div>
            </div>
            <div class="notif-time">{{ dayjs(n.createdAt).format('MM-DD HH:mm') }}</div>
          </div>
        </div>
      </div>
    </template>

    <!-- Change password dialog -->
    <el-dialog v-model="pwdDialog" title="修改密码" width="420px" destroy-on-close>
      <el-form :model="pwdForm" label-width="90px" size="large">
        <el-form-item label="原密码">
          <el-input v-model="pwdForm.old" type="password" placeholder="请输入当前密码" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwdForm.newPwd" type="password" placeholder="不少于6位" show-password />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="pwdForm.confirm" type="password" placeholder="请再次输入新密码" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdDialog = false">取消</el-button>
        <el-button type="primary" :loading="pwdLoading" @click="handleChangePassword">确认修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.welcome-banner {
  background: linear-gradient(135deg, #0a5eb8, #0891b2);
  border: none;
  color: #fff;
}

.welcome-content {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.welcome-greeting {
  margin-bottom: 8px;
}

.greeting-time {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
  display: block;
  margin-bottom: 4px;
}

.greeting-name {
  font-size: 24px;
  font-weight: 900;
  letter-spacing: -0.5px;
}

.welcome-desc {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 20px;
}

.welcome-desc .sp-status { font-size: 12px; padding: 3px 12px; }
.welcome-reason { color: rgba(255, 255, 255, 0.7); font-size: 13px; }

/* Quick actions */
.quick-actions {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}

.quick-action {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.quick-action:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: translateY(-1px);
}

.qa-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.qa-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.qa-label {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
}

.qa-desc {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Completeness */
.completeness-wrapper {
  height: 100%;
  min-height: 280px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

/* Lists */
.announcement-list, .bid-list { display: flex; flex-direction: column; }

.announcement-item {
  display: flex; align-items: center; gap: 12px; padding: 12px 0;
  border-bottom: 1px solid var(--sp-border-light); cursor: pointer; transition: background 0.15s;
}
.announcement-item:last-child { border-bottom: none; }
.announcement-item:hover { background: var(--sp-gray-50); margin: 0 -24px; padding: 12px 24px; border-radius: 8px; }
.announcement-title { flex: 1; font-size: 14px; color: var(--sp-gray-900); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.announcement-date { font-size: 12px; color: var(--sp-gray-400); flex-shrink: 0; }

.bid-item { padding: 12px 0; border-bottom: 1px solid var(--sp-border-light); cursor: pointer; transition: background 0.15s; }
.bid-item:last-child { border-bottom: none; }
.bid-item:hover { background: var(--sp-gray-50); margin: 0 -24px; padding: 12px 24px; border-radius: 8px; }
.bid-item-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.bid-item-name { font-weight: 600; font-size: 14px; color: var(--sp-gray-900); flex: 1; margin-right: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bid-item-meta { display: flex; gap: 16px; font-size: 12px; color: var(--sp-gray-500); align-items: center; }

.notif-item { display: flex; align-items: flex-start; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--sp-border-light); }
.notif-item:last-child { border-bottom: none; }
.notif-item.unread { background: #f0f7ff; margin: 0 -24px; padding: 14px 24px; border-radius: 8px; }
.notif-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sp-primary); margin-top: 6px; flex-shrink: 0; }
.notif-body { flex: 1; min-width: 0; }
.notif-title { font-weight: 600; font-size: 14px; color: var(--sp-gray-900); }
.notif-content { font-size: 13px; color: var(--sp-gray-500); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notif-time { font-size: 12px; color: var(--sp-gray-400); flex-shrink: 0; margin-top: 2px; }

@media (max-width: 992px) {
  .completeness-wrapper { min-height: auto; }
}
</style>
