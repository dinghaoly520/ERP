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

// ── Wave 2：情境化要务指挥台 ──
interface PriorityTask { id: string; tone: string; icon: string; title: string; desc: string; cta: string; path: string; priority: number }
const nearestDeadline = computed(() => {
  const now = Date.now()
  const upcoming = bidStore.projects.filter((p: any) => new Date(p.deadline).getTime() > now)
    .sort((a: any, b: any) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
  return upcoming[0] || null
})
const priorityTasks = computed<PriorityTask[]>(() => {
  const s = stats.value; const status = statusInfo.value
  if (!s || !status) return []
  const items: PriorityTask[] = []; const now = Date.now()
  const nd = nearestDeadline.value
  if (nd) {
    const days = Math.ceil((new Date(nd.deadline).getTime() - now) / 86400000)
    if (days <= 3) items.push({ id:'bid-deadline', tone: days <= 1 ? 'red' : 'orange', icon:'AlarmClock', title: days <= 1 ? `${nd.name} 今天截止` : `${nd.name} ${days}天后截止`, desc: days <= 1 ? '所剩时间不多' : '提前准备投标材料', cta:'去投标', path: `/bids/${nd.id}`, priority: days <= 1 ? 100 : 90 })
  }
  if (status.status === 'RETURNED') items.push({ id:'returned', tone:'orange', icon:'EditPen', title:'入驻资料被退回', desc: status.returnReason || '请根据审核意见补齐', cta:'去补正', path:'/onboarding', priority:88 })
  if (s.expiringQualifications > 0) items.push({ id:'qual-expire', tone:'orange', icon:'WarningFilled', title:`${s.expiringQualifications} 项资质即将到期`, desc:'过期将影响投标资格', cta:'更新', path:'/qualifications', priority:85 })
  if (status.status === 'PENDING') items.push({ id:'pending', tone:'blue', icon:'Clock', title:'入驻审核进行中', desc:'通常 3 个工作日内完成', cta:'查看进度', path:'/onboarding', priority:70 })
  if (s.pendingChanges > 0) items.push({ id:'changes', tone:'cyan', icon:'EditPen', title:`${s.pendingChanges} 条变更待审核`, desc:'资料变更等待管理员处理', cta:'查看', path:'/change-records', priority:60 })
  if (s.unreadNotifications > 0) items.push({ id:'unread', tone:'blue', icon:'ChatDotRound', title:`${s.unreadNotifications} 条未读消息`, desc:'可能有重要平台通知', cta:'查看', path:'/notifications', priority:45 })
  if ((s.profileCompleteness?.score || 0) < 80) items.push({ id:'profile', tone:'blue', icon:'OfficeBuilding', title:'完善企业档案', desc:`当前评分 ${s.profileCompleteness?.score||0} 分`, cta:'去完善', path:'/profile', priority:35 })
  items.sort((a, b) => b.priority - a.priority)
  if (items.length === 0) items.push({ id:'clear', tone:'green', icon:'CircleCheckFilled', title:'今日无紧急事项', desc:'一切就绪，去发现新的投标机会', cta:'浏览招标', path:'/bids', priority:0 })
  return items.slice(0, 3)
})
const heroTail = computed(() => {
  const urgent = priorityTasks.value.filter(t => t.tone==='red'||t.tone==='orange').length
  if (urgent>0) return `，有 ${urgent} 项要务建议优先处理（见下方）`
  if (priorityTasks.value.length > 0 && priorityTasks.value[0].id !== 'clear') return '，有几项事务可以顺手处理'
  return '，关注投标机会、资质有效期和待处理消息'
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
  <div class="page-container">
    <!-- Error state -->
    <div v-if="error && !loading" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>

    <!-- Skeleton loading -->
    <div v-else-if="loading">
      <SkeletonCard :lines="2" />
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-top:20px">
        <SkeletonCard v-for="i in 4" :key="i" :lines="1" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 360px;gap:20px;margin-top:20px">
        <div style="display:grid;gap:20px">
          <SkeletonCard :lines="3" v-for="i in 2" :key="i" />
        </div>
        <div style="display:grid;gap:20px">
          <SkeletonCard :lines="2" v-for="i in 2" :key="i" />
        </div>
      </div>
    </div>

    <template v-else-if="statusInfo">
      <!-- Hero -->
      <div class="sp-page-hero-card">
        <div class="sp-page-hero-inner">
          <div class="sp-page-hero-body">
            <h1 class="sp-modern-title">{{ authStore.displayName || statusInfo.name }}，{{ new Date().getHours() < 12 ? '上午好' : new Date().getHours() < 18 ? '下午好' : '晚上好' }}</h1>
            <p class="sp-modern-desc">
              当前状态
              <span class="sp-status" :class="statusType[statusInfo.status] || 'pending'">{{ statusLabel[statusInfo.status] || statusInfo.status }}</span>
              <template v-if="statusInfo.status === 'RETURNED' && statusInfo.returnReason">，{{ statusInfo.returnReason }}</template>
              <template v-else>{{ heroTail }}</template>
            </p>
          </div>
          <div class="sp-page-hero-actions">
            <el-button type="primary" @click="router.push('/bids')">招标机会</el-button>
            <el-button @click="router.push('/my-bids')">投标进展</el-button>
            <el-button @click="router.push('/profile')">完善档案</el-button>
          </div>
        </div>
      </div>

      <!-- 今日要务指挥台 -->
      <section class="db-priority" v-if="priorityTasks.length">
        <div class="db-priority-head"><h2 class="db-priority-title"><el-icon><Aim /></el-icon>今日要务</h2><span class="db-priority-sub">根据您当前状态，建议优先处理</span></div>
        <div class="db-priority-list">
          <div v-for="t in priorityTasks" :key="t.id" class="db-priority-card" :class="'tone-'+t.tone" @click="router.push(t.path)">
            <div class="db-priority-icon" :style="toneStyle(t.tone)"><el-icon :size="18"><component :is="t.icon" /></el-icon></div>
            <div class="db-priority-body"><div class="db-priority-text-title">{{ t.title }}</div><div class="db-priority-text-desc">{{ t.desc }}</div></div>
            <span class="db-priority-cta">{{ t.cta }} <el-icon><ArrowRight /></el-icon></span>
          </div>
        </div>
      </section>

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

/* ── 今日要务指挥台 ── */
.db-priority { margin-bottom: 20px; }
.db-priority-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.db-priority-title { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 800; color: var(--sp-gray-900); margin: 0; }
.db-priority-sub { font-size: 12px; color: var(--sp-gray-400); }
.db-priority-list { display: grid; gap: 10px; }
.db-priority-card { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border: 1px solid var(--sp-border); border-left: 4px solid var(--sp-border); border-radius: var(--sp-radius-md); background: #fff; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s; }
.db-priority-card:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(15,47,87,0.08); }
.db-priority-card.tone-red { border-left-color: var(--sp-red); background: linear-gradient(90deg, var(--sp-red-light) 0%, #fff 36%); }
.db-priority-card.tone-orange { border-left-color: var(--sp-orange); background: linear-gradient(90deg, var(--sp-orange-light) 0%, #fff 36%); }
.db-priority-card.tone-blue { border-left-color: var(--sp-primary); background: linear-gradient(90deg, var(--sp-primary-lighter) 0%, #fff 36%); }
.db-priority-card.tone-green { border-left-color: var(--sp-green); background: linear-gradient(90deg, var(--sp-green-light) 0%, #fff 36%); }
.db-priority-card.tone-cyan { border-left-color: var(--sp-cyan); background: linear-gradient(90deg, var(--sp-cyan-light) 0%, #fff 36%); }
.db-priority-icon { width: 40px; height: 40px; border-radius: var(--sp-radius-sm); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.db-priority-body { flex: 1; min-width: 0; }
.db-priority-text-title { font-size: 14px; font-weight: 800; color: var(--sp-gray-900); }
.db-priority-text-desc { margin-top: 2px; font-size: 12px; color: var(--sp-gray-500); }
.db-priority-cta { display: inline-flex; align-items: center; gap: 3px; font-size: 13px; font-weight: 700; color: var(--sp-primary); white-space: nowrap; flex-shrink: 0; }
.db-priority-card.tone-red .db-priority-cta { color: var(--sp-red); }
.db-priority-card.tone-orange .db-priority-cta { color: var(--sp-orange); }
.db-priority-card.tone-green .db-priority-cta { color: var(--sp-green); }
.db-priority-card.tone-red .db-priority-icon { animation: dbPulse 2s ease-in-out infinite; }
@keyframes dbPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.65; } }

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
