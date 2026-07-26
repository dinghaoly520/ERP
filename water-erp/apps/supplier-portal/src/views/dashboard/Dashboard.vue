<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { useNotificationStore } from '@/stores/notification'
import { useBidStore } from '@/stores/bid'
import SkeletonCard from '@/components/SkeletonCard.vue'
import SpKpi from '@/components/SpKpi.vue'
import { AlertTriangle } from 'lucide-vue-next'
import dayjs from 'dayjs'

const router = useRouter()
const supplierStore = useSupplierStore()
const notifStore = useNotificationStore()
const bidStore = useBidStore()
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
  } catch { error.value = true } finally { loading.value = false }
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
  { key: 'DOWNLOAD',    label: '文件下载', color: '#0891b2' },
  { key: 'SUBMIT',      label: '加密投递', color: '#c00a6b' },
  { key: 'OPENING',     label: '在线开标', color: '#d97706' },
  { key: 'EVALUATING',  label: '专家评标', color: '#7c3aed' },
  { key: 'ARCHIVED',    label: '已归档',   color: '#059669' },
] as const

// ── KPI strip ──
interface KpiCell { key: string; value: number; label: string; path: string; tone?: string }
const kpiCells = computed<KpiCell[]>(() => {
  const s = stats.value; if (!s) return []
  return [
    { key:'submissions',  value:s.submissionCount,          label:'投标记录', path:'/my-bids' },
    { key:'quals',        value:s.qualificationCount,       label:'资质证照', path:'/qualifications' },
    { key:'changes',      value:s.pendingChanges,           label:'待审变更', path:'/change-records' },
    { key:'expiring',     value:s.expiringQualifications,   label:'到期风险', path:'/qualifications', tone:'var(--danger)' },
    { key:'completeness', value:s.profileCompleteness?.score??0, label:'资料完整度',path:'/profile', tone:'var(--brand)' },
    { key:'unread',       value:s.unreadNotifications,      label:'未读消息', path:'/notifications', tone:'var(--water)' },
  ]
})

// ── Profile completeness categories ──
interface CatDim { key: string; label: string; score: number; max: number; filled: number; total: number; icon: string; color: string; missing: string[]; count?: number; hasPrimary?: boolean; hasLicense?: boolean }
const completenessCats = computed<CatDim[]>(() => {
  const cats = stats.value?.profileCompleteness?.categories
  if (!cats) return []
  return [
    { key:'basic', label:'基本资料', ...cats.basic, icon:'OfficeBuilding', color:'#064ea2' },
    { key:'contacts', label:'联系人', ...cats.contacts, icon:'Phone', color:'#0a5eb8' },
    { key:'qualifications', label:'资质材料', ...cats.qualifications, icon:'Medal', color:'#059669' },
  ]
})
function catStatLabel(cat: CatDim): string {
  if (cat.key === 'basic') return `${cat.filled}/${cat.total} 项`
  if (cat.key === 'contacts') return `${cat.count ?? cat.filled} 人`
  if (cat.key === 'qualifications') return `${cat.count ?? cat.filled} 项`
  return `${cat.filled}/${cat.total}`
}
const profileScore = computed(() => stats.value?.profileCompleteness?.score ?? 0)

// ── Projects ──
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
  }).sort((a, b) => ({ critical:0, warning:1, normal:2, past:3 } as any)[a.urgency] - ({ critical:0, warning:1, normal:2, past:3 } as any)[b.urgency])
})

// ── Notifications ──
const NOTIF_COLORS: Record<string, { dot: string; glow: string }> = {
  SUPPLIER_APPROVED:      { dot: '#059669', glow: 'rgba(5,150,105,0.18)' },
  SUPPLIER_REJECTED:      { dot: '#dc2626', glow: 'rgba(220,38,38,0.18)' },
  SUPPLIER_RETURNED:      { dot: '#d97706', glow: 'rgba(217,119,6,0.18)' },
  BID_PUBLISHED:          { dot: '#2563eb', glow: 'rgba(37,99,235,0.18)' },
  BID_REMINDER:          { dot: '#ea580c', glow: 'rgba(234,88,12,0.18)' },
  BID_OPENING:            { dot: '#0891b2', glow: 'rgba(8,145,178,0.18)' },
  BID_EVALUATION_RESULT:  { dot: '#7c3aed', glow: 'rgba(124,58,237,0.18)' },
  CLARIFICATION_REPLIED:  { dot: '#0d9488', glow: 'rgba(13,148,136,0.18)' },
  SYSTEM:                 { dot: '#475569', glow: 'rgba(71,85,105,0.18)' },
}
const notifFeed = computed(() =>
  notifStore.notifications.slice(0, 4).map((n: any) => ({
    ...n,
    color: NOTIF_COLORS[n.type] || NOTIF_COLORS.SYSTEM,
  }))
)

