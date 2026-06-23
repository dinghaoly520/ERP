<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createDialogLeaveGuard } from '@/composables'

const supplierStore = useSupplierStore();
const loading = ref(true)
const error = ref(false)
const dialogVisible = ref(false)
const dialogLoading = ref(false)
const isEdit = ref(false)
const editId = ref('')
const form = ref({ name: '', phone: '', email: '', isPrimary: false })
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
  form.value = { name: '', phone: '', email: '', isPrimary: false }
  formDirty.value = false
  dialogVisible.value = true
}

function openEdit(c: any) {
  isEdit.value = true; editId.value = c.id
  form.value = { name: c.name, phone: c.phone, email: c.email || '', isPrimary: c.isPrimary }
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
    <div class="sp-page-hero-card">
      <div class="sp-page-hero-inner">
        <div class="sp-page-hero-body">
          <h1 class="sp-modern-title">联系人管理</h1>
          <p class="sp-modern-desc">管理您的企业联系人信息，支持添加、编辑和删除。</p>
        </div>
        <div class="sp-page-hero-actions"><el-button type="primary" @click="openAdd"><el-icon><Plus /></el-icon>添加联系人</el-button></div>
      </div>
    </div>

    <div v-if="error" class="sp-error-block">
      <div class="sp-error-icon">⚠</div>
      <div class="sp-error-text">数据加载失败</div>
      <div class="sp-error-desc">网络或服务异常，请稍后重试</div>
      <el-button type="primary" @click="retryLoad">重新加载</el-button>
    </div>
    <div v-else-if="supplierStore.contacts.length>0" class="detail-card" style="overflow:hidden;padding:0">
      <el-table :data="supplierStore.contacts" stripe>
        <el-table-column label="姓名" prop="name" width="160"><template #default="{row}"><div class="contact-name-cell"><el-avatar :size="32" :style="{background:'var(--sp-primary)',fontSize:'13px'}">{{ row.name?.charAt(0) }}</el-avatar><span style="font-weight:700;font-size:14px;color:var(--sp-gray-900)">{{ row.name }}</span></div></template></el-table-column>
        <el-table-column label="手机号" prop="phone" width="160" />
        <el-table-column label="邮箱" prop="email"><template #default="{row}">{{ row.email||'-' }}</template></el-table-column>
        <el-table-column label="主要联系人" width="120" align="center"><template #default="{row}"><el-tag :type="row.isPrimary?'primary':'info'" size="small" effect="plain">{{ row.isPrimary?'主要':'普通' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="160" align="center"><template #default="{row}"><el-button link type="primary" @click="openEdit(row)">编辑</el-button><el-button link type="danger" @click="handleDelete(row.id)">删除</el-button></template></el-table-column>
      </el-table>
    </div>

    <div v-else class="detail-card" style="text-align:center;padding:64px"><el-icon :size="32" color="var(--sp-gray-300)"><Phone /></el-icon><p style="margin-top:12px;font-size:15px;font-weight:700;color:var(--sp-gray-500)">暂无联系人</p><p style="margin-top:4px;font-size:13px;color:var(--sp-gray-400)">请添加企业联系人信息</p></div>

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
.detail-card {
  position: relative;
  background: rgba(255, 255, 255, 0.52);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: var(--sp-radius-md);
  padding: 24px;
}
.detail-card::before {
  content: '';
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  opacity: 0.44; border-radius: inherit;
  background-image:
    radial-gradient(ellipse at 10% 6%, rgba(96, 165, 250, 0.24), transparent 55%),
    radial-gradient(ellipse at 85% 12%, rgba(56, 189, 248, 0.16), transparent 55%),
    radial-gradient(ellipse at 38% 90%, rgba(52, 211, 153, 0.10), transparent 55%);
  animation: glass-glow-drift 18s ease-in-out infinite;
}
.detail-card > * { position: relative; z-index: 1; }
.contact-name-cell { display: flex; align-items: center; gap: 10px; }

/* ═══ Panel (Teleport) ═══ */
.ct-overlay {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: center; justify-content: center; padding: 32px;
  background: rgba(15, 35, 65, 0.10);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.ct-panel {
  position: relative; width: 480px; max-width: 100%; max-height: calc(100vh - 64px);
  display: flex; flex-direction: column; overflow: hidden;
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(28px) saturate(1.25);
  -webkit-backdrop-filter: blur(28px) saturate(1.25);
  border: 1px solid rgba(255, 255, 255, 0.50);
  border-radius: var(--sp-radius-xl);
  box-shadow: 0 4px 8px rgba(15, 35, 65, 0.04), 0 20px 60px rgba(91, 155, 213, 0.14);
}

.ct-panel::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
  opacity: 0.48; border-radius: inherit;
  background-image:
    radial-gradient(ellipse at 15% 8%, rgba(147, 197, 253, 0.28), transparent 55%),
    radial-gradient(ellipse at 85% 14%, rgba(168, 139, 250, 0.16), transparent 55%),
    radial-gradient(ellipse at 40% 88%, rgba(110, 231, 183, 0.10), transparent 55%);
  animation: glass-glow-drift 20s ease-in-out infinite;
}

/* ── Header ── */
.ct-panel-head {
  position: relative; z-index: 2;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 22px 26px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
}

.ct-panel-head-left {
  display: flex; align-items: center; gap: 14px; min-width: 0;
}

.ct-panel-head-icon {
  width: 44px; height: 44px;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, rgba(6, 78, 162, 0.14), rgba(56, 189, 248, 0.10));
  color: var(--sp-primary);
  flex-shrink: 0;
}

