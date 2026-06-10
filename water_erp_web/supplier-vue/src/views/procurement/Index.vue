<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  Document,
  Folder,
  DataLine,
  Edit,
  Check,
  Plus,
  Search,
  Download
} from '@element-plus/icons-vue'

const router = useRouter()
const activeTab = ref('list')

// 项目列表
const projectList = ref([
  { id: 1, name: '2026年度水利工程物资集中采购', type: '物资采购', status: 'draft', date: '2026-05-18', amount: '2800万' },
  { id: 2, name: '智慧水务信息化系统建设项目', type: '服务采购', status: 'reviewing', date: '2026-05-15', amount: '560万' },
  { id: 3, name: '升钟水库灌区续建配套工程', type: '工程采购', status: 'approved', date: '2026-05-10', amount: '1.2亿' },
  { id: 4, name: '办公设备年度采购项目', type: '物资采购', status: 'archived', date: '2026-04-20', amount: '150万' }
])

const statusMap = {
  draft: { label: '草稿', color: '#8a9aaa' },
  reviewing: { label: '审核中', color: '#f5a623' },
  approved: { label: '已立项', color: '#11a874' },
  rejected: { label: '已驳回', color: '#e74c3c' },
  archived: { label: '已归档', color: '#064ea2' }
}

const searchText = ref('')

const filteredProjects = computed(() => {
  if (!searchText.value) return projectList.value
  return projectList.value.filter(p => p.name.includes(searchText.value))
})

const handleCreate = () => {
  router.push('/procurement/create')
}

const handleView = (id) => {
  router.push(`/procurement/detail/${id}`)
}

const menuItems = [
  { key: 'list', title: '项目列表', icon: Document },
  { key: 'approval', title: '立项申请', icon: Plus },
  { key: 'write', title: '招标文件编写', icon: Edit },
  { key: 'review', title: '招标文件审查', icon: Check },
  { key: 'archive', title: '项目管理与归档', icon: Folder }
]
</script>

<template>
  <div class="procurement-page">
    <div class="page-header">
      <h1 class="page-title">采购管理</h1>
      <p class="page-subtitle">项目立项、招标文件编写与审查、项目管理与归档</p>
    </div>

    <!-- 功能入口 -->
    <div class="function-cards">
      <div class="card-item" @click="handleCreate">
        <el-icon :size="32" color="#064ea2"><Plus /></el-icon>
        <h3>立项申请</h3>
        <p>提交采购项目立项申请</p>
      </div>
      <div class="card-item">
        <el-icon :size="32" color="#11a874"><Edit /></el-icon>
        <h3>招标文件编写</h3>
        <p>编写招标文件，支持模板</p>
      </div>
      <div class="card-item">
        <el-icon :size="32" color="#f5a623"><Check /></el-icon>
        <h3>招标文件审查</h3>
        <p>合规性审查，确保规范</p>
      </div>
      <div class="card-item">
        <el-icon :size="32" color="#0a7ed3"><Folder /></el-icon>
        <h3>项目管理归档</h3>
        <p>管理全生命周期</p>
      </div>
      <div class="card-item">
        <el-icon :size="32" color="#9b59b6"><DataLine /></el-icon>
        <h3>数据分析</h3>
        <p>统计分析可视化</p>
      </div>
    </div>

    <!-- 项目列表 -->
    <div class="list-section">
      <div class="section-header">
        <h3>采购项目</h3>
        <div class="section-actions">
          <el-input
            v-model="searchText"
            placeholder="搜索项目名称"
            clearable
            style="width: 220px"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-button type="primary" @click="handleCreate">
            <el-icon><Plus /></el-icon>
            新建项目
          </el-button>
        </div>
      </div>

      <el-table :data="filteredProjects" stripe border style="width: 100%">
        <el-table-column prop="id" label="项目编号" width="100" />
        <el-table-column prop="name" label="项目名称" min-width="250">
          <template #default="{ row }">
            <el-link type="primary" @click="handleView(row.id)">{{ row.name }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="type" label="采购类型" width="100" />
        <el-table-column prop="amount" label="采购金额" width="100" />
        <el-table-column prop="date" label="创建日期" width="110" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :style="{ background: statusMap[row.status].color + '20', color: statusMap[row.status].color, border: 'none' }" size="small">
              {{ statusMap[row.status].label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="handleView(row.id)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 待办事项 -->
    <div class="todo-section">
      <div class="section-title">待办事项</div>
      <div class="todo-list">
        <div class="todo-item">
          <span class="todo-tag urgent">紧急</span>
          <span class="todo-text">水利物资集中采购项目招标文件待审查</span>
          <span class="todo-date">2026-05-20</span>
        </div>
        <div class="todo-item">
          <span class="todo-tag">普通</span>
          <span class="todo-text">智慧水务信息化项目立项申请待提交</span>
          <span class="todo-date">2026-05-19</span>
        </div>
        <div class="todo-item">
          <span class="todo-tag">普通</span>
          <span class="todo-text">办公设备采购项目归档资料待完善</span>
          <span class="todo-date">2026-05-18</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.procurement-page {
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

.function-cards {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.card-item {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  border: 1px solid #e8f0fa;
  cursor: pointer;
  transition: all 0.3s ease;
}

.card-item:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 32px rgba(6, 58, 126, 0.12);
  border-color: #b8d4f5;
}

.card-item h3 {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
  margin: 16px 0 8px;
}

.card-item p {
  font-size: 13px;
  color: #5a6d8a;
  line-height: 1.6;
  margin: 0;
}

.list-section {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  border: 1px solid #e8f0fa;
  margin-bottom: 24px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header h3 {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
}

.section-actions {
  display: flex;
  gap: 12px;
}

.todo-section {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  border: 1px solid #e8f0fa;
}

.section-title {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e8f0fa;
}

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
  transition: background 0.2s;
}

.todo-item:hover {
  background: #eef5fc;
}

.todo-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  background: #e8f2ff;
  color: #064ea2;
}

.todo-tag.urgent {
  background: #fee;
  color: #e74c3c;
}

.todo-text {
  flex: 1;
  font-size: 14px;
  color: #18243a;
}

.todo-date {
  font-size: 12px;
  color: #8a9aaa;
}

@media (max-width: 1200px) {
  .function-cards {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .function-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 560px) {
  .function-cards {
    grid-template-columns: 1fr;
  }
}
</style>