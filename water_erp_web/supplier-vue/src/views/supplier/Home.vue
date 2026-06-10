<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  DocumentAdd,
  Clock,
  UserFilled
} from '@element-plus/icons-vue'

const router = useRouter()

const handleRegister = () => {
  router.push('/supplier/register')
}

const handleLogin = () => {
  router.push('/dashboard')
}
</script>

<template>
  <div class="supplier-home">
    <div class="page-header">
      <h1 class="page-title">供应商中心</h1>
      <p class="page-subtitle">成为四川水发集团合格供应商，参与公开透明的招标采购</p>
    </div>

    <!-- Hero区域 -->
    <div class="hero-section">
      <div class="hero-content">
        <div class="hero-left">
          <p class="eyebrow">入驻平台 · 共创价值</p>
          <h2>供应商入驻流程</h2>
          <p class="hero-desc">按以下步骤完成供应商注册，审核通过后即可参与平台项目</p>
          <div class="hero-actions">
            <el-button type="primary" size="large" @click="handleRegister">
              <el-icon><DocumentAdd /></el-icon>
              立即入驻
            </el-button>
            <el-button size="large" @click="handleLogin">
              <el-icon><UserFilled /></el-icon>
              登录供应商平台
            </el-button>
          </div>
        </div>
        <div class="hero-right">
          <div class="flow-steps">
            <h3>入驻流程</h3>
            <div class="step-list">
              <div class="step-item">
                <div class="step-num">01</div>
                <div class="step-info">
                  <strong>在线注册</strong>
                  <span>填写企业基本信息</span>
                </div>
              </div>
              <div class="step-item">
                <div class="step-num">02</div>
                <div class="step-info">
                  <strong>资质提交</strong>
                  <span>上传营业执照等资质</span>
                </div>
              </div>
              <div class="step-item">
                <div class="step-num">03</div>
                <div class="step-info">
                  <strong>平台审核</strong>
                  <span>资质合规性审核</span>
                </div>
              </div>
              <div class="step-item">
                <div class="step-num">04</div>
                <div class="step-info">
                  <strong>入驻启用</strong>
                  <span>参与投标采购</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 统计数据 -->
    <div class="stats-section">
      <div class="stats-grid">
        <div class="stat-item">
          <strong>3,856</strong>
          <span>注册供应商</span>
        </div>
        <div class="stat-item">
          <strong>2,156</strong>
          <span>活跃供应商</span>
        </div>
        <div class="stat-item">
          <strong>128</strong>
          <span>本月新增</span>
        </div>
        <div class="stat-item">
          <strong>96%</strong>
          <span>审核通过率</span>
        </div>
      </div>
    </div>

    <!-- 行业分布 -->
    <div class="category-section">
      <h3>行业分布</h3>
      <div class="category-grid">
        <div class="category-card">
          <el-icon :size="40" color="#064ea2"><Document /></el-icon>
          <h4>工程建设</h4>
          <p><strong>1,256</strong> 家供应商</p>
          <p class="desc">水利水电工程、土木工程、市政工程等施工企业</p>
        </div>
        <div class="category-card">
          <el-icon :size="40" color="#11a874"><ShoppingCart /></el-icon>
          <h4>物资采购</h4>
          <p><strong>1,482</strong> 家供应商</p>
          <p class="desc">钢材水泥、管材阀门、机电设备等物资供应商</p>
        </div>
        <div class="category-card">
          <el-icon :size="40" color="#f5a623"><User /></el-icon>
          <h4>服务采购</h4>
          <p><strong>1,118</strong> 家供应商</p>
          <p class="desc">设计咨询、监理检测、信息技术等服务企业</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.supplier-home {
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

/* Hero区域 */
.hero-section {
  background: #fff;
  border-radius: 12px;
  padding: 32px;
  margin-bottom: 24px;
  border: 1px solid #e8f0fa;
}

.hero-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
  align-items: center;
}

.eyebrow {
  color: #1262b5;
  font-weight: 700;
  letter-spacing: 0.1em;
  margin-bottom: 8px;
}

.hero-section h2 {
  font-size: 24px;
  font-weight: 800;
  color: #18243a;
  margin-bottom: 12px;
}

.hero-desc {
  font-size: 14px;
  color: #5a6d8a;
  margin-bottom: 24px;
}

.hero-actions {
  display: flex;
  gap: 16px;
}

.flow-steps {
  background: #f8fafd;
  border-radius: 8px;
  padding: 24px;
}

.flow-steps h3 {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
  margin-bottom: 20px;
  text-align: center;
}

.step-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #e8f0fa;
}

.step-num {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #064ea2, #39a8ff);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
}

.step-info strong {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: #18243a;
}

.step-info span {
  font-size: 12px;
  color: #8a9aaa;
}

/* 统计区域 */
.stats-section {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 24px;
  border: 1px solid #e8f0fa;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
}

.stat-item {
  text-align: center;
  padding: 16px;
  border-right: 1px solid #e8f0fa;
}

.stat-item:last-child {
  border-right: none;
}

.stat-item strong {
  display: block;
  font-size: 28px;
  font-weight: 900;
  color: #064ea2;
  margin-bottom: 8px;
}

.stat-item span {
  font-size: 13px;
  color: #8a9aaa;
}

/* 分类区域 */
.category-section {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  border: 1px solid #e8f0fa;
}

.category-section h3 {
  font-size: 18px;
  font-weight: 800;
  color: #18243a;
  margin-bottom: 20px;
}

.category-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.category-card {
  padding: 24px;
  background: #f8fafd;
  border-radius: 8px;
  text-align: center;
}

.category-card h4 {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
  margin: 16px 0 8px;
}

.category-card p {
  font-size: 14px;
  color: #5a6d8a;
  margin-bottom: 8px;
}

.category-card .desc {
  font-size: 12px;
}

.category-card strong {
  font-size: 22px;
  font-weight: 900;
  color: #064ea2;
}

@media (max-width: 1024px) {
  .hero-content {
    grid-template-columns: 1fr;
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .stat-item:nth-child(2) {
    border-right: none;
  }

  .category-grid {
    grid-template-columns: 1fr;
  }
}
</style>