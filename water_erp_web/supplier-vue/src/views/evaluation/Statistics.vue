<script setup>
import { computed } from 'vue'
import { useEvaluationStore } from '@/stores/evaluation'
import {
  TrendCharts,
  DataLine
} from '@element-plus/icons-vue'

const evaluationStore = useEvaluationStore()

// 统计数据
const statistics = computed(() => evaluationStore.statistics)

// 等级分布
const levelDistribution = computed(() => evaluationStore.levels.map(level => ({
  ...level,
  count: evaluationStore.statistics.levelDistribution[level.name] || 0
})))

// 饼图数据
const pieData = computed(() => levelDistribution.value.map(l => ({
  value: l.count,
  name: `${l.name}级 (${l.label})`
})))
</script>

<template>
  <div class="statistics-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1 class="page-title">评价统计</h1>
      <p class="page-subtitle">供应商评价数据统计分析</p>
    </div>

    <!-- 统计概览 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-icon blue">
          <el-icon :size="24"><DataLine /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ statistics.totalEvaluations }}</div>
          <div class="stat-label">评价总数</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green">
          <el-icon :size="24"><TrendCharts /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ statistics.averageScore }}</div>
          <div class="stat-label">平均得分</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon orange">
          <el-icon :size="24"><TrendCharts /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ statistics.abnormalCount }}</div>
          <div class="stat-label">异常记录</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red">
          <el-icon :size="24"><TrendCharts /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ statistics.blacklistedCount }}</div>
          <div class="stat-label">黑名单数</div>
        </div>
      </div>
    </div>

    <!-- 等级分布 -->
    <div class="distribution-card">
      <div class="card-title">评价等级分布</div>
      <div class="distribution-content">
        <div class="distribution-chart">
          <div class="level-item" v-for="level in levelDistribution" :key="level.name">
            <div class="level-header">
              <span class="level-name" :style="{ color: level.color }">{{ level.name }}级</span>
              <span class="level-label">{{ level.label }}</span>
            </div>
            <div class="level-bar">
              <el-progress
                :percentage="Math.round(level.count / statistics.totalEvaluations * 100)"
                :stroke-width="20"
                :color="level.color"
              >
                <span class="level-count">{{ level.count }}次</span>
              </el-progress>
            </div>
          </div>
        </div>
        <div class="distribution-summary">
          <div class="summary-item" v-for="level in levelDistribution" :key="level.name">
            <div class="summary-dot" :style="{ background: level.color }"></div>
            <div class="summary-info">
              <div class="summary-name">{{ level.name }}级 - {{ level.label }}</div>
              <div class="summary-range">得分范围：{{ level.minScore }}分以上</div>
            </div>
            <div class="summary-count">{{ level.count }}次</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 评价趋势 -->
    <div class="trend-card">
      <div class="card-title">近期评价趋势</div>
      <div class="trend-content">
        <el-table :data="[
          { month: '2024年5月', count: 28, avgScore: 88.5 },
          { month: '2024年4月', count: 35, avgScore: 86.2 },
          { month: '2024年3月', count: 42, avgScore: 87.8 },
          { month: '2024年2月', count: 25, avgScore: 85.6 },
          { month: '2024年1月', count: 26, avgScore: 89.2 }
        ]" border style="width: 100%">
          <el-table-column prop="month" label="月份" width="150" />
          <el-table-column prop="count" label="评价次数" width="120" />
          <el-table-column prop="avgScore" label="平均得分" width="120" />
          <el-table-column label="趋势">
            <template #default="{ row }">
              <el-progress :percentage="row.avgScore" :stroke-width="10" color="#064ea2" />
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.statistics-page {
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
  grid-template-columns: repeat(4, 1fr);
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

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.stat-icon.blue { background: linear-gradient(135deg, #064ea2, #39a8ff); }
.stat-icon.green { background: linear-gradient(135deg, #11a874, #2dd4a0); }
.stat-icon.orange { background: linear-gradient(135deg, #f5a623, #f7c873); }
.stat-icon.red { background: linear-gradient(135deg, #e74c3c, #f1948a); }

.stat-value {
  font-size: 28px;
  font-weight: 900;
  color: #18243a;
}

.stat-label {
  font-size: 13px;
  color: #8a9aaa;
}

.distribution-card {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 24px;
  border: 1px solid #e8f0fa;
}

.card-title {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
  margin-bottom: 20px;
}

.distribution-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
}

.level-item {
  margin-bottom: 20px;
}

.level-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.level-name {
  font-size: 18px;
  font-weight: 800;
}

.level-label {
  font-size: 13px;
  color: #8a9aaa;
}

.level-count {
  font-weight: 700;
}

.distribution-summary {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #f8fafd;
  border-radius: 8px;
}

.summary-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.summary-info {
  flex: 1;
}

.summary-name {
  font-size: 14px;
  font-weight: 600;
  color: #18243a;
}

.summary-range {
  font-size: 12px;
  color: #8a9aaa;
}

.summary-count {
  font-size: 16px;
  font-weight: 800;
  color: #064ea2;
}

.trend-card {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  border: 1px solid #e8f0fa;
}

@media (max-width: 1200px) {
  .stats-row {
    grid-template-columns: repeat(2, 1fr);
  }

  .distribution-content {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .stats-row {
    grid-template-columns: 1fr;
  }
}
</style>