<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBidStore } from '@/stores/bid'
import { bidApi } from '@/api/bid'
import { ElMessage } from 'element-plus'
import CountdownTimer from '@/components/CountdownTimer.vue'
import SpPageHero from '@/components/SpPageHero.vue'
import { Gavel, AlertTriangle, ClipboardList } from 'lucide-vue-next'
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
  SUBMIT: { label: '加密投递', color: '#c00a6b' },
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
function isDeadlineClose(deadline: string): boolean { if (!deadline) return false; const diff = (new Date(deadline).getTime() - Date.now()) / 86400000; return diff > 0 && diff <= 3 }
function rowClass(p: any) { if (p.stage === 'SUBMIT') return 'is-submit'; if (p.stage === 'DOWNLOAD' && isDeadlineClose(p.deadline)) return 'is-dl-close'; return '' }

// 谈判采购文件下载：校验获取窗口 + 权限由后端把关，前端拿到文件列表后逐个打开
const negoLoading = ref<string>('')
async function downloadNegotiationFiles(p: any, e: Event) {
  e.stopPropagation()
  negoLoading.value = p.id
  try {
    const res = await bidApi.getNegotiationFiles(p.id) as any
    if (!res.files || res.files.length === 0) { ElMessage.warning('该项目暂无可下载的采购文件'); return }
    if (res.downloadMode === 'encrypted' && res.password) {
      ElMessage.info(`加密文件，访问密码：${res.password}`)
    } else if (res.downloadMode === 'paid' && res.paidAmount) {
      ElMessage.info(`付费文件，金额：¥${res.paidAmount}`)
    }
    res.files.forEach((f: any) => window.open(f.url, '_blank', 'noopener'))
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || err?.message || '文件下载失败')
  } finally { negoLoading.value = '' }
}
// 获取窗口状态：未开始 / 进行中 / 已结束
function negoWindowState(p: any): 'before' | 'open' | 'after' {
  const n = p.negotiation; if (!n) return 'before'
  const now = Date.now()
  const s = new Date(n.acquireStartTime).getTime()
  const e = new Date(n.acquireEndTime).getTime()
  if (!isNaN(s) && now < s) return 'before'
  if (!isNaN(e) && now > e) return 'after'
  return 'open'
}
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
      <template #actions>
        <span class="page-hero__stat page-hero__stat--info">共 {{ bidStore.total }} 个</span>
      </template>
    </SpPageHero>

    <div class="bid-toolbar">
      <el-input v-model="search" placeholder="搜索项目名称或编号" prefix-icon="Search" clearable class="bid-search" />
    </div>

    <div v-if="bidStore.projects.length > 0" class="opportunity-list">
      <div v-for="p in bidStore.projects" :key="p.id" class="opportunity-row" :class="rowClass(p)" @click="router.push(`/bids/${p.id}?from=list`)">
        <div class="row-main">
          <div class="row-title-line"><h3>{{ p.name }}</h3>
            <span class="bid-tag" :class="{ 'bid-tag-submit': p.stage === 'SUBMIT' }">{{ p.accessScope === 'INVITED' || p.accessScope === 'DESIGNATED' ? '受邀' : '公告' }}</span>
            <span class="bid-stage" :style="{ '--stage-c': stageMap[p.stage]?.color || '#94a3b8' } as any">{{ stageMap[p.stage]?.label || p.stage }}</span>
          </div>
          <div class="row-meta"><span class="meta-code">{{ p.projectCode }}</span><span class="meta-sep">·</span><span>{{ p.procurementMethod }}</span><span class="meta-sep">·</span><span>开标 {{ dayjs(p.openTime).format('MM-DD HH:mm') }}</span></div>
          <!-- 谈判配置信息：采购文件获取窗口 + 开标时间 + 文件下载 -->
          <div v-if="p.negotiation" class="row-nego">
            <span class="nego-item"><span class="nego-label">采购文件获取</span><span class="nego-val">{{ dayjs(p.negotiation.acquireStartTime).format('MM-DD HH:mm') }} ~ {{ dayjs(p.negotiation.acquireEndTime).format('MM-DD HH:mm') }}</span></span>
            <span class="nego-item"><span class="nego-label">开标时间</span><span class="nego-val">{{ dayjs(p.negotiation.bidOpeningTime).format('YYYY-MM-DD HH:mm') }}</span></span>
            <button
              class="neu-btn-xs nego-dl"
              :class="{ 'is-open': negoWindowState(p) === 'open', 'is-before': negoWindowState(p) === 'before' }"
              :disabled="negoWindowState(p) !== 'open' || negoLoading === p.id"
              @click="downloadNegotiationFiles(p, $event)"
            >
              <span v-if="negoLoading === p.id">下载中…</span>
              <span v-else-if="negoWindowState(p) === 'before'">未开放（{{ p.negotiation.fileCount }} 个文件）</span>
              <span v-else-if="negoWindowState(p) === 'after'">已截止</span>
              <span v-else>下载采购文件（{{ p.negotiation.fileCount }}）</span>
            </button>
          </div>
        </div>
        <div class="row-deadline" :class="{ 'submit-deadline': isSubmitStage(p.stage) }">
          <small>投递截止</small><strong>{{ dayjs(p.deadline).format('MM-DD HH:mm') }}</strong>
          <CountdownTimer :deadline="p.deadline" />
        </div>
        <button class="neu-btn-xs row-action">详情<el-icon style="font-size:12px;margin-left:2px"><ArrowRight /></el-icon></button>
      </div>
    </div>

    <div v-else-if="!loading" class="sp-empty-panel">
      <div class="sp-empty-icon"><ClipboardList :size="22" :stroke-width="1.75" /></div>
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
/* Toolbar — 独立浮起卡片（标题卡下方、列表上方） */
.bid-toolbar {
  display: flex; align-items: center; gap: 14px;
  margin-top: 16px; padding: 12px 16px; border-radius: 14px;
  background: linear-gradient(105deg, oklch(1 0 0 / 0.94) 0%, oklch(0.99 0.003 258 / 0.62) 35%, oklch(1 0 0 / 0.14) 70%);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 10px oklch(0.55 0.03 258 / 0.1), -3px -3px 8px oklch(1 0 0 / 0.9);
}
.bid-toolbar .bid-search { max-width: 380px; }

