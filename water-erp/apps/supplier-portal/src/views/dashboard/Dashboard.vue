<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { useNotificationStore } from '@/stores/notification'
import { useBidStore } from '@/stores/bid'
import SkeletonCard from '@/components/SkeletonCard.vue'
import SpKpi from '@/components/SpKpi.vue'
import { AlertTriangle } from 'lucide-vue-next'
import { supplierApi } from '@/api/supplier'
import { ElMessage } from 'element-plus'
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

// 每 30s 轮询新通知，有新消息自动刷新列表
let notifTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  notifTimer = setInterval(() => {
    notifStore.fetchNotifications(1, 10).catch(() => {})
  }, 30_000)
})
onBeforeUnmount(() => {
  if (notifTimer) clearInterval(notifTimer)
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
    { key:'changes',      value:s.pendingChanges,           label:'待审变更', path:'/change-records' },
    { key:'expiring',     value:s.expiringQualifications,   label:'到期风险', path:'/qualifications', tone:'var(--danger)' },
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
  BID_INVITED:            { dot: '#db2777', glow: 'rgba(219,39,119,0.18)' },
  BID_REMINDER:          { dot: '#ea580c', glow: 'rgba(234,88,12,0.18)' },
  BID_OPENING:            { dot: '#0891b2', glow: 'rgba(8,145,178,0.18)' },
  BID_EVALUATION_RESULT:  { dot: '#7c3aed', glow: 'rgba(124,58,237,0.18)' },
  CLARIFICATION_REPLIED:  { dot: '#0d9488', glow: 'rgba(13,148,136,0.18)' },
  SYSTEM:                 { dot: '#475569', glow: 'rgba(71,85,105,0.18)' },
}
const notifFeed = computed(() =>
  [...notifStore.notifications]
    .sort((a: any, b: any) => {
      // 未读置顶；同组内按时间倒序（新→旧）
      const ru = a.isRead ? 1 : 0, rb = b.isRead ? 1 : 0
      if (ru !== rb) return ru - rb
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
    .slice(0, 4)
    .map((n: any) => ({
      ...n,
      color: NOTIF_COLORS[n.type] || NOTIF_COLORS.SYSTEM,
    }))
)

// ── 通知详情弹窗 ──
const notifDetail = ref<any>(null)
const notifDetailVisible = computed({
  get: () => notifDetail.value !== null,
  set: (v) => { if (!v) notifDetail.value = null },
})
function openNotifDetail(n: any) {
  notifDetail.value = { ...n }
}
/** 识别纯文本中的换行与 URL，转为 HTML；其余文本转义防 XSS。末尾 2 行作为落款右对齐。 */
function linkify(text: string): string {
  if (!text) return ''
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const lines = escaped.split('\n')
  // 末尾 2 行为落款（发件机构 + 日期），右对齐；其余为正文
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

// ── Days since registration ──
const daysSinceReg = computed(() => {
  const created = statusInfo.value?.createdAt
  if (!created) return null
  return Math.ceil((Date.now() - new Date(created).getTime()) / 86400000)
})
// 临时供应商倒计时
const daysRemaining = computed(() => {
  const exp = statusInfo.value?.temporaryExpiresAt
  if (!exp) return '--'
  const days = Math.ceil((new Date(exp).getTime() - Date.now()) / 86400000)
  return Math.max(0, days)
})
const isExpiringSoon = computed(() => {
  const d = daysRemaining.value
  return typeof d === 'number' && d <= 3 && d > 0
})
const expireDate = computed(() => {
  const exp = statusInfo.value?.temporaryExpiresAt
  return exp ? dayjs(exp).format('YYYY-MM-DD') : ''
})

// 转正弹窗
const convertDialog = ref(false)
const convertLoading = ref(false)
const convertForm = ref({
  enterpriseType: '有限责任公司',
  legalPerson: '',
  registeredAddress: '',
  businessScope: '',
  creditCode: '',
  contacts: [{ name: '', phone: '', email: '', position: '', isPrimary: true }] as { name: string; phone: string; email: string; position: string; isPrimary: boolean }[],
  qualifications: [] as { type: string; name: string; fileUrl: string; validFrom: string; validTo: string }[],
  tags: ['', ''] as string[],
})
import { ENTERPRISE_TYPES as enterpriseTypes, QUAL_TYPE_OPTIONS as qualTypeOptions } from '@/constants/supplier'

function addTag() { if (convertForm.value.tags.length < 8) convertForm.value.tags.push('') }
function removeTag(i: number) { if (convertForm.value.tags.length > 2) convertForm.value.tags.splice(i, 1) }

function addContact() { convertForm.value.contacts.push({ name: '', phone: '', email: '', position: '', isPrimary: false }) }
function removeContact(i: number) { if (convertForm.value.contacts.length > 1) convertForm.value.contacts.splice(i, 1) }
function addQualification() { convertForm.value.qualifications.push({ type: '资质证书', name: '', fileUrl: '', validFrom: '', validTo: '' }) }
function removeQualification(i: number) { convertForm.value.qualifications.splice(i, 1) }
function onQualUploadSuccess(q: any, resp: any) {
  q.fileUrl = resp?.id || resp?.url || ''
  ElMessage.success('资质材料上传成功')
}

async function openConvertDialog() {
  // 预填已有资料（临时注册时填的企业信息/联系人），避免重复填写；信用代码可在此修正
  try {
    const profile = await supplierApi.getProfile() as any
    convertForm.value.enterpriseType = profile.enterpriseType || '有限责任公司'
    convertForm.value.legalPerson = profile.legalPerson || ''
    convertForm.value.registeredAddress = profile.registeredAddress || ''
    convertForm.value.businessScope = profile.businessScope || ''
    convertForm.value.creditCode = profile.creditCode || ''
    convertForm.value.contacts = (profile.contacts && profile.contacts.length > 0)
      ? profile.contacts.map((c: any) => ({ name: c.name || '', phone: c.phone || '', email: c.email || '', position: c.position || '', isPrimary: !!c.isPrimary }))
      : [{ name: '', phone: '', email: '', isPrimary: true }]
    convertForm.value.qualifications = []
    convertForm.value.tags = (profile.tags && profile.tags.length >= 2) ? [...profile.tags] : ['', '']
  } catch { /* 预填失败不阻塞打开弹窗 */ }
  convertDialog.value = true
}
async function submitConvert() {
  const f = convertForm.value
  if ([f.enterpriseType, f.legalPerson, f.registeredAddress, f.businessScope].some(v => !v.trim())) { ElMessage.warning('请填写完整企业信息'); return }
  if (!/^[0-9A-Z]{18}$/.test(f.creditCode.trim())) { ElMessage.warning('统一社会信用代码须为 18 位数字与大写字母'); return }
  if (f.contacts.some(c => !c.name.trim() || !c.phone.trim())) { ElMessage.warning('请填写完整联系人信息'); return }
  if (f.qualifications.length === 0) { ElMessage.warning('请至少添加一项资质材料'); return }
  if (f.qualifications.some(q => !q.type || !q.name.trim())) { ElMessage.warning('请填写完所有资质信息（类型与名称必填）'); return }
  const filledTags = f.tags.filter(t => t.trim())
  if (filledTags.length < 2) { ElMessage.warning('请至少填写 2 个业务标签'); return }
  convertLoading.value = true
  try {
    await supplierApi.convertToRegular({
      enterpriseType: f.enterpriseType,
      legalPerson: f.legalPerson.trim(),
      registeredAddress: f.registeredAddress.trim(),
      businessScope: f.businessScope.trim(),
      creditCode: f.creditCode.trim(),
      contacts: f.contacts.map(c => ({ name: c.name.trim(), phone: c.phone.trim(), email: c.email.trim() || undefined, position: c.position.trim() || undefined, isPrimary: c.isPrimary })),
      qualifications: f.qualifications.map(q => ({ type: q.type, name: q.name.trim(), fileUrl: q.fileUrl || undefined, validFrom: q.validFrom || undefined, validTo: q.validTo || undefined })),
      tags: filledTags,
    })
    ElMessage.success('转正申请已提交，等待审核')
    convertDialog.value = false
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '提交失败')
  } finally {
    convertLoading.value = false
  }
}
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
              <div class="page-hero__eyebrow">{{ statusInfo.isTemporary ? '临时供应商 · 业务工作台' : '业务工作台' }}</div>
              <div class="page-hero__title">{{ statusInfo.name }}</div>
              <div class="page-hero__sub db-hero-sub">
                <span class="sp-status" :class="statusType[statusInfo.status]||'pending'">{{ statusLabel[statusInfo.status]||statusInfo.status }}</span>
                <span v-if="daysSinceReg" class="db-hero-meta">入驻 {{ daysSinceReg }} 天</span>
                <template v-if="statusInfo.status === 'APPROVED'">
                  <span class="db-hero-div">·</span>
                  <span class="db-hero-stat"><strong>{{ evalStats?.excellentRatio ?? '--' }}</strong>{{ evalStats?.excellentRatio != null ? '%' : '' }} 优良率</span>
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
          <div v-if="statusInfo.isTemporary" class="page-hero__right db-hero-right">
            <div class="db-temp-banner">
              <span class="db-temp-countdown" :class="{ expiring: isExpiringSoon }">
                <el-icon style="margin-right:4px;font-size:14px"><Clock /></el-icon>
                {{ expireDate }} 到期 · 剩 <strong>{{ daysRemaining }}</strong> 天
              </span>
              <button class="neu-btn-soft" @click="openConvertDialog">转为正式供应商</button>
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
          :to="cell.path"
          :tone="cell.tone"
        />
      </div>

      <!-- ═══════════════════════ Two-column body ═══════════════════════ -->
      <div class="db-body">
        <!-- LEFT: bid projects -->
        <section class="sp-module db-panel-left">
          <div class="sp-module-header">
            <h2 class="sp-module-title">采购项目</h2>
            <button class="neu-btn-xs" @click="router.push('/bids')">全部<el-icon style="font-size:12px"><ArrowRight /></el-icon></button>
          </div>
          <div v-if="projectRows.length === 0" class="sp-empty" style="padding:32px 0">
            <div class="sp-empty-icon"><el-icon :size="20"><Folder /></el-icon></div>
            <div class="sp-empty-text">暂无采购项目</div>
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
                @click="openNotifDetail(n)"
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

    <!-- 临时供应商转正弹窗（完整表单：企业信息 + 联系人 + 资质材料） -->
    <el-dialog v-model="convertDialog" title="转为正式供应商" width="680px" destroy-on-close class="cv-dlg">
      <div class="cv-body">
        <!-- ══ 企业信息 ══ -->
        <section class="cv-section">
          <h3 class="cv-sec-title">企业信息</h3>
          <p class="cv-sec-desc">企业名称不可修改；统一社会信用代码可在此修正（需审批）</p>
          <el-form :model="convertForm" label-width="110px" size="large" class="cv-form">
            <el-form-item label="统一信用代码">
              <el-input v-model="convertForm.creditCode" placeholder="18 位统一社会信用代码 *" maxlength="18" />
            </el-form-item>
            <el-form-item label="企业类型">
              <el-select v-model="convertForm.enterpriseType" style="width:100%">
                <el-option v-for="t in enterpriseTypes" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
            <el-form-item label="法定代表人"><el-input v-model="convertForm.legalPerson" placeholder="请输入法定代表人" /></el-form-item>
            <el-form-item label="注册地址"><el-input v-model="convertForm.registeredAddress" placeholder="请输入注册地址" /></el-form-item>
            <el-form-item label="经营范围">
              <el-input v-model="convertForm.businessScope" type="textarea" :rows="2" placeholder="请输入经营范围" />
            </el-form-item>
          </el-form>
        </section>

        <!-- ══ 业务标签 ══ -->
        <section class="cv-section">
          <div class="cv-sec-head">
            <h3 class="cv-sec-title">业务标签</h3>
            <span class="cv-sec-hint">使用2-8个词语简述并概括业务方向，每个单独填写</span>
            <el-button plain size="small" :disabled="convertForm.tags.length >= 8" @click="addTag">+ 添加标签</el-button>
          </div>
          <div v-for="(t, i) in convertForm.tags" :key="'tag'+i" class="cv-contact-row">
            <span class="cv-subrow-idx">{{ i + 1 }}</span>
            <el-input v-model="convertForm.tags[i]" :placeholder="i===0?'如：办公用品':i===1?'如：钻机销售':'请输入业务标签'" maxlength="20" class="cv-ci-name" />
            <el-button v-if="convertForm.tags.length > 2" plain size="small" type="danger" @click="removeTag(i)">删除</el-button>
          </div>
        </section>

        <!-- ══ 联系人 ══ -->
        <section class="cv-section">
          <div class="cv-sec-head">
            <h3 class="cv-sec-title">联系人信息</h3>
            <el-button plain size="small" @click="addContact">+ 添加联系人</el-button>
          </div>
          <div v-for="(c, i) in convertForm.contacts" :key="'ct'+i" class="cv-contact-row">
            <span class="cv-subrow-idx">{{ i + 1 }}</span>
            <el-input v-model="c.name" placeholder="姓名 *" class="cv-ci-name" />
            <el-input v-model="c.phone" placeholder="手机号 *" class="cv-ci-phone" />
            <el-input v-model="c.email" placeholder="邮箱（选填）" class="cv-ci-email" />
            <el-input v-model="c.position" placeholder="职位/职务" class="cv-ci-position" />
            <label class="cv-ci-switch">
              <span class="cv-ci-switch-label">主要</span>
              <el-switch v-model="c.isPrimary" size="small" />
            </label>
            <el-button v-if="convertForm.contacts.length > 1" plain size="small" type="danger" @click="removeContact(i)">删除</el-button>
          </div>
        </section>

        <!-- ══ 资质材料 ══ -->
        <section class="cv-section">
          <div class="cv-sec-head">
            <h3 class="cv-sec-title">资质材料</h3>
            <el-button plain size="small" @click="addQualification">+ 添加资质</el-button>
          </div>
          <div v-for="(q, i) in convertForm.qualifications" :key="'ql'+i" class="cv-qual-row">
            <span class="cv-subrow-idx">{{ i + 1 }}</span>
            <el-select v-model="q.type" placeholder="资质类型 *" class="cv-qs-type">
              <el-option v-for="t in qualTypeOptions" :key="t" :label="t" :value="t" />
            </el-select>
            <el-input v-model="q.name" placeholder="资质名称 *" class="cv-qs-name" />
            <el-date-picker v-model="q.validFrom" type="date" placeholder="有效期起" value-format="YYYY-MM-DD" class="cv-qs-date" />
            <el-date-picker v-model="q.validTo" type="date" placeholder="有效期止" value-format="YYYY-MM-DD" class="cv-qs-date" />
            <el-upload class="cv-upload" action="/api/upload?category=qualification" :headers="{ 'X-Portal': 'supplier' }" :show-file-list="false" :on-success="(resp) => onQualUploadSuccess(q, resp)">
              <el-button size="small">上传</el-button>
            </el-upload>
            <el-button v-if="q.fileUrl" size="small" tag="a" :href="'/api/upload/files/' + q.fileUrl" target="_blank" type="primary" plain>查看</el-button>
            <el-button plain size="small" type="danger" @click="removeQualification(i)">删除</el-button>
          </div>
        </section>

        <p style="font-size:12px;color:var(--muted-foreground);margin-top:12px">提交后需管理员审批，审批通过后自动转为正式供应商。</p>
      </div>
      <template #footer>
        <el-button @click="convertDialog = false">取消</el-button>
        <el-button type="primary" :loading="convertLoading" @click="submitConvert">提交转正申请</el-button>
      </template>
    </el-dialog>

    <!-- 通知详情弹窗（cgzxui neumorphic） -->
    <el-dialog v-model="notifDetailVisible" :title="notifDetail?.title || '通知详情'" width="600px" destroy-on-close @closed="notifDetail = null" class="neumorphic-dlg">
      <div v-if="notifDetail" class="nd-body">
        <span class="nd-time">{{ dayjs(notifDetail.createdAt).format('YYYY-MM-DD HH:mm') }}</span>
        <div class="nd-content" v-html="linkify(notifDetail.content)" />
      </div>
      <template #footer>
        <div class="nd-footer">
          <button v-if="notifDetail && !notifDetail.isRead" class="nd-btn nd-btn--danger" @click="notifStore.markAsRead(notifDetail.id); notifDetail.isRead = true">标为已读</button>
          <button class="nd-btn nd-btn--soft" @click="notifDetailVisible = false">关闭</button>
        </div>
      </template>
    </el-dialog>
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

/* 临时供应商标题栏：授权倒计时 + 转正按钮 */
.db-temp-banner { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.db-temp-countdown { display: inline-flex; align-items: center; font-size: 13px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.db-temp-countdown strong { font-size: 16px; font-weight: 900; color: var(--brand); }
.db-temp-countdown.expiring strong { color: var(--danger); }

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
.db-panel-msg { min-width: 0; flex: 1; display: flex; flex-direction: column; }  /* 撑满右列剩余空间，与左列底部对齐 */

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
.db-msg-list { display: flex; flex-direction: column; flex: 1; overflow-y: auto; }
.db-msg-row { display: flex; align-items: flex-start; gap: 8px; padding: 9px 8px; border-radius: 8px; border-bottom: 1px solid var(--hairline); cursor: pointer; transition: background var(--sp-duration-fast, .15s) var(--sp-ease, ease), box-shadow 0.2s ease; }
.db-msg-row.is-last { border-bottom: none; }
.db-msg-row:hover { background: oklch(0.985 0.01 258 / 0.6); }
/* 未读 — 品牌色高亮：色块底 + 左侧品牌色标 + 深蓝标题 + 强调圆点，与已读的灰调形成鲜明区分 */
.db-msg-row.unread { background: color-mix(in oklab, var(--brand) 7%, transparent); box-shadow: inset 2.5px 0 0 0 var(--brand); }
.db-msg-row.unread:hover { background: color-mix(in oklab, var(--brand) 11%, transparent); }
.db-msg-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; background: var(--c); transition: box-shadow 0.2s ease, transform 0.2s ease; }
.db-msg-row.unread .db-msg-dot { box-shadow: 0 0 0 3px var(--g); transform: scale(1.2); }
.db-msg-body { flex: 1; min-width: 0; }
.db-msg-title { display: block; font-size: 12px; font-weight: 600; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-msg-title.unread { font-weight: 800; color: var(--brand-deep); }
.db-msg-ct { display: block; margin-top: 1px; font-size: 11px; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-msg-time { font-size: 10px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; flex-shrink: 0; margin-top: 2px; }
.db-msg-row.unread .db-msg-time { color: var(--brand-soft); font-weight: 700; }

/* ═══════════════ Responsive ═══════════════ */
@media (max-width: 1100px) {
  .db-body { grid-template-columns: 1fr; }
  .db-hero .page-hero__row { flex-direction: column; align-items: stretch; gap: 14px; }
  .db-hero-right { justify-content: flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  .db-comp-bar-fill { transition: none; }
  .db-msg-row, .db-msg-dot { transition: none; }
}

/* 转正弹窗 */
.cv-body { max-height: 72vh; overflow-y: auto; padding-right: 4px; }
.cv-section { margin-bottom: 20px; }
.cv-sec-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.cv-sec-title { margin: 0 0 4px; font-size: 14px; font-weight: 800; color: var(--foreground); }
.cv-sec-desc { margin: 0 0 10px; font-size: 12px; color: var(--muted-foreground); }
.cv-form { margin-bottom: 0; }
.cv-subrow-idx { width: 20px; height: 20px; border-radius: 50%; background: var(--brand); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; flex-shrink: 0; }
/* 联系人 — 占满窗口宽度 */
.cv-contact-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.cv-ci-name { flex: 1; min-width: 0; }
.cv-ci-phone { flex: 1; min-width: 0; }
.cv-ci-email { flex: 1.2; min-width: 0; }
.cv-ci-position { flex: 1; min-width: 0; }
.cv-ci-switch { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--muted-foreground); white-space: nowrap; flex-shrink: 0; }
/* 资质 — 多字段弹性行 + 上传/查看 */
.cv-qual-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.cv-qs-type { width: 130px; flex-shrink: 0; }
.cv-qs-name { flex: 1; min-width: 0; }
.cv-qs-date { width: 130px; flex-shrink: 0; }
.cv-upload { flex-shrink: 0; }
@media (max-width: 760px) {
  .cv-contact-row, .cv-qual-row { flex-wrap: wrap; }
  .cv-ci-name, .cv-ci-phone, .cv-ci-email, .cv-ci-position, .cv-qs-type, .cv-qs-name, .cv-qs-date { width: 100%; flex: auto; }
}

/* 通知详情弹窗（scoped body） */
.nd-body { padding: 4px 0; }
.nd-time { font-size: 12px; color: var(--muted-foreground); display: block; margin-bottom: 14px; }
.nd-content { margin: 0; font-size: 14px; color: var(--foreground); line-height: 1.8; word-break: break-word; }
.nd-footer { display: flex; gap: 10px; justify-content: flex-end; }
</style>

<style>
/* ═══ cgzxui neumorphic 通知弹窗（teleported → 非 scoped）═══ */
.neumorphic-dlg { --nd-bg: oklch(0.975 0.012 258); }
/* 蒙层 */
.neumorphic-dlg .el-overlay { background: oklch(0.35 0.06 258 / 0.28) !important; }
/* 面板 — 玻璃渐变底 + 方向性双影 + 内高光线，无外侧框线 */
.neumorphic-dlg .el-dialog {
  border: none !important;
  border-radius: 20px !important;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)) !important;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.75), 0 20px 60px oklch(0.3 0.05 258 / 0.18) !important;
}
/* 标题栏 — hairline 底部分割 */
.neumorphic-dlg .el-dialog__header {
  padding: 22px 26px 16px;
  margin: 0;
  border-bottom: 1px solid var(--hairline);
}
.neumorphic-dlg .el-dialog__title {
  font-size: 18px;
  font-weight: 900;
  color: var(--foreground);
  letter-spacing: -0.01em;
}
/* 关闭按钮 — neumorphic 图标按钮 */
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
  color: var(--brand);
  transform: translateY(-1px);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9);
}
.neumorphic-dlg .el-dialog__headerbtn .el-dialog__close { color: var(--muted-foreground); font-weight: 700; }
/* 内容区 */
.neumorphic-dlg .el-dialog__body { padding: 18px 26px; word-break: break-word; }
/* 底栏 — hairline 分割 + 半透底 */
.neumorphic-dlg .el-dialog__footer {
  padding: 16px 26px;
  border-top: 1px solid var(--hairline);
  background: oklch(1 0 0 / 0.3);
  border-radius: 0 0 20px 20px;
}

/* ── neumorphic 按钮（三态：凸起→抬升→内凹）── */
.nd-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 22px; border-radius: 9px; border: none;
  font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
  transition: all 0.18s cubic-bezier(0.22, 0.61, 0.36, 1);
}
/* 次要按钮（关闭）— 凸起表面 */
.nd-btn--soft {
  background: var(--surface); color: var(--foreground);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85);
}
.nd-btn--soft:hover { color: var(--brand); transform: translateY(-1px);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9); }
.nd-btn--soft:active { transform: translateY(0);
  box-shadow: inset 2px 2px 5px oklch(0.55 0.03 258 / 0.15), inset -2px -2px 5px oklch(1 0 0 / 0.5); }
