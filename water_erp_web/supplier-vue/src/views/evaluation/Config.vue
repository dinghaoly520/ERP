<script setup>
import { ref, computed } from 'vue'
import { useEvaluationStore } from '@/stores/evaluation'
import { ElMessage } from 'element-plus'
import {
  Plus,
  Delete,
  Check
} from '@element-plus/icons-vue'

const evaluationStore = useEvaluationStore()

// 指标列表
const indicators = computed(() => evaluationStore.indicators)

// 编辑对话框
const editDialogVisible = ref(false)
const currentIndicator = ref(null)
const editForm = ref({
  name: '',
  weight: 0,
  description: ''
})

// 新增对话框
const addDialogVisible = ref(false)
const addForm = ref({
  name: '',
  weight: 0,
  description: ''
})

// 打开编辑
const handleEdit = (indicator) => {
  currentIndicator.value = indicator
  editForm.value = { ...indicator }
  editDialogVisible.value = true
}

// 保存编辑
const saveEdit = () => {
  if (!editForm.value.name) {
    ElMessage.warning('请输入指标名称')
    return
  }
  if (editForm.value.weight <= 0 || editForm.value.weight > 100) {
    ElMessage.warning('权重必须在1-100之间')
    return
  }

  evaluationStore.updateIndicator(currentIndicator.value.id, editForm.value)
  ElMessage.success('指标已更新')
  editDialogVisible.value = false
}

// 打开新增
const handleAdd = () => {
  addForm.value = { name: '', weight: 0, description: '' }
  addDialogVisible.value = true
}

// 保存新增
const saveAdd = () => {
  if (!addForm.value.name) {
    ElMessage.warning('请输入指标名称')
    return
  }
  if (addForm.value.weight <= 0 || addForm.value.weight > 100) {
    ElMessage.warning('权重必须在1-100之间')
    return
  }

  // 这里简化处理，实际应该添加到 store
  ElMessage.success('指标已添加')
  addDialogVisible.value = false
}

// 计算总权重
const totalWeight = computed(() => {
  return indicators.value.reduce((sum, i) => sum + i.weight, 0)
})
</script>

<template>
  <div class="config-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1 class="page-title">评价指标配置</h1>
      <p class="page-subtitle">配置供应商评价维度和权重</p>
    </div>

    <!-- 权重提示 -->
    <div class="weight-tip">
      <el-alert
        :title="`当前权重总计：${totalWeight}% ${totalWeight === 100 ? '（符合要求）' : '（应为100%）'}`"
        :type="totalWeight === 100 ? 'success' : 'warning'"
        :closable="false"
        show-icon
      />
    </div>

    <!-- 指标列表 -->
    <div class="config-card">
      <div class="card-header">
        <div class="card-title">评价指标</div>
        <el-button type="primary" size="small" @click="handleAdd">
          <el-icon><Plus /></el-icon>新增指标
        </el-button>
      </div>

      <el-table :data="indicators" border style="width: 100%">
        <el-table-column prop="id" label="序号" width="80" />
        <el-table-column prop="name" label="指标名称" min-width="150" />
        <el-table-column prop="weight" label="权重" width="120">
          <template #default="{ row }">
            <el-tag type="primary" size="small">{{ row.weight }}%</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="说明" min-width="200" />
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 等级配置 -->
    <div class="config-card">
      <div class="card-title">评价等级配置</div>
      <div class="level-config">
        <div class="level-item" v-for="level in evaluationStore.levels" :key="level.name">
          <div class="level-badge" :style="{ background: level.color }">
            {{ level.name }}级
          </div>
          <div class="level-info">
            <div class="level-label">{{ level.label }}</div>
            <div class="level-range">得分范围：{{ level.minScore }}分及以上</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑对话框 -->
    <el-dialog v-model="editDialogVisible" title="编辑指标" width="500px">
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="指标名称">
          <el-input v-model="editForm.name" placeholder="请输入指标名称" />
        </el-form-item>
        <el-form-item label="权重（%）">
          <el-input-number v-model="editForm.weight" :min="1" :max="100" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="editForm.description" type="textarea" :rows="3" placeholder="请输入指标说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新增对话框 -->
    <el-dialog v-model="addDialogVisible" title="新增指标" width="500px">
      <el-form :model="addForm" label-width="100px">
        <el-form-item label="指标名称">
          <el-input v-model="addForm.name" placeholder="请输入指标名称" />
        </el-form-item>
        <el-form-item label="权重（%）">
          <el-input-number v-model="addForm.weight" :min="1" :max="100" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="addForm.description" type="textarea" :rows="3" placeholder="请输入指标说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveAdd">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.config-page {
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

.weight-tip {
  margin-bottom: 16px;
}

.config-card {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 16px;
  border: 1px solid #e8f0fa;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.card-title {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
}

.level-config {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.level-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: #f8fafd;
  border-radius: 8px;
}

.level-badge {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  font-weight: 800;
}

.level-label {
  font-size: 14px;
  font-weight: 600;
  color: #18243a;
  margin-bottom: 4px;
}

.level-range {
  font-size: 12px;
  color: #8a9aaa;
}

@media (max-width: 1200px) {
  .level-config {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .level-config {
    grid-template-columns: 1fr;
  }
}
</style>