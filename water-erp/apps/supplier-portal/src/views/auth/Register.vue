<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useAutoSave } from '@/composables'
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
function handleQualFileChange(index: number, e: Event) {
  const input = e.target as HTMLInputElement
  const file = input?.files?.[0]
  if (!file) return
  if (file.size > 50 * 1024 * 1024) { ElMessage.warning('文件不能超过50MB'); return }
  qualifications.value[index].fileUrl = file.name
  ElMessage.success(`已选择：${file.name}（注册后可在资质管理中补充）`)
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

@property --reg-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

/* ═══════════════════════════════════════════════
   Root tokens
   ═══════════════════════════════════════════════ */
.reg {
  --hue: 155;
  --reg-ink: oklch(0.26 0.025 var(--hue));
  --reg-muted: #6b787e;
  --reg-line: oklch(0.93 0.015 var(--hue));
  --reg-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --reg-surface: rgba(255, 255, 255, 0.72);
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

/* ═══════════════════════════════════════════════
   Background — matching login page
   ═══════════════════════════════════════════════ */
.reg-bg {
  position: fixed;
  inset: 0;
  z-index: -3;
  background-image: url('/bg-hydro-hero-7.png');
  background-position: center;
  background-size: cover;
  filter: saturate(0.8) contrast(0.92) brightness(1.05);
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
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
}
.reg::after {
  z-index: -1;
  background:
    radial-gradient(ellipse at 50% 40%, color-mix(in oklch, white 18%, transparent), transparent 58%),
    linear-gradient(180deg, rgba(3, 30, 40, 0.06), transparent 42%, color-mix(in oklch, var(--reg-tint) 30%, transparent) 100%);
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
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 8px 20px rgba(20, 40, 50, 0.22);
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
   Card — glass morphism, wider for wizard
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
  border-radius: 32px;
  background:
    radial-gradient(circle at 92% 0%, color-mix(in oklch, oklch(0.93 0.055 var(--hue)) 42%, transparent), transparent 38%),
    radial-gradient(circle at 4% 96%, color-mix(in oklch, oklch(0.93 0.045 calc(var(--hue) + 80)) 36%, transparent), transparent 36%),
    linear-gradient(160deg, rgba(255, 255, 255, 0.86), rgba(255, 255, 255, 0.68));
  backdrop-filter: blur(30px) saturate(1.5);
  -webkit-backdrop-filter: blur(30px) saturate(1.5);
  box-shadow:
    0 38px 94px -20px color-mix(in oklch, oklch(0.26 0.06 var(--hue)) 52%, transparent),
    0 18px 40px -10px color-mix(in oklch, oklch(0.22 0.05 var(--hue)) 40%, transparent),
    0 0 66px -8px color-mix(in oklch, oklch(0.74 0.1 var(--hue)) 24%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.96);
  animation: reg-rise 0.58s var(--reg-ease) backwards;
  transition: box-shadow 0.35s var(--reg-ease);
}
@keyframes reg-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Conic border — matching login card animation */
.reg-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1.2px;
  pointer-events: none;
  background: linear-gradient(
    135deg,
    color-mix(in oklch, oklch(0.9 0.06 var(--hue)) 78%, white),
    rgba(255, 255, 255, 0.72) 46%,
    color-mix(in oklch, oklch(0.9 0.05 calc(var(--hue) + 90)) 70%, white)
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
.reg-card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1.4px;
  pointer-events: none;
  background: conic-gradient(
    from var(--reg-angle, 0deg),
    transparent 0%,
    color-mix(in oklch, oklch(0.82 0.14 var(--hue)) 36%, transparent) 6%,
    color-mix(in oklch, white 55%, transparent) 12%,
    color-mix(in oklch, oklch(0.82 0.14 var(--hue)) 36%, transparent) 19%,
    transparent 28%,
    transparent 100%
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0.85;
  animation: reg-edge-flow 10s linear infinite;
}
@keyframes reg-edge-flow {
  to { --reg-angle: 360deg; }
}
@media (prefers-reduced-motion: reduce) {
  .reg-card::after { animation: none; }
}

/* ═══════════════════════════════════════════════
   Card header — matching login head style
   ═══════════════════════════════════════════════ */
.reg-head {
  margin-bottom: 32px;
  text-align: center;
}
.reg-brand-word {
  position: relative;
  display: block;
  font-family: 'Plus Jakarta Sans', 'Microsoft YaHei', sans-serif;
  font-size: 34px;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.01em;
  background: linear-gradient(
    90deg,
    oklch(0.96 0.01 var(--hue)) 0%,
    oklch(0.84 0.06 calc(var(--hue) + 20)) 20%,
    oklch(0.88 0.05 calc(var(--hue) - 10)) 40%,
    oklch(0.84 0.04 calc(var(--hue) + 60)) 60%,
    oklch(0.86 0.06 calc(var(--hue) + 20)) 80%,
    oklch(0.96 0.01 var(--hue)) 100%
  );
  background-size: 300% 100%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  text-align: center;
  margin: 0 -40px;
  padding: 6px 40px;
  animation: reg-brand-shimmer 8s linear infinite;
}
.reg-brand-word::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: radial-gradient(
    ellipse 72% 150% at center,
    color-mix(in oklch, oklch(0.34 0.15 var(--hue)) 58%, transparent) 0%,
    color-mix(in oklch, oklch(0.34 0.15 var(--hue)) 24%, transparent) 42%,
    transparent 72%
  );
}
.reg-brand-word .reg-dot {
  font-size: 24px;
  line-height: 1;
  margin: 0 8px;
  opacity: 0.45;
  -webkit-text-fill-color: var(--reg-ink);
  color: var(--reg-ink);
}
@keyframes reg-brand-shimmer {
  0% { background-position: 0% center; }
  100% { background-position: 300% center; }
}

.reg-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 148px;
  margin: 16px auto 4px;
  color: oklch(0.5 0.1 var(--hue));
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
  background: linear-gradient(90deg, transparent, oklch(0.5 0.09 var(--hue)));
  margin-right: 10px;
}
.reg-divider::after {
  background: linear-gradient(270deg, transparent, oklch(0.5 0.09 var(--hue)));
  margin-left: 10px;
}

.reg-title {
  margin: 0;
  font-family: 'Songti SC', 'STSong', 'SimSun', 'Noto Serif SC', 'Source Han Serif SC', serif;
  font-size: 31px;
  font-weight: 600;
  line-height: 1.2;
  color: oklch(0.3 0.04 var(--hue));
  letter-spacing: 0.14em;
}
.reg-sub {
  margin: 8px 0 0;
  font-size: 14px;
  color: oklch(0.5 0.025 var(--hue));
  letter-spacing: 0.03em;
}

/* ═══════════════════════════════════════════════
   Draft recovery
   ═══════════════════════════════════════════════ */
.reg-recovery {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  margin-bottom: 28px;
  border-radius: 16px;
  background: oklch(0.94 0.04 calc(var(--hue) + 40));
  border: 1px solid oklch(0.85 0.06 calc(var(--hue) + 40));
}
.reg-recovery-icon {
  flex-shrink: 0;
  color: oklch(0.5 0.08 calc(var(--hue) + 40));
}
.reg-recovery-body { flex: 1; min-width: 0; }
.reg-recovery-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: oklch(0.35 0.04 calc(var(--hue) + 40));
}
.reg-recovery-hint {
  margin: 2px 0 0;
  font-size: 12px;
  color: oklch(0.45 0.03 calc(var(--hue) + 40));
}
.reg-recovery-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* ═══════════════════════════════════════════════
   Step indicator — custom, numbered circles
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
  background: oklch(0.55 0.12 var(--hue));
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
  background: var(--reg-surface);
  border: 1.5px solid oklch(0.88 0.015 var(--hue));
  transition: all 0.3s var(--reg-ease);
  flex-shrink: 0;
}
.reg-step.is-active .reg-step-dot {
  background: oklch(0.55 0.12 var(--hue));
  border-color: oklch(0.55 0.12 var(--hue));
  color: #fff;
  box-shadow: 0 0 0 6px color-mix(in oklch, oklch(0.62 0.14 var(--hue)) 18%, transparent);
}
.reg-step.is-done .reg-step-dot {
  background: oklch(0.55 0.12 var(--hue));
  border-color: oklch(0.55 0.12 var(--hue));
  color: #fff;
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
   Form styling — deep overrides of Element Plus
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
  font-weight: 700;
  letter-spacing: 0.05em;
  color: color-mix(in oklch, var(--reg-ink) 82%, #000);
  padding-bottom: 8px;
  line-height: 1;
}
.reg-form :deep(.el-input__wrapper) {
  height: 52px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.58);
  box-shadow: 0 0 0 1px var(--reg-line) inset;
  transition: box-shadow 0.2s var(--reg-ease), background 0.2s var(--reg-ease);
}
.reg-form :deep(.el-input__wrapper:hover) {
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 0 0 1px oklch(0.7 0.06 var(--hue)) inset;
}
.reg-form :deep(.el-input__wrapper.is-focus) {
  background: #fff;
  box-shadow: 0 0 0 1px oklch(0.66 0.08 var(--hue)) inset,
    0 0 0 4px color-mix(in oklch, oklch(0.78 0.08 var(--hue)) 16%, transparent);
}
.reg-form :deep(.el-input__inner) {
  color: var(--reg-ink);
  font-family: inherit;
  font-size: 15px;
}
.reg-form :deep(.el-input__inner::placeholder) {
  color: oklch(0.66 0.015 var(--hue));
}
.reg-form :deep(.el-textarea__inner) {
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.58);
  box-shadow: 0 0 0 1px var(--reg-line) inset;
  font-family: inherit;
  font-size: 15px;
  color: var(--reg-ink);
  resize: none;
  padding: 12px 14px;
  transition: box-shadow 0.2s var(--reg-ease), background 0.2s var(--reg-ease);
}
.reg-form :deep(.el-textarea__inner:hover) {
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 0 0 1px oklch(0.7 0.06 var(--hue)) inset;
}
.reg-form :deep(.el-textarea__inner:focus) {
  background: #fff;
  box-shadow: 0 0 0 1px oklch(0.66 0.08 var(--hue)) inset,
    0 0 0 4px color-mix(in oklch, oklch(0.78 0.08 var(--hue)) 16%, transparent);
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
  background: oklch(0.94 0.015 var(--hue));
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
  border: 1px solid transparent;
  background: none;
  color: oklch(0.55 0.03 var(--hue));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}
