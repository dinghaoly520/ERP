<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import SpPageHero from '@/components/SpPageHero.vue'
import SpKpi from '@/components/SpKpi.vue'
import { ClipboardList, AlertTriangle } from 'lucide-vue-next'
import dayjs from 'dayjs'

const router = useRouter()
const supplierStore = useSupplierStore()
const loading = ref(true)
const firstLoad = ref(true)
const error = ref(false)

const STAGES = [
  { key: 'DOWNLOAD',    label: '文件下载', color: '#0891b2', icon: 'Download' },
  { key: 'SUBMIT',      label: '加密投递', color: '#0a5eb8', icon: 'Upload'  },
  { key: 'OPENING',     label: '在线开标', color: '#d97706', icon: 'View'    },
  { key: 'EVALUATING',  label: '专家评标', color: '#7c3aed', icon: 'Edit'    },
  { key: 'ARCHIVED',    label: '已归档',   color: '#059669', icon: 'Folder'  },
] as const

function stageIdx(stage: string): number {
  return STAGES.findIndex(s => s.key === stage)
}

function stageColor(stage: string): string {
  return STAGES.find(s => s.key === stage)?.color || '#94a3b8'
}

onMounted(async () => {
  try { await supplierStore.fetchBidSubmissions() } catch { error.value = true }
  finally { loading.value = false; firstLoad.value = false }
})

function retryLoad() {
  error.value = false; loading.value = true
  supplierStore.fetchBidSubmissions().catch(() => { error.value = true }).finally(() => { loading.value = false })
}

const submissions = computed(() => supplierStore.bidSubmissions)

const summary = computed(() => {
  const list = submissions.value
  return {
    total: list.length,
    draft: list.filter((i: any) => i.status === 'draft').length,
    submitted: list.filter((i: any) => i.status === 'submitted').length,
    withdrawn: list.filter((i: any) => i.status === 'withdrawn').length,
  }
})

// ── Pipeline: stage distribution across all bids ──
const pipeline = computed(() => {
  const list = submissions.value
  const max = Math.max(list.length, 1)
  return STAGES.map(s => {
    const count = list.filter((i: any) => i.status === 'submitted' && i.project?.stage === s.key).length
    return { ...s, count, pct: Math.round((count / max) * 100) }
  })
})
const pipelineMax = computed(() => Math.max(...pipeline.value.map(p => p.count), 1))

// ── Status helpers ──
const statusMap: Record<string, { label: string; cls: string; tone: string; icon: string }> = {
  draft:     { label: '草稿',   cls: 'draft',     tone: 'orange', icon: 'EditPen' },
  submitted: { label: '已提交', cls: 'submitted', tone: 'green',  icon: 'CircleCheckFilled' },
  withdrawn: { label: '已撤回', cls: 'disabled',  tone: 'gray',   icon: 'RemoveFilled' },
}

function canWithdraw(row: any) {
  return row.status === 'submitted' && row.project?.stage === 'SUBMIT'
}
function canConfirmOpening(row: any) {
  return row.status === 'submitted' && ['OPENING','EVALUATING','ARCHIVED'].includes(row.project?.stage)
}

// ── Per-card stage progress (for submitted with known stage) ──
function cardProgress(row: any): number {
  if (row.status !== 'submitted' || !row.project?.stage) return 0
  const idx = stageIdx(row.project.stage)
  return idx < 0 ? 0 : Math.round(((idx + 1) / STAGES.length) * 100)
}
function cardStageLabel(row: any): string {
  return STAGES.find(s => s.key === row.project?.stage)?.label || '-'
}

async function handleWithdraw(id: string) {
  await ElMessageBox.confirm('确定要撤回此标书吗？', '确认撤回', { type: 'warning' })
  try { await supplierApi.withdrawSubmission(id); ElMessage.success('投标已撤回'); await supplierStore.fetchBidSubmissions() }
  catch (err: any) { ElMessage.error(err?.response?.data?.error || '撤回失败') }
}
</script>