.ct-panel-title {
  margin: 0; font-size: 18px; font-weight: 900; color: var(--sp-gray-900);
  letter-spacing: -0.01em;
}

.ct-panel-sub {
  margin: 3px 0 0; font-size: 12px; color: var(--sp-gray-500);
}

.ct-panel-close {
  width: 34px; height: 34px; border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.50);
  color: var(--sp-gray-400); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;
}

.ct-panel-close:hover {
  background: rgba(255, 255, 255, 0.80);
  color: var(--sp-gray-700);
}

/* ── Body ── */
.ct-panel-body {
  position: relative; z-index: 2;
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
  color: var(--sp-gray-500);
  margin-bottom: 12px;
}

.ct-panel-sec-label i {
  color: var(--sp-red);
  font-style: normal; font-weight: 900;
}

.ct-panel-sec-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--sp-primary);
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
  font-size: 13px; font-weight: 700; color: var(--sp-gray-700);
}

.ct-panel-label i {
  font-style: normal; color: var(--sp-red); margin-left: 2px;
}

.ct-panel-label--opt { color: var(--sp-gray-500); font-weight: 600; }

/* ── Custom glass inputs ── */
.ct-panel-input {
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

.ct-panel-input::placeholder { color: var(--sp-gray-300); }

.ct-panel-input:focus {
  border-color: var(--sp-primary);
  box-shadow: 0 0 0 3px rgba(6, 78, 162, 0.08);
  background: rgba(255, 255, 255, 0.38);
}

/* ── Custom toggle switch ── */
.ct-toggle {
  position: relative;
  width: 44px; height: 26px;
  border-radius: 13px;
  border: none;
  background: rgba(0, 0, 0, 0.10);
  cursor: pointer;
  transition: background 0.2s ease;
  padding: 0;
  flex-shrink: 0;
}

.ct-toggle.active {
  background: var(--sp-primary);
}

.ct-toggle-knob {
  position: absolute;
  top: 3px; left: 3px;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: transform 0.2s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.ct-toggle.active .ct-toggle-knob {
  transform: translateX(18px);
}

/* ── Footer ── */
.ct-panel-foot {
  position: relative; z-index: 2;
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 16px 26px;
  border-top: 1px solid rgba(0, 0, 0, 0.04);
  background: rgba(255, 255, 255, 0.34);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.ct-panel-hint {
  font-size: 12px; color: var(--sp-gray-400); font-weight: 600;
}

.ct-panel-hint.ready { color: #047857; }

.ct-panel-foot-actions {
  display: flex; gap: 10px; flex-shrink: 0;
}

.ct-panel-btn-cancel {
  padding: 10px 20px; border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.50);
  color: var(--sp-gray-600);
  font-size: 13px; font-weight: 700; cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}

.ct-panel-btn-cancel:hover {
  background: rgba(255, 255, 255, 0.80);
  color: var(--sp-gray-800);
}

.ct-panel-btn-submit {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 22px; border-radius: 10px; border: none;
  background: rgba(6, 78, 162, 0.30);
  color: rgba(255, 255, 255, 0.60);
  font-size: 13px; font-weight: 700; cursor: not-allowed;
  font-family: inherit;
  transition: all 0.18s;
}

.ct-panel-btn-submit.ready {
  background: linear-gradient(135deg, #064ea2 0%, #0a5eb8 100%);
  color: #fff; cursor: pointer;
  box-shadow: 0 4px 14px rgba(6, 78, 162, 0.30);
}

.ct-panel-btn-submit.ready:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(6, 78, 162, 0.38);
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
</style>
