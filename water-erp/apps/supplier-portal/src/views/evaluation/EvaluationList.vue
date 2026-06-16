<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import dayjs from 'dayjs'

const supplierStore = useSupplierStore(); const loading = ref(true); const firstLoad = ref(true); const error = ref(false); const expandedId = ref<string|null>(null)
onMounted(async () => { try { await Promise.all([supplierStore.fetchEvaluations(),supplierStore.fetchEvaluationStats()]) } catch { error.value = true } finally { loading.value = false; firstLoad.value = false } })
function retryLoad() { error.value = false; loading.value = true; Promise.all([supplierStore.fetchEvaluations(),supplierStore.fetchEvaluationStats()]).catch(() => { error.value = true }).finally(() => { loading.value = false }) }
const stats = computed(() => supplierStore.evaluationStats)
const levelColorMap: Record<string,string> = {A:'#059669',B:'#064ea2',C:'#d97706',D:'#dc2626'}
const levelLabel: Record<string,string> = {A:'优秀',B:'良好',C:'合格',D:'不合格'}
const scoreDimensions = [{key:'completenessScore',label:'完整度',max:20},{key:'responsivenessScore',label:'响应度',max:20},{key:'cooperationScore',label:'合作度',max:20},{key:'complianceScore',label:'合规度',max:20},{key:'overallScore',label:'综合',max:20}]
function getScorePercent(e:any,key:string,max:number) { return Math.round((Number(e[key]||0)/max)*100) }
function getScoreColor(percent:number) { if (percent>=80) return '#059669'; if (percent>=60) return '#064ea2'; if (percent>=40) return '#d97706'; return '#dc2626' }
function toggleExpand(id:string) { expandedId.value = expandedId.value===id?null:id }
const growthDims = [{key:'completenessScore',label:'完整度',max:20},{key:'responsivenessScore',label:'响应度',max:20},{key:'cooperationScore',label:'合作度',max:20},{key:'complianceScore',label:'合规度',max:20}]
const dimensionAverages = computed(() => { const evals = supplierStore.evaluations as any[]; if (!evals.length) return []; return growthDims.map(d => { const sum = evals.reduce((acc:number,e:any)=>acc+Number(e[d.key]||0),0); const avg=sum/evals.length; return {...d,avg:Math.round(avg*10)/10,pct:Math.round((avg/d.max)*100)} }).sort((a,b)=>a.avg-b.avg) })
const weakest = computed(()=>dimensionAverages.value[0]); const strongest = computed(()=>dimensionAverages.value[dimensionAverages.value.length-1])
</script>