<template>
  <div class="page-container">
    <!-- ═══ Error ═══ -->
    <div v-if="error && !loading" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>

    <!-- ═══ Skeleton ═══ -->
    <template v-else-if="loading && firstLoad">
      <div class="mb-skel-hero">
        <span class="sp-skel" style="width:100px;height:13px" />
        <span class="sp-skel" style="width:200px;height:24px;margin-top:12px" />
        <span class="sp-skel" style="width:280px;height:14px;margin-top:10px" />
      </div>
      <div class="mb-skel-kpis">
        <div v-for="i in 4" :key="i" class="mb-skel-kpi">
          <span class="sp-skel" style="width:40px;height:26px" />
          <span class="sp-skel" style="width:60px;height:12px;margin-top:6px" />
        </div>
      </div>
      <div class="mb-skel-pipeline"><span class="sp-skel" style="width:100%;height:100%" /></div>
      <div class="mb-skel-list">
        <div v-for="i in 3" :key="i" class="mb-skel-row">
          <div style="flex:1"><span class="sp-skel" style="width:50%;height:16px" /><span class="sp-skel" style="width:35%;height:12px;margin-top:8px" /></div>
          <span class="sp-skel" style="width:80px;height:28px" />
        </div>
      </div>
    </template>

    <template v-else>
    <div v-loading="loading">
      <!-- ═══════════════════════════════════════════
           HERO — SpPageHero (neumorphic)
           ═══════════════════════════════════════════ -->
      <SpPageHero :icon="ClipboardList" title="投标进展" sub="跟踪已提交的投标记录与各项目所处阶段，及时关注开标进展。">
        <template #actions>
          <div class="page-hero__stat"><strong>{{ summary.total }}</strong><span>投标记录</span></div>
          <el-button type="primary" size="large" @click="router.push('/bids')"><el-icon><Plus /></el-icon>浏览投标机会</el-button>
        </template>
      </SpPageHero>

      <!-- ═══════════════════════════════════════════
           SUMMARY — KPI tiles
           ═══════════════════════════════════════════ -->
      <div class="kpi-grid mb-kpis" v-if="submissions.length > 0">
        <SpKpi label="全部" :value="summary.total" />
        <SpKpi label="草稿" :value="summary.draft" tone="var(--warning)" />
        <SpKpi label="已提交" :value="summary.submitted" tone="var(--success)" />
        <SpKpi label="已撤回" :value="summary.withdrawn" tone="var(--muted-foreground)" />
      </div>

      <!-- ═══════════════════════════════════════════
           PIPELINE — stage distribution bar
           ═══════════════════════════════════════════ -->
      <section class="sp-module mb-pipeline" v-if="submissions.length > 0">
        <div class="mb-pipeline-head">
          <span class="mb-pipeline-title">阶段分布</span>
          <span class="mb-pipeline-hint">{{ summary.submitted }} 条已提交</span>
        </div>
        <div class="mb-pipeline-track">
          <div
            v-for="s in pipeline"
            :key="s.key"
            class="mb-pipeline-seg"
          >
            <div class="mb-pipeline-bar-wrap">
              <div
                class="mb-pipeline-bar"
                :style="{
                  width: pipelineMax > 0 ? (s.count / pipelineMax * 100) + '%' : '0%',
                  '--c': s.color,
                } as any"
              />
            </div>
            <div class="mb-pipeline-meta" :style="{ '--c': s.color } as any">
              <span class="mb-pipeline-stage-name">{{ s.label }}</span>
              <span class="mb-pipeline-count">{{ s.count }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- ═══════════════════════════════════════════
           SUBMISSION LIST — neumorphic plates
           ═══════════════════════════════════════════ -->
      <div v-if="submissions.length > 0" class="mb-list">
        <div
          v-for="(row, idx) in submissions"
          :key="row.id"
          class="mb-card"
          :class="[
            row.status,
            { 'has-stage': row.status === 'submitted' && row.project?.stage },
          ]"
          :style="({
            ...(row.status === 'submitted' && row.project?.stage ? { '--c': stageColor(row.project.stage) } : {}),
            animationDelay: (idx * 60) + 'ms',
          } as any)"
        >
          <!-- Left accent bar (color-coded by stage or status) -->
          <div class="mb-card-accent" />

          <!-- Main content -->
          <div class="mb-card-main">
            <!-- Header row -->
            <div class="mb-card-head">
              <div class="mb-card-project">
                <h3 class="mb-card-name">{{ row.project?.name || '-' }}</h3>
                <span class="mb-card-code">{{ row.project?.projectCode || '-' }}</span>
              </div>
              <div class="mb-card-status-row">
                <span
                  v-if="row.status === 'submitted' && row.project?.stage"
                  class="mb-card-stage-badge"
                >
                  <span class="mb-card-stage-dot" />
                  {{ cardStageLabel(row) }}
                </span>
                <span class="sp-status" :class="statusMap[row.status]?.cls||'draft'">
                  {{ statusMap[row.status]?.label||row.status }}
                </span>
              </div>
            </div>

            <!-- Meta row -->
            <div class="mb-card-meta">
              <span v-if="row.bidPrice" class="mb-card-meta-item">
                <span class="mb-card-meta-label">报价</span>
                {{ row.bidPrice }}<em>万元</em>
              </span>
              <span v-if="row.deliveryPeriod" class="mb-card-meta-item">
                <span class="mb-card-meta-label">工期</span>
                {{ row.deliveryPeriod }}
              </span>
              <span v-if="row.submittedAt" class="mb-card-meta-item">
                <span class="mb-card-meta-label">提交</span>
                {{ dayjs(row.submittedAt).format('MM-DD HH:mm') }}
              </span>
              <span v-if="row.project?.openTime" class="mb-card-meta-item">
                <span class="mb-card-meta-label">开标</span>
                {{ dayjs(row.project.openTime).format('MM-DD HH:mm') }}
              </span>
              <span v-if="row.project?.deadline" class="mb-card-meta-item">
                <span class="mb-card-meta-label">截止</span>
                {{ dayjs(row.project.deadline).format('MM-DD HH:mm') }}
              </span>
            </div>

            <!-- Stage progress track (only for submitted with known stage) -->
            <div
              v-if="row.status === 'submitted' && row.project?.stage"
              class="mb-stage-track"
            >
              <div class="mb-stage-track-bg">
                <div
                  class="mb-stage-track-fill"
                  :style="{ width: cardProgress(row) + '%' }"
                />
              </div>
              <div class="mb-stage-nodes">
                <div
                  v-for="(s, si) in STAGES"
                  :key="s.key"
                  class="mb-stage-node"
                  :class="{
                    done: si < (stageIdx(row.project.stage)),
                    current: si === stageIdx(row.project.stage),
                  }"
                >
                  <span
                    class="mb-stage-dot"
                    :class="{ done: si <= stageIdx(row.project.stage) }"
                    :style="si <= stageIdx(row.project.stage) ? ({ '--c': s.color } as any) : {}"
                  />
                  <span
                    class="mb-stage-label"
                    :class="{ active: si <= stageIdx(row.project.stage) }"
                    :style="si <= stageIdx(row.project.stage) ? ({ '--c': s.color } as any) : {}"
                  >{{ s.label }}</span>
                </div>
              </div>
            </div>

            <!-- Draft hint -->
            <div v-if="row.status === 'draft'" class="mb-draft-hint">
              <span class="mb-draft-dot" />
              草稿未提交 — 前往 <router-link :to="`/bids/${row.projectId}/submit`">提交页</router-link> 完成投递
            </div>
          </div>

          <!-- Right actions -->
          <div class="mb-card-actions">
            <el-button type="primary" plain size="small" @click="router.push(`/bids/${row.projectId}`)">详情</el-button>
            <el-button
              v-if="canConfirmOpening(row)"
              type="success"
              plain
              size="small"
              @click="router.push(`/my-bids/${row.projectId}/opening-confirm`)"
            >开标确认</el-button>
            <el-button
              v-if="canWithdraw(row)"
              type="warning"
              plain
              size="small"
              @click="handleWithdraw(row.id)"
            >撤回</el-button>
          </div>
        </div>
      </div>

      <!-- ═══ Empty state ═══ -->
      <div v-else class="neu-card mb-empty">
        <div class="sp-empty-icon"><ClipboardList :size="22" :stroke-width="1.75" /></div>
        <p class="sp-empty-text">暂无投标记录</p>
        <p class="sp-empty-desc">浏览招标项目并提交您的标书</p>
        <el-button type="primary" style="margin-top:16px" @click="router.push('/bids')">浏览投标机会</el-button>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   SKELETONS — borderless surface plates (no glass)
   ═══════════════════════════════════════════════ */
