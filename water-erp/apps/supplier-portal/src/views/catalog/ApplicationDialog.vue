<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close, WarningFilled } from '@element-plus/icons-vue'
import { catalogApi } from '@/api/catalog'

const props = defineProps<{
  modelValue: boolean
  mode: 'NEW_ITEM' | 'JOIN_EXISTING' | 'UPDATE_QUOTE' | 'edit'
  item?: any
  application?: any
}>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean]; success: [] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const titleMap: Record<string, string> = {
  NEW_ITEM: '新增品类', JOIN_EXISTING: '申请供货', UPDATE_QUOTE: '改报价', edit: '重新提交',
}
const title = computed(() => titleMap[props.mode])

const categoryTree = ref<{ group: string; categories: string[] }[]>([])
const groupOptions = computed(() => categoryTree.value.map(c => c.group))
function categoriesOf(group: string) { return categoryTree.value.find(c => c.group === group)?.categories || [] }

const submitting = ref(false)
const formDirty = ref(false)
const form = ref<any>({})

function markDirty() { formDirty.value = true }

async function handleBeforeClose(done: () => void) {
  if (formDirty.value) {
    try {
      await ElMessageBox.confirm('有未保存的填写内容，确定放弃吗？', '提示', {
        confirmButtonText: '确定放弃', cancelButtonText: '继续编辑', type: 'warning',
      })
    } catch { return }
  }
  done()
}

function resetForm() {
  if (props.mode === 'edit' && props.application) {
    const a = props.application
    form.value = {
      proposedName: a.proposedName, proposedSpec: a.proposedSpec,
      proposedCategory: a.proposedCategory, proposedGroup: a.proposedGroup, proposedUnit: a.proposedUnit,
      quotedPrice: a.quotedPrice, deliveryPeriod: a.deliveryPeriod, region: a.region,
      minOrder: a.minOrder, taxIncluded: a.taxIncluded ?? true, freightIncluded: a.freightIncluded ?? false,
      qualificationNote: a.qualificationNote,
    }
  } else if (props.mode === 'UPDATE_QUOTE' && props.item) {
    form.value = { quotedPrice: undefined, deliveryPeriod: '', region: '', minOrder: '', taxIncluded: true, freightIncluded: false, qualificationNote: '' }
  } else {
    form.value = {
      proposedName: '', proposedSpec: '', proposedCategory: '', proposedGroup: '', proposedUnit: '',
      quotedPrice: undefined, deliveryPeriod: '', region: '', minOrder: '',
      taxIncluded: true, freightIncluded: false, qualificationNote: '',
    }
  }
}

watch(() => props.modelValue, async (v) => {
  if (v) {
    resetForm()
    if (props.mode === 'NEW_ITEM' && categoryTree.value.length === 0) {
      try { categoryTree.value = await catalogApi.listCategories() } catch { /* ignore */ }
    }
  }
})

const isNewItem = computed(() => props.mode === 'NEW_ITEM' || (props.mode === 'edit' && props.application?.type === 'NEW_ITEM'))