<template>
  <div class="page-container">
    <div v-if="loading && firstLoad" class="skel-wrap">
      <div class="skel-hero"><span class="sp-skel" style="width:100px;height:13px"></span><span class="sp-skel" style="width:200px;height:24px;margin-top:12px"></span><span class="sp-skel" style="width:280px;height:14px;margin-top:10px"></span></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px"><div class="skel-cell" v-for="i in 4" :key="i"><span class="sp-skel" style="width:40px;height:26px"></span><span class="sp-skel" style="width:60px;height:12px;margin-top:6px"></span></div></div>
      <div class="skel-card" v-for="i in 3" :key="i"><span class="sp-skel" style="width:44px;height:44px"></span><div style="flex:1"><span class="sp-skel" style="width:55%;height:15px"></span><span class="sp-skel" style="width:25%;height:12px;margin-top:6px"></span></div></div>
    </div>
    <div v-else-if="error" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else>
    <div v-loading="loading">
    <div class="sp-page-hero-card">
      <div class="sp-page-hero-inner">
        <div class="sp-page-hero-body">
          <div class="sp-page-eyebrow purple"><el-icon :size="13"><Star /></el-icon>Performance Reviews</div>
          <h1 class="sp-modern-title">评价记录</h1>
          <p class="sp-modern-desc">查看采购方对您企业的履约综合评价，包含完整度、响应度、合作度、合规度等维度。</p>
        </div>
      </div>
    </div>

    <div class="eval-stats" v-if="stats">
      <div class="eval-stat-cell"><div class="eval-stat-value">{{ stats.total }}</div><div class="eval-stat-label">评价总次数</div></div>
      <div class="eval-stat-cell"><div class="eval-stat-value" style="color:var(--sp-primary)">{{ stats.avgScore }}</div><div class="eval-stat-label">平均得分</div></div>
      <div class="eval-stat-cell"><div class="eval-stat-value">{{ stats.levelCounts?.A||0 }}</div><div class="eval-stat-label">A 级评价</div></div>
      <div class="eval-stat-cell"><div class="eval-stat-value">{{ (stats.levelCounts?.A||0)+(stats.levelCounts?.B||0) }}</div><div class="eval-stat-label">B 级及以上</div></div>
    </div>

    <div class="sp-module growth-card" v-if="supplierStore.evaluations.length>0">
      <div class="sp-module-header">
        <span class="sp-module-title">成长建议</span>
        <span class="growth-based-on">基于 {{ supplierStore.evaluations.length }} 次评价分析</span>
      </div>
      <div class="growth-content">
        <div class="growth-insight" v-if="weakest">
          <span class="growth-tag weak">薄弱项</span>
          <span>{{ weakest.label }} 平均仅 {{ weakest.avg }} / {{ weakest.max }} 分，建议重点提升</span>
        </div>
        <div class="growth-insight" v-if="strongest">
          <span class="growth-tag strong">优势项</span>
          <span>{{ strongest.label }} 表现最佳，平均 {{ strongest.avg }} / {{ strongest.max }} 分，继续保持</span>
        </div>
        <div class="growth-bars">
          <div v-for="dim in dimensionAverages" :key="dim.key" class="growth-bar-row">
            <span class="growth-bar-label">{{ dim.label }}</span>
            <div class="growth-bar-track">
              <div class="growth-bar-fill" :style="{width:dim.pct+'%',background:dim.pct>=80?'#059669':dim.pct>=60?'#064ea2':dim.pct>=40?'#d97706':'#dc2626'}"></div>
            </div>
            <span class="growth-bar-value">{{ dim.avg }}<span class="growth-bar-max">/{{ dim.max }}</span></span>
          </div>
        </div>
      </div>
    </div>

    <div class="sp-module" v-if="stats&&stats.total>0">
      <div class="sp-module-header"><span class="sp-module-title">等级分布</span></div>
      <div class="level-bars">
        <div v-for="key in ['A','B','C','D']" :key="key" class="level-bar-row">
          <div class="level-bar-label"><span class="level-badge" :style="{background:levelColorMap[key]}">{{ key }}</span><span class="level-name">{{ levelLabel[key] }}</span></div>
          <div class="level-bar-track"><div class="level-bar-fill" :style="{width:stats.total>0?`${(stats.levelCounts?.[key]||0)/stats.total*100}%`:'0%',background:levelColorMap[key]}"></div></div>
          <div class="level-bar-count">{{ stats.levelCounts?.[key]||0 }}</div>
        </div>
      </div>
    </div>

    <div class="sp-module">
      <div class="sp-module-header"><span class="sp-module-title">评价详情</span></div>
      <div v-if="supplierStore.evaluations.length>0">
        <div v-for="e in supplierStore.evaluations" :key="e.id" class="eval-card" :class="{expanded:expandedId===e.id}">
          <div class="eval-summary" @click="toggleExpand(e.id)">
            <div class="eval-left"><div class="eval-level" :style="{background:levelColorMap[e.level]||'#64748b'}">{{ e.level }}</div><div class="eval-info"><div class="eval-score">综合评分：<strong>{{ Number(e.overallScore).toFixed(1) }}</strong> 分</div><div class="eval-evaluator">评价人：{{ e.evaluator?.displayName||'-' }}</div></div></div>
            <div class="eval-right"><div class="eval-date">{{ dayjs(e.createdAt).format('YYYY-MM-DD') }}</div><el-icon class="expand-icon" :class="{rotated:expandedId===e.id}"><ArrowDown /></el-icon></div>
          </div>
          <transition name="expand"><div v-if="expandedId===e.id" class="eval-detail">
            <div class="score-breakdown"><div v-for="dim in scoreDimensions" :key="dim.key" class="score-bar-row"><span class="score-bar-label">{{ dim.label }}</span><div class="score-bar-track"><div class="score-bar-fill" :style="{width:getScorePercent(e,dim.key,dim.max)+'%',background:getScoreColor(getScorePercent(e,dim.key,dim.max))}"></div></div><span class="score-bar-value">{{ Number(e[dim.key]||0).toFixed(1) }}</span></div></div>
            <div v-if="e.comment" class="eval-comment"><el-icon><ChatLineSquare /></el-icon><span>{{ e.comment }}</span></div>
          </div></transition>
        </div>
      </div>
      <div v-else class="sp-empty" style="padding:40px"><div class="sp-empty-icon"><el-icon :size="24"><Star /></el-icon></div><div class="sp-empty-text">暂无评价记录</div><div class="sp-empty-desc">参与项目后，采购方将对您进行履约评价</div></div>
    </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
