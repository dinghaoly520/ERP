<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()

const form = reactive({ username: 'supplier1', password: '123456' })
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
    <div class="sp-bg-grad" />
    <div class="sp-top-fade" />

    <main class="sp-shell">
      <section class="sp-copy">
        <div class="sp-brand-row">
          <img src="/logo.jpg" alt="四川水发集团" class="sp-logo" />
          <div>
            <strong class="sp-brand-name">四川水发集团</strong>
            <small class="sp-brand-sub">智慧水发 · 蜀水云采</small>
          </div>
        </div>

        <div class="sp-copy-main">
          <span class="sp-kicker">SUPPLIER PORTAL</span>
          <h1>供应商门户</h1>
          <p>入库协同 · 在线投标 · 全程可追踪</p>
          <div class="sp-tags">
            <span><i />在线投标</span>
            <span><i />进度跟踪</span>
            <span><i />信息透明</span>
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

          <a href="http://localhost:3006" style="text-decoration:none" class="sp-back">← 返回门户</a>
        </div>
        <div class="sp-form-footer">
          <span>还没有账号？</span>
          <router-link to="/register">立即注册供应商</router-link>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.sp-login {
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
  overflow-y: auto;
  background: #f6f9fd;
  color: #0f172a;
  font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
}

.sp-bg-grad {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at 16% 18%, rgba(6,78,162,0.12), transparent 30%),
    radial-gradient(circle at 84% 78%, rgba(16,185,129,0.16), transparent 28%);
}

.sp-top-fade {
  position: absolute;
  inset-x: 0;
  top: 0;
  height: 128px;
  pointer-events: none;
  background: linear-gradient(to bottom, white, transparent);
}

.sp-shell {
  position: relative;
  z-index: 1;
  width: min(100%, 1280px);
  min-height: 100vh;
  margin: 0 auto;
  padding: 32px 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 64px;
}

.sp-copy {
  flex: 1;
  max-width: 640px;
}

.sp-brand-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 92px;
}

.sp-logo {
  height: 48px;
  width: auto;
  border-radius: 16px;
  border: 1px solid #bbf7d0;
  background: #fff;
  object-fit: cover;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
}

.sp-brand-name {
  display: block;
  font-family: "SimHei", "黑体", sans-serif;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.16em;
  color: #0f172a;
}

.sp-brand-sub {
  display: block;
  margin-top: 4px;
  color: #64748b;
  font-size: 12px;
  letter-spacing: 0.2em;
}

.sp-kicker {
  display: inline-flex;
  margin-bottom: 20px;
  border: 1px solid #86efac;
  border-radius: 9999px;
  background: #f0fdf4;
  padding: 6px 16px;
  color: #166534;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.sp-copy-main h1 {
  margin: 0;
  font-family: "SimHei", "黑体", sans-serif;
  font-size: clamp(34px, 5vw, 64px);
  font-weight: 900;
  line-height: 1.08;
  color: #0f172a;
}

.sp-copy-main p {
  margin: 20px 0 0;
  color: #64748b;
  font-size: 16px;
  line-height: 1.8;
}

.sp-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}

.sp-tags span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #bbf7d0;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.84);
  padding: 8px 14px;
  color: #334155;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
}

.sp-tags i {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: #10b981;
}

.sp-form-area {
  flex: 0 0 460px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.sp-form-card {
  width: 100%;
  max-width: 448px;
  border: 1px solid #bbf7d0;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.95);
  padding: 32px 40px;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.10);
  backdrop-filter: blur(12px);
}

@media (min-width: 640px) {
  .sp-form-card { padding: 40px; }
}

.sp-card-accent {
  width: 48px;
  height: 4px;
  margin-bottom: 24px;
  border-radius: 9999px;
  background: #10b981;
}

.sp-form-card h2 {
  margin: 0;
  font-family: "SimHei", "黑体", sans-serif;
  font-size: 24px;
  font-weight: 900;
  color: #0f172a;
}

.sp-form-card > p {
  margin: 8px 0 28px;
  color: #64748b;
  font-size: 14px;
}

.sp-form-card :deep(.el-input__wrapper) {
  min-height: 48px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 0 0 1px #d7e3f2 inset;
}

.sp-form-card :deep(.el-input__wrapper:hover),
.sp-form-card :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #10b981 inset, 0 0 0 4px rgba(16, 185, 129, 0.12);
}

.sp-form-card :deep(.el-input__inner) {
  color: #0f172a;
}

.sp-form-card :deep(.el-input__inner::placeholder) {
  color: #94a3b8;
}

.sp-login-btn {
  width: 100%;
  height: 48px;
  border: 0;
  border-radius: 16px;
  background: linear-gradient(90deg, #064ea2, #10b981);
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0.12em;
  box-shadow: 0 16px 36px rgba(16, 185, 129, 0.25);
}

.sp-back {
  display: inline-flex;
  margin-top: 28px;
  font-size: 14px;
  font-weight: 600;
  color: #64748b;
  transition: color 0.15s;
}

.sp-back:hover {
  color: #10b981;
}

.sp-form-footer {
  margin-top: 16px;
  text-align: center;
  color: #64748b;
  font-size: 14px;
}

.sp-form-footer a {
  margin-left: 4px;
  color: #10b981;
  font-weight: 700;
  text-decoration: none;
}

.sp-form-footer a:hover {
  color: #059669;
}

@media (max-width: 900px) {
  .sp-shell {
    flex-direction: column;
    align-items: stretch;
    gap: 36px;
    padding: 28px 22px 40px;
  }
  .sp-brand-row { margin-bottom: 48px; }
  .sp-form-area { flex: none; }
  .sp-form-card { max-width: none; padding: 24px; }
}
</style>