async function handleSubmit() {
  if (form.value.quotedPrice == null || Number(form.value.quotedPrice) <= 0) { ElMessage.warning('请填写有效报价'); return }
  if (isNewItem.value) {
    if (!form.value.proposedName?.trim()) { ElMessage.warning('请填写物资名称'); return }
    if (!form.value.proposedGroup) { ElMessage.warning('请选择组别'); return }
    if (!form.value.proposedCategory) { ElMessage.warning('请选择分类'); return }
    if (!form.value.proposedUnit?.trim()) { ElMessage.warning('请填写单位'); return }
  }
  if (props.mode === 'UPDATE_QUOTE') {
    try {
      await ElMessageBox.confirm(
        `确认将报价修改为 ¥${Number(form.value.quotedPrice).toFixed(2)}？`, '确认改报价',
        { confirmButtonText: '确认修改', cancelButtonText: '取消', type: 'warning' },
      )
    } catch { return }
  }
  submitting.value = true
  try {
    const payload: any = {
      quotedPrice: Number(form.value.quotedPrice),
      deliveryPeriod: form.value.deliveryPeriod || undefined,
      region: form.value.region || undefined, minOrder: form.value.minOrder || undefined,
      taxIncluded: form.value.taxIncluded, freightIncluded: form.value.freightIncluded,
      qualificationNote: form.value.qualificationNote || undefined,
    }
    if (isNewItem.value) {
      payload.proposedName = form.value.proposedName.trim()
      payload.proposedSpec = form.value.proposedSpec?.trim() || undefined
      payload.proposedCategory = form.value.proposedCategory
      payload.proposedGroup = form.value.proposedGroup
      payload.proposedUnit = form.value.proposedUnit.trim()
    }
    if (props.mode === 'edit') {
      await catalogApi.updateApplication(props.application.id, { ...payload, type: props.application.type })
      ElMessage.success('已重新提交申请')
    } else {
      await catalogApi.createApplication({ type: props.mode, catalogItemId: props.item?.id, ...payload })
      ElMessage.success('申请已提交，等待管理员审核')
    }
    formDirty.value = false; visible.value = false; emit('success')
  } catch { /* interceptor already shows error */ }
  finally { submitting.value = false }
}
</script>

