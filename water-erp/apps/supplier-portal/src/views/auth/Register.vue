<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useAutoSave } from '@/composables'
import { uploadFile } from '@/api/upload'
import dayjs from 'dayjs'

const router = useRouter()
const authStore = useAuthStore()

const currentStep = ref(0)
const loading = ref(false)

// Step 1: Account
const accountForm = reactive({
  username: '',
  displayName: '',
  password: '',
  confirmPassword: '',
  email: '',
})

// Step 2: Company
const companyForm = reactive({
  name: '',
  creditCode: '',
  enterpriseType: '',
  legalPerson: '',
  registeredAddress: '',
  businessScope: '',
})

// Step 3: Contacts & Qualifications
const contacts = ref<any[]>([
  { name: '', phone: '', email: '', isPrimary: true },
])

const qualifications = ref<any[]>([
  { type: '营业执照', name: '', fileUrl: '', validFrom: '', validTo: '' },
])

const showRecovery = ref(false)
const draftSource = computed(() => ({
  currentStep: currentStep.value,
  accountForm: { username: accountForm.username, displayName: accountForm.displayName, email: accountForm.email },
  companyForm: { ...companyForm },
  contacts: contacts.value.map(c => ({ ...c })),
  qualifications: qualifications.value.map(q => ({ ...q })),
}))
const draft = useAutoSave('register', draftSource)
const draftTimeLabel = computed(() => draft.storedAt.value ? dayjs(draft.storedAt.value).format('MM月DD日 HH:mm') : '')
const restored = draft.restoreDraft()
if (restored && (restored.accountForm?.username || restored.companyForm?.name)) { showRecovery.value = true }
function acceptRecovery() {
  const d = draft.restoreDraft(); if (!d) return
  Object.assign(accountForm, d.accountForm); Object.assign(companyForm, d.companyForm)
  contacts.value = d.contacts.map((c: any) => ({ ...c }))
  qualifications.value = d.qualifications.map((q: any) => ({ ...q }))
  currentStep.value = d.currentStep || 0; draft.markClean()
  ElMessage.success('已恢复（密码需重新输入）'); showRecovery.value = false
}
function discardRecovery() { draft.clearDraft(); showRecovery.value = false }

const enterpriseTypes = [
  '国有企业', '民营企业', '合资企业', '外资企业', '股份有限公司', '个体工商户', '其他',
]

const accountRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 4, max: 20, message: '用户名4-20个字符', trigger: 'blur' },
  ],
  displayName: [{ required: true, message: '请输入联系人姓名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码不少于6位', trigger: 'blur' },
  ],
  confirmPassword: [{ required: true, message: '请确认密码', trigger: 'blur' }],
}

const companyRules = {
  name: [{ required: true, message: '请输入企业名称', trigger: 'blur' }],
  creditCode: [
    { required: true, message: '请输入统一社会信用代码', trigger: 'blur' },
    { pattern: /^[0-9A-Z]{18}$/, message: '请输入18位统一社会信用代码', trigger: 'blur' },
  ],
  enterpriseType: [{ required: true, message: '请选择企业类型', trigger: 'change' }],
  legalPerson: [{ required: true, message: '请输入法定代表人', trigger: 'blur' }],
  registeredAddress: [{ required: true, message: '请输入注册地址', trigger: 'blur' }],
  businessScope: [{ required: true, message: '请输入经营范围', trigger: 'blur' }],
}

const accountFormRef = ref()
const companyFormRef = ref()

const steps = [
  { title: '账号信息', icon: 'User' },
  { title: '企业信息', icon: 'OfficeBuilding' },
  { title: '资质材料', icon: 'FolderAdd' },
  { title: '提交审核', icon: 'CircleCheck' },
]

function addContact() {
  contacts.value.push({ name: '', phone: '', email: '', isPrimary: false })
}

function removeContact(index: number) {
  if (contacts.value.length > 1) contacts.value.splice(index, 1)
}

function addQualification() {
  qualifications.value.push({ type: '', name: '', fileUrl: '', validFrom: '', validTo: '' })
}

const uploadRefs: any[] = []
// 真实上传资质文件到 MinIO（此前仅存 file.name 假路径，导致点击查看必 404）。
// 存后端返回的 asset.url；上传失败则清空 fileUrl 并提示，避免提交一个不存在的文件。
async function handleQualFileChange(index: number, e: Event) {
  const input = e.target as HTMLInputElement
  const file = input?.files?.[0]
  if (!file) return
  if (file.size > 50 * 1024 * 1024) { ElMessage.warning('文件不能超过50MB'); return }
  try {
    const asset = await uploadFile(file, 'qualification')
    qualifications.value[index].fileUrl = asset.url
    ElMessage.success(`已上传：${asset.originalName || file.name}`)
  } catch (err: any) {
    qualifications.value[index].fileUrl = ''
    ElMessage.error(err?.message || '资质文件上传失败，请重试')
  }
}

function removeQualification(index: number) {
  if (qualifications.value.length > 1) qualifications.value.splice(index, 1)
}

async function nextStep() {
  if (currentStep.value === 0) {
    const valid = await accountFormRef.value?.validate().catch(() => false)
    if (!valid) return
    if (accountForm.password !== accountForm.confirmPassword) {
      ElMessage.warning('两次输入的密码不一致')
      return
    }
  }
  if (currentStep.value === 1) {
    const valid = await companyFormRef.value?.validate().catch(() => false)
    if (!valid) return
  }
  currentStep.value++
}

function prevStep() {
  if (currentStep.value > 0) currentStep.value--
}

