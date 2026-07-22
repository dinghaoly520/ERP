<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close, EditPen, RefreshLeft, ArrowRight } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import SpPageHero from '@/components/SpPageHero.vue'
import { FileEdit, AlertTriangle } from 'lucide-vue-next'

const supplierStore = useSupplierStore()
const loading = ref(true)
const error = ref(false)
const dialogVisible = ref(false)
const submitting = ref(false)

// ── Editable fields ──
const EDIT_FIELDS = [
  { key: 'name', label: '企业名称', type: 'text', placeholder: '请输入企业全称', required: true },
  { key: 'enterpriseType', label: '企业类型', type: 'text', placeholder: '如：有限责任公司', required: true },
  { key: 'legalPerson', label: '法定代表人', type: 'text', placeholder: '请输入法定代表人姓名', required: true },
  { key: 'registeredAddress', label: '注册地址', type: 'textarea', placeholder: '请输入企业注册地址', required: true },
  { key: 'businessScope', label: '经营范围', type: 'textarea', placeholder: '请输入经营范围', required: true },
] as const

const form = reactive<Record<string, string>>({})
const original = reactive<Record<string, string>>({})
const reason = ref('')

const isModified = (key: string) => (form[key] ?? '') !== (original[key] ?? '') && (form[key] ?? '').trim() !== ''
const changedFields = computed(() => EDIT_FIELDS.filter(f => isModified(f.key)))
const hasChanges = computed(() => changedFields.value.length > 0)
const canSubmit = computed(() => hasChanges.value && reason.value.trim().length > 0 && !submitting.value)

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  PENDING:  { label: '待审核', color: 'var(--warning)', icon: 'Clock' },
  APPROVED: { label: '已通过', color: 'var(--success)', icon: 'CircleCheckFilled' },
  REJECTED: { label: '已拒绝', color: 'var(--danger)', icon: 'CircleCloseFilled' },
}

function elapsedSince(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const days = Math.ceil(diff / 86400000)
  if (days > 0) return `${days} 天`
  const hours = Math.ceil(diff / 3600000)
  return hours > 0 ? `${hours} 小时` : '刚刚'
}

onMounted(async () => {
  try { await supplierStore.fetchChangeRecords() } catch { error.value = true } finally { loading.value = false }
})

async function retryLoad() {
  error.value = false; loading.value = true
  try { await supplierStore.fetchChangeRecords() } catch { error.value = true } finally { loading.value = false }
}

async function openDialog() {
  try { await supplierStore.fetchProfile() } catch { ElMessage.error('加载企业资料失败'); return }
  const p = supplierStore.profile
  if (!p) return
  EDIT_FIELDS.forEach(f => {
    const val = (p[f.key] as string) ?? ''
    form[f.key] = val
    original[f.key] = val
  })
  reason.value = ''
  dialogVisible.value = true
}

function resetField(key: string) { form[key] = original[key] }
function resetAll() {
  EDIT_FIELDS.forEach(f => { form[f.key] = original[f.key] })
  reason.value = ''
}

async function handleBeforeClose(done: () => void) {
  if (hasChanges.value) {
    try {
      await ElMessageBox.confirm('有未保存的变更内容，确定放弃吗？', '提示', {
        confirmButtonText: '确定放弃', cancelButtonText: '继续编辑', type: 'warning',
      })
    } catch { return }
  }
  done()
}

function closeDialog() { handleBeforeClose(() => { dialogVisible.value = false }) }