/* Opportunity rows — cgzxui neu-card（105deg 渐变 + 标准方向性双影），状态用左色轨标注（背景保持统一） */
.opportunity-list { display: grid; gap: 12px; margin-top: 18px; }
.opportunity-row {
  display: grid; grid-template-columns: minmax(0,1fr) 180px auto; gap: 18px; align-items: center;
  padding: 16px 20px; border-radius: 16px; cursor: pointer; border-left: 3px solid transparent;
  background: linear-gradient(105deg, oklch(1 0 0 / 0.94) 0%, oklch(0.99 0.003 258 / 0.62) 35%, oklch(1 0 0 / 0.14) 70%);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 10px oklch(0.55 0.03 258 / 0.1), -3px -3px 8px oklch(1 0 0 / 0.9);
  transition: transform .25s cubic-bezier(0.16,1,0.3,1), box-shadow .25s ease, border-color .2s ease;
}
.opportunity-row:hover {
  transform: translateY(-2px);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.85), 4px 4px 12px oklch(0.45 0.08 258 / 0.12), -2px -2px 8px oklch(1 0 0 / 0.9);
}

/* SUBMIT 阶段 — 洋红色轨 + 标题强调 */
.opportunity-row.is-submit { border-left-color: oklch(0.58 0.22 340); }
.opportunity-row.is-submit .row-title-line h3 { color: oklch(0.42 0.15 340); }

/* DOWNLOAD 截止临近（≤3天）— 粉色色轨 */
.opportunity-row.is-dl-close { border-left-color: oklch(0.72 0.16 350); }

/* 详情按钮 — 固定宽度对齐 */
.row-action { min-width: 78px; }

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
.row-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 7px; color: var(--muted-foreground); font-size: 12px; }
.row-meta .meta-code { font-family: 'SF Mono','JetBrains Mono',monospace; font-size: 11px; color: var(--brand); font-weight: 700; }
.row-meta .meta-sep { color: var(--hairline); font-size: 11px; }

/* 谈判配置信息行 */
.row-nego { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 12px; padding: 10px 14px; border-radius: 10px; background: oklch(0.97 0.01 258); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6); }
.nego-item { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; }
.nego-label { color: var(--muted-foreground); font-weight: 700; }
.nego-val { color: var(--foreground); font-variant-numeric: tabular-nums; font-weight: 600; }
.nego-dl { margin-left: auto; }
.nego-dl.is-open { color: var(--brand); font-weight: 700; }
.nego-dl.is-before { opacity: 0.6; cursor: not-allowed; }
.nego-dl:disabled { cursor: not-allowed; }
.row-deadline { padding-left: 18px; border-left: 1px solid var(--hairline); }
.row-deadline small { display: block; color: var(--muted-foreground); font-size: 11px; }
.row-deadline strong { display: block; color: var(--foreground); font-size: 14px; margin-top: 2px; font-variant-numeric: tabular-nums; }

/* Deadline highlight: SUBMIT = magenta, DOWNLOAD close = pink */
.row-deadline.submit-deadline { border-left-color: oklch(0.58 0.22 340 / 0.4); }
.row-deadline.submit-deadline small { color: oklch(0.58 0.22 340); font-weight: 700; }
.row-deadline.submit-deadline strong { color: oklch(0.58 0.22 340); font-weight: 900; }
.opportunity-row.is-dl-close .row-deadline { border-left-color: oklch(0.72 0.16 350 / 0.4); }
.opportunity-row.is-dl-close .row-deadline small { color: oklch(0.68 0.14 350); font-weight: 700; }
.opportunity-row.is-dl-close .row-deadline strong { color: oklch(0.65 0.12 350); font-weight: 900; }

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
