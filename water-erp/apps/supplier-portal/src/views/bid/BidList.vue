<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBidStore } from '@/stores/bid'
import CountdownTimer from '@/components/CountdownTimer.vue'
import SpPageHero from '@/components/SpPageHero.vue'
import { Gavel, AlertTriangle } from 'lucide-vue-next'
import dayjs from 'dayjs'

const router = useRouter()
const bidStore = useBidStore()
const firstLoad = ref(true)
const search = ref('')
const filterScope = ref('')
const page = ref(1)
const pageSize = ref(10)

const stageMap: Record<string, { label: string; color: string }> = {
  DOWNLOAD: { label: '文件下载', color: '#0891b2' },
  SUBMIT: { label: '加密投递', color: '#dc2626' },
  OPENING: { label: '在线开标', color: '#d97706' },
  EVALUATING: { label: '专家评标', color: '#7c3aed' },
  ARCHIVED: { label: '已归档', color: '#059669' },
}

// 服务端真分页 + 服务端 search 过滤
const loading = computed(() => bidStore.loading)
const error = computed(() => !!bidStore.error)

async function load() { await bidStore.fetchProjects(page.value, pageSize.value, { search: search.value }); firstLoad.value = false }
function retryLoad() { bidStore.error = null; load() }

// 搜索防抖，回到第 1 页
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page.value = 1; load() }, 300) })
function onPageChange(p: number) { page.value = p; load() }

onMounted(load)

function isSubmitStage(stage: string) { return stage === 'SUBMIT' }
</script>

<template>
  <div class="page-container">
    <div v-if="firstLoad && loading" class="skel-wrap">
      <div class="skel-hero"><span class="sp-skel" style="width:120px;height:13px"></span><span class="sp-skel" style="width:220px;height:24px;margin-top:12px"></span><span class="sp-skel" style="width:320px;height:14px;margin-top:10px"></span></div>
      <div class="skel-filter"><span class="sp-skel" style="width:300px;height:36px"></span><span class="sp-skel" style="flex:1;height:36px"></span></div>
      <div v-for="i in 5" :key="i" class="skel-row"><div style="flex:1"><span class="sp-skel" style="width:60%;height:18px"></span><span class="sp-skel" style="width:40%;height:12px;margin-top:10px"></span></div><span class="sp-skel" style="width:120px;height:36px"></span></div>
    </div>
    <div v-else-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else>
      <div v-loading="loading">
    <SpPageHero :icon="Gavel" title="可投标项目" sub="按项目类别快速筛选与进入详情，持续关注最新招标公告。">
      <template #actions />
    </SpPageHero>

    <div class="neu-card bid-filter">
      <el-input v-model="search" placeholder="搜索项目名称或编号" prefix-icon="Search" clearable />
    </div>

    <div v-if="bidStore.projects.length > 0" class="opportunity-list">
      <div v-for="p in bidStore.projects" :key="p.id" class="opportunity-row" :class="{ 'is-submit': isSubmitStage(p.stage) }" @click="router.push(`/bids/${p.id}`)">
        <div class="row-main">
          <div class="row-title-line"><h3>{{ p.name }}</h3>
            <span class="bid-tag" :class="{ 'bid-tag-submit': p.stage === 'SUBMIT' }">{{ p.accessScope === 'INVITED' || p.accessScope === 'DESIGNATED' ? '受邀' : '公告' }}</span>
            <span class="bid-stage" :style="{ '--stage-c': stageMap[p.stage]?.color || '#94a3b8' } as any">{{ stageMap[p.stage]?.label || p.stage }}</span>
          </div>
          <div class="row-meta"><span>{{ p.projectCode }}</span><span>{{ p.procurementMethod }}</span><span>开标 {{ dayjs(p.openTime).format('MM-DD HH:mm') }}</span></div>
        </div>
        <div class="row-deadline" :class="{ 'submit-deadline': isSubmitStage(p.stage) }">
          <small>投递截止</small><strong>{{ dayjs(p.deadline).format('MM-DD HH:mm') }}</strong>
          <CountdownTimer :deadline="p.deadline" />
        </div>
        <el-button type="primary" plain size="small">详情</el-button>
      </div>
    </div>

    <div v-else-if="!loading" class="sp-empty-panel">
      <el-icon :size="32"><Document /></el-icon>
      <p class="sp-empty-text">暂无招标项目</p>
      <p class="sp-empty-desc">{{ search || filterScope ? '没有符合当前筛选条件的项目，试试调整搜索或类别' : '当前没有符合条件的招标项目' }}</p>
    </div>

    <div v-if="bidStore.total > pageSize" class="pagination-wrap">
      <el-pagination
        :current-page="page"
        :page-size="pageSize"
        :total="bidStore.total"
        layout="prev, pager, next"
        background
        @current-change="onPageChange"
      />
    </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Filter plate — neumorphic; layout only (visuals from cgzxui .neu-card / .neu-tab*) */
