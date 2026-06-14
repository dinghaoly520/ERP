<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { catalogApi } from '@/api/catalog'
import ApplicationDialog from './ApplicationDialog.vue'

const loading = ref(true)
const items = ref<any[]>([])
const categoryTree = ref<{ group: string; categories: string[] }[]>([])
const myApplications = ref<any[]>([])
const mySupply = ref<any[]>([])

const selectedGroup = ref<string>('')
const selectedCategory = ref<string>('')
const search = ref('')

const dialogVisible = ref(false)
const dialogMode = ref<'NEW_ITEM' | 'JOIN_EXISTING' | 'UPDATE_QUOTE' | 'edit'>('JOIN_EXISTING')
const dialogItem = ref<any>(null)

async function loadAll() {
  loading.value = true
  try {
    const [tree, apps, supply] = await Promise.all([
      catalogApi.listCategories(),
      catalogApi.listApplications(),
      catalogApi.listSupply(),
    ])
    categoryTree.value = tree as any
    myApplications.value = apps as any
    mySupply.value = supply as any
    await loadItems()
  } finally { loading.value = false }
}

async function loadItems() {
  loading.value = true
  try {
    items.value = await catalogApi.listItems({
      group: selectedGroup.value || undefined,
      category: selectedCategory.value || undefined,
      search: search.value.trim() || undefined,
    }) as any
  } finally { loading.value = false }
}

function onSearch() { loadItems() }
function selectGroup(g: string) {
  selectedGroup.value = selectedGroup.value === g ? '' : g
  selectedCategory.value = ''
  loadItems()
}
function selectCategory(c: string) {
  selectedCategory.value = selectedCategory.value === c ? '' : c
  loadItems()
}
function resetFilters() {
  selectedGroup.value = ''; selectedCategory.value = ''; search.value = ''; loadItems()
}

function itemStatus(item: any) {
  const active = mySupply.value.find(s => s.catalogItemId === item.id)
  const inProgress = myApplications.value.find(
    a => a.catalogItemId === item.id && ['PENDING', 'COUNTERED', 'RETURNED'].includes(a.status),
  )
  return { hasActiveSupply: !!active, inProgress, canApplyJoin: !active && !inProgress, canUpdateQuote: !!active && !inProgress }
}

function openJoin(item: any) { dialogMode.value = 'JOIN_EXISTING'; dialogItem.value = item; dialogVisible.value = true }
function openUpdate(item: any) { dialogMode.value = 'UPDATE_QUOTE'; dialogItem.value = item; dialogVisible.value = true }
function openNewItem() { dialogMode.value = 'NEW_ITEM'; dialogItem.value = null; dialogVisible.value = true }
function onDialogSuccess() { loadAll() }

const statusTagType: Record<string, string> = { '有效': 'success', '价格波动': 'warning', '即将过期': 'warning', '待复核': 'info' }