async function submitRegister() {
  loading.value = true
  try {
    const data = {
      username: accountForm.username,
      displayName: accountForm.displayName,
      password: accountForm.password,
      email: accountForm.email || undefined,
      name: companyForm.name,
      creditCode: companyForm.creditCode,
      enterpriseType: companyForm.enterpriseType,
      legalPerson: companyForm.legalPerson,
      registeredAddress: companyForm.registeredAddress,
      businessScope: companyForm.businessScope,
      contacts: contacts.value.map(c => ({
        name: c.name,
        phone: c.phone,
        email: c.email || undefined,
        isPrimary: c.isPrimary,
      })),
      qualifications: qualifications.value.map(q => ({
        type: q.type,
        name: q.name,
        fileUrl: q.fileUrl,
        validFrom: q.validFrom || undefined,
        validTo: q.validTo || undefined,
      })),
    }
    await authStore.register(data)
    draft.clearDraft()
    ElMessage.success('注册成功，正在登录...')
    router.push('/onboarding')
  } catch {
    ElMessage.error('注册失败，请检查信息后重试')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="reg reg--supplier">
    <div class="reg-bg" aria-hidden="true" />

    <!-- Fixed brand mark ─── matching login page -->
    <div class="reg-brand" aria-label="智慧水发 · 蜀水云采">
      <img src="/logo.png" alt="" class="reg-brand-mark" />
      <span class="reg-brand-name">智慧水发 · 蜀水云采</span>
    </div>

    <section class="reg-panel" aria-label="供应商注册表单">
      <div class="reg-card">
        <!-- ── Card Header ── -->
        <div class="reg-head">
          <div class="reg-brand-word">智慧水发<span class="reg-dot">·</span>蜀水云采</div>
          <div class="reg-divider" aria-hidden="true">◆</div>
          <h1 class="reg-title">供应商注册</h1>
          <p class="reg-sub">请填写以下信息完成供应商注册申请</p>
        </div>

        <!-- ── Draft Recovery ── -->
        <Transition name="reg-fade">
          <div v-if="showRecovery" class="reg-recovery">
            <div class="reg-recovery-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <div class="reg-recovery-body">
              <p class="reg-recovery-title">检测到 {{ draftTimeLabel }} 有未完成的注册草稿</p>
              <p class="reg-recovery-hint">您可以继续填写之前的进度，或重新开始新的注册</p>
            </div>
            <div class="reg-recovery-actions">
              <button class="reg-btn reg-btn--ghost" @click="discardRecovery">重新开始</button>
              <button class="reg-btn reg-btn--primary-sm" @click="acceptRecovery">继续填写</button>
            </div>
          </div>
        </Transition>

        <!-- ── Step Indicator ── -->
        <nav class="reg-steps" aria-label="注册进度">
          <div class="reg-steps-track" aria-hidden="true">
            <div
              class="reg-steps-fill"
              :style="{ width: `calc((${currentStep} / ${steps.length - 1}) * (100% - 88px))` }"
            />
          </div>
          <button
            v-for="(step, i) in steps"
            :key="i"
            class="reg-step"
            :class="{ 'is-active': i === currentStep, 'is-done': i < currentStep }"
            :disabled="i > currentStep"
            :aria-current="i === currentStep ? 'step' : undefined"
            @click="i < currentStep && (currentStep = i)"
          >
            <span class="reg-step-dot">
              <svg
                v-if="i < currentStep"
                width="16" height="16" viewBox="0 0 16 16"
                fill="none" stroke="currentColor"
                stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
              >
                <polyline points="3.5,8 6.5,11 12.5,5" />
              </svg>
              <span v-else class="reg-step-num">{{ i + 1 }}</span>
            </span>
            <span class="reg-step-label">{{ step.title }}</span>
          </button>
        </nav>

        <!-- ── Step Content ── -->
        <div class="reg-body">
          <!-- Step 1: Account -->
          <div v-show="currentStep === 0" class="reg-step-pane">
            <el-form
              ref="accountFormRef"
              :model="accountForm"
              :rules="accountRules"
              label-position="top"
              class="reg-form"
              @keyup.enter="nextStep"
            >
              <div class="reg-form-grid">
                <el-form-item label="用户名" prop="username">
                  <el-input v-model="accountForm.username" placeholder="4-20位字符，用于登录系统" />
                </el-form-item>
                <el-form-item label="联系人姓名" prop="displayName">
                  <el-input v-model="accountForm.displayName" placeholder="请输入联系人姓名" />
                </el-form-item>
                <el-form-item label="登录密码" prop="password">
                  <el-input v-model="accountForm.password" type="password" placeholder="不少于6位" show-password />
                </el-form-item>
                <el-form-item label="确认密码" prop="confirmPassword">
                  <el-input v-model="accountForm.confirmPassword" type="password" placeholder="请再次输入密码" show-password />
                </el-form-item>
              </div>
              <el-form-item label="电子邮箱（选填）" prop="email" class="reg-form-wide">
                <el-input v-model="accountForm.email" placeholder="请输入邮箱地址" />
              </el-form-item>
            </el-form>
          </div>

          <!-- Step 2: Company -->
          <div v-show="currentStep === 1" class="reg-step-pane">
            <el-form
              ref="companyFormRef"
              :model="companyForm"
              :rules="companyRules"
              label-position="top"
              class="reg-form"
              @keyup.enter="nextStep"
            >
              <div class="reg-form-grid">
                <el-form-item label="企业名称" prop="name">
                  <el-input v-model="companyForm.name" placeholder="营业执照上的企业全称" />
                </el-form-item>
                <el-form-item label="统一社会信用代码" prop="creditCode">
                  <el-input v-model="companyForm.creditCode" placeholder="18位代码" maxlength="18" />
                </el-form-item>
                <el-form-item label="企业类型" prop="enterpriseType">
                  <el-select v-model="companyForm.enterpriseType" placeholder="请选择企业类型" style="width: 100%">
                    <el-option v-for="t in enterpriseTypes" :key="t" :label="t" :value="t" />
                  </el-select>
                </el-form-item>
                <el-form-item label="法定代表人" prop="legalPerson">
                  <el-input v-model="companyForm.legalPerson" placeholder="请输入法定代表人姓名" />
                </el-form-item>
              </div>
              <el-form-item label="注册地址" prop="registeredAddress" class="reg-form-wide">
                <el-input v-model="companyForm.registeredAddress" placeholder="请输入企业注册地址" />
              </el-form-item>
              <el-form-item label="经营范围" prop="businessScope" class="reg-form-wide">
                <el-input v-model="companyForm.businessScope" type="textarea" :rows="3" placeholder="请输入经营范围" />
              </el-form-item>
            </el-form>
          </div>

          <!-- Step 3: Contacts & Qualifications -->
          <div v-show="currentStep === 2" class="reg-step-pane">
            <!-- Contacts -->
            <section class="reg-block">
              <div class="reg-block-head">
                <h2 class="reg-block-title">联系人信息</h2>
                <button class="reg-btn reg-btn--ghost-sm" @click="addContact">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="2" x2="8" y2="14" /><line x1="2" y1="8" x2="14" y2="8" /></svg>
                  添加联系人
                </button>
              </div>
              <div v-for="(c, i) in contacts" :key="i" class="reg-row">
                <span class="reg-row-idx">{{ i + 1 }}</span>
                <div class="reg-row-fields">
                  <el-input v-model="c.name" placeholder="姓名" size="large" class="reg-row-input" />
                  <el-input v-model="c.phone" placeholder="手机号" size="large" class="reg-row-input" />
                  <el-input v-model="c.email" placeholder="邮箱（选填）" size="large" class="reg-row-input" />
                  <label class="reg-row-switch">
                    <span class="reg-row-switch-label">主要联系人</span>
                    <el-switch v-model="c.isPrimary" size="small" />
                  </label>
                </div>
                <button
                  class="reg-row-remove"
                  :disabled="contacts.length <= 1"
                  @click="removeContact(i)"
                  aria-label="删除联系人"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="8" x2="12" y2="8" /></svg>
                </button>
              </div>
            </section>

            <!-- Qualifications -->
            <section class="reg-block">
              <div class="reg-block-head">
                <h2 class="reg-block-title">资质材料</h2>
                <button class="reg-btn reg-btn--ghost-sm" @click="addQualification">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="2" x2="8" y2="14" /><line x1="2" y1="8" x2="14" y2="8" /></svg>
                  添加资质
                </button>
              </div>
              <div v-for="(q, i) in qualifications" :key="i" class="reg-row">
                <span class="reg-row-idx">{{ i + 1 }}</span>
                <div class="reg-row-fields reg-row-fields--qual">
                  <el-select v-model="q.type" placeholder="资质类型" size="large" class="reg-row-sel">
                    <el-option label="营业执照" value="营业执照" />
                    <el-option label="资质证书" value="资质证书" />
                    <el-option label="安全生产许可证" value="安全生产许可证" />
                    <el-option label="质量管理体系认证" value="质量管理体系认证" />
                    <el-option label="环境管理体系认证" value="环境管理体系认证" />
                    <el-option label="其他" value="其他" />
                  </el-select>
                  <el-input v-model="q.name" placeholder="资质名称" size="large" class="reg-row-input" />
                  <el-date-picker v-model="q.validFrom" type="date" placeholder="有效期起" size="large" value-format="YYYY-MM-DD" class="reg-row-date" />
                  <el-date-picker v-model="q.validTo" type="date" placeholder="有效期止" size="large" value-format="YYYY-MM-DD" class="reg-row-date" />
                  <input
                    type="file"
                    style="display:none"
                    :ref="el => { if (el) uploadRefs[i] = el }"
                    @change="(e: Event) => handleQualFileChange(i, e)"
                    accept=".pdf,.jpg,.jpeg,.png"
                  />
                  <button class="reg-btn reg-btn--file" @click="uploadRefs[i]?.click()">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M14 10v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3"/><polyline points="4.5 5.5 8 2 11.5 5.5"/><line x1="8" y1="2" x2="8" y2="10"/></svg>
                    {{ q.fileUrl || '上传文件' }}
                  </button>
                </div>
                <button
                  class="reg-row-remove"
                  :disabled="qualifications.length <= 1"
                  @click="removeQualification(i)"
                  aria-label="删除资质"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="8" x2="12" y2="8" /></svg>
                </button>
              </div>
            </section>
          </div>

          <!-- Step 4: Review -->
          <div v-show="currentStep === 3" class="reg-step-pane">
            <section class="reg-block">
              <h2 class="reg-block-title" style="margin-bottom:16px">账号信息</h2>
              <dl class="reg-summary">
                <div class="reg-summary-item">
                  <dt>用户名</dt>
                  <dd>{{ accountForm.username || '—' }}</dd>
                </div>
                <div class="reg-summary-item">
                  <dt>联系人</dt>
                  <dd>{{ accountForm.displayName || '—' }}</dd>
                </div>
                <div class="reg-summary-item reg-summary-item--wide">
                  <dt>电子邮箱</dt>
                  <dd>{{ accountForm.email || '未填写' }}</dd>
                </div>
              </dl>
            </section>

            <section class="reg-block">
              <h2 class="reg-block-title" style="margin-bottom:16px">企业基本信息</h2>
              <dl class="reg-summary">
                <div class="reg-summary-item reg-summary-item--wide">
                  <dt>企业名称</dt>
                  <dd>{{ companyForm.name || '—' }}</dd>
                </div>
                <div class="reg-summary-item">
                  <dt>统一社会信用代码</dt>
                  <dd class="reg-mono">{{ companyForm.creditCode || '—' }}</dd>
                </div>
                <div class="reg-summary-item">
                  <dt>企业类型</dt>
                  <dd>{{ companyForm.enterpriseType || '—' }}</dd>
                </div>
                <div class="reg-summary-item">
                  <dt>法定代表人</dt>
                  <dd>{{ companyForm.legalPerson || '—' }}</dd>
                </div>
                <div class="reg-summary-item reg-summary-item--wide">
                  <dt>注册地址</dt>
                  <dd>{{ companyForm.registeredAddress || '—' }}</dd>
                </div>
                <div class="reg-summary-item reg-summary-item--wide">
                  <dt>经营范围</dt>
                  <dd>{{ companyForm.businessScope || '—' }}</dd>
                </div>
              </dl>
            </section>

            <section v-if="contacts.length > 0" class="reg-block">
              <h2 class="reg-block-title" style="margin-bottom:16px">联系人信息</h2>
              <dl class="reg-summary">
                <div v-for="(c, i) in contacts" :key="i" class="reg-summary-item reg-summary-item--wide">
                  <dt>联系人 {{ i + 1 }}{{ c.isPrimary ? ' · 主要' : '' }}</dt>
                  <dd>{{ c.name || '—' }}　{{ c.phone || '' }}{{ c.email ? `　${c.email}` : '' }}</dd>
                </div>
              </dl>
            </section>

            <section v-if="qualifications.length > 0" class="reg-block">
              <h2 class="reg-block-title" style="margin-bottom:16px">资质材料</h2>
              <dl class="reg-summary">
                <div v-for="(q, i) in qualifications" :key="i" class="reg-summary-item reg-summary-item--wide">
                  <dt>{{ q.type || '资质 ' + (i + 1) }}</dt>
                  <dd>
                    {{ q.name || '—' }}
                    <span v-if="q.validFrom || q.validTo" class="reg-mono" style="margin-left:12px">
                      {{ q.validFrom || '…' }} ~ {{ q.validTo || '…' }}
                    </span>
                    <span v-if="q.fileUrl" style="margin-left:12px;color:var(--reg-muted)">{{ q.fileUrl }}</span>
                  </dd>
                </div>
              </dl>
            </section>

            <div class="reg-notice">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>提交注册后，系统将自动进入审核流程。审核通过后您将获得完整的使用权限。</span>
            </div>
          </div>
        </div>

        <!-- ── Actions ── -->
        <div class="reg-actions">
          <button
            v-if="currentStep > 0"
            class="reg-btn reg-btn--back"
            @click="prevStep"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><polyline points="10,3 5,8 10,13" /></svg>
            上一步
          </button>
          <div style="flex:1" />
          <button
            v-if="currentStep < 3"
            class="reg-btn reg-btn--primary"
            @click="nextStep"
          >
            下一步
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:4px"><polyline points="6,3 11,8 6,13" /></svg>
          </button>
          <button
            v-if="currentStep === 3"
            class="reg-btn reg-btn--primary"
            :disabled="loading"
            @click="submitRegister"
          >
            <svg v-if="!loading" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><polyline points="3.5,8 6.5,11 12.5,5" /></svg>
            {{ loading ? '提交中…' : '提交注册申请' }}
          </button>
        </div>

        <!-- ── Footer ── -->
        <div class="reg-foot">
          已有账号？<router-link to="/login">返回登录</router-link>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Serif+SC:wght@500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap');

/* ═══════════════════════════════════════════════
   Brand-blue theme (was mint hue 155 → glass).
   Mirrors Login.vue: neumorphic raised card, concave
   inputs, raised brand primary. No conic edge-flow,
   no brand-word shimmer, no glass backdrop.
   ═══════════════════════════════════════════════ */
.reg {
  --hue: 252;
  --reg-ink: oklch(0.26 0.03 var(--hue));
  --reg-muted: #64748b;
  --reg-line: oklch(0.9 0.02 var(--hue));
  --reg-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --reg-surface: var(--surface, oklch(0.985 0.005 252));
  --reg-tint: oklch(0.975 0.02 var(--hue));
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  isolation: isolate;
  overflow-x: hidden;
  font-family: 'Manrope', 'Microsoft YaHei', sans-serif;
  color: var(--reg-ink);
  background: var(--reg-tint);
}

/* Water-texture atmosphere — tinted brand-blue via --hue (matching login) */
.reg-bg {
  position: fixed;
  inset: 0;
  z-index: -3;
  background-image: url('/bg-hydro-hero-7.png');
  background-position: center;
  background-size: cover;
  filter: saturate(0.7) contrast(0.92) brightness(1.02);
  transform: scale(1.04);
}
.reg::before,
.reg::after {
  position: fixed;
  inset: 0;
  content: '';
  pointer-events: none;
}
.reg::before {
  z-index: -2;
  backdrop-filter: blur(16px) saturate(1.1);
  -webkit-backdrop-filter: blur(16px) saturate(1.1);
  -webkit-mask-image: radial-gradient(ellipse at 50% 42%, transparent 0%, rgba(0,0,0,0.04) 46%, rgba(0,0,0,0.22) 74%, rgba(0,0,0,0.5) 100%);
  mask-image: radial-gradient(ellipse at 50% 42%, transparent 0%, rgba(0,0,0,0.04) 46%, rgba(0,0,0,0.22) 74%, rgba(0,0,0,0.5) 100%);
}
.reg::after {
  z-index: -1;
  background:
    linear-gradient(180deg, transparent 0%, color-mix(in oklch, var(--reg-tint) 6%, transparent) 40%, color-mix(in oklch, var(--reg-tint) 42%, transparent) 74%, color-mix(in oklch, var(--reg-tint) 92%, white) 100%),
    radial-gradient(circle at 50% 30%, color-mix(in oklch, white 22%, transparent), transparent 46%);
}

/* ═══════════════════════════════════════════════
   Brand mark — fixed top-left, matching login
   ═══════════════════════════════════════════════ */
.reg-brand {
  position: fixed;
  top: 26px;
  left: 6vw;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.reg-brand-mark {
  width: 54px;
  height: 54px;
  border-radius: 15px;
  object-fit: cover;
  background: #fff;
  padding: 5px;
  box-sizing: border-box;
  box-shadow: 4px 4px 12px oklch(0.3 0.05 252 / 0.3), -2px -2px 8px oklch(1 0 0 / 0.4);
}
.reg-brand-name {
  font-family: 'Plus Jakarta Sans', 'Microsoft YaHei', sans-serif;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: #fff;
  text-shadow: 0 6px 22px rgba(0, 0, 0, 0.32);
}

/* ═══════════════════════════════════════════════
   Card — neumorphic raised plate, wider for wizard
   (no glass backdrop, no conic edge, no gradient ring border)
   ═══════════════════════════════════════════════ */
.reg-panel {
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 96px 24px 48px;
}
.reg-card {
  position: relative;
  width: min(680px, 100%);
  padding: 48px 40px 40px;
  border-radius: 24px;
  background: linear-gradient(180deg, oklch(0.995 0.01 252), oklch(0.965 0.018 252));
  box-shadow:
    12px 12px 30px oklch(0.42 0.05 252 / 0.16),
    -9px -9px 24px oklch(1 0 0 / 0.92),
    inset 0 1px 0 oklch(1 0 0 / 0.85);
  animation: reg-rise 0.58s var(--reg-ease) backwards;
  transition: transform 0.35s var(--reg-ease), box-shadow 0.35s var(--reg-ease);
}
@keyframes reg-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
.reg-card:hover {
  transform: translateY(-3px);
  box-shadow:
    16px 16px 38px oklch(0.42 0.05 252 / 0.2),
    -11px -11px 28px oklch(1 0 0 / 0.95),
    inset 0 1px 0 oklch(1 0 0 / 0.9);
}

/* ═══════════════════════════════════════════════
   Card header — matching login head style (solid brand word)
   ═══════════════════════════════════════════════ */
.reg-head {
  margin-bottom: 32px;
  text-align: center;
}
.reg-brand-word {
  display: block;
  font-family: 'Plus Jakarta Sans', 'Microsoft YaHei', sans-serif;
  font-size: 34px;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.01em;
  color: var(--brand-deep, oklch(0.42 0.13 252));
  text-align: center;
  margin: 0 -40px;
  padding: 6px 40px;
}
.reg-brand-word .reg-dot {
  font-size: 26px;
  line-height: 1;
  margin: 0 8px;
  opacity: 0.5;
  color: var(--brand, oklch(0.55 0.16 252));
}

.reg-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 168px;
  margin: 18px auto 4px;
  color: oklch(0.55 0.12 var(--hue));
  font-size: 9px;
  line-height: 1;
}
.reg-divider::before,
.reg-divider::after {
  content: '';
  flex: 1;
  height: 1px;
}
.reg-divider::before {
  background: linear-gradient(90deg, transparent, oklch(0.6 0.1 var(--hue)));
  margin-right: 10px;
}
.reg-divider::after {
  background: linear-gradient(270deg, transparent, oklch(0.6 0.1 var(--hue)));
  margin-left: 10px;
}

.reg-title {
  margin: 0;
  font-family: 'Songti SC', 'STSong', 'SimSun', 'Noto Serif SC', 'Source Han Serif SC', serif;
  font-size: 31px;
  font-weight: 600;
  line-height: 1.2;
  color: oklch(0.32 0.05 var(--hue));
  letter-spacing: 0.14em;
}
.reg-sub {
  margin: 8px 0 0;
  font-size: 14px;
  color: oklch(0.5 0.025 var(--hue));
  letter-spacing: 0.03em;
}

/* ═══════════════════════════════════════════════
   Draft recovery (semantic warning surface — mirrors login pending)
   ═══════════════════════════════════════════════ */
.reg-recovery {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  margin-bottom: 28px;
  border-radius: 14px;
  background: color-mix(in oklab, var(--warning, #d97706) 10%, var(--surface, #fff));
  border: 1px solid color-mix(in oklab, var(--warning, #d97706) 32%, transparent);
}
.reg-recovery-icon {
  flex-shrink: 0;
  color: var(--warning, #d97706);
}
.reg-recovery-body { flex: 1; min-width: 0; }
.reg-recovery-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: color-mix(in oklab, var(--warning, #d97706) 55%, #000);
}
.reg-recovery-hint {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--reg-muted);
}
.reg-recovery-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* ═══════════════════════════════════════════════
   Step indicator — concave wells + raised brand nodes
   ═══════════════════════════════════════════════ */
.reg-steps {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 0 24px;
  margin-bottom: 6px;
}
.reg-steps-track {
  position: absolute;
  top: 20px;
  left: calc(24px + 20px);
  right: calc(24px + 20px);
  height: 1px;
  background: oklch(0.9 0.01 var(--hue));
}
.reg-steps-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: oklch(0.5 0.16 var(--hue));
  transition: width 0.45s var(--reg-ease);
}

.reg-step {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
  transition: opacity 0.25s ease;
}
.reg-step:disabled {
  cursor: default;
  opacity: 0.5;
}
.reg-step:not(:disabled):hover .reg-step-label {
  color: oklch(0.4 0.08 var(--hue));
}

.reg-step-dot {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: var(--reg-surface);
  box-shadow: inset 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.14), inset -2px -2px 5px oklch(1 0 0 / 0.8);
  transition: all 0.3s var(--reg-ease);
  flex-shrink: 0;
}
.reg-step.is-active .reg-step-dot {
  color: #fff;
  background: linear-gradient(180deg, oklch(0.55 0.16 252), oklch(0.45 0.15 252));
  box-shadow:
    3px 3px 8px oklch(0.4 0.1 252 / 0.32),
    -2px -2px 6px oklch(1 0 0 / 0.5),
    inset 0 1px 0 oklch(1 0 0 / 0.3),
    0 0 0 6px color-mix(in oklab, var(--brand, oklch(0.55 0.16 252)) 14%, transparent);
}
.reg-step.is-done .reg-step-dot {
  color: #fff;
  background: linear-gradient(180deg, oklch(0.55 0.16 252), oklch(0.45 0.15 252));
  box-shadow: 3px 3px 8px oklch(0.4 0.1 252 / 0.32), -2px -2px 6px oklch(1 0 0 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.3);
}

.reg-step-num {
  font-family: 'Plus Jakarta Sans', 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
  color: oklch(0.45 0.03 var(--hue));
  transition: color 0.3s ease;
}
.reg-step.is-active .reg-step-num,
.reg-step.is-done .reg-step-num {
  color: #fff;
}

.reg-step-label {
  font-size: 12px;
  font-weight: 600;
  color: oklch(0.5 0.02 var(--hue));
  letter-spacing: 0.04em;
  white-space: nowrap;
  transition: color 0.25s ease;
}
.reg-step.is-active .reg-step-label {
  color: oklch(0.42 0.1 var(--hue));
  font-weight: 700;
}

/* ═══════════════════════════════════════════════
   Step content body
   ═══════════════════════════════════════════════ */
.reg-body {
  min-height: 280px;
  padding: 28px 0 8px;
}
.reg-step-pane {
  animation: reg-pane-in 0.35s var(--reg-ease) both;
}
@keyframes reg-pane-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ═══════════════════════════════════════════════
   Form styling — concave neumorphic inputs (mirrors login)
   ═══════════════════════════════════════════════ */
.reg-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 20px;
}

.reg-form :deep(.el-form-item) {
  margin-bottom: 20px;
}
.reg-form :deep(.el-form-item__label) {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: color-mix(in oklch, var(--reg-ink) 82%, #000);
  padding-bottom: 8px;
  line-height: 1;
}
.reg-form :deep(.el-input__wrapper) {
  height: 52px;
  border-radius: 14px;
  background: var(--surface, oklch(0.965 0.012 252));
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.12), inset -3px -3px 7px oklch(1 0 0 / 0.85);
  transition: box-shadow 0.2s var(--reg-ease);
}
.reg-form :deep(.el-input__wrapper:hover) {
  box-shadow: inset 4px 4px 9px oklch(0.55 0.03 258 / 0.14), inset -3px -3px 7px oklch(1 0 0 / 0.9);
}
.reg-form :deep(.el-input__wrapper.is-focus) {
  background: oklch(0.985 0.01 252);
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.14), inset -3px -3px 7px oklch(1 0 0 / 0.9), 0 0 0 3px color-mix(in oklab, var(--brand, oklch(0.55 0.16 252)) 16%, transparent);
}
.reg-form :deep(.el-input__inner) {
  color: var(--reg-ink);
  font-family: inherit;
  font-size: 15px;
}
.reg-form :deep(.el-input__inner::placeholder) {
  color: oklch(0.66 0.02 var(--hue));
}
.reg-form :deep(.el-textarea__inner) {
  border-radius: 14px;
  background: var(--surface, oklch(0.965 0.012 252));
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.12), inset -3px -3px 7px oklch(1 0 0 / 0.85);
  font-family: inherit;
  font-size: 15px;
  color: var(--reg-ink);
  resize: none;
  padding: 12px 14px;
  transition: box-shadow 0.2s var(--reg-ease);
}
.reg-form :deep(.el-textarea__inner:hover) {
  box-shadow: inset 4px 4px 9px oklch(0.55 0.03 258 / 0.14), inset -3px -3px 7px oklch(1 0 0 / 0.9);
}
.reg-form :deep(.el-textarea__inner:focus) {
  background: oklch(0.985 0.01 252);
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.14), inset -3px -3px 7px oklch(1 0 0 / 0.9), 0 0 0 3px color-mix(in oklab, var(--brand, oklch(0.55 0.16 252)) 16%, transparent);
}
.reg-form :deep(.el-select .el-input__wrapper) {
  height: 52px;
}
.reg-form :deep(.el-form-item__error) {
  font-size: 12px;
  padding-top: 4px;
}

/* ═══════════════════════════════════════════════
   Step 3: Contact / Qualification rows
   ═══════════════════════════════════════════════ */
.reg-block {
  margin-bottom: 28px;
}
.reg-block:last-child { margin-bottom: 0; }
.reg-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.reg-block-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: oklch(0.32 0.04 var(--hue));
  letter-spacing: 0.04em;
}

