<script setup>
import { ref, computed } from 'vue'
import { useEvaluationStore } from '@/stores/evaluation'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Search,
  Plus,
  View,
  Warning,
  Document
} from '@element-plus/icons-vue'

const evaluationStore = useEvaluationStore()

// 查询条件
const searchForm = ref({
  supplierName: '',
  type: '',
  status: ''
})

// 分页
const currentPage = ref(1)
const pageSize = ref(10)

// 异常类型
const abnormalTypes = computed(() => evaluationStore.abnormalTypes)

// 异常列表
const abnormalRecords = computed(() => evaluationStore.mockAbnormals)

// 过滤列表
const filteredList = computed(() => {
  let list = abnormalRecords.value
  if (searchForm.value.supplierName) {
    list = list.filter(r => r.supplierName.includes(searchForm.value.supplierName))
  }
  if (searchForm.value.type) {
    list = list.filter(r => r.type === searchForm.value.type)
  }
  if (searchForm.value.status) {
    list = list.filter(r => r.status === searchForm.value.status)
  }
  return list
})

// 分页数据
const pagedList = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredList.value.slice(start, start + pageSize.value)
})

// 新增对话框
const addDialogVisible = ref(false)
const addForm = ref({
  supplierId: '',
  supplierName: '',
  type: '',
  description: '',
  projectName: '',
  evidence: ''
})

// 状态选项
const statusOptions = [
  { value: 'pending', label: '待处理' },
  { value: 'resolved', label: '已处理' }
]

// 查询
const handleSearch = () => {
  currentPage.value = 1
}

// 重置
const handleReset = () => {
  searchForm.value = { supplierName: '', type: '', status: '' }
  currentPage.value = 1
}

// 新增异常记录
const handleAdd = () => {
  addDialogVisible.value = true
}

// 提交新增
const submitAdd = () => {
  if (!addForm.value.supplierName) {
    ElMessage.warning('请输入供应商名称')
    return
  }
  if (!addForm.value.type) {
    ElMessage.warning('请选择异常类型')
    return
  }
  if (!addForm.value.description) {
    ElMessage.warning('请输入异常描述')
    return
  }

  evaluationStore.addAbnormalRecord({
    supplierName: addForm.value.supplierName,
    type: addForm.value.type,
    typeName: abnormalTypes.value.find(t => t.value === addForm.value.type)?.label,
    description: addForm.value.description,
    projectName: addForm.value.projectName
  })

  ElMessage.success('异常记录已添加')
  addDialogVisible.value = false
  addForm.value = { supplierId: '', supplierName: '', type: '', description: '', projectName: '', evidence: '' }
}
</script>

<template>
  <div class="abnormal-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1 class="page-title">异常记录</h1>
      <p class="page-subtitle">记录供应商在招采过程中的异常行为</p>
    </div>

    <!-- 查询条件 -->
    <div class="search-card">
      <el-form :model="searchForm" inline>
        <el-form-item label="供应商">
          <el-input v-model="searchForm.supplierName" placeholder="请输入供应商名称" clearable style="width: 180px" />
        </el-form-item>
        <el-form-item label="异常类型">
          <el-select v-model="searchForm.type" placeholder="请选择" clearable style="width: 160px">
            <el-option v-for="t in abnormalTypes" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.status" placeholder="请选择" clearable style="width: 120px">
            <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">
            <el-icon><Search /></el-icon>查询
          </el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="danger" @click="handleAdd">
            <el-icon><Plus /></el-icon>新增异常记录
          </el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 异常列表 -->
    <div class="table-card">
      <el-table :data="pagedList" stripe border style="width: 100%">
        <el-table-column prop="id" label="记录编号" width="140" />
        <el-table-column prop="supplierName" label="供应商" min-width="180" />
        <el-table-column prop="typeName" label="异常类型" width="150" />
        <el-table-column prop="projectName" label="关联项目" width="150" />
        <el-table-column prop="description" label="异常描述" min-width="200" show-overflow-tooltip />
        <el-table-column prop="handleDate" label="处理日期" width="120" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'pending' ? 'warning' : 'success'" size="small">
              {{ row.status === 'pending' ? '待处理' : '已处理' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small">
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

    <!-- 新增对话框 -->
    <el-dialog v-model="addDialogVisible" title="新增异常记录" width="600px">
      <el-form :model="addForm" label-width="100px">
        <el-form-item label="供应商" required>
          <el-input v-model="addForm.supplierName" placeholder="请输入供应商名称" />
        </el-form-item>
        <el-form-item label="异常类型" required>
          <el-select v-model="addForm.type" placeholder="请选择异常类型" style="width: 100%">
            <el-option v-for="t in abnormalTypes" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联项目">
          <el-input v-model="addForm.projectName" placeholder="请输入关联项目名称（选填）" />
        </el-form-item>
        <el-form-item label="异常描述" required>
          <el-input v-model="addForm.description" type="textarea" :rows="4" placeholder="请详细描述异常情况" />
        </el-form-item>
        <el-form-item label="证明材料">
          <el-upload action="#" :auto-upload="false">
            <el-button type="primary">上传文件</el-button>
            <template #tip>
              <div class="el-upload__tip">支持 PDF、图片格式文件</div>
            </template>
          </el-upload>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="addDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAdd">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.abnormal-page {
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
</style>