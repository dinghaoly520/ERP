<script setup lang="ts">
import { onMounted, ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()

const form = reactive({ username: 'supplier1', password: 'supplier1@2026' })
const loading = ref(false)
const formRef = ref()
const showPwd = ref(false)

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码不少于6位', trigger: 'blur' },
  ],
}

onMounted(async () => {
  if (router.currentRoute.value.query.forceLogin !== '1') return
  await authStore.logout()
})

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
  <!-- ━━━ 清爽产品风 · 水绿玻璃 · 背景 bg-hydro-hero-7 ━━━ -->
  <main class="lp">
    <div class="lp-bg" aria-hidden="true" />

    <div class="lp-brand" aria-label="蜀水云采">
      <img src="/logo.jpg" alt="" class="lp-brand-mark" />
      蜀水云采
    </div>

    <section class="lp-showcase" aria-label="产品概览">
      <div class="lp-board">
        <span class="lp-kicker">SUPPLIER PORTAL</span>
        <h2>成为蜀水云采的可靠供应。</h2>
        <p>入库协同 · 在线投标 · 全程可追踪</p>
        <div class="lp-tiles">
          <div class="lp-tile">
            <strong>协同</strong>
            <small>在线投标与进度跟踪</small>
          </div>
          <div class="lp-tile">
            <strong>透明</strong>
            <small>信息全程公开可查</small>
          </div>
        </div>
      </div>
    </section>

    <section class="lp-panel" aria-label="登录表单">
      <div class="lp-card">
        <h2>供应商登录</h2>
        <p class="lp-sub">进入供应商协同服务平台。</p>

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-position="top"
          class="lp-form"
          @keyup.enter="handleLogin"
        >
          <el-form-item prop="username" class="lp-field">
            <template #label>用户名</template>
            <el-input v-model="form.username" placeholder="请输入用户名" />
          </el-form-item>

          <el-form-item prop="password" class="lp-field">
            <template #label>密码</template>
            <el-input
              v-model="form.password"
              :type="showPwd ? 'text' : 'password'"
              placeholder="请输入密码"
            >
              <template #suffix>
                <button type="button" class="lp-eye" :aria-label="showPwd ? '隐藏密码' : '显示密码'" @click="showPwd = !showPwd">
                  {{ showPwd ? '●' : '○' }}
                </button>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item>
            <button type="button" class="lp-primary" :disabled="loading" @click="handleLogin">
              {{ loading ? '登录中…' : '登录门户' }}
            </button>
          </el-form-item>
        </el-form>

        <div class="lp-divider">测试账号　supplier1 / supplier1@2026</div>

        <div class="lp-foot">
          还没有账号？<router-link to="/register">立即注册供应商</router-link>
          <a class="lp-back" href="http://localhost:3006">← 返回门户</a>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap');

.lp {
  --ink: #09251d;
  --muted: #587269;
  --green: #0f7b54;
  --green-deep: #064635;
  --mist: #eef6f0;
  --line: rgba(9, 37, 29, 0.14);
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 520px);
  min-height: 100vh;
  isolation: isolate;
  overflow: hidden;
  font-family: 'Manrope', 'Microsoft YaHei', sans-serif;
  color: var(--ink);
  background: var(--mist);
}

.lp-bg {
  position: absolute;
  inset: 0;
  z-index: -3;
  background-image: url('/bg-hydro-hero-7.png');
  background-position: center;
  background-size: cover;
  filter: saturate(0.72) contrast(0.88) brightness(1.08);
  transform: scale(1.04);
}

.lp::before,
.lp::after {
  position: absolute;
  inset: 0;
  content: '';
  pointer-events: none;
}
.lp::before {
  z-index: -2;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, rgba(0, 0, 0, 0.14) 38%, rgba(0, 0, 0, 0.72) 68%, #000 100%);
  mask-image: linear-gradient(90deg, transparent 0%, rgba(0, 0, 0, 0.14) 38%, rgba(0, 0, 0, 0.72) 68%, #000 100%);
}
.lp::after {
  z-index: -1;
  background: linear-gradient(90deg, rgba(238, 246, 240, 0.08) 0%, rgba(238, 246, 240, 0.24) 34%, rgba(238, 246, 240, 0.64) 66%, rgba(238, 246, 240, 0.9) 100%),
    radial-gradient(circle at 84% 50%, rgba(255, 255, 255, 0.64), transparent 34%),
    linear-gradient(90deg, rgba(3, 34, 24, 0.3), transparent 42%);
}

.lp-brand {
  position: fixed;
  top: 28px;
  right: 6vw;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 900;
  letter-spacing: 0.02em;
  font-family: 'Plus Jakarta Sans', 'Microsoft YaHei', sans-serif;
}
.lp-brand-mark {
  width: 36px;
  height: 36px;
  border-radius: 13px;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 14px 30px rgba(15, 123, 84, 0.24);
}

/* 左侧展示 */
.lp-showcase {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  min-height: 100vh;
  padding: 96px 24px 48px 6vw;
}
.lp-board {
  display: grid;
  width: min(540px, 100%);
  gap: 14px;
  animation: lp-in 0.7s var(--ease) 0.12s both;
}
@keyframes lp-in {
  from { opacity: 0; transform: translateX(22px); }
  to { opacity: 1; transform: translateX(0); }
}
.lp-kicker {
  justify-self: start;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(8px);
  padding: 7px 16px;
  color: #effaf3;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.2em;
}
.lp-board h2 {
  margin: 0;
  color: #fff;
  font-family: 'Plus Jakarta Sans', 'Microsoft YaHei', sans-serif;
  font-size: clamp(40px, 6vw, 72px);
  line-height: 0.95;
  letter-spacing: -0.01em;
  text-shadow: 0 14px 50px rgba(0, 0, 0, 0.34);
}
.lp-board p {
  margin: 0;
  color: rgba(255, 255, 255, 0.92);
  font-size: 16px;
  line-height: 1.6;
  max-width: 30ch;
  text-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
}
.lp-tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 8px;
}
.lp-tile {
  min-height: 104px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.42);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(16px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.1);
}
.lp-tile strong {
  display: block;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 22px;
  font-weight: 800;
}
.lp-tile small {
  color: #5c746b;
  font-size: 12px;
  line-height: 1.45;
}

