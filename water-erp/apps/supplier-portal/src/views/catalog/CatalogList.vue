<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { catalogApi } from '@/api/catalog'
import ApplicationDialog from './ApplicationDialog.vue'
import SpPageHero from '@/components/SpPageHero.vue'
import { ShoppingBag, AlertTriangle } from 'lucide-vue-next'

const loading = ref(true); const firstLoad = ref(true); const error = ref(false); const items = ref<any[]>([]); const categoryTree = ref<{group:string;categories:string[]}[]>([]); const myApplications = ref<any[]>([]); const mySupply = ref<any[]>([])
const selectedGroup = ref<string>('工程材料'); const selectedCategory = ref<string>(''); const search = ref('')
const dialogVisible = ref(false); const dialogMode = ref<'NEW_ITEM'|'JOIN_EXISTING'|'UPDATE_QUOTE'|'edit'>('JOIN_EXISTING'); const dialogItem = ref<any>(null)
const tableLoading = ref(false)

async function loadAll() { loading.value = true; error.value = false; try { const [tree,apps,supply] = await Promise.all([catalogApi.listCategories(),catalogApi.listApplications(),catalogApi.listSupply()]); categoryTree.value = tree as any; myApplications.value = apps as any; mySupply.value = supply as any; await loadItems() } catch { error.value = true } finally { loading.value = false; firstLoad.value = false } }
async function loadItems() { tableLoading.value = true; try { items.value = await catalogApi.listItems({group:selectedGroup.value||undefined,category:selectedCategory.value||undefined,search:search.value.trim()||undefined}) as any } catch { error.value = true } finally { tableLoading.value = false } }
function retryLoad() { loadAll() }
function onSearch() { loadItems() }
function selectGroup(g:string) { selectedGroup.value = selectedGroup.value===g?'':g; selectedCategory.value=''; loadItems() }
function selectCategory(c:string) { selectedCategory.value = selectedCategory.value===c?'':c; loadItems() }
function resetFilters() { selectedGroup.value=''; selectedCategory.value=''; search.value=''; loadItems() }

function itemStatus(item:any) { const active = mySupply.value.find(s=>s.catalogItemId===item.id); const inProgress = myApplications.value.find(a=>a.catalogItemId===item.id&&['PENDING','COUNTERED','RETURNED'].includes(a.status)); return {hasActiveSupply:!!active,inProgress,canApplyJoin:!active&&!inProgress,canUpdateQuote:!!active&&!inProgress} }
function openJoin(item:any) { dialogMode.value='JOIN_EXISTING'; dialogItem.value=item; dialogVisible.value=true }
function openUpdate(item:any) { dialogMode.value='UPDATE_QUOTE'; dialogItem.value=item; dialogVisible.value=true }
function openNewItem() { dialogMode.value='NEW_ITEM'; dialogItem.value=null; dialogVisible.value=true }
function onDialogSuccess() { loadAll() }
const statusTagType: Record<string,string> = {'有效':'success','价格波动':'warning','即将过期':'warning','待复核':'info'}
onMounted(loadAll)
</script>