.reg-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-top: 1px solid oklch(0.91 0.012 var(--hue));
}
.reg-row:first-child { border-top: none; padding-top: 0; }
.reg-row-idx {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: oklch(0.5 0.04 var(--hue));
  background: var(--reg-surface);
  box-shadow: inset 1.5px 1.5px 3px oklch(0.55 0.03 258 / 0.12), inset -1.5px -1.5px 3px oklch(1 0 0 / 0.8);
  font-family: 'Plus Jakarta Sans', 'Manrope', sans-serif;
}
.reg-row-fields {
  flex: 1;
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
}
.reg-row-fields--qual {
  flex-wrap: wrap;
}
.reg-row-input { flex: 1; min-width: 0; }
.reg-row-sel { width: 170px; flex-shrink: 0; }
.reg-row-date { width: 152px; flex-shrink: 0; }

.reg-row-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  cursor: pointer;
}
.reg-row-switch-label {
  font-size: 12px;
  color: oklch(0.5 0.02 var(--hue));
  white-space: nowrap;
}

.reg-row-remove {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  border: none;
  background: none;
  color: oklch(0.55 0.03 var(--hue));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}
.reg-row-remove:hover:not(:disabled) {
  color: var(--danger);
  background: color-mix(in oklab, var(--danger) 8%, transparent);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.6);
}
.reg-row-remove:disabled {
  opacity: 0.25;
  cursor: default;
}

