<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBidStore } from '@/stores/bid'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import { uploadFile, type FileAssetResponse } from '@/api/upload'
import { useAutoSave, useRouteLeaveGuard } from '@/composables'
import dayjs from 'dayjs'

const route = useRoute(); const router = useRouter(); const bidStore = useBidStore(); const supplierStore = useSupplierStore()
const loading = ref(true); const error = ref(false); const submitting = ref(false); const saving = ref(false)
const projectId = computed(() => route.params.id as string)
const form = ref({ bidPrice: '', deliveryPeriod: '', technicalFileAssetId: '', businessFileAssetId: '', coverLetter: '' })
const project = computed(() => bidStore.currentProject)
const existingSubmission = ref<any>(null)
const techFileMeta = ref<FileAssetResponse | null>(null); const bizFileMeta = ref<FileAssetResponse | null>(null)
const techUploadProgress = ref<number | null>(null); const bizUploadProgress = ref<number | null>(null)
const autoSaveReady = ref(false); const showRecovery = ref(false); const submitDialogVisible = ref(false)
const draft = useAutoSave(() => 'bidsubmit:'+projectId.value, form, { enabled: autoSaveReady })
useRouteLeaveGuard(draft.dirty)
function acceptRecovery() { const d = draft.restoreDraft(); if (d) Object.assign(form.value, d); showRecovery.value = false }
function discardRecovery() { draft.clearDraft(); showRecovery.value = false }

