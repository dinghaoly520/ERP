<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBidStore } from '@/stores/bid'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import { uploadFile, type FileAssetResponse } from '@/api/upload'
import dayjs from 'dayjs'

const route = useRoute(); const router = useRouter(); const bidStore = useBidStore(); const supplierStore = useSupplierStore()
const loading = ref(true); const error = ref(false); const submitting = ref(false); const saving = ref(false)
const projectId = computed(() => route.params.id as string)
const form = ref({ bidPrice: '', deliveryPeriod: '', technicalFileAssetId: '', businessFileAssetId: '', coverLetter: '' })
const project = computed(() => bidStore.currentProject)
const existingSubmission = ref<any>(null)
const techFileMeta = ref<FileAssetResponse | null>(null); const bizFileMeta = ref<FileAssetResponse | null>(null)

async function handleFileUpload(options: any, field: 'technicalFileAssetId' | 'businessFileAssetId') {
  const file = options.file as File
  if (file.size > 50*1024*1024) { ElMessage.error('文件不能超过50MB'); options.onError(new Error('FILE_TOO_LARGE')); return }
  try { const res = await uploadFile(file, 'bid_document'); form.value[field] = res.id; if (field==='technicalFileAssetId') techFileMeta.value = res; else bizFileMeta.value = res; options.onSuccess(res); ElMessage.success('文件上传成功') } catch (e: any) { options.onError(e) }
}
const uploadTech = (o: any) => handleFileUpload(o, 'technicalFileAssetId'); const uploadBiz = (o: any) => handleFileUpload(o, 'businessFileAssetId')
function formatSize(bytes: number): string { if (bytes<1024) return `${bytes} B`; if (bytes<1024*1024) return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/1024/1024).toFixed(1)} MB` }

onMounted(async () => {
  try { await Promise.all([bidStore.fetchProject(projectId.value), supplierStore.fetchProfile()]); try { const sub = await supplierApi.getBidSubmission(projectId.value) as any; if (sub) { existingSubmission.value = sub; form.value = { bidPrice: sub.bidPrice||'', deliveryPeriod: sub.deliveryPeriod||'', technicalFileAssetId: sub.technicalFileAssetId||'', businessFileAssetId: sub.businessFileAssetId||'', coverLetter: sub.coverLetter||'' } } } catch {} } catch { error.value = true } finally { loading.value = false }
})
async function retryLoad() { error.value = false; loading.value = true; try { await Promise.all([bidStore.fetchProject(projectId.value), supplierStore.fetchProfile()]); try { const sub = await supplierApi.getBidSubmission(projectId.value) as any; if (sub) { existingSubmission.value = sub; form.value = { bidPrice: sub.bidPrice||'', deliveryPeriod: sub.deliveryPeriod||'', technicalFileAssetId: sub.technicalFileAssetId||'', businessFileAssetId: sub.businessFileAssetId||'', coverLetter: sub.coverLetter||'' } } } catch {} } catch { error.value = true } finally { loading.value = false } }
const isApproved = computed(() => supplierStore.profile?.status === 'APPROVED')
const canSubmit = computed(() => { if (!project.value||!isApproved.value) return false; return (project.value.stage==='DOWNLOAD'||project.value.stage==='SUBMIT') && new Date(project.value.deadline) > new Date() })
async function saveDraft() { saving.value = true; try { await supplierApi.saveBidDraft(projectId.value, form.value); ElMessage.success('草稿已保存') } catch { ElMessage.error('保存失败') } finally { saving.value = false } }
async function handleSubmit() {
  if (!form.value.bidPrice) { ElMessage.warning('请填写投标报价'); return }
  if (!form.value.deliveryPeriod) { ElMessage.warning('请填写交货/工期'); return }
  await ElMessageBox.confirm('提交后将无法修改，确定提交？', '确认提交', { type: 'warning', confirmButtonText: '确认提交', cancelButtonText: '再检查一下' })
  submitting.value = true; try { await supplierApi.submitBid(projectId.value, form.value); ElMessage.success('标书提交成功！'); router.push('/my-bids') } catch (err: any) { ElMessage.error(err?.response?.data?.error || '提交失败') } finally { submitting.value = false }
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <el-button link @click="router.push(`/bids/${projectId}`)" style="margin-bottom:16px"><el-icon><ArrowLeft /></el-icon>返回项目详情</el-button>
    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else-if="project">
      <el-alert v-if="!canSubmit" type="error" :closable="false" show-icon style="margin-bottom:20px"><template #title>{{ !isApproved?'供应商账号尚未通过审核，无法投标':'该项目当前不可投标' }}</template></el-alert>
      <el-alert v-if="canSubmit" type="warning" :closable="false" show-icon style="margin-bottom:20px"><template #title>投标截止：{{ dayjs(project.deadline).format('YYYY年MM月DD日 HH:mm') }}，请在截止前完成提交。</template></el-alert>

      <div class="sp-page-hero-card">
        <div class="sp-page-hero-inner">
          <div class="sp-page-hero-body">
            <div class="sp-page-eyebrow blue"><el-icon :size="13"><Upload /></el-icon>Submit Bid</div>
            <h1 class="sp-modern-title">{{ project.name }}</h1>
            <p class="sp-modern-desc">{{ project.projectCode }} · {{ project.procurementMethod }} · 截止 {{ dayjs(project.deadline).format('MM-DD HH:mm') }}</p>
          </div>
        </div>
      </div>

      <div class="detail-card" style="margin-top:20px">
        <div class="card-header"><span class="card-title">标书信息</span><el-tag v-if="existingSubmission" :type="existingSubmission.status==='draft'?'info':'success'" effect="plain">{{ existingSubmission.status==='draft'?'草稿':'已提交' }}</el-tag></div>
        <el-form :model="form" label-width="120px" size="large" :disabled="!canSubmit||existingSubmission?.status==='submitted'">
          <el-form-item label="投标报价" required><el-input v-model="form.bidPrice" placeholder="例如：1260.00"><template #append>万元</template></el-input></el-form-item>
          <el-form-item label="交货/工期" required><el-input v-model="form.deliveryPeriod" placeholder="例如：120日历天" /></el-form-item>
          <el-form-item label="技术方案"><div class="file-area"><el-upload :http-request="uploadTech" :show-file-list="false" :disabled="!canSubmit"><el-button type="primary" plain :disabled="!canSubmit"><el-icon><Upload /></el-icon>上传技术方案</el-button></el-upload><span class="file-hint">PDF，≤50MB</span><span v-if="techFileMeta" class="file-name">{{ techFileMeta.originalName }}（{{ formatSize(techFileMeta.size) }}）</span><span v-else-if="form.technicalFileAssetId" class="file-name">已上传</span></div></el-form-item>
          <el-form-item label="商务文件"><div class="file-area"><el-upload :http-request="uploadBiz" :show-file-list="false" :disabled="!canSubmit"><el-button type="primary" plain :disabled="!canSubmit"><el-icon><Upload /></el-icon>上传商务文件</el-button></el-upload><span class="file-hint">PDF，≤50MB</span><span v-if="bizFileMeta" class="file-name">{{ bizFileMeta.originalName }}（{{ formatSize(bizFileMeta.size) }}）</span><span v-else-if="form.businessFileAssetId" class="file-name">已上传</span></div></el-form-item>
          <el-form-item label="投标函"><el-input v-model="form.coverLetter" type="textarea" :rows="4" placeholder="请输入投标函内容（选填）" /></el-form-item>
        </el-form>
        <div v-if="canSubmit && existingSubmission?.status!=='submitted'" class="submit-actions">
          <el-button size="large" :loading="saving" @click="saveDraft"><el-icon><FolderAdd /></el-icon>保存草稿</el-button>
          <el-button type="primary" size="large" :loading="submitting" @click="handleSubmit"><el-icon><CircleCheck /></el-icon>{{ submitting?'提交中...':'正式提交标书' }}</el-button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.detail-card { background: #fff; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); padding: 24px; }
.card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--sp-border-light); }
.card-title { font-size: 15px; font-weight: 800; color: var(--sp-gray-900); }
.file-area { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.file-hint { font-size: 12px; color: var(--sp-gray-400); }
.file-name { font-size: 13px; color: var(--sp-primary); font-weight: 600; }
.submit-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--sp-border-light); }
</style>
