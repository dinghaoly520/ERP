<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBidStore } from '@/stores/bid'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import { uploadFile, type FileAssetResponse } from '@/api/upload'
import { useAutoSave, useRouteLeaveGuard } from '@/composables'
import SpPageHero from '@/components/SpPageHero.vue'
import { Send, AlertTriangle, Check, X, Upload, Plus, Trash2 } from 'lucide-vue-next'
import dayjs from 'dayjs'

const route = useRoute(); const router = useRouter(); const bidStore = useBidStore(); const supplierStore = useSupplierStore()
const maxUploadSizeMB = Number(import.meta.env.VITE_MAX_UPLOAD_SIZE_MB) || 50
const maxUploadSize = maxUploadSizeMB * 1024 * 1024
const loading = ref(true); const error = ref(false); const submitting = ref(false); const saving = ref(false)
const projectId = computed(() => route.params.id as string)

// 提交模式：full=完整标书，split=拆分文件
const submissionMode = ref<'full' | 'split'>('full')
// 投标函模式：text=文字输入，file=上传文件
const coverLetterMode = ref<'text' | 'file'>('text')

// 拆分文件条目
interface FileEntry { id: string; name: string; size: number }
interface SplitCategory {
  label: string
  description: string
  files: FileEntry[]
  uploading: boolean
  progress: number | null
}

const form = ref({
  bidPrice: '',
  deliveryPeriod: '',
  fullBidFileAssetId: '',   // 完整标书模式
  coverLetter: '',
  coverLetterFileAssetId: '', // 投标函文件
  bidBondAssetId: '',
})

const project = computed(() => bidStore.currentProject)
const heroSub = computed(() => {
  const p = project.value
  return p ? `${p.projectCode} · ${p.procurementMethod} · 截止 ${p.deadline ? dayjs(p.deadline).format('MM-DD HH:mm') : '--'}` : ''
})
const existingSubmission = ref<any>(null)
const fullBidMeta = ref<FileAssetResponse | null>(null)
const fullBidProgress = ref<number | null>(null)
const coverLetterMeta = ref<FileAssetResponse | null>(null)
const coverLetterProgress = ref<number | null>(null)
const bondFileMeta = ref<FileAssetResponse | null>(null)
const bondUploadProgress = ref<number | null>(null)

const splitCats = ref<{ tech: SplitCategory; biz: SplitCategory; other: SplitCategory }>({
  tech:  { label: '技术方案', description: '技术方案、实施方案、质量控制等', files: [], uploading: false, progress: null },
  biz:   { label: '商务文件', description: '报价明细、资质证明、业绩案例等', files: [], uploading: false, progress: null },
  other: { label: '其他材料', description: '补充说明、认证证书、授权函等', files: [], uploading: false, progress: null },
})

const autoSaveReady = ref(false); const showRecovery = ref(false); const submitDialogVisible = ref(false)
const draft = useAutoSave(() => 'bidsubmit:'+projectId.value, form, { enabled: autoSaveReady })
useRouteLeaveGuard(draft.dirty)
function acceptRecovery() { const d = draft.restoreDraft(); if (d) Object.assign(form.value, d); showRecovery.value = false }
function discardRecovery() { draft.clearDraft(); showRecovery.value = false }

