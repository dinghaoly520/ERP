<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  UserFilled,
  Sort,
  Bell,
  Star,
  Check,
  Search,
  Plus,
  Phone,
  Message
} from '@element-plus/icons-vue'

const router = useRouter()
const activeTab = ref('pool')

const tabs = [
  { key: 'pool', title: '专家库', icon: UserFilled },
  { key: 'extract', title: '专家抽取', icon: Sort },
  { key: 'notify', title: '通知确认', icon: Bell },
  { key: 'evaluate', title: '专家评价', icon: Star }
]

// 模拟专家数据
const experts = ref([
  { id: 'EXP-001', name: '张教授', field: '水利工程', level: '高级', status: 'available', phone: '138****8001', email: 'zhang@edu.cn', projects: 12, score: 92 },
  { id: 'EXP-002', name: '李工程师', field: '电气设备', level: '中级', status: 'available', phone: '139****9002', email: 'li@company.com', projects: 8, score: 88 },
  { id: 'EXP-003', name: '王顾问', field: '工程造价', level: '高级', status: 'extracted', phone: '137****7003', email: 'wang@consult.cn', projects: 15, score: 95 },
  { id: 'EXP-004', name: '赵专家', field: '土木工程', level: '高级', status: 'available', phone: '136****6004', email: 'zhao@org.cn', projects: 20, score: 90 },
  { id: 'EXP-005', name: '刘工程师', field: '机械设计', level: '中级', status: 'available', phone: '135****5005', email: 'liu@tech.com', projects: 6, score: 85 }
])

const statusMap = {
  available: { label: '可用', color: '#11a874' },
  extracted: { label: '已抽取', color: '#f5a623' },
  busy: { label: '忙碌', color: '#8a9aaa' }
}

const searchText = ref('')

const filteredExperts = computed(() => {
  if (!searchText.value) return experts.value
  return experts.value.filter(e => e.name.includes(searchText.value) || e.field.includes(searchText.value))
})

// 通知记录
const notifications = ref([
  { id: 1, expertName: '张教授', project: '水利物资采购评标', status: 'confirmed', sendTime: '2026-05-20 10:00', responseTime: '2026-05-20 11:30' },
  { id: 2, expertName: '王顾问', project: '工程造价审核', status: 'confirmed', sendTime: '2026-05-19 14:00', responseTime: '2026-05-19 15:45' },
  { id: 3, expertName: '李工程师', project: '设备采购评标', status: 'pending', sendTime: '2026-05-18 09:00', responseTime: '-' }
])

const notifyStatusMap = {
  confirmed: { label: '已确认', color: '#11a874' },
  rejected: { label: '已拒绝', color: '#e74c3c' },
  pending: { label: '待确认', color: '#f5a623' }
}

const handleView = (id) => {
  router.push(`/expert/detail/${id}`)
}
</script>

