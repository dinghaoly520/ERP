<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSupplierStore } from '@/stores/supplier'
import { ElMessage } from 'element-plus'
import {
  Document,
  Upload,
  Check,
  WarningFilled
} from '@element-plus/icons-vue'

const router = useRouter()
const supplierStore = useSupplierStore()

const currentStep = ref(0)

const steps = [
  { title: '企业信息', icon: Document },
  { title: '资质上传', icon: Upload },
  { title: '确认提交', icon: Check }
]

// 企业基本信息
const basicForm = ref({
  companyName: '',
  creditCode: '',
  legalPerson: '',
  registerCapital: '',
  establishDate: '',
  companyType: '',
  businessScope: '',
  province: '',
  city: '',
  address: '',
  phone: '',
  email: '',
  bankName: '',
  bankAccount: ''
})

// 资质信息
const qualificationForm = ref({
  businessLicense: null,
  qualityCert: null,
  safetyCert: null,
  otherCerts: []
})

// 供应商类型
const supplierTypes = [
  '工程施工',
  '物资供应',
  '服务提供',
  '设备制造',
  '其他'
]

const companyTypes = [
  '有限责任公司',
  '股份有限公司',
  '国有企业',
  '集体企业',
  '私营企业',
  '其他'
]

// 表单验证
const basicRules = {
  companyName: [{ required: true, message: '请输入企业名称', trigger: 'blur' }],
  creditCode: [{ required: true, message: '请输入统一社会信用代码', trigger: 'blur' }],
  legalPerson: [{ required: true, message: '请输入法定代表人', trigger: 'blur' }],
  registerCapital: [{ required: true, message: '请输入注册资本', trigger: 'blur' }],
  companyType: [{ required: true, message: '请选择企业类型', trigger: 'change' }]
}

const basicFormRef = ref(null)

const handleNext = async () => {
  if (currentStep.value === 0) {
    try {
      await basicFormRef.value.validate()
      currentStep.value++
    } catch (e) {
      ElMessage.warning('请完善必填信息')
    }
  } else {
    currentStep.value++
  }
}