// ── Days since registration ──
const daysSinceReg = computed(() => {
  const created = statusInfo.value?.createdAt
  if (!created) return null
  return Math.ceil((Date.now() - new Date(created).getTime()) / 86400000)
})
</script>

<template>
  <div class="page-container">
    <!-- Error -->
    <div v-if="error && !loading" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>

    <!-- Skeleton -->
    <template v-else-if="loading">
      <SkeletonCard :lines="2" style="margin-bottom:20px" />
      <div class="kpi-grid" style="margin-bottom:20px">
        <SkeletonCard v-for="i in 6" :key="i" :lines="1" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 380px;gap:20px">
        <SkeletonCard :lines="8" />
        <div style="display:grid;gap:20px">
          <SkeletonCard :lines="5" />
          <SkeletonCard :lines="4" />
        </div>
      </div>
    </template>

    <template v-else-if="statusInfo">
      <!-- ═══════════════════════ Hero (greeting card, neumorphic) ═══════════════════════ -->
      <div class="page-hero db-hero">
        <div class="page-hero__row">
          <div class="page-hero__left">
            <div class="page-hero__icon"><el-icon :size="20"><OfficeBuilding /></el-icon></div>
            <div>
              <div class="page-hero__eyebrow">业务工作台</div>
              <div class="page-hero__title">{{ statusInfo.name }}</div>
              <div class="page-hero__sub db-hero-sub">
                <span class="sp-status" :class="statusType[statusInfo.status]||'pending'">{{ statusLabel[statusInfo.status]||statusInfo.status }}</span>
                <span v-if="daysSinceReg" class="db-hero-meta">入驻 {{ daysSinceReg }} 天</span>
                <template v-if="statusInfo.status === 'APPROVED'">
                  <span class="db-hero-div">·</span>
                  <span class="db-hero-stat"><strong>{{ evalStats?.avgScore ? evalStats.avgScore.toFixed(1) : '--' }}</strong> 分</span>
                  <span class="db-hero-stat"><strong>{{ evalStats?.total ?? 0 }}</strong> 次评价</span>
                </template>
                <template v-else-if="statusInfo.status === 'PENDING'">
                  <span class="db-hero-hint">审核中 — 通常 3 个工作日内完成</span>
                </template>
                <template v-else-if="statusInfo.status === 'RETURNED'">
                  <span class="db-hero-hint warn">{{ statusInfo.returnReason || '资料被退回，请补正' }}</span>
                </template>
              </div>
            </div>
          </div>
          <div class="page-hero__right db-hero-right">
            <div class="neu-btn-group">
              <button class="neu-btn-soft" @click="router.push('/bids')">可投标项目</button>
              <button class="neu-btn-soft" @click="router.push('/my-bids')">投标进展</button>
              <button class="neu-btn-primary" @click="router.push('/profile')">完善档案</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════ KPI Strip (SpKpi tiles) ═══════════════════════ -->
      <div class="kpi-grid" v-if="stats">
        <SpKpi
          v-for="cell in kpiCells"
          :key="cell.key"
          :label="cell.label"
          :value="cell.value"
          :suffix="cell.key === 'completeness' ? '%' : undefined"
          :to="cell.path"
          :tone="cell.tone"
        />
      </div>

      <!-- ═══════════════════════ Two-column body ═══════════════════════ -->
      <div class="db-body">
        <!-- LEFT: bid projects -->
        <section class="sp-module db-panel-left">
          <div class="sp-module-header">
            <h2 class="sp-module-title">招标项目</h2>
            <button class="neu-btn-xs" @click="router.push('/bids')">全部<el-icon style="font-size:12px"><ArrowRight /></el-icon></button>
          </div>
          <div v-if="projectRows.length === 0" class="sp-empty" style="padding:32px 0">
            <div class="sp-empty-icon"><el-icon :size="20"><Folder /></el-icon></div>
            <div class="sp-empty-text">暂无招标项目</div>
          </div>
          <div v-else class="db-list">
            <div
              v-for="(row, idx) in projectRows"
              :key="row.project.id"
              class="db-list-row"
              :class="[row.urgency, { 'is-last': idx === projectRows.length - 1, 'submit-stage': row.project.stage === 'SUBMIT' }]"
              @click="router.push(`/bids/${row.project.id}?from=list`)"
            >
              <div class="db-list-info">
                <span class="db-list-name">{{ row.project.name }}</span>
                <span class="db-list-code">{{ row.project.projectCode }}</span>
              </div>
              <div class="db-list-right">
                <span
                  class="db-list-stage"
                  :style="{ '--stage-c': STAGES.find(s=>s.key===row.project.stage)?.color || '#94a3b8' } as any"
                >{{ STAGES.find(s=>s.key===row.project.stage)?.label || row.project.stage }}</span>
                <span class="db-list-dl" :class="row.urgency">
                  {{ row.urgency==='past'?'已截止':row.urgency==='critical'?`剩${row.daysLeft}天`:`${row.daysLeft}天` }}
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- RIGHT: profile + notifications stack -->
        <div class="db-right-stack">
          <!-- RIGHT TOP: 资料完整度 -->
          <section class="sp-module db-panel-comp">
            <div class="sp-module-header">
              <h2 class="sp-module-title">资料完善</h2>
              <button class="neu-btn-xs" @click="router.push('/profile')">完善<el-icon style="font-size:12px"><ArrowRight /></el-icon></button>
            </div>
            <!-- Ring + total score -->
            <div class="db-comp-top">
              <div class="db-comp-ring">
                <svg width="72" height="72" viewBox="0 0 72 72">
                  <circle cx="36" cy="36" r="30" fill="none" stroke="var(--hairline)" stroke-width="5"/>
                  <circle
                    cx="36" cy="36" r="30"
                    fill="none"
                    :stroke="profileScore >= 80 ? 'var(--success)' : profileScore >= 50 ? 'var(--warning)' : 'var(--danger)'"
                    stroke-width="5"
                    stroke-linecap="round"
                    :stroke-dasharray="`${2 * Math.PI * 30 * profileScore / 100} ${2 * Math.PI * 30 * (1 - profileScore/100)}`"
                    transform="rotate(-90 36 36)"
                  />
                </svg>
                <span class="db-comp-score">{{ profileScore }}<small>分</small></span>
              </div>
              <div class="db-comp-bars">
                <div v-for="cat in completenessCats" :key="cat.key" class="db-comp-bar-row" :style="{ '--c': cat.color } as any">
                  <div class="db-comp-bar-head">
                    <span class="db-comp-bar-icon"><el-icon :size="13"><component :is="cat.icon" /></el-icon></span>
                    <span class="db-comp-bar-label">{{ cat.label }}</span>
                    <span class="db-comp-bar-stat">{{ catStatLabel(cat) }}</span>
                  </div>
                  <div class="db-comp-bar-track">
                    <div
                      class="db-comp-bar-fill"
                      :style="{ width: cat.max>0 ? (cat.score/cat.max*100)+'%' : '0%' }"
                    />
                  </div>
                </div>
              </div>
            </div>
            <!-- Missing hints -->
            <div v-if="completenessCats.some(c => c.missing.length > 0)" class="db-comp-missing">
              <span v-for="cat in completenessCats" :key="'m-'+cat.key" :style="{ '--c': cat.color } as any">
                <span v-for="m in cat.missing" :key="m" class="db-comp-missing-tag" @click="router.push('/profile')">
                  <span class="db-comp-missing-dot" />
                  {{ m }}
                </span>
              </span>
            </div>
            <div v-else class="db-comp-done">
              <el-icon><CircleCheckFilled /></el-icon> 所有资料已完善
            </div>
          </section>

          <!-- RIGHT BOTTOM: notifications -->
          <section class="sp-module db-panel-msg">
            <div class="sp-module-header">
              <h2 class="sp-module-title">最近消息</h2>
              <button class="neu-btn-xs" @click="router.push('/notifications')">全部<el-icon style="font-size:12px"><ArrowRight /></el-icon></button>
            </div>
            <div v-if="notifFeed.length === 0" class="sp-empty" style="padding:24px 0">
              <div class="sp-empty-icon"><el-icon :size="18"><Bell /></el-icon></div>
              <div class="sp-empty-text">暂无消息</div>
            </div>
            <div v-else class="db-msg-list">
              <div
                v-for="(n, idx) in notifFeed"
                :key="n.id"
                class="db-msg-row"
                :class="{ unread: !n.isRead, 'is-last': idx === notifFeed.length - 1 }"
                @click="router.push('/notifications')"
              >
                <span class="db-msg-dot" :style="{ '--c': n.color.dot, '--g': n.color.glow } as any" />
                <div class="db-msg-body">
                  <span class="db-msg-title" :class="{ unread: !n.isRead }">{{ n.title }}</span>
                  <span v-if="n.content" class="db-msg-ct">{{ n.content }}</span>
                </div>
                <span class="db-msg-time">{{ dayjs(n.createdAt).format('MM-DD HH:mm') }}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ═══════════════ Hero — 复用 cgzxui 全局 .page-hero（105deg 渐变 + 方向性双影 + ::after 光晕，
   对齐 :3005 dashboard-home 的 page-hero）。.db-hero 仅覆盖子元素排版。 ═══════════════ */
