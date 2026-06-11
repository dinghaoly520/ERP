<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="not-found-page">
    <div class="not-found-content">
      <div class="error-code">404</div>
      <h2 class="error-title">页面未找到</h2>
      <p class="error-desc">抱歉，您访问的页面不存在或已被移除</p>
      <div class="error-actions">
        <el-button type="primary" size="large" @click="router.push('/dashboard')">
          <el-icon><HomeFilled /></el-icon>返回首页
        </el-button>
        <el-button size="large" @click="router.back()">
          <el-icon><ArrowLeft /></el-icon>返回上页
        </el-button>
      </div>
    </div>

    <!-- Decorative background -->
    <div class="not-found-bg">
      <div class="wave w1"></div>
      <div class="wave w2"></div>
      <div class="wave w3"></div>
    </div>
  </div>
</template>

<style scoped>
.not-found-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sp-bg);
  position: relative;
  overflow: hidden;
}

.not-found-content {
  text-align: center;
  z-index: 1;
  animation: fadeIn 0.5s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.error-code {
  font-size: 120px;
  font-weight: 900;
  background: linear-gradient(135deg, #0a5eb8, #0891b2);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1;
  margin-bottom: 16px;
}

.error-title {
  font-size: 24px;
  font-weight: 800;
  color: var(--sp-gray-900);
  margin-bottom: 8px;
}

.error-desc {
  font-size: 15px;
  color: var(--sp-gray-500);
  margin-bottom: 32px;
}

.error-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.not-found-bg {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40vh;
  pointer-events: none;
}

.wave {
  position: absolute;
  bottom: 0;
  left: -5%;
  width: 110%;
  height: 100%;
  border-radius: 40% 45% 0 0;
}

.w1 {
  background: rgba(10, 94, 184, 0.04);
  animation: wave 8s ease-in-out infinite;
}

.w2 {
  background: rgba(8, 145, 178, 0.04);
  animation: wave 6s ease-in-out infinite reverse;
  bottom: 10px;
}

.w3 {
  background: rgba(10, 94, 184, 0.02);
  animation: wave 10s ease-in-out infinite;
  bottom: 20px;
}

@keyframes wave {
  0%, 100% { transform: translateX(0) translateY(0); }
  50% { transform: translateX(2%) translateY(-3%); }
}
</style>