<template>
  <div class="page-container">
    <div v-if="loading && firstLoad" class="skel-wrap">
      <div class="skel-hero"><span class="sp-skel" style="width:120px;height:13px"></span><span class="sp-skel" style="width:240px;height:24px;margin-top:12px"></span><span class="sp-skel" style="width:360px;height:14px;margin-top:10px"></span></div>
      <div class="skel-cat">
        <div class="skel-sidebar"><span v-for="i in 6" :key="i" class="sp-skel" style="width:100%;height:32px;margin-bottom:4px"></span></div>
        <div class="skel-main"><span class="sp-skel" style="width:100%;height:36px;margin-bottom:12px"></span><span v-for="i in 6" :key="i" class="sp-skel" style="width:100%;height:40px;margin-bottom:4px"></span></div>
      </div>
    </div>
    <div v-else-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else>
      <div v-loading="loading">
    <SpPageHero :icon="ShoppingBag" title="集中采购目录" sub="浏览集团集中采购目录品类，申请加入供货或调整报价。">
      <template #actions>
        <div class="page-hero__stat"><strong>{{ items.length }}</strong><span>目录条目</span></div>
        <div class="page-hero__stat"><strong>{{ categoryTree.length }}</strong><span>品类大组</span></div>
      </template>
    </SpPageHero>

    <div class="catalog-layout">
      <aside class="cat-sidebar">
        <div class="cat-sidebar-title">品类导航</div>
        <div class="cat-tree">
          <div v-for="node in categoryTree" :key="node.group" class="cat-node">
            <div class="cat-group" :class="{active:selectedGroup===node.group}" @click="selectGroup(node.group)"><span>{{ node.group }}</span><span class="cat-count">{{ node.itemCount }}</span></div>
            <transition name="cat-sub"><div v-if="selectedGroup===node.group" class="cat-sub"><div v-for="c in node.categories" :key="c" class="cat-leaf" :class="{active:selectedCategory===c}" @click.stop="selectCategory(c)">{{ c }}</div></div></transition>
          </div>
        </div>
      </aside>

      <section class="cat-main">
        <div class="cat-toolbar neu-card">
          <el-input v-model="search" placeholder="搜索物资 / 规格 / 编码" clearable style="width:280px" :prefix-icon="'Search'" @keyup.enter="onSearch" @clear="onSearch" />
          <el-button type="primary" @click="onSearch">搜索</el-button><el-button @click="resetFilters">重置</el-button>
          <div style="flex:1" />
          <el-button type="primary" @click="openNewItem">新增品类申请</el-button>
        </div>

        <div class="cat-filter-bar">
          <span class="cat-filter-label">当前筛选：</span>
          <span class="cat-filter-body">
            <Transition name="filter-fade" mode="out-in">
              <el-tag v-if="selectedGroup||selectedCategory||search" key="tag" closable @close="resetFilters" type="primary" effect="light">{{ [selectedGroup,selectedCategory,search].filter(Boolean).join(' / ') }}</el-tag>
              <span v-else key="none" class="cat-filter-none">全部品类</span>
            </Transition>
          </span>
          <span class="cat-result-count">共 {{ items.length }} 项</span>
        </div>

        <div class="neu-table-card cat-table-shell">
          <el-table :data="items" style="width:100%" :show-overflow-tooltip="true" empty-text="暂无匹配的目录条目">
            <el-table-column label="编码 / 物资" min-width="220"><template #default="{row}"><div class="cell-code">{{ row.code }}</div><div class="cell-name">{{ row.name }}</div></template></el-table-column>
            <el-table-column prop="specification" label="规格型号" min-width="180" />
            <el-table-column label="分类" width="120"><template #default="{row}"><el-tag size="small" effect="plain">{{ row.category }}</el-tag></template></el-table-column>
            <el-table-column prop="unit" label="单位" width="70" />
            <el-table-column prop="region" label="区域" width="80" />
            <el-table-column label="状态" width="90"><template #default="{row}"><el-tag size="small" :type="(statusTagType[row.status] as any)||'info'">{{ row.status }}</el-tag></template></el-table-column>
            <el-table-column label="供应商" width="90" align="center"><template #default="{row}"><span class="cell-count">{{ row.supplierCount }}</span><span class="cell-count-label">家</span></template></el-table-column>
            <el-table-column label="操作" width="130" fixed="right" align="center">
              <template #default="{row}">
                <template v-if="itemStatus(row).canApplyJoin"><el-button size="small" type="primary" @click="openJoin(row)">申请供货</el-button></template>
                <template v-else-if="itemStatus(row).canUpdateQuote"><el-button size="small" @click="openUpdate(row)">改报价</el-button></template>
                <template v-else-if="itemStatus(row).inProgress"><el-tag size="small" type="warning" effect="plain">审核中</el-tag></template>
                <template v-else><el-tag size="small" type="info" effect="plain">已准入</el-tag></template>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>
    </div>
    <ApplicationDialog v-model="dialogVisible" :mode="dialogMode" :item="dialogItem" @success="onDialogSuccess" />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ═══════════════ Layout ═══════════════ */
.catalog-layout { display: flex; gap: 16px; align-items: flex-start; margin-top: 16px; }

