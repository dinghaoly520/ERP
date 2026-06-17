<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
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
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>

    <!-- ═══ Skeleton ═══ -->
    <template v-else-if="loading && firstLoad">
      <div style="background:rgba(255,255,255,0.60);border:1px solid rgba(255,255,255,0.35);border-radius:var(--sp-radius-md);padding:24px;margin-bottom:16px">
        <span class="sp-skel" style="width:100px;height:13px;display:block" />
        <span class="sp-skel" style="width:200px;height:24px;margin-top:12px;display:block" />
        <span class="sp-skel" style="width:280px;height:14px;margin-top:10px;display:block" />
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
        <div v-for="i in 4" :key="i" style="padding:16px 18px;border:1px solid rgba(255,255,255,0.35);border-radius:var(--sp-radius-md);background:rgba(255,255,255,0.60)">
          <span class="sp-skel" style="width:40px;height:26px;display:block" />
          <span class="sp-skel" style="width:60px;height:12px;margin-top:6px;display:block" />
        </div>
      </div>
      <div style="height:12px;border-radius:6px;margin-bottom:16px;overflow:hidden;display:flex">
        <span v-for="i in 5" :key="i" class="sp-skel" :style="{flex:'1',height:'100%',marginRight:i<5?'3px':'0'}" />
      </div>
      <div style="display:grid;gap:10px">
        <div v-for="i in 3" :key="i" style="display:flex;gap:14px;align-items:center;padding:16px 20px;border:1px solid rgba(255,255,255,0.35);border-radius:var(--sp-radius-md);background:rgba(255,255,255,0.60)">
          <div style="flex:1"><span class="sp-skel" style="width:50%;height:16px;display:block" /><span class="sp-skel" style="width:35%;height:12px;margin-top:8px;display:block" /></div>
          <span class="sp-skel" style="width:80px;height:28px;display:block" />
        </div>
      </div>
    </template>

    <template v-else>
    <div v-loading="loading">
      <!-- ═══════════════════════════════════════════
           HERO — compact operational strip
           ═══════════════════════════════════════════ -->
      <div class="mb-hero">
        <div class="mb-hero-left">
          <div class="mb-hero-topline">
            <h1 class="sp-modern-title" style="margin:0">投标进展</h1>
            <span class="mb-hero-badge">{{ summary.total }} 条</span>
          </div>
          <p class="sp-modern-desc">跟踪已提交的投标记录与各项目所处阶段，及时关注开标进展。</p>
        </div>
        <div class="mb-hero-right">
          <el-button type="primary" size="large" @click="router.push('/bids')"><el-icon><Plus /></el-icon>浏览招标机会</el-button>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════
           SUMMARY — 4 cells
           ═══════════════════════════════════════════ -->
      <div class="mb-summary" v-if="submissions.length > 0">
        <div class="mb-summary-cell" v-for="s in [
          { key:'total', label:'全部', value:summary.total, tone:'' },
          { key:'draft', label:'草稿', value:summary.draft, tone:'orange' },
          { key:'submitted', label:'已提交', value:summary.submitted, tone:'green' },
          { key:'withdrawn', label:'已撤回', value:summary.withdrawn, tone:'gray' },
        ]" :key="s.key" :class="'tone-'+s.tone">
          <span class="mb-summary-value" v-text="s.value" />
          <span class="mb-summary-label">{{ s.label }}</span>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════
           PIPELINE — animated stage distribution bar
           ═══════════════════════════════════════════ -->
      <div class="mb-pipeline" v-if="submissions.length > 0">
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
                :class="{ active: s.count > 0 }"
                :style="{
                  width: pipelineMax > 0 ? (s.count / pipelineMax * 100) + '%' : '0%',
                  background: s.color,
                }"
              />
            </div>
            <div class="mb-pipeline-meta" :style="{ color: s.color }">
              <span class="mb-pipeline-stage-name">{{ s.label }}</span>
              <span class="mb-pipeline-count">{{ s.count }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════
           SUBMISSION LIST — animated cards
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
          :style="{ animationDelay: (idx * 60) + 'ms' }"
        >
          <!-- Left accent bar (color-coded by stage or status) -->
          <div
            class="mb-card-accent"
            :style="row.status === 'submitted' && row.project?.stage
              ? { background: stageColor(row.project.stage) }
              : {}"
          ></div>

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
                  :class="{ pulse: row.project.stage === 'OPENING' }"
                  :style="{
                    background: stageColor(row.project.stage) + '16',
                    color: stageColor(row.project.stage),
                    borderColor: stageColor(row.project.stage) + '40',
                  }"
                >
                  <span class="mb-card-stage-dot" :style="{ background: stageColor(row.project.stage) }" />
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
                  :class="{ active: row.project.stage !== 'ARCHIVED' }"
                  :style="{
                    width: cardProgress(row) + '%',
                    background: `linear-gradient(90deg, ${stageColor(row.project.stage)}40, ${stageColor(row.project.stage)})`,
                  }"
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
                    :class="{
                      done: si <= stageIdx(row.project.stage),
                      pulse: si === stageIdx(row.project.stage) && row.project.stage !== 'ARCHIVED',
                    }"
                    :style="si <= stageIdx(row.project.stage) ? { background: s.color, borderColor: s.color } : {}"
                  />
                  <span
                    class="mb-stage-label"
                    :class="{ active: si <= stageIdx(row.project.stage) }"
                    :style="si <= stageIdx(row.project.stage) ? { color: s.color } : {}"
                  >{{ s.label }}</span>
                </div>
              </div>
            </div>

            <!-- Draft hint -->
            <div v-if="row.status === 'draft'" class="mb-draft-hint">
              <span class="mb-draft-dot" />
              草稿未提交 — 前往 <a :href="'#/bids/'+row.projectId+'/submit'">提交页</a> 完成投递
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
      <div v-else class="sp-empty-panel">
        <div class="sp-empty-icon"><el-icon :size="24"><Document /></el-icon></div>
        <p class="sp-empty-text">暂无投标记录</p>
        <p class="sp-empty-desc">浏览招标项目并提交您的标书</p>
        <el-button type="primary" style="margin-top:16px" @click="router.push('/bids')">浏览招标机会</el-button>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   HERO
   ═══════════════════════════════════════════════ */
