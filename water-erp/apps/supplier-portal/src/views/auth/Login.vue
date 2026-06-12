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
    <div class="sp-bg-grid" />
    <div class="sp-bg-orb sp-bg-orb-a" />
    <div class="sp-bg-orb sp-bg-orb-b" />

    <section class="sp-hero">
      <div class="sp-brand-row">
        <img src="/logo.jpg" alt="四川水发集团" class="sp-logo" />
        <div>
          <strong class="sp-brand-name">四川水发集团</strong>
          <small class="sp-brand-sub">智慧水发 · 蜀水云采</small>
        </div>
      </div>

      <div class="sp-hero-copy">
        <span class="sp-kicker">SUPPLIER COLLABORATION PORTAL</span>
        <h1>供应商门户</h1>
        <p>入库协同 · 在线投标 · 全程可追踪</p>
      </div>

      <div class="sp-flow-panel">
        <div v-for="item in ['入库', '投标', '开标', '结果']" :key="item" class="sp-flow-node">
          <span />
          {{ item }}
        </div>
      </div>

      <div class="sp-feature-grid">
        <div class="sp-feature-card">
          <span class="sp-feature-dot" />
          <strong>在线投标</strong>
          <small>实时获取招标信息，高效提交资料</small>
        </div>
        <div class="sp-feature-card">
          <span class="sp-feature-dot" />
          <strong>进度跟踪</strong>
          <small>开标、评标、结果全流程可见</small>
        </div>
        <div class="sp-feature-card">
          <span class="sp-feature-dot" />
          <strong>信息透明</strong>
          <small>公告公示、政策法规随时查阅</small>
        </div>
      </div>
    </section>

    <section class="sp-form-area">
      <div class="sp-form-card">
        <div class="sp-card-accent" />
        <h2>供应商登录</h2>
        <p>进入供应商协同服务平台</p>

        <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="handleLogin">
          <el-form-item prop="username">
            <el-input v-model="form.username" placeholder="请输入用户名" prefix-icon="User" />
          </el-form-item>
          <el-form-item prop="password">
            <el-input v-model="form.password" type="password" placeholder="请输入密码" prefix-icon="Lock" show-password />
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="loading" class="sp-login-btn" @click="handleLogin">
              {{ loading ? '登录中...' : '登录门户' }}
            </el-button>
          </el-form-item>
        </el-form>

        <div class="sp-form-footer">
          <span>还没有账号？</span>
          <router-link to="/register">立即注册供应商</router-link>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sp-login {
  min-height: 100vh;
  position: relative;
  display: flex;
  overflow: hidden;
  background: radial-gradient(circle at 18% 20%, rgba(34, 211, 238, 0.2), transparent 30%),
    radial-gradient(circle at 82% 74%, rgba(16, 185, 129, 0.24), transparent 28%),
    linear-gradient(135deg, #061427 0%, #08244a 54%, #050b18 100%);
  color: #fff;
}

.sp-bg-grid {
  position: absolute;
  inset: 0;
  opacity: 0.32;
  background-image: linear-gradient(rgba(125, 211, 252, 0.12) 1px, transparent 1px),
    linear-gradient(90deg, rgba(125, 211, 252, 0.12) 1px, transparent 1px);
  background-size: 36px 36px;
}

.sp-bg-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(2px);
  pointer-events: none;
}

.sp-bg-orb-a {
  left: 9%;
  top: 17%;
  width: 260px;
  height: 260px;
  border: 1px solid rgba(34, 211, 238, 0.22);
}

.sp-bg-orb-b {
  right: 11%;
  bottom: 13%;
  width: 320px;
  height: 320px;
  border: 1px solid rgba(16, 185, 129, 0.18);
}

.sp-hero {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 48px 72px;
}

.sp-brand-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.sp-logo {
  height: 52px;
  width: auto;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  object-fit: cover;
  box-shadow: 0 0 32px rgba(34, 211, 238, 0.16);
}

.sp-brand-name {
  display: block;
  font-family: "SimHei", "黑体", sans-serif;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0.16em;
}

.sp-brand-sub {
  display: block;
  margin-top: 5px;
  color: rgba(203, 213, 225, 0.52);
  font-size: 10px;
  letter-spacing: 0.22em;
}

