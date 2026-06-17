<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import { Search } from '@element-plus/icons-vue'
import { catalogApi } from '@/api/catalog'
import ApplicationDialog from './ApplicationDialog.vue'

const loading = ref(true); const error = ref(false); const supply = ref<any[]>([]); const dialogVisible = ref(false); const dialogItem = ref<any>(null)
const searchQuery = ref(''); const currentPage = ref(1); const pageSize = 8
const filteredSupply = computed(() => {
  if (!searchQuery.value.trim()) return supply.value
  const q = searchQuery.value.toLowerCase()
  return supply.value.filter((s: any) =>
    s.catalogItem?.name?.toLowerCase().includes(q) ||
    s.catalogItem?.code?.toLowerCase().includes(q) ||
    s.catalogItem?.specification?.toLowerCase().includes(q)
  )
})
const pagedSupply = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return filteredSupply.value.slice(start, start + pageSize)
})
const totalFiltered = computed(() => filteredSupply.value.length)
function onSearchChange() { currentPage.value = 1 }
async function load() { loading.value = true; error.value = false; try { supply.value = await catalogApi.listSupply() as any } catch { error.value = true } finally { loading.value = false } }
function retryLoad() { load() }
function openUpdate(s:any) { dialogItem.value = { id: s.catalogItemId, name: s.catalogItem.name, code: s.catalogItem.code, specification: s.catalogItem.specification, unit: s.catalogItem.unit }; dialogVisible.value = true }
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
          <h1 class="sp-modern-title">我的供货关系</h1>
          <p class="sp-modern-desc">已通过审核的目录品类供货关系与当前报价。</p>
        </div>
      </div>
    </div>

    <!-- Search -->
    <div v-if="supply.length > 0" class="sp-filter-bar" style="margin-bottom:16px">
      <el-input v-model="searchQuery" placeholder="搜索名称、编码或规格..." style="width:320px" clearable @input="onSearchChange" :prefix-icon="Search" />
      <span style="font-size:12px;color:var(--sp-gray-400);margin-left:auto">共 {{ totalFiltered }} 条</span>
    </div>

    <div v-if="filteredSupply.length===0&&!loading&&supply.length>0" class="sp-empty-panel"><el-icon :size="32"><Search /></el-icon><p class="sp-empty-text">未找到匹配的供货</p><p class="sp-empty-desc">尝试其他关键词</p></div>
    <div v-else-if="supply.length===0&&!loading" class="sp-empty-panel"><el-icon :size="32"><Box /></el-icon><p class="sp-empty-text">暂无供货关系</p><p class="sp-empty-desc">前往「集中采购目录」申请供货</p><el-button type="primary" style="margin-top:16px" @click="$router.push('/catalog')">浏览采购目录</el-button></div>

    <div v-else class="supply-grid">
      <div v-for="s in pagedSupply" :key="s.id" class="supply-card">
        <div class="supply-card-head"><div><div class="supply-code">{{ s.catalogItem.code }}</div><div class="supply-name">{{ s.catalogItem.name }}</div><div class="supply-spec">{{ s.catalogItem.specification }}</div></div><span class="sp-status" :class="s.status==='ACTIVE'?'approved':'disabled'">{{ s.status==='ACTIVE'?'供货中':'已停用' }}</span></div>
        <div class="supply-card-body"><div class="supply-price"><span class="supply-price-label">当前报价</span><span class="supply-price-value">&yen;{{ Number(s.quotedPrice).toLocaleString() }}<small> / {{ s.catalogItem.unit }}</small></span></div><div class="supply-meta"><span v-if="s.deliveryPeriod">交期 {{ s.deliveryPeriod }}</span><span v-if="s.region"> &middot; {{ s.region }}</span><span v-if="s.minOrder"> &middot; 起订 {{ s.minOrder }}</span></div><div class="supply-time">更新于 {{ dayjs(s.updatedAt).format('YYYY-MM-DD') }}</div></div>
        <div class="supply-card-foot"><el-button v-if="s.status==='ACTIVE'" size="small" type="primary" plain @click="openUpdate(s)">申请改报价</el-button></div>
      </div>
    </div>
    <div v-if="totalFiltered > pageSize" style="display:flex;justify-content:center;margin-top:16px">
      <el-pagination background layout="prev, pager, next" :total="totalFiltered" :page-size="pageSize" v-model:current-page="currentPage" />
    </div>
    <ApplicationDialog v-model="dialogVisible" mode="UPDATE_QUOTE" :item="dialogItem" @success="onDialogSuccess" />
    </template>
  </div>
</template>

<style scoped>
.supply-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.supply-card { position: relative; background: rgba(255,255,255,0.52); backdrop-filter: blur(12px) saturate(1.1); -webkit-backdrop-filter: blur(12px) saturate(1.1); border: 1px solid rgba(255,255,255,0.42); border-radius: var(--sp-radius-md); overflow: hidden; transition: border-color 0.2s, box-shadow 0.2s; }
.supply-card::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: 0.34; border-radius: inherit; background-image: radial-gradient(ellipse at 14% 6%, rgba(96,165,250,0.14), transparent 55%), radial-gradient(ellipse at 84% 12%, rgba(56,189,248,0.08), transparent 55%), radial-gradient(ellipse at 40% 90%, rgba(6,78,162,0.04), transparent 55%); animation: glass-glow-drift 18s ease-in-out infinite; }
.supply-card:hover { border-color: var(--sp-primary); box-shadow: 0 1px 8px rgba(15,47,87,0.08); }
.supply-card:hover::before { opacity: 0.48; }
.supply-card > * { position: relative; z-index: 1; }
.supply-card-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid rgba(0,0,0,0.04); }
.supply-code { font-family: monospace; font-size: 11px; color: var(--sp-primary); font-weight: 700; }
.supply-name { font-size: 15px; font-weight: 800; color: var(--sp-gray-900); margin-top: 3px; }
.supply-spec { font-size: 12px; color: var(--sp-gray-400); margin-top: 2px; }
.supply-card-body { padding: 16px 18px; }
.supply-price { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
.supply-price-label { font-size: 11px; color: var(--sp-gray-400); font-weight: 600; }
.supply-price-value { font-size: 24px; color: #dc2626; font-weight: 800; }
.supply-price-value small { font-size: 12px; color: var(--sp-gray-400); font-weight: 400; }
.supply-meta { font-size: 12px; color: var(--sp-gray-500); }
.supply-time { font-size: 11px; color: var(--sp-gray-400); margin-top: 6px; }
.supply-card-foot { padding: 12px 18px; border-top: 1px solid rgba(0,0,0,0.04); background: rgba(255,255,255,0.40); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }

.sp-empty-text { font-size: 15px; font-weight: 700; color: var(--sp-gray-500); margin-top: 12px; }
.sp-empty-desc { font-size: 13px; margin-top: 4px; }
</style>
