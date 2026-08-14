<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import { Search } from '@element-plus/icons-vue'
import { catalogApi } from '@/api/catalog'
import ApplicationDialog from './ApplicationDialog.vue'
import SpPageHero from '@/components/SpPageHero.vue'
import { Truck, AlertTriangle, PackageSearch, PackageX } from 'lucide-vue-next'

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
const activeCount = computed(() => supply.value.filter((s: any) => s.status === 'ACTIVE').length)
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
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>

      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else>
    <SpPageHero :icon="Truck" title="我的供货关系" sub="已通过审核的目录品类供货关系与当前报价。">
      <template #actions>
        <div class="page-hero__stat"><strong>{{ supply.length }}</strong><span>供货关系</span></div>
        <div class="page-hero__stat"><strong>{{ activeCount }}</strong><span>供货中</span></div>
      </template>
    </SpPageHero>

    <!-- Search -->
    <div v-if="supply.length > 0" class="neu-card supply-filter">
      <el-input v-model="searchQuery" placeholder="搜索名称、编码或规格..." style="width:320px" clearable @input="onSearchChange" :prefix-icon="Search" />
      <span class="supply-filter-count">共 {{ totalFiltered }} 条</span>
    </div>

    <div v-if="filteredSupply.length===0&&!loading&&supply.length>0" class="sp-empty supply-empty">
      <div class="sp-empty-icon"><PackageSearch :size="22" :stroke-width="1.75" /></div>
      <div class="sp-empty-text">未找到匹配的供货</div>
      <div class="sp-empty-desc">尝试其他关键词</div>
    </div>
    <div v-else-if="supply.length===0&&!loading" class="sp-empty supply-empty">
      <div class="sp-empty-icon"><PackageX :size="22" :stroke-width="1.75" /></div>
      <div class="sp-empty-text">暂无供货关系</div>
      <div class="sp-empty-desc">前往「集中采购目录」申请供货</div>
      <el-button type="primary" style="margin-top:16px" @click="$router.push('/catalog')">浏览采购目录</el-button>
    </div>

    <div v-else class="supply-grid">
      <div v-for="s in pagedSupply" :key="s.id" class="supply-card">
        <div class="supply-card-head"><div><div class="supply-code">{{ s.catalogItem.code }}</div><div class="supply-name">{{ s.catalogItem.name }}</div><div class="supply-spec">{{ s.catalogItem.specification }}</div></div><span class="sp-status" :class="s.status==='ACTIVE'?'approved':'disabled'">{{ s.status==='ACTIVE'?'供货中':'已停用' }}</span></div>
        <div class="supply-card-body"><div class="supply-price"><span class="supply-price-label">当前报价</span><span class="supply-price-value">&yen;{{ Number(s.quotedPrice).toLocaleString() }}<small> / {{ s.catalogItem.unit }}</small></span></div><div class="supply-meta"><span v-if="s.deliveryPeriod">交期 {{ s.deliveryPeriod }}</span><span v-if="s.region"> &middot; {{ s.region }}</span><span v-if="s.minOrder"> &middot; 起订 {{ s.minOrder }}</span></div><div class="supply-time">更新于 {{ dayjs(s.updatedAt).format('YYYY-MM-DD') }}</div></div>
        <div v-if="s.status==='ACTIVE'" class="supply-card-foot"><el-button size="small" type="primary" plain @click="openUpdate(s)">申请改报价</el-button></div>
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
/* ── Search bar — layout only (visuals from cgzxui .neu-card) ── */
.supply-filter { flex-direction: row; align-items: center; gap: 12px; padding: 12px 16px; margin: 16px 0; }
.supply-filter-count { margin-left: auto; font-size: 12px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }

/* ── Supply cards — neumorphic plates (no glass / no drift) ── */
.supply-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.supply-card {
  border-radius: 16px; overflow: hidden;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
  transition: transform .15s ease, box-shadow .15s ease;
}
.supply-card:hover {
  transform: translateY(-1px);
  box-shadow: 7px 7px 16px oklch(0.55 0.03 258 / 0.12), -5px -5px 12px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.supply-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 16px 18px; box-shadow: inset 0 -1px 0 var(--hairline); }
.supply-code { font-family: 'SF Mono', 'JetBrains Mono', monospace; font-size: 11px; color: var(--brand); font-weight: 700; }
.supply-name { font-size: 15px; font-weight: 800; color: var(--foreground); margin-top: 3px; letter-spacing: -0.01em; }
.supply-spec { font-size: 12px; color: var(--muted-foreground); margin-top: 2px; }
.supply-card-body { padding: 16px 18px; }
.supply-price { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
.supply-price-label { font-size: 11px; color: var(--muted-foreground); font-weight: 600; }
.supply-price-value { font-size: 24px; color: var(--danger); font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.supply-price-value small { font-size: 12px; color: var(--muted-foreground); font-weight: 400; }
.supply-meta { font-size: 12px; color: var(--muted-foreground); }
.supply-time { font-size: 11px; color: var(--muted-foreground); margin-top: 6px; font-variant-numeric: tabular-nums; }
.supply-card-foot { padding: 12px 18px; box-shadow: inset 0 1px 0 var(--hairline); }

/* ── Empty ── */
.supply-empty { padding: 72px 20px; text-align: center; }

@media (prefers-reduced-motion: reduce) {
  .supply-card { transition: none; }
  .supply-card:hover { transform: none; }
}
</style>