.sp-hero-copy {
  max-width: 620px;
}

.sp-kicker {
  display: inline-flex;
  margin-bottom: 20px;
  border: 1px solid rgba(16, 185, 129, 0.34);
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.1);
  padding: 7px 14px;
  color: rgba(187, 247, 208, 0.88);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.2em;
}

.sp-hero-copy h1 {
  margin: 0;
  font-family: "SimHei", "黑体", sans-serif;
  font-size: clamp(42px, 5vw, 76px);
  font-weight: 900;
  line-height: 1.02;
}

.sp-hero-copy p {
  margin: 24px 0 0;
  color: rgba(203, 213, 225, 0.78);
  font-size: 16px;
  letter-spacing: 0.06em;
}

.sp-flow-panel {
  position: absolute;
  right: 10%;
  top: 25%;
  display: grid;
  gap: 14px;
  width: 170px;
}

.sp-flow-node {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  padding: 12px 14px;
  color: rgba(255, 255, 255, 0.84);
  font-size: 13px;
  backdrop-filter: blur(14px);
}

.sp-flow-node span,
.sp-feature-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #10b981;
  box-shadow: 0 0 18px rgba(16, 185, 129, 0.8);
}

.sp-feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  max-width: 720px;
}

.sp-feature-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.055);
  padding: 18px;
  backdrop-filter: blur(14px);
}

.sp-feature-card strong {
  display: block;
  margin-top: 12px;
  font-size: 15px;
}

.sp-feature-card small {
  display: block;
  margin-top: 6px;
  color: rgba(203, 213, 225, 0.56);
  line-height: 1.6;
}

.sp-form-area {
  position: relative;
  z-index: 2;
  flex: 0 0 480px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
}

.sp-form-card {
  width: 100%;
  max-width: 370px;
  border: 1px solid rgba(186, 230, 253, 0.16);
  border-radius: 30px;
  background: rgba(8, 20, 40, 0.72);
  padding: 36px;
  box-shadow: 0 30px 100px rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(22px);
}

.sp-card-accent {
  width: 56px;
  height: 4px;
  margin-bottom: 24px;
  border-radius: 999px;
  background: linear-gradient(90deg, #10b981, #22d3ee);
}

.sp-form-card h2 {
  margin: 0;
  font-family: "SimHei", "黑体", sans-serif;
  font-size: 26px;
  font-weight: 900;
}

.sp-form-card p {
  margin: 9px 0 30px;
  color: rgba(203, 213, 225, 0.64);
  font-size: 14px;
}

.sp-form-card :deep(.el-input__wrapper) {
  min-height: 48px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.07);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12) inset;
}

.sp-form-card :deep(.el-input__wrapper:hover),
.sp-form-card :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.72) inset, 0 0 0 4px rgba(34, 211, 238, 0.12);
}

.sp-form-card :deep(.el-input__inner) {
  color: #fff;
}

.sp-form-card :deep(.el-input__inner::placeholder) {
  color: rgba(255, 255, 255, 0.32);
}

.sp-login-btn {
  width: 100%;
  height: 48px;
  border: 0;
  border-radius: 16px;
  background: linear-gradient(90deg, #064ea2, #10b981, #22d3ee);
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.18em;
  box-shadow: 0 18px 45px rgba(16, 185, 129, 0.25);
}

.sp-form-footer {
  margin-top: 22px;
  text-align: center;
  color: rgba(203, 213, 225, 0.58);
  font-size: 13px;
}

.sp-form-footer a {
  margin-left: 5px;
  color: #67e8f9;
  font-weight: 800;
  text-decoration: none;
}

.sp-form-footer a:hover {
  color: #a7f3d0;
}

@media (max-width: 1024px) {
  .sp-login {
    flex-direction: column;
  }

  .sp-hero {
    padding: 32px 28px;
  }

  .sp-flow-panel {
    display: none;
  }

  .sp-feature-grid {
    grid-template-columns: 1fr;
  }

  .sp-form-area {
    flex: none;
    width: 100%;
    padding: 0 24px 36px;
  }
}
</style>