/* 右侧表单 */
.lp-panel {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
  padding: 96px 6vw 40px 32px;
}
.lp-card {
  width: min(440px, 100%);
  padding: 30px;
  border: 1px solid rgba(9, 37, 29, 0.12);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 24px 70px rgba(20, 58, 44, 0.18);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  animation: lp-rise 0.58s var(--ease) both;
}
@keyframes lp-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
.lp-card h2 {
  margin: 0;
  font-family: 'Plus Jakarta Sans', 'Microsoft YaHei', sans-serif;
  font-size: 30px;
  line-height: 1;
}
.lp-sub {
  margin: 12px 0 22px;
  color: var(--muted);
  line-height: 1.55;
  font-size: 14px;
}

/* Element Plus 表单接管 */
.lp-form :deep(.el-form-item) {
  margin-bottom: 16px;
}
.lp-form :deep(.el-form-item__label) {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink);
  padding-bottom: 8px;
  line-height: 1;
}
.lp-form :deep(.el-input__wrapper) {
  height: 52px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.74);
  box-shadow: 0 0 0 1px var(--line) inset;
  transition: box-shadow 0.2s var(--ease), background 0.2s var(--ease);
}
.lp-form :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px rgba(15, 123, 84, 0.45) inset;
}
.lp-form :deep(.el-input__wrapper.is-focus) {
  background: #fff;
  box-shadow: 0 0 0 1px rgba(15, 123, 84, 0.62) inset, 0 0 0 4px rgba(15, 123, 84, 0.14);
}
.lp-form :deep(.el-input__inner) {
  color: var(--ink);
  font-family: inherit;
  font-size: 14px;
}
.lp-form :deep(.el-input__inner::placeholder) {
  color: rgba(9, 37, 29, 0.46);
}
.lp-form :deep(.el-form-item__error) {
  font-size: 12px;
}

.lp-eye {
  width: 32px;
  height: 32px;
  margin: -10px -4px 0 0;
  border: 0;
  border-radius: 50%;
  color: var(--green-deep);
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.lp-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 54px;
  border: 0;
  border-radius: 16px;
  color: #effaf3;
  background: var(--green);
  box-shadow: 0 18px 36px rgba(15, 123, 84, 0.24);
  font-family: inherit;
  font-weight: 800;
  font-size: 15px;
  cursor: pointer;
  transition: transform 0.2s var(--ease), filter 0.2s var(--ease);
}
.lp-primary:hover {
  transform: translateY(-2px);
  filter: saturate(1.08);
}
.lp-primary:disabled {
  cursor: wait;
  opacity: 0.78;
  transform: none;
}

.lp-divider {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  margin: 4px 0 18px;
  color: #6d817b;
  font-size: 12px;
}
.lp-divider::before,
.lp-divider::after {
  content: '';
  height: 1px;
  background: currentColor;
  opacity: 0.22;
}

.lp-foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: #607870;
  font-size: 13px;
}
.lp-foot a {
  color: var(--green);
  font-weight: 700;
  text-decoration: none;
}
.lp-foot a:hover {
  color: var(--green-deep);
}
.lp-back {
  font-weight: 600 !important;
  color: #607870 !important;
}
.lp-back:hover {
  color: var(--green-deep) !important;
}

@media (max-width: 860px) {
  .lp {
    grid-template-columns: 1fr;
  }
  .lp::before {
    backdrop-filter: blur(14px);
    -webkit-mask-image: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.18) 34%, rgba(0, 0, 0, 0.8) 62%, #000 100%);
    mask-image: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.18) 34%, rgba(0, 0, 0, 0.8) 62%, #000 100%);
  }
  .lp::after {
    background: linear-gradient(180deg, rgba(238, 246, 240, 0.14) 0%, rgba(238, 246, 240, 0.28) 36%, rgba(238, 246, 240, 0.8) 70%, rgba(238, 246, 240, 0.94) 100%),
      radial-gradient(circle at 50% 76%, rgba(255, 255, 255, 0.64), transparent 34%);
  }
  .lp-brand {
    top: 20px;
    right: 18px;
  }
  .lp-panel {
    grid-column: 1;
    grid-row: 2;
    align-items: stretch;
    min-height: auto;
    padding: 84px 18px 24px;
  }
  .lp-showcase {
    grid-column: 1;
    grid-row: 1;
    min-height: 44vh;
    padding: 90px 18px 24px;
  }
}
</style>