.mb-hero {
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
  position: relative;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(24px) saturate(1.2);
  -webkit-backdrop-filter: blur(24px) saturate(1.2);
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: var(--sp-radius-lg); padding: 20px 24px; margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(15, 47, 87, 0.04), 0 6px 24px rgba(91, 155, 213, 0.06);
}
.mb-hero::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
  opacity: 0.50; border-radius: inherit;
  background-image:
    radial-gradient(ellipse at 8% 4%,  rgba(147, 197, 253, 0.24), transparent 55%),
    radial-gradient(ellipse at 88% 10%, rgba(168, 139, 250, 0.18), transparent 55%),
    radial-gradient(ellipse at 35% 85%, rgba(110, 231, 183, 0.14), transparent 55%);
  animation: glass-glow-drift 20s ease-in-out infinite;
}
.mb-hero:hover::before { opacity: 0.64; }
.mb-hero > * { position: relative; z-index: 1; }
.mb-hero-left { min-width: 0; }
.mb-hero-topline {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}
.mb-hero-badge {
  font-size: 12px;
  font-weight: 800;
  color: var(--sp-primary);
  background: rgba(239,246,255,0.72); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  border: 1px solid color-mix(in srgb, var(--sp-primary) 20%, transparent);
  padding: 2px 10px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.mb-hero-right { flex-shrink: 0; }

/* ═══════════════════════════════════════════════
   SUMMARY CELLS
   ═══════════════════════════════════════════════ */
.mb-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
  border: 1px solid rgba(255,255,255,0.48);
  border-radius: var(--sp-radius-md);
  overflow: hidden;
  background: rgba(0,0,0,0.04);
  margin-bottom: 16px;
}
.mb-summary-cell {
  position: relative;
  padding: 14px 18px;
  background: rgba(255,255,255,0.58);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: background var(--sp-duration-fast) var(--sp-ease);
}
.mb-summary-cell > * { position: relative; z-index: 1; }
.mb-summary-value {
  font-size: 26px;
  font-weight: 900;
  color: var(--sp-gray-900);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.mb-summary-cell.tone-orange .mb-summary-value { color: var(--sp-orange); }
.mb-summary-cell.tone-green  .mb-summary-value { color: var(--sp-green); }
.mb-summary-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--sp-gray-500);
}

