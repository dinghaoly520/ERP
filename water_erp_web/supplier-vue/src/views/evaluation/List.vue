<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useEvaluationStore } from '@/stores/evaluation'
import {
  Search,
  Plus,
  View,
  Star,
  Document
} from '@element-plus/icons-vue'

const router = useRouter()
const evaluationStore = useEvaluationStore()

// 查询条件
const searchForm = ref({
  supplierName: '',
  projectName: '',
  level: '',
  dateRange: []
})

// 分页
const currentPage = ref(1)
const pageSize = ref(10)

// 等级选项
const levelOptions = [
  { value: 'A', label: 'A级（优秀）' },
  { value: 'B', label: 'B级（良好）' },
  { value: 'C', label: 'C级（一般）' },
  { value: 'D', label: 'D级（较差）' }
]

// 状态映射
const levelColorMap = {
  A: '#11a874',
  B: '#064ea2',
  C: '#f5a623',
  D: '#e74c3c'
}

// 过滤列表
const filteredList = computed(() => {
  let list = evaluationStore.mockEvaluations
  if (searchForm.value.supplierName) {
    list = list.filter(e => e.supplierName.includes(searchForm.value.supplierName))
  }
  if (searchForm.value.projectName) {
    list = list.filter(e => e.projectName.includes(searchForm.value.projectName))
  }
  if (searchForm.value.level) {
    list = list.filter(e => e.level === searchForm.value.level)
  }
  return list
})

// 分页数据
const pagedList = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredList.value.slice(start, start + pageSize.value)
})

// 查询
const handleSearch = () => {
  currentPage.value = 1
}

// 重置
const handleReset = () => {
  searchForm.value = { supplierName: '', projectName: '', level: '', dateRange: [] }
  currentPage.value = 1
}

// 发起评价
const handleCreate = () => {
  router.push('/evaluation/create')
}

// 查看详情
const handleDetail = (row) => {
  router.push(`/evaluation/detail/${row.id}`)
}
</script>

<template>
  <div class="evaluation-list-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1 class="page-title">供应商评价</h1>
      <p class="page-subtitle">记录供应商在招采活动中的表现，形成信用参考</p>
    </div>

    <!-- 查询条件 -->
    <div class="search-card">
      <el-form :model="searchForm" inline>
        <el-form-item label="供应商">
          <el-input v-model="searchForm.supplierName" placeholder="请输入供应商名称" clearable style="width: 180px" />
        </el-form-item>
        <el-form-item label="项目名称">
          <el-input v-model="searchForm.projectName" placeholder="请输入项目名称" clearable style="width: 180px" />
        </el-form-item>
        <el-form-item label="评价等级">
          <el-select v-model="searchForm.level" placeholder="请选择" clearable style="width: 140px">
            <el-option v-for="l in levelOptions" :key="l.value" :label="l.label" :value="l.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">
            <el-icon><Search /></el-icon>查询
          </el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="success" @click="handleCreate">
            <el-icon><Plus /></el-icon>发起评价
          </el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 评价列表 -->
    <div class="table-card">
      <el-table :data="pagedList" stripe border style="width: 100%">
        <el-table-column prop="id" label="评价编号" width="140" />
        <el-table-column prop="supplierName" label="供应商" min-width="180" />
        <el-table-column prop="projectName" label="项目名称" min-width="180" />
        <el-table-column prop="totalScore" label="得分" width="80" align="center">
          <template #default="{ row }">
            <span class="score-value">{{ row.totalScore }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="level" label="等级" width="80" align="center">
          <template #default="{ row }">
            <el-tag :style="{ background: levelColorMap[row.level], borderColor: levelColorMap[row.level], color: '#fff' }" size="small">
              {{ row.level }}级
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="evaluator" label="评价人" width="100" />
        <el-table-column prop="evaluateDate" label="评价时间" width="120" />
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="handleDetail(row)">
              <el-icon><View /></el-icon>详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="filteredList.length"
          layout="total, prev, pager, next"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.evaluation-list-page {
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

.search-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
  border: 1px solid #e8f0fa;
}

.table-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  border: 1px solid #e8f0fa;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.score-value {
  font-size: 16px;
  font-weight: 800;
  color: #064ea2;
}
</style>