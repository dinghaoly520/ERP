<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { useEvaluationStore } from '@/stores/evaluation'
import {
  User,
  Phone,
  Message,
  Document,
  Clock,
  Star,
  Warning,
  DataLine,
  Edit,
  Back
} from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const supplierStore = useSupplierStore()
const evaluationStore = useEvaluationStore()

// 当前供应商
const supplier = ref(null)

// 活动标签
const activeTab = ref('basic')

// 状态映射
const statusMap = {
  pending: { label: '待审核', type: 'warning' },
  approved: { label: '已入库', type: 'success' },
  rejected: { label: '审核不通过', type: 'danger' },
  disabled: { label: '已停用', type: 'info' },
  blacklist: { label: '黑名单', type: 'danger' },
  abnormal: { label: '异常', type: 'warning' }
}

// 评价记录
const evaluations = computed(() => {
  if (!supplier.value) return []
  return evaluationStore.getEvaluationsBySupplier(supplier.value.id)
})

// 加载数据
onMounted(() => {
  const id = route.params.id
  supplier.value = supplierStore.getSupplierById(id)
})

// 返回列表
const handleBack = () => {
  router.push('/supplier')
}

// 编辑信息
const handleEdit = () => {
  // 打开编辑模态框
}
</script>

<template>
  <div class="supplier-detail-page" v-if="supplier">
    <!-- 页面头部 -->
    <div class="detail-header">
      <div class="header-left">
        <el-button @click="handleBack" link>
          <el-icon><Back /></el-icon>返回列表
        </el-button>
      </div>
      <div class="header-right">
        <el-button type="primary" @click="handleEdit">
          <el-icon><Edit /></el-icon>编辑信息
        </el-button>
      </div>
    </div>

    <!-- 供应商概览 -->
    <div class="overview-card">
      <div class="overview-header">
        <div class="supplier-avatar">
          <el-icon :size="40"><User /></el-icon>
        </div>
        <div class="supplier-info">
          <div class="supplier-name">{{ supplier.name }}</div>
          <div class="supplier-meta">
            <el-tag :type="statusMap[supplier.status]?.type" size="small">
              {{ statusMap[supplier.status]?.label }}
            </el-tag>
            <span class="meta-item">{{ supplier.categoryLabel }}</span>
            <span class="meta-item">{{ supplier.type }}</span>
          </div>
        </div>
        <div class="supplier-stats">
          <div class="stat-item">
            <div class="stat-value">{{ supplier.cooperationCount }}</div>
            <div class="stat-label">合作次数</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">{{ supplier.fulfillRate }}%</div>
            <div class="stat-label">履约率</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">{{ supplier.rating || '-' }}</div>
            <div class="stat-label">评分</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 详细信息标签页 -->
    <div class="detail-tabs">
      <el-tabs v-model="activeTab">
        <!-- 基础信息 -->
        <el-tab-pane label="基础信息" name="basic">
          <div class="tab-content">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="供应商编号">{{ supplier.id }}</el-descriptions-item>
              <el-descriptions-item label="企业名称">{{ supplier.name }}</el-descriptions-item>
              <el-descriptions-item label="统一社会信用代码">{{ supplier.creditCode }}</el-descriptions-item>
              <el-descriptions-item label="企业类型">{{ supplier.type }}</el-descriptions-item>
              <el-descriptions-item label="法定代表人">{{ supplier.legalPerson }}</el-descriptions-item>
              <el-descriptions-item label="供应商分类">{{ supplier.categoryLabel }}</el-descriptions-item>
              <el-descriptions-item label="注册地址" :span="2">{{ supplier.registerAddress }}</el-descriptions-item>
              <el-descriptions-item label="经营范围" :span="2">{{ supplier.businessScope }}</el-descriptions-item>
              <el-descriptions-item label="注册时间">{{ supplier.registerDate }}</el-descriptions-item>
              <el-descriptions-item label="入库时间">{{ supplier.approveDate || '-' }}</el-descriptions-item>
            </el-descriptions>
          </div>
        </el-tab-pane>

        <!-- 联系人信息 -->
        <el-tab-pane label="联系人信息" name="contacts">
          <div class="tab-content">
            <el-table :data="supplier.contacts" border style="width: 100%">
              <el-table-column prop="name" label="姓名" width="120" />
              <el-table-column prop="position" label="职务" width="150">
                <template #default="{ row }">
                  {{ row.position || '-' }}
                </template>
              </el-table-column>
              <el-table-column prop="phone" label="手机号" width="150" />
              <el-table-column prop="email" label="邮箱" min-width="200">
                <template #default="{ row }">
                  {{ row.email || '-' }}
                </template>
              </el-table-column>
              <el-table-column prop="isMain" label="是否主联系人" width="120">
                <template #default="{ row }">
                  <el-tag v-if="row.isMain" type="primary" size="small">主联系人</el-tag>
                  <span v-else class="text-muted">-</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <!-- 资质材料 -->
        <el-tab-pane label="资质材料" name="qualifications">
          <div class="tab-content">
            <el-table :data="supplier.qualifications" border style="width: 100%">
              <el-table-column prop="name" label="资质名称" min-width="200" />
              <el-table-column prop="uploadDate" label="上传时间" width="120" />
              <el-table-column prop="expireDate" label="有效期至" width="120">
                <template #default="{ row }">
                  {{ row.expireDate || '长期有效' }}
                </template>
              </el-table-column>
              <el-table-column label="操作" width="100">
                <template #default="{ row }">
                  <el-button type="primary" link size="small">查看</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <!-- 参与项目记录 -->
        <el-tab-pane label="参与项目记录" name="projects">
          <div class="tab-content">
            <el-table :data="supplier.projects" border style="width: 100%">
              <el-table-column prop="id" label="项目编号" width="150" />
              <el-table-column prop="name" label="项目名称" min-width="200" />
              <el-table-column prop="role" label="角色" width="120" />
              <el-table-column prop="amount" label="金额" width="150">
                <template #default="{ row }">
                  {{ row.amount ? (row.amount / 10000).toFixed(2) + '万元' : '-' }}
                </template>
              </el-table-column>
              <el-table-column prop="date" label="日期" width="120" />
            </el-table>
            <div class="empty-tip" v-if="supplier.projects.length === 0">
              暂无参与项目记录
            </div>
          </div>
        </el-tab-pane>

        <!-- 评价记录 -->
        <el-tab-pane label="评价记录" name="evaluations">
          <div class="tab-content">
            <el-table :data="evaluations" border style="width: 100%">
              <el-table-column prop="projectName" label="项目名称" min-width="200" />
              <el-table-column prop="totalScore" label="得分" width="80" />
              <el-table-column prop="level" label="等级" width="80">
                <template #default="{ row }">
                  <el-tag :type="row.level === 'A' ? 'success' : row.level === 'B' ? 'primary' : 'warning'" size="small">
                    {{ row.level }}级
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="comment" label="评价意见" min-width="200" show-overflow-tooltip />
              <el-table-column prop="evaluateDate" label="评价时间" width="120" />
            </el-table>
            <div class="empty-tip" v-if="evaluations.length === 0">
              暂无评价记录
            </div>
          </div>
        </el-tab-pane>

        <!-- 操作日志 -->
        <el-tab-pane label="操作日志" name="logs">
          <div class="tab-content">
            <el-timeline>
              <el-timeline-item timestamp="2024-05-20 15:30" placement="top">
                <el-card>
                  <h4>注册申请提交</h4>
                  <p>供应商提交注册申请，等待审核</p>
                </el-card>
              </el-timeline-item>
              <el-timeline-item v-if="supplier.approveDate" :timestamp="supplier.approveDate" placement="top" type="success">
                <el-card>
                  <h4>审核通过</h4>
                  <p>资质材料审核通过，供应商已入库</p>
                </el-card>
              </el-timeline-item>
            </el-timeline>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>

  <!-- 无数据状态 -->
  <div class="empty-page" v-else>
    <el-empty description="供应商不存在" />
  </div>
