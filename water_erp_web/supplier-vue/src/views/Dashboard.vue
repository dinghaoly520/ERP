<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { useUserStore } from '@/stores/user'
import { useEvaluationStore } from '@/stores/evaluation'
import {
  DocumentAdd,
  User,
  Star,
  Clock,
  Bell,
  Warning,
  DocumentChecked,
  DataLine,
  TrendCharts,
  View,
  Plus
} from '@element-plus/icons-vue'

const router = useRouter()
const supplierStore = useSupplierStore()
const userStore = useUserStore()
const evaluationStore = useEvaluationStore()

// 快捷入口
const quickEntries = [
  { title: '供应商注册', icon: DocumentAdd, color: '#064ea2', path: '/register' },
  { title: '供应商库', icon: User, color: '#11a874', path: '/supplier' },
  { title: '供应商评价', icon: Star, color: '#f5a623', path: '/evaluation' },
  { title: '评价统计', icon: TrendCharts, color: '#0a7ed3', path: '/evaluation/statistics' }
]

// 统计数据
const statistics = computed(() => supplierStore.statistics)

// 待办事项
const todos = computed(() => userStore.todos)

// 最近评价
const recentEvaluations = computed(() => evaluationStore.recentEvaluations.slice(0, 5))

// 异常记录统计
const abnormalCount = computed(() => evaluationStore.statistics.abnormalCount)

// 处理待办
const handleTodo = (todo) => {
  if (todo.type === 'audit') {
    router.push('/supplier/audit')
  } else if (todo.type === 'change') {
    router.push('/supplier/change')
  } else if (todo.type === 'evaluation') {
    router.push('/evaluation/create')
  }
}

// 快捷入口点击
const handleQuickEntry = (entry) => {
  router.push(entry.path)
}
</script>