async function handleFileUpload(options: any, field: 'technicalFileAssetId' | 'businessFileAssetId') {
  const file = options.file as File
  if (file.size > 50*1024*1024) { ElMessage.error('文件不能超过50MB'); options.onError(new Error('FILE_TOO_LARGE')); return }
  const pRef = field==='technicalFileAssetId' ? techUploadProgress : bizUploadProgress
  pRef.value = 0
  try { const res = await uploadFile(file, 'bid_document', (pct)=> { pRef.value = pct }); form.value[field] = res.id; if (field==='technicalFileAssetId') techFileMeta.value = res; else bizFileMeta.value = res; options.onSuccess(res); ElMessage.success('文件上传成功') } catch (e: any) { options.onError(e) } finally { pRef.value = null }
}
const uploadTech = (o: any) => handleFileUpload(o, 'technicalFileAssetId'); const uploadBiz = (o: any) => handleFileUpload(o, 'businessFileAssetId')
function formatSize(bytes: number): string { if (bytes<1024) return `${bytes} B`; if (bytes<1024*1024) return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/1024/1024).toFixed(1)} MB` }

onMounted(async () => {
  try { await Promise.all([bidStore.fetchProject(projectId.value), supplierStore.fetchProfile()]); try { const sub = await supplierApi.getBidSubmission(projectId.value) as any; if (sub) { existingSubmission.value = sub; form.value = { bidPrice: sub.bidPrice||'', deliveryPeriod: sub.deliveryPeriod||'', technicalFileAssetId: sub.technicalFileAssetId||'', businessFileAssetId: sub.businessFileAssetId||'', coverLetter: sub.coverLetter||'' } } } catch {}; if (draft.restoreDraft() && draft.storedAt.value && (!existingSubmission.value || draft.storedAt.value > new Date(existingSubmission.value.updatedAt).getTime())) { showRecovery.value = true } } catch { error.value = true } finally { loading.value = false; autoSaveReady.value = true; draft.markClean() }
})
async function retryLoad() { error.value = false; loading.value = true; try { await Promise.all([bidStore.fetchProject(projectId.value), supplierStore.fetchProfile()]); try { const sub = await supplierApi.getBidSubmission(projectId.value) as any; if (sub) { existingSubmission.value = sub; form.value = { bidPrice: sub.bidPrice||'', deliveryPeriod: sub.deliveryPeriod||'', technicalFileAssetId: sub.technicalFileAssetId||'', businessFileAssetId: sub.businessFileAssetId||'', coverLetter: sub.coverLetter||'' } } } catch {} } catch { error.value = true } finally { loading.value = false } }
const isApproved = computed(() => supplierStore.profile?.status === 'APPROVED')
const canSubmit = computed(() => { if (!project.value||!isApproved.value) return false; return (project.value.stage==='DOWNLOAD'||project.value.stage==='SUBMIT') && new Date(project.value.deadline) > new Date() })
async function saveDraft() { saving.value = true; try { await supplierApi.saveBidDraft(projectId.value, form.value); ElMessage.success('草稿已保存') } catch { ElMessage.error('保存失败') } finally { saving.value = false } }
const preflightItems = computed(() => {
  const d = project.value?.deadline ? new Date(project.value.deadline) : null
  const deadlineOk = !!(d && d > new Date())
  return [
    { label:'供应商资质', detail:isApproved.value?'已入库，可投标':'未通过审核，无法投标', ok:isApproved.value, required:true },
    { label:'投标报价', detail:form.value.bidPrice?`${form.value.bidPrice} 万元`:'未填写', ok:!!form.value.bidPrice, required:true },
    { label:'交货工期', detail:form.value.deliveryPeriod||'未填写', ok:!!form.value.deliveryPeriod, required:true },
    { label:'技术方案', detail:form.value.technicalFileAssetId?'已上传':'未上传（选填）', ok:!!form.value.technicalFileAssetId, required:false },
    { label:'商务文件', detail:form.value.businessFileAssetId?'已上传':'未上传（选填）', ok:!!form.value.businessFileAssetId, required:false },
    { label:'投标截止', detail:d?dayjs(d).format('YYYY-MM-DD HH:mm'):'未知', ok:deadlineOk, required:true },
  ]
})
const canConfirm = computed(() => preflightItems.value.every(i => i.ok || !i.required))
function openSubmitDialog() { submitDialogVisible.value = true }
async function confirmSubmit() { submitDialogVisible.value = false; submitting.value = true; try { await supplierApi.submitBid(projectId.value, form.value); draft.clearDraft(); ElMessage.success('标书提交成功！'); router.push('/my-bids') } catch (err: any) { ElMessage.error(err?.response?.data?.error || '提交失败') } finally { submitting.value = false } }
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
      <el-alert v-if="showRecovery" type="success" :closable="false" show-icon style="margin-bottom:20px"><template #title>检测到本地草稿（{{ dayjs(draft.storedAt).format('HH:mm') }}），是否恢复？</template><template #default><div style="margin-top:8px;display:flex;gap:12px"><el-button size="small" type="primary" @click="acceptRecovery">恢复草稿</el-button><el-button size="small" @click="discardRecovery">丢弃</el-button></div></template></el-alert>

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
          <el-form-item label="技术方案"><div class="file-area"><el-upload :http-request="uploadTech" :show-file-list="false" :disabled="!canSubmit"><el-button type="primary" plain :disabled="!canSubmit"><el-icon><Upload /></el-icon>上传技术方案</el-button></el-upload><span class="file-hint">PDF，≤50MB</span><span v-if="techFileMeta" class="file-name">{{ techFileMeta.originalName }}（{{ formatSize(techFileMeta.size) }}）</span><span v-else-if="form.technicalFileAssetId" class="file-name">已上传</span><el-progress v-if="techUploadProgress!==null" :percentage="techUploadProgress" :stroke-width="6" style="width:200px" /></div></el-form-item>
          <el-form-item label="商务文件"><div class="file-area"><el-upload :http-request="uploadBiz" :show-file-list="false" :disabled="!canSubmit"><el-button type="primary" plain :disabled="!canSubmit"><el-icon><Upload /></el-icon>上传商务文件</el-button></el-upload><span class="file-hint">PDF，≤50MB</span><span v-if="bizFileMeta" class="file-name">{{ bizFileMeta.originalName }}（{{ formatSize(bizFileMeta.size) }}）</span><span v-else-if="form.businessFileAssetId" class="file-name">已上传</span><el-progress v-if="bizUploadProgress!==null" :percentage="bizUploadProgress" :stroke-width="6" style="width:200px" /></div></el-form-item>
          <el-form-item label="投标函"><el-input v-model="form.coverLetter" type="textarea" :rows="4" placeholder="请输入投标函内容（选填）" /></el-form-item>
        </el-form>
        <div v-if="canSubmit && existingSubmission?.status!=='submitted'" class="submit-actions">
          <span v-if="draft.lastSavedAt" class="auto-save-hint">已自动保存 {{ dayjs(draft.lastSavedAt).format('HH:mm') }}</span>
          <el-button size="large" :loading="saving" @click="saveDraft"><el-icon><FolderAdd /></el-icon>保存草稿</el-button>
          <el-button type="primary" size="large" :loading="submitting" @click="openSubmitDialog"><el-icon><CircleCheck /></el-icon>{{ submitting?'提交中...':'正式提交标书' }}</el-button>
        </div>
      </div>
    </template>

    <el-dialog v-model="submitDialogVisible" title="提交前检查" width="500px" destroy-on-close>
      <div class="preflight-list">
        <div v-for="item in preflightItems" :key="item.label" class="preflight-item">
          <span class="preflight-icon" :class="item.ok?'green':(item.required?'red':'orange')">{{ item.ok?'✓':(item.required?'✗':'⚠') }}</span>
          <div class="preflight-text">
            <span class="preflight-label">{{ item.label }}</span>
            <span class="preflight-detail">{{ item.detail }}</span>
          </div>
        </div>
      </div>
      <el-alert v-if="!canConfirm" type="error" :closable="false" show-icon style="margin-top:16px"><template #title>存在未通过的必填项，请完善后重新提交</template></el-alert>
      <el-alert v-else type="success" :closable="false" show-icon style="margin-top:16px"><template #title>检查通过，可以提交</template></el-alert>
      <template #footer>
        <el-button @click="submitDialogVisible=false">取消</el-button>
        <el-button type="primary" :disabled="!canConfirm" @click="confirmSubmit">确认提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.detail-card { background: #fff; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-md); padding: 24px; }
.card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--sp-border-light); }
.card-title { font-size: 15px; font-weight: 800; color: var(--sp-gray-900); }
.file-area { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.file-hint { font-size: 12px; color: var(--sp-gray-400); }
.file-name { font-size: 13px; color: var(--sp-primary); font-weight: 600; }
.submit-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--sp-border-light); }
.auto-save-hint { font-size: 12px; color: var(--sp-gray-400); margin-right: auto; display: flex; align-items: center; }
.preflight-list { display: flex; flex-direction: column; gap: 12px; }
.preflight-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px; background: var(--sp-gray-50); }
.preflight-icon { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 900; flex-shrink: 0; }
.preflight-icon.green { background: #ecfdf5; color: #059669; }
.preflight-icon.orange { background: #fffbeb; color: #d97706; }
.preflight-icon.red { background: #fef2f2; color: #dc2626; }
.preflight-text { display: flex; flex-direction: column; gap: 2px; }
.preflight-label { font-size: 14px; font-weight: 700; color: var(--sp-gray-900); }
.preflight-detail { font-size: 12px; color: var(--sp-gray-500); }
</style>
