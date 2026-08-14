<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import { catalogApi } from '@/api/catalog'
import ApplicationDialog from './ApplicationDialog.vue'
import SpPageHero from '@/components/SpPageHero.vue'
import { FileSpreadsheet, AlertTriangle, Inbox, Handshake } from 'lucide-vue-next'

const loading = ref(true); const error = ref(false); const applications = ref<any[]>([]); const activeTab = ref('active'); const dialogVisible = ref(false); const editApp = ref<any>(null)
async function load() { loading.value = true; error.value = false; try { applications.value = await catalogApi.listApplications() as any } catch { error.value = true } finally { loading.value = false } }
function retryLoad() { load() }
const statusMeta: Record<string,{label:string;type:string}> = {PENDING:{label:'待审核',type:'primary'},COUNTERED:{label:'议价中',type:'warning'},RETURNED:{label:'已退回',type:'danger'},APPROVED:{label:'已通过',type:'success'},REJECTED:{label:'已拒绝',type:'danger'},WITHDRAWN:{label:'已撤回',type:'info'}}
const typeLabel: Record<string,string> = {NEW_ITEM:'新增品类',JOIN_EXISTING:'加入供货',UPDATE_QUOTE:'改报价'}
function since(ts: string): string { const d = Math.ceil((Date.now() - new Date(ts).getTime()) / 86400000); if (d > 0) return `已等待 ${d} 天`; const h = Math.ceil((Date.now() - new Date(ts).getTime()) / 3600000); return h > 0 ? `已等待 ${h} 小时` : '刚提交' }
const filtered = computed(() => { if (activeTab.value==='active') return applications.value.filter(a=>['PENDING','COUNTERED','RETURNED'].includes(a.status)); if (activeTab.value==='done') return applications.value.filter(a=>['APPROVED','REJECTED','WITHDRAWN'].includes(a.status)); return applications.value })
const counts = computed(() => ({ active: applications.value.filter(a=>['PENDING','COUNTERED','RETURNED'].includes(a.status)).length, done: applications.value.filter(a=>['APPROVED','REJECTED','WITHDRAWN'].includes(a.status)).length }))
function itemTitle(a:any) { return a.type==='NEW_ITEM'?(a.proposedName||'未命名'):(a.catalogItem?.name||'-') }
function itemSpec(a:any) { if (a.type==='NEW_ITEM') return [a.proposedSpec,a.proposedGroup,a.proposedCategory,a.proposedUnit].filter(Boolean).join(' · '); return [a.catalogItem?.code,a.catalogItem?.specification,a.catalogItem?.unit].filter(Boolean).join(' · ') }
async function withdraw(a:any) { await ElMessageBox.confirm('确认撤回？','提示',{type:'warning'}); await catalogApi.withdraw(a.id); ElMessage.success('已撤回'); load() }
async function acceptCounter(a:any) { await ElMessageBox.confirm(`接受议价 ¥${a.counterPrice}？`,'接受议价',{type:'warning'}); await catalogApi.acceptCounter(a.id); ElMessage.success('已接受议价'); load() }
function edit(a:any) { editApp.value = a; dialogVisible.value = true }
function onDialogSuccess() { load() }
onMounted(load)
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else>
    <SpPageHero :icon="FileSpreadsheet" title="我的供货申请" sub="查看新增品类 / 加入供货 / 改报价申请的审核进度与议价记录。" />

    <div class="neu-tab-bar app-tabs">
      <button type="button" class="neu-tab" :class="{ 'is-active': activeTab==='active' }" :aria-pressed="activeTab==='active'" @click="activeTab='active'">进行中<span class="app-tab-count">{{ counts.active }}</span></button>
      <button type="button" class="neu-tab" :class="{ 'is-active': activeTab==='done' }" :aria-pressed="activeTab==='done'" @click="activeTab='done'">已结束<span class="app-tab-count">{{ counts.done }}</span></button>
    </div>

    <div v-if="filtered.length===0&&!loading" class="sp-empty app-empty">
      <div class="sp-empty-icon"><Inbox :size="22" :stroke-width="1.75" /></div>
      <div class="sp-empty-text">暂无申请记录</div>
      <div class="sp-empty-desc">前往「集中采购目录」申请供货或新增品类</div>
    </div>

    <div v-else class="app-list">
      <div v-for="a in filtered" :key="a.id" class="app-card">
        <div class="app-card-head"><span class="app-type-tag" :class="a.type">{{ typeLabel[a.type] }}</span><div class="app-title-wrap"><div class="app-title">{{ itemTitle(a) }}</div><div class="app-spec">{{ itemSpec(a) }}</div></div><el-tag :type="(statusMeta[a.status]?.type as any)||'info'" effect="light" size="small">{{ statusMeta[a.status]?.label||a.status }}</el-tag></div>
        <div class="app-card-body">
          <div class="app-info-grid">
            <div class="app-info-item"><span class="app-info-label">报价</span><span class="app-info-value price">&yen;{{ a.quotedPrice }}<small v-if="a.catalogItem?.unit||a.proposedUnit"> / {{ a.catalogItem?.unit||a.proposedUnit }}</small></span></div>
            <div class="app-info-item" v-if="a.deliveryPeriod"><span class="app-info-label">交货周期</span><span class="app-info-value">{{ a.deliveryPeriod }}</span></div>
            <div class="app-info-item" v-if="a.region"><span class="app-info-label">区域</span><span class="app-info-value">{{ a.region }}</span></div>
            <div class="app-info-item" v-if="a.minOrder"><span class="app-info-label">最小起订</span><span class="app-info-value">{{ a.minOrder }}</span></div>
            <div class="app-info-item"><span class="app-info-label">提交时间</span><span class="app-info-value">{{ dayjs(a.createdAt).format('MM-DD HH:mm') }}<template v-if="a.status==='PENDING'"> · <span class="app-wait">{{ since(a.createdAt) }}</span></template></span></div>
          </div>
          <div v-if="a.status==='COUNTERED'&&a.counterPrice" class="app-counter"><Handshake :size="18" :stroke-width="1.75" class="app-counter-icon" /><div class="app-counter-body"><div class="app-counter-title">管理员议价 <strong>&yen;{{ a.counterPrice }}</strong></div><div class="app-counter-note" v-if="a.counterNote">{{ a.counterNote }}</div></div></div>
          <div v-if="(a.status==='RETURNED'||a.status==='REJECTED')&&a.rejectReason" class="app-reason"><AlertTriangle :size="15" :stroke-width="1.75" /><span>{{ a.status==='REJECTED'?'拒绝理由':'退回说明' }}：{{ a.rejectReason }}</span></div>
          <div v-if="a.reviewerNote" class="app-note"><span class="app-note-label">审核备注</span>{{ a.reviewerNote }}</div>
        </div>
        <div class="app-card-foot">
          <template v-if="a.status==='COUNTERED'"><el-button type="primary" @click="acceptCounter(a)">接受议价</el-button><el-button @click="edit(a)">再报价</el-button><el-button text @click="withdraw(a)">撤回</el-button></template>
          <template v-else-if="a.status==='RETURNED'"><el-button type="primary" @click="edit(a)">补正后重新提交</el-button><el-button text @click="withdraw(a)">撤回</el-button></template>
          <template v-else-if="a.status==='PENDING'"><el-button text @click="withdraw(a)">撤回申请</el-button></template>
        </div>
      </div>
    </div>
    <ApplicationDialog v-model="dialogVisible" mode="edit" :application="editApp" @success="onDialogSuccess" />
    </template>
  </div>
