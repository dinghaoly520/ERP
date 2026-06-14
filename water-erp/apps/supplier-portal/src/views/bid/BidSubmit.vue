<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBidStore } from '@/stores/bid'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import { uploadFile, type FileAssetResponse } from '@/api/upload'
import dayjs from 'dayjs'

const route = useRoute()
const router = useRouter()
const bidStore = useBidStore()
const supplierStore = useSupplierStore()

const loading = ref(true)
const submitting = ref(false)
const saving = ref(false)
const projectId = computed(() => route.params.id as string)

const form = ref({
  bidPrice: '',
  deliveryPeriod: '',
  technicalFileAssetId: '',
  businessFileAssetId: '',
  coverLetter: '',
})

const project = computed(() => bidStore.currentProject)
const existingSubmission = ref<any>(null)
const techFileMeta = ref<FileAssetResponse | null>(null)
const bizFileMeta = ref<FileAssetResponse | null>(null)

/** el-upload 自定义上传：落 MinIO（分类 bid_document），回写表单字段为可校验的 FileAsset.id */
async function handleFileUpload(options: any, field: 'technicalFileAssetId' | 'businessFileAssetId') {
  const file = options.file as File
  if (file.size > 50 * 1024 * 1024) {
    ElMessage.error('文件不能超过 50MB')
    options.onError(new Error('FILE_TOO_LARGE'))
    return
  }
  try {
    const res = await uploadFile(file, 'bid_document')
    form.value[field] = res.id
    if (field === 'technicalFileAssetId') techFileMeta.value = res
    else bizFileMeta.value = res
    options.onSuccess(res)
    ElMessage.success('文件上传成功')
  } catch (e: any) {
    options.onError(e)
  }
}
const uploadTech = (o: any) => handleFileUpload(o, 'technicalFileAssetId')
const uploadBiz = (o: any) => handleFileUpload(o, 'businessFileAssetId')

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

onMounted(async () => {
  try {
    await Promise.all([
      bidStore.fetchProject(projectId.value),
      supplierStore.fetchProfile(),
    ])
    // Check for existing draft
    try {
      const sub = await supplierApi.getBidSubmission(projectId.value) as any
      if (sub) {
        existingSubmission.value = sub
        form.value = {
          bidPrice: sub.bidPrice || '',
          deliveryPeriod: sub.deliveryPeriod || '',
          technicalFileAssetId: sub.technicalFileAssetId || '',
          businessFileAssetId: sub.businessFileAssetId || '',
          coverLetter: sub.coverLetter || '',
        }
      }
    } catch {}
  } finally {
    loading.value = false
  }
})

const isApproved = computed(() => supplierStore.profile?.status === 'APPROVED')
const canSubmit = computed(() => {
  if (!project.value || !isApproved.value) return false
  const p = project.value
  return (p.stage === 'DOWNLOAD' || p.stage === 'SUBMIT') && new Date(p.deadline) > new Date()
})