const handlePrev = () => {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

const handleFileChange = (field, file) => {
  qualificationForm.value[field] = file
}

const handleSubmit = () => {
  // 模拟提交
  const supplier = {
    id: Date.now(),
    name: basicForm.value.companyName,
    creditCode: basicForm.value.creditCode,
    type: '物资采购',
    status: 'pending',
    registerDate: new Date().toISOString().split('T')[0],
    score: 0
  }

  supplierStore.addSupplier(supplier)
  ElMessage.success('注册申请已提交，请等待审核')
  router.push('/supplier/status')
}

const handleCancel = () => {
  router.push('/supplier')
}
</script>

<template>
  <div class="register-page">
    <div class="page-header">
      <h1 class="page-title">供应商注册</h1>
      <p class="page-subtitle">填写企业信息，完成供应商入驻申请</p>
    </div>

    <!-- 步骤条 -->
    <div class="steps-container">
      <el-steps :active="currentStep" align-center>
        <el-step v-for="(step, index) in steps" :key="index" :title="step.title">
          <template #icon>
            <el-icon><component :is="step.icon" /></el-icon>
          </template>
        </el-step>
      </el-steps>
    </div>

    <!-- 表单区域 -->
    <div class="form-container">
      <!-- 步骤1：企业信息 -->
      <div v-show="currentStep === 0" class="form-section">
        <h3>企业基本信息</h3>
        <el-form
          ref="basicFormRef"
          :model="basicForm"
          :rules="basicRules"
          label-width="140px"
          class="register-form"
        >
          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="企业名称" prop="companyName">
                <el-input v-model="basicForm.companyName" placeholder="请输入企业全称" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="统一社会信用代码" prop="creditCode">
                <el-input v-model="basicForm.creditCode" placeholder="请输入18位信用代码" />
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="法定代表人" prop="legalPerson">
                <el-input v-model="basicForm.legalPerson" placeholder="请输入法定代表人姓名" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="注册资本" prop="registerCapital">
                <el-input v-model="basicForm.registerCapital" placeholder="请输入注册资本（万元）">
                  <template #append>万元</template>
                </el-input>
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="成立日期" prop="establishDate">
                <el-date-picker
                  v-model="basicForm.establishDate"
                  type="date"
                  placeholder="选择日期"
                  style="width: 100%"
                />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="企业类型" prop="companyType">
                <el-select v-model="basicForm.companyType" placeholder="请选择" style="width: 100%">
                  <el-option
                    v-for="type in companyTypes"
                    :key="type"
                    :label="type"
                    :value="type"
                  />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item label="经营范围" prop="businessScope">
            <el-input
              v-model="basicForm.businessScope"
              type="textarea"
              :rows="3"
              placeholder="请输入主要经营范围"
            />
          </el-form-item>

          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="所在省份" prop="province">
                <el-input v-model="basicForm.province" placeholder="请输入省份" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="所在城市" prop="city">
                <el-input v-model="basicForm.city" placeholder="请输入城市" />
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item label="详细地址" prop="address">
            <el-input v-model="basicForm.address" placeholder="请输入详细地址" />
          </el-form-item>

          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="联系电话" prop="phone">
                <el-input v-model="basicForm.phone" placeholder="请输入联系电话" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="电子邮箱" prop="email">
                <el-input v-model="basicForm.email" placeholder="请输入邮箱地址" />
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="开户银行" prop="bankName">
                <el-input v-model="basicForm.bankName" placeholder="请输入开户银行" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="银行账号" prop="bankAccount">
                <el-input v-model="basicForm.bankAccount" placeholder="请输入银行账号" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </div>

      <!-- 步骤2：资质上传 -->
      <div v-show="currentStep === 1" class="form-section">
        <h3>资质证书上传</h3>
        <div class="upload-grid">
          <div class="upload-item">
            <div class="upload-header">
              <span class="required">*</span>
              <span>营业执照</span>
            </div>
            <el-upload
              class="upload-area"
              drag
              :auto-upload="false"
              :limit="1"
              @change="(file) => handleFileChange('businessLicense', file)"
            >
              <el-icon class="el-icon--upload" :size="40"><Upload /></el-icon>
              <div class="el-upload__text">
                将文件拖到此处，或<em>点击上传</em>
              </div>
              <template #tip>
                <div class="el-upload__tip">支持 jpg/png/pdf 格式，不超过 5MB</div>
              </template>
            </el-upload>
          </div>

          <div class="upload-item">
            <div class="upload-header">
              <span>质量体系认证</span>
            </div>
            <el-upload
              class="upload-area"
              drag
              :auto-upload="false"
              :limit="1"
              @change="(file) => handleFileChange('qualityCert', file)"
            >
              <el-icon class="el-icon--upload" :size="40"><Upload /></el-icon>
              <div class="el-upload__text">
                将文件拖到此处，或<em>点击上传</em>
              </div>
              <template #tip>
                <div class="el-upload__tip">支持 jpg/png/pdf 格式，不超过 5MB</div>
              </template>
            </el-upload>
          </div>

          <div class="upload-item">
            <div class="upload-header">
              <span>安全生产许可证</span>
            </div>
            <el-upload
              class="upload-area"
              drag
              :auto-upload="false"
              :limit="1"
              @change="(file) => handleFileChange('safetyCert', file)"
            >
              <el-icon class="el-icon--upload" :size="40"><Upload /></el-icon>
              <div class="el-upload__text">
                将文件拖到此处，或<em>点击上传</em>
              </div>
              <template #tip>
                <div class="el-upload__tip">支持 jpg/png/pdf 格式，不超过 5MB</div>
              </template>
            </el-upload>
          </div>

          <div class="upload-item">
            <div class="upload-header">
              <span>其他资质证书</span>
            </div>
            <el-upload
              class="upload-area"
              drag
              multiple
              :auto-upload="false"
              @change="(file) => handleFileChange('otherCerts', file)"
            >
              <el-icon class="el-icon--upload" :size="40"><Upload /></el-icon>
              <div class="el-upload__text">
                将文件拖到此处，或<em>点击上传</em>
              </div>
              <template #tip>
                <div class="el-upload__tip">支持 jpg/png/pdf 格式，可上传多个文件</div>
              </template>
            </el-upload>
          </div>
        </div>
      </div>

      <!-- 步骤3：确认提交 -->
      <div v-show="currentStep === 2" class="form-section">
        <h3>确认信息</h3>
        <div class="confirm-section">
          <div class="confirm-alert">
            <el-icon :size="24" color="#f5a623"><WarningFilled /></el-icon>
            <div>
              <strong>请仔细核对以下信息</strong>
              <p>提交后信息将进入审核流程，如有错误请联系管理员修改</p>
            </div>
          </div>

          <div class="confirm-info">
            <h4>企业基本信息</h4>
            <el-descriptions :column="2" border>
              <el-descriptions-item label="企业名称">{{ basicForm.companyName }}</el-descriptions-item>
              <el-descriptions-item label="统一社会信用代码">{{ basicForm.creditCode }}</el-descriptions-item>
              <el-descriptions-item label="法定代表人">{{ basicForm.legalPerson }}</el-descriptions-item>
              <el-descriptions-item label="注册资本">{{ basicForm.registerCapital }}万元</el-descriptions-item>
              <el-descriptions-item label="企业类型">{{ basicForm.companyType }}</el-descriptions-item>
              <el-descriptions-item label="成立日期">{{ basicForm.establishDate }}</el-descriptions-item>
              <el-descriptions-item label="联系电话">{{ basicForm.phone }}</el-descriptions-item>
              <el-descriptions-item label="电子邮箱">{{ basicForm.email }}</el-descriptions-item>
              <el-descriptions-item label="详细地址" :span="2">{{ basicForm.address }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <div class="confirm-agreement">
            <el-checkbox v-model="agreed">
              我已阅读并同意《供应商入驻协议》和《平台服务条款》
            </el-checkbox>
          </div>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="form-actions">
        <el-button v-if="currentStep > 0" @click="handlePrev">上一步</el-button>
        <el-button @click="handleCancel">取消</el-button>
        <el-button v-if="currentStep < 2" type="primary" @click="handleNext">下一步</el-button>
        <el-button v-else type="primary" @click="handleSubmit" :disabled="!agreed">提交申请</el-button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      agreed: false
    }
  }
}
</script>