<template>
  <div class="dashboard-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1 class="page-title">供应商管理工作台</h1>
      <p class="page-subtitle">欢迎回来，{{ userStore.currentUser.name }}。今日有 {{ userStore.pendingTodoCount }} 项待办事项。</p>
    </div>

    <!-- 快捷入口 -->
    <div class="quick-entries">
      <div
        class="quick-entry-card"
        v-for="entry in quickEntries"
        :key="entry.path"
        @click="handleQuickEntry(entry)"
      >
        <div class="entry-icon" :style="{ background: entry.color }">
          <el-icon :size="24"><component :is="entry.icon" /></el-icon>
        </div>
        <div class="entry-title">{{ entry.title }}</div>
      </div>
    </div>

    <!-- 统计概览 -->
    <div class="statistics-row">
      <div class="stat-card">
        <div class="stat-icon blue">
          <el-icon :size="24"><User /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ statistics.total }}</div>
          <div class="stat-label">注册供应商总数</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green">
          <el-icon :size="24"><DocumentChecked /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ statistics.active }}</div>
          <div class="stat-label">已入库供应商</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon orange">
          <el-icon :size="24"><Clock /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ statistics.newThisMonth }}</div>
          <div class="stat-label">本月新增</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red">
          <el-icon :size="24"><Warning /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ abnormalCount }}</div>
          <div class="stat-label">异常记录</div>
        </div>
      </div>
    </div>

    <!-- 两列布局 -->
    <div class="content-row">
      <!-- 待办事项 -->
      <div class="content-card todo-card">
        <div class="card-header">
          <div class="card-title">
            <el-icon><Bell /></el-icon>
            待办事项
          </div>
          <el-badge :value="userStore.pendingTodoCount" type="primary" />
        </div>
        <div class="todo-list">
          <div
            class="todo-item"
            v-for="todo in todos"
            :key="todo.id"
            @click="handleTodo(todo)"
          >
            <div class="todo-priority" :class="todo.priority"></div>
            <div class="todo-content">
              <div class="todo-title">{{ todo.title }}</div>
              <div class="todo-meta">
                <span class="todo-type">
                  <el-tag size="small" :type="todo.type === 'audit' ? 'warning' : todo.type === 'change' ? 'primary' : 'success'">
                    {{ todo.type === 'audit' ? '注册审核' : todo.type === 'change' ? '变更审核' : '评价' }}
                  </el-tag>
                </span>
                <span class="todo-time">{{ todo.createTime }}</span>
              </div>
            </div>
            <el-icon class="todo-arrow"><View /></el-icon>
          </div>
          <div class="empty-state" v-if="todos.length === 0">
            <el-icon :size="40"><DocumentChecked /></el-icon>
            <p>暂无待办事项</p>
          </div>
        </div>
      </div>

      <!-- 最近评价 -->
      <div class="content-card evaluation-card">
        <div class="card-header">
          <div class="card-title">
            <el-icon><Star /></el-icon>
            最近评价
          </div>
          <el-button type="primary" size="small" @click="router.push('/evaluation/create')">
            <el-icon><Plus /></el-icon>发起评价
          </el-button>
        </div>
        <div class="evaluation-list">
          <div class="evaluation-item" v-for="evaluation in recentEvaluations" :key="evaluation.id">
            <div class="eval-header">
              <span class="eval-supplier">{{ evaluation.supplierName }}</span>
              <el-tag size="small" :type="evaluation.level === 'A' ? 'success' : evaluation.level === 'B' ? 'primary' : 'warning'">
                {{ evaluation.level }}级
              </el-tag>
            </div>
            <div class="eval-project">{{ evaluation.projectName }}</div>
            <div class="eval-footer">
              <span class="eval-score">得分: <strong>{{ evaluation.totalScore }}</strong></span>
              <span class="eval-date">{{ evaluation.evaluateDate }}</span>
            </div>
          </div>
          <div class="empty-state" v-if="recentEvaluations.length === 0">
            <el-icon :size="40"><Star /></el-icon>
            <p>暂无评价记录</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 供应商分布 -->
    <div class="content-card distribution-card">
      <div class="card-header">
        <div class="card-title">
          <el-icon><DataLine /></el-icon>
          供应商分类分布
        </div>
      </div>
      <div class="distribution-content">
        <div class="distribution-item">
          <div class="distribution-label">
            <span class="label-text">工程建设</span>
            <span class="label-count">{{ statistics.byCategory.engineering }} 家</span>
          </div>
          <el-progress
            :percentage="Math.round(statistics.byCategory.engineering / statistics.total * 100)"
            :stroke-width="10"
            color="#064ea2"
          />
        </div>
        <div class="distribution-item">
          <div class="distribution-label">
            <span class="label-text">物资采购</span>
            <span class="label-count">{{ statistics.byCategory.material }} 家</span>
          </div>
          <el-progress
            :percentage="Math.round(statistics.byCategory.material / statistics.total * 100)"
            :stroke-width="10"
            color="#11a874"
          />
        </div>
        <div class="distribution-item">
          <div class="distribution-label">
            <span class="label-text">服务采购</span>
            <span class="label-count">{{ statistics.byCategory.service }} 家</span>
          </div>
          <el-progress
            :percentage="Math.round(statistics.byCategory.service / statistics.total * 100)"
            :stroke-width="10"
            color="#f5a623"
          />
        </div>
      </div>
    </div>

    <!-- 状态分布 -->
    <div class="content-card status-card">
      <div class="card-header">
        <div class="card-title">
          <el-icon><TrendCharts /></el-icon>
          供应商状态分布
        </div>
      </div>
      <div class="status-content">
        <div class="status-item">
          <div class="status-box pending">
            <div class="status-count">{{ statistics.byStatus.pending }}</div>
            <div class="status-label">待审核</div>
          </div>
        </div>
        <div class="status-item">
          <div class="status-box approved">
            <div class="status-count">{{ statistics.byStatus.approved }}</div>
            <div class="status-label">已入库</div>
          </div>
        </div>
        <div class="status-item">
          <div class="status-box rejected">
            <div class="status-count">{{ statistics.byStatus.rejected }}</div>
            <div class="status-label">审核不通过</div>
          </div>
        </div>
        <div class="status-item">
          <div class="status-box disabled">
            <div class="status-count">{{ statistics.byStatus.disabled }}</div>
            <div class="status-label">已停用</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-page {
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

/* 快捷入口 */
.quick-entries {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.quick-entry-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 1px solid #e8f0fa;
  box-shadow: 0 2px 8px rgba(4, 43, 92, 0.04);
}

.quick-entry-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(6, 78, 162, 0.12);
}

