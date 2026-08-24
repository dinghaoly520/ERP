<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
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
import {
  generateDEK, encryptFile, formatDEK, computePlaintextHash, packageEncryptedFile,
  type ClientDek,
} from '@/utils/bid-crypto'
import { MockUKeyAdapter, type StorageLike, type EnvelopeFileEntry, type EnvelopeRole } from '@water-erp/ukey'
import { encryptAndUploadFile, buildEnvelope, type AdminCertRef } from '@/utils/dual-envelope'

const route = useRoute(); const router = useRouter(); const bidStore = useBidStore(); const supplierStore = useSupplierStore()
// 保留来源上下文（from=list 表示从可投标项目进入），返回时正确还原
const fromList = computed(() => route.query.from === 'list')
function backToDetail() { router.push({ path: `/bids/${projectId.value}`, query: fromList.value ? { from: 'list' } : {} }) }
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
  qualityCommitment: '',
  fullBidFileAssetId: '',   // 完整标书模式
  coverLetter: '',
  coverLetterFileAssetId: '', // 投标函文件
  bidBondAssetId: '',
})

// E2EE: 存储每个文件的 DEK（assetId → {keyHex, ivHex, authTagHex}）
const clientDeks = ref<Record<string, ClientDek>>({})
// E2EE: 加密阶段指示器（UPLOADING 时显示进度条，ENCRYPTING 时显示「正在加密…」）
const encrypting = ref<Record<string, boolean>>({})

// ═══ 双信封 v2（dual-v2 新轨）状态 ═══
// 双层加密密封条目缓存：assetId → { role, entry{sha256,kself,kadmin}, certPublicKey }（全部公开信息，无私钥）
// certPublicKey 记录上传时所用证书公钥——提交前与签名证书比对，拦截换证窗口期 kself/签名错位（fix round 1 ③）
const dualEntries = ref<Record<string, { role: EnvelopeRole; entry: EnvelopeFileEntry; certPublicKey: string }>>({})
const DUAL_STORAGE_KEY = computed(() => `supplier_dual:bidsubmit:${projectId.value}`)
// 管理方加密证书（getAdminCert，惰性缓存）
const adminCert = ref<AdminCertRef | null>(null)
// U盾会话（仅内存持有介质实例与所选证书，口令不落任何持久存储）
const ukeyAdapter = ref<MockUKeyAdapter | null>(null)
const ukeyCertSn = ref('')
const ukeyCertPublicKey = ref('')
const ukeyPassword = ref('')
const ukeyOpening = ref(false)
const ukeyDialogVisible = ref(false)
const pendingSubmit = ref(false)

/** MockUKeyAdapter storage 适配（与 UkeyManage.vue 同键，仅口令加密 keystore 落 localStorage） */
const ukeyStorage: StorageLike = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
}
/** 是否已绑定 U盾证书（profile.sm2PublicKey 由 bindCert 回填）→ 走双层加密新轨；否则保留传统 E2EE 旧轨 */
const dualReady = computed(() => !!supplierStore.profile?.sm2PublicKey)

// 前端文件分类 → 信封角色（与服务端 normalizeBidFileAssets 的三角色契约镜像）
const ROLE_BY_CAT: Record<string, EnvelopeRole> = {
  full: 'technical', 'split-tech': 'technical', 'split-biz': 'business',
  'split-other': 'coverLetter', coverLetter: 'coverLetter',
}

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
const hostDecryptConsent = ref(false) // P1-1：旧轨代解密授权勾选（新轨供应商自解无需）
// E2EE: localStorage key for DEK persistence (separate from form draft)
const DEK_STORAGE_KEY = computed(() => `supplier_dek:bidsubmit:${projectId.value}`)

// Persist clientDeks to localStorage on change
watch(clientDeks, (val) => {
  try { localStorage.setItem(DEK_STORAGE_KEY.value, JSON.stringify(val)) } catch {}
}, { deep: true })