async function handleSubmit() {
  if (!canSubmit.value) {
    if (!hasChanges.value) { ElMessage.warning('请至少修改一项资料'); return }
    if (!reason.value.trim()) { ElMessage.warning('请填写变更原因'); return }
    return
  }
  const summaryLines = changedFields.value.map(f => {
    const oldV = original[f.key] || '（空）'
    const newV = form[f.key]
    return `<div style="margin:6px 0"><b style="color:#064ea2">${f.label}</b><br/><span style="color:#94a3b8;text-decoration:line-through">${escapeHtml(oldV)}</span> → <span style="color:#059669;font-weight:600">${escapeHtml(newV)}</span></div>`
  }).join('')
  try {
    await ElMessageBox.confirm(
      `<div style="font-size:13px;line-height:1.6">本次将提交 <b>${changedFields.value.length}</b> 项资料变更，提交后需等待管理员审核：${summaryLines}<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.06);color:#64748b">变更原因：${escapeHtml(reason.value)}</div></div>`,
      '确认提交变更',
      { confirmButtonText: '确认提交', cancelButtonText: '取消', type: 'warning', dangerouslyUseHTMLString: true },
    )
  } catch { return }

  submitting.value = true
  let success = 0, failed = 0
  for (const f of changedFields.value) {
    try {
      await supplierStore.createChangeRequest({
        fieldName: f.key, fieldLabel: f.label,
        oldValue: original[f.key] || '', newValue: form[f.key],
        reason: reason.value.trim(),
      })
      success++
    } catch { failed++ }
  }
  submitting.value = false
  if (success > 0 && failed === 0) {
    ElMessage.success(`已提交 ${success} 项变更申请，等待审核`)
    dialogVisible.value = false
  } else if (success > 0 && failed > 0) {
    ElMessage.warning(`部分成功：${success} 项成功，${failed} 项失败`)
    dialogVisible.value = false
  } else {
    ElMessage.error('提交失败，请重试')
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <!-- Error -->
    <div v-if="error && !loading" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>

    <template v-else-if="!loading">
      <!-- ════════ Hero ════════ -->
      <SpPageHero :icon="FileEdit" eyebrow="资料变更中心" title="企业信息变更" sub="修改企业资料并提交审核，支持一次变更多项信息。所有变更经平台审核后生效。">
        <template #actions>
          <button class="neu-btn-primary" @click="openDialog">
            <el-icon :size="18"><EditPen /></el-icon>
            <span>申请变更</span>
          </button>
        </template>
      </SpPageHero>

      <!-- ════════ Records: card timeline ════════ -->
      <div v-if="supplierStore.changeRecords.length > 0" class="cr-list">
        <div
          v-for="r in supplierStore.changeRecords"
          :key="r.id"
          class="cr-card"
          :style="{ '--st-color': STATUS_CONFIG[r.status]?.color || 'var(--muted-foreground)' } as any"
        >
          <div class="cr-card-rail" />
          <div class="cr-card-body">
            <div class="cr-card-top">
              <span class="cr-field-badge">{{ r.fieldLabel }}</span>
              <span class="cr-status-pill">
                <el-icon :size="13"><component :is="STATUS_CONFIG[r.status]?.icon || 'InfoFilled'" /></el-icon>
                {{ STATUS_CONFIG[r.status]?.label || r.status }}
              </span>
            </div>
            <div class="cr-diff">
              <div class="cr-diff-old">
                <span class="cr-diff-label">原值</span>
                <span class="cr-diff-val">{{ r.oldValue || '—' }}</span>
              </div>
              <div class="cr-diff-arrow"><el-icon :size="16"><ArrowRight /></el-icon></div>
              <div class="cr-diff-new">
                <span class="cr-diff-label">新值</span>
                <span class="cr-diff-val">{{ r.newValue }}</span>
              </div>
            </div>
            <div v-if="r.reason" class="cr-reason">
              <el-icon :size="13"><ChatLineSquare /></el-icon>
              <span>{{ r.reason }}</span>
            </div>
            <div class="cr-card-foot">
              <span class="cr-foot-time">{{ dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') }}</span>
              <span v-if="r.status === 'PENDING'" class="cr-foot-wait">
                <span class="cr-wait-dot" /> 已等待 {{ elapsedSince(r.createdAt) }}
              </span>
              <span v-if="r.reviewedAt" class="cr-foot-review">审核于 {{ dayjs(r.reviewedAt).format('MM-DD HH:mm') }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="cr-empty">
        <div class="cr-empty-icon"><el-icon :size="36"><Document /></el-icon></div>
        <div class="cr-empty-title">暂无变更记录</div>
        <div class="cr-empty-desc">如需修改企业名称、地址、经营范围等信息，请点击右上角申请变更</div>
      </div>

      <!-- ════════ Custom editing panel (Teleport) ════════ -->
      <Teleport to="body">
        <Transition name="cr-panel">
          <div v-if="dialogVisible" class="cr-overlay" @click.self="closeDialog">
            <div class="cr-panel">
              <!-- Header -->
              <div class="crp-head">
                <div class="crp-head-left">
                  <div class="crp-head-icon"><el-icon :size="20"><EditPen /></el-icon></div>
                  <div>
                    <h2 class="crp-title">修改企业资料</h2>
                    <p class="crp-sub">编辑需要变更的字段，提交后进入审核流程</p>
                  </div>
                </div>
                <button class="crp-close" @click="closeDialog"><el-icon :size="18"><Close /></el-icon></button>
              </div>

              <!-- Body -->
              <div class="crp-body">
                <!-- Counter strip -->
                <Transition name="cr-fade">
                  <div v-if="hasChanges" class="crp-counter">
                    <div class="crp-counter-left">
                      <span class="crp-counter-num">{{ changedFields.length }}</span>
                      <span class="crp-counter-text">项资料待提交</span>
                    </div>
                    <button class="crp-reset" @click="resetAll"><el-icon :size="14"><RefreshLeft /></el-icon>全部还原</button>
                  </div>
                </Transition>

                <!-- Section: enterprise info -->
                <div class="crp-section">
                  <div class="crp-section-label"><span class="crp-section-dot" />企业资料</div>
                  <div class="crp-fields">
                    <div
                      v-for="f in EDIT_FIELDS"
                      :key="f.key"
                      class="crp-field"
                      :class="{ modified: isModified(f.key) }"
                    >
                      <div class="crp-field-head">
                        <label class="crp-label">{{ f.label }}<i v-if="f.required">*</i></label>
                        <Transition name="cr-fade">
                          <span v-if="isModified(f.key)" class="crp-mod-tag">已修改</span>
                        </Transition>
                      </div>
                      <!-- Original value comparison (only when modified) -->
                      <div v-if="isModified(f.key) && original[f.key]" class="crp-orig">
                        <span class="crp-orig-label">原值</span>
                        <span class="crp-orig-val">{{ original[f.key] }}</span>
                        <button class="crp-orig-revert" @click="resetField(f.key)">还原</button>
                      </div>
                      <!-- Native input -->
                      <input
                        v-if="f.type === 'text'"
                        class="crp-input"
                        v-model="form[f.key]"
                        :placeholder="f.placeholder"
                      />
                      <textarea
                        v-else
                        class="crp-input crp-textarea"
                        v-model="form[f.key]"
                        :rows="f.key === 'businessScope' ? 3 : 2"
                        :placeholder="f.placeholder"
                      />
                    </div>
                  </div>
                </div>

                <!-- Section: reason -->
                <div class="crp-section">
                  <div class="crp-section-label"><span class="crp-section-dot amber" />变更说明</div>
                  <div class="crp-field">
                    <div class="crp-field-head">
                      <label class="crp-label">变更原因<i>*</i></label>
                      <span class="crp-count">{{ reason.length }}/200</span>
                    </div>
                    <textarea
                      class="crp-input crp-textarea"
                      v-model="reason"
                      :rows="3"
                      maxlength="200"
                      placeholder="请说明本次资料变更的原因，如：工商信息更新、地址搬迁、经营范围调整等"
                    />
                  </div>
                </div>
              </div>

              <!-- Footer -->
              <div class="crp-foot">
                <span class="crp-hint" v-if="!canSubmit && hasChanges">请填写变更原因</span>
                <span class="crp-hint" v-else-if="!hasChanges">修改任意字段后可提交</span>
                <span class="crp-hint ready" v-else>准备提交 {{ changedFields.length }} 项变更</span>
                <div class="crp-foot-actions">
                  <button class="crp-btn-cancel" @click="closeDialog">取消</button>
                  <button class="crp-btn-submit" :disabled="!canSubmit" :class="{ ready: canSubmit }" @click="handleSubmit">
                    <span v-if="submitting">提交中…</span>
                    <template v-else>
                      <el-icon :size="15"><ArrowRight /></el-icon>
                      <span>{{ hasChanges ? `提交 ${changedFields.length} 项变更` : '提交变更' }}</span>
                    </template>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>
    </template>
  </div>
</template>

<style scoped>
/* ════════ Card timeline — neumorphic plates (no glass / no drift) ════════ */
.cr-list { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
.cr-card {
  position: relative; display: flex; overflow: hidden;
  border-radius: 16px;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.cr-card:hover {
  transform: translateY(-1px);
  box-shadow: 7px 7px 16px oklch(0.55 0.03 258 / 0.12), -5px -5px 12px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.cr-card-rail { width: 4px; flex-shrink: 0; background: var(--st-color, var(--muted-foreground)); position: relative; z-index: 1; }
.cr-card-body { position: relative; z-index: 1; flex: 1; min-width: 0; padding: 16px 20px; }
.cr-card-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.cr-field-badge { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 7px; background: color-mix(in oklab, var(--brand) 12%, transparent); color: var(--brand); font-size: 12px; font-weight: 800; }
.cr-status-pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 999px; background: color-mix(in oklab, var(--st-color, #94a3b8) 12%, transparent); color: var(--st-color, var(--muted-foreground)); font-size: 12px; font-weight: 700; }
.cr-diff {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 10px; margin-bottom: 10px;
  background: oklch(0.97 0.01 258 / 0.5);
  box-shadow: inset 2px 2px 5px oklch(0.55 0.03 258 / 0.08), inset -2px -2px 5px oklch(1 0 0 / 0.6);
}
.cr-diff-old, .cr-diff-new { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.cr-diff-label { font-size: 10px; font-weight: 700; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.05em; }
.cr-diff-old .cr-diff-val { font-size: 13px; color: var(--muted-foreground); text-decoration: line-through; word-break: break-all; }
.cr-diff-new .cr-diff-val { font-size: 14px; color: var(--foreground); font-weight: 700; word-break: break-all; }
.cr-diff-arrow { flex-shrink: 0; color: var(--st-color, var(--muted-foreground)); opacity: 0.6; }
.cr-reason { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 10px; font-size: 12px; color: var(--foreground); line-height: 1.5; }
.cr-reason .el-icon { flex-shrink: 0; margin-top: 1px; color: var(--muted-foreground); }
.cr-reason span { word-break: break-all; }
.cr-card-foot { display: flex; align-items: center; gap: 14px; padding-top: 10px; border-top: 1px solid var(--hairline); font-size: 11px; }
.cr-foot-time { color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.cr-foot-wait { display: inline-flex; align-items: center; gap: 5px; color: var(--warning); font-weight: 600; }
.cr-wait-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--warning); animation: cr-pulse 2s ease-in-out infinite; }
.cr-foot-review { margin-left: auto; color: var(--muted-foreground); }
@keyframes cr-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

/* ════════ Empty — neumorphic plate ════════ */
.cr-empty {
  position: relative; text-align: center; padding: 64px 24px; margin-top: 16px;
  border-radius: 16px; overflow: hidden;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.cr-empty-icon { color: var(--muted-foreground); margin-bottom: 14px; }
.cr-empty-title { font-size: 16px; font-weight: 800; color: var(--foreground); }
.cr-empty-desc { margin-top: 6px; font-size: 13px; color: var(--muted-foreground); max-width: 420px; margin-left: auto; margin-right: auto; line-height: 1.5; }

/* ════════ Custom panel (Teleport — neumorphic) ════════ */
.cr-overlay {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: center; justify-content: center; padding: 32px;
  background: oklch(0.35 0.06 258 / 0.28);
}
.cr-panel {
  position: relative; width: 600px; max-width: 100%; max-height: calc(100vh - 64px);
  display: flex; flex-direction: column; overflow: hidden;
  border: none; border-radius: 20px;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.75), 0 20px 60px oklch(0.3 0.05 258 / 0.18);
}

/* ── Header ── */
.crp-head { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 26px 16px; border-bottom: 1px solid var(--hairline); }
.crp-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.crp-head-icon {
  width: 44px; height: 44px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: oklch(0.985 0.005 258); color: var(--brand);
  box-shadow: inset 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.14), inset -2px -2px 5px oklch(1 0 0 / 0.75);
  flex-shrink: 0;
}
.crp-title { margin: 0; font-size: 18px; font-weight: 900; color: var(--foreground); letter-spacing: -0.01em; }
.crp-sub { margin: 3px 0 0; font-size: 12px; color: var(--muted-foreground); }
.crp-close {
  width: 34px; height: 34px; border-radius: 10px; border: none;
  background: var(--surface); color: var(--muted-foreground); cursor: pointer;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85);
  transition: all 0.15s;
}
.crp-close:hover {
  color: var(--brand); transform: translateY(-1px);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9);
}

/* ── Body ── */
.crp-body { position: relative; flex: 1; overflow-y: auto; padding: 18px 26px; }

/* Counter strip — concave tinted trough */
.crp-counter {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px; margin-bottom: 18px; border-radius: 12px; border: none;
  background: color-mix(in oklab, var(--brand) 7%, oklch(0.985 0.005 258));
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6), inset 2px 2px 5px oklch(0.55 0.03 258 / 0.08), inset -2px -2px 5px oklch(1 0 0 / 0.6);
}
.crp-counter-left { display: flex; align-items: baseline; gap: 8px; }
.crp-counter-num { font-size: 24px; font-weight: 900; color: var(--brand); font-variant-numeric: tabular-nums; line-height: 1; }
.crp-counter-text { font-size: 13px; font-weight: 600; color: var(--foreground); }
.crp-reset {
  display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 8px; border: none;
  background: var(--surface); color: var(--foreground);
  font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85);
  transition: all 0.15s;
}
.crp-reset:hover {
  color: var(--brand); transform: translateY(-1px);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9);
}

/* Sections */
.crp-section { margin-bottom: 18px; }
.crp-section:last-child { margin-bottom: 0; }
.crp-section-label { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted-foreground); margin-bottom: 12px; }
.crp-section-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); }
.crp-section-dot.amber { background: var(--warning); }

/* Fields */
.crp-fields { display: flex; flex-direction: column; gap: 14px; }
.crp-field { display: flex; flex-direction: column; gap: 7px; }
.crp-field.modified {
  padding: 14px; margin: -4px -4px 2px; border-radius: 12px; border: none;
  background: color-mix(in oklab, var(--brand) 6%, oklch(0.99 0.004 258));
  box-shadow: inset 0 0 0 1px oklch(0.5 0.16 258 / 0.10), inset 2px 2px 5px oklch(0.55 0.03 258 / 0.06), inset -2px -2px 5px oklch(1 0 0 / 0.55);
}
.crp-field-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.crp-label { font-size: 13px; font-weight: 700; color: var(--foreground); }
.crp-label i { font-style: normal; color: var(--danger); margin-left: 2px; }
.crp-count { font-size: 11px; font-weight: 600; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.crp-mod-tag { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 6px; background: color-mix(in oklab, var(--success) 12%, transparent); color: var(--success); font-size: 11px; font-weight: 700; }

/* Original value comparison row */
.crp-orig { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; background: oklch(0.55 0.03 258 / 0.05); }
.crp-orig-label { font-size: 10px; font-weight: 800; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.05em; flex-shrink: 0; }
.crp-orig-val { flex: 1; font-size: 12px; color: var(--muted-foreground); text-decoration: line-through; word-break: break-all; min-width: 0; }
.crp-orig-revert { flex-shrink: 0; padding: 3px 9px; border-radius: 6px; border: none; background: transparent; color: var(--muted-foreground); font-size: 11px; font-weight: 600; cursor: pointer; transition: color 0.15s; }
.crp-orig-revert:hover { color: var(--brand); }

/* Native inputs — concave */
.crp-input {
  width: 100%; height: 42px; padding: 0 14px;
  font-size: 14px; color: var(--ink); font-family: inherit;
  background: oklch(0.99 0.004 258);
  border: 1px solid oklch(0.78 0.03 258 / 0.4);
  border-radius: 9px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
  box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.1), inset -2px -2px 4px oklch(1 0 0 / 0.7);
}
.crp-input::placeholder { color: oklch(0.74 0.02 258); }
.crp-input:focus {
  border-color: oklch(0.5 0.16 258 / 0.5);
  box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.08), inset -2px -2px 4px oklch(1 0 0 / 0.5), 0 0 0 3px oklch(0.5 0.16 258 / 0.08);
}
.crp-textarea { height: auto; padding: 11px 14px; resize: none; line-height: 1.6; }

