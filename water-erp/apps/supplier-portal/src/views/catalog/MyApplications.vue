<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import { catalogApi } from '@/api/catalog'
import ApplicationDialog from './ApplicationDialog.vue'

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
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else>
    <div class="sp-page-hero-card">
      <div class="sp-page-hero-inner">
        <div class="sp-page-hero-body">
          <h1 class="sp-modern-title">我的供货申请</h1>
          <p class="sp-modern-desc">查看新增品类 / 加入供货 / 改报价申请的审核进度与议价记录。</p>
        </div>
      </div>
    </div>

    <div class="tab-row"><el-tabs v-model="activeTab"><el-tab-pane name="active"><template #label><span class="tab-label">进行中<strong class="tab-count">{{ counts.active }}</strong></span></template></el-tab-pane><el-tab-pane name="done"><template #label><span class="tab-label">已结束<strong class="tab-count">{{ counts.done }}</strong></span></template></el-tab-pane></el-tabs></div>

    <div v-if="filtered.length===0&&!loading" class="empty-center"><div class="sp-empty-panel"><el-icon :size="32"><Document /></el-icon><p class="sp-empty-text">暂无申请记录</p><p class="sp-empty-desc">前往「集中采购目录」申请供货或新增品类</p></div></div>

    <div v-else class="app-list">
      <div v-for="a in filtered" :key="a.id" class="app-card">
        <div class="app-card-head"><span class="app-type-tag" :class="a.type">{{ typeLabel[a.type] }}</span><div class="app-title-wrap"><div class="app-title">{{ itemTitle(a) }}</div><div class="app-spec">{{ itemSpec(a) }}</div></div><el-tag :type="(statusMeta[a.status]?.type as any)||'info'" effect="light" size="small">{{ statusMeta[a.status]?.label||a.status }}</el-tag></div>
        <div class="app-card-body">
          <div class="app-info-grid">
            <div class="app-info-item"><span class="app-info-label">报价</span><span class="app-info-value price">&yen;{{ a.quotedPrice }}<small v-if="a.catalogItem?.unit||a.proposedUnit"> / {{ a.catalogItem?.unit||a.proposedUnit }}</small></span></div>
            <div class="app-info-item" v-if="a.deliveryPeriod"><span class="app-info-label">交货周期</span><span class="app-info-value">{{ a.deliveryPeriod }}</span></div>
            <div class="app-info-item" v-if="a.region"><span class="app-info-label">区域</span><span class="app-info-value">{{ a.region }}</span></div>
            <div class="app-info-item" v-if="a.minOrder"><span class="app-info-label">最小起订</span><span class="app-info-value">{{ a.minOrder }}</span></div>
            <div class="app-info-item"><span class="app-info-label">提交时间</span><span class="app-info-value">{{ dayjs(a.createdAt).format('MM-DD HH:mm') }}<template v-if="a.status==='PENDING'"> · <span style="color:var(--sp-orange)">{{ since(a.createdAt) }}</span></template></span></div>
          </div>
          <div v-if="a.status==='COUNTERED'&&a.counterPrice" class="app-counter"><div class="app-counter-icon"><el-icon :size="20"><Connection /></el-icon></div><div class="app-counter-body"><div class="app-counter-title">管理员议价 <strong>&yen;{{ a.counterPrice }}</strong></div><div class="app-counter-note" v-if="a.counterNote">{{ a.counterNote }}</div></div></div>
          <div v-if="(a.status==='RETURNED'||a.status==='REJECTED')&&a.rejectReason" class="app-reason"><el-icon><WarningFilled /></el-icon><span>{{ a.status==='REJECTED'?'拒绝理由':'退回说明' }}：{{ a.rejectReason }}</span></div>
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
.app-list { display: flex; flex-direction: column; gap: 14px; }
.app-card { position: relative; background: rgba(255,255,255,0.52); backdrop-filter: blur(12px) saturate(1.1); -webkit-backdrop-filter: blur(12px) saturate(1.1); border: 1px solid rgba(255,255,255,0.42); border-radius: var(--sp-radius-md); overflow: hidden; transition: border-color 0.2s, box-shadow 0.2s; }
.app-card::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: 0.34; border-radius: inherit; background-image: radial-gradient(ellipse at 14% 6%, rgba(96,165,250,0.14), transparent 55%), radial-gradient(ellipse at 84% 12%, rgba(56,189,248,0.08), transparent 55%), radial-gradient(ellipse at 40% 90%, rgba(6,78,162,0.04), transparent 55%); animation: glass-glow-drift 18s ease-in-out infinite; }
.app-card:hover { border-color: var(--sp-primary); box-shadow: 0 1px 8px rgba(15,47,87,0.08); }
.app-card:hover::before { opacity: 0.48; }
.app-card > * { position: relative; z-index: 1; }
.app-card-head { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid rgba(0,0,0,0.04); }
.app-type-tag { font-size: 12px; font-weight: 800; padding: 3px 10px; border-radius: 8px; flex-shrink: 0; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.app-type-tag.NEW_ITEM { background: rgba(237,233,254,0.72); color: #6d28d9; }
.app-type-tag.JOIN_EXISTING { background: rgba(219,234,254,0.72); color: #1d4ed8; }
.app-type-tag.UPDATE_QUOTE { background: rgba(254,243,199,0.72); color: #b45309; }
.app-title-wrap { flex: 1; min-width: 0; }
.app-title { font-size: 15px; font-weight: 800; color: var(--sp-gray-900); }
.app-spec { font-size: 12px; color: var(--sp-gray-400); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app-card-body { padding: 16px 20px; }
.app-info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px 20px; }
.app-info-item { display: flex; flex-direction: column; gap: 2px; }
.app-info-label { font-size: 11px; color: var(--sp-gray-400); font-weight: 600; }
.app-info-value { font-size: 14px; color: var(--sp-gray-700); font-weight: 600; }
.app-info-value.price { color: #dc2626; font-size: 16px; font-weight: 800; }
.app-info-value.price small { font-size: 11px; color: var(--sp-gray-400); font-weight: 400; }
.app-counter { display: flex; gap: 10px; margin-top: 14px; padding: 12px 14px; background: rgba(254,243,199,0.55); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); border: 1px solid rgba(253,230,138,0.50); border-radius: var(--sp-radius-sm); }
.app-counter-title { font-size: 14px; color: #92400e; }
.app-counter-title strong { color: #dc2626; font-size: 16px; }
.app-counter-note { font-size: 12px; color: #a16207; margin-top: 3px; }
.app-reason { display: flex; align-items: flex-start; gap: 6px; margin-top: 12px; padding: 10px 12px; background: rgba(254,226,226,0.60); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); border: 1px solid rgba(239,68,68,0.15); border-radius: var(--sp-radius-sm); font-size: 13px; color: #b91c1c; line-height: 1.5; }
.app-note { margin-top: 10px; font-size: 12px; color: var(--sp-gray-500); background: rgba(255,255,255,0.48); padding: 8px 12px; border-radius: var(--sp-radius-sm); border: 1px solid rgba(0,0,0,0.03); }
.app-note-label { font-weight: 700; color: var(--sp-gray-600); margin-right: 6px; }
.app-card-foot { display: flex; align-items: center; gap: 8px; padding: 12px 20px; border-top: 1px solid rgba(0,0,0,0.04); background: rgba(255,255,255,0.40); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }

.tab-row { margin-bottom: 16px; }

.tab-label { display: inline-flex; align-items: baseline; gap: 6px; }

.tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px;
  font-family: 'Inter', 'SF Mono', 'JetBrains Mono', monospace;
  font-size: 12px; font-weight: 600;
  line-height: 1; letter-spacing: -0.01em;
  border-radius: 10px;
  color: var(--sp-gray-400);
  background: var(--sp-gray-100);
  transition: color 0.2s, background 0.2s;
}

.el-tabs__item.is-active .tab-count {
  color: var(--sp-primary);
  background: var(--sp-primary-lighter);
}

.empty-center { display: flex; align-items: center; justify-content: center; min-height: 60vh; }
.sp-empty-panel { text-align: center; }
.sp-empty-text { font-size: 15px; font-weight: 700; color: var(--sp-gray-500); margin-top: 12px; }
.sp-empty-desc { font-size: 13px; margin-top: 4px; color: var(--sp-gray-400); }
</style>
