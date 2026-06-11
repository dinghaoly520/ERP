<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'

const supplierStore = useSupplierStore()
const loading = ref(true)
const dialogVisible = ref(false)
const dialogLoading = ref(false)
const form = ref({ type: '', name: '', fileUrl: '/uploads/placeholder.pdf', validFrom: '', validTo: '' })

onMounted(async () => {
  try {
    await supplierStore.fetchQualifications()
  } finally {
    loading.value = false
  }
})

const qualTypes = ['营业执照', '资质证书', '安全生产许可证', '质量管理体系认证', '环境管理体系认证', '职业健康安全管理体系认证', '其他']

function openAdd() {
  form.value = { type: '', name: '', fileUrl: '/uploads/placeholder.pdf', validFrom: '', validTo: '' }
  dialogVisible.value = true
}

async function handleAdd() {
  if (!form.value.type || !form.value.name) {
    ElMessage.warning('请填写资质类型和名称')
    return
  }
  dialogLoading.value = true
  try {
    await supplierStore.addQualification(form.value)
    ElMessage.success('资质材料添加成功')
    dialogVisible.value = false
  } catch {
    ElMessage.error('添加失败')
  } finally {
    dialogLoading.value = false
  }
}

async function handleDelete(id: string) {
  await ElMessageBox.confirm('确定要删除此资质材料吗？', '提示', { type: 'warning' })
  try {
    await supplierStore.deleteQualification(id)
    ElMessage.success('已删除')
  } catch {
    ElMessage.error('删除失败')
  }
}

function getStatusInfo(q: any) {
  if (!q.validTo) return { label: '长期有效', class: 'approved' }
  const now = new Date()
  const to = new Date(q.validTo)
  const diff = (to.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  if (diff < 0) return { label: '已过期', class: 'rejected' }
  if (diff < 30) return { label: '即将过期', class: 'pending' }
  return { label: '有效', class: 'approved' }
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="sp-section-header">
      <div>
        <h1 class="page-title">资质管理</h1>
        <p class="page-desc">管理您的企业资质材料，确保资质在有效期内</p>
      </div>
      <el-button type="primary" @click="openAdd">
        <el-icon><Plus /></el-icon>添加资质
      </el-button>
    </div>

    <!-- Qualification grid -->
    <el-row :gutter="16" v-if="supplierStore.qualifications.length > 0">
      <el-col :xs="24" :sm="12" :lg="8" v-for="q in supplierStore.qualifications" :key="q.id">
        <div class="sp-card qual-card">
          <div class="qual-card-top">
            <el-tag effect="plain" size="small">{{ q.type }}</el-tag>
            <span class="sp-status" :class="getStatusInfo(q).class" style="font-size: 11px; padding: 2px 10px;">
              {{ getStatusInfo(q).label }}
            </span>
          </div>
          <h3 class="qual-name">{{ q.name }}</h3>
          <div class="qual-meta">
            <div v-if="q.validFrom">
              <el-icon><Calendar /></el-icon>
              {{ dayjs(q.validFrom).format('YYYY-MM-DD') }} ~ {{ q.validTo ? dayjs(q.validTo).format('YYYY-MM-DD') : '长期' }}
            </div>
            <div>
              <el-icon><Document /></el-icon>
              {{ q.fileUrl }}
            </div>
          </div>
          <div class="qual-actions">
            <el-button text type="primary" size="small">查看文件</el-button>
            <el-button text type="danger" size="small" @click="handleDelete(q.id)">删除</el-button>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- Empty -->
    <div v-else class="sp-card">
      <div class="sp-empty">
        <div class="sp-empty-icon">📁</div>
        <div class="sp-empty-text">暂无资质材料</div>
        <div class="sp-empty-desc">点击上方按钮添加您的企业资质</div>
      </div>
    </div>

    <!-- Add dialog -->
    <el-dialog v-model="dialogVisible" title="添加资质材料" width="520px" destroy-on-close>
      <el-form :model="form" label-width="100px" size="large">
        <el-form-item label="资质类型" required>
          <el-select v-model="form.type" placeholder="请选择资质类型" style="width: 100%">
            <el-option v-for="t in qualTypes" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="资质名称" required>
          <el-input v-model="form.name" placeholder="请输入资质名称" />
        </el-form-item>
        <el-form-item label="有效期起">
          <el-date-picker v-model="form.validFrom" type="date" placeholder="选择开始日期" style="width: 100%" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="有效期止">
          <el-date-picker v-model="form.validTo" type="date" placeholder="选择结束日期（不填为长期有效）" style="width: 100%" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="上传文件">
          <el-button type="primary" plain>选择文件</el-button>
          <span style="margin-left: 12px; color: var(--sp-gray-400); font-size: 13px;">支持 PDF、JPG、PNG</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="dialogLoading" @click="handleAdd">确认添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.qual-card {
  display: flex;
  flex-direction: column;
  min-height: 180px;
}

.qual-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.qual-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--sp-gray-900);
  margin-bottom: 12px;
  flex: 1;
}

.qual-meta {
  font-size: 12px;
  color: var(--sp-gray-500);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.qual-meta .el-icon { margin-right: 4px; }

.qual-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--sp-border-light);
}
</style>