<template>
  <div class="expert-page">
    <div class="page-header">
      <h1 class="page-title">专家管理</h1>
      <p class="page-subtitle">专家库管理、专家抽取、通知确认、专家评价</p>
    </div>

    <!-- 统计概览 -->
    <div class="stats-row">
      <div class="stat-card">
        <el-icon :size="32" color="#064ea2"><UserFilled /></el-icon>
        <div>
          <div class="stat-value">256</div>
          <div class="stat-label">专家总数</div>
        </div>
      </div>
      <div class="stat-card">
        <el-icon :size="32" color="#11a874"><Check /></el-icon>
        <div>
          <div class="stat-value">182</div>
          <div class="stat-label">可用专家</div>
        </div>
      </div>
      <div class="stat-card">
        <el-icon :size="32" color="#f5a623"><Random /></el-icon>
        <div>
          <div class="stat-value">28</div>
          <div class="stat-label">本周抽取</div>
        </div>
      </div>
    </div>

    <!-- 功能标签 -->
    <div class="tabs-wrapper">
      <div class="tabs-nav">
        <div
          v-for="tab in tabs"
          :key="tab.key"
          :class="['tab-item', { active: activeTab === tab.key }]"
          @click="activeTab = tab.key"
        >
          <el-icon><component :is="tab.icon" /></el-icon>
          <span>{{ tab.title }}</span>
        </div>
      </div>

      <!-- 专家库 -->
      <div v-show="activeTab === 'pool'" class="tab-content">
        <div class="search-bar">
          <el-input
            v-model="searchText"
            placeholder="搜索专家姓名或专业领域"
            clearable
            style="width: 280px"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-button type="primary">
            <el-icon><Plus /></el-icon>
            新增专家
          </el-button>
        </div>
        <el-table :data="filteredExperts" border style="width: 100%">
          <el-table-column prop="id" label="专家编号" width="120" />
          <el-table-column prop="name" label="姓名" width="100">
            <template #default="{ row }">
              <el-link type="primary" @click="handleView(row.id)">{{ row.name }}</el-link>
            </template>
          </el-table-column>
          <el-table-column prop="field" label="专业领域" width="120" />
          <el-table-column prop="level" label="职称级别" width="100" />
          <el-table-column prop="projects" label="参与项目" width="100" align="center" />
          <el-table-column prop="score" label="评分" width="80" align="center">
            <template #default="{ row }">
              <span style="color: #11a874; font-weight: 700">{{ row.score }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :style="{ background: statusMap[row.status].color + '20', color: statusMap[row.status].color, border: 'none' }" size="small">
                {{ statusMap[row.status].label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default>
              <el-button type="primary" link size="small">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 专家抽取 -->
      <div v-show="activeTab === 'extract'" class="tab-content">
        <div class="action-card">
          <h3>专家抽取</h3>
          <p>根据项目类型和评标需求，随机抽取符合条件的专家参与评标。</p>
          <el-button type="primary">开始抽取</el-button>
        </div>
      </div>

      <!-- 通知确认 -->
      <div v-show="activeTab === 'notify'" class="tab-content">
        <el-table :data="notifications" border style="width: 100%">
          <el-table-column prop="expertName" label="专家姓名" width="120" />
          <el-table-column prop="project" label="项目名称" min-width="200" />
          <el-table-column prop="sendTime" label="发送时间" width="160" />
          <el-table-column prop="responseTime" label="响应时间" width="160" />
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :style="{ background: notifyStatusMap[row.status].color + '20', color: notifyStatusMap[row.status].color, border: 'none' }" size="small">
                {{ notifyStatusMap[row.status].label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default>
              <el-button type="primary" link size="small">重新发送</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 专家评价 -->
      <div v-show="activeTab === 'evaluate'" class="tab-content">
        <div class="action-card">
          <h3>专家评价</h3>
          <p>对专家在评标过程中的表现进行评价，包括专业能力、工作态度、公正性等维度，形成专家信用档案。</p>
          <el-table :data="experts.filter(e => e.projects > 0)" border style="width: 100%">
            <el-table-column prop="name" label="专家姓名" width="120" />
            <el-table-column prop="field" label="专业领域" width="120" />
            <el-table-column prop="projects" label="参与项目" width="100" align="center" />
            <el-table-column prop="score" label="综合评分" width="100" align="center">
              <template #default="{ row }">
                <span style="color: #064ea2; font-weight: 700">{{ row.score }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default>
                <el-button type="primary" link size="small">评价</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.expert-page {
  padding: 24px;
  background: #f6f9fd;
  min-height: calc(100vh - 60px);
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 22px;
  font-weight: 800;
  color: #18243a;
  margin-bottom: 8px;
}

.page-subtitle {
  font-size: 14px;
  color: #8a9aaa;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  border: 1px solid #e8f0fa;
}

.stat-value {
  font-size: 28px;
  font-weight: 900;
  color: #18243a;
}

.stat-label {
  font-size: 13px;
  color: #8a9aaa;
}

.tabs-wrapper {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  border: 1px solid #e8f0fa;
}

.tabs-nav {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  border-bottom: 2px solid #e8f0fa;
  padding-bottom: 12px;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  color: #5a6d8a;
  font-weight: 600;
  transition: all 0.25s;
}

.tab-item:hover {
  color: #064ea2;
}

.tab-item.active {
  color: #064ea2;
  position: relative;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: -14px;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #0e62d0, #39a8ff);
}

.tab-content {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.action-card {
  padding: 20px;
  background: #f8fafd;
  border-radius: 8px;
}

.action-card h3 {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 12px;
}

.action-card p {
  color: #5a6d8a;
  margin-bottom: 20px;
}

.search-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
</style>