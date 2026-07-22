<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import SpPageHero from '@/components/SpPageHero.vue'
import SpKpi from '@/components/SpKpi.vue'
import { Gauge, AlertTriangle } from 'lucide-vue-next'
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
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else>
    <div v-loading="loading">
    <SpPageHero :icon="Gauge" title="评价记录" sub="查看采购方对您企业的履约综合评价，包含完整度、响应度、合作度、合规度等维度。" />

    <div class="kpi-grid eval-kpi" v-if="stats">
      <SpKpi label="评价总次数" :value="stats.total" />
      <SpKpi label="平均得分" :value="stats.avgScore" tone="var(--brand)" />
      <SpKpi label="A 级评价" :value="stats.levelCounts?.A||0" />
      <SpKpi label="B 级及以上" :value="(stats.levelCounts?.A||0)+(stats.levelCounts?.B||0)" />
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
              <div class="growth-bar-fill" :style="{ width: dim.pct+'%', '--c': dim.pct>=80?'#059669':dim.pct>=60?'#064ea2':dim.pct>=40?'#d97706':'#dc2626' } as any"></div>
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
          <div class="level-bar-label"><span class="level-badge" :style="{ '--c': levelColorMap[key] } as any">{{ key }}</span><span class="level-name">{{ levelLabel[key] }}</span></div>
          <div class="level-bar-track"><div class="level-bar-fill" :style="{ width: stats.total>0?`${(stats.levelCounts?.[key]||0)/stats.total*100}%`:'0%', '--c': levelColorMap[key] } as any"></div></div>
          <div class="level-bar-count">{{ stats.levelCounts?.[key]||0 }}</div>
        </div>
      </div>
    </div>

    <div class="sp-module">
      <div class="sp-module-header"><span class="sp-module-title">评价详情</span></div>
      <div v-if="supplierStore.evaluations.length>0">
        <div v-for="e in supplierStore.evaluations" :key="e.id" class="eval-card" :class="{expanded:expandedId===e.id}">
          <div class="eval-summary" @click="toggleExpand(e.id)">
            <div class="eval-left"><div class="eval-level" :style="{ '--c': levelColorMap[e.level]||'#64748b' } as any">{{ e.level }}</div><div class="eval-info"><div class="eval-score">综合评分：<strong>{{ Number(e.overallScore).toFixed(1) }}</strong> 分</div><div class="eval-evaluator">评价人：{{ e.evaluator?.displayName||'-' }}</div></div></div>
            <div class="eval-right"><div class="eval-date">{{ dayjs(e.createdAt).format('YYYY-MM-DD') }}</div><el-icon class="expand-icon" :class="{rotated:expandedId===e.id}"><ArrowDown /></el-icon></div>
          </div>
          <transition name="expand"><div v-if="expandedId===e.id" class="eval-detail">
            <div class="score-breakdown"><div v-for="dim in scoreDimensions" :key="dim.key" class="score-bar-row"><span class="score-bar-label">{{ dim.label }}</span><div class="score-bar-track"><div class="score-bar-fill" :style="{ width: getScorePercent(e,dim.key,dim.max)+'%', '--c': getScoreColor(getScorePercent(e,dim.key,dim.max)) } as any"></div></div><span class="score-bar-value">{{ Number(e[dim.key]||0).toFixed(1) }}</span></div></div>
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
/* Skeletons — borderless surface plates (no glass) */
.skel-wrap { display: flex; flex-direction: column; gap: 14px; }
.skel-hero { background: var(--surface); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.skel-cell { background: var(--surface); border-radius: 14px; padding: 16px 18px; display: flex; flex-direction: column; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.skel-card { display: flex; align-items: center; gap: 14px; background: var(--surface); border-radius: 14px; padding: 16px 20px; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }

/* KPI strip spacing (tiles from cgzxui .kpi-card) */
.eval-kpi { margin-bottom: 16px; }

/* Growth / level bars — concave grooves, dynamic fill via --c */
.growth-card { margin-bottom: 16px; }
.growth-based-on { font-size: 12px; color: var(--muted-foreground); font-weight: 500; }
.growth-content { display: flex; flex-direction: column; gap: 16px; }
.growth-insight { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: var(--foreground); line-height: 1.6; }
.growth-tag { display: inline-block; font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 5px; flex-shrink: 0; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.growth-tag.weak { background: color-mix(in oklab, var(--danger) 10%, transparent); color: var(--danger); }
.growth-tag.strong { background: color-mix(in oklab, var(--success) 12%, transparent); color: color-mix(in oklab, var(--success) 55%, #000); }
.growth-bars { display: flex; flex-direction: column; gap: 10px; }
.growth-bar-row { display: flex; align-items: center; gap: 10px; }
.growth-bar-label { width: 56px; font-size: 12px; color: var(--muted-foreground); font-weight: 600; flex-shrink: 0; }
.growth-bar-track { flex: 1; height: 10px; border-radius: 5px; overflow: hidden; background: oklch(0.96 0.008 258); box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 4px oklch(1 0 0 / 0.8); }
.growth-bar-fill { height: 100%; border-radius: 5px; background: var(--c); transition: width 0.5s cubic-bezier(.4,0,.2,1); }
.growth-bar-value { width: 48px; text-align: right; font-size: 13px; font-weight: 700; color: var(--foreground); flex-shrink: 0; font-variant-numeric: tabular-nums; }
.growth-bar-max { font-size: 11px; font-weight: 500; color: var(--muted-foreground); }

.level-bars { display: flex; flex-direction: column; gap: 12px; }
.level-bar-row { display: flex; align-items: center; gap: 12px; }
.level-bar-label { display: flex; align-items: center; gap: 8px; width: 80px; flex-shrink: 0; }
.level-badge { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 900; color: #fff; background: var(--c); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.3); }
.level-name { font-size: 13px; color: var(--muted-foreground); }
.level-bar-track { flex: 1; height: 12px; border-radius: 6px; overflow: hidden; background: oklch(0.96 0.008 258); box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 4px oklch(1 0 0 / 0.8); }
.level-bar-fill { height: 100%; border-radius: 6px; background: var(--c); transition: width 0.6s cubic-bezier(.4,0,.2,1); }
.level-bar-count { font-size: 16px; font-weight: 800; color: var(--foreground); width: 32px; text-align: right; font-variant-numeric: tabular-nums; }

/* Evaluation rows — neumorphic plates (no glass / no drift) */
.eval-card {
  border: none; border-radius: 14px; margin-bottom: 12px; overflow: hidden;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
  transition: transform .15s ease, box-shadow .15s ease;
}
.eval-card:hover {
  transform: translateY(-1px);
  box-shadow: 7px 7px 16px oklch(0.55 0.03 258 / 0.12), -5px -5px 12px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.eval-card.expanded {
  box-shadow: 7px 7px 16px oklch(0.55 0.03 258 / 0.12), -5px -5px 12px oklch(1 0 0 / 0.9), inset 0 0 0 1px color-mix(in oklab, var(--brand) 18%, transparent);
}
.eval-summary { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; cursor: pointer; transition: background 0.15s; }
.eval-summary:hover { background: oklch(0.985 0.01 258 / 0.6); }
.eval-left { display: flex; gap: 14px; align-items: center; flex: 1; min-width: 0; }
.eval-level { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 900; color: #fff; flex-shrink: 0; background: var(--c); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.3); }
.eval-info { flex: 1; min-width: 0; }
.eval-score { font-size: 15px; color: var(--foreground); margin-bottom: 2px; }
.eval-score strong { font-weight: 900; font-variant-numeric: tabular-nums; }
.eval-evaluator { font-size: 13px; color: var(--muted-foreground); }
.eval-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.eval-date { font-size: 13px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.expand-icon { color: var(--muted-foreground); transition: transform 0.25s; font-size: 16px; }
.expand-icon.rotated { transform: rotate(180deg); }
.eval-detail { padding: 0 20px 20px; border-top: 1px solid var(--hairline); }
.score-breakdown { padding-top: 16px; display: flex; flex-direction: column; gap: 10px; }
.score-bar-row { display: flex; align-items: center; gap: 10px; }
.score-bar-label { width: 48px; font-size: 12px; color: var(--muted-foreground); font-weight: 600; flex-shrink: 0; }
.score-bar-track { flex: 1; height: 8px; border-radius: 4px; overflow: hidden; background: oklch(0.96 0.008 258); box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 4px oklch(1 0 0 / 0.8); }
.score-bar-fill { height: 100%; border-radius: 4px; background: var(--c); transition: width 0.5s cubic-bezier(.4,0,.2,1); }
.score-bar-value { width: 36px; text-align: right; font-size: 13px; font-weight: 700; color: var(--foreground); flex-shrink: 0; font-variant-numeric: tabular-nums; }
.eval-comment { display: flex; align-items: flex-start; gap: 8px; margin-top: 16px; padding: 12px 14px; border-radius: 10px; font-size: 13px; color: var(--muted-foreground); line-height: 1.6; background: var(--surface); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7); }
.eval-comment .el-icon { flex-shrink: 0; margin-top: 2px; color: var(--muted-foreground); }
.expand-enter-active,.expand-leave-active { transition: all 0.25s ease; overflow: hidden; }
.expand-enter-from,.expand-leave-to { opacity: 0; max-height: 0; }
.expand-enter-to,.expand-leave-from { opacity: 1; max-height: 400px; }

@media (prefers-reduced-motion: reduce) {
  .eval-card, .growth-bar-fill, .level-bar-fill, .score-bar-fill { transition: none; }
  .eval-card:hover { transform: none; }
}
</style>
