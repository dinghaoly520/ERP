<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { useNotificationStore } from '@/stores/notification'
import { useBidStore } from '@/stores/bid'
import { useAuthStore } from '@/stores/auth'
import SkeletonCard from '@/components/SkeletonCard.vue'
import dayjs from 'dayjs'

const router = useRouter()
const supplierStore = useSupplierStore()
const notifStore = useNotificationStore()
const bidStore = useBidStore()
const authStore = useAuthStore()
const loading = ref(true)
const error = ref(false)

onMounted(async () => {
  try {
    await Promise.all([
      supplierStore.fetchDashboardStats(),
      supplierStore.fetchStatus(),
      supplierStore.fetchEvaluationStats(),
      supplierStore.fetchQualifications(),
      bidStore.fetchProjects(1, 20),
      notifStore.fetchNotifications(1, 10),
    ])
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
})

async function retryLoad() {
  error.value = false; loading.value = true
  try {
    await Promise.all([
      supplierStore.fetchDashboardStats(),
      supplierStore.fetchStatus(),
      supplierStore.fetchEvaluationStats(),
      supplierStore.fetchQualifications(),
      bidStore.fetchProjects(1, 20),
      notifStore.fetchNotifications(1, 10),
    ])
  } catch { error.value = true } finally { loading.value = false }
}

// ── Derived state ──
const stats = computed(() => supplierStore.dashboardStats)
const statusInfo = computed(() => supplierStore.status)
const evalStats = computed(() => supplierStore.evaluationStats)

const statusLabel: Record<string, string> = {
  PENDING: '待审核', RETURNED: '退回补正', APPROVED: '已入库',
  REJECTED: '审核不通过', DISABLED: '已停用', BLACKLIST: '黑名单',
}
const statusType: Record<string, string> = {
  PENDING: 'pending', RETURNED: 'returned', APPROVED: 'approved',
  REJECTED: 'rejected', DISABLED: 'disabled', BLACKLIST: 'disabled',
}

const STAGES = [
  { key: 'DOWNLOAD',    label: '文件下载', color: '#0891b2', icon: 'Download' },
  { key: 'SUBMIT',      label: '加密投递', color: '#0a5eb8', icon: 'Upload'  },
  { key: 'OPENING',     label: '在线开标', color: '#d97706', icon: 'View'    },
  { key: 'EVALUATING',  label: '专家评标', color: '#7c3aed', icon: 'Edit'    },
  { key: 'ARCHIVED',    label: '已归档',   color: '#059669', icon: 'Folder'  },
] as const

// ── KPI strip (6 cells with secondary context) ──
interface KpiCell { key: string; value: number; label: string; sub: string; subTone: string; path: string; tone?: string }
const kpiCells = computed<KpiCell[]>(() => {
  const s = stats.value
  if (!s) return []
  const qs = supplierStore.qualifications
  const now = Date.now()
  const expiring30d = qs.filter((q: any) => q.validTo && new Date(q.validTo).getTime() - now < 30*86400000 && new Date(q.validTo).getTime() > now).length
  const expired = qs.filter((q: any) => q.validTo && new Date(q.validTo).getTime() < now).length
  return [
    { key:'submissions', value:s.submissionCount, label:'投标记录', sub:s.submissionCount>0?'已提交标书':'暂无记录', subTone:s.submissionCount>0?'blue':'gray', path:'/my-bids' },
    { key:'quals',       value:s.qualificationCount, label:'资质证照', sub:`${qs.length-expired-expiring30d} 有效`, subTone:'green', path:'/qualifications' },
    { key:'changes',     value:s.pendingChanges, label:'待审变更', sub:s.pendingChanges>0?'等待审核':'无待办', subTone:s.pendingChanges>0?'orange':'gray', path:'/change-records' },
    { key:'expiring',    value:expiring30d+expired, label:'到期风险', sub:expired>0?`${expired} 已过期`:expiring30d>0?`${expiring30d} 项30天内`: '状态良好', subTone:expired>0?'red':expiring30d>0?'orange':'green', path:'/qualifications', tone:'var(--sp-red)' },
    { key:'completeness',value:s.profileCompleteness?.score??0, label:'资料完整度', sub:s.profileCompleteness?.score>=80?'完善':s.profileCompleteness?.score>=50?'待补充':'需完善', subTone:s.profileCompleteness?.score>=80?'green':s.profileCompleteness?.score>=50?'orange':'red', path:'/profile', tone:'var(--sp-primary)' },
    { key:'unread',      value:s.unreadNotifications, label:'未读消息', sub:s.unreadNotifications>0?`${s.unreadNotifications} 条未读`:'全部已读', subTone:s.unreadNotifications>0?'blue':'gray', path:'/notifications', tone:'var(--sp-cyan)' },
  ]
})

function kpiSubClass(tone: string) {
  return `db-kpi-sub ${tone}`
}

// ── Projects with urgency ──
interface ProjectRow { project: any; daysLeft: number; urgency: 'critical'|'warning'|'normal'|'past' }
const projectRows = computed<ProjectRow[]>(() => {
  const now = Date.now()
  return bidStore.projects.slice(0, 8).map((p: any) => {
    const dl = new Date(p.deadline).getTime()
    const daysLeft = Math.ceil((dl - now) / 86400000)
    let urgency: ProjectRow['urgency'] = 'normal'
    if (dl < now) urgency = 'past'
    else if (daysLeft <= 3) urgency = 'critical'
    else if (daysLeft <= 14) urgency = 'warning'
    return { project: p, daysLeft, urgency }
  }).sort((a, b) => {
    const o = { critical:0, warning:1, normal:2, past:3 }
    return (o[a.urgency]??2) - (o[b.urgency]??2)
  })
})

// ── Qualification health ──
const qualHealth = computed(() => {
  const qs = supplierStore.qualifications
  const now = Date.now()
  let valid=0, expiring=0, expired=0, longTerm=0
  const expiringList: any[] = []
  qs.forEach((q: any) => {
    if (!q.validTo) { longTerm++; return }
    const diff = (new Date(q.validTo).getTime() - now) / 86400000
    if (diff < 0) { expired++; expiringList.push({...q, daysLeft: Math.round(diff)}) }
    else if (diff < 30) { expiring++; expiringList.push({...q, daysLeft: Math.round(diff)}) }
    else valid++
  })
  const total = qs.length
  const healthScore = total > 0 ? Math.round(((valid + longTerm) / total) * 100) : 0
  return { total, valid, expiring, expired, longTerm, healthScore, expiringList: expiringList.slice(0, 3) }
})
const healthRingDash = computed(() => {
  const pct = qualHealth.value.healthScore
  const c = 2 * Math.PI * 34
  return `${(c * pct) / 100} ${c - (c * pct) / 100}`
})
const healthColor = computed(() => {
  if (qualHealth.value.expired > 0) return 'var(--sp-red)'
  if (qualHealth.value.expiring > 0) return 'var(--sp-orange)'
  return 'var(--sp-green)'
})

// ── Notification feed with type icons ──
const notifFeed = computed(() => {
  return notifStore.notifications.slice(0, 6).map((n: any) => {
    let icon = 'Bell'; let tone = 'gray'
    if (n.type === 'BID') { icon = 'Document'; tone = 'blue' }
    else if (n.type === 'QUALIFICATION') { icon = 'Medal'; tone = 'orange' }
    else if (n.type === 'SYSTEM') { icon = 'Setting'; tone = 'purple' }
    return { ...n, icon, tone }
  })
})

// ── Registration days ──
const daysSinceReg = computed(() => {
  const created = statusInfo.value?.createdAt
  if (!created) return null
  return Math.ceil((Date.now() - new Date(created).getTime()) / 86400000)
})
</script>

<template>
  <div class="page-container">
    <!-- ═══ Error State ═══ -->
    <div v-if="error && !loading" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>

    <!-- ═══ Skeleton ═══ -->
    <template v-else-if="loading">
      <SkeletonCard :lines="2" style="margin-bottom:20px" />
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:0;margin-bottom:20px">
        <SkeletonCard v-for="i in 6" :key="i" :lines="1" />
      </div>
      <SkeletonCard :lines="1" style="margin-bottom:20px;height:56px" />
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px">
        <SkeletonCard v-for="i in 3" :key="i" :lines="5" />
      </div>
    </template>

    <template v-else-if="statusInfo">
      <!-- ═══════════════════════════════════════════
           ROW 0: HERO — compact operational summary
           ═══════════════════════════════════════════ -->
      <div class="db-hero">
        <div class="db-hero-left">
          <div class="db-hero-topline">
            <h1 class="db-hero-name">{{ authStore.displayName || statusInfo.name }}</h1>
            <span class="sp-status" :class="statusType[statusInfo.status]||'pending'">{{ statusLabel[statusInfo.status]||statusInfo.status }}</span>
            <span v-if="daysSinceReg" class="db-hero-meta">入驻 {{ daysSinceReg }} 天</span>
          </div>
          <div class="db-hero-subline">
            <template v-if="statusInfo.status === 'APPROVED'">
              <span class="db-hero-stat">
                <span class="db-hero-stat-label">综合评分</span>
                <span class="db-hero-stat-value">{{ evalStats?.avgScore ? evalStats.avgScore.toFixed(1) : '--' }}</span>
                <span class="db-hero-stat-unit">分</span>
              </span>
              <span class="db-hero-div">·</span>
              <span class="db-hero-stat">
                <span class="db-hero-stat-label">评价次数</span>
                <span class="db-hero-stat-value">{{ evalStats?.total ?? 0 }}</span>
                <span class="db-hero-stat-unit">次</span>
              </span>
              <span class="db-hero-div">·</span>
              <span class="db-hero-stat">
                <span class="db-hero-stat-label">A级评价</span>
                <span class="db-hero-stat-value">{{ evalStats?.levelCounts?.A ?? 0 }}</span>
                <span class="db-hero-stat-unit">次</span>
              </span>
            </template>
            <template v-else-if="statusInfo.status === 'PENDING'">
              <span class="db-hero-hint">审核中 — 通常 3 个工作日内完成</span>
            </template>
            <template v-else-if="statusInfo.status === 'RETURNED'">
              <span class="db-hero-hint warn">{{ statusInfo.returnReason || '资料被退回，请根据审核意见补正' }}</span>
            </template>
            <template v-else>
              <span class="db-hero-hint">{{ new Date().getHours() < 12 ? '上午好' : new Date().getHours() < 18 ? '下午好' : '晚上好' }}，欢迎回来</span>
            </template>
          </div>
        </div>
        <div class="db-hero-right">
          <el-button type="primary" size="large" @click="router.push('/bids')">可投标项目</el-button>
          <el-button size="large" @click="router.push('/my-bids')">投标进展</el-button>
          <el-button size="large" @click="router.push('/profile')">完善档案</el-button>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════
           ROW 1: KPI STRIP — 6 cells with sub-metrics
           ═══════════════════════════════════════════ -->
      <div class="sp-stat-row db-kpi-row" v-if="stats">
        <div
          v-for="cell in kpiCells"
          :key="cell.key"
          class="sp-stat-cell db-kpi-cell"
          :class="{ clickable: !!cell.path }"
          @click="cell.path && router.push(cell.path)"
        >
          <div class="db-kpi-value" :style="cell.tone ? { color: cell.tone } : {}">
            {{ cell.value }}<span v-if="cell.key==='completeness'" class="db-kpi-suffix">%</span>
          </div>
          <div class="db-kpi-label">{{ cell.label }}</div>
          <div class="db-kpi-sub" :class="cell.subTone">{{ cell.sub }}</div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════
           ROW 2: THREE-PANEL GRID
           ═══════════════════════════════════════════ -->
      <div class="db-panels">
        <!-- ── PANEL A: Projects ── -->
        <section class="sp-module db-panel">
          <div class="sp-module-header">
            <h2 class="sp-module-title">招标项目</h2>
            <el-button link type="primary" @click="router.push('/bids')">全部<el-icon style="margin-left:2px;font-size:12px"><ArrowRight /></el-icon></el-button>
          </div>
          <div v-if="projectRows.length === 0" class="sp-empty" style="padding:32px 0">
            <div class="sp-empty-icon"><el-icon :size="20"><Folder /></el-icon></div>
            <div class="sp-empty-text">暂无招标项目</div>
          </div>
          <div v-else class="db-project-list">
            <div
              v-for="row in projectRows"
              :key="row.project.id"
              class="db-project-row"
              :class="row.urgency"
              @click="router.push(`/bids/${row.project.id}`)"
            >
              <div class="db-project-left">
                <span class="db-project-name">{{ row.project.name }}</span>
                <span class="db-project-code">{{ row.project.projectCode }}</span>
              </div>
              <div class="db-project-right">
                <span
                  class="db-project-stage-tag"
                  :style="{ background: (STAGES.find(s=>s.key===row.project.stage)?.color||'#94a3b8')+'14', color: STAGES.find(s=>s.key===row.project.stage)?.color||'#94a3b8' }"
                >{{ STAGES.find(s=>s.key===row.project.stage)?.label||row.project.stage }}</span>
                <span class="db-project-deadline" :class="row.urgency">
                  {{ row.urgency==='past'?'已截止':row.urgency==='critical'?`${row.daysLeft}天后`:`${row.daysLeft}天` }}
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- ── PANEL B: Qualification Health ── -->
        <section class="sp-module db-panel">
          <div class="sp-module-header">
            <h2 class="sp-module-title">资质健康</h2>
            <el-button link type="primary" @click="router.push('/qualifications')">管理<el-icon style="margin-left:2px;font-size:12px"><ArrowRight /></el-icon></el-button>
          </div>
          <div v-if="qualHealth.total === 0" class="sp-empty" style="padding:32px 0">
            <div class="sp-empty-icon"><el-icon :size="20"><Medal /></el-icon></div>
            <div class="sp-empty-text">暂无资质材料</div>
          </div>
          <div v-else class="db-health-body">
            <div class="db-health-top">
              <div class="db-health-ring">
                <svg width="76" height="76" viewBox="0 0 76 76">
                  <circle cx="38" cy="38" r="32" fill="none" stroke="var(--sp-gray-100)" stroke-width="6"/>
                  <circle cx="38" cy="38" r="32" fill="none" :stroke="healthColor" stroke-width="6" stroke-linecap="round" :stroke-dasharray="healthRingDash" transform="rotate(-90 38 38)"/>
                </svg>
                <span class="db-health-score">{{ qualHealth.healthScore }}<small>%</small></span>
              </div>
              <div class="db-health-counts">
                <div class="db-health-count valid">{{ qualHealth.valid }}<span>有效</span></div>
                <div class="db-health-count expiring">{{ qualHealth.expiring }}<span>即将</span></div>
                <div class="db-health-count expired">{{ qualHealth.expired }}<span>过期</span></div>
              </div>
            </div>
            <div v-if="qualHealth.expiringList.length > 0" class="db-health-list">
              <div v-for="q in qualHealth.expiringList" :key="q.id" class="db-health-item">
                <span class="db-health-item-dot" :class="{ red: q.daysLeft < 0 }"></span>
                <span class="db-health-item-name">{{ q.name }}</span>
                <span class="db-health-item-date" :class="{ red: q.daysLeft < 0 }">
                  {{ q.daysLeft < 0 ? `已过期${Math.abs(q.daysLeft)}天` : `${q.daysLeft}天后到期` }}
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- ── PANEL C: Notifications ── -->
        <section class="sp-module db-panel">
          <div class="sp-module-header">
            <h2 class="sp-module-title">最近消息</h2>
            <el-button link type="primary" @click="router.push('/notifications')">全部<el-icon style="margin-left:2px;font-size:12px"><ArrowRight /></el-icon></el-button>
          </div>
          <div v-if="notifFeed.length === 0" class="sp-empty" style="padding:32px 0">
            <div class="sp-empty-icon"><el-icon :size="20"><Bell /></el-icon></div>
            <div class="sp-empty-text">暂无消息</div>
          </div>
          <div v-else class="db-notif-list">
            <div
              v-for="n in notifFeed"
              :key="n.id"
              class="db-notif-row"
              :class="{ unread: !n.isRead }"
              @click="router.push('/notifications')"
            >
              <span class="db-notif-dot" :class="n.tone"></span>
              <div class="db-notif-body">
                <span class="db-notif-title">{{ n.title }}</span>
                <span class="db-notif-ct" v-if="n.content">{{ n.content }}</span>
              </div>
              <span class="db-notif-time">{{ dayjs(n.createdAt).format('MM-DD HH:mm') }}</span>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   HERO — compact operational strip
   ═══════════════════════════════════════════════ */
.db-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  background: var(--sp-surface);
  border: 1px solid var(--sp-border);
  border-radius: var(--sp-radius-lg);
  padding: 20px 24px;
  margin-bottom: 20px;
}
.db-hero-left { min-width: 0; }
.db-hero-topline {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.db-hero-name {
  margin: 0;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: var(--sp-gray-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.db-hero-meta {
  font-size: 12px;
  color: var(--sp-gray-400);
  font-variant-numeric: tabular-nums;
}
.db-hero-subline {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.db-hero-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.db-hero-stat-label { color: var(--sp-gray-400); font-size: 12px; }
.db-hero-stat-value {
  font-size: 18px;
  font-weight: 900;
  color: var(--sp-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.db-hero-stat-unit { color: var(--sp-gray-400); font-size: 12px; }
.db-hero-div { color: var(--sp-gray-300); margin: 0 2px; }
.db-hero-hint { color: var(--sp-gray-500); font-size: 13px; }
.db-hero-hint.warn { color: var(--sp-orange); font-weight: 600; }
.db-hero-right { display: flex; gap: 8px; flex-shrink: 0; }

/* ═══════════════════════════════════════════════
   KPI STRIP — 6 cells with sub-metrics
   ═══════════════════════════════════════════════ */
.db-kpi-row {
  margin-bottom: 16px;
}
.db-kpi-cell {
  padding: 14px 16px;
  cursor: default;
}
.db-kpi-cell.clickable {
  cursor: pointer;
  transition: background var(--sp-duration-fast) var(--sp-ease);
}
.db-kpi-cell.clickable:hover { background: var(--sp-gray-50); }
.db-kpi-value {
  font-size: 22px;
  font-weight: 900;
  color: var(--sp-gray-900);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.db-kpi-suffix {
  font-size: 14px;
  font-weight: 600;
  color: var(--sp-gray-400);
  margin-left: 1px;
}
.db-kpi-label {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--sp-gray-500);
}
.db-kpi-sub {
  margin-top: 3px;
  font-size: 11px;
  font-weight: 600;
}
.db-kpi-sub.green  { color: var(--sp-green); }
.db-kpi-sub.orange { color: var(--sp-orange); }
.db-kpi-sub.red    { color: var(--sp-red); }
.db-kpi-sub.blue   { color: var(--sp-primary); }
.db-kpi-sub.gray   { color: var(--sp-gray-400); }

/* ═══════════════════════════════════════════════
   THREE-PANEL GRID
   ═══════════════════════════════════════════════ */
.db-panels {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 20px;
  align-items: start;
}
.db-panel {
  min-height: 200px;
}

/* ── Panel A: Project list ── */
.db-project-list {
  display: flex;
  flex-direction: column;
}
.db-project-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--sp-border-light);
  cursor: pointer;
  transition: background var(--sp-duration-fast) var(--sp-ease);
}
.db-project-row:last-child { border-bottom: none; }
.db-project-row:hover { background: var(--sp-gray-50); margin: 0 -16px; padding: 10px 16px; }
.db-project-row.critical { background: linear-gradient(90deg, var(--sp-red-light) 0%, transparent 30%); }
.db-project-row.critical:hover { background: linear-gradient(90deg, var(--sp-red-light) 0%, var(--sp-gray-50) 60%); margin: 0 -16px; padding: 10px 16px; }
.db-project-left { min-width: 0; flex: 1; }
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
  font-family: 'SF Mono', 'JetBrains Mono', monospace;
}
.db-project-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.db-project-stage-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 700;
  white-space: nowrap;
}
.db-project-deadline {
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--sp-gray-500);
  min-width: 48px;
  text-align: right;
}
.db-project-deadline.critical { color: var(--sp-red); }
.db-project-deadline.warning  { color: var(--sp-orange); }
.db-project-deadline.past     { color: var(--sp-gray-400); text-decoration: line-through; }

/* ── Panel B: Qualification health ── */
.db-health-body { }
.db-health-top {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}
.db-health-ring {
  position: relative;
  width: 76px;
  height: 76px;
  flex-shrink: 0;
}
.db-health-score {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 900;
  color: var(--sp-gray-900);
  line-height: 1;
}
.db-health-score small {
  font-size: 11px;
  font-weight: 600;
  color: var(--sp-gray-400);
  margin-left: 1px;
}
.db-health-counts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.db-health-count {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 4px;
}
.db-health-count.valid    { background: #ecfdf5; color: #059669; }
.db-health-count.expiring { background: #fffbeb; color: #d97706; }
.db-health-count.expired  { background: #fef2f2; color: #dc2626; }
.db-health-count span { font-size: 10px; opacity: 0.7; }
.db-health-list {
  border-top: 1px solid var(--sp-border-light);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.db-health-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.db-health-item-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--sp-orange);
  flex-shrink: 0;
}
.db-health-item-dot.red { background: var(--sp-red); }
.db-health-item-name {
  flex: 1;
  font-weight: 600;
  color: var(--sp-gray-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-health-item-date {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--sp-orange);
  white-space: nowrap;
}
.db-health-item-date.red { color: var(--sp-red); }

/* ── Panel C: Notification feed ── */
.db-notif-list {
  display: flex;
  flex-direction: column;
}
.db-notif-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--sp-border-light);
  cursor: pointer;
  transition: background var(--sp-duration-fast) var(--sp-ease);
}
.db-notif-row:last-child { border-bottom: none; }
.db-notif-row:hover { background: var(--sp-gray-50); margin: 0 -16px; padding: 10px 16px; }
.db-notif-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 4px;
  flex-shrink: 0;
  background: var(--sp-gray-300);
}
.db-notif-dot.blue   { background: var(--sp-primary); }
.db-notif-dot.orange { background: var(--sp-orange); }
.db-notif-dot.purple { background: var(--sp-purple); }
.db-notif-row.unread .db-notif-dot {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sp-primary) 18%, transparent);
}
.db-notif-body { flex: 1; min-width: 0; }
.db-notif-title {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--sp-gray-600);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-notif-row.unread .db-notif-title {
  font-weight: 700;
  color: var(--sp-gray-900);
}
.db-notif-ct {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--sp-gray-400);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-notif-time {
  font-size: 10px;
  color: var(--sp-gray-400);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  margin-top: 2px;
}

/* ═══════════════════════════════════════════════
   RESPONSIVE
   ═══════════════════════════════════════════════ */
@media (max-width: 1300px) {
  .db-panels { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 1100px) {
  .db-hero { flex-direction: column; align-items: stretch; }
  .db-hero-right { justify-content: flex-start; }
  .db-kpi-row { grid-template-columns: repeat(3, 1fr); }
  .db-kpi-cell:nth-child(n+4) { border-bottom: 1px solid var(--sp-border-light); }
  .db-kpi-cell:nth-child(3) { border-right: none; }
}
@media (max-width: 768px) {
  .db-kpi-row { grid-template-columns: repeat(2, 1fr); }
  .db-kpi-cell:nth-child(3) { border-right: 1px solid var(--sp-border-light); }
  .db-panels { grid-template-columns: 1fr; }
}
</style>