async function saveDraft() {
  saving.value = true
  try {
    await supplierApi.saveBidDraft(projectId.value, form.value)
    ElMessage.success('草稿已保存')
  } catch {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

async function handleSubmit() {
  if (!form.value.bidPrice) {
    ElMessage.warning('请填写投标报价')
    return
  }
  if (!form.value.deliveryPeriod) {
    ElMessage.warning('请填写交货/工期')
    return
  }

  await ElMessageBox.confirm(
    '提交后将无法修改，请确认所有信息填写正确。确定要提交标书吗？',
    '确认提交标书',
    { type: 'warning', confirmButtonText: '确认提交', cancelButtonText: '再检查一下' },
  )

  submitting.value = true
  try {
    await supplierApi.submitBid(projectId.value, form.value)
    ElMessage.success('标书提交成功！')
    router.push('/my-bids')
  } catch (err: any) {
    const msg = err?.response?.data?.error || '提交失败'
    ElMessage.error(msg)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <el-button link @click="router.push(`/bids/${projectId}`)" style="margin-bottom: 16px;">
      <el-icon><ArrowLeft /></el-icon> 返回项目详情
    </el-button>

    <template v-if="project">
      <!-- Warning banner -->
      <el-alert
        v-if="!canSubmit"
        type="error"
        :closable="false"
        show-icon
        style="margin-bottom: 20px;"
      >
        <template #title>
          {{ !isApproved ? '您的供应商账号尚未通过审核，无法投标' : '该项目当前不可投标（可能已过截止时间或不在投标阶段）' }}
        </template>
      </el-alert>

      <el-alert
        v-if="canSubmit"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 20px;"
      >
        <template #title>
          投标截止时间：{{ dayjs(project.deadline).format('YYYY年MM月DD日 HH:mm') }}，请在截止前完成提交。
        </template>
      </el-alert>

      <!-- Project summary -->
      <div class="sp-card" style="background: linear-gradient(135deg, #f0f7ff, #e6f2fc); border-color: #bfdbfe;">
        <div class="submit-project-info">
          <h3 class="submit-project-name">{{ project.name }}</h3>
          <div class="submit-project-meta">
            <span>{{ project.projectCode }}</span>
            <span>{{ project.procurementMethod }}</span>
            <span>截止：{{ dayjs(project.deadline).format('YYYY-MM-DD HH:mm') }}</span>
          </div>
        </div>
      </div>

      <!-- Bid form -->
      <div class="sp-card" style="margin-top: 16px;">
        <div class="sp-card-header">
          <span class="sp-card-title">标书信息</span>
          <el-tag v-if="existingSubmission" :type="existingSubmission.status === 'draft' ? 'info' : 'success'" effect="plain">
            {{ existingSubmission.status === 'draft' ? '草稿' : '已提交' }}
          </el-tag>
        </div>

        <el-form :model="form" label-width="120px" size="large" :disabled="!canSubmit || existingSubmission?.status === 'submitted'">
          <el-form-item label="投标报价" required>
            <el-input v-model="form.bidPrice" placeholder="例如：1260.00万元">
              <template #append>万元</template>
            </el-input>
          </el-form-item>

          <el-form-item label="交货/工期" required>
            <el-input v-model="form.deliveryPeriod" placeholder="例如：120日历天" />
          </el-form-item>

          <el-form-item label="技术方案文件">
            <div class="file-upload-area">
              <el-upload :http-request="uploadTech" :show-file-list="false" :disabled="!canSubmit || existingSubmission?.status === 'submitted'">
                <el-button type="primary" plain :disabled="!canSubmit || existingSubmission?.status === 'submitted'">
                  <el-icon><Upload /></el-icon>上传技术方案
                </el-button>
              </el-upload>
              <span class="file-hint">支持 PDF 格式，不超过 50MB</span>
              <span v-if="techFileMeta" class="file-name">{{ techFileMeta.originalName }}（{{ formatSize(techFileMeta.size) }}）</span>
              <span v-else-if="form.technicalFileAssetId" class="file-name">已上传文件</span>
            </div>
          </el-form-item>

          <el-form-item label="商务文件">
            <div class="file-upload-area">
              <el-upload :http-request="uploadBiz" :show-file-list="false" :disabled="!canSubmit || existingSubmission?.status === 'submitted'">
                <el-button type="primary" plain :disabled="!canSubmit || existingSubmission?.status === 'submitted'">
                  <el-icon><Upload /></el-icon>上传商务文件
                </el-button>
              </el-upload>
              <span class="file-hint">支持 PDF 格式，不超过 50MB</span>
              <span v-if="bizFileMeta" class="file-name">{{ bizFileMeta.originalName }}（{{ formatSize(bizFileMeta.size) }}）</span>
              <span v-else-if="form.businessFileAssetId" class="file-name">已上传文件</span>
            </div>
          </el-form-item>

          <el-form-item label="投标函">
            <el-input v-model="form.coverLetter" type="textarea" :rows="4" placeholder="请输入投标函内容（选填）" />
          </el-form-item>
        </el-form>

        <!-- Actions -->
        <div class="submit-actions" v-if="canSubmit && existingSubmission?.status !== 'submitted'">
          <el-button size="large" :loading="saving" @click="saveDraft">
            <el-icon><FolderAdd /></el-icon>保存草稿
          </el-button>
          <el-button type="primary" size="large" :loading="submitting" @click="handleSubmit">
            <el-icon><CircleCheck /></el-icon>
            {{ submitting ? '提交中...' : '正式提交标书' }}
          </el-button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.submit-project-info {
  text-align: center;
  padding: 8px 0;
}

.submit-project-name {
  font-size: 18px;
  font-weight: 800;
  color: var(--sp-gray-900);
  margin-bottom: 8px;
}

.submit-project-meta {
  display: flex;
  justify-content: center;
  gap: 20px;
  font-size: 13px;
  color: var(--sp-gray-500);
}

.file-upload-area {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.file-hint {
  font-size: 12px;
  color: var(--sp-gray-400);
}

.file-name {
  font-size: 13px;
  color: var(--sp-primary);
  font-weight: 600;
}

.submit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--sp-border-light);
}
</style>
