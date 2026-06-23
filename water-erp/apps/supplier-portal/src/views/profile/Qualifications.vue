<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { uploadFile, type FileAssetResponse } from '@/api/upload'
import { createDialogLeaveGuard } from '@/composables'

const supplierStore = useSupplierStore()
const loading = ref(true)
const error = ref(false)
const dialogVisible = ref(false)
const dialogLoading = ref(false)
const uploading = ref(false)
const qualUploadProgress = ref<number | null>(null)
const uploadedMeta = ref<FileAssetResponse | null>(null)
const form = ref({ type: '', name: '', fileUrl: '', validFrom: '', validTo: '' })
const formDirty = ref(false)
const dialogGuard = createDialogLeaveGuard(formDirty)
function markDirty() { formDirty.value = true }
async function closePanel() {
  await dialogGuard(() => { dialogVisible.value = false; formDirty.value = false })
}

onMounted(async () => {
  try { await supplierStore.fetchQualifications() } catch { error.value = true } finally { loading.value = false }
})

async function retryLoad() {
  error.value = false; loading.value = true
  try { await supplierStore.fetchQualifications() } catch { error.value = true } finally { loading.value = false }
}

const qualTypes = [
  '营业执照', '资质证书', '安全生产许可证',
  '质量管理体系认证', '环境管理体系认证', '职业健康安全管理体系认证', '其他',
]

// ── Type → colour mapping ──
type TypeMeta = { color: string; bg: string; icon: string }
const typeMetaMap: Record<string, TypeMeta> = {
  '营业执照':                     { color: '#064ea2', bg: '#eff6ff', icon: 'Stamp' },
  '资质证书':                     { color: '#7c3aed', bg: '#f5f3ff', icon: 'Medal' },
  '安全生产许可证':               { color: '#d97706', bg: '#fffbeb', icon: 'Lock' },
  '质量管理体系认证':             { color: '#059669', bg: '#ecfdf5', icon: 'CircleCheck' },
  '环境管理体系认证':             { color: '#06a8c9', bg: '#ecfeff', icon: 'Sunny' },
  '职业健康安全管理体系认证':     { color: '#0891b2', bg: '#ecfeff', icon: 'User' },
}
function typeMeta(type: string): TypeMeta {
  return typeMetaMap[type] || { color: 'var(--sp-gray-500)', bg: 'var(--sp-gray-100)', icon: 'More' }
}

// ── Upload ──
function openAdd() {
  form.value = { type: '', name: '', fileUrl: '', validFrom: '', validTo: '' }
  uploadedMeta.value = null
  formDirty.value = false
  dialogVisible.value = true
}

