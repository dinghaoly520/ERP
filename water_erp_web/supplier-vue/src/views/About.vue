<script setup>
import {
  Location,
  Phone,
  Message,
  Clock
} from '@element-plus/icons-vue'
</script>

<template>
  <div class="about-page">
    <div class="page-header">
      <h1 class="page-title">关于我们</h1>
      <p class="page-subtitle">了解四川水发集团和智慧招采平台</p>
    </div>

    <!-- 公司介绍 -->
    <div class="intro-section">
      <div class="intro-content">
        <h2>四川水发集团</h2>
        <p>
          四川水发集团有限公司成立于2020年，是四川省属国有大型企业，注册资本100亿元。
          集团以水利工程建设、水务投资运营为主业，承担四川省重大水利工程建设任务，
          致力于成为国内一流的水利水务综合服务商。
        </p>
        <p>
          智慧水发ERP系统是集团数字化转型的重要载体，涵盖采购管理、供应商管理、
          专家管理、开评标管理等核心业务模块，实现招采业务全流程电子化、规范化、透明化。
        </p>
      </div>
    </div>

    <!-- 核心价值观 -->
    <div class="values-section">
      <h3>核心价值观</h3>
      <div class="values-grid">
        <div class="value-item">
          <div class="value-icon blue">
            <el-icon :size="32"><Location /></el-icon>
          </div>
          <h4>阳光透明</h4>
          <p>公开公平公正，流程全程可追溯</p>
        </div>
        <div class="value-item">
          <div class="value-icon green">
            <el-icon :size="32"><Clock /></el-icon>
          </div>
          <h4>合规高效</h4>
          <p>规范业务流程，提升采购效率</p>
        </div>
        <div class="value-item">
          <div class="value-icon orange">
            <el-icon :size="32"><Message /></el-icon>
          </div>
          <h4>互信共赢</h4>
          <p>阳光透明合作，互信互利共赢</p>
        </div>
        <div class="value-item">
          <div class="value-icon cyan">
            <el-icon :size="32"><Phone /></el-icon>
          </div>
          <h4>价值创造</h4>
          <p>优化资源配置，创造更大价值</p>
        </div>
      </div>
    </div>

    <!-- 联系方式 -->
    <div class="contact-section">
      <h3>联系我们</h3>
      <div class="contact-grid">
        <div class="contact-item">
          <el-icon :size="24" color="#064ea2"><Location /></el-icon>
          <div>
            <strong>地址</strong>
            <span>四川省成都市高新区天府大道北段1700号</span>
          </div>
        </div>
        <div class="contact-item">
          <el-icon :size="24" color="#064ea2"><Phone /></el-icon>
          <div>
            <strong>电话</strong>
            <span>400-888-8888</span>
          </div>
        </div>
        <div class="contact-item">
          <el-icon :size="24" color="#064ea2"><Message /></el-icon>
          <div>
            <strong>邮箱</strong>
            <span>service@scwater.com</span>
          </div>
        </div>
        <div class="contact-item">
          <el-icon :size="24" color="#064ea2"><Clock /></el-icon>
          <div>
            <strong>服务时间</strong>
            <span>工作日 9:00 - 18:00</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about-page {
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

.intro-section {
  background: #fff;
  border-radius: 8px;
  padding: 32px;
  margin-bottom: 24px;
  border: 1px solid #e8f0fa;
}

.intro-content h2 {
  font-size: 20px;
  font-weight: 800;
  color: #18243a;
  margin-bottom: 16px;
}

.intro-content p {
  font-size: 14px;
  color: #5a6d8a;
  line-height: 1.8;
  margin-bottom: 12px;
}

.values-section {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 24px;
  border: 1px solid #e8f0fa;
}

.values-section h3 {
  font-size: 18px;
  font-weight: 800;
  color: #18243a;
  margin-bottom: 20px;
}

.values-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}

.value-item {
  text-align: center;
  padding: 24px;
  background: #f8fafd;
  border-radius: 8px;
}

.value-icon {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  color: #fff;
}

.value-icon.blue { background: linear-gradient(135deg, #064ea2, #39a8ff); }
.value-icon.green { background: linear-gradient(135deg, #11a874, #2dd4a0); }
.value-icon.orange { background: linear-gradient(135deg, #f5a623, #f7c873); }
.value-icon.cyan { background: linear-gradient(135deg, #0a7ed3, #39a8ff); }

.value-item h4 {
  font-size: 16px;
  font-weight: 700;
  color: #18243a;
  margin-bottom: 8px;
}

.value-item p {
  font-size: 13px;
  color: #8a9aaa;
}

.contact-section {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  border: 1px solid #e8f0fa;
}

.contact-section h3 {
  font-size: 18px;
  font-weight: 800;
  color: #18243a;
  margin-bottom: 20px;
}

.contact-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.contact-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: #f8fafd;
  border-radius: 8px;
}

.contact-item strong {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: #18243a;
  margin-bottom: 4px;
}

.contact-item span {
  font-size: 14px;
  color: #5a6d8a;
}

@media (max-width: 768px) {
  .values-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .contact-grid {
    grid-template-columns: 1fr;
  }
}
</style>