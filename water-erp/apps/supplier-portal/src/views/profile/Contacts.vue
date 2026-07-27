<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createDialogLeaveGuard } from '@/composables'
import SpPageHero from '@/components/SpPageHero.vue'
import { Contact, AlertTriangle } from 'lucide-vue-next'

const supplierStore = useSupplierStore();
const loading = ref(true)
const error = ref(false)
const dialogVisible = ref(false)
const dialogLoading = ref(false)
const isEdit = ref(false)
const editId = ref('')
const form = ref({ name: '', phone: '', email: '', position: '', isPrimary: false })
const formDirty = ref(false)
const dialogGuard = createDialogLeaveGuard(formDirty)
function markDirty() { formDirty.value = true }
async function closePanel() {
  await dialogGuard(() => { dialogVisible.value = false; formDirty.value = false })
}

onMounted(async () => {
  try { await supplierStore.fetchContacts() } catch { error.value = true } finally { loading.value = false }
})

async function retryLoad() {
  error.value = false; loading.value = true
  try { await supplierStore.fetchContacts() } catch { error.value = true } finally { loading.value = false }
}

function openAdd() {
  isEdit.value = false; editId.value = ''
  form.value = { name: '', phone: '', email: '', position: '', isPrimary: false }
  formDirty.value = false
  dialogVisible.value = true
}

function openEdit(c: any) {
  isEdit.value = true; editId.value = c.id
  form.value = { name: c.name, phone: c.phone, email: c.email || '', position: c.position || '', isPrimary: c.isPrimary }
  formDirty.value = false
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!form.value.name || !form.value.phone) { ElMessage.warning('请填写姓名和手机号'); return }
  if (!/^1[3-9]\d{9}$/.test(form.value.phone)) { ElMessage.warning('请输入正确的11位手机号'); return }
  dialogLoading.value = true
  try {
    if (isEdit.value) {
      await supplierStore.updateContact(editId.value, form.value)
      ElMessage.success('联系人更新成功')
    } else {
      await supplierStore.addContact(form.value)
      ElMessage.success('联系人添加成功')
    }
    dialogVisible.value = false
    formDirty.value = false
  } catch { ElMessage.error(isEdit.value ? '更新失败' : '添加失败') } finally { dialogLoading.value = false }
}

async function handleDelete(id: string) {
  await ElMessageBox.confirm('确定要删除此联系人吗？', '提示', { type: 'warning' })
  try { await supplierStore.deleteContact(id); ElMessage.success('已删除') } catch { ElMessage.error('删除失败') }
}
</script>