/* ═══════════════════════════════════════════════
   PIPELINE — animated stage distribution bar
   ═══════════════════════════════════════════════ */
.mb-pipeline {
  position: relative;
  background: rgba(255,255,255,0.52);
  backdrop-filter: blur(12px) saturate(1.1);
  -webkit-backdrop-filter: blur(12px) saturate(1.1);
  border: 1px solid rgba(255,255,255,0.40);
  border-radius: var(--sp-radius-md);
  padding: 14px 18px;
  margin-bottom: 16px;
}
.mb-pipeline::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.34;
  border-radius: inherit;
  background-image:
    radial-gradient(ellipse at 14% 6%,  rgba(96,165,250,0.16), transparent 55%),
    radial-gradient(ellipse at 84% 14%, rgba(56,189,248,0.10), transparent 55%),
    radial-gradient(ellipse at 40% 90%, rgba(6,78,162,0.06),  transparent 55%);
  animation: glass-glow-drift 18s ease-in-out infinite;
}
.mb-pipeline:hover::before { opacity: 0.50; }
.mb-pipeline > * { position: relative; z-index: 1; }
.mb-pipeline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.mb-pipeline-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--sp-gray-900);
}
.mb-pipeline-hint {
  font-size: 11px;
  color: var(--sp-gray-400);
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
  background: rgba(0,0,0,0.05);
  overflow: hidden;
}
.mb-pipeline-bar {
  height: 100%;
  border-radius: 3px;
  min-width: 4px;
  transition: width 0.8s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.mb-pipeline-bar.active {
  animation: mbPipelineGlow 2.5s ease-in-out infinite;
}
.mb-pipeline-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
}
.mb-pipeline-stage-name { opacity: 0.75; overflow: hidden; text-overflow: ellipsis; }
.mb-pipeline-count {
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  opacity: 1;
}
@keyframes mbPipelineGlow {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.25); }
}

/* ═══════════════════════════════════════════════
   SUBMISSION CARDS
   ═══════════════════════════════════════════════ */
.mb-list {
  display: grid;
  gap: 10px;
}
.mb-card {
  display: flex; gap: 0;
  position: relative;
  background: rgba(255,255,255,0.50);
  backdrop-filter: blur(10px) saturate(1.1);
  -webkit-backdrop-filter: blur(10px) saturate(1.1);
  border: 1px solid rgba(255,255,255,0.40);
  border-radius: var(--sp-radius-md);
  overflow: hidden;
  animation: mbCardIn 0.4s cubic-bezier(0.22,0.61,0.36,1) both;
  transition: border-color 0.2s var(--sp-ease), box-shadow 0.2s var(--sp-ease);
}
.mb-card::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.36;
  border-radius: inherit;
  background-image:
    radial-gradient(ellipse at 12% 8%, rgba(96,165,250,0.16), transparent 55%),
    radial-gradient(ellipse at 82% 16%, rgba(56,189,248,0.10), transparent 55%),
    radial-gradient(ellipse at 38% 88%, rgba(6,78,162,0.06), transparent 55%);
  animation: glass-glow-drift 18s ease-in-out infinite;
}
.mb-card:hover::before { opacity: 0.52; }
.mb-card:hover {
  border-color: var(--sp-primary);
  box-shadow: 0 1px 8px rgba(15,47,87,0.08);
}
.mb-card > * { position: relative; z-index: 1; }
@keyframes mbCardIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Accent bar */
.mb-card-accent {
  width: 4px;
  flex-shrink: 0;
  background: rgba(0,0,0,0.04);
  transition: background 0.3s var(--sp-ease);
}
.mb-card.submitted .mb-card-accent { background: var(--sp-green); }
.mb-card.draft     .mb-card-accent { background: var(--sp-orange); }
.mb-card.withdrawn .mb-card-accent { background: var(--sp-gray-300); }

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
  color: var(--sp-gray-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mb-card-code {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--sp-gray-400);
  font-family: 'SF Mono', 'JetBrains Mono', monospace;
}
.mb-card-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Stage badge with optional pulse */
.mb-card-stage-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid transparent;
  transition: box-shadow 0.3s ease;
}
.mb-card-stage-badge.pulse {
  animation: mbStagePulse 2s ease-in-out infinite;
}
.mb-card-stage-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
@keyframes mbStagePulse {
  0%, 100% { box-shadow: 0 0 0 0 currentColor; }
  50%      { box-shadow: 0 0 0 3px transparent; }
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
  color: var(--sp-gray-700);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.mb-card-meta-item em {
  font-style: normal;
  font-weight: 500;
  font-size: 11px;
  color: var(--sp-gray-400);
  margin-left: 1px;
}
.mb-card-meta-label {
  font-weight: 500;
  color: var(--sp-gray-400);
  margin-right: 4px;
}

/* ── Stage progress track (per-card) ── */
.mb-stage-track {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px dashed rgba(0,0,0,0.06);
}
.mb-stage-track-bg {
  height: 4px;
  border-radius: 2px;
  background: rgba(0,0,0,0.05);
  overflow: hidden;
  margin-bottom: 10px;
}
.mb-stage-track-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 1.2s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.mb-stage-track-fill.active {
  animation: mbTrackShimmer 3s ease-in-out infinite;
  background-size: 200% 100% !important;
}
@keyframes mbTrackShimmer {
  0%, 100% { opacity: 0.9; }
  50%      { opacity: 1; }
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
  background: rgba(0,0,0,0.04);
  border: 2px solid var(--sp-gray-200);
  transition: all 0.4s var(--sp-ease);
  position: relative;
}
.mb-stage-dot.done {
  transform: scale(1);
}
.mb-stage-dot.pulse {
  animation: mbDotPulse 1.6s ease-in-out infinite;
}
@keyframes mbDotPulse {
  0%, 100% { box-shadow: 0 0 0 0 currentColor; transform: scale(1); }
  50%      { box-shadow: 0 0 0 5px transparent; transform: scale(1.3); }
}

.mb-stage-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--sp-gray-300);
  white-space: nowrap;
  transition: color 0.3s var(--sp-ease);
}
.mb-stage-label.active {
  font-weight: 700;
}