/* Step 3 Element Plus overrides — compact concave rows */
.reg-row :deep(.el-input__wrapper) {
  height: 44px !important;
  border-radius: 12px;
  background: var(--surface, oklch(0.965 0.012 252));
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.12), inset -3px -3px 7px oklch(1 0 0 / 0.85);
}
.reg-row :deep(.el-input__wrapper:hover) {
  box-shadow: inset 4px 4px 9px oklch(0.55 0.03 258 / 0.14), inset -3px -3px 7px oklch(1 0 0 / 0.9);
}
.reg-row :deep(.el-input__wrapper.is-focus) {
  background: oklch(0.985 0.01 252);
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.14), inset -3px -3px 7px oklch(1 0 0 / 0.9), 0 0 0 3px color-mix(in oklab, var(--brand, oklch(0.55 0.16 252)) 16%, transparent);
}
.reg-row :deep(.el-select .el-input__wrapper) {
  height: 44px !important;
}
.reg-row :deep(.el-input__inner) { font-size: 14px; }

/* ═══════════════════════════════════════════════
   Step 4: Summary
   ═══════════════════════════════════════════════ */
.reg-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border: 1px solid var(--hairline);
  border-radius: 14px;
  overflow: hidden;
}
.reg-summary-item {
  display: grid;
  grid-template-columns: 120px 1fr;
  padding: 12px 16px;
  border-bottom: 1px solid var(--hairline);
  border-right: 1px solid var(--hairline);
}
.reg-summary-item:nth-child(even) { border-right: none; }
.reg-summary-item--wide {
  grid-column: 1 / -1;
  border-right: none;
}
.reg-summary-item:last-child { border-bottom: none; }
.reg-summary-item dt {
  font-size: 12px;
  font-weight: 600;
  color: oklch(0.5 0.02 var(--hue));
  letter-spacing: 0.04em;
  padding-top: 1px;
}
.reg-summary-item dd {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--reg-ink);
  word-break: break-all;
}
.reg-mono {
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: 13px;
  letter-spacing: 0.02em;
}