.entry-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.entry-title {
  font-size: 15px;
  font-weight: 700;
  color: #18243a;
}

/* 统计概览 */
.statistics-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

/* 两列布局 */
.content-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 24px;
}

.content-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  border: 1px solid #e8f0fa;
  box-shadow: 0 2px 8px rgba(4, 43, 92, 0.04);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e8f0fa;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
}

/* 待办事项 */
.todo-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.todo-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #f8fafd;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.todo-item:hover {
  background: #eef5fc;
}

.todo-priority {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.todo-priority.high {
  background: #e74c3c;
}

.todo-priority.medium {
  background: #f5a623;
}

.todo-priority.low {
  background: #11a874;
}

.todo-content {
  flex: 1;
}

.todo-title {
  font-size: 14px;
  font-weight: 600;
  color: #18243a;
  margin-bottom: 4px;
}

.todo-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.todo-time {
  font-size: 12px;
  color: #8a9aaa;
}

.todo-arrow {
  color: #b8d4f5;
  font-size: 16px;
}

.todo-item:hover .todo-arrow {
  color: #064ea2;
}

/* 最近评价 */
.evaluation-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.evaluation-item {
  padding: 12px;
  background: #f8fafd;
  border-radius: 6px;
}

.eval-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.eval-supplier {
  font-size: 14px;
  font-weight: 600;
  color: #18243a;
}

.eval-project {
  font-size: 12px;
  color: #5a6d8a;
  margin-bottom: 8px;
}

.eval-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.eval-score {
  font-size: 12px;
  color: #8a9aaa;
}

.eval-score strong {
  color: #064ea2;
  font-weight: 700;
}

.eval-date {
  font-size: 12px;
  color: #8a9aaa;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: #c0c4cc;
}

.empty-state p {
  margin-top: 12px;
  font-size: 14px;
}

/* 分布卡片 */
.distribution-card {
  margin-bottom: 24px;
}

.distribution-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.distribution-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.distribution-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.label-text {
  font-size: 14px;
  font-weight: 600;
  color: #18243a;
}

.label-count {
  font-size: 13px;
  color: #5a6d8a;
}

/* 状态分布 */
.status-content {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.status-box {
  padding: 24px;
  border-radius: 8px;
  text-align: center;
}

.status-box.pending {
  background: linear-gradient(135deg, #fff8e8, #fef3cd);
}

.status-box.approved {
  background: linear-gradient(135deg, #e8fff0, #d0f0e0);
}

.status-box.rejected {
  background: linear-gradient(135deg, #fee, #f8d8d8);
}

.status-box.disabled {
  background: #f0f0f0;
}

.status-count {
  font-size: 32px;
  font-weight: 900;
  color: #18243a;
  margin-bottom: 8px;
}

.status-label {
  font-size: 14px;
  color: #5a6d8a;
}

/* 响应式 */
@media (max-width: 1200px) {
  .quick-entries {
    grid-template-columns: repeat(2, 1fr);
  }

  .statistics-row {
    grid-template-columns: repeat(2, 1fr);
  }

  .content-row {
    grid-template-columns: 1fr;
  }

  .status-content {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .quick-entries {
    grid-template-columns: 1fr;
  }

  .statistics-row {
    grid-template-columns: 1fr;
  }

  .status-content {
    grid-template-columns: 1fr;
  }
}
</style>