<template>
  <!-- ═══ Custom glass panel overlay ═══ -->
  <Teleport to="body">
    <Transition name="app-dlg">
      <div v-if="visible" class="app-dlg-overlay" @click.self="handleBeforeClose(() => visible = false)">
        <div class="app-dlg-panel">
          <!-- Title bar -->
          <div class="app-dlg-head">
            <h2 class="app-dlg-title">{{ title }}</h2>
            <button class="app-dlg-close" @click="handleBeforeClose(() => visible = false)">
              <el-icon :size="18"><component is="Close" /></el-icon>
            </button>
          </div>

          <!-- Body -->
          <div class="app-dlg-body">
            <!-- Target item info (JOIN/UPDATE) -->
            <div
              v-if="item && mode !== 'NEW_ITEM' && mode !== 'edit'"
              class="app-dlg-item-badge"
            >
              <span class="app-dlg-item-code">{{ item.code }}</span>
              <span class="app-dlg-item-sep">·</span>
              <span class="app-dlg-item-name">{{ item.name }}</span>
              <span class="app-dlg-item-spec">{{ item.specification }}</span>
              <span class="app-dlg-item-unit">{{ item.unit }}</span>
            </div>
            <div
              v-if="mode === 'edit' && application?.catalogItem"
              class="app-dlg-item-badge"
            >
              <span class="app-dlg-item-code">{{ application.catalogItem.code }}</span>
              <span class="app-dlg-item-name">{{ application.catalogItem.name }}</span>
            </div>

            <!-- Countered warning -->
            <div
              v-if="mode === 'edit' && application?.status === 'COUNTERED' && application.counterPrice"
              class="app-dlg-countered"
            >
              <el-icon><WarningFilled /></el-icon>
              管理员议价 <strong>¥{{ application.counterPrice }}</strong>，可直接修改报价后重新提交
            </div>

            <!-- ────── Form ────── -->
            <div class="app-dlg-form">
              <!-- New item fields -->
              <template v-if="isNewItem">
                <div class="app-dlg-field">
                  <label class="app-dlg-label">物资名称 <i>*</i></label>
                  <input class="app-dlg-input" v-model="form.proposedName" placeholder="如：玻璃钢夹砂管" maxlength="60" @input="markDirty" />
                </div>
                <div class="app-dlg-field">
                  <label class="app-dlg-label">规格型号</label>
                  <input class="app-dlg-input" v-model="form.proposedSpec" placeholder="如：DN500，SN10" maxlength="120" @input="markDirty" />
                </div>
                <div class="app-dlg-row">
                  <div class="app-dlg-field">
                    <label class="app-dlg-label">组别 <i>*</i></label>
                    <div class="app-dlg-select-wrap">
                      <el-select v-model="form.proposedGroup" placeholder="选择组别" @change="form.proposedCategory=''; markDirty()">
                        <el-option v-for="g in groupOptions" :key="g" :label="g" :value="g" />
                      </el-select>
                    </div>
                  </div>
                  <div class="app-dlg-field">
                    <label class="app-dlg-label">分类 <i>*</i></label>
                    <div class="app-dlg-select-wrap">
                      <el-select v-model="form.proposedCategory" placeholder="选择分类" :disabled="!form.proposedGroup" @change="markDirty()">
                        <el-option v-for="c in categoriesOf(form.proposedGroup)" :key="c" :label="c" :value="c" />
                      </el-select>
                    </div>
                  </div>
                </div>
                <div class="app-dlg-field">
                  <label class="app-dlg-label">单位 <i>*</i></label>
                  <input class="app-dlg-input" v-model="form.proposedUnit" placeholder="如：米 / 吨 / 套" maxlength="10" style="max-width:160px" @input="markDirty" />
                </div>
              </template>

              <!-- Price — always shown -->
              <div class="app-dlg-field">
                <label class="app-dlg-label">
                  {{ mode === 'UPDATE_QUOTE' ? '新报价' : '报价' }} <i>*</i>
                  <span v-if="item" class="app-dlg-label-hint">/ {{ item.unit }}</span>
                  <span v-else-if="form.proposedUnit" class="app-dlg-label-hint">/ {{ form.proposedUnit }}</span>
                </label>
                <div class="app-dlg-price-input">
                  <span class="app-dlg-currency">¥</span>
                  <input
                    class="app-dlg-input"
                    type="number"
                    v-model.number="form.quotedPrice"
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    @input="markDirty"
                  />
                </div>
              </div>

              <div class="app-dlg-row">
                <div class="app-dlg-field">
                  <label class="app-dlg-label">交货周期</label>
                  <input class="app-dlg-input" v-model="form.deliveryPeriod" placeholder="如：7个工作日" maxlength="20" @input="markDirty" />
                </div>
                <div class="app-dlg-field">
                  <label class="app-dlg-label">适用区域</label>
                  <input class="app-dlg-input" v-model="form.region" placeholder="如：成都 / 全省" maxlength="20" @input="markDirty" />
                </div>
              </div>
              <div class="app-dlg-row">
                <div class="app-dlg-field">
                  <label class="app-dlg-label">最小起订</label>
                  <input class="app-dlg-input" v-model="form.minOrder" placeholder="如：1吨 / 50米" maxlength="20" @input="markDirty" />
                </div>
                <div class="app-dlg-field">
                  <label class="app-dlg-label">含税 &amp; 运费</label>
                  <div class="app-dlg-checks">
                    <label class="app-dlg-check"><input type="checkbox" v-model="form.taxIncluded" @change="markDirty" /><span>含税</span></label>
                    <label class="app-dlg-check"><input type="checkbox" v-model="form.freightIncluded" @change="markDirty" /><span>含运费</span></label>
                  </div>
                </div>
              </div>
              <div class="app-dlg-field">
                <label class="app-dlg-label">资质说明</label>
                <textarea class="app-dlg-input app-dlg-textarea" v-model="form.qualificationNote" :rows="3" placeholder="资质优势、代理授权、库存产能等，便于管理员审核" maxlength="300" @input="markDirty" />
                <span class="app-dlg-charcount">{{ (form.qualificationNote || '').length }} / 300</span>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="app-dlg-foot">
            <button class="app-dlg-btn cancel" @click="handleBeforeClose(() => visible = false)">取消</button>
            <button class="app-dlg-btn primary" :disabled="submitting" @click="handleSubmit">
              {{ submitting ? '提交中...' : (mode === 'edit' ? '重新提交' : '提交申请') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ═══════════ Overlay ═══════════ */
.app-dlg-overlay {
  position: fixed; inset: 0; z-index: 2100;
  display: flex; align-items: center; justify-content: center;
  background: rgba(15,35,65,0.12);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

/* ═══════════ Panel ═══════════ */
.app-dlg-panel {
  position: relative;
  width: 540px; max-width: calc(100vw - 48px); max-height: calc(100vh - 64px);
  display: flex; flex-direction: column;
  background: rgba(255,255,255,0.62);
  backdrop-filter: blur(28px) saturate(1.25);
  -webkit-backdrop-filter: blur(28px) saturate(1.25);
  border: 1px solid rgba(255,255,255,0.48);
  border-radius: 20px;
  box-shadow: 0 4px 8px rgba(15,35,65,0.04), 0 16px 48px rgba(91,155,213,0.10);
  overflow: hidden;
}
.app-dlg-panel::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
  opacity: 0.46; border-radius: inherit;
  background-image:
    radial-gradient(ellipse at 15% 8%,  rgba(147,197,253,0.26), transparent 55%),
    radial-gradient(ellipse at 85% 14%, rgba(168,139,250,0.16), transparent 55%),
    radial-gradient(ellipse at 40% 88%, rgba(110,231,183,0.10), transparent 55%);
  animation: glass-glow-drift 20s ease-in-out infinite;
}

/* ═══════════ Head ═══════════ */
.app-dlg-head {
  position: relative; z-index: 2;
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 24px 14px;
  border-bottom: 1px solid rgba(0,0,0,0.04);
}
.app-dlg-title {
  margin: 0; font-size: 17px; font-weight: 900; color: var(--sp-gray-900); letter-spacing: -0.01em;
}
.app-dlg-close {
  width: 32px; height: 32px; border-radius: 10px; border: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.04); color: var(--sp-gray-400);
  cursor: pointer; transition: background 0.15s, color 0.15s;
}
.app-dlg-close:hover { background: rgba(0,0,0,0.08); color: var(--sp-gray-600); }

/* ═══════════ Body ═══════════ */
.app-dlg-body {
  position: relative; z-index: 2;
  flex: 1; overflow-y: auto;
  padding: 20px 24px;
}

/* ── Item badge ── */
.app-dlg-item-badge {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 12px 16px; margin-bottom: 18px;
  background: rgba(255,255,255,0.40); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.40); border-radius: 12px;
  font-size: 13px;
}
.app-dlg-item-code { font-family: 'SF Mono', 'JetBrains Mono', monospace; font-weight: 800; color: var(--sp-primary); font-size: 11px; }
.app-dlg-item-sep  { color: var(--sp-gray-300); }
.app-dlg-item-name { font-weight: 800; color: var(--sp-gray-900); }
.app-dlg-item-spec { color: var(--sp-gray-400); font-size: 12px; }
.app-dlg-item-unit { color: var(--sp-gray-400); font-size: 12px; margin-left: auto; }