.reg-notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 24px;
  padding: 14px 16px;
  border-radius: 14px;
  background: color-mix(in oklab, var(--brand, oklch(0.5 0.16 258)) 7%, transparent);
  border: 1px solid color-mix(in oklab, var(--brand, oklch(0.5 0.16 258)) 18%, transparent);
  font-size: 13px;
  color: var(--brand-deep, oklch(0.42 0.13 252));
  line-height: 1.55;
}

/* ═══════════════════════════════════════════════
   Buttons — raised brand primary / soft plates (no sweep)
   ═══════════════════════════════════════════════ */
.reg-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 28px;
}

.reg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s var(--reg-ease);
  white-space: nowrap;
}
.reg-btn:disabled { cursor: wait; opacity: 0.65; }

/* Primary — raised brand neumorphic button (mirrors login .lp-primary) */
.reg-btn--primary {
  height: 54px;
  padding: 0 32px;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #fff;
  background: linear-gradient(180deg, oklch(0.55 0.16 252), oklch(0.45 0.15 252));
  box-shadow: 4px 4px 12px oklch(0.4 0.1 252 / 0.35), -3px -3px 8px oklch(1 0 0 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.3);
}
.reg-btn--primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 6px 6px 18px oklch(0.4 0.1 252 / 0.42), -3px -3px 8px oklch(1 0 0 / 0.55), inset 0 1px 0 oklch(1 0 0 / 0.35);
}
.reg-btn--primary:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: inset 3px 3px 8px oklch(0.3 0.1 252 / 0.5), inset -2px -2px 6px oklch(0.7 0.1 252 / 0.3);
}