<style scoped>
.register-page {
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

.steps-container {
  background: #fff;
  border-radius: 8px;
  padding: 32px;
  margin-bottom: 24px;
  border: 1px solid #e8f0fa;
}

.form-container {
  background: #fff;
  border-radius: 8px;
  padding: 32px;
  border: 1px solid #e8f0fa;
}

.form-section h3 {
  font-size: 18px;
  font-weight: 700;
  color: #18243a;
  margin-bottom: 24px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e8f0fa;
}

.register-form {
  max-width: 900px;
}

.upload-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}

.upload-item {
  background: #f8fafd;
  border-radius: 8px;
  padding: 20px;
}

.upload-header {
  font-size: 14px;
  font-weight: 600;
  color: #18243a;
  margin-bottom: 12px;
}

.upload-header .required {
  color: #e74c3c;
  margin-right: 4px;
}

.upload-area {
  width: 100%;
}

.upload-area :deep(.el-upload-dragger) {
  width: 100%;
  height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.confirm-section {
  max-width: 800px;
}

.confirm-alert {
  display: flex;
  gap: 16px;
  padding: 16px;
  background: #fff8e8;
  border-radius: 8px;
  margin-bottom: 24px;
}

.confirm-alert strong {
  display: block;
  font-size: 14px;
  color: #18243a;
  margin-bottom: 4px;
}

.confirm-alert p {
  font-size: 13px;
  color: #8a9aaa;
  margin: 0;
}

.confirm-info h4 {
  font-size: 15px;
  font-weight: 600;
  color: #18243a;
  margin-bottom: 16px;
}

.confirm-agreement {
  margin-top: 24px;
  padding: 16px;
  background: #f8fafd;
  border-radius: 8px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #e8f0fa;
}

@media (max-width: 768px) {
  .upload-grid {
    grid-template-columns: 1fr;
  }
}
</style>
