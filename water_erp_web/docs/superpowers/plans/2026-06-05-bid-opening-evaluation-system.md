# 开评标系统板块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a front-end demo-grade electronic bid opening and evaluation system covering static portal introduction plus Vue role workbenches for supplier submission, bid opening, expert evaluation, supervision, and archiving.

**Architecture:** Keep the public static site as an introduction/entry layer and make the Vue app the operational demo layer. Add a focused Pinia bid store as the single mock data source, route-based Vue pages for each role, and small static portal enhancements that deep-link into the Vue app.

**Tech Stack:** Static HTML/CSS/JS, Vue 3 Composition API, Vue Router, Pinia, Element Plus, Vite.

---

## File Structure

- Create `supplier-vue/src/stores/bid.js`: central mock state, derived statistics, status maps, and simple state-changing demo actions.
- Replace `supplier-vue/src/views/bid/Index.vue`: dashboard for overall bid opening/evaluation lifecycle.
- Create `supplier-vue/src/views/bid/Submit.vue`: supplier-side plugin authorization, controlled tender download, encrypted bid submission, receipt.
- Create `supplier-vue/src/views/bid/Open.vue`: online bid opening hall, countdown/status cards, decryption table, opening records, exceptions.
- Create `supplier-vue/src/views/bid/Evaluate.vue`: expert workspace with entry confirmations, bidder/file summary, score sheet, clarification, report confirmation.
- Create `supplier-vue/src/views/bid/Supervise.vue`: read-only supervision timeline, logs, exceptions.
- Create `supplier-vue/src/views/bid/Archive.vue`: archive completeness, archive item list, tamper-proof digest.
- Modify `supplier-vue/src/router/index.js`: register bid child routes under `/bid`.
- Modify `supplier-vue/src/views/Layout.vue`: update bid sidebar children to match registered routes.
- Modify `bid.html`: strengthen portal copy and add role-system entry sections.
- Modify `css/bid.css`: add styles for new portal sections.
- Modify `js/bid.js`: make “进入系统” role buttons navigate to Vue routes instead of alert-only demo.
- Modify `index.html`: add or adjust homepage entry to point users to `bid.html` and Vue bid system.

---

### Task 1: Add Central Bid Store

**Files:**
- Create: `supplier-vue/src/stores/bid.js`

- [ ] **Step 1: Create the store file**

Write `supplier-vue/src/stores/bid.js` with this structure:

```js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useBidStore = defineStore('bid', () => {
  const statusColorMap = {
    pending: '#f5a623',
    running: '#064ea2',
    success: '#11a874',
    danger: '#e74c3c',
    muted: '#8a9aaa'
  }

  const stageMap = {
    download: { label: '文件下载', color: statusColorMap.running },
    submit: { label: '加密投递', color: statusColorMap.running },
    opening: { label: '在线开标', color: statusColorMap.pending },
    evaluating: { label: '专家评标', color: statusColorMap.running },
    archived: { label: '资料归档', color: statusColorMap.success }
  }

  const projects = ref([
    {
      id: 'BID-2026-0518',
      name: '2026年度水利工程物资集中采购',
      method: '公开招标',
      openTime: '2026-06-08 09:30',
      deadline: '2026-06-08 09:00',
      stage: 'opening',
      risk: '解密窗口进行中',
      bidderCount: 5,
      encryptedCount: 5,
      archiveRate: 86
    },
    {
      id: 'BID-2026-0522',
      name: '智慧水务信息化系统建设项目',
      method: '综合评分法',
      openTime: '2026-06-10 14:30',
      deadline: '2026-06-10 14:00',
      stage: 'submit',
      risk: '1家插件版本过旧',
      bidderCount: 4,
      encryptedCount: 3,
      archiveRate: 42
    },
    {
      id: 'BID-2026-0526',
      name: '升钟水库灌区续建配套工程',
      method: '经评审最低价法',
      openTime: '2026-06-05 10:00',
      deadline: '2026-06-05 09:30',
      stage: 'archived',
      risk: '资料已归档',
      bidderCount: 6,
      encryptedCount: 6,
      archiveRate: 100
    }
  ])

  const securityComponent = ref({
    companyName: '四川川水建设工程有限公司',
    companyCode: '91510000MA62K5XX0X',
    licenseNo: 'SCWF-SEC-2026-00018',
    pluginVersion: 'v3.6.2',
    authorizedDevices: 4,
    maxDevices: 5,
    certificateStatus: '有效',
    certificateExpire: '2027-05-31'
  })

  const suppliers = ref([
    { id: 'SUP-001', name: '四川川水建设工程有限公司', download: '已下载', submit: '已提交', encrypt: '密文已校验', receipt: 'TB-20260608-001', decrypt: 'success', confirm: '已确认' },
    { id: 'SUP-002', name: '成都华西物资供应有限公司', download: '已下载', submit: '已提交', encrypt: '密文已校验', receipt: 'TB-20260608-002', decrypt: 'success', confirm: '已确认' },
    { id: 'SUP-003', name: '四川智水科技有限公司', download: '已下载', submit: '已提交', encrypt: '密文已校验', receipt: 'TB-20260608-003', decrypt: 'running', confirm: '待确认' },
    { id: 'SUP-004', name: '四川宏达水利工程有限公司', download: '已下载', submit: '已提交', encrypt: '密文已校验', receipt: 'TB-20260608-004', decrypt: 'danger', confirm: '异常待处理' },
    { id: 'SUP-005', name: '成都诚信建材有限公司', download: '已下载', submit: '已提交', encrypt: '密文已校验', receipt: 'TB-20260608-005', decrypt: 'pending', confirm: '待确认' }
  ])

  const openingSession = ref({
    projectId: 'BID-2026-0518',
    host: '采购中心-李主任',
    supervisor: '纪检监督-周老师',
    status: '解密中',
    decryptWindow: '09:30 - 10:00',
    remaining: '00:18:42'
  })

  const openingRecords = ref([
    { supplier: '四川川水建设工程有限公司', amount: '1260.00万元', period: '120日历天', quality: '合格', bond: '已缴纳', decrypt: '解密成功', confirm: '已确认' },
    { supplier: '成都华西物资供应有限公司', amount: '1288.50万元', period: '118日历天', quality: '合格', bond: '已缴纳', decrypt: '解密成功', confirm: '已确认' },
    { supplier: '四川智水科技有限公司', amount: '1320.00万元', period: '115日历天', quality: '合格', bond: '电子保函', decrypt: '解密中', confirm: '待确认' }
  ])

  const experts = ref([
    { id: 'EXP-001', name: '王建国', major: '水利工程', signed: true, avoidance: true, progress: 92, score: 91.6 },
    { id: 'EXP-002', name: '刘晓梅', major: '机电设备', signed: true, avoidance: true, progress: 86, score: 89.4 },
    { id: 'EXP-003', name: '陈志强', major: '造价咨询', signed: true, avoidance: true, progress: 78, score: 88.1 }
  ])

  const scoreItems = ref([
    { id: 'qualification', name: '资格性审查', max: 0, result: '通过', score: 0, reason: '营业执照、资质证书、授权文件均符合要求。' },
    { id: 'responsive', name: '符合性审查', max: 0, result: '通过', score: 0, reason: '投标文件响应招标文件实质性条款。' },
    { id: 'business', name: '商务评分', max: 20, result: '已评分', score: 18, reason: '企业业绩、履约能力较好。' },
    { id: 'technical', name: '技术评分', max: 50, result: '已评分', score: 43, reason: '技术方案完整，施工组织安排较合理。' },
    { id: 'price', name: '价格评分', max: 30, result: '系统计算', score: 28.6, reason: '报价处于有效评审区间。' }
  ])

  const clarifications = ref([
    { id: 'CL-001', question: '请说明主要设备交货计划与施工节点衔接安排。', issuer: '王建国', supplier: '四川智水科技有限公司', status: '已回复', reply: '已补充交货计划说明，不改变投标实质内容。' }
  ])

  const supervisionLogs = ref([
    { time: '2026-06-08 08:55', role: '系统', target: '投标文件', action: '投标截止自动锁定', result: '成功', risk: '无' },
    { time: '2026-06-08 09:30', role: '开标主持人', target: '在线开标大厅', action: '启动开标', result: '成功', risk: '无' },
    { time: '2026-06-08 09:42', role: '供应商', target: '投标文件解密', action: '证书校验失败', result: '异常', risk: '投标人原因待确认' },
    { time: '2026-06-08 10:05', role: '专家', target: '技术评分', action: '提交评分', result: '成功', risk: '存在偏差提醒' }
  ])

  const archiveItems = ref([
    { name: '招标文件定稿', owner: '招标管理端', status: '已归档', hash: 'SHA256-A19C8E', time: '2026-06-08 08:30' },
    { name: '招标文件下载日志', owner: '供应商端', status: '已归档', hash: 'SHA256-B72F31', time: '2026-06-08 08:31' },
    { name: '投标文件提交回执', owner: '供应商端', status: '已归档', hash: 'SHA256-C08A92', time: '2026-06-08 09:00' },
    { name: '在线开标记录', owner: '开标主持端', status: '已归档', hash: 'SHA256-D55E02', time: '2026-06-08 10:05' },
    { name: '专家评分汇总表', owner: '专家评标端', status: '待归档', hash: '待生成', time: '-' },
    { name: '评标报告', owner: '专家评标端', status: '待确认', hash: '待生成', time: '-' },
    { name: '结果公示截图', owner: '归档端', status: '未开始', hash: '待生成', time: '-' }
  ])

  const dashboardStats = computed(() => {
    const decryptSuccess = suppliers.value.filter(item => item.decrypt === 'success').length
    const expertProgress = Math.round(experts.value.reduce((sum, item) => sum + item.progress, 0) / experts.value.length)
    const archived = archiveItems.value.filter(item => item.status === '已归档').length
    return [
      { label: '待开标项目', value: projects.value.filter(item => item.stage !== 'archived').length, unit: '个', color: 'blue' },
      { label: '密文投递数', value: suppliers.value.length, unit: '份', color: 'green' },
      { label: '解密成功率', value: Math.round((decryptSuccess / suppliers.value.length) * 100), unit: '%', color: 'orange' },
      { label: '评审完成率', value: expertProgress, unit: '%', color: 'blue' },
      { label: '归档完整率', value: Math.round((archived / archiveItems.value.length) * 100), unit: '%', color: 'green' }
    ]
  })

  const totalScore = computed(() => scoreItems.value.reduce((sum, item) => sum + Number(item.score || 0), 0))

  const markSubmitted = () => {
    suppliers.value[0].submit = '已提交'
    suppliers.value[0].encrypt = '密文已校验'
    suppliers.value[0].receipt = 'TB-20260608-001'
  }

  const markArchiveComplete = () => {
    archiveItems.value.forEach((item, index) => {
      item.status = '已归档'
      item.hash = item.hash === '待生成' ? `SHA256-${String(index + 11).padStart(2, '0')}F6A9` : item.hash
      item.time = item.time === '-' ? '2026-06-08 11:30' : item.time
    })
  }

  return {
    statusColorMap,
    stageMap,
    projects,
    securityComponent,
    suppliers,
    openingSession,
    openingRecords,
    experts,
    scoreItems,
    clarifications,
    supervisionLogs,
    archiveItems,
    dashboardStats,
    totalScore,
    markSubmitted,
    markArchiveComplete
  }
})
```

- [ ] **Step 2: Verify store imports compile**

Run:

```bash
cd supplier-vue && npm run build
```

Expected: build may still pass or fail only because pages do not import the store yet. If it fails on syntax in `src/stores/bid.js`, fix the exact syntax error before continuing.

---

### Task 2: Register Bid Routes and Sidebar Items

**Files:**
- Modify: `supplier-vue/src/router/index.js`
- Modify: `supplier-vue/src/views/Layout.vue`

- [ ] **Step 1: Update router bid route**

In `supplier-vue/src/router/index.js`, replace the current single `/bid` route object with a parent route containing children:

```js
{
  path: 'bid',
  name: 'Bid',
  component: () => import('@/views/bid/Index.vue'),
  meta: { title: '开评标管理', icon: 'DocumentChecked' }
},
{
  path: 'bid/submit',
  name: 'BidSubmit',
  component: () => import('@/views/bid/Submit.vue'),
  meta: { title: '供应商端', icon: 'Upload' }
},
{
  path: 'bid/open',
  name: 'BidOpen',
  component: () => import('@/views/bid/Open.vue'),
  meta: { title: '开标主持端', icon: 'FolderOpened' }
},
{
  path: 'bid/evaluate',
  name: 'BidEvaluate',
  component: () => import('@/views/bid/Evaluate.vue'),
  meta: { title: '专家评标端', icon: 'UserFilled' }
},
{
  path: 'bid/supervise',
  name: 'BidSupervise',
  component: () => import('@/views/bid/Supervise.vue'),
  meta: { title: '监督端', icon: 'View' }
},
{
  path: 'bid/archive',
  name: 'BidArchive',
  component: () => import('@/views/bid/Archive.vue'),
  meta: { title: '归档端', icon: 'Box' }
}
```