/* ── Countered warning ── */
.app-dlg-countered {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 18px; padding: 10px 14px;
  background: rgba(255,251,235,0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(250,204,21,0.30); border-radius: 10px;
  font-size: 13px; color: #92400e;
}
.app-dlg-countered strong { color: #dc2626; font-size: 15px; }

/* ═══════════ Form ═══════════ */
.app-dlg-form { display: flex; flex-direction: column; gap: 16px; }

.app-dlg-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

.app-dlg-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

.app-dlg-label {
  font-size: 12px; font-weight: 700; color: var(--sp-gray-600); letter-spacing: 0.02em;
}
.app-dlg-label i { font-style: normal; color: var(--sp-red); }
.app-dlg-label-hint { font-weight: 400; color: var(--sp-gray-400); }

/* ── Native inputs → extreme glass ── */
.app-dlg-input {
  width: 100%; height: 40px; padding: 0 12px;
  font-size: 14px; color: var(--sp-gray-900);
  background: rgba(255,255,255,0.22); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.36); border-radius: 10px;
  outline: none; transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}
.app-dlg-input::placeholder { color: var(--sp-gray-300); }
.app-dlg-input:focus { border-color: var(--sp-primary); box-shadow: 0 0 0 3px rgba(6,78,162,0.08); }
.app-dlg-input[type="number"] { -moz-appearance: textfield; }
.app-dlg-input[type="number"]::-webkit-inner-spin-button,
.app-dlg-input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }

.app-dlg-textarea {
  height: auto; padding: 10px 12px; resize: vertical; line-height: 1.6;
}
.app-dlg-charcount {
  align-self: flex-end; font-size: 11px; color: var(--sp-gray-400); margin-top: -10px;
}

/* ── Price input ── */
.app-dlg-price-input {
  display: flex; align-items: center;
  background: rgba(255,255,255,0.22); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.36); border-radius: 10px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.app-dlg-price-input:focus-within { border-color: var(--sp-primary); box-shadow: 0 0 0 3px rgba(6,78,162,0.08); }
.app-dlg-currency {
  padding: 0 0 0 12px; font-size: 15px; font-weight: 700; color: var(--sp-gray-400);
}
.app-dlg-price-input .app-dlg-input {
  border: none; background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none;
  box-shadow: none;
}
.app-dlg-price-input .app-dlg-input:focus { box-shadow: none; }

/* ── Select wrappers ── */
.app-dlg-select-wrap { }
.app-dlg-select-wrap :deep(.el-select) { width: 100%; }
.app-dlg-select-wrap :deep(.el-input__wrapper) {
  background: rgba(255,255,255,0.22) !important; backdrop-filter: blur(6px) !important; -webkit-backdrop-filter: blur(6px) !important;
  border-radius: 10px !important; box-shadow: 0 0 0 1px rgba(255,255,255,0.36) inset !important;
}

/* ── Checkboxes ── */
.app-dlg-checks { display: flex; align-items: center; gap: 16px; height: 40px; }
.app-dlg-check { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--sp-gray-700); cursor: pointer; }
.app-dlg-check input[type="checkbox"] { accent-color: var(--sp-primary); width: 16px; height: 16px; cursor: pointer; }

/* ═══════════ Footer ═══════════ */
.app-dlg-foot {
  position: relative; z-index: 2;
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 14px 24px 18px;
  background: rgba(255,255,255,0.34);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  border-top: 1px solid rgba(0,0,0,0.04);
}
.app-dlg-btn {
  padding: 10px 24px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 700; cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}
.app-dlg-btn.cancel {
  background: rgba(255,255,255,0.38); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.40); color: var(--sp-gray-600);
}
.app-dlg-btn.cancel:hover { background: rgba(255,255,255,0.60); }
.app-dlg-btn.primary {
  background: var(--sp-primary); color: #fff;
}
.app-dlg-btn.primary:hover { background: var(--sp-primary-light); }
.app-dlg-btn.primary:disabled { opacity: 0.55; cursor: default; }

/* ═══════════ Transition ═══════════ */
.app-dlg-enter-active { transition: opacity 0.2s ease; }
.app-dlg-enter-active .app-dlg-panel { transition: transform 0.25s cubic-bezier(0.22,0.61,0.36,1), opacity 0.2s ease; }
.app-dlg-leave-active { transition: opacity 0.15s ease; }
.app-dlg-leave-active .app-dlg-panel { transition: transform 0.15s ease, opacity 0.12s ease; }
.app-dlg-enter-from { opacity: 0; }
.app-dlg-enter-from .app-dlg-panel { transform: scale(0.96) translateY(8px); opacity: 0; }
.app-dlg-leave-to { opacity: 0; }
.app-dlg-leave-to .app-dlg-panel { transform: scale(0.97); opacity: 0; }

/* ═══════════ Deep glass overrides for el-select inside dialog ═══════════ */
:deep(.el-select-dropdown) {
  background: rgba(255,255,255,0.58) !important;
  backdrop-filter: blur(22px) saturate(1.2) !important;
  -webkit-backdrop-filter: blur(22px) saturate(1.2) !important;
  border: 1px solid rgba(255,255,255,0.44) !important;
  border-radius: 12px !important;
}
:deep(.el-select-dropdown__item) { background: transparent !important; }
:deep(.el-select-dropdown__item.hover) { background: rgba(239,246,255,0.55) !important; }
</style>