.bid-filter { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 14px; align-items: center; margin-top: 16px; }
.bid-tabs { overflow-x: auto; }
.bid-tabs .neu-tab span { margin-left: 5px; opacity: .6; font-variant-numeric: tabular-nums; }

/* Opportunity rows — neumorphic plates (no glass / no drift) */
.opportunity-list { display: grid; gap: 12px; margin-top: 18px; }
.opportunity-row {
  display: grid; grid-template-columns: minmax(0,1fr) 180px auto; gap: 18px; align-items: center;
  padding: 16px 20px; border-radius: 16px; cursor: pointer;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
  transition: transform .15s ease, box-shadow .15s ease;
}
.opportunity-row:hover {
  transform: translateY(-1px);
  box-shadow: 7px 7px 16px oklch(0.55 0.03 258 / 0.12), -5px -5px 12px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.7);
}

/* ── SUBMIT 阶段红色高亮 ── */
.opportunity-row.is-submit {
  border-left: 4px solid var(--danger);
  background: linear-gradient(180deg, oklch(0.993 0.012 20), oklch(0.97 0.015 20));
  box-shadow: 5px 5px 12px oklch(0.5 0.06 20 / 0.1), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.opportunity-row.is-submit:hover {
  box-shadow: 7px 7px 16px oklch(0.45 0.08 20 / 0.14), -5px -5px 12px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.opportunity-row.is-submit .row-title-line h3 { color: oklch(0.35 0.08 20); }

/* Scope tag */
.bid-tag {
  display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 4px;
  font-size: 10.5px; font-weight: 700; white-space: nowrap;
  color: var(--brand); background: color-mix(in oklab, var(--brand) 10%, transparent);
}
.bid-tag-submit {
  color: var(--danger); background: color-mix(in oklab, var(--danger) 10%, transparent);
}

.bid-stage {
  display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 6px;
  font-size: 11px; font-weight: 700; white-space: nowrap;
  color: var(--stage-c, var(--muted-foreground));
  background: color-mix(in oklab, var(--stage-c, #94a3b8) 12%, transparent);
}
.row-title-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.row-title-line h3 { margin: 0; color: var(--foreground); font-size: 16px; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 7px; color: var(--muted-foreground); font-size: 12px; }
.row-deadline { padding-left: 18px; border-left: 1px solid var(--hairline); }
.row-deadline small { display: block; color: var(--muted-foreground); font-size: 11px; }
.row-deadline strong { display: block; color: var(--foreground); font-size: 14px; margin-top: 2px; font-variant-numeric: tabular-nums; }

/* SUBMIT 阶段截止时间红色预警 */
.row-deadline.submit-deadline { border-left-color: color-mix(in oklab, var(--danger) 30%, transparent); }
.row-deadline.submit-deadline small { color: var(--danger); font-weight: 700; }
.row-deadline.submit-deadline strong { color: var(--danger); font-weight: 900; }

.pagination-wrap { display: flex; justify-content: center; margin-top: 20px; }

.sp-empty-text { font-size: 15px; font-weight: 700; color: var(--muted-foreground); margin-top: 12px; }
.sp-empty-desc { font-size: 13px; margin-top: 4px; }

/* Skeletons — borderless surface plates (no glass) */
.skel-wrap { display: flex; flex-direction: column; gap: 14px; }
.skel-hero { background: var(--surface); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.skel-filter { display: flex; gap: 14px; padding: 12px 16px; border-radius: 14px; background: var(--surface); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.skel-row { display: flex; align-items: center; gap: 18px; padding: 16px 20px; border-radius: 14px; background: var(--surface); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }

@media (max-width: 900px) {
  .bid-filter { grid-template-columns: 1fr; }
  .opportunity-row { grid-template-columns: 1fr; }
  .row-deadline { padding-left: 0; border-left: 0; }
}
</style>
