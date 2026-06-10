<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage } from 'element-plus'
import {
  Upload,
  Document,
  Check,
  ArrowRight
} from '@element-plus/icons-vue'

const router = useRouter()
const supplierStore = useSupplierStore()

// 当前步骤
const currentStep = ref(0)

// 表单数据
const formData = reactive({
  // 企业信息
  companyName: '',
  creditCode: '',
  companyType: '',
  legalPerson: '',
  registerAddress: '',
  businessScope: '',
  // 联系人信息
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  contactPosition: '',
  // 资质材料
  businessLicense: [],
  qualificationCertificates: [],
  authorizationLetter: [],
  // 分类
  category: '',
  // 声明确认
  declaration: false
})

// 企业类型选项
const companyTypes = [
  { value: 'state', label: '国有企业' },
  { value: 'private', label: '民营企业' },
  { value: 'foreign', label: '外资企业' },
  { value: 'joint', label: '合资企业' },
  { value: 'collective', label: '集体企业' },
  { value: 'other', label: '其他' }
]

// 供应商分类
const categories = [
  { value: 'engineering', label: '工程建设' },
  { value: 'material', label: '物资采购' },
  { value: 'service', label: '服务采购' }
]

// 步骤配置
const steps = [
  { title: '企业信息', description: '填写企业基本信息' },
  { title: '联系人信息', description: '填写联系人信息' },
  { title: '资质材料', description: '上传资质文件' },
  { title: '确认提交', description: '确认并提交申请' }
]