<template>
  <div class="page-container" v-loading="loading">
    <SpPageHero :icon="Contact" title="联系人管理" sub="管理您的企业联系人信息，支持添加、编辑和删除。">
      <template #actions>
        <el-button type="primary" @click="openAdd"><el-icon><Plus /></el-icon>添加联系人</el-button>
      </template>
    </SpPageHero>

    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon"><AlertTriangle :size="22" :stroke-width="1.75" /></div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <div v-else-if="supplierStore.contacts.length>0" class="neu-table-card ct-table-wrap">
      <el-table class="neu-table" :data="supplierStore.contacts" stripe>
        <el-table-column label="姓名" prop="name" width="160"><template #default="{row}"><div class="contact-name-cell"><el-avatar :size="32" class="contact-avatar">{{ row.name?.charAt(0) }}</el-avatar><span class="contact-name">{{ row.name }}</span></div></template></el-table-column>
        <el-table-column label="手机号" prop="phone" width="160" />
        <el-table-column label="邮箱" prop="email"><template #default="{row}">{{ row.email||'-' }}</template></el-table-column>
        <el-table-column label="职位" prop="position" width="120"><template #default="{row}">{{ row.position||'-' }}</template></el-table-column>
        <el-table-column label="主要联系人" width="120" align="center"><template #default="{row}"><el-tag :type="row.isPrimary?'primary':'info'" size="small" effect="plain">{{ row.isPrimary?'主要':'普通' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="160" align="center"><template #default="{row}"><el-button link type="primary" @click="openEdit(row)">编辑</el-button><el-button link type="danger" @click="handleDelete(row.id)">删除</el-button></template></el-table-column>
      </el-table>
    </div>

    <div v-else class="detail-card ct-empty">
      <div class="ct-empty-icon"><el-icon :size="28"><Phone /></el-icon></div>
      <p class="ct-empty-title">暂无联系人</p>
      <p class="ct-empty-desc">请添加企业联系人信息</p>
    </div>

    <!-- ═══ Contact Panel (Teleport) ═══ -->
    <Teleport to="body">
      <Transition name="ct-panel">
        <div v-if="dialogVisible" class="ct-overlay" @click.self="closePanel">
          <div class="ct-panel">
            <!-- Header -->
            <div class="ct-panel-head">
              <div class="ct-panel-head-left">
                <div class="ct-panel-head-icon"><el-icon :size="20"><Phone /></el-icon></div>
                <div>
                  <h2 class="ct-panel-title">{{ isEdit ? '编辑联系人' : '添加联系人' }}</h2>
                  <p class="ct-panel-sub">{{ isEdit ? '修改联系人信息后保存' : '填写企业联系人姓名与联系方式' }}</p>
                </div>
              </div>
              <button class="ct-panel-close" @click="closePanel"><el-icon :size="18"><Close /></el-icon></button>
            </div>

            <!-- Body -->
            <div class="ct-panel-body">
              <div class="ct-panel-sec">
                <div class="ct-panel-sec-label"><span class="ct-panel-sec-dot"></span>基本信息</div>
                <div class="ct-panel-row">
                  <div class="ct-panel-field">
                    <label class="ct-panel-label">姓名 <i>*</i></label>
                    <input class="ct-panel-input" v-model="form.name" placeholder="请输入姓名" maxlength="20" @input="markDirty" />
                  </div>
                  <div class="ct-panel-field">
                    <label class="ct-panel-label">手机号 <i>*</i></label>
                    <input class="ct-panel-input" v-model="form.phone" placeholder="请输入11位手机号" maxlength="11" @input="markDirty" />
                  </div>
                </div>
                <div class="ct-panel-row" style="margin-top:14px">
                  <div class="ct-panel-field">
                    <label class="ct-panel-label ct-panel-label--opt">邮箱</label>
                    <input class="ct-panel-input" v-model="form.email" placeholder="请输入邮箱（选填）" @input="markDirty" />
                  </div>
                  <div class="ct-panel-field">
                    <label class="ct-panel-label ct-panel-label--opt">职位/职务</label>
                    <input class="ct-panel-input" v-model="form.position" placeholder="请输入职位/职务" maxlength="50" @input="markDirty" />
                  </div>
                </div>
                <div class="ct-panel-row" style="margin-top:14px">
                  <div class="ct-panel-field ct-panel-field--toggle">
                    <label class="ct-panel-label ct-panel-label--opt">主要联系人</label>
                    <button
                      type="button"
                      class="ct-toggle"
                      :class="{ active: form.isPrimary }"
                      @click="form.isPrimary = !form.isPrimary; markDirty()"
                    >
                      <span class="ct-toggle-knob"></span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Footer -->
            <div class="ct-panel-foot">
              <span class="ct-panel-hint" v-if="!form.name && !form.phone">请填写联系人信息</span>
              <span class="ct-panel-hint ready" v-else>信息已就绪</span>
              <div class="ct-panel-foot-actions">
                <button class="ct-panel-btn-cancel" @click="closePanel">取消</button>
                <button
                  class="ct-panel-btn-submit"
                  :class="{ ready: form.name && form.phone && !dialogLoading }"
                  :disabled="!form.name || !form.phone || dialogLoading"
                  @click="handleSubmit"
                >
                  <span v-if="dialogLoading">保存中…</span>
                  <template v-else>
                    <el-icon :size="15"><ArrowRight /></el-icon>
                    <span>{{ isEdit ? '保存' : '确认添加' }}</span>
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
/* ═══ Surfaces — neumorphic plates (no glass / no drift) ═══ */
.detail-card {
  position: relative;
  border-radius: 16px;
  padding: 24px;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: 5px 5px 12px oklch(0.55 0.03 258 / 0.09), -4px -4px 10px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.ct-table-wrap { margin-top: 16px; }
.contact-name-cell { display: flex; align-items: center; gap: 10px; }
.contact-avatar { background: var(--brand); font-size: 13px; }
.contact-name { font-weight: 700; font-size: 14px; color: var(--foreground); }

/* ── Empty state ── */
.ct-empty { text-align: center; padding: 64px 24px; margin-top: 16px; }
.ct-empty-icon { color: var(--muted-foreground); margin-bottom: 8px; }
.ct-empty-title { margin: 12px 0 4px; font-size: 15px; font-weight: 700; color: var(--muted-foreground); }
.ct-empty-desc { margin: 0; font-size: 13px; color: var(--muted-foreground); }

/* ═══ Panel (Teleport — neumorphic) ═══ */
.ct-overlay {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: center; justify-content: center; padding: 32px;
  background: oklch(0.35 0.06 258 / 0.28);
}

.ct-panel {
  position: relative; width: 480px; max-width: 100%; max-height: calc(100vh - 64px);
  display: flex; flex-direction: column; overflow: hidden;
  border: none; border-radius: 20px;
  background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.75), 0 20px 60px oklch(0.3 0.05 258 / 0.18);
}

