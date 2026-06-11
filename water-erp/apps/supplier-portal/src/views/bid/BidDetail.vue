<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBidStore } from '@/stores/bid'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'

const route = useRoute()
const router = useRouter()
const bidStore = useBidStore()
const supplierStore = useSupplierStore()
const loading = ref(true)
const activeTab = ref('info')

const projectId = computed(() => route.params.id as string)

const stageMap: Record<string, { label: string; color: string }> = {
  DOWNLOAD: { label: '文件下载', color: '#0891b2' },
  SUBMIT: { label: '加密投递', color: '#0a5eb8' },
  OPENING: { label: '在线开标', color: '#d97706' },
  EVALUATING: { label: '专家评标', color: '#7c3aed' },
  ARCHIVED: { label: '已归档', color: '#059669' },
}

const project = computed(() => bidStore.currentProject)

const canSubmit = computed(() => {
  if (!project.value) return false
  const p = project.value
  // Can submit if stage is DOWNLOAD or SUBMIT, and deadline hasn't passed
  return (p.stage === 'DOWNLOAD' || p.stage === 'SUBMIT') && new Date(p.deadline) > new Date()
})

const supplierCount = computed(() => {
  return project.value?.suppliers?.length || project.value?._count?.suppliers || 0
})

onMounted(async () => {
  try {
    await bidStore.fetchProject(projectId.value)
  } finally {
    loading.value = false
  }
})