.reg-row-remove:hover:not(:disabled) {
  background: oklch(0.93 0.03 calc(var(--hue) + 200));
  color: oklch(0.45 0.18 calc(var(--hue) + 200));
  border-color: oklch(0.85 0.08 calc(var(--hue) + 200));
}
.reg-row-remove:disabled {
  opacity: 0.25;
  cursor: default;
}

/* Step 3 Element Plus overrides for compact rows */
.reg-row :deep(.el-input__wrapper) {
  height: 44px !important;
  border-radius: 12px;
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
  border: 1px solid oklch(0.9 0.01 var(--hue));
  border-radius: 14px;
  overflow: hidden;
}
.reg-summary-item {
  display: grid;
  grid-template-columns: 120px 1fr;
  padding: 12px 16px;
  border-bottom: 1px solid oklch(0.93 0.008 var(--hue));
  border-right: 1px solid oklch(0.93 0.008 var(--hue));
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
  background: oklch(0.94 0.025 var(--hue));
  border: 1px solid oklch(0.88 0.04 var(--hue));
  font-size: 13px;
  color: oklch(0.42 0.06 var(--hue));
  line-height: 1.55;
}

/* ═══════════════════════════════════════════════
   Buttons
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

/* Primary */
.reg-btn--primary {
  height: 54px;
  padding: 0 32px;
  border-radius: 15px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: oklch(0.32 0.07 var(--hue));
  background: linear-gradient(
    135deg,
    oklch(0.93 0.055 var(--hue)),
    oklch(0.91 0.048 calc(var(--hue) + 24))
  );
  border: 1px solid color-mix(in oklch, oklch(0.8 0.06 var(--hue)) 50%, white);
  box-shadow:
    0 10px 24px color-mix(in oklch, oklch(0.5 0.05 var(--hue)) 14%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.65);
  position: relative;
  overflow: hidden;
}
.reg-btn--primary::after {
  content: '';
  position: absolute;
  top: 0;
  left: -130%;
  width: 55%;
  height: 100%;
  background: linear-gradient(120deg, transparent, rgba(255, 255, 255, 0.55), transparent);
  transform: skewX(-18deg);
  pointer-events: none;
  transition: left 0.65s var(--reg-ease);
}
.reg-btn--primary:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: brightness(1.03);
  box-shadow:
    0 14px 30px color-mix(in oklch, oklch(0.5 0.06 var(--hue)) 20%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.65);
}
.reg-btn--primary:hover:not(:disabled)::after { left: 130%; }

