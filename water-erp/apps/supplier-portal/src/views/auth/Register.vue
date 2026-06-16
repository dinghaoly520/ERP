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
  <div class="register-page">
    <div class="register-container">
      <!-- Header -->
      <div class="register-header">
        <div class="register-brand">
          <img src="/logo.png" alt="智慧水发 · 蜀水云采" class="register-logo" />
          <div class="register-brand-text">
            <strong class="register-brand-name">智慧水发 · 蜀水云采</strong>
            <small class="register-brand-en">SICHUAN WATER DEVELOPMENT GROUP</small>
          </div>
        </div>
        <router-link to="/login" class="back-link">
          <el-icon><ArrowLeft /></el-icon>返回登录
        </router-link>
        <h1 class="register-title">供应商注册</h1>
        <p class="register-desc">请填写以下信息完成供应商注册申请</p>
      </div>

      <el-alert v-if="showRecovery" type="warning" :closable="false" show-icon style="margin-bottom:20px"><template #title>检测到 {{ draftTimeLabel }} 有未完成的注册</template><template #default><div style="margin-top:8px;display:flex;gap:12px"><el-button size="small" type="primary" @click="acceptRecovery">继续填写</el-button><el-button size="small" @click="discardRecovery">重新开始</el-button></div></template></el-alert>

      <!-- Steps indicator -->
      <el-steps :active="currentStep" finish-status="success" align-center class="register-steps">
        <el-step v-for="(step, i) in steps" :key="i" :title="step.title" :icon="step.icon" />
      </el-steps>

      <!-- Step 1: Account -->
      <div v-show="currentStep === 0" class="step-content sp-slide-up">
        <div class="sp-card">
          <div class="sp-card-header">
            <span class="sp-card-title">账号信息</span>
          </div>
          <el-form ref="accountFormRef" :model="accountForm" :rules="accountRules" label-width="120px" size="large">
            <el-row :gutter="24">
              <el-col :span="12">
                <el-form-item label="用户名" prop="username">
                  <el-input v-model="accountForm.username" placeholder="请输入登录用户名" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="联系人" prop="displayName">
                  <el-input v-model="accountForm.displayName" placeholder="请输入联系人姓名" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="24">
              <el-col :span="12">
                <el-form-item label="登录密码" prop="password">
                  <el-input v-model="accountForm.password" type="password" placeholder="请设置密码（不少于6位）" show-password />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="确认密码" prop="confirmPassword">
                  <el-input v-model="accountForm.confirmPassword" type="password" placeholder="请再次输入密码" show-password />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="电子邮箱">
              <el-input v-model="accountForm.email" placeholder="请输入邮箱地址（选填）" />
            </el-form-item>
          </el-form>
        </div>
      </div>

      <!-- Step 2: Company -->
      <div v-show="currentStep === 1" class="step-content sp-slide-up">
        <div class="sp-card">
          <div class="sp-card-header">
            <span class="sp-card-title">企业基本信息</span>
          </div>
          <el-form ref="companyFormRef" :model="companyForm" :rules="companyRules" label-width="140px" size="large">
            <el-row :gutter="24">
              <el-col :span="12">
                <el-form-item label="企业名称" prop="name">
                  <el-input v-model="companyForm.name" placeholder="请输入营业执照上的企业全称" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="统一社会信用代码" prop="creditCode">
                  <el-input v-model="companyForm.creditCode" placeholder="18位统一社会信用代码" maxlength="18" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="24">
              <el-col :span="12">
                <el-form-item label="企业类型" prop="enterpriseType">
                  <el-select v-model="companyForm.enterpriseType" placeholder="请选择企业类型" style="width: 100%">
                    <el-option v-for="t in enterpriseTypes" :key="t" :label="t" :value="t" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="法定代表人" prop="legalPerson">
                  <el-input v-model="companyForm.legalPerson" placeholder="请输入法定代表人姓名" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="注册地址" prop="registeredAddress">
              <el-input v-model="companyForm.registeredAddress" placeholder="请输入企业注册地址" />
            </el-form-item>
            <el-form-item label="经营范围" prop="businessScope">
              <el-input v-model="companyForm.businessScope" type="textarea" :rows="3" placeholder="请输入经营范围" />
            </el-form-item>
          </el-form>
        </div>
      </div>

      <!-- Step 3: Contacts & Qualifications -->
      <div v-show="currentStep === 2" class="step-content sp-slide-up">
        <!-- Contacts -->
        <div class="sp-card">
          <div class="sp-card-header">
            <span class="sp-card-title">联系人信息</span>
            <el-button type="primary" size="small" @click="addContact">
              <el-icon><Plus /></el-icon>添加联系人
            </el-button>
          </div>
          <div v-for="(c, i) in contacts" :key="i" class="contact-row">
            <el-row :gutter="16">
              <el-col :span="6">
                <el-input v-model="c.name" placeholder="姓名" size="large" />
              </el-col>
              <el-col :span="6">
                <el-input v-model="c.phone" placeholder="手机号" size="large" />
              </el-col>
              <el-col :span="6">
                <el-input v-model="c.email" placeholder="邮箱（选填）" size="large" />
              </el-col>
              <el-col :span="4">
                <el-switch v-model="c.isPrimary" active-text="主要" size="large" />
              </el-col>
              <el-col :span="2" style="display: flex; align-items: center;">
                <el-button type="danger" text @click="removeContact(i)" :disabled="contacts.length <= 1">
                  <el-icon size="18"><Delete /></el-icon>
                </el-button>
              </el-col>
            </el-row>
          </div>
        </div>

        <!-- Qualifications -->
        <div class="sp-card">
          <div class="sp-card-header">
            <span class="sp-card-title">资质材料</span>
            <el-button type="primary" size="small" @click="addQualification">
              <el-icon><Plus /></el-icon>添加资质
            </el-button>
          </div>
          <div v-for="(q, i) in qualifications" :key="i" class="qual-row">
            <el-row :gutter="16">
              <el-col :span="5">
                <el-select v-model="q.type" placeholder="资质类型" size="large" style="width: 100%">
                  <el-option label="营业执照" value="营业执照" />
                  <el-option label="资质证书" value="资质证书" />
                  <el-option label="安全生产许可证" value="安全生产许可证" />
                  <el-option label="质量管理体系认证" value="质量管理体系认证" />
                  <el-option label="环境管理体系认证" value="环境管理体系认证" />
                  <el-option label="其他" value="其他" />
                </el-select>
              </el-col>
              <el-col :span="6">
                <el-input v-model="q.name" placeholder="资质名称" size="large" />
              </el-col>
              <el-col :span="5">
                <el-date-picker v-model="q.validFrom" type="date" placeholder="有效期起" size="large" style="width: 100%" value-format="YYYY-MM-DD" />
              </el-col>
              <el-col :span="5">
                <el-date-picker v-model="q.validTo" type="date" placeholder="有效期止" size="large" style="width: 100%" value-format="YYYY-MM-DD" />
              </el-col>
              <el-col :span="3" style="display: flex; align-items: center; gap: 8px;">
                <input type="file" style="display:none" :ref="el => { if (el) uploadRefs[i] = el }" @change="(e) => handleQualFileChange(i, e)" accept=".pdf,.jpg,.jpeg,.png" />
                <el-button text type="primary" size="small" @click="uploadRefs[i]?.click()">上传</el-button>
                <el-button type="danger" text @click="removeQualification(i)" :disabled="qualifications.length <= 1">
                  <el-icon size="18"><Delete /></el-icon>
                </el-button>
              </el-col>
            </el-row>
          </div>
        </div>
      </div>

      <!-- Step 4: Confirm -->
      <div v-show="currentStep === 3" class="step-content sp-slide-up">
        <div class="sp-card">
          <div class="sp-card-header">
            <span class="sp-card-title">确认注册信息</span>
          </div>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="用户名">{{ accountForm.username }}</el-descriptions-item>
            <el-descriptions-item label="联系人">{{ accountForm.displayName }}</el-descriptions-item>
            <el-descriptions-item label="企业名称" :span="2">{{ companyForm.name }}</el-descriptions-item>
            <el-descriptions-item label="统一社会信用代码">{{ companyForm.creditCode }}</el-descriptions-item>
            <el-descriptions-item label="企业类型">{{ companyForm.enterpriseType }}</el-descriptions-item>
            <el-descriptions-item label="法定代表人">{{ companyForm.legalPerson }}</el-descriptions-item>
            <el-descriptions-item label="注册地址" :span="2">{{ companyForm.registeredAddress }}</el-descriptions-item>
            <el-descriptions-item label="经营范围" :span="2">{{ companyForm.businessScope }}</el-descriptions-item>
          </el-descriptions>

          <el-alert
            type="info"
            :closable="false"
            show-icon
            style="margin-top: 20px;"
          >
            <template #title>
              提交注册后，系统将自动进入审核流程。审核通过后您将获得完整的使用权限。
            </template>
          </el-alert>
        </div>
      </div>

      <!-- Actions -->
      <div class="register-actions">
        <el-button v-if="currentStep > 0" size="large" @click="prevStep">
          <el-icon><ArrowLeft /></el-icon>上一步
        </el-button>
        <div style="flex: 1"></div>
        <el-button v-if="currentStep < 3" type="primary" size="large" @click="nextStep">
          下一步<el-icon><ArrowRight /></el-icon>
        </el-button>
        <el-button v-if="currentStep === 3" type="primary" size="large" :loading="loading" @click="submitRegister">
          <el-icon><CircleCheck /></el-icon>
          {{ loading ? '提交中...' : '提交注册申请' }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.register-page {
  min-height: 100vh;
  background: var(--sp-bg);
  padding: 40px 20px;
}

.register-container {
  max-width: 860px;
  margin: 0 auto;
  animation: slideUp 0.5s ease;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.register-header {
  text-align: center;
  margin-bottom: 36px;
  position: relative;
}

.register-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 16px;
}

.register-logo {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  object-fit: cover;
}

.register-brand-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  text-align: left;
}

.register-brand-name {
  font-size: 16px;
  font-weight: 900;
  color: var(--sp-gray-900);
  letter-spacing: 0.1em;
  font-family: "SimHei", "黑体", sans-serif;
}

.register-brand-en {
  font-size: 7px;
  color: var(--sp-gray-400);
  letter-spacing: 0.05em;
  font-weight: 500;
}

.back-link {
  position: absolute;
  left: 0;
  top: 4px;
  font-size: 14px;
  color: var(--sp-gray-500);
  display: flex;
  align-items: center;
  gap: 4px;
  transition: color 0.2s;
}

.back-link:hover { color: var(--sp-primary); }

.register-title {
  font-size: 26px;
  font-weight: 900;
  color: var(--sp-gray-900);
}

.register-desc {
  font-size: 14px;
  color: var(--sp-gray-500);
  margin-top: 6px;
}

.register-steps {
  margin-bottom: 32px;
}

.step-content {
  margin-bottom: 24px;
}

.contact-row,
.qual-row {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--sp-border);
}

.contact-row:last-child,
.qual-row:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.register-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 0;
}
</style>
