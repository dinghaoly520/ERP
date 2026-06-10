<script setup>
import { ref, computed } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Search,
  Check,
  Close,
  View,
  Document
} from '@element-plus/icons-vue'

const supplierStore = useSupplierStore()

// 查询条件
const searchForm = ref({
  name: '',
  dateRange: []
})

// 分页
const currentPage = ref(1)
const pageSize = ref(10)

// 待审核供应商列表
const pendingSuppliers = computed(() => {
  return supplierStore.mockSuppliers.filter(s => s.status === 'pending')
})

// 过滤后的列表
const filteredList = computed(() => {
  let list = pendingSuppliers.value
  if (searchForm.value.name) {
    list = list.filter(s => s.name.includes(searchForm.value.name))
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
const currentSupplier = ref(null)
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
  searchForm.value = { name: '', dateRange: [] }
  currentPage.value = 1
}

// 打开审核
const handleAudit = (row) => {
  currentSupplier.value = row
  auditForm.value = { result: '', reason: '' }
  auditDialogVisible.value = true
}

// 提交审核
const submitAudit = () => {
  if (!auditForm.value.result) {
    ElMessage.warning('请选择审核结果')
    return
  }
  if (auditForm.value.result === 'rejected' && !auditForm.value.reason) {
    ElMessage.warning('请填写不通过原因')
    return
  }

  const status = auditForm.value.result === 'approved' ? 'approved' : 'rejected'
  supplierStore.updateSupplierStatus(currentSupplier.value.id, status, auditForm.value.reason)

  ElMessage.success('审核已提交')
  auditDialogVisible.value = false
}

// 批量通过
const handleBatchApprove = () => {
  ElMessageBox.confirm('确定批量通过所有待审核供应商？', '批量审核', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    pendingSuppliers.value.forEach(s => {
      supplierStore.updateSupplierStatus(s.id, 'approved')
    })
    ElMessage.success('批量审核完成')
  }).catch(() => {})
}
</script>

<template>
  <div class="audit-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1 class="page-title">供应商审核</h1>
      <p class="page-subtitle">审核供应商注册申请和信息变更申请</p>
    </div>

    <!-- 查询条件 -->
    <div class="search-card">
      <el-form :model="searchForm" inline>
        <el-form-item label="企业名称">
          <el-input v-model="searchForm.name" placeholder="请输入企业名称" clearable style="width: 200px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">
            <el-icon><Search /></el-icon>查询
          </el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="success" @click="handleBatchApprove" v-if="pendingSuppliers.length > 0">
            <el-icon><Check /></el-icon>批量通过
          </el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 待审核列表 -->
    <div class="table-card">
      <div class="table-header">
        <span class="table-title">待审核供应商</span>
        <el-tag type="warning" size="small">{{ pendingSuppliers.length }} 条待审核</el-tag>
      </div>
      <el-table :data="pagedList" stripe border style="width: 100%">
        <el-table-column prop="id" label="申请编号" width="150" />
        <el-table-column prop="name" label="企业名称" min-width="200" />
        <el-table-column prop="creditCode" label="统一社会信用代码" width="200" />
        <el-table-column prop="categoryLabel" label="分类" width="100" />
        <el-table-column prop="type" label="企业类型" width="100" />
        <el-table-column prop="registerDate" label="申请时间" width="120" />
        <el-table-column label="资质材料" width="100">
          <template #default="{ row }">
            <el-button type="primary" link size="small">
              <el-icon><Document /></el-icon>{{ row.qualifications?.length || 0 }}个
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="handleAudit(row)">
              <el-icon><Check /></el-icon>审核
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

      <div class="empty-tip" v-if="pendingSuppliers.length === 0">
        <el-empty description="暂无待审核供应商" />
      </div>
    </div>

    <!-- 审核对话框 -->
    <el-dialog v-model="auditDialogVisible" title="供应商审核" width="600px">
      <div class="audit-info" v-if="currentSupplier">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="企业名称">{{ currentSupplier.name }}</el-descriptions-item>
          <el-descriptions-item label="信用代码">{{ currentSupplier.creditCode }}</el-descriptions-item>
          <el-descriptions-item label="企业类型">{{ currentSupplier.type }}</el-descriptions-item>
          <el-descriptions-item label="分类">{{ currentSupplier.categoryLabel }}</el-descriptions-item>
          <el-descriptions-item label="法人代表">{{ currentSupplier.legalPerson }}</el-descriptions-item>
          <el-descriptions-item label="申请时间">{{ currentSupplier.registerDate }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <el-form :model="auditForm" label-width="100px" style="margin-top: 20px;">
        <el-form-item label="审核结果" required>
          <el-radio-group v-model="auditForm.result">
            <el-radio value="approved">审核通过</el-radio>
            <el-radio value="rejected">审核不通过</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="审核意见" v-if="auditForm.result === 'rejected'" required>
          <el-input v-model="auditForm.reason" type="textarea" :rows="3" placeholder="请填写不通过原因" />
        </el-form-item>
        <el-form-item label="审核意见" v-else>
          <el-input v-model="auditForm.reason" type="textarea" :rows="3" placeholder="请填写审核意见（选填）" />
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
.audit-page {
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

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.table-title {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.empty-tip {
  padding: 40px;
}

.audit-info {
  padding: 16px;
  background: #f8fafd;
  border-radius: 8px;
}
</style>