function goToSubmit() {
  if (!supplierStore.profile || supplierStore.profile?.status !== 'APPROVED') {
    ElMessage.warning('只有已入库供应商可以提交标书')
    return
  }
  router.push(`/bids/${projectId.value}/submit`)
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <!-- Back -->
    <el-button link @click="router.push('/bids')" style="margin-bottom: 16px;">
      <el-icon><ArrowLeft /></el-icon> 返回招标列表
    </el-button>

    <template v-if="project">
      <!-- Project header -->
      <div class="sp-card project-hero">
        <div class="hero-content">
          <div class="hero-top">
            <span
              class="sp-status"
              :style="{ background: (stageMap[project.stage]?.color || '#94a3b8') + '18', color: stageMap[project.stage]?.color || '#94a3b8' }"
            >
              {{ stageMap[project.stage]?.label || project.stage }}
            </span>
            <span class="hero-code">{{ project.projectCode }}</span>
          </div>
          <h1 class="hero-title">{{ project.name }}</h1>
          <div class="hero-meta">
            <el-tag effect="plain">{{ project.procurementMethod }}</el-tag>
            <span class="hero-stat">
              <el-icon><User /></el-icon>
              {{ supplierCount }} 家投标方
            </span>
            <span class="hero-stat">
              <el-icon><Clock /></el-icon>
              截止 {{ dayjs(project.deadline).format('YYYY-MM-DD HH:mm') }}
            </span>
            <span class="hero-stat">
              <el-icon><Calendar /></el-icon>
              开标 {{ dayjs(project.openTime).format('YYYY-MM-DD HH:mm') }}
            </span>
          </div>
        </div>
        <div class="hero-actions">
          <el-button
            type="primary"
            size="large"
            :disabled="!canSubmit"
            @click="goToSubmit"
          >
            <el-icon><Upload /></el-icon>
            {{ canSubmit ? '提交标书' : '不可投标' }}
          </el-button>
          <el-button size="large" @click="ElMessage.info('招标文件下载功能开发中')">
            <el-icon><Download /></el-icon>下载招标文件
          </el-button>
        </div>
      </div>

      <!-- Tabs -->
      <el-tabs v-model="activeTab" class="sp-tabs" style="margin-top: 20px;">
        <el-tab-pane label="项目信息" name="info">
          <div class="sp-card">
            <el-descriptions :column="2" border size="large">
              <el-descriptions-item label="项目编号">{{ project.projectCode }}</el-descriptions-item>
              <el-descriptions-item label="采购方式">{{ project.procurementMethod }}</el-descriptions-item>
              <el-descriptions-item label="投标截止时间">{{ dayjs(project.deadline).format('YYYY-MM-DD HH:mm:ss') }}</el-descriptions-item>
              <el-descriptions-item label="开标时间">{{ dayjs(project.openTime).format('YYYY-MM-DD HH:mm:ss') }}</el-descriptions-item>
              <el-descriptions-item label="当前阶段">{{ stageMap[project.stage]?.label || project.stage }}</el-descriptions-item>
              <el-descriptions-item label="投标方数量">{{ supplierCount }} 家</el-descriptions-item>
              <el-descriptions-item label="风险提示" :span="2" v-if="project.riskNote">
                <span style="color: var(--sp-orange);">{{ project.riskNote }}</span>
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </el-tab-pane>

        <el-tab-pane label="投标方" name="suppliers" v-if="project.suppliers?.length">
          <div class="sp-card">
            <el-table :data="project.suppliers" stripe>
              <el-table-column label="供应商" prop="supplierName" />
              <el-table-column label="下载状态" prop="downloadStatus" width="110" />
              <el-table-column label="提交状态" prop="submitStatus" width="110" />
              <el-table-column label="加密状态" prop="encryptStatus" width="130" />
              <el-table-column label="回执号" prop="receiptNo" width="180">
                <template #default="{ row }">
                  <code style="font-size: 12px; color: var(--sp-primary);">{{ row.receiptNo }}</code>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane label="澄清答疑" name="clarifications">
          <div class="sp-card">
            <div v-if="project.clarifications?.length">
              <div v-for="c in project.clarifications" :key="c.id" class="clarification-item">
                <div class="clarification-q">
                  <el-tag type="warning" size="small" effect="plain">问题</el-tag>
                  <span>{{ c.question }}</span>
                  <span class="clarification-issuer">— {{ c.issuer }}</span>
                </div>
                <div class="clarification-a" v-if="c.reply">
                  <el-tag type="success" size="small" effect="plain">回复</el-tag>
                  <span>{{ c.reply }}</span>
                </div>
              </div>
            </div>
            <div v-else class="sp-empty" style="padding: 30px;">
              <div class="sp-empty-icon">💬</div>
              <div class="sp-empty-text">暂无澄清答疑</div>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="开标记录" name="opening" v-if="project.openingRecords?.length">
          <div class="sp-card">
            <el-table :data="project.openingRecords" stripe>
              <el-table-column label="供应商" prop="supplierName" />
              <el-table-column label="投标金额" prop="amount" width="140" />
              <el-table-column label="工期" prop="period" width="120" />
              <el-table-column label="质量目标" prop="qualityTarget" width="100" />
              <el-table-column label="保证金" prop="bondStatus" width="100" />
              <el-table-column label="解密结果" prop="decryptResult" width="110" />
              <el-table-column label="确认状态" prop="confirmStatus" width="110" />
            </el-table>
          </div>
        </el-tab-pane>
      </el-tabs>
    </template>
  </div>
</template>

<style scoped>
.project-hero {
  background: linear-gradient(135deg, #0a5eb8, #0891b2);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hero-top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.hero-code {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  font-family: monospace;
}

.hero-title {
  font-size: 22px;
  font-weight: 800;
  margin-bottom: 16px;
  line-height: 1.3;
}

.hero-meta {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.hero-meta .el-tag {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.hero-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
}

.hero-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}

.hero-actions .el-button {
  min-width: 140px;
}

.clarification-item {
  padding: 16px 0;
  border-bottom: 1px solid var(--sp-border-light);
}

.clarification-item:last-child { border-bottom: none; }

.clarification-q,
.clarification-a {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  line-height: 1.6;
}

.clarification-a {
  margin-top: 10px;
  padding-left: 4px;
}

.clarification-issuer {
  font-size: 12px;
  color: var(--sp-gray-400);
  margin-left: auto;
  flex-shrink: 0;
}

.sp-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}

@media (max-width: 768px) {
  .project-hero { flex-direction: column; text-align: center; }
  .hero-meta { justify-content: center; }
  .hero-actions { flex-direction: row; width: 100%; }
}
</style>