/* Ghost (secondary / small action) — soft plate */
.reg-btn--ghost {
  height: 36px;
  padding: 0 16px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  gap: 6px;
  color: oklch(0.45 0.04 var(--hue));
  background: linear-gradient(180deg, oklch(0.99 0.01 252), oklch(0.96 0.02 252));
  box-shadow: 2px 2px 5px oklch(0.55 0.03 258 / 0.12), -2px -2px 5px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.reg-btn--ghost:hover:not(:disabled) {
  transform: translateY(-1px);
  color: var(--brand, oklch(0.5 0.15 252));
}

.reg-btn--primary-sm {
  height: 36px;
  padding: 0 18px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #fff;
  background: linear-gradient(180deg, oklch(0.55 0.16 252), oklch(0.45 0.15 252));
  box-shadow: 2px 2px 6px oklch(0.4 0.1 252 / 0.3), -2px -2px 4px oklch(1 0 0 / 0.4), inset 0 1px 0 oklch(1 0 0 / 0.3);
}
.reg-btn--primary-sm:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 3px 3px 9px oklch(0.4 0.1 252 / 0.36), -2px -2px 5px oklch(1 0 0 / 0.45), inset 0 1px 0 oklch(1 0 0 / 0.35);
}

.reg-btn--ghost-sm {
  height: 32px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  gap: 5px;
  color: oklch(0.5 0.06 var(--hue));
  background: linear-gradient(180deg, oklch(0.99 0.01 252), oklch(0.96 0.02 252));
  box-shadow: 2px 2px 5px oklch(0.55 0.03 258 / 0.12), -2px -2px 5px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.reg-btn--ghost-sm:hover:not(:disabled) {
  transform: translateY(-1px);
  color: var(--brand, oklch(0.5 0.15 252));
}

/* Back button — soft plate */
.reg-btn--back {
  height: 48px;
  padding: 0 20px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 600;
  gap: 4px;
  color: oklch(0.48 0.03 var(--hue));
  background: linear-gradient(180deg, oklch(0.99 0.01 252), oklch(0.96 0.02 252));
  box-shadow: 3px 3px 8px oklch(0.55 0.03 258 / 0.14), -2px -2px 6px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
.reg-btn--back:hover:not(:disabled) {
  transform: translateY(-1px);
  color: var(--brand, oklch(0.5 0.15 252));
}

/* File upload — concave drop-zone style */
.reg-btn--file {
  height: 44px;
  padding: 0 14px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  gap: 6px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: oklch(0.5 0.06 var(--hue));
  background: var(--surface, oklch(0.965 0.012 252));
  box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.1), inset -2px -2px 4px oklch(1 0 0 / 0.7);
}
.reg-btn--file:hover {
  color: var(--brand, oklch(0.5 0.15 252));
  box-shadow: inset 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.13), inset -2px -2px 4px oklch(1 0 0 / 0.75);
}

