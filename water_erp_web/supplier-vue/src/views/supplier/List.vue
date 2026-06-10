<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import {
  Search,
  Download,
  View,
  User,
  Star
} from '@element-plus/icons-vue'

const router = useRouter()
const supplierStore = useSupplierStore()

// 查询条件
const searchForm = ref({
  name: '',
  creditCode: '',
  category: '',
  status: '',
  dateRange: []
})

// 分类选项
const categories = [
  { value: 'engineering', label: '工程建设' },
  { value: 'material', label: '物资采购' },
  { value: 'service', label: '服务采购' }
]

// 状态选项
const statusOptions = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已入库' },
  { value: 'rejected', label: '审核不通过' },
  { value: 'disabled', label: '已停用' },
  { value: 'blacklist', label: '黑名单' },
  { value: 'abnormal', label: '异常' }
]

// 分页
const currentPage = ref(1)
const pageSize = ref(10)

// 状态映射
const statusMap = {
  pending: { label: '待审核', type: 'warning' },
  approved: { label: '已入库', type: 'success' },
  rejected: { label: '审核不通过', type: 'danger' },
  disabled: { label: '已停用', type: 'info' },
  blacklist: { label: '黑名单', type: 'danger' },
  abnormal: { label: '异常', type: 'warning' }
}

// 过滤供应商列表
const filteredSuppliers = computed(() => {
  let list = [...supplierStore.mockSuppliers]
  if (searchForm.value.name) {
    list = list.filter(s => s.name.includes(searchForm.value.name))
  }
  if (searchForm.value.creditCode) {
    list = list.filter(s => s.creditCode.includes(searchForm.value.creditCode))
  }
  if (searchForm.value.category) {
    list = list.filter(s => s.category === searchForm.value.category)
  }
  if (searchForm.value.status) {
    list = list.filter(s => s.status === searchForm.value.status)
  }
  return list
})

// 分页后的数据
const pagedSuppliers = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredSuppliers.value.slice(start, start + pageSize.value)
})

// 查询
const handleSearch = () => {
  currentPage.value = 1
}

// 重置
const handleReset = () => {
  searchForm.value = {
    name: '',
    creditCode: '',
    category: '',
    status: '',
    dateRange: []
  }
  currentPage.value = 1
}

// 查看详情
const handleDetail = (row) => {
  router.push(`/supplier/detail/${row.id}`)
}

// 导出
const handleExport = () => {
  // 模拟导出
  const message = ElMessage
  import('element-plus').then(({ ElMessage }) => {
    ElMessage.success('供应商数据导出成功')
  })
}

// 分页变化
const handlePageChange = (page) => {
  currentPage.value = page
}

const handleSizeChange = (size) => {
  pageSize.value = size
  currentPage.value = 1
}
</script>

<template>
  <div class="supplier-list-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1 class="page-title">供应商库</h1>
      <p class="page-subtitle">统一管理已注册、已审核、已入库的供应商资源</p>
    </div>

    <!-- 查询条件 -->
    <div class="search-card">
      <el-form :model="searchForm" inline>
        <el-form-item label="企业名称">
          <el-input v-model="searchForm.name" placeholder="请输入企业名称" clearable style="width: 200px" />
        </el-form-item>
        <el-form-item label="信用代码">
          <el-input v-model="searchForm.creditCode" placeholder="请输入统一社会信用代码" clearable style="width: 200px" />
        </el-form-item>
        <el-form-item label="供应商分类">
          <el-select v-model="searchForm.category" placeholder="请选择" clearable style="width: 140px">
            <el-option v-for="cat in categories" :key="cat.value" :label="cat.label" :value="cat.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.status" placeholder="请选择" clearable style="width: 140px">
            <el-option v-for="status in statusOptions" :key="status.value" :label="status.label" :value="status.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">
            <el-icon><Search /></el-icon>查询
          </el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button @click="handleExport">
            <el-icon><Download /></el-icon>导出
          </el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 供应商表格 -->
    <div class="table-card">
      <el-table :data="pagedSuppliers" stripe border style="width: 100%">
        <el-table-column prop="id" label="供应商编号" width="150" />
        <el-table-column prop="name" label="企业名称" min-width="200">
          <template #default="{ row }">
            <el-link type="primary" @click="handleDetail(row)">{{ row.name }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="creditCode" label="统一社会信用代码" width="200" />
        <el-table-column prop="categoryLabel" label="分类" width="100" />
        <el-table-column prop="type" label="企业类型" width="100" />
        <el-table-column prop="status" label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusMap[row.status]?.type" size="small">
              {{ statusMap[row.status]?.label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="registerDate" label="入库时间" width="120" />
        <el-table-column prop="cooperationCount" label="合作次数" width="90" align="center" />
        <el-table-column prop="fulfillRate" label="履约率" width="90" align="center">
          <template #default="{ row }">
            <span v-if="row.fulfillRate">{{ row.fulfillRate }}%</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
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
          :page-sizes="[10, 20, 50, 100]"
          :total="filteredSuppliers.length"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handlePageChange"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.supplier-list-page {
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

.text-muted {
  color: #c0c4cc;
}
</style>