onMounted(loadAll)
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="sp-page-title-row">
      <div>
        <div class="sp-page-eyebrow">Procurement Catalog</div>
        <h1 class="sp-modern-title">集中采购目录</h1>
        <p class="sp-modern-desc">浏览集团集中采购目录品类，申请加入供货或调整报价。</p>
      </div>
    </div>

    <div class="catalog-layout">
      <!-- Category tree -->
      <aside class="cat-sidebar">
        <div class="cat-sidebar-title">品类导航</div>
        <div class="cat-tree">
          <div v-for="node in categoryTree" :key="node.group" class="cat-node">
            <div class="cat-group" :class="{ active: selectedGroup === node.group }" @click="selectGroup(node.group)">
              <span>{{ node.group }}</span>
              <span class="cat-count">{{ node.categories.length }}</span>
            </div>
            <transition name="cat-sub">
              <div v-if="selectedGroup === node.group" class="cat-sub">
                <div v-for="c in node.categories" :key="c"
                  class="cat-leaf" :class="{ active: selectedCategory === c }"
                  @click.stop="selectCategory(c)">{{ c }}</div>
              </div>
            </transition>
          </div>
        </div>
      </aside>

      <!-- Item list -->
      <section class="cat-main">
        <div class="cat-toolbar">
          <el-input v-model="search" placeholder="搜索物资 / 规格 / 编码" clearable
            style="width: 280px;" :prefix-icon="'Search'" @keyup.enter="onSearch" @clear="onSearch" />
          <el-button type="primary" @click="onSearch">搜索</el-button>
          <el-button @click="resetFilters">重置</el-button>
          <div style="flex: 1;" />
          <el-button type="primary" @click="openNewItem">新增品类申请</el-button>
        </div>

        <div class="cat-filter-bar" v-if="selectedGroup || selectedCategory || search">
          <el-tag closable @close="resetFilters" type="primary" effect="light">
            当前筛选：{{ [selectedGroup, selectedCategory, search].filter(Boolean).join(' / ') }}
          </el-tag>
          <span class="cat-result-count">共 {{ items.length }} 项</span>
        </div>

        <div class="cat-table-wrap">
          <el-table :data="items" stripe style="width: 100%;" :show-overflow-tooltip="true" empty-text="暂无匹配的目录条目">
            <el-table-column label="编码 / 物资" min-width="220">
              <template #default="{ row }">
                <div class="cell-code">{{ row.code }}</div>
                <div class="cell-name">{{ row.name }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="specification" label="规格型号" min-width="180" />
            <el-table-column label="分类" width="120">
              <template #default="{ row }">
                <el-tag size="small" effect="plain">{{ row.category }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="unit" label="单位" width="70" />
            <el-table-column prop="region" label="区域" width="80" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="(statusTagType[row.status] as any) || 'info'">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="供应商" width="90" align="center">
              <template #default="{ row }">
                <span class="cell-count">{{ row.supplierCount }}</span>
                <span class="cell-count-label">家</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right" align="center">
              <template #default="{ row }">
                <template v-if="itemStatus(row).canApplyJoin">
                  <el-button size="small" type="primary" @click="openJoin(row)">申请供货</el-button>
                </template>
                <template v-else-if="itemStatus(row).canUpdateQuote">
                  <el-button size="small" @click="openUpdate(row)">改报价</el-button>
                </template>
                <template v-else-if="itemStatus(row).inProgress">
                  <el-tag size="small" type="warning" effect="plain">审核中</el-tag>
                </template>
                <template v-else>
                  <el-tag size="small" type="info" effect="plain">已准入</el-tag>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>
    </div>

    <ApplicationDialog v-model="dialogVisible" :mode="dialogMode" :item="dialogItem" @success="onDialogSuccess" />
  </div>
</template>

<style scoped>
.catalog-layout { display: flex; gap: 16px; align-items: flex-start; }

.cat-sidebar {
  width: 220px; flex-shrink: 0;
  background: #fff; border: 1px solid var(--sp-border);
  border-radius: var(--sp-radius-md); padding: 14px;
  position: sticky; top: 16px;
  max-height: calc(100vh - 120px); overflow-y: auto;
}
.cat-sidebar-title { font-size: 12px; font-weight: 800; color: var(--sp-gray-500); padding: 4px 8px 10px; letter-spacing: 0.05em; text-transform: uppercase; }
.cat-node { margin-bottom: 2px; }
.cat-group {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-radius: var(--sp-radius-sm);
  font-size: 14px; font-weight: 700; color: var(--sp-gray-700); cursor: pointer;
  transition: all 0.15s;
}
.cat-group:hover { background: var(--sp-gray-50); color: var(--sp-primary); }
.cat-group.active { background: var(--sp-primary); color: #fff; }
.cat-group.active .cat-count { background: rgba(255,255,255,0.25); color: #fff; }
.cat-count { font-size: 11px; font-weight: 700; background: var(--sp-gray-100); color: var(--sp-gray-500); padding: 1px 8px; border-radius: 10px; }
.cat-sub { padding: 4px 0 6px 8px; }
.cat-leaf {
  padding: 7px 14px; font-size: 13px; color: var(--sp-gray-600);
  border-radius: var(--sp-radius-sm); cursor: pointer; transition: all 0.15s;
}
.cat-leaf:hover { background: var(--sp-gray-50); color: var(--sp-primary); }
.cat-leaf.active { color: var(--sp-primary); font-weight: 700; background: var(--sp-primary-lighter); }

.cat-main { flex: 1; min-width: 0; }
.cat-toolbar {
  display: flex; align-items: center; gap: 10px;
  background: #fff; border: 1px solid var(--sp-border);
  border-radius: var(--sp-radius-md); padding: 14px 16px; margin-bottom: 12px;
}
.cat-filter-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding: 0 4px; }
.cat-result-count { font-size: 13px; color: var(--sp-gray-400); }

.cat-table-wrap {
  background: #fff; border: 1px solid var(--sp-border);
  border-radius: var(--sp-radius-md); overflow: hidden;
}
.cell-code { font-family: monospace; font-size: 12px; color: var(--sp-primary); font-weight: 700; }
.cell-name { font-size: 14px; color: var(--sp-gray-900); font-weight: 600; margin-top: 2px; }
.cell-count { font-size: 16px; font-weight: 800; color: var(--sp-gray-900); }
.cell-count-label { font-size: 12px; color: var(--sp-gray-400); margin-left: 2px; }

.cat-sub-enter-active, .cat-sub-leave-active { transition: all 0.2s ease; overflow: hidden; }
.cat-sub-enter-from, .cat-sub-leave-to { opacity: 0; max-height: 0; }
.cat-sub-enter-to, .cat-sub-leave-from { opacity: 1; max-height: 400px; }

@media (max-width: 900px) {
  .catalog-layout { flex-direction: column; }
  .cat-sidebar { width: 100%; position: static; max-height: none; }
}
</style>