- [ ] **Step 2: Update sidebar bid children**

In `supplier-vue/src/views/Layout.vue`, replace the `开评标管理` children with:

```js
children: [
  { path: '/bid', title: '总览驾驶舱' },
  { path: '/bid/submit', title: '供应商端' },
  { path: '/bid/open', title: '开标主持端' },
  { path: '/bid/evaluate', title: '专家评标端' },
  { path: '/bid/supervise', title: '监督端' },
  { path: '/bid/archive', title: '归档端' }
]
```

- [ ] **Step 3: Verify route build errors show only missing view files**

Run:

```bash
cd supplier-vue && npm run build
```

Expected before creating pages: FAIL with missing `Submit.vue`, `Open.vue`, `Evaluate.vue`, `Supervise.vue`, or `Archive.vue`. This confirms route wiring is active.

---

### Task 3: Build `/bid` Dashboard

**Files:**
- Modify: `supplier-vue/src/views/bid/Index.vue`

- [ ] **Step 1: Replace `Index.vue` script**

Use this script:

```vue
<script setup>
import { useRouter } from 'vue-router'
import { DataLine, Lock, Upload, FolderOpened, UserFilled, View, Box, Warning } from '@element-plus/icons-vue'
import { useBidStore } from '@/stores/bid'

const router = useRouter()
const bidStore = useBidStore()

const roleEntries = [
  { title: '供应商端', desc: '插件授权、受控下载、加密投递、提交回执', path: '/bid/submit', icon: Upload },
  { title: '开标主持端', desc: '到时开标、在线解密、开标记录、异常处理', path: '/bid/open', icon: FolderOpened },
  { title: '专家评标端', desc: '身份核验、独立评分、澄清说明、报告确认', path: '/bid/evaluate', icon: UserFilled },
  { title: '监督端', desc: '节点监督、日志追溯、异常留痕、不可干预', path: '/bid/supervise', icon: View },
  { title: '归档端', desc: '资料清单、完整率、防篡改摘要、一键归档', path: '/bid/archive', icon: Box }
]

const lifecycle = ['插件授权', '文件下载', '加密投递', '到时开标', '专家评标', '报告归档']
</script>
```

- [ ] **Step 2: Replace `Index.vue` template**

Use this template:

```vue
<template>
  <div class="bid-workbench page-container">
    <div class="page-header bid-header">
      <div>
        <h1 class="page-title">开评标系统</h1>
        <p class="page-subtitle">统一入口、多端协同、安全可控、限时开标、独立评审、全程留痕</p>
      </div>
      <el-button type="primary" @click="router.push('/bid/open')">进入在线开标大厅</el-button>
    </div>

    <div class="stats-grid">
      <div v-for="stat in bidStore.dashboardStats" :key="stat.label" class="stat-card">
        <div :class="['stat-icon', stat.color]"><el-icon><DataLine /></el-icon></div>
        <div><strong>{{ stat.value }}{{ stat.unit }}</strong><span>{{ stat.label }}</span></div>
      </div>
    </div>

    <div class="content-card">
      <div class="card-header"><h2 class="card-title">核心流程闭环</h2><el-tag type="primary">演示项目：BID-2026-0518</el-tag></div>
      <div class="lifecycle-chain">
        <div v-for="(item, index) in lifecycle" :key="item" class="lifecycle-item">
          <div class="lifecycle-index">{{ index + 1 }}</div>
          <span>{{ item }}</span>
        </div>
      </div>
    </div>

    <div class="role-grid">
      <article v-for="entry in roleEntries" :key="entry.path" class="role-card" @click="router.push(entry.path)">
        <div class="role-icon"><el-icon><component :is="entry.icon" /></el-icon></div>
        <h3>{{ entry.title }}</h3>
        <p>{{ entry.desc }}</p>
        <el-button type="primary" link>进入工作台 →</el-button>
      </article>
    </div>

    <div class="dashboard-grid">
      <div class="content-card">
        <div class="card-header"><h2 class="card-title">项目状态</h2></div>
        <el-table :data="bidStore.projects" border style="width: 100%">
          <el-table-column prop="id" label="项目编号" width="150" />
          <el-table-column prop="name" label="项目名称" min-width="220" />
          <el-table-column prop="openTime" label="开标时间" width="165" />
          <el-table-column label="阶段" width="110">
            <template #default="{ row }">
              <el-tag :style="{ color: bidStore.stageMap[row.stage].color, borderColor: bidStore.stageMap[row.stage].color, background: bidStore.stageMap[row.stage].color + '12' }">
                {{ bidStore.stageMap[row.stage].label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="risk" label="风险提示" min-width="150" />
        </el-table>
      </div>

      <div class="content-card risk-card">
        <div class="card-header"><h2 class="card-title">风险提醒</h2><el-icon class="text-warning"><Warning /></el-icon></div>
        <ul class="risk-list">
          <li><el-icon><Lock /></el-icon>开标前仅展示密文状态，不提供明文下载入口。</li>
          <li><el-icon><Warning /></el-icon>四川宏达水利工程有限公司存在证书校验异常。</li>
          <li><el-icon><Warning /></el-icon>专家评分存在偏差提醒，需提交确认理由。</li>
          <li><el-icon><Box /></el-icon>评标报告和结果公示资料尚未完成归档。</li>
        </ul>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Add `Index.vue` scoped CSS**

Use this style block:

```vue
<style scoped>
.bid-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-bottom: 24px; }
.stat-card strong { display: block; font-size: 24px; color: var(--text-primary); }
.stat-card span { color: var(--text-secondary); font-size: 13px; }
.lifecycle-chain { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
.lifecycle-item { position: relative; padding: 18px 12px; border: 1px solid var(--border-light); border-radius: 8px; background: linear-gradient(135deg, #f8fbff, #eef6ff); text-align: center; font-weight: 700; color: var(--primary-blue); }
.lifecycle-index { width: 28px; height: 28px; margin: 0 auto 8px; border-radius: 50%; background: var(--primary-blue); color: #fff; display: flex; align-items: center; justify-content: center; }
.role-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-bottom: 24px; }
.role-card { background: #fff; border: 1px solid var(--border-light); border-radius: 8px; padding: 20px; cursor: pointer; transition: all .25s; }
.role-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-md); border-color: var(--border-dark); }
.role-icon { width: 44px; height: 44px; border-radius: 10px; background: #e8f2ff; color: var(--primary-blue); display: flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 14px; }
.role-card h3 { font-size: 16px; margin-bottom: 8px; }
.role-card p { color: var(--text-secondary); min-height: 44px; margin-bottom: 10px; }
.dashboard-grid { display: grid; grid-template-columns: 1.6fr .8fr; gap: 16px; }
.risk-list { list-style: none; display: grid; gap: 14px; }
.risk-list li { display: flex; gap: 10px; color: var(--text-regular); line-height: 1.7; }
@media (max-width: 1200px) { .stats-grid, .role-grid { grid-template-columns: repeat(2, 1fr); } .lifecycle-chain, .dashboard-grid { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 4: Run build after dashboard**

Run:

```bash
cd supplier-vue && npm run build
```

Expected: FAIL only if child view files have not been created yet; otherwise PASS.

---

### Task 4: Build `/bid/submit` Supplier Workbench

**Files:**
- Create: `supplier-vue/src/views/bid/Submit.vue`

- [ ] **Step 1: Create `Submit.vue`**

Use this component:

```vue
<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Upload, Lock, CircleCheck, Cpu } from '@element-plus/icons-vue'
import { useBidStore } from '@/stores/bid'

const bidStore = useBidStore()
const progress = ref(72)

const handleSubmit = () => {
  progress.value = 100
  bidStore.markSubmitted()
  ElMessage.success('投标文件已完成签章、哈希校验和密文提交，回执已生成。')
}
</script>

<template>
  <div class="page-container submit-page">
    <div class="page-header"><h1 class="page-title">供应商端</h1><p class="page-subtitle">企业唯一安全组件、招标文件受控下载、投标文件加密上传与回执</p></div>

    <div class="submit-grid">
      <div class="content-card component-card">
        <div class="card-header"><h2 class="card-title">企业唯一安全组件</h2><el-tag type="success">已激活</el-tag></div>
        <div class="component-main"><el-icon><Cpu /></el-icon><div><strong>{{ bidStore.securityComponent.companyName }}</strong><span>{{ bidStore.securityComponent.licenseNo }}</span></div></div>
        <div class="info-grid">
          <span>统一社会信用代码：{{ bidStore.securityComponent.companyCode }}</span>
          <span>插件版本：{{ bidStore.securityComponent.pluginVersion }}</span>
          <span>授权设备：{{ bidStore.securityComponent.authorizedDevices }}/{{ bidStore.securityComponent.maxDevices }}</span>
          <span>证书状态：{{ bidStore.securityComponent.certificateStatus }}，至 {{ bidStore.securityComponent.certificateExpire }}</span>
        </div>
      </div>

      <div class="content-card">
        <div class="card-header"><h2 class="card-title">下载前置条件</h2></div>
        <el-steps direction="vertical" :active="5" finish-status="success">
          <el-step title="企业注册审核通过" />
          <el-step title="项目报名审核通过" />
          <el-step title="安全组件版本校验通过" />
          <el-step title="授权设备和证书校验通过" />
          <el-step title="生成企业水印招标文件" />
        </el-steps>
      </div>
    </div>

    <div class="content-card">
      <div class="card-header"><h2 class="card-title">招标文件受控下载</h2><el-button type="primary"><el-icon><Download /></el-icon>下载水印标书包</el-button></div>
      <el-table :data="[{ file: 'BID-2026-0518 招标文件.ofd', watermark: '四川川水建设工程有限公司 / BID-2026-0518 / 2026-06-05', hash: 'SHA256-A19C8E', time: '2026-06-05 10:12', result: '成功' }]" border>
        <el-table-column prop="file" label="文件" />
        <el-table-column prop="watermark" label="动态水印" min-width="280" />
        <el-table-column prop="hash" label="文件哈希" width="150" />
        <el-table-column prop="time" label="下载时间" width="165" />
        <el-table-column prop="result" label="结果" width="90" />
      </el-table>
    </div>

    <div class="content-card">
      <div class="card-header"><h2 class="card-title">投标文件加密投递</h2><el-tag type="warning">截止前可撤回重传</el-tag></div>
      <el-upload drag action="#" :auto-upload="false" accept=".pdf,.doc,.docx,.ofd">
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">拖拽投标文件到此处，或<em>点击选择</em></div>
        <template #tip><div class="el-upload__tip">演示流程：本地签章 → 哈希计算 → 项目公钥加密 → 密文上传 → 生成回执</div></template>
      </el-upload>
      <div class="encrypt-panel">
        <div><el-icon><Lock /></el-icon><span>加密上传进度</span></div><el-progress :percentage="progress" />
        <el-button type="success" @click="handleSubmit"><el-icon><CircleCheck /></el-icon>生成提交回执</el-button>
      </div>
      <el-table :data="bidStore.suppliers.slice(0, 1)" border>
        <el-table-column prop="name" label="投标单位" />
        <el-table-column prop="submit" label="投递状态" />
        <el-table-column prop="encrypt" label="加密状态" />
        <el-table-column prop="receipt" label="回执编号" />
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.submit-grid { display: grid; grid-template-columns: 1.2fr .8fr; gap: 16px; }
.component-main { display: flex; align-items: center; gap: 16px; padding: 18px; background: #eef6ff; border-radius: 8px; margin-bottom: 16px; }
.component-main .el-icon { font-size: 36px; color: var(--primary-blue); }
.component-main strong { display: block; font-size: 18px; }
.component-main span { color: var(--text-secondary); }
.info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; color: var(--text-regular); }
.encrypt-panel { margin: 18px 0; padding: 16px; background: #f8fbff; border-radius: 8px; display: grid; gap: 12px; }
.encrypt-panel > div { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--primary-blue); }
@media (max-width: 1000px) { .submit-grid, .info-grid { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 2: Run build**

Run:

```bash
cd supplier-vue && npm run build
```

Expected: FAIL only if remaining child view files are missing; otherwise PASS.

---

### Task 5: Build `/bid/open` Opening Hall

**Files:**
- Create: `supplier-vue/src/views/bid/Open.vue`

- [ ] **Step 1: Create `Open.vue`**

Use this component:

```vue
<script setup>
import { ElMessage } from 'element-plus'
import { FolderOpened, Bell, DocumentChecked, Warning } from '@element-plus/icons-vue'
import { useBidStore } from '@/stores/bid'

const bidStore = useBidStore()
const decryptType = status => ({ success: 'success', running: 'primary', danger: 'danger', pending: 'warning' }[status] || 'info')
const decryptLabel = status => ({ success: '解密成功', running: '解密中', danger: '异常', pending: '待解密' }[status] || '未知')
const notify = () => ElMessage.success('已向待解密供应商发送在线解密提醒。')
const record = () => ElMessage.success('开标记录已生成并写入监督日志。')
</script>

<template>
  <div class="page-container open-page">
    <div class="page-header"><h1 class="page-title">在线开标大厅</h1><p class="page-subtitle">到时自动提取投标文件，提示投标人在线解密，生成开标记录</p></div>

    <div class="opening-hero content-card">
      <div><el-icon><FolderOpened /></el-icon></div>
      <section>
        <h2>{{ bidStore.projects[0].name }}</h2>
        <p>开标时间：{{ bidStore.projects[0].openTime }} ｜ 解密窗口：{{ bidStore.openingSession.decryptWindow }}</p>
        <p>主持人：{{ bidStore.openingSession.host }} ｜ 监督人：{{ bidStore.openingSession.supervisor }}</p>
      </section>
      <aside><span>剩余时间</span><strong>{{ bidStore.openingSession.remaining }}</strong><el-tag type="primary">{{ bidStore.openingSession.status }}</el-tag></aside>
    </div>

    <div class="action-row">
      <el-button type="primary" @click="notify"><el-icon><Bell /></el-icon>发送解密提醒</el-button>
      <el-button type="success" @click="record"><el-icon><DocumentChecked /></el-icon>生成开标记录</el-button>
    </div>

    <div class="content-card">
      <div class="card-header"><h2 class="card-title">投标人在线解密状态</h2></div>
      <el-table :data="bidStore.suppliers" border>
        <el-table-column prop="name" label="投标单位" min-width="220" />
        <el-table-column prop="receipt" label="投标回执" width="160" />
        <el-table-column prop="encrypt" label="密文状态" width="130" />
        <el-table-column label="解密状态" width="120"><template #default="{ row }"><el-tag :type="decryptType(row.decrypt)">{{ decryptLabel(row.decrypt) }}</el-tag></template></el-table-column>
        <el-table-column prop="confirm" label="确认状态" width="130" />
      </el-table>
    </div>

    <div class="open-grid">
      <div class="content-card">
        <div class="card-header"><h2 class="card-title">开标记录</h2></div>
        <el-table :data="bidStore.openingRecords" border>
          <el-table-column prop="supplier" label="供应商" min-width="200" />
          <el-table-column prop="amount" label="报价" width="120" />
          <el-table-column prop="period" label="工期/服务期" width="120" />
          <el-table-column prop="quality" label="质量目标" width="100" />
          <el-table-column prop="bond" label="保证金" width="100" />
          <el-table-column prop="confirm" label="确认" width="100" />
        </el-table>
      </div>
      <div class="content-card exception-card">
        <div class="card-header"><h2 class="card-title">异常处理</h2><el-icon class="text-warning"><Warning /></el-icon></div>
        <p><strong>四川宏达水利工程有限公司：</strong>证书校验失败，初步判定为投标人原因。</p>
        <p><strong>处理意见：</strong>保留插件日志、证书校验截图、在线提醒记录，提交监督端确认。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.opening-hero { display: grid; grid-template-columns: 72px 1fr 180px; align-items: center; gap: 18px; background: linear-gradient(135deg, #063f82, #0a7ed3); color: #fff; }
.opening-hero .el-icon { font-size: 46px; }
.opening-hero h2 { font-size: 22px; margin-bottom: 8px; }
.opening-hero p { color: rgba(255,255,255,.82); margin: 4px 0; }
.opening-hero aside { text-align: center; background: rgba(255,255,255,.14); border-radius: 8px; padding: 14px; }
.opening-hero aside span { display: block; opacity: .8; }
.opening-hero aside strong { display: block; font-size: 28px; margin: 4px 0 10px; }
.action-row { display: flex; gap: 12px; margin-bottom: 16px; }
.open-grid { display: grid; grid-template-columns: 1.5fr .8fr; gap: 16px; }
.exception-card p { line-height: 1.9; color: var(--text-regular); margin-bottom: 10px; }
@media (max-width: 1000px) { .opening-hero, .open-grid { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 2: Run build**

Run:

```bash
cd supplier-vue && npm run build
```

Expected: FAIL only if remaining child view files are missing; otherwise PASS.

---

### Task 6: Build `/bid/evaluate` Expert Workspace

**Files:**
- Create: `supplier-vue/src/views/bid/Evaluate.vue`

- [ ] **Step 1: Create `Evaluate.vue`**

Use this component:

```vue
<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { UserFilled, Document, EditPen, ChatDotRound, Trophy } from '@element-plus/icons-vue'
import { useBidStore } from '@/stores/bid'

const bidStore = useBidStore()
const activeSupplier = ref(bidStore.suppliers[0].name)
const submitScore = () => ElMessage.success('本人评分已保存，系统已校验漏评、超分和评分理由。')
const confirmReport = () => ElMessage.success('评标报告已完成专家电子确认模拟。')
</script>

<template>
  <div class="page-container evaluate-page">
    <div class="page-header"><h1 class="page-title">专家评标端</h1><p class="page-subtitle">身份核验、保密承诺、回避确认后进入独立评审</p></div>

    <div class="content-card">
      <el-steps :active="4" finish-status="success">
        <el-step title="身份核验" />
        <el-step title="保密承诺" />
        <el-step title="回避确认" />
        <el-step title="评标纪律" />
      </el-steps>
    </div>

    <div class="evaluate-layout">
      <aside class="content-card supplier-panel">
        <div class="card-header"><h2 class="card-title">投标单位</h2></div>
        <button v-for="item in bidStore.suppliers" :key="item.id" :class="['supplier-item', { active: activeSupplier === item.name }]" @click="activeSupplier = item.name">
          <strong>{{ item.name }}</strong><span>{{ item.encrypt }} ｜ {{ item.confirm }}</span>
        </button>
      </aside>

      <main class="content-card file-panel">
        <div class="card-header"><h2 class="card-title">文件与响应摘要</h2><el-tag type="primary">{{ activeSupplier }}</el-tag></div>
        <div class="file-summary">
          <section><el-icon><Document /></el-icon><h3>资格文件</h3><p>营业执照、资质证书、法人授权书、保证金凭证均已提交。</p></section>
          <section><el-icon><EditPen /></el-icon><h3>技术响应</h3><p>施工组织、设备配置、进度计划、质量保障措施完整。</p></section>
          <section><el-icon><Trophy /></el-icon><h3>商务报价</h3><p>报价位于有效区间，系统已完成价格分模拟计算。</p></section>
        </div>
        <div class="clarify-box">
          <h3><el-icon><ChatDotRound /></el-icon>澄清说明</h3>
          <p v-for="item in bidStore.clarifications" :key="item.id">{{ item.question }} —— {{ item.status }}：{{ item.reply }}</p>
        </div>
      </main>

      <section class="content-card score-panel">
        <div class="card-header"><h2 class="card-title">评分表</h2><el-tag type="success">本人独立评分</el-tag></div>
        <div v-for="item in bidStore.scoreItems" :key="item.id" class="score-item">
          <div><strong>{{ item.name }}</strong><span>{{ item.max ? `满分 ${item.max} 分` : item.result }}</span></div>
          <el-input-number v-if="item.max" v-model="item.score" :min="0" :max="item.max" :precision="1" />
          <el-tag v-else type="success">{{ item.result }}</el-tag>
          <el-input v-model="item.reason" type="textarea" :rows="2" placeholder="请输入评分理由" />
        </div>
        <div class="score-total">当前总分：<strong>{{ bidStore.totalScore.toFixed(1) }}</strong></div>
        <el-button type="primary" @click="submitScore">提交本人评分</el-button>
        <el-button type="success" @click="confirmReport"><el-icon><UserFilled /></el-icon>确认评标报告</el-button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.evaluate-layout { display: grid; grid-template-columns: 260px 1fr 360px; gap: 16px; align-items: start; }
.supplier-panel { padding: 16px; }
.supplier-item { width: 100%; text-align: left; padding: 12px; border: 1px solid var(--border-light); border-radius: 8px; background: #fff; margin-bottom: 10px; cursor: pointer; }
.supplier-item.active { border-color: var(--primary-blue); background: #eef6ff; }
.supplier-item strong, .supplier-item span { display: block; }
.supplier-item span { color: var(--text-secondary); font-size: 12px; margin-top: 4px; }
.file-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.file-summary section { border: 1px solid var(--border-light); border-radius: 8px; padding: 16px; background: #f8fbff; }
.file-summary .el-icon { color: var(--primary-blue); font-size: 24px; }
.file-summary h3 { margin: 8px 0; }
.file-summary p, .clarify-box p { color: var(--text-regular); line-height: 1.8; }
.clarify-box { margin-top: 16px; padding: 16px; border-radius: 8px; background: #fff8e8; }
.clarify-box h3 { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.score-item { display: grid; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--border-light); }
.score-item > div:first-child { display: flex; justify-content: space-between; color: var(--text-regular); }
.score-total { padding: 14px 0; font-size: 16px; }
.score-total strong { font-size: 24px; color: var(--primary-blue); }
@media (max-width: 1300px) { .evaluate-layout { grid-template-columns: 1fr; } .file-summary { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 2: Run build**

Run:

```bash
cd supplier-vue && npm run build
```

Expected: FAIL only if remaining child view files are missing; otherwise PASS.

---

### Task 7: Build `/bid/supervise` Supervision Workspace

**Files:**
- Create: `supplier-vue/src/views/bid/Supervise.vue`

- [ ] **Step 1: Create `Supervise.vue`**

Use this component:

```vue
<script setup>
import { View, Lock, Warning, DocumentChecked } from '@element-plus/icons-vue'
import { useBidStore } from '@/stores/bid'
const bidStore = useBidStore()
</script>

<template>
  <div class="page-container supervise-page">
    <div class="page-header"><h1 class="page-title">监督端</h1><p class="page-subtitle">可监督、不可干预：查看节点、日志、异常和证据链，不修改评分或敏感文件</p></div>

    <div class="supervise-banner content-card">
      <el-icon><View /></el-icon>
      <div><h2>监督权限边界</h2><p>监督人员可查看开评标过程、日志、异常记录和报告状态，但不具备开标前查看明文投标文件、修改评分、替专家提交意见的能力。</p></div>
      <el-tag type="danger">禁止干预评分</el-tag>
    </div>

    <div class="supervise-grid">
      <div class="content-card">
        <div class="card-header"><h2 class="card-title">过程时间线</h2></div>
        <el-timeline>
          <el-timeline-item timestamp="2026-06-08 08:55" type="primary"><el-icon><Lock /></el-icon> 投标截止，系统自动锁定全部密文文件。</el-timeline-item>
          <el-timeline-item timestamp="2026-06-08 09:30" type="success"><el-icon><DocumentChecked /></el-icon> 开标主持人启动在线开标大厅。</el-timeline-item>
          <el-timeline-item timestamp="2026-06-08 09:42" type="warning"><el-icon><Warning /></el-icon> 发现供应商证书校验异常。</el-timeline-item>
          <el-timeline-item timestamp="2026-06-08 10:05" type="primary">专家提交第一轮评分，系统提示偏差复核。</el-timeline-item>
        </el-timeline>
      </div>

      <div class="content-card">
        <div class="card-header"><h2 class="card-title">异常事件</h2></div>
        <el-alert title="四川宏达水利工程有限公司解密证书校验失败" type="warning" show-icon :closable="false" />
        <el-alert title="专家技术评分偏离平均值，已要求填写确认理由" type="info" show-icon :closable="false" />
      </div>
    </div>

    <div class="content-card">
      <div class="card-header"><h2 class="card-title">监督日志</h2><el-button type="primary" plain>导出模拟日志</el-button></div>
      <el-table :data="bidStore.supervisionLogs" border>
        <el-table-column prop="time" label="时间" width="165" />
        <el-table-column prop="role" label="角色" width="120" />
        <el-table-column prop="target" label="对象" width="150" />
        <el-table-column prop="action" label="操作" min-width="180" />
        <el-table-column prop="result" label="结果" width="100" />
        <el-table-column prop="risk" label="风险标记" min-width="160" />
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.supervise-banner { display: grid; grid-template-columns: 56px 1fr auto; align-items: center; gap: 16px; background: linear-gradient(135deg, #f8fbff, #eef6ff); }
.supervise-banner > .el-icon { font-size: 38px; color: var(--primary-blue); }
.supervise-banner h2 { margin-bottom: 6px; }
.supervise-banner p { color: var(--text-regular); }
.supervise-grid { display: grid; grid-template-columns: 1fr .8fr; gap: 16px; }
.el-alert + .el-alert { margin-top: 12px; }
@media (max-width: 1000px) { .supervise-banner, .supervise-grid { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 2: Run build**

Run:

```bash
cd supplier-vue && npm run build
```

Expected: FAIL only if `Archive.vue` is still missing; otherwise PASS.

---

### Task 8: Build `/bid/archive` Archive Workspace

**Files:**
- Create: `supplier-vue/src/views/bid/Archive.vue`

- [ ] **Step 1: Create `Archive.vue`**

Use this component:

```vue
<script setup>
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Box, CircleCheck, Warning } from '@element-plus/icons-vue'
import { useBidStore } from '@/stores/bid'

const bidStore = useBidStore()
const archiveRate = computed(() => Math.round((bidStore.archiveItems.filter(item => item.status === '已归档').length / bidStore.archiveItems.length) * 100))
const archiveAll = () => {
  bidStore.markArchiveComplete()
  ElMessage.success('资料已完成一键归档演示，防篡改摘要已更新。')
}
</script>

<template>
  <div class="page-container archive-page">
    <div class="page-header"><h1 class="page-title">归档端</h1><p class="page-subtitle">开标记录、评分表、澄清记录、评标报告、结果公示统一归档</p></div>

    <div class="archive-summary content-card">
      <el-icon><Box /></el-icon>
      <div><h2>电子档案编号：ARCH-BID-2026-0518</h2><p>防篡改摘要：HASH-CHAIN-20260608-AF39C8E2</p></div>
      <el-progress type="circle" :percentage="archiveRate" />
      <el-button type="success" @click="archiveAll">一键归档演示</el-button>
    </div>

    <div class="archive-grid">
      <div class="content-card">
        <div class="card-header"><h2 class="card-title">归档资料清单</h2></div>
        <el-table :data="bidStore.archiveItems" border>
          <el-table-column prop="name" label="资料名称" min-width="180" />
          <el-table-column prop="owner" label="责任端" width="130" />
          <el-table-column prop="status" label="状态" width="110">
            <template #default="{ row }"><el-tag :type="row.status === '已归档' ? 'success' : row.status === '待确认' ? 'warning' : 'info'">{{ row.status }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="hash" label="哈希摘要" width="150" />
          <el-table-column prop="time" label="归档时间" width="165" />
        </el-table>
      </div>

      <div class="content-card">
        <div class="card-header"><h2 class="card-title">缺失提醒</h2></div>
        <p class="archive-tip"><el-icon><Warning /></el-icon> 专家评分汇总表待归档。</p>
        <p class="archive-tip"><el-icon><Warning /></el-icon> 评标报告待专家最终确认。</p>
        <p class="archive-tip success"><el-icon><CircleCheck /></el-icon> 开标记录、投标回执和下载日志已入档。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.archive-summary { display: grid; grid-template-columns: 56px 1fr 120px auto; align-items: center; gap: 18px; }
.archive-summary > .el-icon { font-size: 40px; color: var(--primary-blue); }
.archive-summary h2 { margin-bottom: 6px; }
.archive-summary p { color: var(--text-secondary); }
.archive-grid { display: grid; grid-template-columns: 1.4fr .7fr; gap: 16px; }
.archive-tip { display: flex; align-items: center; gap: 8px; padding: 12px; border-radius: 8px; background: #fff8e8; color: var(--text-regular); margin-bottom: 10px; }
.archive-tip .el-icon { color: var(--orange); }
.archive-tip.success { background: #e8fff0; }
.archive-tip.success .el-icon { color: var(--green); }
@media (max-width: 1000px) { .archive-summary, .archive-grid { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 2: Run build**

Run:

```bash
cd supplier-vue && npm run build
```

Expected: PASS with no missing bid view files.

---

### Task 9: Enhance Static `bid.html` Portal Content

**Files:**
- Modify: `bid.html`
- Modify: `css/bid.css`
- Modify: `js/bid.js`

- [ ] **Step 1: Add controlled-security section in `bid.html`**

Insert after the intro section and before the modules section:

```html
<section class="bid-security" id="secure">
  <div class="security-wrapper">
    <div class="section-head">
      <span></span>
      <h2>安全可控的开评标闭环</h2>
    </div>
    <div class="security-grid">
      <article><strong>企业唯一安全组件</strong><p>一个企业主体对应一套企业级安全组件授权，绑定企业身份、证书、设备指纹和授权用户。</p></article>
      <article><strong>招标文件受控下载</strong><p>报名审核、插件校验、设备授权、动态水印和下载日志共同控制文件获取。</p></article>
      <article><strong>投标文件密文保存</strong><p>开标时间前仅保存密文和哈希，招标人、专家、管理员均不可下载或预览明文。</p></article>
      <article><strong>到时开标在线解密</strong><p>按照招标文件确定时间自动进入开标状态，投标人在线解密并生成开标记录。</p></article>
      <article><strong>专家独立在线评审</strong><p>专家完成身份核验、保密承诺和回避确认后，独立完成资格、符合性、商务、技术和价格评审。</p></article>
      <article><strong>监督审计全程留痕</strong><p>监督端可查看节点、日志、异常和报告状态，但不可干预评分或绕过时间锁查看文件。</p></article>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Add role entry section in `bid.html`**

Insert before the final CTA section or before `</main>`:

```html
<section class="bid-role-entry" id="system">
  <div class="role-entry-wrapper">
    <div class="section-head inverse">
      <span></span>
      <h2>进入开评标系统</h2>
    </div>
    <div class="role-entry-grid">
      <a href="supplier-vue/dist/index.html#/bid/submit" data-vue-route="/bid/submit"><strong>供应商端</strong><span>插件授权、标书下载、密文投递</span></a>
      <a href="supplier-vue/dist/index.html#/bid/open" data-vue-route="/bid/open"><strong>开标主持端</strong><span>到时开标、在线解密、开标记录</span></a>
      <a href="supplier-vue/dist/index.html#/bid/evaluate" data-vue-route="/bid/evaluate"><strong>专家评标端</strong><span>承诺回避、独立评分、报告确认</span></a>
      <a href="supplier-vue/dist/index.html#/bid/supervise" data-vue-route="/bid/supervise"><strong>监督端</strong><span>过程查看、异常留痕、不可干预</span></a>
      <a href="supplier-vue/dist/index.html#/bid/archive" data-vue-route="/bid/archive"><strong>归档端</strong><span>资料清单、防篡改摘要、一键归档</span></a>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Add static CSS**

Append to `css/bid.css`:

```css
.bid-security { padding: 64px 0; background: #fff; }
.security-wrapper, .role-entry-wrapper { width: var(--max); max-width: var(--max); margin: 0 auto; padding: 0 var(--page-gutter); }
.security-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 28px; }
.security-grid article { padding: 22px; border: 1px solid #e0eaf5; border-radius: 10px; background: linear-gradient(135deg, #f8fbff, #eef6ff); box-shadow: 0 8px 22px rgba(6, 78, 162, .06); }
.security-grid strong { display: block; color: #064ea2; font-size: 16px; margin-bottom: 10px; }
.security-grid p { margin: 0; color: #536078; line-height: 1.8; font-size: 13px; font-weight: 600; }
.bid-role-entry { padding: 64px 0; background: linear-gradient(135deg, #042a58, #064ea2); }
.role-entry-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-top: 28px; }
.role-entry-grid a { display: block; padding: 22px 18px; border-radius: 10px; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18); transition: all .25s; }
.role-entry-grid a:hover { transform: translateY(-4px); background: rgba(255,255,255,.18); }
.role-entry-grid strong { display: block; font-size: 16px; margin-bottom: 8px; }
.role-entry-grid span { color: rgba(255,255,255,.78); font-size: 13px; line-height: 1.7; }
@media (max-width: 1100px) { .security-grid, .role-entry-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px) { .security-grid, .role-entry-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 4: Update `js/bid.js` role modal**

Replace `bidEnterTemplate` with:

```js
const bidEnterTemplate = () => `
  <h3>进入开评标系统</h3>
  <p>请选择您的身份进入 Vue 业务工作台。</p>
  <div style="display: grid; gap: 12px; margin-top: 20px;">
    <a class="btn btn-solid" style="width: 100%;" href="supplier-vue/dist/index.html#/bid/submit">供应商端</a>
    <a class="btn btn-solid" style="width: 100%;" href="supplier-vue/dist/index.html#/bid/open">开标主持端</a>
    <a class="btn btn-solid" style="width: 100%;" href="supplier-vue/dist/index.html#/bid/evaluate">评标专家端</a>
    <a class="btn btn-solid" style="width: 100%;" href="supplier-vue/dist/index.html#/bid/supervise">监督端</a>
    <a class="btn btn-solid" style="width: 100%;" href="supplier-vue/dist/index.html#/bid/archive">归档端</a>
  </div>
  <div class="modal-actions">
    <button class="btn btn-outline" data-close>关闭</button>
  </div>
`;
```

- [ ] **Step 5: Verify static page opens locally**

Open `bid.html` in a browser or serve the directory with a local static server. Expected: the new security section and role entry section display, and role buttons point to Vue bid routes.

---

### Task 10: Update Homepage Entry

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add a visible 开评标系统 entry**

In the homepage `.assurance-inner`, add or replace one item so there is a direct bid-system entry:

```html
<a href="bid.html" class="assurance-item">
  <div class="line-icon" data-icon="safe"></div>
  <div><strong>开评标系统入口</strong><span>在线开标、专家评审、监督归档</span></div>
</a>
```

If adding this creates five grid items, update the homepage CSS `.assurance-inner` grid for that section to support five columns:

```css
.assurance-inner { grid-template-columns: repeat(5, 1fr); }
```

If five columns hurts layout, replace the existing “专家入口” card with the 开评标系统入口 instead, because the expert workbench now lives inside `/bid/evaluate`.

- [ ] **Step 2: Verify homepage entry**

Open `index.html`. Expected: a visible entry leads to `bid.html`, and icons still render because `safe` exists in `js/main.js`.

---

### Task 11: Full Build and Manual Verification

**Files:**
- No code creation unless fixing build errors from earlier tasks.

- [ ] **Step 1: Run Vue production build**

Run:

```bash
cd supplier-vue && npm run build
```

Expected: PASS. If it fails, fix only the reported error and rerun the same command.

- [ ] **Step 2: Launch Vue dev server**

Run:

```bash
cd supplier-vue && npm run dev
```

Expected: Vite prints a local URL such as `http://localhost:5173/`.

- [ ] **Step 3: Browser-check Vue routes**

Open the dev-server URL and verify these paths manually:

- `/bid`: dashboard shows stats, lifecycle, role cards, project status, risk reminders.
- `/bid/submit`: supplier security component, download controls, upload panel, receipt table.
- `/bid/open`: opening hall, decrypt status table, opening records, exception panel.
- `/bid/evaluate`: expert entry steps, three-column workspace, score inputs, total score.
- `/bid/supervise`: supervision boundary banner, timeline, exceptions, log table.
- `/bid/archive`: archive summary, circular progress, archive list, missing reminders.

Expected: no blank pages, no route mismatch, no obvious console errors.

- [ ] **Step 4: Browser-check static pages**

Open `index.html` and `bid.html`.

Expected:

- Homepage has a visible 开评标系统入口.
- `bid.html` explains security, role collaboration, and system capabilities.
- “进入系统” modal and role cards link to Vue bid routes.

---

## Self-Review Notes

- Spec coverage: tasks implement the static portal, all six Vue routes, central mock data, role workbench structure, security/time-lock messaging, independent expert review, supervision boundary, and archive completeness.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: store names used by pages are `useBidStore`, `projects`, `securityComponent`, `suppliers`, `openingSession`, `openingRecords`, `experts`, `scoreItems`, `clarifications`, `supervisionLogs`, `archiveItems`, `dashboardStats`, `totalScore`, `markSubmitted`, and `markArchiveComplete`.