async function customUpload(options: any) {
  const file = options.file as File
  if (file.size > 50 * 1024 * 1024) {
    ElMessage.error('文件不能超过50MB')
    options.onError(new Error('FILE_TOO_LARGE'))
    return
  }
  uploading.value = true
  qualUploadProgress.value = 0
  try {
    const res = await uploadFile(file, 'qualification', (pct) => { qualUploadProgress.value = pct })
    form.value.fileUrl = res.url
    uploadedMeta.value = res
    options.onSuccess(res)
    ElMessage.success('文件上传成功')
    formDirty.value = true
  } catch (e: any) {
    options.onError(e)
  } finally {
    uploading.value = false
    qualUploadProgress.value = null
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function handleAdd() {
  if (!form.value.type || !form.value.name) { ElMessage.warning('请填写资质类型和名称'); return }
  if (!uploadedMeta.value || !form.value.fileUrl) { ElMessage.warning('请先上传资质文件'); return }
  dialogLoading.value = true
  try {
    await supplierStore.addQualification(form.value)
    ElMessage.success('资质材料添加成功')
    dialogVisible.value = false
    formDirty.value = false
  } catch { ElMessage.error('添加失败') } finally { dialogLoading.value = false }
}

async function handleDelete(id: string) {
  await ElMessageBox.confirm('确定要删除此资质材料吗？', '提示', { type: 'warning' })
  try { await supplierStore.deleteQualification(id); ElMessage.success('已删除') } catch { ElMessage.error('删除失败') }
}

// ── Status ──
function getStatusInfo(q: any) {
  if (!q.validTo) return { label: '长期有效', cls: 'approved' }
  const diff = (new Date(q.validTo).getTime() - Date.now()) / 86400000
  if (diff < 0) return { label: '已过期', cls: 'rejected' }
  if (diff < 30) return { label: '即将过期', cls: 'pending' }
  return { label: '有效', cls: 'approved' }
}

// ── Expiry ──
function expiryPercent(q: any): number {
  if (!q.validFrom || !q.validTo) return 100
  const total = new Date(q.validTo).getTime() - new Date(q.validFrom).getTime()
  const remaining = new Date(q.validTo).getTime() - Date.now()
  return Math.max(0, Math.min(100, Math.round((remaining / total) * 100)))
}

function expiryColorClass(pct: number): string {
  if (pct <= 10) return 'expiry-critical'
  if (pct <= 30) return 'expiry-warning'
  return 'expiry-good'
}

function formatDate(d: string): string {
  return dayjs(d).format('YYYY-MM-DD')
}

// ── File ──
function viewFile(url: string) {
  if (!url) return
  window.open(url, '_blank', 'noopener')
}

function extractFileName(url: string): string {
  if (!url) return ''
  // Legacy paths like /uploads/xxx.pdf
  const legacy = url.match(/\/([^/]+\.\w{2,5})$/i)
  if (legacy) return legacy[1]
  // API paths like /api/upload/files/<id> — show generic
  if (url.includes('/api/upload/files/')) return '附件文件'
  return '附件文件'
}

// ── Health dashboard (Wave 4) ──
const healthSummary = computed(() => {
  const quals = supplierStore.qualifications
  const now = Date.now()
  let valid = 0, expiring = 0, expired = 0, longTerm = 0
  quals.forEach((q: any) => {
    if (!q.validTo) { longTerm++; return }
    const diff = (new Date(q.validTo).getTime() - now) / 86400000
    if (diff < 0) expired++
    else if (diff < 30) expiring++
    else valid++
  })
  const total = quals.length
  const healthScore = total > 0 ? Math.round(((valid + longTerm) / total) * 100) : 0
  return { total, valid, expiring, expired, longTerm, healthScore }
})

const healthTone = computed(() => {
  const s = healthSummary.value
  if (s.expired > 0) return { color: '#dc2626', bg: '#fef2f2', label: '有证照过期，请尽快更新', icon: 'WarningFilled' }
  if (s.expiring > 0) return { color: '#d97706', bg: '#fffbeb', label: '有证照即将过期，建议提前续期', icon: 'Clock' }
  return { color: '#059669', bg: '#ecfdf5', label: '所有证照状态良好', icon: 'CircleCheckFilled' }
})

const healthRingDash = computed(() => {
  const pct = healthSummary.value.healthScore
  const c = 2 * Math.PI * 34
  const d = c * pct / 100
  return `${d} ${c - d}`
})

const nextExpiring = computed(() => {
  const quals = supplierStore.qualifications.filter((q: any) => q.validTo)
  if (!quals.length) return null
  const soonest = quals.reduce((a: any, b: any) =>
    new Date(a.validTo).getTime() < new Date(b.validTo).getTime() ? a : b
  )
  const diff = (new Date(soonest.validTo).getTime() - Date.now()) / 86400000
  if (diff > 60) return null // only show if within 60 days
  return { name: soonest.name, days: Math.ceil(diff), expired: diff < 0 }
})
</script>

<template>
  <div class="page-container" v-loading="loading">
    <!-- ═══ Hero ═══ -->
    <div class="sp-page-hero-card">
      <div class="sp-page-hero-inner">
        <div class="sp-page-hero-body">
          <h1 class="sp-modern-title">资质管理</h1>
          <p class="sp-modern-desc">管理企业资质材料，确保证照在有效期内。过期材料将影响投标资格。</p>
        </div>
        <div class="sp-page-hero-actions">
          <el-button type="primary" @click="openAdd">
            <el-icon><Plus /></el-icon>添加资质
          </el-button>
        </div>
      </div>
    </div>

    <!-- ═══ Error State ═══ -->
    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>

    <template v-else>
      <!-- ═══ Health Dashboard ═══ -->
      <div v-if="healthSummary.total > 0" class="qual-health-dashboard">
        <div class="qual-health-ring">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="var(--sp-gray-100)" stroke-width="6" />
            <circle cx="40" cy="40" r="34" fill="none" :stroke="healthTone.color" stroke-width="6"
              stroke-linecap="round" :stroke-dasharray="healthRingDash" transform="rotate(-90 40 40)"
              class="qual-health-ring-arc" />
          </svg>
          <span class="qual-health-score">{{ healthSummary.healthScore }}%</span>
        </div>

        <div class="qual-health-body">
          <div class="qual-health-chips">
            <span class="qual-health-chip valid">
              <span class="chip-dot"></span>{{ healthSummary.valid }} 有效
            </span>
            <span class="qual-health-chip long-term">
              <span class="chip-dot"></span>{{ healthSummary.longTerm }} 长期
            </span>
            <span class="qual-health-chip expiring">
              <span class="chip-dot"></span>{{ healthSummary.expiring }} 即将过期
            </span>
            <span class="qual-health-chip expired">
              <span class="chip-dot"></span>{{ healthSummary.expired }} 已过期
            </span>
          </div>

          <div class="qual-health-message" :style="{ color: healthTone.color }">
            <el-icon>
              <WarningFilled v-if="healthTone.icon === 'WarningFilled'" />
              <Clock v-else-if="healthTone.icon === 'Clock'" />
              <CircleCheckFilled v-else />
            </el-icon>
            <span>{{ healthTone.label }}</span>
          </div>

          <div v-if="nextExpiring" class="qual-health-next">
            <template v-if="nextExpiring.expired">
              <span class="next-label">已过期</span>
              <span class="next-name">{{ nextExpiring.name }}</span>
            </template>
            <template v-else>
              <span class="next-label">最近到期</span>
              <span class="next-name">{{ nextExpiring.name }}</span>
              <span class="next-days">（{{ nextExpiring.days }} 天后）</span>
            </template>
          </div>
        </div>
      </div>

      <!-- ═══ Qualification Cards ═══ -->
      <el-row v-if="supplierStore.qualifications.length > 0" :gutter="16">
        <el-col :xs="24" :sm="12" :lg="8" v-for="q in supplierStore.qualifications" :key="q.id">
          <article class="qual-card">
            <!-- Top accent strip -->
            <div class="qual-card-accent" :style="{ background: typeMeta(q.type).color }"></div>

            <!-- Header row: icon + type + status + delete -->
            <div class="qual-card-head">
              <div class="qual-card-head-left">
                <span class="qual-type-dot" :style="{ background: typeMeta(q.type).color }">
                  <el-icon :size="12"><component :is="typeMeta(q.type).icon" /></el-icon>
                </span>
                <span class="qual-type-label" :style="{ color: typeMeta(q.type).color }">{{ q.type }}</span>
              </div>
              <div class="qual-card-head-right">
                <span class="qual-status-badge" :class="getStatusInfo(q).cls">{{ getStatusInfo(q).label }}</span>
                <el-button class="qual-delete-btn" text size="small" @click="handleDelete(q.id)" title="删除">
                  <el-icon :size="14"><Delete /></el-icon>
                </el-button>
              </div>
            </div>

            <!-- Name -->
            <h3 class="qual-name">{{ q.name }}</h3>

            <!-- Date timeline bar -->
            <div class="qual-timeline" v-if="q.validFrom">
              <div class="qual-timeline-bar">
                <div
                  class="qual-timeline-fill"
                  :class="expiryColorClass(expiryPercent(q))"
                  :style="{ width: q.validTo ? expiryPercent(q) + '%' : '100%' }">
                </div>
              </div>
              <div class="qual-timeline-labels">
                <span class="qual-timeline-date">{{ formatDate(q.validFrom) }}</span>
                <span class="qual-timeline-date" v-if="q.validTo">{{ formatDate(q.validTo) }}</span>
                <span class="qual-timeline-date qual-timeline-date--inf" v-else>长期</span>
              </div>
            </div>
            <div class="qual-timeline qual-timeline--longterm" v-else>
              <span class="qual-timeline-label">长期有效</span>
            </div>

            <!-- File row — clean inline, no box -->
            <div class="qual-file-row" v-if="q.fileUrl" @click="viewFile(q.fileUrl)">
              <span class="qual-file-icon">
                <el-icon :size="16"><Document /></el-icon>
              </span>
              <span class="qual-file-name">{{ extractFileName(q.fileUrl) }}</span>
              <span class="qual-file-cta">查看</span>
            </div>
            <div class="qual-file-row qual-file-row--empty" v-else>
              <span class="qual-file-icon qual-file-icon--muted">
                <el-icon :size="14"><Document /></el-icon>
              </span>
              <span class="qual-file-name qual-file-name--muted">暂未上传附件</span>
            </div>
          </article>
        </el-col>
      </el-row>

      <!-- ═══ Empty State ═══ -->
      <div v-else class="qual-empty">
        <div class="qual-empty-icon">
          <el-icon :size="28"><Folder /></el-icon>
        </div>
        <p class="qual-empty-title">暂无资质材料</p>
        <p class="qual-empty-desc">点击上方「添加资质」按钮，上传您的企业资质证照</p>
      </div>
    </template>

    <!-- ═══ Add Panel (Teleport — same approach as ChangeRequest) ═══ -->
    <Teleport to="body">
      <Transition name="add-panel">
        <div v-if="dialogVisible" class="add-overlay" @click.self="closePanel">
          <div class="add-panel">
            <!-- Header -->
            <div class="add-panel-head">
              <div class="add-panel-head-left">
                <div class="add-panel-head-icon"><el-icon :size="20"><Medal /></el-icon></div>
                <div>
                  <h2 class="add-panel-title">添加资质材料</h2>
                  <p class="add-panel-sub">上传证照文件并填写有效期信息</p>
                </div>
              </div>
              <button class="add-panel-close" @click="closePanel"><el-icon :size="18"><Close /></el-icon></button>
            </div>

            <!-- Body -->
            <div class="add-panel-body">
              <!-- ═══ Section: 基本信息 ═══ -->
              <div class="add-panel-sec">
                <div class="add-panel-sec-label"><span class="add-panel-sec-dot"></span>基本信息</div>
                <div class="add-panel-row">
                  <div class="add-panel-field">
                    <label class="add-panel-label">资质类型 <i>*</i></label>
                    <select class="add-panel-select" v-model="form.type" @change="markDirty">
                      <option value="" disabled>请选择资质类型</option>
                      <option v-for="t in qualTypes" :key="t" :value="t">{{ t }}</option>
                    </select>
                    <span class="add-panel-select-arrow"><el-icon :size="12"><ArrowDown /></el-icon></span>
                  </div>
                  <div class="add-panel-field">
                    <label class="add-panel-label">资质名称 <i>*</i></label>
                    <div class="add-panel-input-wrap">
                      <input class="add-panel-input" v-model="form.name" placeholder="如：企业法人营业执照" maxlength="50" @input="markDirty" />
                      <span v-if="form.name" class="add-panel-count">{{ form.name.length }}/50</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- ═══ Section: 有效期 ═══ -->
              <div class="add-panel-sec">
                <div class="add-panel-sec-label"><span class="add-panel-sec-dot"></span>有效期</div>
                <div class="add-panel-row">
                  <div class="add-panel-field">
                    <label class="add-panel-label add-panel-label--opt">有效期起</label>
                    <input class="add-panel-input" type="date" v-model="form.validFrom" @change="markDirty" />
                  </div>
                  <div class="add-panel-field">
                    <label class="add-panel-label add-panel-label--opt">有效期止</label>
                    <input class="add-panel-input" type="date" v-model="form.validTo" placeholder="不填为长期有效" @change="markDirty" />
                  </div>
                </div>
              </div>

              <!-- ═══ Section: 资质文件 ═══ -->
              <div class="add-panel-sec">
                <div class="add-panel-sec-label"><span class="add-panel-sec-dot"></span>资质文件 <i>*</i></div>
                <div class="add-panel-upload" :class="{ 'is-done': uploadedMeta, 'is-uploading': uploading }">
                  <template v-if="!uploadedMeta">
                    <div class="add-panel-upload-drop" @click.stop>
                      <span class="add-panel-upload-drop-icon"><el-icon :size="28"><UploadFilled /></el-icon></span>
                      <p class="add-panel-upload-drop-text">拖拽文件到此处，或点击下方按钮</p>
                      <p class="add-panel-upload-drop-hint">支持 PDF、图片、Office、ZIP 格式，不超过 50 MB</p>
                      <el-upload
                        :show-file-list="false"
                        :http-request="customUpload"
                        accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.zip,.txt"
                      >
                        <button type="button" class="add-panel-upload-btn" :disabled="uploading">
                          <el-icon :size="14"><UploadFilled /></el-icon>
                          <span>{{ uploading ? '上传中…' : '选择文件' }}</span>
                        </button>
                      </el-upload>
                    </div>
                  </template>
                  <template v-else>
                    <div class="add-panel-upload-file">
                      <span class="add-panel-upload-file-icon"><el-icon :size="18"><Document /></el-icon></span>
                      <div class="add-panel-upload-file-info">
                        <span class="add-panel-upload-file-name">{{ uploadedMeta.originalName }}</span>
                        <span class="add-panel-upload-file-meta">{{ formatSize(uploadedMeta.size) }}</span>
                      </div>
                      <el-upload
                        :show-file-list="false"
                        :http-request="customUpload"
                        accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.zip,.txt"
                      >
                        <button type="button" class="add-panel-upload-replace">替换文件</button>
                      </el-upload>
                    </div>
                  </template>
                  <Transition name="add-fade">
                    <div v-if="qualUploadProgress !== null" class="add-panel-upload-progress">
                      <div class="add-panel-upload-progress-bar" :style="{ width: qualUploadProgress + '%' }"></div>
                    </div>
                  </Transition>
                </div>
              </div>
            </div>

            <!-- Footer -->
            <div class="add-panel-foot">
              <span class="add-panel-hint" v-if="!uploadedMeta">请上传资质文件</span>
              <span class="add-panel-hint ready" v-else>已准备好提交</span>
              <div class="add-panel-foot-actions">
                <button class="add-panel-btn-cancel" @click="closePanel">取消</button>
                <button
                  class="add-panel-btn-submit"
                  :class="{ ready: uploadedMeta && !dialogLoading }"
                  :disabled="!uploadedMeta || dialogLoading"
                  @click="handleAdd"
                >
                  <span v-if="dialogLoading">提交中…</span>
                  <template v-else>
                    <el-icon :size="15"><ArrowRight /></el-icon>
                    <span>确认添加</span>
                  </template>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ═══ Card ═══ */
.qual-card {
  --accent: var(--sp-gray-400);
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0 0 16px 0;
  margin-bottom: 16px;
  background: rgba(255, 255, 255, 0.58);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: var(--sp-radius-md);
  overflow: hidden;
  transition: transform var(--sp-duration-fast) var(--sp-ease),
    box-shadow var(--sp-duration-fast) var(--sp-ease),
    border-color var(--sp-duration-fast) var(--sp-ease);
}

.qual-card::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.42;
  border-radius: inherit;
  background-image:
    radial-gradient(ellipse at 12% 6%, rgba(96, 165, 250, 0.14), transparent 50%),
    radial-gradient(ellipse at 80% 8%, rgba(147, 197, 253, 0.10), transparent 50%),
    radial-gradient(ellipse at 40% 92%, rgba(168, 139, 250, 0.08), transparent 50%);
  animation: glass-glow-drift 18s ease-in-out infinite;
}

.qual-card > * { position: relative; z-index: 1; }

.qual-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.06);
  border-color: rgba(0, 0, 0, 0.10);
}