// dualEntries 同理持久化（跨刷新回显；跨浏览器需重新上传——提交时按声明角色全量校验）
watch(dualEntries, (val) => {
  try { localStorage.setItem(DUAL_STORAGE_KEY.value, JSON.stringify(val)) } catch {}
}, { deep: true })

// Restore clientDeks from localStorage on mount
function restoreDeks() {
  try {
    const raw = localStorage.getItem(DEK_STORAGE_KEY.value)
    if (raw) { clientDeks.value = JSON.parse(raw) }
  } catch {}
  try {
    const raw = localStorage.getItem(DUAL_STORAGE_KEY.value)
    if (raw) { dualEntries.value = JSON.parse(raw) }
  } catch {}
}
function clearDeks() {
  try { localStorage.removeItem(DEK_STORAGE_KEY.value) } catch {}
  try { localStorage.removeItem(DUAL_STORAGE_KEY.value) } catch {}
}
const draft = useAutoSave(() => 'bidsubmit:'+projectId.value, form, { enabled: autoSaveReady })
useRouteLeaveGuard(draft.dirty)
function acceptRecovery() { const d = draft.restoreDraft(); if (d) Object.assign(form.value, d); restoreDeks(); showRecovery.value = false }
function discardRecovery() { draft.clearDraft(); clearDeks(); showRecovery.value = false }