/* Draft hint */
.mb-draft-hint {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(0,0,0,0.06);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--sp-gray-500);
}
.mb-draft-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--sp-orange);
  animation: mbDotPulse 1.6s ease-in-out infinite;
}
.mb-draft-hint a {
  color: var(--sp-primary);
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
  border-left: 1px solid rgba(0,0,0,0.05);
  justify-content: center;
}

/* ── Empty ── */
.sp-empty-panel {
  position: relative;
  background: rgba(255,255,255,0.72);
  backdrop-filter: blur(10px) saturate(1.1);
  -webkit-backdrop-filter: blur(10px) saturate(1.1);
  border: 1px solid rgba(255,255,255,0.48);
  border-radius: var(--sp-radius-md);
  padding: 64px 20px;
  text-align: center;
  color: var(--sp-gray-400);
}
.sp-empty-panel > * { position: relative; z-index: 1; }
.sp-empty-text {
  font-size: 15px;
  font-weight: 700;
  color: var(--sp-gray-500);
  margin-top: 12px;
}
.sp-empty-desc {
  font-size: 13px;
  margin-top: 4px;
}

/* ═══════════════════════════════════════════════
   RESPONSIVE
   ═══════════════════════════════════════════════ */
@media (max-width: 1100px) {
  .mb-card { flex-direction: column; }
  .mb-card-accent { width: 100%; height: 3px; }
  .mb-card-actions { flex-direction: row; border-left: none; border-top: 1px solid rgba(0,0,0,0.05); padding: 10px 18px; }
  .mb-stage-nodes { overflow-x: auto; }
  .mb-stage-label { font-size: 9px; }
}
@media (max-width: 768px) {
  .mb-hero { flex-direction: column; align-items: stretch; }
  .mb-hero-right { justify-content: flex-start; }
  .mb-summary { grid-template-columns: repeat(2, 1fr); }
  .mb-card-head { flex-direction: column; }
  .mb-pipeline-track { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) {
  .mb-card { animation: none; }
  .mb-card-stage-badge.pulse,
  .mb-pipeline-bar.active,
  .mb-stage-track-fill.active,
  .mb-stage-dot.pulse,
  .mb-draft-dot { animation: none; }
}
</style>