.mb-skel-hero { background: var(--surface); border-radius: 16px; padding: 24px; margin-bottom: 16px; display: flex; flex-direction: column; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.mb-skel-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.mb-skel-kpi { padding: 16px 18px; border-radius: 14px; background: var(--surface); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); display: flex; flex-direction: column; }
.mb-skel-pipeline { height: 76px; border-radius: 14px; padding: 16px; margin-bottom: 16px; background: var(--surface); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.mb-skel-list { display: grid; gap: 10px; }
.mb-skel-row { display: flex; align-items: center; gap: 14px; padding: 16px 20px; border-radius: 14px; background: var(--surface); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }

/* ═══════════════════════════════════════════════
   SUMMARY KPI GRID
   ═══════════════════════════════════════════════ */
.mb-kpis { margin-top: 16px; }

/* ═══════════════════════════════════════════════
   PIPELINE — stage distribution bar
   (plate visuals from global .sp-module reset)
   ═══════════════════════════════════════════════ */
.mb-pipeline { margin-top: 16px; padding: 14px 18px; }
.mb-pipeline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.mb-pipeline-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--foreground);
}
.mb-pipeline-hint {
  font-size: 11px;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}
.mb-pipeline-track {
  display: flex;
  gap: 4px;
  align-items: flex-end;
}
.mb-pipeline-seg {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.mb-pipeline-bar-wrap {
  height: 6px;
  border-radius: 3px;
  background: var(--hairline);
  overflow: hidden;
}
.mb-pipeline-bar {
  height: 100%;
  border-radius: 3px;
  min-width: 4px;
  background: var(--c);
  transition: width 0.8s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.mb-pipeline-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  color: var(--c);
}
.mb-pipeline-stage-name { opacity: 0.75; overflow: hidden; text-overflow: ellipsis; }
.mb-pipeline-count {
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

/* ═══════════════════════════════════════════════
   SUBMISSION CARDS — neumorphic plates (no glass / no drift)
   ═══════════════════════════════════════════════ */
.mb-list {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}
.mb-card {
  display: flex; gap: 0;
  position: relative;
  border-radius: 16px;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
  animation: mbCardIn 0.4s cubic-bezier(0.22,0.61,0.36,1) both;
  transition: transform .15s ease, box-shadow .15s ease;
}
.mb-card:hover {
  transform: translateY(-1px);
  box-shadow: 7px 7px 16px oklch(0.55 0.03 258 / 0.12), -5px -5px 12px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
@keyframes mbCardIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Accent bar */
.mb-card-accent {
  width: 4px;
  flex-shrink: 0;
  border-radius: 16px 0 0 16px;
  background: var(--hairline);
  transition: background 0.3s var(--sp-ease);
}
.mb-card.submitted .mb-card-accent { background: var(--success); }
.mb-card.draft     .mb-card-accent { background: var(--warning); }
.mb-card.withdrawn .mb-card-accent { background: var(--hairline); }
.mb-card.has-stage .mb-card-accent { background: var(--c); }

/* Main body */
.mb-card-main {
  flex: 1;
  min-width: 0;
  padding: 16px 18px;
}

/* Header */
.mb-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 8px;
}
.mb-card-project { min-width: 0; flex: 1; }
.mb-card-name {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mb-card-code {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--muted-foreground);
  font-family: 'SF Mono', 'JetBrains Mono', monospace;
}
.mb-card-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Stage badge — flat color chip driven by --c (no border, no neumorphism on text-level) */
.mb-card-stage-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 700;
  color: var(--c, var(--muted-foreground));
  background: color-mix(in oklab, var(--c, #94a3b8) 12%, transparent);
}
.mb-card-stage-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c, var(--muted-foreground));
}

/* Meta row */
.mb-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-bottom: 10px;
}
.mb-card-meta-item {
  font-size: 12px;
  font-weight: 600;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.mb-card-meta-item em {
  font-style: normal;
  font-weight: 500;
  font-size: 11px;
  color: var(--muted-foreground);
  margin-left: 1px;
}
.mb-card-meta-label {
  font-weight: 500;
  color: var(--muted-foreground);
  margin-right: 4px;
}

/* ── Stage progress track (per-card) ── */
.mb-stage-track {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px dashed var(--hairline);
}
.mb-stage-track-bg {
  height: 4px;
  border-radius: 2px;
  background: var(--hairline);
  overflow: hidden;
  margin-bottom: 10px;
}
.mb-stage-track-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, color-mix(in oklab, var(--c, #94a3b8) 25%, transparent), var(--c, #94a3b8));
  transition: width 1.2s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.mb-stage-nodes {
  display: flex;
  justify-content: space-between;
  gap: 2px;
}
.mb-stage-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
}
.mb-stage-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--hairline);
  border: 2px solid var(--hairline);
  transition: all 0.4s var(--sp-ease);
  position: relative;
}
.mb-stage-dot.done {
  background: var(--c);
  border-color: var(--c);
}