.db-hero { margin-bottom: 20px; }
.db-hero .page-hero__title { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-hero-sub { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.db-hero-meta { font-size: 12px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.db-hero-stat { font-size: 12px; color: var(--muted-foreground); }
.db-hero-stat strong { font-size: 14px; font-weight: 800; color: var(--brand); font-variant-numeric: tabular-nums; }
.db-hero-div { color: var(--hairline); }
.db-hero-hint { font-size: 12px; color: var(--muted-foreground); }
.db-hero-hint.warn { color: var(--warning); font-weight: 600; }
.db-hero-right { flex-shrink: 0; }

/* ═══════════════ KPI strip spacing — consistent 20px rhythm with hero + body ═══════════════ */
:deep(.kpi-grid) { margin: 20px 0; }

/* ═══════════════ Two-column body ═══════════════ */
.db-body {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 20px;
  align-items: stretch;  /* 两列等高：右列撑满左列高度 */
}
.db-right-stack {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
  height: 100%;  /* 撑满 grid 轨道，使 margin-top:auto 生效 */
}
.db-panel-left { min-height: 200px; min-width: 0; }
.db-panel-comp { min-width: 0; flex-shrink: 0; }
.db-panel-msg { min-width: 0; flex-shrink: 0; margin-top: auto; }  /* 沉底对齐左列底部 */

/* ── LEFT: Project list ── */
.db-list { display: flex; flex-direction: column; }
.db-list-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 11px 0; border-bottom: 1px solid var(--hairline);
  cursor: pointer; transition: background var(--sp-duration-fast, .15s) var(--sp-ease, ease);
}
.db-list-row.is-last { border-bottom: none; }
.db-list-row:hover { background: oklch(0.985 0.01 258 / 0.5); border-radius: 8px; }
.db-list-row.critical { background: linear-gradient(90deg, color-mix(in oklab, oklch(0.72 0.16 350) 9%, transparent) 0%, transparent 26%); }
.db-list-row.critical:hover { background: linear-gradient(90deg, color-mix(in oklab, oklch(0.72 0.16 350) 13%, transparent) 0%, oklch(0.985 0.01 258 / 0.5) 50%); border-radius: 8px; }
/* SUBMIT 阶段洋红色强调 */
.db-list-row.submit-stage { background: linear-gradient(90deg, color-mix(in oklab, oklch(0.58 0.22 340) 8%, transparent) 0%, transparent 24%); }
.db-list-row.submit-stage:hover { background: linear-gradient(90deg, color-mix(in oklab, oklch(0.58 0.22 340) 12%, transparent) 0%, oklch(0.985 0.01 258 / 0.5) 50%); border-radius: 8px; }
.db-list-info { min-width: 0; flex: 1; overflow: hidden; }
.db-list-name { display: block; font-size: 13px; font-weight: 700; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.db-list-code { display: block; margin-top: 2px; font-size: 11px; color: var(--muted-foreground); font-family: 'SF Mono','JetBrains Mono',monospace; }
.db-list-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.db-list-stage { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 5px; font-size: 10.5px; font-weight: 700; white-space: nowrap; color: var(--stage-c, var(--muted-foreground)); background: color-mix(in oklab, var(--stage-c, #94a3b8) 12%, transparent); }
.db-list-dl { font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--muted-foreground); min-width: 44px; text-align: right; }
.db-list-dl.critical { color: oklch(0.68 0.14 350); font-weight: 800; }
.db-list-dl.warning  { color: var(--warning); }
.db-list-dl.past     { color: var(--muted-foreground); text-decoration: line-through; }

/* ── RIGHT TOP: Profile completeness ── */
.db-comp-top { display: flex; gap: 18px; margin-bottom: 12px; }
.db-comp-ring { position: relative; width: 72px; height: 72px; flex-shrink: 0; }
.db-comp-score { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 900; color: var(--foreground); font-variant-numeric: tabular-nums; }
.db-comp-score small { font-size: 11px; font-weight: 600; color: var(--muted-foreground); margin-left: 1px; }
.db-comp-bars { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.db-comp-bar-row { display: flex; flex-direction: column; gap: 4px; }
.db-comp-bar-head { display: flex; align-items: center; gap: 6px; }
.db-comp-bar-icon { width: 20px; height: 20px; border-radius: 5px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--c); background: color-mix(in oklab, var(--c) 12%, transparent); }
.db-comp-bar-label { font-size: 12px; font-weight: 600; color: var(--foreground); }
.db-comp-bar-stat { font-size: 11px; font-weight: 700; color: var(--muted-foreground); margin-left: auto; font-variant-numeric: tabular-nums; }
.db-comp-bar-track { height: 5px; border-radius: 3px; background: var(--hairline); overflow: hidden; }
.db-comp-bar-fill { height: 100%; border-radius: 3px; background: var(--c); transition: width 0.8s cubic-bezier(0.22,0.61,0.36,1); }
.db-comp-missing { display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid var(--hairline); padding-top: 12px; }
.db-comp-missing-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px; border-radius: 6px;
  font-size: 11px; font-weight: 600; color: var(--foreground); cursor: pointer;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 2px 2px 5px oklch(0.55 0.03 258 / 0.10), -2px -2px 4px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
  transition: transform .15s;
}
.db-comp-missing-tag:hover { transform: translateY(-1px); }
.db-comp-missing-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--c); }
.db-comp-done { border-top: 1px solid var(--hairline); padding-top: 12px; font-size: 12px; font-weight: 600; color: var(--success); display: flex; align-items: center; gap: 5px; }

/* ── RIGHT BOTTOM: Notifications ── */
.db-msg-list { display: flex; flex-direction: column; }
.db-msg-row { display: flex; align-items: flex-start; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--hairline); cursor: pointer; transition: background var(--sp-duration-fast, .15s) var(--sp-ease, ease); }
.db-msg-row.is-last { border-bottom: none; }
.db-msg-row:hover { background: oklch(0.985 0.01 258 / 0.5); border-radius: 8px; }
.db-msg-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; background: var(--c); transition: box-shadow 0.2s ease; }
.db-msg-row.unread .db-msg-dot { box-shadow: 0 0 0 3px var(--g); }
.db-msg-body { flex: 1; min-width: 0; }
.db-msg-title { display: block; font-size: 12px; font-weight: 600; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-msg-title.unread { font-weight: 700; }
.db-msg-ct { display: block; margin-top: 1px; font-size: 11px; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-msg-time { font-size: 10px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; flex-shrink: 0; margin-top: 2px; }

/* ═══════════════ Responsive ═══════════════ */
@media (max-width: 1100px) {
  .db-body { grid-template-columns: 1fr; }
  .db-hero .page-hero__row { flex-direction: column; align-items: stretch; gap: 14px; }
  .db-hero-right { justify-content: flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  .db-comp-bar-fill { transition: none; }
}
</style>