.eval-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 16px; }
.eval-stat-cell { padding: 16px 18px; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); background: #fff; }
.eval-stat-value { font-size: 26px; font-weight: 900; color: var(--sp-gray-900); line-height: 1; font-variant-numeric: tabular-nums; }
.eval-stat-label { margin-top: 6px; font-size: 12px; color: var(--sp-gray-500); font-weight: 600; }
.level-bars { display: flex; flex-direction: column; gap: 12px; }
.level-bar-row { display: flex; align-items: center; gap: 12px; }
.level-bar-label { display: flex; align-items: center; gap: 8px; width: 80px; flex-shrink: 0; }
.level-badge { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 900; color: #fff; }
.level-name { font-size: 13px; color: var(--sp-gray-500); }
.level-bar-track { flex: 1; height: 12px; border-radius: 6px; background: var(--sp-gray-100); overflow: hidden; }
.level-bar-fill { height: 100%; border-radius: 6px; transition: width 0.6s cubic-bezier(.4,0,.2,1); }
.level-bar-count { font-size: 16px; font-weight: 800; color: var(--sp-gray-900); width: 32px; text-align: right; }
.eval-card { border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); margin-bottom: 12px; overflow: hidden; transition: all 0.2s; background: #fff; }
.eval-card:hover { border-color: var(--sp-primary); }
.eval-card.expanded { border-color: var(--sp-primary); }
.eval-summary { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; cursor: pointer; transition: background 0.15s; }
.eval-summary:hover { background: var(--sp-surface-hover); }
.eval-left { display: flex; gap: 14px; align-items: center; flex: 1; min-width: 0; }
.eval-level { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 900; color: #fff; flex-shrink: 0; }
.eval-info { flex: 1; min-width: 0; }
.eval-score { font-size: 15px; color: var(--sp-gray-700); margin-bottom: 2px; }
.eval-evaluator { font-size: 13px; color: var(--sp-gray-400); }
.eval-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.eval-date { font-size: 13px; color: var(--sp-gray-400); }
.expand-icon { color: var(--sp-gray-400); transition: transform 0.25s; font-size: 16px; }
.expand-icon.rotated { transform: rotate(180deg); }
.eval-detail { padding: 0 20px 20px; border-top: 1px solid var(--sp-border-light); }
.score-breakdown { padding-top: 16px; display: flex; flex-direction: column; gap: 10px; }
.score-bar-row { display: flex; align-items: center; gap: 10px; }
.score-bar-label { width: 48px; font-size: 12px; color: var(--sp-gray-500); font-weight: 600; flex-shrink: 0; }
.score-bar-track { flex: 1; height: 8px; border-radius: 4px; background: var(--sp-gray-100); overflow: hidden; }
.score-bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s cubic-bezier(.4,0,.2,1); }
.score-bar-value { width: 36px; text-align: right; font-size: 13px; font-weight: 700; color: var(--sp-gray-900); flex-shrink: 0; }
.eval-comment { display: flex; align-items: flex-start; gap: 8px; margin-top: 16px; padding: 12px 14px; background: var(--sp-gray-50); border-radius: var(--sp-radius-sm); font-size: 13px; color: var(--sp-gray-600); line-height: 1.6; }
.eval-comment .el-icon { flex-shrink: 0; margin-top: 2px; color: var(--sp-gray-400); }
.expand-enter-active,.expand-leave-active { transition: all 0.25s ease; overflow: hidden; }
.expand-enter-from,.expand-leave-to { opacity: 0; max-height: 0; }
.expand-enter-to,.expand-leave-from { opacity: 1; max-height: 400px; }
.growth-card { margin-bottom: 16px; }
.growth-based-on { font-size: 12px; color: var(--sp-gray-400); font-weight: 500; }
.growth-content { display: flex; flex-direction: column; gap: 16px; }
.growth-insight { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: var(--sp-gray-700); line-height: 1.6; }
.growth-tag { display: inline-block; font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 4px; flex-shrink: 0; }
.growth-tag.weak { background: #fef2f2; color: #dc2626; }
.growth-tag.strong { background: #ecfdf5; color: #059669; }
.growth-bars { display: flex; flex-direction: column; gap: 10px; }
.growth-bar-row { display: flex; align-items: center; gap: 10px; }
.growth-bar-label { width: 56px; font-size: 12px; color: var(--sp-gray-500); font-weight: 600; flex-shrink: 0; }
.growth-bar-track { flex: 1; height: 10px; border-radius: 5px; background: var(--sp-gray-100); overflow: hidden; }
.growth-bar-fill { height: 100%; border-radius: 5px; transition: width 0.5s cubic-bezier(.4,0,.2,1); }
.growth-bar-value { width: 48px; text-align: right; font-size: 13px; font-weight: 700; color: var(--sp-gray-900); flex-shrink: 0; }
.growth-bar-max { font-size: 11px; font-weight: 500; color: var(--sp-gray-400); }
</style>