function formatSize(bytes: number): string { if (bytes<1024) return `${bytes} B`; if (bytes<1024*1024) return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/1024/1024).toFixed(1)} MB` }

// bidPrice 存为字符串，可能以万元或元为单位。≥10000 视为元自动换算。
function formatBidPrice(raw: string | number | null | undefined): string {
  const n = Number(raw)
  if (!raw || isNaN(n)) return '未填写'
  if (n >= 10000) return `${(n / 10000).toFixed(2)} 万元`
  return `${n} 万元`
}

// ── 完整标书上传 ──
async function handleFullBidUpload(options: any) {
  const file = options.file as File
  if (file.size > maxUploadSize) { ElMessage.error(`文件不能超过${maxUploadSizeMB}MB`); options.onError(new Error('FILE_TOO_LARGE')); return }
  fullBidProgress.value = 0
  try {
    const res = await uploadFile(file, 'bid_document', (pct) => { fullBidProgress.value = pct })
    form.value.fullBidFileAssetId = res.id
    fullBidMeta.value = res
    options.onSuccess(res)
    ElMessage.success('文件上传成功')
  } catch (e: any) { options.onError(e) }
  finally { fullBidProgress.value = null }
}

// ── 拆分文件上传 ──
async function handleSplitUpload(catKey: 'tech' | 'biz' | 'other', options: any) {
  const file = options.file as File
  if (file.size > maxUploadSize) { ElMessage.error(`文件不能超过${maxUploadSizeMB}MB`); options.onError(new Error('FILE_TOO_LARGE')); return }
  const cat = splitCats.value[catKey]
  cat.uploading = true; cat.progress = 0
  try {
    const res = await uploadFile(file, 'bid_document', (pct) => { cat.progress = pct })
    cat.files.push({ id: res.id, name: res.originalName, size: res.size })
    options.onSuccess(res)
    ElMessage.success('文件上传成功')
  } catch (e: any) { options.onError(e) }
  finally { cat.uploading = false; cat.progress = null }
}

function removeSplitFile(catKey: 'tech' | 'biz' | 'other', index: number) {
  splitCats.value[catKey].files.splice(index, 1)
}

// ── 保证金上传 ──
async function handleBondUpload(options: any) {
  const file = options.file as File
  if (file.size > maxUploadSize) { ElMessage.error(`文件不能超过${maxUploadSizeMB}MB`); options.onError(new Error('FILE_TOO_LARGE')); return }
  bondUploadProgress.value = 0
  try {
    const res = await uploadFile(file, 'bid_document', (pct) => { bondUploadProgress.value = pct })
    form.value.bidBondAssetId = res.id
    bondFileMeta.value = res
    options.onSuccess(res)
    ElMessage.success('文件上传成功')
  } catch (e: any) { options.onError(e) }
  finally { bondUploadProgress.value = null }
}

// ── 投标函文件上传 ──
async function handleCoverLetterUpload(options: any) {
  const file = options.file as File
  if (file.size > maxUploadSize) { ElMessage.error(`文件不能超过${maxUploadSizeMB}MB`); options.onError(new Error('FILE_TOO_LARGE')); return }
  coverLetterProgress.value = 0
  try {
    const res = await uploadFile(file, 'bid_document', (pct) => { coverLetterProgress.value = pct })
    form.value.coverLetterFileAssetId = res.id
    coverLetterMeta.value = res
    options.onSuccess(res)
    ElMessage.success('投标函文件上传成功')
  } catch (e: any) { options.onError(e) }
  finally { coverLetterProgress.value = null }
}

onMounted(async () => {
  try {
    await Promise.all([bidStore.fetchProject(projectId.value), supplierStore.fetchProfile()])
    if (project.value && project.value.stage !== 'SUBMIT') {
      ElMessage.warning('该项目当前不在投标阶段')
      router.push(`/bids/${projectId.value}`)
      return
    }
    try {
      const sub = await supplierApi.getBidSubmission(projectId.value) as any
      if (sub) {
        existingSubmission.value = sub
        form.value = {
          bidPrice: sub.bidPrice || '',
          deliveryPeriod: sub.deliveryPeriod || '',
          fullBidFileAssetId: sub.fullBidFileAssetId || '',
          coverLetter: sub.coverLetter || '',
          coverLetterFileAssetId: sub.coverLetterFileAssetId || '',
          bidBondAssetId: sub.bidBondAssetId || '',
        }
      }
    } catch {}
    if (draft.restoreDraft() && draft.storedAt.value && (!existingSubmission.value || draft.storedAt.value > new Date(existingSubmission.value.updatedAt).getTime())) {
      showRecovery.value = true
    }
  } catch { error.value = true }
  finally { loading.value = false; autoSaveReady.value = true; draft.markClean() }
})

async function retryLoad() {
  error.value = false; loading.value = true
  try {
    await Promise.all([bidStore.fetchProject(projectId.value), supplierStore.fetchProfile()])
    try {
      const sub = await supplierApi.getBidSubmission(projectId.value) as any
      if (sub) {
        existingSubmission.value = sub
        form.value = { bidPrice: sub.bidPrice||'', deliveryPeriod: sub.deliveryPeriod||'', fullBidFileAssetId: sub.fullBidFileAssetId||'', coverLetter: sub.coverLetter||'', coverLetterFileAssetId: sub.coverLetterFileAssetId||'', bidBondAssetId: sub.bidBondAssetId || '' }
      }
    } catch {}
  } catch { error.value = true }
  finally { loading.value = false }
}

const isApproved = computed(() => supplierStore.profile?.status === 'APPROVED')
const canSubmit = computed(() => {
  if (!project.value||!isApproved.value) return false
  return project.value.stage==='SUBMIT' && new Date(project.value.deadline) > new Date()
})

async function saveDraft() {
  saving.value = true
  try {
    const payload: any = { ...form.value }
    if (submissionMode.value === 'split') {
      payload.splitFiles = {
        tech: splitCats.value.tech.files,
        biz: splitCats.value.biz.files,
        other: splitCats.value.other.files,
      }
    }
    await supplierApi.saveBidDraft(projectId.value, payload)
    ElMessage.success('草稿已保存')
  } catch { ElMessage.error('保存失败') }
  finally { saving.value = false }
}

const preflightItems = computed(() => {
  const d = project.value?.deadline ? new Date(project.value.deadline) : null
  const deadlineOk = !!(d && d > new Date())
  let fileOk = false, fileDetail = ''
  if (submissionMode.value === 'full') {
    fileOk = !!form.value.fullBidFileAssetId
    fileDetail = fileOk ? '已上传' : '未上传'
  } else {
    const total = splitCats.value.tech.files.length + splitCats.value.biz.files.length + splitCats.value.other.files.length
    fileOk = total > 0
    fileDetail = fileOk ? `已上传 ${total} 个文件` : '未上传任何文件'
  }
  const items = [
    { label:'供应商资质', detail:isApproved.value?'已入库，可投标':'未通过审核，无法投标', ok:isApproved.value, required:true },
    { label:'投标报价', detail:formatBidPrice(form.value.bidPrice), ok:!!form.value.bidPrice, required:true },
    { label:'交货工期', detail:form.value.deliveryPeriod||'未填写', ok:!!form.value.deliveryPeriod, required:true },
    { label: submissionMode.value === 'full' ? '完整标书文件' : '拆分标书文件', detail: fileDetail, ok: fileOk, required: true },
  ]
  if (bidStore.project?.bondRequired) {
    items.push({ label:'投标保证金凭证', detail:form.value.bidBondAssetId?'已上传':'未上传', ok:!!form.value.bidBondAssetId, required:true })
  }
  items.push({ label:'投标截止', detail:d?dayjs(d).format('YYYY-MM-DD HH:mm'):'未知', ok:deadlineOk, required:true })
  return items
})

const canConfirm = computed(() => preflightItems.value.every(i => i.ok || !i.required))
function openSubmitDialog() { submitDialogVisible.value = true }
async function confirmSubmit() {
  submitDialogVisible.value = false; submitting.value = true
  try {
    const payload: any = { ...form.value }
    if (submissionMode.value === 'split') {
      payload.splitFiles = {
        tech: splitCats.value.tech.files,
        biz: splitCats.value.biz.files,
        other: splitCats.value.other.files,
      }
    }
    await supplierApi.submitBid(projectId.value, payload)
    draft.clearDraft()
    ElMessage.success('标书提交成功！')
    router.push('/my-bids')
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '提交失败')
  } finally { submitting.value = false }
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <button type="button" class="neu-link back-link" @click="router.push(`/bids/${projectId}`)"><el-icon><ArrowLeft /></el-icon>返回项目详情</button>
    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else-if="project">
      <el-alert v-if="!canSubmit" type="error" :closable="false" show-icon style="margin-bottom:20px"><template #title>{{ !isApproved?'供应商账号尚未通过审核，无法投标':'该项目当前不可投标' }}</template></el-alert>
      <el-alert v-if="canSubmit" type="warning" :closable="false" show-icon style="margin-bottom:20px"><template #title>投标截止：{{ project.deadline ? dayjs(project.deadline).format('YYYY年MM月DD日 HH:mm') : '--' }}，请在截止前完成提交。</template></el-alert>
      <el-alert v-if="showRecovery" type="success" :closable="false" show-icon style="margin-bottom:20px"><template #title>检测到本地草稿{{ draft.storedAt ? '（' + dayjs(draft.storedAt).format('HH:mm') + '）' : '' }}，是否恢复？</template><template #default><div style="margin-top:8px;display:flex;gap:12px"><el-button size="small" type="primary" @click="acceptRecovery">恢复草稿</el-button><el-button size="small" @click="discardRecovery">丢弃</el-button></div></template></el-alert>

      <SpPageHero :icon="Send" :title="project.name" :sub="heroSub" />

      <div class="neu-card detail-card">
        <div class="card-header">
          <span class="card-title">标书信息</span>
          <el-tag v-if="existingSubmission" :type="existingSubmission.status==='draft'?'info':'success'" effect="plain">{{ existingSubmission.status==='draft'?'草稿':'已提交' }}</el-tag>
        </div>

        <el-form :model="form" label-width="120px" size="large" :disabled="!canSubmit||existingSubmission?.status==='submitted'">
          <el-form-item label="投标报价" required>
            <el-input v-model="form.bidPrice" placeholder="报价金额（万元），如：1260" type="number" min="0"><template #append>万元</template></el-input>
          </el-form-item>
          <el-form-item label="交货/工期" required>
            <el-input v-model="form.deliveryPeriod" placeholder="例如：120日历天" />
          </el-form-item>

          <!-- ═══ 提交模式选择 ═══ -->
          <el-form-item label="提交方式" required>
            <div class="mode-selector">
              <button
                type="button"
                class="neu-tab mode-tab"
                :class="{ active: submissionMode === 'full', 'is-active': submissionMode === 'full' }"
                @click="submissionMode = 'full'"
              >完整标书</button>
              <button
                type="button"
                class="neu-tab mode-tab"
                :class="{ active: submissionMode === 'split', 'is-active': submissionMode === 'split' }"
                @click="submissionMode = 'split'"
              >拆分文件</button>
            </div>
          </el-form-item>

          <!-- ═══ 完整标书：单个文件 ═══ -->
          <el-form-item v-if="submissionMode === 'full'" label="标书文件" required>
            <div class="file-area">
              <el-upload :http-request="handleFullBidUpload" :show-file-list="false" :disabled="!canSubmit" accept=".pdf,.doc,.docx,.zip,.rar">
                <div class="neu-drop-zone"><el-icon :size="16"><Upload :size="14" :stroke-width="1.75" /></el-icon><span>上传完整标书</span></div>
              </el-upload>
              <span class="file-hint">PDF/DOC/ZIP，≤{{ maxUploadSizeMB }}MB</span>
              <span v-if="fullBidMeta" class="file-chip">
                {{ fullBidMeta.originalName }}（{{ formatSize(fullBidMeta.size) }}）
                <button type="button" class="file-chip-remove" @click="form.fullBidFileAssetId = ''; fullBidMeta = null" :disabled="!canSubmit">&times;</button>
              </span>
              <span v-else-if="form.fullBidFileAssetId" class="file-chip">
                已上传
                <button type="button" class="file-chip-remove" @click="form.fullBidFileAssetId = ''" :disabled="!canSubmit">&times;</button>
              </span>
              <el-progress v-if="fullBidProgress !== null" :percentage="fullBidProgress" :stroke-width="6" style="width:200px" />
            </div>
          </el-form-item>

          <!-- ═══ 拆分文件：三个分类，每类多文件 ═══ -->
          <template v-if="submissionMode === 'split'">
            <el-form-item v-for="cat in (['tech','biz','other'] as const)" :key="cat" :label="splitCats[cat].label" :required="cat === 'tech'">
              <div class="split-cat">
                <div class="split-cat-head">
                  <el-upload :http-request="(o: any) => handleSplitUpload(cat, o)" :show-file-list="false" :disabled="!canSubmit" :accept="'.pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.jpg,.png'">
                    <button type="button" class="neu-btn-xs" :disabled="!canSubmit || splitCats[cat].uploading">
                      <el-icon><Plus :size="12" :stroke-width="2" /></el-icon>{{ splitCats[cat].uploading ? '上传中...' : '添加文件' }}
                    </button>
                  </el-upload>
                  <span class="file-hint">{{ splitCats[cat].description }} · ≤{{ maxUploadSizeMB }}MB</span>
                  <el-progress v-if="splitCats[cat].progress !== null" :percentage="splitCats[cat].progress" :stroke-width="4" style="width:120px" />
                </div>
                <div v-if="splitCats[cat].files.length > 0" class="split-files">
                  <div v-for="(f, idx) in splitCats[cat].files" :key="f.id" class="split-file-row">
                    <span class="split-file-name">{{ f.name }}</span>
                    <span class="split-file-size">{{ formatSize(f.size) }}</span>
                    <button type="button" class="neu-btn-xs is-danger" @click="removeSplitFile(cat, idx)" :disabled="!canSubmit"><el-icon><Trash2 :size="11" :stroke-width="1.75" /></el-icon></button>
                  </div>
                </div>
              </div>
            </el-form-item>
          </template>

          <!-- 保证金 -->
          <el-form-item v-if="bidStore.project?.bondRequired" label="保证金凭证" required>
            <div class="file-area">
              <el-upload :http-request="handleBondUpload" :show-file-list="false" :disabled="!canSubmit" accept=".pdf,.jpg,.png">
                <div class="neu-drop-zone"><el-icon :size="16"><Upload :size="14" :stroke-width="1.75" /></el-icon><span>上传保证金缴纳凭证</span></div>
              </el-upload>
              <span class="file-hint">银行回单/保函，PDF/JPG ≤{{ maxUploadSizeMB }}MB</span>
              <span v-if="bondFileMeta" class="file-chip">
                {{ bondFileMeta.originalName }}（{{ formatSize(bondFileMeta.size) }}）
                <button type="button" class="file-chip-remove" @click="form.bidBondAssetId = ''; bondFileMeta = null" :disabled="!canSubmit">&times;</button>
              </span>
              <span v-else-if="form.bidBondAssetId" class="file-chip">
                已上传
                <button type="button" class="file-chip-remove" @click="form.bidBondAssetId = ''" :disabled="!canSubmit">&times;</button>
              </span>
              <el-progress v-if="bondUploadProgress !== null" :percentage="bondUploadProgress" :stroke-width="6" style="width:200px" />
            </div>
          </el-form-item>

          <el-form-item label="投标函">
            <div class="cover-letter-section">
              <div class="mode-selector mb-3">
                <button type="button" class="neu-tab mode-tab" :class="{ active: coverLetterMode === 'text', 'is-active': coverLetterMode === 'text' }" @click="coverLetterMode = 'text'">文字输入</button>
                <button type="button" class="neu-tab mode-tab" :class="{ active: coverLetterMode === 'file', 'is-active': coverLetterMode === 'file' }" @click="coverLetterMode = 'file'">上传文件</button>
              </div>
              <el-input v-if="coverLetterMode === 'text'" v-model="form.coverLetter" type="textarea" :rows="4" placeholder="请输入投标函内容（选填）" />
              <div v-else class="file-area">
                <el-upload :http-request="handleCoverLetterUpload" :show-file-list="false" :disabled="!canSubmit" accept=".pdf,.doc,.docx">
                  <div class="neu-drop-zone"><el-icon :size="16"><Upload :size="14" :stroke-width="1.75" /></el-icon><span>上传投标函文件</span></div>
                </el-upload>
                <span class="file-hint">PDF/DOC，≤{{ maxUploadSizeMB }}MB</span>
                <span v-if="coverLetterMeta" class="file-chip">
                  {{ coverLetterMeta.originalName }}（{{ formatSize(coverLetterMeta.size) }}）
                  <button type="button" class="file-chip-remove" @click="form.coverLetterFileAssetId = ''; coverLetterMeta = null" :disabled="!canSubmit">&times;</button>
                </span>
                <span v-else-if="form.coverLetterFileAssetId" class="file-chip">
                  已上传
                  <button type="button" class="file-chip-remove" @click="form.coverLetterFileAssetId = ''" :disabled="!canSubmit">&times;</button>
                </span>
                <el-progress v-if="coverLetterProgress !== null" :percentage="coverLetterProgress" :stroke-width="6" style="width:200px" />
              </div>
            </div>
          </el-form-item>
        </el-form>

        <div v-if="canSubmit && existingSubmission?.status!=='submitted'" class="submit-actions">
          <span v-if="draft.lastSavedAt" class="auto-save-hint">已自动保存 {{ draft.lastSavedAt ? dayjs(draft.lastSavedAt).format('HH:mm') : '' }}</span>
          <el-button size="large" :loading="saving" @click="saveDraft"><el-icon><FolderAdd /></el-icon>保存草稿</el-button>
          <el-button type="primary" size="large" :loading="submitting" @click="openSubmitDialog"><el-icon><CircleCheck /></el-icon>{{ submitting?'提交中...':'正式提交标书（内置加密）' }}</el-button>
        </div>
      </div>
    </template>

    <el-dialog v-model="submitDialogVisible" title="提交前检查" width="500px" destroy-on-close>
      <div class="preflight-list">
        <div v-for="item in preflightItems" :key="item.label" class="preflight-item">
          <span class="preflight-icon" :class="item.ok?'green':(item.required?'red':'orange')">
            <Check v-if="item.ok" :size="14" :stroke-width="2" />
            <X v-else-if="item.required" :size="14" :stroke-width="2" />
            <AlertTriangle v-else :size="13" :stroke-width="1.75" />
          </span>
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
.back-link { margin-bottom: 16px; }

/* ─── Form card ─── */
.detail-card { margin-top: 20px; padding: 24px; }
.card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 16px; box-shadow: inset 0 -1px 0 var(--hairline); }
.card-title { font-size: 15px; font-weight: 800; color: var(--foreground); }

/* ─── Mode selector ─── */
.mode-selector { display: flex; gap: 0; }
.mode-tab { min-width: 120px; justify-content: center; }
.mb-3 { margin-bottom: 12px; }

/* ─── Cover letter section ─── */
.cover-letter-section { width: 100%; }

/* ─── File area ─── */
.file-area { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.file-hint { font-size: 12px; color: var(--muted-foreground); }
.file-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; color: var(--brand);
  background: color-mix(in oklab, var(--brand) 8%, transparent);
  padding: 4px 10px; border-radius: 6px;
}
.file-chip-remove {
  background: none; border: none; cursor: pointer;
  font-size: 15px; font-weight: 700; color: var(--muted-foreground);
  padding: 0; line-height: 1;
}
.file-chip-remove:hover { color: var(--danger); }

/* ─── Split categories ─── */
.split-cat {
  width: 100%;
  display: flex; flex-direction: column; gap: 10px;
}
.split-cat-head {
  display: flex; align-items: center; gap: 12px;
}
.split-files {
  display: flex; flex-direction: column; gap: 6px;
}
.split-file-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-radius: 8px;
  background: var(--surface);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 1px 3px oklch(0.55 0.03 258 / 0.06), -1px -1px 2px oklch(1 0 0 / 0.6);
}
.split-file-name { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.split-file-size { font-size: 11px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; flex-shrink: 0; }

.submit-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 24px; padding-top: 20px; box-shadow: inset 0 1px 0 var(--hairline); }
.auto-save-hint { font-size: 12px; color: var(--muted-foreground); margin-right: auto; display: flex; align-items: center; }

/* ─── Preflight checklist ─── */
.preflight-list { display: flex; flex-direction: column; gap: 12px; }
.preflight-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 10px;
  background: var(--surface);
  box-shadow: inset 1px 1px 3px oklch(0.55 0.03 258 / 0.08), inset -1px -1px 3px oklch(1 0 0 / 0.6);
}
.preflight-icon { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.preflight-icon.green { background: color-mix(in oklab, var(--success) 12%, transparent); color: var(--success); }
.preflight-icon.orange { background: color-mix(in oklab, var(--warning) 12%, transparent); color: var(--warning); }
.preflight-icon.red { background: color-mix(in oklab, var(--danger) 12%, transparent); color: var(--danger); }
.preflight-text { display: flex; flex-direction: column; gap: 2px; }
.preflight-label { font-size: 14px; font-weight: 700; color: var(--foreground); }
.preflight-detail { font-size: 12px; color: var(--muted-foreground); }
</style>
