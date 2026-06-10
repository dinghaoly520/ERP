<script setup>
import { ref, computed } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage } from 'element-plus'
import {
  Search,
  Check,
  Close,
  View,
  Document
} from '@element-plus/icons-vue'

const supplierStore = useSupplierStore()

// 模拟变更申请数据
const changeRequests = ref([
  {
    id: 'CHG-2024-001',
    supplierId: 'SUP-2024-0001',
    supplierName: '四川川水建设工程有限公司',
    type: 'contact',
    typeName: '联系人变更',
    changes: [
      { field: '联系人', oldValue: '李华', newValue: '王新' },
      { field: '联系电话', oldValue: '13800138001', newValue: '13900139001' }
    ],
    reason: '原联系人已离职',
    status: 'pending',
    createTime: '2024-05-19 10:15'
  },
  {
    id: 'CHG-2024-002',
    supplierId: 'SUP-2024-0002',
    supplierName: '成都华西物资供应有限公司',
    type: 'qualification',
    typeName: '资质变更',
    changes: [
      { field: '营业执照', oldValue: '旧版执照', newValue: '新版执照（延期至2028年）' }
    ],
    reason: '营业执照到期换证',
    status: 'pending',
    createTime: '2024-05-18 14:30'
  }
])

// 查询条件
const searchForm = ref({
  supplierName: '',
  type: '',
  status: ''
})

// 变更类型
const changeTypes = [
  { value: 'contact', label: '联系人变更' },
  { value: 'qualification', label: '资质变更' },
  { value: 'bank', label: '银行账户变更' },
  { value: 'address', label: '地址变更' }
]

// 状态选项
const statusOptions = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' }
]

// 分页
const currentPage = ref(1)
const pageSize = ref(10)

// 过滤列表
const filteredList = computed(() => {
  let list = changeRequests.value
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

// 审核对话框
const auditDialogVisible = ref(false)
const currentRequest = ref(null)
const auditForm = ref({
  result: '',
  reason: ''
})

// 查询
const handleSearch = () => {
  currentPage.value = 1
}

// 重置
const handleReset = () => {
  searchForm.value = { supplierName: '', type: '', status: '' }
  currentPage.value = 1
}

// 打开审核
const handleAudit = (row) => {
  currentRequest.value = row
  auditForm.value = { result: '', reason: '' }
  auditDialogVisible.value = true
}

// 提交审核
const submitAudit = () => {
  if (!auditForm.value.result) {
    ElMessage.warning('请选择审核结果')
    return
  }

  const request = changeRequests.value.find(r => r.id === currentRequest.value.id)
  if (request) {
    request.status = auditForm.value.result
  }

  ElMessage.success('审核已提交')
  auditDialogVisible.value = false
}
</script>

<template>
  <div class="change-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1 class="page-title">信息变更审核</h1>
      <p class="page-subtitle">审核供应商提交的关键信息变更申请</p>
    </div>

    <!-- 查询条件 -->
    <div class="search-card">
      <el-form :model="searchForm" inline>
        <el-form-item label="供应商名称">
          <el-input v-model="searchForm.supplierName" placeholder="请输入" clearable style="width: 200px" />
        </el-form-item>
        <el-form-item label="变更类型">
          <el-select v-model="searchForm.type" placeholder="请选择" clearable style="width: 140px">
            <el-option v-for="t in changeTypes" :key="t.value" :label="t.label" :value="t.value" />
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
        </el-form-item>
      </el-form>
    </div>

    <!-- 变更列表 -->
    <div class="table-card">
      <el-table :data="pagedList" stripe border style="width: 100%">
        <el-table-column prop="id" label="变更编号" width="140" />
        <el-table-column prop="supplierName" label="供应商" min-width="180" />
        <el-table-column prop="typeName" label="变更类型" width="120" />
        <el-table-column label="变更内容" min-width="250">
          <template #default="{ row }">
            <div v-for="(change, index) in row.changes" :key="index" class="change-item">
              <span class="field-name">{{ change.field }}：</span>
              <span class="old-value">{{ change.oldValue }}</span>
              <el-icon><Right /></el-icon>
              <span class="new-value">{{ change.newValue }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="变更原因" width="150" show-overflow-tooltip />
        <el-table-column prop="createTime" label="申请时间" width="150" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'pending' ? 'warning' : row.status === 'approved' ? 'success' : 'danger'" size="small">
              {{ statusOptions.find(s => s.value === row.status)?.label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'pending'" type="primary" size="small" @click="handleAudit(row)">
              <el-icon><Check /></el-icon>审核
            </el-button>
            <el-button v-else type="info" link size="small">已处理</el-button>
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

    <!-- 审核对话框 -->
    <el-dialog v-model="auditDialogVisible" title="信息变更审核" width="600px">
      <div class="audit-info" v-if="currentRequest">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="供应商">{{ currentRequest.supplierName }}</el-descriptions-item>
          <el-descriptions-item label="变更类型">{{ currentRequest.typeName }}</el-descriptions-item>
        </el-descriptions>

        <div class="change-details">
          <h4>变更详情</h4>
          <div v-for="(change, index) in currentRequest.changes" :key="index" class="change-detail-item">
            <span class="label">{{ change.field }}</span>
            <div class="values">
              <span class="old">{{ change.oldValue }}</span>
              <el-icon><Right /></el-icon>
              <span class="new">{{ change.newValue }}</span>
            </div>
          </div>
        </div>

        <div class="change-reason">
          <strong>变更原因：</strong>{{ currentRequest.reason }}
        </div>
      </div>

      <el-form :model="auditForm" label-width="100px" style="margin-top: 20px;">
        <el-form-item label="审核结果" required>
          <el-radio-group v-model="auditForm.result">
            <el-radio value="approved">同意变更</el-radio>
            <el-radio value="rejected">拒绝变更</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="审核意见">
          <el-input v-model="auditForm.reason" type="textarea" :rows="3" placeholder="请填写审核意见" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="auditDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAudit">提交审核</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.change-page {
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

.change-item {
  font-size: 13px;
  margin-bottom: 4px;
}

.field-name {
  color: #8a9aaa;
}

.old-value {
  color: #e74c3c;
  text-decoration: line-through;
}

.new-value {
  color: #11a874;
}

.audit-info {
  padding: 16px;
  background: #f8fafd;
  border-radius: 8px;
}

.change-details {
  margin-top: 16px;
}

.change-details h4 {
  font-size: 14px;
  font-weight: 600;
  color: #18243a;
  margin-bottom: 12px;
}

.change-detail-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: #fff;
  border-radius: 6px;
  margin-bottom: 8px;
}

.change-detail-item .label {
  width: 80px;
  font-weight: 600;
  color: #5a6d8a;
}

.change-detail-item .values {
  display: flex;
  align-items: center;
  gap: 8px;
}

.change-detail-item .old {
  color: #e74c3c;
}

.change-detail-item .new {
  color: #11a874;
  font-weight: 600;
}

.change-reason {
  margin-top: 16px;
  padding: 12px;
  background: #fff8e8;
  border-radius: 6px;
  font-size: 14px;
  color: #5a6d8a;
}
</style>