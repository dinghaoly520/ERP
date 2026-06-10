<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEvaluationStore } from '@/stores/evaluation'
import {
  Back,
  Star
} from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const evaluationStore = useEvaluationStore()

// 当前评价
const evaluation = ref(null)

// 等级颜色
const levelColorMap = {
  A: '#11a874',
  B: '#064ea2',
  C: '#f5a623',
  D: '#e74c3c'
}

// 加载数据
onMounted(() => {
  const id = route.params.id
  evaluation.value = evaluationStore.getEvaluationById(id)
})

// 返回
const handleBack = () => {
  router.push('/evaluation')
}
</script>

<template>
  <div class="evaluation-detail-page" v-if="evaluation">
    <!-- 页面头部 -->
    <div class="detail-header">
      <el-button @click="handleBack" link>
        <el-icon><Back /></el-icon>返回列表
      </el-button>
    </div>

    <!-- 评价概览 -->
    <div class="overview-card">
      <div class="overview-header">
        <div class="supplier-info">
          <div class="supplier-name">{{ evaluation.supplierName }}</div>
          <div class="project-name">{{ evaluation.projectName }}</div>
        </div>
        <div class="score-info">
          <div class="score-value">{{ evaluation.totalScore }}</div>
          <div class="score-label">综合得分</div>
        </div>
        <div class="level-info">
          <el-tag :style="{ background: levelColorMap[evaluation.level], borderColor: levelColorMap[evaluation.level], color: '#fff' }" size="large">
            {{ evaluation.level }}级
          </el-tag>
        </div>
      </div>
    </div>

    <!-- 详细信息 -->
    <div class="detail-card">
      <!-- 基本信息 -->
      <div class="detail-section">
        <div class="section-title">基本信息</div>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="评价编号">{{ evaluation.id }}</el-descriptions-item>
          <el-descriptions-item label="供应商">{{ evaluation.supplierName }}</el-descriptions-item>
          <el-descriptions-item label="项目名称">{{ evaluation.projectName }}</el-descriptions-item>
          <el-descriptions-item label="评价人">{{ evaluation.evaluator }}</el-descriptions-item>
          <el-descriptions-item label="评价时间">{{ evaluation.evaluateDate }}</el-descriptions-item>
          <el-descriptions-item label="评价等级">{{ evaluation.level }}级</el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- 评分明细 -->
      <div class="detail-section">
        <div class="section-title">评分明细</div>
        <div class="scores-grid">
          <div class="score-item">
            <div class="score-header">
              <span class="score-name">资料完整性</span>
              <span class="score-weight">权重 20%</span>
            </div>
            <div class="score-bar">
              <el-progress :percentage="evaluation.scores.dataIntegrity" :stroke-width="10" color="#064ea2" />
            </div>
            <div class="score-value">{{ evaluation.scores.dataIntegrity }}分</div>
          </div>
          <div class="score-item">
            <div class="score-header">
              <span class="score-name">文件响应情况</span>
              <span class="score-weight">权重 30%</span>
            </div>
            <div class="score-bar">
              <el-progress :percentage="evaluation.scores.fileResponse" :stroke-width="10" color="#11a874" />
            </div>
            <div class="score-value">{{ evaluation.scores.fileResponse }}分</div>
          </div>
          <div class="score-item">
            <div class="score-header">
              <span class="score-name">参与配合情况</span>
              <span class="score-weight">权重 20%</span>
            </div>
            <div class="score-bar">
              <el-progress :percentage="evaluation.scores.cooperation" :stroke-width="10" color="#0a7ed3" />
            </div>
            <div class="score-value">{{ evaluation.scores.cooperation }}分</div>
          </div>
          <div class="score-item">
            <div class="score-header">
              <span class="score-name">规范合规情况</span>
              <span class="score-weight">权重 20%</span>
            </div>
            <div class="score-bar">
              <el-progress :percentage="evaluation.scores.compliance" :stroke-width="10" color="#f5a623" />
            </div>
            <div class="score-value">{{ evaluation.scores.compliance }}分</div>
          </div>
          <div class="score-item">
            <div class="score-header">
              <span class="score-name">综合评价</span>
              <span class="score-weight">权重 10%</span>
            </div>
            <div class="score-bar">
              <el-progress :percentage="evaluation.scores.overall" :stroke-width="10" color="#9b59b6" />
            </div>
            <div class="score-value">{{ evaluation.scores.overall }}分</div>
          </div>
        </div>
      </div>

      <!-- 评价意见 -->
      <div class="detail-section">
        <div class="section-title">评价意见</div>
        <div class="comment-content">
          {{ evaluation.comment || '暂无评价意见' }}
        </div>
      </div>
    </div>
  </div>

  <div class="empty-page" v-else>
    <el-empty description="评价记录不存在" />
  </div>
</template>

<style scoped>
.evaluation-detail-page {
  padding: 24px;
  background: #f6f9fd;
  min-height: calc(100vh - 60px);
}

.detail-header {
  margin-bottom: 16px;
}

.overview-card {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 16px;
  border: 1px solid #e8f0fa;
}

.overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.supplier-name {
  font-size: 20px;
  font-weight: 800;
  color: #18243a;
  margin-bottom: 8px;
}

.project-name {
  font-size: 14px;
  color: #5a6d8a;
}

.score-info {
  text-align: center;
}

.score-value {
  font-size: 48px;
  font-weight: 900;
  color: #064ea2;
}

.score-label {
  font-size: 14px;
  color: #8a9aaa;
}

.detail-card {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  border: 1px solid #e8f0fa;
}

.detail-section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e8f0fa;
}

.scores-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.score-item {
  padding: 16px;
  background: #f8fafd;
  border-radius: 8px;
}

.score-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}

.score-name {
  font-size: 14px;
  font-weight: 600;
  color: #18243a;
}

.score-weight {
  font-size: 12px;
  color: #8a9aaa;
}

.score-bar {
  margin-bottom: 8px;
}

.score-item .score-value {
  font-size: 18px;
  font-weight: 800;
  color: #064ea2;
  text-align: right;
}

.comment-content {
  padding: 16px;
  background: #f8fafd;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.8;
  color: #5a6d8a;
}

.empty-page {
  padding: 60px;
  display: flex;
  justify-content: center;
}

@media (max-width: 768px) {
  .scores-grid {
    grid-template-columns: 1fr;
  }
}
</style>