/* ── Top accent strip ── */
.qual-card-accent {
  height: 3px;
  flex-shrink: 0;
  border-radius: 2px 2px 0 0;
}

/* ── Header row ── */
.qual-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 18px 0 18px;
}

.qual-card-head-left {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.qual-type-dot {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
  font-size: 12px;
}

.qual-type-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.qual-card-head-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* ── Status badge ── */
.qual-status-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: var(--sp-radius-full);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.qual-status-badge.approved { background: rgba(236,253,245,0.70); color: #059669; }
.qual-status-badge.pending  { background: rgba(255,251,235,0.70); color: #d97706; }
.qual-status-badge.rejected { background: rgba(254,242,242,0.70); color: #dc2626; }

/* ── Delete ── */
.qual-delete-btn {
  color: var(--sp-gray-300);
  padding: 2px;
  opacity: 0;
  transition: opacity var(--sp-duration-fast) var(--sp-ease), color var(--sp-duration-fast) var(--sp-ease);
}
.qual-card:hover .qual-delete-btn { opacity: 1; }
.qual-delete-btn:hover { color: var(--sp-red) !important; }

/* ── Name ── */
.qual-name {
  margin: 10px 18px 12px 18px;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.45;
  color: var(--sp-gray-900);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ═══ Date Timeline ═══ */
.qual-timeline {
  padding: 0 18px;
  margin-bottom: 12px;
}

.qual-timeline-bar {
  height: 4px;
  background: var(--sp-gray-100);
  border-radius: 2px;
  overflow: hidden;
}

.qual-timeline-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.8s cubic-bezier(0.22, 0.61, 0.36, 1);
  min-width: 4px;
}

.qual-timeline-fill.expiry-good    { background: linear-gradient(90deg, #34d399, #10b981); }
.qual-timeline-fill.expiry-warning { background: linear-gradient(90deg, #fbbf24, #f59e0b); }
.qual-timeline-fill.expiry-critical{ background: linear-gradient(90deg, #fb7185, #ef4444); }

.qual-timeline-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
}

.qual-timeline-date {
  font-size: 10.5px;
  font-weight: 600;
  font-family: monospace;
  color: var(--sp-gray-400);
  font-variant-numeric: tabular-nums;
}

.qual-timeline-date--inf {
  color: var(--sp-gray-300);
  font-style: italic;
}

.qual-timeline--longterm {
  font-size: 11px;
  font-weight: 600;
  color: var(--sp-gray-400);
}

.qual-timeline-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--sp-gray-400);
}

/* ═══ File row ═══ */
.qual-file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 14px;
  padding: 8px 12px;
  border-radius: var(--sp-radius-sm);
  cursor: pointer;
  transition: background var(--sp-duration-fast) var(--sp-ease);
}
.qual-file-row:hover {
  background: rgba(239, 246, 255, 0.55);
}

.qual-file-row--empty {
  cursor: default;
}
.qual-file-row--empty:hover {
  background: transparent;
}

.qual-file-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(239, 246, 255, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sp-primary);
  flex-shrink: 0;
}

.qual-file-icon--muted {
  background: transparent;
  color: var(--sp-gray-300);
}

.qual-file-name {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--sp-gray-600);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.qual-file-name--muted {
  color: var(--sp-gray-400);
  font-weight: 400;
}

.qual-file-cta {
  font-size: 11px;
  font-weight: 700;
  color: var(--sp-primary);
  flex-shrink: 0;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity var(--sp-duration-fast) var(--sp-ease),
    transform var(--sp-duration-fast) var(--sp-ease);
}

.qual-file-row:hover .qual-file-cta {
  opacity: 1;
  transform: translateX(0);
}

/* ═══ Health Dashboard ═══ */
.qual-health-dashboard {
  position: relative;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 18px 22px;
  margin-bottom: 20px;
  background: radial-gradient(ellipse at 50% 0%, rgba(147, 197, 253, 0.10), transparent 60%),
    radial-gradient(ellipse at 50% 100%, rgba(168, 139, 250, 0.06), transparent 60%),
    rgba(255, 255, 255, 0.58);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: var(--sp-radius-md);
}

.qual-health-dashboard::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.42;
  border-radius: inherit;
  background-image:
    radial-gradient(ellipse at 14% 6%, rgba(96, 165, 250, 0.14), transparent 55%),
    radial-gradient(ellipse at 80% 10%, rgba(56, 189, 248, 0.10), transparent 55%),
    radial-gradient(ellipse at 36% 90%, rgba(52, 211, 153, 0.08), transparent 55%);
  animation: glass-glow-drift 18s ease-in-out infinite;
}

.qual-health-dashboard > * { position: relative; z-index: 1; }

.qual-health-ring {
  position: relative;
  width: 80px;
  height: 80px;
  flex-shrink: 0;
}

.qual-health-ring-arc {
  transition: stroke-dasharray 0.8s var(--sp-ease);
}

.qual-health-score {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 900;
  color: var(--sp-gray-900);
}

.qual-health-body {
  flex: 1;
  min-width: 0;
}

.qual-health-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.qual-health-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: var(--sp-radius-full);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.qual-health-chip .chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.qual-health-chip.valid     { background: rgba(236, 253, 245, 0.70); color: #059669; }
.qual-health-chip.valid .chip-dot     { background: #059669; }
.qual-health-chip.long-term { background: rgba(239, 246, 255, 0.70); color: #064ea2; }
.qual-health-chip.long-term .chip-dot { background: #064ea2; }
.qual-health-chip.expiring  { background: rgba(255, 251, 235, 0.70); color: #d97706; }
.qual-health-chip.expiring .chip-dot  { background: #d97706; }
.qual-health-chip.expired   { background: rgba(254, 242, 242, 0.70); color: #dc2626; }
.qual-health-chip.expired .chip-dot   { background: #dc2626; }

.qual-health-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.qual-health-next {
  font-size: 12px;
  color: var(--sp-gray-500);
}

.qual-health-next .next-label {
  font-weight: 600;
  margin-right: 4px;
}

.qual-health-next .next-name {
  color: var(--sp-gray-700);
}

.qual-health-next .next-days {
  color: var(--sp-orange);
  font-weight: 600;
}

/* ═══ Empty State ═══ */
.qual-empty {
  position: relative;
  text-align: center;
  padding: 64px 24px;
  background: rgba(255, 255, 255, 0.52);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: var(--sp-radius-md);
}

.qual-empty::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.44;
  border-radius: inherit;
  background-image:
    radial-gradient(ellipse at 10% 6%, rgba(96, 165, 250, 0.24), transparent 55%),
    radial-gradient(ellipse at 85% 12%, rgba(56, 189, 248, 0.16), transparent 55%),
    radial-gradient(ellipse at 38% 90%, rgba(52, 211, 153, 0.10), transparent 55%);
  animation: glass-glow-drift 18s ease-in-out infinite;
}

.qual-empty > * { position: relative; z-index: 1; }

.qual-empty-icon  { color: var(--sp-gray-300); margin-bottom: 8px; }
.qual-empty-title { font-size: 15px; font-weight: 700; color: var(--sp-gray-500); margin: 12px 0 4px; }
.qual-empty-desc  { font-size: 13px; color: var(--sp-gray-400); margin: 0; }

/* ═══ Panel (Teleport — matches ChangeRequest style) ═══ */
.add-overlay {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: center; justify-content: center; padding: 32px;
  background: rgba(15, 35, 65, 0.10);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.add-panel {
  position: relative; width: 540px; max-width: 100%; max-height: calc(100vh - 64px);
  display: flex; flex-direction: column; overflow: hidden;
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(28px) saturate(1.25);
  -webkit-backdrop-filter: blur(28px) saturate(1.25);
  border: 1px solid rgba(255, 255, 255, 0.50);
  border-radius: var(--sp-radius-xl);
  box-shadow: 0 4px 8px rgba(15, 35, 65, 0.04), 0 20px 60px rgba(91, 155, 213, 0.14);
}

.add-panel::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
  opacity: 0.48; border-radius: inherit;
  background-image:
    radial-gradient(ellipse at 15% 8%, rgba(147, 197, 253, 0.28), transparent 55%),
    radial-gradient(ellipse at 85% 14%, rgba(168, 139, 250, 0.16), transparent 55%),
    radial-gradient(ellipse at 40% 88%, rgba(110, 231, 183, 0.10), transparent 55%);
  animation: glass-glow-drift 20s ease-in-out infinite;
}

/* ── Header ── */
.add-panel-head {
  position: relative; z-index: 2;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 22px 26px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
}

.add-panel-head-left {
  display: flex; align-items: center; gap: 14px; min-width: 0;
}

.add-panel-head-icon {
  width: 44px; height: 44px;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, rgba(6, 78, 162, 0.14), rgba(56, 189, 248, 0.10));
  color: var(--sp-primary);
  flex-shrink: 0;
}

.add-panel-title {
  margin: 0; font-size: 18px; font-weight: 900; color: var(--sp-gray-900);
  letter-spacing: -0.01em;
}

.add-panel-sub {
  margin: 3px 0 0; font-size: 12px; color: var(--sp-gray-500);
}

.add-panel-close {
  width: 34px; height: 34px; border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.50);
  color: var(--sp-gray-400); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;
}

.add-panel-close:hover {
  background: rgba(255, 255, 255, 0.80);
  color: var(--sp-gray-700);
}

/* ── Body ── */
.add-panel-body {
  position: relative; z-index: 2;
  flex: 1; overflow-y: auto;
  padding: 18px 26px;
}

/* ── Section ── */
.add-panel-sec {
  margin-bottom: 18px;
}

.add-panel-sec:last-of-type {
  margin-bottom: 0;
}

.add-panel-sec-label {
  display: flex; align-items: center; gap: 7px;
  font-size: 11px; font-weight: 800;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--sp-gray-500);
  margin-bottom: 12px;
}

.add-panel-sec-label i {
  color: var(--sp-red);
  font-style: normal; font-weight: 900;
}

.add-panel-sec-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--sp-primary);
}

/* ── Row ── */
.add-panel-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 440px) {
  .add-panel-row { grid-template-columns: 1fr; }
}

/* ── Field ── */
.add-panel-field {
  display: flex; flex-direction: column; gap: 7px;
  position: relative;
}

.add-panel-label {
  font-size: 13px; font-weight: 700; color: var(--sp-gray-700);
}

.add-panel-label i {
  font-style: normal; color: var(--sp-red); margin-left: 2px;
}

.add-panel-label--opt { color: var(--sp-gray-500); font-weight: 600; }

.add-panel-input-wrap {
  position: relative;
}

.add-panel-count {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 10px; font-weight: 600; color: var(--sp-gray-400);
  font-variant-numeric: tabular-nums;
  user-select: none; pointer-events: none;
}

/* ── Custom glass inputs ── */
.add-panel-input {
  width: 100%; height: 42px; padding: 0 14px;
  font-size: 14px; color: var(--sp-gray-900); font-family: inherit;
  background: rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.36);
  border-radius: 10px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
  box-sizing: border-box;
}

.add-panel-input::placeholder { color: var(--sp-gray-300); }

.add-panel-input:focus {
  border-color: var(--sp-primary);
  box-shadow: 0 0 0 3px rgba(6, 78, 162, 0.08);
  background: rgba(255, 255, 255, 0.38);
}

/* ── Custom glass select ── */
.add-panel-select {
  width: 100%; height: 42px; padding: 0 36px 0 14px;
  font-size: 14px; color: var(--sp-gray-900); font-family: inherit;
  background: rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.36);
  border-radius: 10px;
  outline: none;
  appearance: none;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
  box-sizing: border-box;
}

.add-panel-select:focus {
  border-color: var(--sp-primary);
  box-shadow: 0 0 0 3px rgba(6, 78, 162, 0.08);
  background: rgba(255, 255, 255, 0.38);
}

.add-panel-select:invalid,
.add-panel-select option[value=""] { color: var(--sp-gray-300); }

.add-panel-select-arrow {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  color: var(--sp-gray-400); pointer-events: none;
}

/* ── Upload area ── */
.add-panel-upload {
  position: relative;
}

.add-panel-upload-drop {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 28px 20px 22px;
  border: 2px dashed rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
}

.add-panel-upload-drop:hover {
  border-color: var(--sp-primary);
  background: rgba(239, 246, 255, 0.20);
}

.add-panel-upload-drop-icon {
  color: var(--sp-gray-300);
  transition: color 0.15s;
  margin-bottom: 2px;
}

.add-panel-upload-drop:hover .add-panel-upload-drop-icon {
  color: var(--sp-primary);
}

.add-panel-upload-drop-text {
  font-size: 13px; font-weight: 600; color: var(--sp-gray-600); margin: 0;
}

.add-panel-upload-drop-hint {
  font-size: 11px; color: var(--sp-gray-400); margin: 0;
}

.add-panel-upload-btn {
  display: inline-flex; align-items: center; gap: 7px;
  margin-top: 6px;
  padding: 9px 20px; border-radius: 9px; border: none;
  background: linear-gradient(135deg, #064ea2 0%, #0a5eb8 100%);
  color: #fff; font-size: 13px; font-weight: 700; cursor: pointer;
  box-shadow: 0 4px 14px rgba(6, 78, 162, 0.30);
  transition: all 0.18s cubic-bezier(0.22, 0.61, 0.36, 1);
  font-family: inherit;
}

.add-panel-upload-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(6, 78, 162, 0.38);
}

.add-panel-upload-btn:disabled {
  opacity: 0.6; cursor: not-allowed; transform: none;
}

/* ── Upload done ── */
.add-panel-upload-file {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  background: rgba(239, 246, 255, 0.30);
  border: 1px solid rgba(6, 78, 162, 0.12);
}

.add-panel-upload-file-icon {
  width: 38px; height: 38px;
  border-radius: 10px;
  background: rgba(6, 78, 162, 0.10);
  display: flex; align-items: center; justify-content: center;
  color: var(--sp-primary);
  flex-shrink: 0;
}

.add-panel-upload-file-info {
  flex: 1; min-width: 0;
}

.add-panel-upload-file-name {
  display: block;
  font-size: 13px; font-weight: 700; color: var(--sp-gray-800);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.add-panel-upload-file-meta {
  display: block;
  font-size: 11px; color: var(--sp-gray-400); margin-top: 1px;
  font-variant-numeric: tabular-nums;
}

.add-panel-upload-replace {
  background: none; border: none;
  font-size: 12px; font-weight: 600; color: var(--sp-primary);
  cursor: pointer; font-family: inherit;
  padding: 0;
  transition: opacity 0.15s;
}

.add-panel-upload-replace:hover { opacity: 0.7; }

/* ── Upload progress bar ── */
.add-panel-upload-progress {
  position: absolute; bottom: 0; left: 0; right: 0;
  height: 3px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 0 0 10px 10px;
  overflow: hidden;
}

.add-panel-upload-progress-bar {
  height: 100%;
  background: var(--sp-primary);
  transition: width 0.3s ease;
  border-radius: 0 1px 1px 0;
}

/* ── Footer ── */
.add-panel-foot {
  position: relative; z-index: 2;
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 16px 26px;
  border-top: 1px solid rgba(0, 0, 0, 0.04);
  background: rgba(255, 255, 255, 0.34);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.add-panel-hint {
  font-size: 12px; color: var(--sp-gray-400); font-weight: 600;
}

.add-panel-hint.ready { color: #047857; }

.add-panel-foot-actions {
  display: flex; gap: 10px; flex-shrink: 0;
}

.add-panel-btn-cancel {
  padding: 10px 20px; border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.50);
  color: var(--sp-gray-600);
  font-size: 13px; font-weight: 700; cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}

.add-panel-btn-cancel:hover {
  background: rgba(255, 255, 255, 0.80);
  color: var(--sp-gray-800);
}

.add-panel-btn-submit {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 22px; border-radius: 10px; border: none;
  background: rgba(6, 78, 162, 0.30);
  color: rgba(255, 255, 255, 0.60);
  font-size: 13px; font-weight: 700; cursor: not-allowed;
  font-family: inherit;
  transition: all 0.18s;
}

.add-panel-btn-submit.ready {
  background: linear-gradient(135deg, #064ea2 0%, #0a5eb8 100%);
  color: #fff; cursor: pointer;
  box-shadow: 0 4px 14px rgba(6, 78, 162, 0.30);
}

.add-panel-btn-submit.ready:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(6, 78, 162, 0.38);
}

/* ── Transitions ── */
.add-panel-enter-active, .add-panel-leave-active { transition: opacity 0.22s ease; }
.add-panel-enter-active .add-panel, .add-panel-leave-active .add-panel {
  transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.22s ease;
}
.add-panel-enter-from, .add-panel-leave-to { opacity: 0; }
.add-panel-enter-from .add-panel, .add-panel-leave-to .add-panel {
  transform: scale(0.96) translateY(12px); opacity: 0;
}

.add-fade-enter-active { transition: opacity 0.2s ease; }
.add-fade-leave-active { transition: opacity 0.15s ease; }
.add-fade-enter-from,
.add-fade-leave-to { opacity: 0; }

/* ═══ Responsive ═══ */
@media (max-width: 768px) {
  .qual-health-dashboard {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