/* ── Footer ── */
.crp-foot { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 26px; border-top: 1px solid var(--hairline); background: oklch(1 0 0 / 0.3); }
.crp-hint { font-size: 12px; color: var(--muted-foreground); font-weight: 600; }
.crp-hint.ready { color: var(--success); }
.crp-foot-actions { display: flex; gap: 10px; flex-shrink: 0; }
.crp-btn-cancel {
  padding: 10px 20px; border-radius: 9px; border: none;
  background: var(--surface); color: var(--foreground);
  font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85);
  transition: all 0.15s;
}
.crp-btn-cancel:hover {
  color: var(--brand); transform: translateY(-1px);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9);
}
.crp-btn-submit {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 22px; border-radius: 9px; border: none;
  background: var(--brand); color: #fff;
  font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
  box-shadow: 3px 3px 6px oklch(0.5 0.08 258 / 0.25), -2px -2px 5px oklch(1 0 0 / 0.5);
  transition: all 0.18s;
}
.crp-btn-submit:disabled {
  opacity: 0.55; cursor: not-allowed; transform: none;
  box-shadow: 2px 2px 4px oklch(0.5 0.05 258 / 0.15), -1px -1px 3px oklch(1 0 0 / 0.4);
}
.crp-btn-submit.ready:hover {
  background: var(--brand-deep); transform: translateY(-1px);
  box-shadow: 4px 4px 10px oklch(0.45 0.08 258 / 0.28), -2px -2px 6px oklch(1 0 0 / 0.55);
}

/* ── Transitions ── */
.cr-panel-enter-active, .cr-panel-leave-active { transition: opacity 0.22s ease; }
.cr-panel-enter-active .cr-panel, .cr-panel-leave-active .cr-panel { transition: transform 0.26s cubic-bezier(0.22,0.61,0.36,1), opacity 0.22s ease; }
.cr-panel-enter-from, .cr-panel-leave-to { opacity: 0; }
.cr-panel-enter-from .cr-panel, .cr-panel-leave-to .cr-panel { transform: scale(0.96) translateY(12px); opacity: 0; }
.cr-fade-enter-active, .cr-fade-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.cr-fade-enter-from, .cr-fade-leave-to { opacity: 0; transform: translateY(-4px); }

@media (max-width: 768px) {
  .cr-list { margin-top: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  .cr-card, .crp-close, .crp-reset, .crp-btn-cancel, .crp-btn-submit, .cr-wait-dot {
    transition: none; animation: none;
  }
}
</style>