</template>

<style scoped>
.supplier-detail-page {
  padding: 24px;
  background: #f6f9fd;
  min-height: calc(100vh - 60px);
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
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
  gap: 24px;
}

.supplier-avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, #e8f2ff, #dce8f8);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #064ea2;
}

.supplier-info {
  flex: 1;
}

.supplier-name {
  font-size: 20px;
  font-weight: 800;
  color: #18243a;
  margin-bottom: 8px;
}

.supplier-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.meta-item {
  font-size: 13px;
  color: #5a6d8a;
  padding: 4px 12px;
  background: #f8fafd;
  border-radius: 4px;
}

.supplier-stats {
  display: flex;
  gap: 32px;
}

.stat-item {
  text-align: center;
}

.stat-value {
  font-size: 24px;
  font-weight: 900;
  color: #064ea2;
}

.stat-label {
  font-size: 12px;
  color: #8a9aaa;
  margin-top: 4px;
}

.detail-tabs {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  border: 1px solid #e8f0fa;
}

.tab-content {
  padding: 16px 0;
}

.empty-tip {
  text-align: center;
  padding: 40px;
  color: #c0c4cc;
}

.empty-page {
  padding: 60px;
  display: flex;
  justify-content: center;
}

.text-muted {
  color: #c0c4cc;
}
</style>