/* danger 按钮（标为已读）— 品牌色实心 + 凸起投影 */
.nd-btn--danger {
  background: var(--danger); color: #fff;
  box-shadow: 3px 3px 6px oklch(0.5 0.16 27 / 0.22), -2px -2px 5px oklch(1 0 0 / 0.55), inset 0 1px 0 oklch(1 0 0 / 0.2);
}
.nd-btn--danger:hover { transform: translateY(-1px);
  box-shadow: 4px 4px 10px oklch(0.45 0.16 27 / 0.28), -2px -2px 6px oklch(1 0 0 / 0.6), inset 0 1px 0 oklch(1 0 0 / 0.25); }
.nd-btn--danger:active { transform: translateY(0);
  box-shadow: inset 2px 2px 5px oklch(0.45 0.16 27 / 0.25), inset -2px -2px 5px oklch(1 0 0 / 0.4); }
/* disabled */
.nd-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
.nd-btn--soft:disabled { box-shadow: 2px 2px 4px oklch(0.5 0.05 258 / 0.15), -1px -1px 3px oklch(1 0 0 / 0.4); }
.nd-btn--danger:disabled { box-shadow: 2px 2px 4px oklch(0.5 0.16 27 / 0.12), -1px -1px 3px oklch(1 0 0 / 0.3); }

/* ── 内容中的可点击链接 ── */
.notif-link { color: var(--brand); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; word-break: break-all; }
.notif-link:hover { color: var(--brand-deep); }

/* 落款右对齐 */
.nd-signature { text-align: right; margin-top: 14px; color: var(--muted-foreground); font-size: 13px; }

@media (prefers-reduced-motion: reduce) {
  .neumorphic-dlg .el-dialog__headerbtn,
  .neumorphic-dlg .el-dialog,
  .nd-btn { transition: none; }
  .nd-btn:hover { transform: none; }
}
</style>