function formatSize(bytes: number): string { if (bytes<1024) return `${bytes} B`; if (bytes<1024*1024) return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/1024/1024).toFixed(1)} MB` }

// ── 管理方加密证书（惰性获取并缓存）──
async function getAdminCertCached(): Promise<AdminCertRef> {
  if (adminCert.value) return adminCert.value
  const res: any = await supplierApi.getAdminCert()
  adminCert.value = { adminCertId: res.adminCertId, publicKey: res.publicKey }
  return adminCert.value
}

// ── 加密并上传文件（dual-v2：双层信封；传统：E2EE）──
async function uploadEncryptedFile(
  file: File,
  catKey: string, // identifier for encrypting state
  onProgress: (pct: number) => void,
): Promise<FileAssetResponse> {
  encrypting.value[catKey] = true
  try {
    if (dualReady.value) {
      // ═══ 新轨：M → C_inner(SM4/DEK_S) → C_outer(SM4/DEK_A) → 上传，entry 入信封缓存 ═══
      const role = ROLE_BY_CAT[catKey]
      if (!role) throw new Error('未知文件类别，无法双层密封')
      const admin = await getAdminCertCached()
      const res = await encryptAndUploadFile(
        file, role,
        { certSn: boundCertSn(), publicKey: supplierStore.profile.sm2PublicKey },
        admin, onProgress,
      )
      dualEntries.value[res.assetId] = { role: res.role, entry: res.entry, certPublicKey: supplierStore.profile.sm2PublicKey }
      return res.upload
    }
    // ═══ 旧轨（未绑定 U盾证书）：E2EE 加密，行为不变 ═══
    // 1. 计算原文哈希
    const plaintextSha256 = await computePlaintextHash(file)
    // 2. 生成 DEK
    const { rawKey, keyHex, iv, ivHex } = await generateDEK()
    // 3. 加密
    const { encryptedBlob, dek } = await encryptFile(file, rawKey, iv)
    dek.keyHex = keyHex
    // 4. 包装并上传密文
    const encryptedFile = packageEncryptedFile(encryptedBlob, file.name)
    const res = await uploadFile(encryptedFile, 'bid_document', onProgress, true, plaintextSha256)
    // 5. 存储 DEK
    clientDeks.value[res.id] = dek
    return res
  } finally {
    encrypting.value[catKey] = false
  }
}

/** 本地缓存的绑定证书序列号（UkeyManage.vue 绑定成功后写入；仅公开信息） */
function boundCertSn(): string {
  try {
    const raw = localStorage.getItem('supplier_ukey_bound')
    return raw ? (JSON.parse(raw)?.certSn ?? '') : ''
  } catch { return '' }
}

// bidPrice 存为字符串，可能以万元或元为单位。≥10000 视为元自动换算。
function formatBidPrice(raw: string | number | null | undefined): string {
  const n = Number(raw)
  if (!raw || isNaN(n)) return '未填写'
  if (n >= 10000) return `${(n / 10000).toFixed(2)} 万元`
  return `${n} 万元`
}

// ── 完整标书上传（E2EE 加密）──
async function handleFullBidUpload(options: any) {
  const file = options.file as File
  if (file.size > maxUploadSize) { ElMessage.error(`文件不能超过${maxUploadSizeMB}MB`); options.onError(new Error('FILE_TOO_LARGE')); return }
  fullBidProgress.value = 0
  try {
    const res = await uploadEncryptedFile(file, 'full', (pct) => { fullBidProgress.value = pct })
    form.value.fullBidFileAssetId = res.id
    fullBidMeta.value = { ...res, originalName: file.name, size: file.size } as FileAssetResponse
    options.onSuccess(res)
    ElMessage.success(dualReady.value ? '文件已双层加密上传' : '文件加密上传成功')
  } catch (e: any) { ElMessage.error(e?.message || '上传失败'); options.onError(e) }
  finally { fullBidProgress.value = null }
}

// ── 拆分文件上传（E2EE 加密）──
async function handleSplitUpload(catKey: 'tech' | 'biz' | 'other', options: any) {
  const file = options.file as File
  if (file.size > maxUploadSize) { ElMessage.error(`文件不能超过${maxUploadSizeMB}MB`); options.onError(new Error('FILE_TOO_LARGE')); return }
  const cat = splitCats.value[catKey]
  cat.uploading = true; cat.progress = 0
  try {
    const res = await uploadEncryptedFile(file, `split-${catKey}`, (pct) => { cat.progress = pct })
    cat.files.push({ id: res.id, name: file.name, size: file.size })
    options.onSuccess(res)
    ElMessage.success(dualReady.value ? '文件已双层加密上传' : '文件加密上传成功')
  } catch (e: any) { ElMessage.error(e?.message || '上传失败'); options.onError(e) }
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
    if (dualReady.value) {
      // 新轨：保证金凭证同双层密封（服务端 bondRequired 时逐角色参检）
      const admin = await getAdminCertCached()
      const res = await encryptAndUploadFile(
        file, 'bond',
        { certSn: boundCertSn(), publicKey: supplierStore.profile.sm2PublicKey },
        admin, (pct) => { bondUploadProgress.value = pct },
      )
      dualEntries.value[res.assetId] = { role: res.role, entry: res.entry, certPublicKey: supplierStore.profile.sm2PublicKey }
      form.value.bidBondAssetId = res.assetId
      bondFileMeta.value = res.upload
      options.onSuccess(res.upload)
      ElMessage.success('保证金凭证已双层加密上传')
    } else {
      const res = await uploadFile(file, 'bid_document', (pct) => { bondUploadProgress.value = pct })
      form.value.bidBondAssetId = res.id
      bondFileMeta.value = res
      options.onSuccess(res)
      ElMessage.success('文件上传成功')
    }
  } catch (e: any) { ElMessage.error(e?.message || '上传失败'); options.onError(e) }
  finally { bondUploadProgress.value = null }
}

// ── 投标函文件上传（E2EE 加密）──
async function handleCoverLetterUpload(options: any) {
  const file = options.file as File
  if (file.size > maxUploadSize) { ElMessage.error(`文件不能超过${maxUploadSizeMB}MB`); options.onError(new Error('FILE_TOO_LARGE')); return }
  coverLetterProgress.value = 0
  try {
    const res = await uploadEncryptedFile(file, 'coverLetter', (pct) => { coverLetterProgress.value = pct })
    form.value.coverLetterFileAssetId = res.id
    coverLetterMeta.value = { ...res, originalName: file.name, size: file.size } as FileAssetResponse
    options.onSuccess(res)
    ElMessage.success(dualReady.value ? '投标函已双层加密上传' : '投标函文件加密上传成功')
  } catch (e: any) { ElMessage.error(e?.message || '上传失败'); options.onError(e) }
  finally { coverLetterProgress.value = null }
}

onMounted(async () => {
  try {
    await Promise.all([bidStore.fetchProject(projectId.value), supplierStore.fetchProfile()])
    if (project.value && !['DOWNLOAD', 'SUBMIT'].includes(project.value.stage)) {
      ElMessage.warning('该项目当前不在投标阶段')
      router.push(`/bids/${projectId.value}`)  // 草稿保存后的跳转保留原逻辑
      return
    }
    try {
      const sub = await supplierApi.getBidSubmission(projectId.value) as any
      if (sub) {
        existingSubmission.value = sub
        form.value = {
          bidPrice: sub.bidPrice || '',
          deliveryPeriod: sub.deliveryPeriod || '',
          qualityCommitment: sub.qualityCommitment || '',
          fullBidFileAssetId: sub.fullBidFileAssetId || '',
          coverLetter: sub.coverLetter || '',
          coverLetterFileAssetId: sub.coverLetterFileAssetId || '',
          bidBondAssetId: sub.bidBondAssetId || '',
        }
      }
    } catch (e: any) {
      // P1：草稿/已提交记录读取失败须提示，否则用户以为没填过、重填后被 ALREADY_SUBMITTED 拦截。
      ElMessage.warning('无法读取已保存的草稿/已提交记录；若您已提交过，请勿重复提交');
    }
    // 预热管理方加密证书（新轨上传/提交需要；失败在上传时按需重试并报错）
    if (dualReady.value) getAdminCertCached().catch(() => {})
    restoreDeks() // E2EE: restore DEKs from previous session
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
        form.value = { bidPrice: sub.bidPrice||'', deliveryPeriod: sub.deliveryPeriod||'', qualityCommitment: sub.qualityCommitment||'', fullBidFileAssetId: sub.fullBidFileAssetId||'', coverLetter: sub.coverLetter||'', coverLetterFileAssetId: sub.coverLetterFileAssetId||'', bidBondAssetId: sub.bidBondAssetId || '' }
      }
    } catch {}
  } catch { error.value = true }
  finally { loading.value = false }
}

const isApproved = computed(() => supplierStore.profile?.status === 'APPROVED')
const canSubmit = computed(() => {
  if (!project.value||!isApproved.value) return false
  return ['DOWNLOAD', 'SUBMIT'].includes(project.value.stage) && new Date(project.value.deadline) > new Date()
})

// ═══ 双信封 v2：按服务端声明口径收集本次提交的已声明资产 ═══
// （镜像 normalizeBidFileAssets：full→technical；split tech→technical / biz→business /
//  other→coverLetter（仅 coverLetterFileAssetId 未用时的首个）；投标函与 bond 单独参检）
function collectDeclaredAssetIds(): string[] {
  const ids: string[] = []
  if (submissionMode.value === 'full') {
    if (form.value.fullBidFileAssetId) ids.push(form.value.fullBidFileAssetId)
  } else {
    const first = (v: FileEntry[] | undefined) => v?.[0]?.id
    const t = first(splitCats.value.tech.files); if (t) ids.push(t)
    const b = first(splitCats.value.biz.files); if (b) ids.push(b)
    if (!form.value.coverLetterFileAssetId) { const o = first(splitCats.value.other.files); if (o) ids.push(o) }
  }
  if (form.value.coverLetterFileAssetId) ids.push(form.value.coverLetterFileAssetId)
  if (project.value?.bondRequired && form.value.bidBondAssetId) ids.push(form.value.bidBondAssetId)
  return ids
}

/** 已声明资产 → 信封条目（缺条目时由提交前校验拦截，防 ENVELOPE_INCOMPLETE 拒收） */
function collectDeclaredEntries(): Partial<Record<EnvelopeRole, EnvelopeFileEntry>> {
  const out: Partial<Record<EnvelopeRole, EnvelopeFileEntry>> = {}
  for (const id of collectDeclaredAssetIds()) {
    const e = dualEntries.value[id]
    if (e) out[e.role] = e.entry
  }
  return out
}

/** 组装 dual-v2 信封 + 供应商证书签名 */
async function buildDualEnvelope() {
  const uk = ukeyAdapter.value
  if (!uk || !ukeyCertSn.value) throw new Error('U盾未开锁，请先插入 U盾并输入口令')
  // fix round 1 ③：换证窗口期拦截——条目缺失或上传时所用证书公钥 ≠ 当前签名证书公钥，
  // 说明存在用旧证书加密的条目（kself 用旧公钥，服务端只验 sha256/签名会放行，T13 解密才爆），
  // 一律要求重新加密上传，不提交。
  const changed = collectDeclaredAssetIds().filter((id) => {
    const rec = dualEntries.value[id]
    return !rec || rec.certPublicKey !== ukeyCertPublicKey.value
  })
  if (changed.length > 0) {
    throw new Error('U盾证书已更换或文件密封件缺失（可能在其他浏览器上传），请重新加密上传投标文件后再提交')
  }
  const admin = await getAdminCertCached()
  return buildEnvelope({
    entries: collectDeclaredEntries(),
    fields: {
      price: form.value.bidPrice,
      deliveryPeriod: form.value.deliveryPeriod,
      qualityCommitment: form.value.qualityCommitment || '',
    },
    ukey: uk,
    certSn: ukeyCertSn.value,
    certPublicKey: ukeyCertPublicKey.value,
    adminCertId: admin.adminCertId,
  })
}

// ═══ U盾会话（提交时开锁，仅内存持有；口令不持久化）═══
async function handleUkeyOpen() {
  if (!ukeyPassword.value) { ElMessage.warning('请输入 U盾口令'); return }
  ukeyOpening.value = true
  try {
    const uk = await MockUKeyAdapter.open({ storage: ukeyStorage, password: ukeyPassword.value })
    const certs = await uk.listCertificates()
    // 选中平台已绑定证书：优先本地缓存的 certSn（UkeyManage 绑定后写入），兜底按公钥匹配 profile.sm2PublicKey
    const profilePub = supplierStore.profile?.sm2PublicKey
    const cert = certs.find((c) => c.certSn === boundCertSn()) || certs.find((c) => c.publicKey === profilePub)
    if (!cert) throw new Error('介质内未找到与平台绑定的证书，请先到「U盾管理」页绑定')
    ukeyAdapter.value = uk
    ukeyCertSn.value = cert.certSn
    ukeyCertPublicKey.value = cert.publicKey
    ukeyPassword.value = ''
    ukeyDialogVisible.value = false
    ElMessage.success(`U盾已开锁（${cert.certSn}）`)
    if (pendingSubmit.value) { pendingSubmit.value = false; await doSubmit() }
  } catch (e: any) {
    ElMessage.error(e?.message || 'U盾开锁失败')
  } finally { ukeyOpening.value = false }
}

// 构建 clientDeks 映射（根据当前表单中的 assetId 查找 DEK）
function buildClientDeksPayload(): Record<string, string> {
  const result: Record<string, string> = {}
  const assetIds: string[] = []
  if (submissionMode.value === 'full') {
    if (form.value.fullBidFileAssetId) assetIds.push(form.value.fullBidFileAssetId)
  } else {
    for (const cat of (['tech', 'biz', 'other'] as const)) {
      for (const f of splitCats.value[cat].files) { assetIds.push(f.id) }
    }
  }
  if (form.value.coverLetterFileAssetId) assetIds.push(form.value.coverLetterFileAssetId)
  for (const id of assetIds) {
    const dek = clientDeks.value[id]
    if (dek) result[id] = formatDEK(dek.keyHex, dek.ivHex, dek.authTagHex)
  }
  return result
}

async function saveDraft() {
  saving.value = true
  try {
    const payload: any = { ...form.value, clientDeks: buildClientDeksPayload() }
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
    { label:'U盾证书', detail:dualReady.value?(ukeyAdapter.value?`已开锁（${ukeyCertSn.value}）`:'已绑定，提交时校验口令'):'未绑定（传统加密投递）', ok:true, required:false },
    { label:'投标报价', detail:dualReady.value?'密封进双层信封（开标时揭示）':formatBidPrice(form.value.bidPrice), ok:!!form.value.bidPrice, required:true },
    { label:'交货工期', detail:form.value.deliveryPeriod||'未填写', ok:!!form.value.deliveryPeriod, required:true },
    { label:'质量承诺', detail:form.value.qualityCommitment||'未填写', ok: !!form.value.qualityCommitment, required:false },
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
  submitDialogVisible.value = false
  // 新轨：需 U盾签名——未开锁先弹口令对话框，开锁成功后继续提交
  if (dualReady.value && !ukeyAdapter.value) {
    pendingSubmit.value = true
    ukeyDialogVisible.value = true
    return
  }
  await doSubmit()
}

async function doSubmit() {
  submitting.value = true
  try {
    const payload: any = { ...form.value }
    if (!dualReady.value) payload.hostDecryptAuthorized = hostDecryptConsent.value // P1-1：旧轨授权记录随提交落库
    if (submissionMode.value === 'split') {
      payload.splitFiles = {
        tech: splitCats.value.tech.files,
        biz: splitCats.value.biz.files,
        other: splitCats.value.other.files,
      }
    }
    if (dualReady.value) {
      // 新轨：报价只经 sealedFields 密封上送——顶层 payload 剔除明文 bidPrice（fix round 1 ①）
      delete payload.bidPrice
      const { envelope, signature } = await buildDualEnvelope()
      payload.envelope = envelope
      payload.signature = signature
    } else {
      // 旧轨：E2EE DEK 上传（envelope 不传即旧行为）
      payload.clientDeks = buildClientDeksPayload()
    }
    await supplierApi.submitBid(projectId.value, payload)
    draft.clearDraft(); clearDeks()
    // fix round 1 ⑥：U盾保管提示仅在双层加密轨展示
    ElMessage.success(dualReady.value
      ? '标书提交成功！请妥善保管 U盾介质导出文件，开标解密与唱标核对需要。'
      : '标书提交成功！')
    router.push('/my-bids')
  } catch (err: any) {
    const code = err?.response?.data?.code
    if (dualReady.value && code === 'ADMIN_CERT_CHANGED') {
      // fix round 1 ⑤：管理方证书轮换——页面级缓存失效并重拉；
      // 已上传条目的 kadmin 仍加密于旧管理方公钥，必须整体重传（不能自动重试同批次）
      adminCert.value = null
      try { await getAdminCertCached() } catch {}
      ElMessage.error('管理方加密证书已轮换，请重新加密上传全部投标文件后再提交')
    } else {
      ElMessage.error(err?.response?.data?.error || err?.message || '提交失败')
    }
  } finally { submitting.value = false }
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <button type="button" class="neu-link back-link" @click="backToDetail()"><el-icon><ArrowLeft /></el-icon>返回项目详情</button>
    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <template v-else-if="project">
      <el-alert v-if="!canSubmit" type="error" :closable="false" show-icon style="margin-bottom:20px"><template #title>{{ !isApproved?'供应商账号尚未通过审核，无法投标':'该项目当前不可投标' }}</template></el-alert>
      <el-alert v-if="canSubmit" type="warning" :closable="false" show-icon style="margin-bottom:20px"><template #title>投标截止：{{ project.deadline ? dayjs(project.deadline).format('YYYY年MM月DD日 HH:mm') : '--' }}，请在截止前完成提交。</template></el-alert>
      <el-alert v-if="canSubmit && dualReady" type="success" :closable="false" show-icon style="margin-bottom:20px"><template #title>双层加密信封投递：文件将双层加密上传，报价等唱标字段密封至开标时揭示。提交时需插入 U盾并输入口令完成签名。</template></el-alert>
      <el-alert v-if="canSubmit && !dualReady" type="info" :closable="false" show-icon style="margin-bottom:20px"><template #title>未绑定 U盾证书，当前按传统加密方式投递。建议先到「U盾管理」页绑定证书，启用双层信封密封。</template><template #default><el-button size="small" @click="router.push('/profile/ukey')">前往 U盾管理</el-button></template></el-alert>
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
          <el-form-item label="质量承诺">
            <el-input v-model="form.qualityCommitment" placeholder="选填，如：满足招标文件要求，一次验收合格" />
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
          <span v-if="draft.lastSavedAt && dayjs(draft.lastSavedAt).isValid()" class="auto-save-hint">已自动保存 {{ dayjs(draft.lastSavedAt).format('HH:mm') }}</span>
          <el-button size="large" :loading="saving" @click="saveDraft"><el-icon><FolderAdd /></el-icon>保存草稿</el-button>
          <el-button type="primary" size="large" :loading="submitting" @click="openSubmitDialog" title="标书文件由系统加密存储，开标时由主持人解密"><el-icon><CircleCheck /></el-icon>{{ submitting?'提交中...':'正式提交标书' }}</el-button>
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
      <div v-if="!dualReady" class="host-decrypt-consent" style="margin-top:14px">
        <el-checkbox v-model="hostDecryptConsent">本人同意平台在开标环节按招标文件规定方式<b>代为解密</b>本投标文件（电子招标投标办法第30条）</el-checkbox>
      </div>
      <template #footer>
        <el-button @click="submitDialogVisible=false">取消</el-button>
        <el-button type="primary" :disabled="!canConfirm || (!dualReady && !hostDecryptConsent)" @click="confirmSubmit">确认提交</el-button>
      </template>
    </el-dialog>

    <!-- ═══ U盾口令（新轨提交签名）═══ -->
    <el-dialog v-model="ukeyDialogVisible" title="U盾签名" width="440px" :close-on-click-modal="false" destroy-on-close @closed="ukeyPassword = ''">
      <p class="ukey-desc">双层信封投递需用已绑定的 U盾证书对信封签名。请输入 U盾口令完成介质开锁。</p>
      <el-input v-model="ukeyPassword" type="password" show-password placeholder="U盾口令" size="large" @keyup.enter="handleUkeyOpen" />
      <p class="ukey-hint">证书未绑定或介质遗失？前往 <router-link to="/profile/ukey">U盾管理</router-link> 绑定或导入备份介质。</p>
      <template #footer>
        <el-button @click="ukeyDialogVisible=false; pendingSubmit=false">取消</el-button>
        <el-button type="primary" :loading="ukeyOpening" @click="handleUkeyOpen">开锁并继续提交</el-button>
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
/* ─── U盾对话框 ─── */
.ukey-desc { margin: 0 0 12px; font-size: 13px; color: var(--muted-foreground); line-height: 1.6; }
.ukey-hint { margin: 10px 0 0; font-size: 12px; color: var(--muted-foreground); }
.ukey-hint a { color: var(--brand); font-weight: 700; text-decoration: none; }
.preflight-icon.orange { background: color-mix(in oklab, var(--warning) 12%, transparent); color: var(--warning); }
.preflight-icon.red { background: color-mix(in oklab, var(--danger) 12%, transparent); color: var(--danger); }
.preflight-text { display: flex; flex-direction: column; gap: 2px; }
.preflight-label { font-size: 14px; font-weight: 700; color: var(--foreground); }
.preflight-detail { font-size: 12px; color: var(--muted-foreground); }
</style>
