<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'

const supplierStore = useSupplierStore()
const loading = ref(true)
const error = ref(false)
const dialogVisible = ref(false)
const dialogLoading = ref(false)
const formDirty = ref(false)
const form = ref({ fieldName: '', fieldLabel: '', newValue: '', reason: '' })

function elapsedSince(ts: string): string { const diff = Date.now() - new Date(ts).getTime(); const days = Math.ceil(diff / 86400000); if (days > 0) return `${days} 天`; const hours = Math.ceil(diff / 3600000); return hours > 0 ? `${hours} 小时` : '刚提交' }
const changeableFields = [
  { value: 'name', label: '企业名称' },
  { value: 'legalPerson', label: '法定代表人' },
  { value: 'registeredAddress', label: '注册地址' },
  { value: 'businessScope', label: '经营范围' },
  { value: 'enterpriseType', label: '企业类型' },
]

onMounted(async () => {
  try { await supplierStore.fetchChangeRecords() } catch { error.value = true } finally { loading.value = false }
})

async function retryLoad() {
  error.value = false; loading.value = true
  try { await supplierStore.fetchChangeRecords() } catch { error.value = true } finally { loading.value = false }
}

function openDialog() {
  form.value = { fieldName: '', fieldLabel: '', newValue: '', reason: '' }
  formDirty.value = false
  dialogVisible.value = true
}

function onFieldChange(val: string) {
  const f = changeableFields.find(x => x.value === val)
  form.value.fieldLabel = f?.label || ''
  formDirty.value = true
}

function onFormInput() { formDirty.value = true }

async function handleBeforeClose(done: () => void) {
  if (formDirty.value && (form.value.fieldName || form.value.newValue)) {
    try {
      await ElMessageBox.confirm('有未保存的变更内容，确定放弃吗？', '提示', { confirmButtonText: '确定放弃', cancelButtonText: '继续编辑', type: 'warning' })
    } catch {
      return // user cancelled
    }
  }
  done()
}

async function handleSubmit() {
  if (!form.value.fieldName || !form.value.newValue) {
    ElMessage.warning('请填写完整信息')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认将「${form.value.fieldLabel}」变更为「${form.value.newValue}」？提交后需等待管理员审核。`,
      '确认提交变更',
      { confirmButtonText: '确认提交', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }

  dialogLoading.value = true
  try {
    await supplierStore.createChangeRequest(form.value)
    ElMessage.success('变更申请已提交')
    dialogVisible.value = false
    formDirty.value = false
  } catch {
    ElMessage.error('提交失败')
  } finally { dialogLoading.value = false }
}

const statusMap: Record<string, { label: string; cls: string }> = {
  PENDING: { label: '待审核', cls: 'pending' },
  APPROVED: { label: '已通过', cls: 'approved' },
  REJECTED: { label: '已拒绝', cls: 'rejected' },
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <!-- Error state -->
    <div v-if="error && !loading" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>

    <template v-else-if="!loading">
      <div class="sp-page-hero-card">
        <div class="sp-page-hero-inner">
          <div class="sp-page-hero-body">
            <h1 class="sp-modern-title">信息变更</h1>
            <p class="sp-modern-desc">申请修改企业信息，提交后需等待管理员审核。</p>
          </div>
          <div class="sp-page-hero-actions"><el-button type="primary" @click="openDialog"><el-icon><EditPen /></el-icon>申请变更</el-button></div>
        </div>
      </div>

      <div v-if="supplierStore.changeRecords.length>0" class="detail-card" style="overflow:hidden;padding:0">
        <el-table :data="supplierStore.changeRecords" stripe style="width:100%">
          <el-table-column label="变更字段" prop="fieldLabel" width="140" />
          <el-table-column label="原值" prop="oldValue" min-width="160"><template #default="{row}">{{ row.oldValue||'-' }}</template></el-table-column>
          <el-table-column label="新值" prop="newValue" min-width="160"><template #default="{row}"><span style="color:var(--sp-primary);font-weight:600">{{ row.newValue }}</span></template></el-table-column>
          <el-table-column label="变更原因" prop="reason" min-width="160"><template #default="{row}">{{ row.reason||'-' }}</template></el-table-column>
          <el-table-column label="状态" width="110" align="center"><template #default="{row}"><span class="sp-status" :class="statusMap[row.status]?.cls||'pending'">{{ statusMap[row.status]?.label||row.status }}</span></template></el-table-column>
          <el-table-column label="申请时间" width="180"><template #default="{row}">{{ dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') }}<template v-if="row.status==='PENDING'"><br><small class="waited-time">已等待 {{ elapsedSince(row.createdAt) }}</small></template></template></el-table-column>
        </el-table>
      </div>

      <div v-else class="detail-card" style="text-align:center;padding:64px"><el-icon :size="32" color="var(--sp-gray-300)"><EditPen /></el-icon><p style="margin-top:12px;font-size:15px;font-weight:700;color:var(--sp-gray-500)">暂无变更记录</p><p style="margin-top:4px;font-size:13px;color:var(--sp-gray-400)">如需修改企业信息，请点击上方按钮申请变更</p></div>

      <el-dialog v-model="dialogVisible" title="申请信息变更" width="520px" destroy-on-close :before-close="handleBeforeClose">
        <el-form :model="form" label-width="90px" size="large">
          <el-form-item label="变更字段" required :rules="[{required:true,message:'请选择变更字段',trigger:'change'}]">
            <el-select v-model="form.fieldName" placeholder="请选择要变更的字段" style="width:100%" @change="onFieldChange">
              <el-option v-for="f in changeableFields" :key="f.value" :label="f.label" :value="f.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="新值" required :rules="[{required:true,message:'请输入新值',trigger:'blur'}]">
            <el-input v-model="form.newValue" placeholder="请输入新的值" @input="onFormInput" />
          </el-form-item>
          <el-form-item label="变更原因">
            <el-input v-model="form.reason" type="textarea" :rows="3" placeholder="请简要说明变更原因" @input="onFormInput" />
          </el-form-item>
        </el-form>
        <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="dialogLoading" @click="handleSubmit">提交申请</el-button></template>
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
.detail-card { position: relative; background: rgba(255,255,255,0.52); backdrop-filter: blur(14px) saturate(1.15); -webkit-backdrop-filter: blur(14px) saturate(1.15); border: 1px solid rgba(255,255,255,0.45); border-radius: var(--sp-radius-md); padding: 24px; }
.detail-card::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: 0.44; border-radius: inherit; background-image: radial-gradient(ellipse at 10% 6%, rgba(96,165,250,0.24), transparent 55%), radial-gradient(ellipse at 85% 12%, rgba(56,189,248,0.16), transparent 55%), radial-gradient(ellipse at 38% 90%, rgba(52,211,153,0.10), transparent 55%); animation: glass-glow-drift 18s ease-in-out infinite; }
.detail-card > * { position: relative; z-index: 1; }
</style>