/* ── Header ── */
.ct-panel-head {
  position: relative;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 22px 26px 16px;
  border-bottom: 1px solid var(--hairline);
}

.ct-panel-head-left {
  display: flex; align-items: center; gap: 14px; min-width: 0;
}

.ct-panel-head-icon {
  width: 44px; height: 44px;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: oklch(0.985 0.005 258);
  color: var(--brand);
  box-shadow: inset 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.14), inset -2px -2px 5px oklch(1 0 0 / 0.75);
  flex-shrink: 0;
}

.ct-panel-title {
  margin: 0; font-size: 18px; font-weight: 900; color: var(--foreground);
  letter-spacing: -0.01em;
}

.ct-panel-sub {
  margin: 3px 0 0; font-size: 12px; color: var(--muted-foreground);
}

.ct-panel-close {
  width: 34px; height: 34px; border-radius: 10px;
  border: none;
  background: var(--surface);
  color: var(--muted-foreground); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85);
  transition: all 0.15s;
}

.ct-panel-close:hover {
  color: var(--brand); transform: translateY(-1px);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9);
}

/* ── Body ── */
.ct-panel-body {
  position: relative;
  flex: 1; overflow-y: auto;
  padding: 18px 26px;
}

/* ── Section ── */
.ct-panel-sec {
  margin-bottom: 4px;
}

.ct-panel-sec-label {
  display: flex; align-items: center; gap: 7px;
  font-size: 11px; font-weight: 800;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted-foreground);
  margin-bottom: 12px;
}

.ct-panel-sec-label i {
  color: var(--danger);
  font-style: normal; font-weight: 900;
}

.ct-panel-sec-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--brand);
}

/* ── Row ── */
.ct-panel-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 440px) {
  .ct-panel-row { grid-template-columns: 1fr; }
}

/* ── Field ── */
.ct-panel-field {
  display: flex; flex-direction: column; gap: 7px;
}

