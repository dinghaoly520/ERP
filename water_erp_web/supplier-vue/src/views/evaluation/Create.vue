<script setup>
import { ref, computed, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { useEvaluationStore } from '@/stores/evaluation'
import { ElMessage } from 'element-plus'
import {
  Star,
  Document,
  Check,
  Back
} from '@element-plus/icons-vue'

const router = useRouter()
const supplierStore = useSupplierStore()
const evaluationStore = useEvaluationStore()

// 表单数据
const formData = reactive({
  supplierId: '',
  projectId: '',
  projectName: '',
  scores: {
    dataIntegrity: 80,
    fileResponse: 80,
    cooperation: 80,
    compliance: 90,
    overall: 80
  },
  comment: ''
})

// 供应商选项
const supplierOptions = computed(() =>
  supplierStore.approvedSuppliers.map(s => ({
    value: s.id,
    label: s.name
  }))
)

// 评价指标
const indicators = computed(() => evaluationStore.indicators)

// 实时计算总分
const totalScore = computed(() => {
  return evaluationStore.calculateTotalScore(formData.scores)
})

// 预计等级
const estimatedLevel = computed(() => {
  return evaluationStore.getLevel(totalScore.value)
})

// 提交评价
const handleSubmit = () => {
  if (!formData.supplierId) {
    ElMessage.warning('请选择供应商')
    return
  }
  if (!formData.projectName) {
    ElMessage.warning('请输入项目名称')
    return
  }

  const supplier = supplierStore.getSupplierById(formData.supplierId)
  const evaluation = {
    supplierId: formData.supplierId,
    supplierName: supplier?.name,
    projectId: formData.projectId || `PRJ-${Date.now()}`,
    projectName: formData.projectName,
    scores: { ...formData.scores },
    comment: formData.comment,
    evaluator: '管理员'
  }

  evaluationStore.addEvaluation(evaluation)
  ElMessage.success('评价提交成功')
  router.push('/evaluation')
}

// 返回
const handleBack = () => {
  router.push('/evaluation')
}
</script>

<template>
  <div class="create-evaluation-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <el-button @click="handleBack" link>
        <el-icon><Back /></el-icon>返回列表
      </el-button>
      <h1 class="page-title">发起供应商评价</h1>
      <p class="page-subtitle">对供应商在招采项目中的表现进行评价</p>
    </div>

    <!-- 评价表单 -->
    <div class="form-card">
      <!-- 基本信息 -->
      <div class="form-section">
        <div class="section-title">基本信息</div>
        <el-form :model="formData" label-width="120px">
          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="供应商" required>
                <el-select v-model="formData.supplierId" placeholder="请选择供应商" filterable style="width: 100%">
                  <el-option v-for="s in supplierOptions" :key="s.value" :label="s.label" :value="s.value" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="项目名称" required>
                <el-input v-model="formData.projectName" placeholder="请输入项目名称" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </div>

      <!-- 评价指标 -->
      <div class="form-section">
        <div class="section-title">评价指标</div>
        <div class="indicators-grid">
          <div class="indicator-item" v-for="indicator in indicators" :key="indicator.id">
            <div class="indicator-header">
              <div class="indicator-info">
                <span class="indicator-name">{{ indicator.name }}</span>
                <span class="indicator-weight">权重 {{ indicator.weight }}%</span>
              </div>
              <span class="indicator-score">
                {{ indicator.id === 1 ? formData.scores.dataIntegrity :
                   indicator.id === 2 ? formData.scores.fileResponse :
                   indicator.id === 3 ? formData.scores.cooperation :
                   indicator.id === 4 ? formData.scores.compliance :
                   formData.scores.overall }}分
              </span>
            </div>
            <el-slider
              v-model="formData.scores[
                indicator.id === 1 ? 'dataIntegrity' :
                indicator.id === 2 ? 'fileResponse' :
                indicator.id === 3 ? 'cooperation' :
                indicator.id === 4 ? 'compliance' : 'overall'
              ]"
              :min="0"
              :max="100"
              :show-tooltip="false"
            />
            <div class="indicator-desc">{{ indicator.description }}</div>
          </div>
        </div>
      </div>

      <!-- 评价汇总 -->
      <div class="form-section">
        <div class="section-title">评价汇总</div>
        <div class="summary-card">
          <div class="summary-item">
            <span class="summary-label">综合得分</span>
            <span class="summary-value score">{{ totalScore }}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">预计等级</span>
            <el-tag :type="estimatedLevel === 'A' ? 'success' : estimatedLevel === 'B' ? 'primary' : estimatedLevel === 'C' ? 'warning' : 'danger'" size="large">
              {{ estimatedLevel }}级
            </el-tag>
          </div>
        </div>
      </div>

      <!-- 评价意见 -->
      <div class="form-section">
        <div class="section-title">评价意见</div>
        <el-form :model="formData" label-width="120px">
          <el-form-item label="评价意见">
            <el-input v-model="formData.comment" type="textarea" :rows="4" placeholder="请输入评价意见（选填）" />
          </el-form-item>
        </el-form>
      </div>

      <!-- 操作按钮 -->
      <div class="form-actions">
        <el-button @click="handleBack">取消</el-button>
        <el-button type="primary" @click="handleSubmit">
          <el-icon><Check /></el-icon>提交评价
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.create-evaluation-page {
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
  margin: 16px 0 8px;
}

.page-subtitle {
  font-size: 14px;
  color: #8a9aaa;
}

.form-card {
  background: #fff;
  border-radius: 8px;
  padding: 32px;
  border: 1px solid #e8f0fa;
}

.form-section {
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

.indicators-grid {
  display: grid;
  gap: 24px;
}

.indicator-item {
  padding: 20px;
  background: #f8fafd;
  border-radius: 8px;
}

.indicator-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.indicator-name {
  font-size: 15px;
  font-weight: 600;
  color: #18243a;
  margin-right: 12px;
}

.indicator-weight {
  font-size: 12px;
  color: #8a9aaa;
  background: #e8f2ff;
  padding: 2px 8px;
  border-radius: 10px;
}

.indicator-score {
  font-size: 18px;
  font-weight: 800;
  color: #064ea2;
}

.indicator-desc {
  font-size: 12px;
  color: #8a9aaa;
  margin-top: 8px;
}

.summary-card {
  display: flex;
  gap: 48px;
  padding: 24px;
  background: linear-gradient(135deg, #f8fafd, #eef5fb);
  border-radius: 8px;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 16px;
}

.summary-label {
  font-size: 14px;
  color: #5a6d8a;
}

.summary-value {
  font-size: 36px;
  font-weight: 900;
}

.summary-value.score {
  color: #064ea2;
}

.form-actions {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding-top: 24px;
  border-top: 1px solid #e8f0fa;
}
</style>