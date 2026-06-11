<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()

const form = reactive({ username: '', password: '' })
const loading = ref(false)
const formRef = ref()

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码不少于6位', trigger: 'blur' },
  ],
}

async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const ok = await authStore.login(form.username, form.password)
    if (ok) {
      ElMessage.success('登录成功')
      router.push('/dashboard')
    } else {
      ElMessage.error('用户名或密码错误')
    }
  } catch {
    ElMessage.error('登录失败，请检查账号密码')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <!-- Background decoration -->
    <div class="login-bg">
      <div class="login-bg-circle c1"></div>
      <div class="login-bg-circle c2"></div>
      <div class="login-bg-circle c3"></div>
    </div>

    <div class="login-container">
      <!-- Left: Branding -->
      <div class="login-brand">
        <div class="brand-content">
          <div class="brand-icon">
            <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="64" height="64" rx="16" fill="white" fill-opacity="0.15"/>
              <path d="M16 44C16 44 24 20 32 20C40 20 32 44 48 36" stroke="white" stroke-width="4" stroke-linecap="round"/>
              <circle cx="32" cy="14" r="4" fill="white"/>
            </svg>
          </div>
          <h1 class="brand-title">智慧水发 · ERP</h1>
          <p class="brand-subtitle">供应商门户平台</p>
          <div class="brand-features">
            <div class="brand-feature">
              <el-icon><CircleCheckFilled /></el-icon>
              <span>在线注册，快速入驻</span>
            </div>
            <div class="brand-feature">
              <el-icon><CircleCheckFilled /></el-icon>
              <span>实时招标，便捷投标</span>
            </div>
            <div class="brand-feature">
              <el-icon><CircleCheckFilled /></el-icon>
              <span>信息透明，安全可靠</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Login form -->
      <div class="login-form-area">
        <div class="login-form-wrapper">
          <h2 class="form-title">欢迎登录</h2>
          <p class="form-desc">请输入您的账号信息登录供应商门户</p>

          <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="handleLogin">
            <el-form-item prop="username">
              <el-input v-model="form.username" placeholder="请输入用户名" prefix-icon="User" />
            </el-form-item>
            <el-form-item prop="password">
              <el-input v-model="form.password" type="password" placeholder="请输入密码" prefix-icon="Lock" show-password />
            </el-form-item>

            <el-form-item>
              <el-button type="primary" :loading="loading" class="login-btn" @click="handleLogin">
                {{ loading ? '登录中...' : '登 录' }}
              </el-button>
            </el-form-item>
          </el-form>

          <div class="form-footer">
            <span class="form-footer-text">还没有账号？</span>
            <router-link to="/register" class="form-footer-link">立即注册供应商</router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #062f6b 0%, #0a5eb8 40%, #0891b2 100%);
  position: relative;
  overflow: hidden;
}

/* Animated background circles */
.login-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.login-bg-circle {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.04);
}

.c1 {
  width: 600px; height: 600px;
  top: -200px; left: -200px;
  animation: floatCircle 20s ease-in-out infinite;
}

.c2 {
  width: 400px; height: 400px;
  bottom: -100px; right: -100px;
  animation: floatCircle 15s ease-in-out infinite reverse;
}

.c3 {
  width: 200px; height: 200px;
  top: 50%; left: 45%;
  animation: floatCircle 25s ease-in-out infinite;
}

@keyframes floatCircle {
  0%, 100% { transform: translate(0, 0); }
  33% { transform: translate(30px, -20px); }
  66% { transform: translate(-20px, 15px); }
}

.login-container {
  display: flex;
  width: 900px;
  max-width: 95vw;
  min-height: 520px;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 32px 64px rgba(0, 0, 0, 0.3);
  position: relative;
  z-index: 1;
  animation: slideUp 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Left branding panel */
.login-brand {
  flex: 1;
  background: linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%);
  backdrop-filter: blur(20px);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  padding: 60px 48px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.brand-content { max-width: 320px; }

.brand-icon {
  width: 72px;
  height: 72px;
  margin-bottom: 28px;
}

.brand-icon svg {
  width: 100%;
  height: 100%;
}

.brand-title {
  font-size: 28px;
  font-weight: 900;
  color: #fff;
  margin-bottom: 8px;
  letter-spacing: -0.5px;
}

.brand-subtitle {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 40px;
}

.brand-features {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.brand-feature {
  display: flex;
  align-items: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.75);
  font-size: 14px;
}

.brand-feature .el-icon {
  color: #34d399;
  font-size: 18px;
  flex-shrink: 0;
}

/* Right form panel */
.login-form-area {
  flex: 1;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
}

.login-form-wrapper {
  width: 100%;
  max-width: 360px;
}

.form-title {
  font-size: 24px;
  font-weight: 800;
  color: var(--sp-gray-900);
  margin-bottom: 6px;
}

.form-desc {
  font-size: 14px;
  color: var(--sp-gray-500);
  margin-bottom: 32px;
}

.login-form-wrapper :deep(.el-input__wrapper) {
  border-radius: 10px;
  padding: 4px 12px;
}

.login-btn {
  width: 100%;
  height: 46px;
  border-radius: 10px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 4px;
}

.form-footer {
  text-align: center;
  margin-top: 24px;
  font-size: 14px;
}

.form-footer-text { color: var(--sp-gray-500); }
.form-footer-link {
  color: var(--sp-primary);
  font-weight: 600;
  margin-left: 4px;
}

.form-footer-link:hover { text-decoration: underline; }

@media (max-width: 768px) {
  .login-brand { display: none; }
  .login-container { width: 95vw; min-height: auto; }
  .login-form-area { padding: 32px 24px; }
}
</style>