/* ═══════════════════════════════════════════════
   Footer
   ═══════════════════════════════════════════════ */
.reg-foot {
  margin-top: 18px;
  text-align: center;
  color: var(--reg-muted);
  font-size: 13px;
}
.reg-foot a {
  color: oklch(0.5 0.13 var(--hue));
  font-weight: 700;
  text-decoration: none;
}
.reg-foot a:hover { text-decoration: underline; }

/* ═══════════════════════════════════════════════
   Transition
   ═══════════════════════════════════════════════ */
.reg-fade-enter-active,
.reg-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.reg-fade-enter-from { opacity: 0; transform: translateY(6px); }
.reg-fade-leave-to { opacity: 0; transform: translateY(-4px); }

/* ═══════════════════════════════════════════════
   Entrance stagger (motion only; no glass)
   ═══════════════════════════════════════════════ */
.reg-head,
.reg-steps,
.reg-body,
.reg-actions,
.reg-foot {
  animation: reg-up 0.5s var(--reg-ease) backwards;
}
.reg-head       { animation-delay: 0.06s; }
.reg-steps      { animation-delay: 0.16s; }
.reg-body       { animation-delay: 0.24s; }
.reg-actions    { animation-delay: 0.32s; }
.reg-foot       { animation-delay: 0.40s; }
@keyframes reg-up {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ═══════════════════════════════════════════════
   Mobile
   ═══════════════════════════════════════════════ */
@media (max-width: 720px) {
  .reg-panel {
    padding: 88px 14px 32px;
  }
  .reg-card {
    padding: 36px 22px 32px;
    border-radius: 22px;
  }
  .reg-brand {
    top: 16px;
    left: 16px;
  }
  .reg-brand-mark {
    width: 40px;
    height: 40px;
    border-radius: 12px;
  }
  .reg-brand-name {
    font-size: 18px;
  }
  .reg-brand-word {
    font-size: 26px;
    margin: 0 -22px;
    padding: 6px 22px;
  }
  .reg-title { font-size: 26px; }

  .reg-steps {
    padding: 0 8px;
  }
  .reg-steps-track {
    left: calc(8px + 16px);
    right: calc(8px + 16px);
  }
  .reg-step-dot {
    width: 32px;
    height: 32px;
  }
  .reg-step-label {
    font-size: 10px;
  }

  .reg-form-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .reg-summary {
    grid-template-columns: 1fr;
  }
  .reg-summary-item {
    border-right: none;
  }
  .reg-summary-item--wide {
    grid-column: 1;
  }

  .reg-row-fields {
    flex-wrap: wrap;
  }
  .reg-row-sel,
  .reg-row-date {
    width: 100%;
    flex: 1;
  }

  .reg-actions {
    flex-wrap: wrap;
  }
  .reg-btn--primary {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reg-card, .reg-head, .reg-steps, .reg-body, .reg-actions, .reg-foot, .reg-step-pane { animation: none; }
  .reg-card:hover, .reg-btn--primary:hover:not(:disabled), .reg-btn--ghost:hover:not(:disabled),
  .reg-btn--ghost-sm:hover:not(:disabled), .reg-btn--back:hover:not(:disabled), .reg-btn--primary-sm:hover:not(:disabled) { transform: none; }
  .reg-steps-fill { transition: none; }
}
</style>
