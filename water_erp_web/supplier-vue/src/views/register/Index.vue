<script setup>
import { useRouter } from 'vue-router'
import {
  DocumentAdd,
  Document,
  Clock,
  UserFilled
} from '@element-plus/icons-vue'

const router = useRouter()

const features = [
  {
    title: '在线注册',
    description: '填写企业基本信息，上传营业执照、资质证书等材料，完成供应商注册申请。',
    icon: DocumentAdd,
    color: '#064ea2'
  },
  {
    title: '资质提交',
    description: '按供应商类别要求上传相关资质材料，支持多种格式文件上传。',
    icon: Document,
    color: '#11a874'
  },
  {
    title: '审核查询',
    description: '实时查询注册审核进度，查看审核意见，及时补充完善资料。',
    icon: Clock,
    color: '#f5a623'
  },
  {
    title: '入驻启用',
    description: '审核通过后自动进入供应商库，可参与平台招标采购项目。',
    icon: UserFilled,
    color: '#0a7ed3'
  }
]

const steps = [
  { num: '01', title: '在线注册', desc: '填写企业基本信息' },
  { num: '02', title: '资质提交', desc: '上传营业执照等资质' },
  { num: '03', title: '平台审核', desc: '资质合规性审核' },
  { num: '04', title: '入驻启用', desc: '参与投标采购' }
]

const handleRegister = () => {
  router.push('/register/form')
}

const handleStatus = () => {
  router.push('/register/status')
}
</script>

<template>
  <div class="register-home">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1 class="page-title">供应商注册</h1>
      <p class="page-subtitle">成为四川水发集团合格供应商，参与公开透明的招标采购</p>
    </div>

    <!-- 注册引导 -->
    <div class="register-guide">
      <div class="guide-content">
        <h2 class="guide-title">供应商入驻流程</h2>
        <p class="guide-desc">按以下步骤完成供应商注册，审核通过后即可参与平台项目</p>
        <div class="steps-container">
          <div class="step-item" v-for="(step, index) in steps" :key="index">
            <div class="step-num">{{ step.num }}</div>
            <div class="step-info">
              <div class="step-title">{{ step.title }}</div>
              <div class="step-desc">{{ step.desc }}</div>
            </div>
            <div class="step-line" v-if="index < steps.length - 1"></div>
          </div>
        </div>
        <div class="guide-actions">
          <el-button type="primary" size="large" @click="handleRegister">
            <el-icon><DocumentAdd /></el-icon>
            立即注册
          </el-button>
          <el-button size="large" @click="handleStatus">
            <el-icon><Clock /></el-icon>
            查询审核状态
          </el-button>
        </div>
      </div>
      <div class="guide-image">
        <img src="https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=600&h=400&fit=crop" alt="供应商注册" />
      </div>
    </div>

    <!-- 功能介绍 -->
    <div class="features-section">
      <h3 class="section-title">注册功能说明</h3>
      <div class="features-grid">
        <div class="feature-card" v-for="feature in features" :key="feature.title">
          <div class="feature-icon" :style="{ background: feature.color }">
            <el-icon :size="28"><component :is="feature.icon" /></el-icon>
          </div>
          <h4 class="feature-title">{{ feature.title }}</h4>
          <p class="feature-desc">{{ feature.description }}</p>
        </div>
      </div>
    </div>

    <!-- 注意事项 -->
    <div class="notice-section">
      <h3 class="section-title">注册注意事项</h3>
      <div class="notice-content">
        <el-alert type="warning" :closable="false">
          <template #title>
            <strong>注册前请确保准备好以下材料：</strong>
          </template>
          <ul class="notice-list">
            <li>企业营业执照（最新年检版本）</li>
            <li>统一社会信用代码证书</li>
            <li>法定代表人身份证复印件</li>
            <li>相关行业资质证书（如有）</li>
            <li>授权委托书（如非法人亲自办理）</li>
          </ul>
        </el-alert>
        <el-alert type="info" :closable="false" style="margin-top: 16px;">
          <template #title>
            <strong>审核时间说明：</strong>
          </template>
          <p>一般情况下，资质审核在 3-5 个工作日内完成。审核结果将通过短信和站内消息通知您。</p>
        </el-alert>
      </div>
    </div>
  </div>
</template>

<style scoped>
.register-home {
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

/* 注册引导 */
.register-guide {
  background: #fff;
  border-radius: 12px;
  padding: 32px;
  margin-bottom: 24px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
  align-items: center;
  border: 1px solid #e8f0fa;
  box-shadow: 0 4px 16px rgba(4, 43, 92, 0.06);
}

.guide-title {
  font-size: 20px;
  font-weight: 800;
  color: #18243a;
  margin-bottom: 8px;
}

.guide-desc {
  font-size: 14px;
  color: #5a6d8a;
  margin-bottom: 24px;
}

.steps-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 28px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 16px;
  position: relative;
}

.step-num {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #064ea2, #39a8ff);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
  flex-shrink: 0;
}

.step-info {
  flex: 1;
}

.step-title {
  font-size: 15px;
  font-weight: 700;
  color: #18243a;
  margin-bottom: 4px;
}

.step-desc {
  font-size: 13px;
  color: #8a9aaa;
}

.step-line {
  position: absolute;
  left: 20px;
  top: 40px;
  width: 2px;
  height: 16px;
  background: #d8e2f0;
}

.step-line:last-child {
  display: none;
}

.guide-actions {
  display: flex;
  gap: 16px;
}

.guide-image {
  border-radius: 8px;
  overflow: hidden;
}

.guide-image img {
  width: 100%;
  height: auto;
  display: block;
}

/* 功能介绍 */
.features-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 18px;
  font-weight: 800;
  color: #18243a;
  margin-bottom: 20px;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}

.feature-card {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  border: 1px solid #e8f0fa;
  transition: all 0.3s ease;
}

.feature-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(6, 78, 162, 0.1);
}

.feature-icon {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  margin: 0 auto 16px;
}

.feature-title {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
  margin-bottom: 8px;
}

.feature-desc {
  font-size: 13px;
  color: #5a6d8a;
  line-height: 1.6;
}

/* 注意事项 */
.notice-section {
  margin-bottom: 24px;
}

.notice-content {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  border: 1px solid #e8f0fa;
}

.notice-list {
  margin: 0;
  padding-left: 20px;
}

.notice-list li {
  margin-bottom: 6px;
  font-size: 14px;
  color: #5a6d8a;
}

/* 响应式 */
@media (max-width: 1200px) {
  .features-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .register-guide {
    grid-template-columns: 1fr;
  }

  .guide-image {
    order: -1;
  }

  .features-grid {
    grid-template-columns: 1fr;
  }

  .guide-actions {
    flex-direction: column;
  }
}
</style>