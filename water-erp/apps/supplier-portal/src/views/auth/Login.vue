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
  <div class="sp-login">
    <!-- Background wave pattern -->
    <div class="sp-login-waves">
      <svg viewBox="0 0 1440 900" fill="none" preserveAspectRatio="xMidYMid slice" class="sp-login-wave-svg">
        <path d="M0 600 Q360 480 720 560 Q1080 640 1440 520 L1440 900 L0 900Z" fill="rgba(255,255,255,0.025)"/>
        <path d="M0 680 Q360 580 720 640 Q1080 700 1440 600 L1440 900 L0 900Z" fill="rgba(255,255,255,0.018)"/>
        <path d="M0 760 Q360 680 720 730 Q1080 780 1440 700 L1440 900 L0 900Z" fill="rgba(255,255,255,0.012)"/>
      </svg>
    </div>

    <!-- Left: Branding -->
    <div class="sp-login-brand">
      <div class="sp-login-brand-inner">
        <div class="sp-login-brand-top">
          <img src="/logo.jpg" alt="四川水发集团" class="sp-login-logo" />
          <div class="sp-login-brand-text">
            <strong class="sp-login-brand-name">四川水发集团</strong>
            <small class="sp-login-brand-en">SICHUAN WATER DEVELOPMENT GROUP</small>
          </div>
        </div>
        <h1 class="sp-login-title">供应商门户</h1>
        <div class="sp-login-divider" />
        <p class="sp-login-subtitle">
          智慧水发 · 蜀水云采
        </p>

        <div class="sp-login-features">
          <div class="sp-login-feature">
            <span class="sp-login-dot" />
            <div>
              <span class="sp-login-feature-label">在线投标</span>
              <span class="sp-login-feature-desc">实时获取招标信息，一键投递</span>
            </div>
          </div>
          <div class="sp-login-feature">
            <span class="sp-login-dot" />
            <div>
              <span class="sp-login-feature-label">进度跟踪</span>
              <span class="sp-login-feature-desc">开标、评标、结果全程可见</span>
            </div>
          </div>
          <div class="sp-login-feature">
            <span class="sp-login-dot" />
            <div>
              <span class="sp-login-feature-label">信息透明</span>
              <span class="sp-login-feature-desc">公告公示、政策法规随时查阅</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Right: Login Form -->
    <div class="sp-login-form-area">
      <div class="sp-login-form-wrapper">
        <h2 class="sp-form-title">欢迎登录</h2>
        <p class="sp-form-desc">请使用供应商账号登录平台</p>

        <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="handleLogin">
          <el-form-item prop="username">
            <el-input v-model="form.username" placeholder="请输入用户名" prefix-icon="User" />
          </el-form-item>
          <el-form-item prop="password">
            <el-input v-model="form.password" type="password" placeholder="请输入密码" prefix-icon="Lock" show-password />
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="loading" class="sp-login-btn" @click="handleLogin">
              {{ loading ? '登录中...' : '登 录' }}
            </el-button>
          </el-form-item>
        </el-form>

        <div class="sp-form-footer">
          <span class="sp-form-footer-text">还没有账号？</span>
          <router-link to="/register" class="sp-form-footer-link">立即注册供应商</router-link>
        </div>

        <div class="sp-form-test">
          <span>测试: supplier1 / 123456</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sp-login {
  min-height: 100vh;
  display: flex;
  position: relative;
  overflow: hidden;
  background: #0a1e3d;
}

/* ── Wave SVG ── */
.sp-login-waves {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.sp-login-wave-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* ── Left Brand Panel ── */
.sp-login-brand {
  flex: 1.2;
  display: flex;
  align-items: center;
  position: relative;
  z-index: 1;
}

.sp-login-brand-inner {
  padding: 60px 48px 60px 64px;
  max-width: 420px;
}

.sp-login-logo {
  height: 44px;
  width: auto;
  border-radius: 10px;
  object-fit: cover;
}

.sp-login-brand-top {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 36px;
}

.sp-login-brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sp-login-brand-name {
  font-size: 18px;
  font-weight: 900;
  color: #fff;
  letter-spacing: 0.1em;
  font-family: "SimHei", "黑体", sans-serif;
}

.sp-login-brand-en {
  font-size: 7px;
  color: rgba(255, 255, 255, 0.35);
  letter-spacing: 0.05em;
  font-weight: 500;
}

.sp-login-title {
  font-family: "SimHei", "黑体", sans-serif;
  font-size: 38px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.5px;
  line-height: 1.15;
  margin-bottom: 12px;
}

.sp-login-divider {
  width: 32px;
  height: 3px;
  background: #18a56c;
  margin-bottom: 12px;
}

.sp-login-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.35);
  margin-bottom: 48px;
  letter-spacing: 0.05em;
}

.sp-login-features {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.sp-login-feature {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.sp-login-dot {
  width: 6px;
  height: 6px;
  background: #18a56c;
  margin-top: 6px;
  flex-shrink: 0;
  border-radius: 0;
  transform: rotate(45deg);
}

.sp-login-feature-label {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
  margin-bottom: 2px;
}

.sp-login-feature-desc {
  display: block;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
}

/* ── Right Form Panel ── */
.sp-login-form-area {
  flex: 0 0 440px;
  display: flex;
  align-items: center;
  background: #fff;
  position: relative;
  z-index: 2;
  /* Sharp left edge, rounded right */
  border-radius: 0 4px 4px 0;
}

.sp-login-form-wrapper {
  width: 100%;
  max-width: 320px;
  padding: 48px 40px;
}

.sp-form-title {
  font-family: "SimHei", "黑体", sans-serif;
  font-size: 24px;
  font-weight: 800;
  color: var(--sp-gray-900);
  margin-bottom: 4px;
}

.sp-form-desc {
  font-size: 13px;
  color: var(--sp-gray-500);
  margin-bottom: 32px;
}

.sp-login-form-wrapper :deep(.el-input__wrapper) {
  border-radius: 2px;
  padding: 4px 12px;
  box-shadow: 0 0 0 1px var(--sp-border) inset;
}

.sp-login-form-wrapper :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--sp-gray-400) inset;
}

.sp-login-form-wrapper :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--sp-primary) inset;
}

.sp-login-btn {
  width: 100%;
  height: 44px;
  border-radius: 2px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 3px;
  margin-top: 8px;
}

.sp-form-footer {
  text-align: center;
  margin-top: 20px;
  font-size: 13px;
}

.sp-form-footer-text {
  color: var(--sp-gray-500);
}

.sp-form-footer-link {
  color: var(--sp-primary);
  font-weight: 600;
  margin-left: 4px;
  text-decoration: none;
}

.sp-form-footer-link:hover {
  text-decoration: underline;
}

.sp-form-test {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--sp-border-light);
  text-align: center;
  font-size: 11px;
  color: var(--sp-gray-400);
}

/* ── Responsive ── */
@media (max-width: 860px) {
  .sp-login {
    flex-direction: column;
  }

  .sp-login-brand {
    display: none;
  }

  .sp-login-form-area {
    flex: 1;
    border-radius: 0;
  }

  .sp-login-form-wrapper {
    max-width: 100%;
    padding: 48px 24px;
  }
}
</style>