.mb-stage-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--muted-foreground);
  white-space: nowrap;
  transition: color 0.3s var(--sp-ease);
}
.mb-stage-label.active {
  font-weight: 700;
  color: var(--c);
}

/* Draft hint */
.mb-draft-hint {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--hairline);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted-foreground);
}
.mb-draft-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--warning);
}
.mb-draft-hint a {
  color: var(--brand);
  font-weight: 700;
  text-decoration: none;
}

/* Right actions */
.mb-card-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 14px;
  flex-shrink: 0;
  border-left: 1px solid var(--hairline);
  justify-content: center;
}

/* ── Empty ── */
.mb-empty {
  margin-top: 16px;
  padding: 64px 20px;
  align-items: center;
  text-align: center;
  color: var(--muted-foreground);
}
.mb-empty .sp-empty-text {
  font-size: 15px;
  font-weight: 700;
  color: var(--muted-foreground);
  margin-top: 12px;
}
.mb-empty .sp-empty-desc {
  font-size: 13px;
  margin-top: 4px;
}

/* ═══════════════════════════════════════════════
   RESPONSIVE
   ═══════════════════════════════════════════════ */
@media (max-width: 1100px) {
  .mb-card { flex-direction: column; }
  .mb-card-accent { width: 100%; height: 3px; border-radius: 16px 16px 0 0; }
  .mb-card-actions { flex-direction: row; border-left: none; border-top: 1px solid var(--hairline); padding: 10px 18px; }
  .mb-stage-nodes { overflow-x: auto; }
  .mb-stage-label { font-size: 9px; }
}
@media (max-width: 768px) {
  .mb-skel-kpis { grid-template-columns: repeat(2, 1fr); }
  .mb-card-head { flex-direction: column; }
  .mb-pipeline-track { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) {
  .mb-card { animation: none; transition: none; }
  .mb-card:hover { transform: none; }
  .mb-pipeline-bar, .mb-stage-track-fill { transition: none; }
}
</style>