// 表单校验规则
const rules = {
  companyName: [{ required: true, message: '请输入企业名称', trigger: 'blur' }],
  creditCode: [
    { required: true, message: '请输入统一社会信用代码', trigger: 'blur' },
    { pattern: /^[0-9A-Z]{18}$/, message: '请输入正确的18位统一社会信用代码', trigger: 'blur' }
  ],
  companyType: [{ required: true, message: '请选择企业类型', trigger: 'change' }],
  legalPerson: [{ required: true, message: '请输入法定代表人', trigger: 'blur' }],
  registerAddress: [{ required: true, message: '请输入注册地址', trigger: 'blur' }],
  businessScope: [{ required: true, message: '请输入经营范围', trigger: 'blur' }],
  contactName: [{ required: true, message: '请输入联系人姓名', trigger: 'blur' }],
  contactPhone: [
    { required: true, message: '请输入联系人手机号', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号', trigger: 'blur' }
  ],
  contactEmail: [
    { type: 'email', message: '请输入正确的邮箱地址', trigger: 'blur' }
  ],
  category: [{ required: true, message: '请选择供应商分类', trigger: 'change' }],
  declaration: [{ required: true, message: '请确认注册声明', trigger: 'change' }]
}

// 表单引用
const formRef = ref(null)

// 上传配置
const uploadConfig = {
  action: '#',
  autoUpload: false,
  limit: 5,
  accept: '.pdf,.doc,.docx,.jpg,.jpeg,.png'
}

// 处理文件上传
const handleUploadChange = (file, fileList, field) => {
  formData[field] = fileList
}

// 下一步
const nextStep = async () => {
  if (currentStep.value < 3) {
    currentStep.value++
  }
}

// 上一步
const prevStep = () => {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

// 提交注册
const submitForm = async () => {
  if (!formData.declaration) {
    ElMessage.warning('请确认注册声明')
    return
  }

  // 构建供应商数据
  const supplierData = {
    name: formData.companyName,
    creditCode: formData.creditCode,
    type: companyTypes.find(t => t.value === formData.companyType)?.label,
    legalPerson: formData.legalPerson,
    registerAddress: formData.registerAddress,
    businessScope: formData.businessScope,
    category: formData.category,
    categoryLabel: categories.find(c => c.value === formData.category)?.label,
    contacts: [
      {
        name: formData.contactName,
        phone: formData.contactPhone,
        email: formData.contactEmail,
        position: formData.contactPosition,
        isMain: true
      }
    ],
    qualifications: [
      ...(formData.businessLicense.map(f => ({ name: '营业执照', fileUrl: f.url || f.name, uploadDate: new Date().toISOString().split('T')[0] }))),
      ...(formData.qualificationCertificates.map(f => ({ name: '资质证书', fileUrl: f.url || f.name, uploadDate: new Date().toISOString().split('T')[0] })))
    ]
  }

  const newId = supplierStore.addSupplier(supplierData)
  ElMessage.success('注册申请已提交，请等待审核')
  router.push('/register/status')
}
</script>

<template>
  <div class="register-form-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1 class="page-title">供应商注册申请</h1>
      <p class="page-subtitle">请填写真实有效的企业信息，审核通过后即可参与平台项目</p>
    </div>

    <!-- 步骤条 -->
    <div class="steps-wrapper">
      <el-steps :active="currentStep" align-center>
        <el-step v-for="(step, index) in steps" :key="index" :title="step.title" :description="step.description" />
      </el-steps>
    </div>

    <!-- 表单内容 -->
    <div class="form-wrapper">
      <!-- 企业信息 -->
      <div v-show="currentStep === 0" class="form-section">
        <div class="section-title">企业基本信息</div>
        <el-form :model="formData" :rules="rules" label-width="140px" class="register-form">
          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="企业名称" prop="companyName">
                <el-input v-model="formData.companyName" placeholder="请输入企业工商登记名称" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="统一社会信用代码" prop="creditCode">
                <el-input v-model="formData.creditCode" placeholder="请输入18位统一社会信用代码" maxlength="18" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="企业类型" prop="companyType">
                <el-select v-model="formData.companyType" placeholder="请选择企业类型" style="width: 100%">
                  <el-option v-for="type in companyTypes" :key="type.value" :label="type.label" :value="type.value" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="法定代表人" prop="legalPerson">
                <el-input v-model="formData.legalPerson" placeholder="请输入法定代表人姓名" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :span="24">
              <el-form-item label="注册地址" prop="registerAddress">
                <el-input v-model="formData.registerAddress" placeholder="请输入企业注册地址" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :span="24">
              <el-form-item label="经营范围" prop="businessScope">
                <el-input v-model="formData.businessScope" type="textarea" :rows="3" placeholder="请输入经营范围" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="供应商分类" prop="category">
                <el-select v-model="formData.category" placeholder="请选择供应商分类" style="width: 100%">
                  <el-option v-for="cat in categories" :key="cat.value" :label="cat.label" :value="cat.value" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </div>

      <!-- 联系人信息 -->
      <div v-show="currentStep === 1" class="form-section">
        <div class="section-title">联系人信息</div>
        <el-form :model="formData" :rules="rules" label-width="140px" class="register-form">
          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="联系人姓名" prop="contactName">
                <el-input v-model="formData.contactName" placeholder="请输入联系人姓名" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="联系人职务">
                <el-input v-model="formData.contactPosition" placeholder="请输入联系人职务" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="联系人手机号" prop="contactPhone">
                <el-input v-model="formData.contactPhone" placeholder="请输入手机号" maxlength="11" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="联系人邮箱" prop="contactEmail">
                <el-input v-model="formData.contactEmail" placeholder="请输入邮箱地址" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </div>

      <!-- 资质材料 -->
      <div v-show="currentStep === 2" class="form-section">
        <div class="section-title">资质材料上传</div>
        <div class="upload-section">
          <div class="upload-item">
            <div class="upload-label">
              <span class="required">*</span> 营业执照
            </div>
            <el-upload
              v-model:file-list="formData.businessLicense"
              action="#"
              :auto-upload="false"
              accept=".pdf,.jpg,.jpeg,.png"
              :limit="1"
              drag
            >
              <el-icon class="el-icon--upload"><upload /></el-icon>
              <div class="el-upload__text">
                拖拽文件到此处，或<em>点击上传</em>
              </div>
              <template #tip>
                <div class="el-upload__tip">支持 PDF、JPG、PNG 格式，文件大小不超过 10MB</div>
              </template>
            </el-upload>
          </div>

          <div class="upload-item">
            <div class="upload-label">资质证书</div>
            <el-upload
              v-model:file-list="formData.qualificationCertificates"
              action="#"
              :auto-upload="false"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              :limit="5"
              multiple
              drag
            >
              <el-icon class="el-icon--upload"><upload /></el-icon>
              <div class="el-upload__text">
                拖拽文件到此处，或<em>点击上传</em>
              </div>
              <template #tip>
                <div class="el-upload__tip">支持 PDF、Word、图片格式，最多上传 5 个文件</div>
              </template>
            </el-upload>
          </div>

          <div class="upload-item">
            <div class="upload-label">授权委托书</div>
            <el-upload
              v-model:file-list="formData.authorizationLetter"
              action="#"
              :auto-upload="false"
              accept=".pdf,.jpg,.jpeg,.png"
              :limit="1"
              drag
            >
              <el-icon class="el-icon--upload"><upload /></el-icon>
              <div class="el-upload__text">
                拖拽文件到此处，或<em>点击上传</em>
              </div>
              <template #tip>
                <div class="el-upload__tip">如非法人亲自办理，需上传授权委托书</div>
              </template>
            </el-upload>
          </div>
        </div>
      </div>

      <!-- 确认提交 -->
      <div v-show="currentStep === 3" class="form-section">
        <div class="section-title">确认注册信息</div>
        <div class="confirm-content">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="企业名称">{{ formData.companyName }}</el-descriptions-item>
            <el-descriptions-item label="统一社会信用代码">{{ formData.creditCode }}</el-descriptions-item>
            <el-descriptions-item label="企业类型">{{ companyTypes.find(t => t.value === formData.companyType)?.label }}</el-descriptions-item>
            <el-descriptions-item label="法定代表人">{{ formData.legalPerson }}</el-descriptions-item>
            <el-descriptions-item label="供应商分类" :span="2">{{ categories.find(c => c.value === formData.category)?.label }}</el-descriptions-item>
            <el-descriptions-item label="注册地址" :span="2">{{ formData.registerAddress }}</el-descriptions-item>
            <el-descriptions-item label="经营范围" :span="2">{{ formData.businessScope }}</el-descriptions-item>
            <el-descriptions-item label="联系人">{{ formData.contactName }}</el-descriptions-item>
            <el-descriptions-item label="联系电话">{{ formData.contactPhone }}</el-descriptions-item>
          </el-descriptions>

          <div class="declaration-section">
            <el-checkbox v-model="formData.declaration" size="large">
              我已阅读并同意
              <el-link type="primary">《供应商注册声明》</el-link>
              ，承诺所填写信息真实有效，如有虚假，愿意承担相应法律责任。
            </el-checkbox>
          </div>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="form-actions">
        <el-button v-if="currentStep > 0" @click="prevStep">上一步</el-button>
        <el-button v-if="currentStep < 3" type="primary" @click="nextStep">
          下一步
          <el-icon class="el-icon--right"><ArrowRight /></el-icon>
        </el-button>
        <el-button v-if="currentStep === 3" type="primary" @click="submitForm">
          <el-icon><Check /></el-icon>
          提交注册申请
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.register-form-page {
  padding: 24px;
  background: #f6f9fd;
  min-height: calc(100vh - 60px);
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 22px;
  font-weight: 800;
  color: #18243a;
  margin-bottom: 8px;
}

.page-subtitle {
  font-size: 14px;
  color: #8a9aaa;
}

.steps-wrapper {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 24px;
  border: 1px solid #e8f0fa;
}

.form-wrapper {
  background: #fff;
  border-radius: 8px;
  padding: 32px;
  border: 1px solid #e8f0fa;
}

.form-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
  margin-bottom: 24px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e8f0fa;
}

.register-form {
  max-width: 800px;
}

/* 上传区域 */
.upload-section {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.upload-item {
  background: #f8fafd;
  border-radius: 8px;
  padding: 20px;
}

.upload-label {
  font-size: 14px;
  font-weight: 600;
  color: #18243a;
  margin-bottom: 12px;
}

.upload-label .required {
  color: #e74c3c;
  margin-right: 4px;
}

/* 确认信息 */
.confirm-content {
  max-width: 800px;
}

.declaration-section {
  margin-top: 24px;
  padding: 16px;
  background: #f8fafd;
  border-radius: 8px;
}

/* 操作按钮 */
.form-actions {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #e8f0fa;
}

@media (max-width: 768px) {
  .form-wrapper {
    padding: 20px;
  }

  .register-form {
    max-width: 100%;
  }
}
</style>