/* ── Category sidebar — neumorphic raised plate (no glass / no drift) ── */
.cat-sidebar {
  width: 220px; flex-shrink: 0; border-radius: 16px; padding: 14px;
  position: sticky; top: 16px; max-height: calc(100vh - 120px);
  overflow-y: scroll; scrollbar-gutter: stable;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.cat-sidebar-title { font-size: 12px; font-weight: 800; color: var(--muted-foreground); padding: 4px 8px 10px; letter-spacing: 0.05em; text-transform: uppercase; }
.cat-node { margin-bottom: 2px; }
.cat-group {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-radius: 10px;
  font-size: 14px; font-weight: 700; color: var(--foreground);
  cursor: pointer; transition: all 0.18s ease;
}
.cat-group:hover { background: oklch(1 0 0 / 0.6); color: var(--brand);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 1px 3px oklch(0.55 0.03 258 / 0.1), -1px -1px 2px oklch(1 0 0 / 0.85); }
.cat-group.active {
  color: #fff; background: linear-gradient(90deg, var(--brand), var(--brand-deep));
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.25), 2px 2px 6px oklch(0.4 0.1 258 / 0.28);
}
.cat-count {
  font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 10px;
  color: var(--muted-foreground); background: oklch(0.55 0.03 258 / 0.08);
  font-variant-numeric: tabular-nums;
}
.cat-group.active .cat-count { background: oklch(1 0 0 / 0.22); color: #fff; }
.cat-sub { padding: 4px 0 6px 8px; }
.cat-leaf { padding: 7px 14px; font-size: 13px; color: var(--muted-foreground); border-radius: 8px; cursor: pointer; transition: all 0.15s ease; }
.cat-leaf:hover { background: oklch(1 0 0 / 0.6); color: var(--brand); }
.cat-leaf.active { color: var(--brand); font-weight: 700; background: color-mix(in oklab, var(--brand) 10%, transparent); }

.cat-main { flex: 1; min-width: 0; }

/* ── Toolbar — layout only (visuals from cgzxui .neu-card) ── */
.cat-toolbar { flex-direction: row; align-items: center; gap: 10px; padding: 12px 16px; margin-bottom: 12px; }

.cat-filter-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding: 0 4px; min-height: 28px; }
.cat-filter-label { font-size: 12px; font-weight: 600; color: var(--muted-foreground); flex-shrink: 0; }
.cat-filter-body { position: relative; display: inline-flex; align-items: center; min-width: 80px; }
.cat-filter-none { font-size: 12px; font-weight: 600; color: var(--muted-foreground); }
.cat-result-count { font-size: 13px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.filter-fade-enter-active,
.filter-fade-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; position: absolute; }
.filter-fade-enter-from { opacity: 0; transform: translateY(2px); }
.filter-fade-leave-to   { opacity: 0; transform: translateY(-2px); }

/* ── Table shell — cgzxui .neu-table-card handles the plate; keep fixed-column radius clipped ── */
.cat-table-shell { overflow: hidden; }

.cell-code { font-family: 'SF Mono', 'JetBrains Mono', monospace; font-size: 12px; color: var(--brand); font-weight: 700; }
.cell-name { font-size: 14px; color: var(--foreground); font-weight: 600; margin-top: 2px; }
.cell-count { font-size: 16px; font-weight: 800; color: var(--foreground); font-variant-numeric: tabular-nums; }
.cell-count-label { font-size: 12px; color: var(--muted-foreground); margin-left: 2px; }

.cat-sub-enter-active,.cat-sub-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.cat-sub-enter-from,.cat-sub-leave-to { opacity: 0; transform: translateY(-6px); }
.cat-sub-enter-to,.cat-sub-leave-from { opacity: 1; transform: translateY(0); }

/* ── Skeletons — borderless surface plates (no glass) ── */
.skel-wrap { display: flex; flex-direction: column; gap: 14px; }
.skel-hero { background: var(--surface); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.skel-cat { display: flex; gap: 16px; height: 340px; }
.skel-sidebar { width: 220px; background: var(--surface); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 4px; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.skel-main { flex: 1; background: var(--surface); border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }

@media (prefers-reduced-motion: reduce) {
  .cat-group, .cat-leaf { transition: none; }
}
@media (max-width:900px) { .catalog-layout { flex-direction: column; } .cat-sidebar { width: 100%; position: static; max-height: none; } }
</style>