</template>

<style scoped>
/* ── Tabs — layout only (visuals from cgzxui .neu-tab-bar / .neu-tab) ── */
.app-tabs { display: flex; width: fit-content; margin: 16px 0; }
.app-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 18px; padding: 0 6px;
  font-size: 11px; font-weight: 700; line-height: 1;
  border-radius: 9px; font-variant-numeric: tabular-nums;
  color: var(--muted-foreground); background: oklch(0.55 0.03 258 / 0.1);
  transition: color 0.2s ease, background 0.2s ease;
}
.neu-tab.is-active .app-tab-count { color: var(--brand); background: color-mix(in oklab, var(--brand) 12%, transparent); }

/* ── Application cards — neumorphic plates (no glass / no drift) ── */
.app-list { display: flex; flex-direction: column; gap: 14px; }
.app-card {
  border-radius: 16px; overflow: hidden;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
  transition: transform .15s ease, box-shadow .15s ease;
}
.app-card:hover {
  transform: translateY(-1px);
  box-shadow: 7px 7px 16px oklch(0.55 0.03 258 / 0.12), -5px -5px 12px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.app-card-head { display: flex; align-items: center; gap: 12px; padding: 16px 20px; box-shadow: inset 0 -1px 0 var(--hairline); }
.app-type-tag { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 6px; flex-shrink: 0; white-space: nowrap; }
.app-type-tag.NEW_ITEM     { background: color-mix(in oklab, #7c3aed 12%, transparent); color: #7c3aed; }
.app-type-tag.JOIN_EXISTING { background: color-mix(in oklab, #0a5eb8 12%, transparent); color: #0a5eb8; }
.app-type-tag.UPDATE_QUOTE { background: color-mix(in oklab, #d97706 12%, transparent); color: #d97706; }
.app-title-wrap { flex: 1; min-width: 0; }
.app-title { font-size: 15px; font-weight: 800; color: var(--foreground); letter-spacing: -0.01em; }
.app-spec { font-size: 12px; color: var(--muted-foreground); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app-card-body { padding: 16px 20px; }
.app-info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px 20px; }
.app-info-item { display: flex; flex-direction: column; gap: 2px; }
.app-info-label { font-size: 11px; color: var(--muted-foreground); font-weight: 600; }
.app-info-value { font-size: 14px; color: var(--foreground); font-weight: 600; font-variant-numeric: tabular-nums; }
.app-info-value.price { color: var(--danger); font-size: 16px; font-weight: 800; }
.app-info-value.price small { font-size: 11px; color: var(--muted-foreground); font-weight: 400; }
.app-wait { color: var(--warning); font-weight: 700; }
.app-counter {
  display: flex; align-items: flex-start; gap: 10px; margin-top: 14px; padding: 12px 14px;
  border-radius: 10px; color: var(--foreground);
  background: color-mix(in oklab, var(--warning) 10%, transparent);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6);
}
.app-counter-icon { flex-shrink: 0; margin-top: 1px; color: var(--warning); }
.app-counter-title { font-size: 14px; }
.app-counter-title strong { color: var(--danger); font-size: 16px; font-variant-numeric: tabular-nums; }
.app-counter-note { font-size: 12px; color: var(--muted-foreground); margin-top: 3px; }
.app-reason {
  display: flex; align-items: flex-start; gap: 6px; margin-top: 12px; padding: 10px 12px;
  border-radius: 10px; font-size: 13px; line-height: 1.5; color: var(--danger);
  background: color-mix(in oklab, var(--danger) 8%, transparent);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6);
}
.app-reason > svg { flex-shrink: 0; margin-top: 2px; }
.app-note {
  margin-top: 10px; font-size: 12px; color: var(--muted-foreground);
  background: oklch(0.99 0.004 258); padding: 8px 12px; border-radius: 8px;
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.12), inset -3px -3px 7px oklch(1 0 0 / 0.8);
}
.app-note-label { font-weight: 700; color: var(--foreground); margin-right: 6px; }
.app-card-foot { display: flex; align-items: center; gap: 8px; padding: 12px 20px; box-shadow: inset 0 1px 0 var(--hairline); }

/* ── Empty ── */
.app-empty { padding: 72px 20px; }

@media (prefers-reduced-motion: reduce) {
  .app-card { transition: none; }
  .app-card:hover { transform: none; }
}
</style>
