<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import { catalogApi } from '@/api/catalog'
import ApplicationDialog from './ApplicationDialog.vue'

const loading = ref(true)
const applications = ref<any[]>([])
const activeTab = ref('active')

const dialogVisible = ref(false)
const editApp = ref<any>(null)

async function load() {
  loading.value = true
  try {
    applications.value = await catalogApi.listApplications() as any
  } finally {
    loading.value = false
  }
}

const statusMeta: Record<string, { label: string; type: string }> = {
  PENDING: { label: '待审核', type: 'primary' },
  COUNTERED: { label: '议价中', type: 'warning' },
  RETURNED: { label: '已退回', type: 'danger' },
  APPROVED: { label: '已通过', type: 'success' },
  REJECTED: { label: '已拒绝', type: 'danger' },
  WITHDRAWN: { label: '已撤回', type: 'info' },
}
const typeLabel: Record<string, string> = {
  NEW_ITEM: '新增品类', JOIN_EXISTING: '加入供货', UPDATE_QUOTE: '改报价',
}

const filtered = computed(() => {
  if (activeTab.value === 'active') {
    return applications.value.filter(a => ['PENDING', 'COUNTERED', 'RETURNED'].includes(a.status))
  }
  if (activeTab.value === 'done') {
    return applications.value.filter(a => ['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(a.status))
  }
  return applications.value
})

const counts = computed(() => ({
  active: applications.value.filter(a => ['PENDING', 'COUNTERED', 'RETURNED'].includes(a.status)).length,
  done: applications.value.filter(a => ['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(a.status)).length,
}))

function itemTitle(a: any) {
  if (a.type === 'NEW_ITEM') return a.proposedName || '未命名物资'
  return a.catalogItem?.name || '-'
}
function itemSpec(a: any) {
  if (a.type === 'NEW_ITEM') return [a.proposedSpec, a.proposedGroup, a.proposedCategory, a.proposedUnit].filter(Boolean).join(' · ')
  return [a.catalogItem?.code, a.catalogItem?.specification, a.catalogItem?.unit].filter(Boolean).join(' · ')
}

async function withdraw(a: any) {
  await ElMessageBox.confirm('确认撤回该申请？撤回后不可恢复。', '提示', { type: 'warning' })
  await catalogApi.withdraw(a.id)
  ElMessage.success('已撤回')
  load()
}

async function acceptCounter(a: any) {
  await ElMessageBox.confirm(`确认接受议价反报价 ¥${a.counterPrice}？接受后将进入待最终审核。`, '接受议价', { type: 'warning' })
  await catalogApi.acceptCounter(a.id)
  ElMessage.success('已接受议价，等待管理员最终审核')
  load()
}

function edit(a: any) {
  editApp.value = a
  dialogVisible.value = true
}

function onDialogSuccess() { load() }

onMounted(load)
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-header">
      <h1 class="page-title">我的供货申请</h1>
      <p class="page-desc">查看新增品类 / 加入供货 / 改报价申请的审核进度与议价记录</p>
    </div>

    <el-tabs v-model="activeTab" style="margin-bottom: 16px;">
      <el-tab-pane :label="`进行中 (${counts.active})`" name="active" />
      <el-tab-pane :label="`已结束 (${counts.done})`" name="done" />
    </el-tabs>

    <div v-if="filtered.length === 0 && !loading" class="sp-empty" style="padding: 48px;">
      <div class="sp-empty-icon">📋</div>
      <div class="sp-empty-text">暂无申请记录</div>
      <div class="sp-empty-desc">前往「集中采购目录」申请供货或新增品类</div>
    </div>

    <div v-else class="app-list">
      <div v-for="a in filtered" :key="a.id" class="app-card">
        <div class="app-card-head">
          <div class="app-type-tag" :class="a.type">{{ typeLabel[a.type] }}</div>
          <div class="app-title-wrap">
            <div class="app-title">{{ itemTitle(a) }}</div>
            <div class="app-spec">{{ itemSpec(a) }}</div>
          </div>
          <el-tag :type="(statusMeta[a.status]?.type as any) || 'info'" effect="light" size="small">
            {{ statusMeta[a.status]?.label || a.status }}
          </el-tag>
        </div>

        <div class="app-card-body">
          <div class="app-info-grid">
            <div class="app-info-item">
              <span class="app-info-label">报价</span>
              <span class="app-info-value price">¥{{ a.quotedPrice }}<small v-if="a.catalogItem?.unit || a.proposedUnit"> / {{ a.catalogItem?.unit || a.proposedUnit }}</small></span>
            </div>
            <div class="app-info-item" v-if="a.deliveryPeriod">
              <span class="app-info-label">交货周期</span>
              <span class="app-info-value">{{ a.deliveryPeriod }}</span>
            </div>
            <div class="app-info-item" v-if="a.region">
              <span class="app-info-label">区域</span>
              <span class="app-info-value">{{ a.region }}</span>
            </div>
            <div class="app-info-item" v-if="a.minOrder">
              <span class="app-info-label">最小起订</span>
              <span class="app-info-value">{{ a.minOrder }}</span>
            </div>
            <div class="app-info-item">
              <span class="app-info-label">提交时间</span>
              <span class="app-info-value">{{ dayjs(a.createdAt).format('YYYY-MM-DD HH:mm') }}</span>
            </div>
          </div>

          <!-- 议价信息 -->
          <div v-if="a.status === 'COUNTERED' && a.counterPrice" class="app-counter">
            <div class="app-counter-icon">🤝</div>
            <div class="app-counter-body">
              <div class="app-counter-title">管理员议价反报价 <strong>¥{{ a.counterPrice }}</strong></div>
              <div class="app-counter-note" v-if="a.counterNote">{{ a.counterNote }}</div>
            </div>
          </div>

          <!-- 退回/拒绝理由 -->
          <div v-if="(a.status === 'RETURNED' || a.status === 'REJECTED') && a.rejectReason" class="app-reason">
            <el-icon><WarningFilled /></el-icon>
            <span>{{ a.status === 'REJECTED' ? '拒绝理由' : '退回说明' }}：{{ a.rejectReason }}</span>
          </div>

          <!-- 审核备注 -->
          <div v-if="a.reviewerNote" class="app-note">
            <span class="app-note-label">审核备注</span>{{ a.reviewerNote }}
          </div>
        </div>

        <div class="app-card-foot">
          <!-- 进行中操作 -->
          <template v-if="a.status === 'COUNTERED'">
            <el-button type="primary" @click="acceptCounter(a)">接受议价 ¥{{ a.counterPrice }}</el-button>
            <el-button @click="edit(a)">再报价</el-button>
            <el-button text @click="withdraw(a)">撤回</el-button>
          </template>
          <template v-else-if="a.status === 'RETURNED'">
            <el-button type="primary" @click="edit(a)">补正后重新提交</el-button>
            <el-button text @click="withdraw(a)">撤回</el-button>
          </template>
          <template v-else-if="a.status === 'PENDING'">
            <el-button text @click="withdraw(a)">撤回申请</el-button>
          </template>
        </div>
      </div>
    </div>

    <ApplicationDialog v-model="dialogVisible" mode="edit" :application="editApp" @success="onDialogSuccess" />
  </div>
</template>

<style scoped>
.app-list { display: flex; flex-direction: column; gap: 14px; }
.app-card {
  background: #fff;
  border: 1px solid var(--sp-border-light);
  border-radius: var(--sp-radius-md);
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.app-card:hover { border-color: var(--sp-border); box-shadow: 0 2px 12px rgba(10,94,184,0.06); }

.app-card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--sp-border-light);
}
.app-type-tag {
  font-size: 12px;
  font-weight: 800;
  padding: 3px 10px;
  border-radius: 6px;
  flex-shrink: 0;
}
.app-type-tag.NEW_ITEM { background: #ede9fe; color: #6d28d9; }
.app-type-tag.JOIN_EXISTING { background: #dbeafe; color: #1d4ed8; }
.app-type-tag.UPDATE_QUOTE { background: #fef3c7; color: #b45309; }
.app-title-wrap { flex: 1; min-width: 0; }
.app-title { font-size: 15px; font-weight: 800; color: var(--sp-gray-900); }
.app-spec { font-size: 12px; color: var(--sp-gray-400); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.app-card-body { padding: 14px 18px; }
.app-info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px 20px;
}
.app-info-item { display: flex; flex-direction: column; gap: 2px; }
.app-info-label { font-size: 11px; color: var(--sp-gray-400); font-weight: 600; }
.app-info-value { font-size: 14px; color: var(--sp-gray-700); font-weight: 600; }
.app-info-value.price { color: #dc2626; font-size: 16px; font-weight: 800; }
.app-info-value.price small { font-size: 11px; color: var(--sp-gray-400); font-weight: 400; }

.app-counter {
  display: flex;
  gap: 10px;
  margin-top: 14px;
  padding: 12px 14px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: var(--sp-radius-sm);
}
.app-counter-icon { font-size: 20px; }
.app-counter-title { font-size: 14px; color: #92400e; }
.app-counter-title strong { color: #dc2626; font-size: 16px; }
.app-counter-note { font-size: 12px; color: #a16207; margin-top: 3px; }

.app-reason {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 12px;
  padding: 10px 12px;
  background: #fef2f2;
  border-radius: var(--sp-radius-sm);
  font-size: 13px;
  color: #b91c1c;
  line-height: 1.5;
}

.app-note {
  margin-top: 10px;
  font-size: 12px;
  color: var(--sp-gray-500);
  background: var(--sp-gray-50);
  padding: 8px 12px;
  border-radius: var(--sp-radius-sm);
}
.app-note-label { font-weight: 700; color: var(--sp-gray-600); margin-right: 6px; }

.app-card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--sp-border-light);
  background: var(--sp-gray-50);
}
</style>