/* Ghost (secondary / small action) */
.reg-btn--ghost {
  height: 36px;
  padding: 0 16px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  color: oklch(0.45 0.04 var(--hue));
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid oklch(0.9 0.01 var(--hue));
  gap: 6px;
}
.reg-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.8);
  border-color: oklch(0.75 0.06 var(--hue));
}

.reg-btn--primary-sm {
  height: 36px;
  padding: 0 18px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #fff;
  background: oklch(0.52 0.12 var(--hue));
  border: 1px solid oklch(0.52 0.12 var(--hue));
}
.reg-btn--primary-sm:hover {
  background: oklch(0.46 0.13 var(--hue));
}

.reg-btn--ghost-sm {
  height: 32px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  color: oklch(0.5 0.06 var(--hue));
  background: transparent;
  border: 1px solid oklch(0.9 0.015 var(--hue));
  gap: 5px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s ease;
}
.reg-btn--ghost-sm:hover {
  background: oklch(0.95 0.02 var(--hue));
  border-color: oklch(0.72 0.08 var(--hue));
  color: oklch(0.42 0.1 var(--hue));
}

/* Back button */
.reg-btn--back {
  height: 48px;
  padding: 0 20px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 600;
  color: oklch(0.48 0.03 var(--hue));
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid oklch(0.9 0.012 var(--hue));
  gap: 4px;
}
.reg-btn--back:hover {
  background: rgba(255, 255, 255, 0.75);
  border-color: oklch(0.72 0.06 var(--hue));
  color: oklch(0.38 0.06 var(--hue));
}

/* File upload */
.reg-btn--file {
  height: 44px;
  padding: 0 14px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  color: oklch(0.5 0.06 var(--hue));
  background: rgba(255, 255, 255, 0.55);
  border: 1px dashed oklch(0.82 0.04 var(--hue));
  gap: 6px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reg-btn--file:hover {
  background: rgba(255, 255, 255, 0.8);
  border-color: oklch(0.66 0.09 var(--hue));
  border-style: solid;
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
  color: oklch(0.42 0.08 var(--hue));
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
   Entrance stagger
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
    border-radius: 26px;
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
</style>