.ct-panel-field--toggle {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.ct-panel-field--toggle .ct-panel-label {
  margin-bottom: 0;
}

.ct-panel-label {
  font-size: 13px; font-weight: 700; color: var(--foreground);
}

.ct-panel-label i {
  font-style: normal; color: var(--danger); margin-left: 2px;
}

.ct-panel-label--opt { color: var(--muted-foreground); font-weight: 600; }

/* ── Concave inputs ── */
.ct-panel-input {
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

.ct-panel-input::placeholder { color: oklch(0.74 0.02 258); }

.ct-panel-input:focus {
  border-color: oklch(0.5 0.16 258 / 0.5);
  box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.08), inset -2px -2px 4px oklch(1 0 0 / 0.5), 0 0 0 3px oklch(0.5 0.16 258 / 0.08);
}

/* ── Toggle switch (concave track + raised knob) ── */
.ct-toggle {
  position: relative;
  width: 44px; height: 26px;
  border-radius: 13px;
  border: none;
  background: oklch(0.94 0.01 258);
  cursor: pointer;
  transition: background 0.2s ease, box-shadow 0.2s ease;
  padding: 0;
  flex-shrink: 0;
  box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 4px oklch(1 0 0 / 0.7);
}

.ct-toggle.active {
  background: var(--brand);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.25), 2px 2px 5px oklch(0.4 0.1 258 / 0.25);
}

.ct-toggle-knob {
  position: absolute;
  top: 3px; left: 3px;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 1px 1px 3px oklch(0.55 0.03 258 / 0.25);
  transition: transform 0.2s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.ct-toggle.active .ct-toggle-knob {
  transform: translateX(18px);
}

/* ── Footer ── */
.ct-panel-foot {
  position: relative;
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 16px 26px;
  border-top: 1px solid var(--hairline);
  background: oklch(1 0 0 / 0.3);
}

.ct-panel-hint {
  font-size: 12px; color: var(--muted-foreground); font-weight: 600;
}

.ct-panel-hint.ready { color: var(--success); }

.ct-panel-foot-actions {
  display: flex; gap: 10px; flex-shrink: 0;
}

.ct-panel-btn-cancel {
  padding: 10px 20px; border-radius: 9px;
  border: none;
  background: var(--surface);
  color: var(--foreground);
  font-size: 13px; font-weight: 700; cursor: pointer;
  font-family: inherit;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85);
  transition: all 0.15s;
}

.ct-panel-btn-cancel:hover {
  color: var(--brand); transform: translateY(-1px);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 6px oklch(0.55 0.03 258 / 0.14), -2px -2px 5px oklch(1 0 0 / 0.9);
}

.ct-panel-btn-submit {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 22px; border-radius: 9px; border: none;
  background: var(--brand);
  color: #fff;
  font-size: 13px; font-weight: 700; cursor: pointer;
  font-family: inherit;
  box-shadow: 3px 3px 6px oklch(0.5 0.08 258 / 0.25), -2px -2px 5px oklch(1 0 0 / 0.5);
  transition: all 0.18s;
}

.ct-panel-btn-submit:disabled {
  opacity: 0.55; cursor: not-allowed; transform: none;
  box-shadow: 2px 2px 4px oklch(0.5 0.05 258 / 0.15), -1px -1px 3px oklch(1 0 0 / 0.4);
}

.ct-panel-btn-submit.ready:hover {
  background: var(--brand-deep); transform: translateY(-1px);
  box-shadow: 4px 4px 10px oklch(0.45 0.08 258 / 0.28), -2px -2px 6px oklch(1 0 0 / 0.55);
}

/* ── Transitions ── */
.ct-panel-enter-active, .ct-panel-leave-active { transition: opacity 0.22s ease; }
.ct-panel-enter-active .ct-panel, .ct-panel-leave-active .ct-panel {
  transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.22s ease;
}
.ct-panel-enter-from, .ct-panel-leave-to { opacity: 0; }
.ct-panel-enter-from .ct-panel, .ct-panel-leave-to .ct-panel {
  transform: scale(0.96) translateY(12px); opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .ct-panel-close, .ct-panel-btn-cancel, .ct-panel-btn-submit, .ct-toggle, .ct-toggle-knob {
    transition: none;
  }
}
</style>
