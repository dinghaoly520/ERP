<script setup lang="ts">
import { ref, onMounted } from 'vue'
import dayjs from 'dayjs'
import { catalogApi } from '@/api/catalog'
import ApplicationDialog from './ApplicationDialog.vue'

const loading = ref(true); const supply = ref<any[]>([]); const dialogVisible = ref(false); const dialogItem = ref<any>(null)
async function load() { loading.value = true; try { supply.value = await catalogApi.listSupply() as any } finally { loading.value = false } }
function openUpdate(s:any) { dialogItem.value = { id: s.catalogItemId, name: s.catalogItem.name, code: s.catalogItem.code, specification: s.catalogItem.specification, unit: s.catalogItem.unit }; dialogVisible.value = true }
function onDialogSuccess() { load() }
onMounted(load)
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="sp-page-hero-card">
      <div class="sp-page-hero-inner">
        <div class="sp-page-hero-body">
          <div class="sp-page-eyebrow green"><el-icon :size="13"><Box /></el-icon>Supply Relations</div>
          <h1 class="sp-modern-title">我的供货关系</h1>
          <p class="sp-modern-desc">已通过审核的目录品类供货关系与当前报价。</p>
        </div>
      </div>
    </div>

    <div v-if="supply.length===0&&!loading" class="sp-empty-panel"><el-icon :size="32"><Box /></el-icon><p class="sp-empty-text">暂无供货关系</p><p class="sp-empty-desc">前往「集中采购目录」申请供货</p><el-button type="primary" style="margin-top:16px" @click="$router.push('/catalog')">浏览采购目录</el-button></div>

    <div v-else class="supply-grid">
      <div v-for="s in supply" :key="s.id" class="supply-card">
        <div class="supply-card-head"><div><div class="supply-code">{{ s.catalogItem.code }}</div><div class="supply-name">{{ s.catalogItem.name }}</div><div class="supply-spec">{{ s.catalogItem.specification }}</div></div><span class="sp-status" :class="s.status==='ACTIVE'?'approved':'disabled'">{{ s.status==='ACTIVE'?'供货中':'已停用' }}</span></div>
        <div class="supply-card-body"><div class="supply-price"><span class="supply-price-label">当前报价</span><span class="supply-price-value">&yen;{{ Number(s.quotedPrice).toLocaleString() }}<small> / {{ s.catalogItem.unit }}</small></span></div><div class="supply-meta"><span v-if="s.deliveryPeriod">交期 {{ s.deliveryPeriod }}</span><span v-if="s.region"> &middot; {{ s.region }}</span><span v-if="s.minOrder"> &middot; 起订 {{ s.minOrder }}</span></div><div class="supply-time">更新于 {{ dayjs(s.updatedAt).format('YYYY-MM-DD') }}</div></div>
        <div class="supply-card-foot"><el-button v-if="s.status==='ACTIVE'" size="small" type="primary" plain @click="openUpdate(s)">申请改报价</el-button></div>
      </div>
    </div>
    <ApplicationDialog v-model="dialogVisible" mode="UPDATE_QUOTE" :item="dialogItem" @success="onDialogSuccess" />
  </div>
</template>

<style scoped>
.supply-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.supply-card { background: #fff; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); overflow: hidden; transition: border-color 0.2s; }
.supply-card:hover { border-color: var(--sp-primary); }
.supply-card-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--sp-border-light); }
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
.supply-card-foot { padding: 12px 18px; border-top: 1px solid var(--sp-border-light); background: var(--sp-gray-50); }
.sp-empty-panel { background: #fff; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); padding: 64px 20px; text-align: center; color: var(--sp-gray-400); }
.sp-empty-text { font-size: 15px; font-weight: 700; color: var(--sp-gray-500); margin-top: 12px; }
.sp-empty-desc { font-size: 13px; margin-top: 4px; }
</style>
