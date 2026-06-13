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
  <!-- ━━━ 浅色炫彩毛玻璃 · 浅薄荷 · 背景 bg-hydro-hero-7 · 卡顶艺术字居中 + 交互 ━━━ -->
  <main class="lp lp--supplier">
    <div class="lp-bg" aria-hidden="true" />

    <div class="lp-brand" aria-label="四川水发集团">
      <img src="/logo.jpg" alt="" class="lp-brand-mark" />
      <span class="lp-brand-name">四川水发集团</span>
    </div>

    <section class="lp-showcase" aria-label="产品概览">
      <div class="lp-board">
        <span class="lp-kicker">SUPPLIER PORTAL</span>
        <h2>成为蜀水云采的可靠供应。</h2>
        <p>入库协同 · 在线投标 · 全程可追踪</p>
        <div class="lp-tiles">
          <div class="lp-tile"><strong>协同</strong><small>在线投标与进度跟踪</small></div>
          <div class="lp-tile"><strong>透明</strong><small>信息全程公开可查</small></div>
        </div>
      </div>
    </section>

    <section class="lp-panel" aria-label="登录表单">
      <div class="lp-card">
        <div class="lp-head">
          <div class="lp-brand-word">智慧水发<span class="lp-dot">·</span>蜀水云采</div>
          <h1 class="lp-title">供应商门户</h1>
        </div>

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
            <el-input v-model="form.username" placeholder="请输入用户名" prefix-icon="User" />
          </el-form-item>

          <el-form-item prop="password" class="lp-field">
            <template #label>密码</template>
            <el-input
              v-model="form.password"
              type="password"
              placeholder="请输入密码"
              prefix-icon="Lock"
              show-password
            />
          </el-form-item>

          <el-form-item>
            <button type="button" class="lp-primary" :disabled="loading" @click="handleLogin">
              {{ loading ? '登录中…' : '登 录' }}
            </button>
          </el-form-item>
        </el-form>

        <div class="lp-foot">
          还没有账号？<router-link to="/register">立即注册供应商</router-link>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=ZCOOL+XiaoWei&display=swap');

.lp {
  --tint: oklch(0.975 0.02 var(--hue));
  --ink: oklch(0.26 0.025 var(--hue));
  --muted: #6b787e;
  --line: oklch(0.93 0.015 var(--hue));
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 520px);
  min-height: 100vh;
  isolation: isolate;
  overflow: hidden;
  font-family: 'Manrope', 'Microsoft YaHei', sans-serif;
  color: var(--ink);
  background: var(--tint);
}
.lp--supplier {
  --hue: 155;
}

.lp-bg {
  position: absolute;
  inset: 0;
  z-index: -3;
  background-image: url('/bg-hydro-hero-7.png');
  background-position: center;
  background-size: cover;
  filter: saturate(0.8) contrast(0.92) brightness(1.05);
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
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, rgba(0, 0, 0, 0.03) 40%, rgba(0, 0, 0, 0.3) 68%, rgba(0, 0, 0, 0.85) 92%, #000 100%);
  mask-image: linear-gradient(90deg, transparent 0%, rgba(0, 0, 0, 0.03) 40%, rgba(0, 0, 0, 0.3) 68%, rgba(0, 0, 0, 0.85) 92%, #000 100%);
}
.lp::after {
  z-index: -1;
  background: linear-gradient(90deg, transparent 0%, color-mix(in oklch, var(--tint) 5%, transparent) 42%, color-mix(in oklch, var(--tint) 35%, transparent) 70%, color-mix(in oklch, var(--tint) 92%, white) 100%),
    radial-gradient(circle at 86% 46%, color-mix(in oklch, white 30%, transparent), transparent 42%),
    linear-gradient(90deg, rgba(3, 30, 40, 0.1), transparent 45%);
}

.lp-brand {
  position: fixed;
  top: 26px;
  left: 6vw;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.lp-brand-mark {
  width: 42px;
  height: 42px;
  border-radius: 13px;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 10px 26px rgba(20, 40, 50, 0.18);
}
.lp-brand-name {
  font-family: 'Plus Jakarta Sans', 'Microsoft YaHei', sans-serif;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: #fff;
  text-shadow: 0 6px 22px rgba(0, 0, 0, 0.32);
}

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
  font-size: clamp(40px, 6vw, 70px);
  line-height: 0.96;
  letter-spacing: -0.01em;
  text-shadow: 0 14px 50px rgba(0, 0, 0, 0.4);
}
.lp-board p {
  margin: 0;
  color: rgba(255, 255, 255, 0.94);
  font-size: 16px;
  line-height: 1.6;
  max-width: 30ch;
  text-shadow: 0 8px 30px rgba(0, 0, 0, 0.34);
}
.lp-tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 8px;
}
.lp-tile {
  min-height: 102px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(16px);
  box-shadow: 0 16px 38px rgba(0, 0, 0, 0.09);
}
.lp-tile strong {
  display: block;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 22px;
  font-weight: 800;
  color: var(--ink);
}
.lp-tile small {
  color: #5c746b;
  font-size: 12px;
  line-height: 1.45;
}

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
  position: relative;
  width: min(440px, 100%);
  padding: 36px 32px 30px;
  border-radius: 26px;
  background: radial-gradient(circle at 92% 0%, color-mix(in oklch, oklch(0.93 0.055 var(--hue)) 38%, transparent), transparent 36%),
    radial-gradient(circle at 4% 96%, color-mix(in oklch, oklch(0.93 0.045 calc(var(--hue) + 80)) 32%, transparent), transparent 34%),
    linear-gradient(160deg, rgba(255, 255, 255, 0.74), rgba(255, 255, 255, 0.54));
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  box-shadow: 0 24px 60px color-mix(in oklch, oklch(0.5 0.05 var(--hue)) 13%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  animation: lp-rise 0.58s var(--ease) backwards;
  transition: transform 0.35s var(--ease), box-shadow 0.35s var(--ease);
}
@keyframes lp-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
.lp-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 32px 70px color-mix(in oklch, oklch(0.5 0.05 var(--hue)) 20%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}
.lp-card:hover::before {
  filter: saturate(1.3) brightness(1.05);
}
.lp-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1.2px;
  pointer-events: none;
  background: linear-gradient(135deg, color-mix(in oklch, oklch(0.9 0.06 var(--hue)) 78%, white), rgba(255, 255, 255, 0.72) 46%, color-mix(in oklch, oklch(0.9 0.05 calc(var(--hue) + 90)) 70%, white));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  transition: filter 0.35s var(--ease);
}

.lp-head {
  margin-bottom: 26px;
  text-align: center;
}
.lp-brand-word {
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'ZCOOL XiaoWei', 'Microsoft YaHei', serif;
  font-size: 24px;
  font-weight: 400;
  letter-spacing: 0.08em;
  color: oklch(0.46 0.09 var(--hue));
  margin-bottom: 10px;
}
.lp-brand-word .lp-dot {
  font-size: 24px;
  line-height: 1;
  margin: 0 6px;
  opacity: 0.55;
}
.lp-title {
  margin: 0;
  font-family: 'Plus Jakarta Sans', 'Microsoft YaHei', sans-serif;
  font-size: 30px;
  font-weight: 800;
  line-height: 1.1;
  color: oklch(0.26 0.04 var(--hue));
  letter-spacing: -0.01em;
}

/* Element Plus 表单接管 */
.lp-form :deep(.el-form-item) {
  margin-bottom: 16px;
}
.lp-form :deep(.el-form-item__label) {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: color-mix(in oklch, var(--ink) 82%, #000);
  padding-bottom: 8px;
  line-height: 1;
  transition: color 0.2s var(--ease);
}
.lp-form :deep(.el-input__wrapper) {
  height: 54px;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.62);
  box-shadow: 0 0 0 1px var(--line) inset;
  transition: box-shadow 0.2s var(--ease), background 0.2s var(--ease);
}
.lp-form :deep(.el-input__wrapper:hover) {
  background: rgba(255, 255, 255, 0.74);
  box-shadow: 0 0 0 1px oklch(0.7 0.06 var(--hue)) inset;
}
.lp-form :deep(.el-input__wrapper.is-focus) {
  background: #fff;
  box-shadow: 0 0 0 1px oklch(0.66 0.08 var(--hue)) inset, 0 0 0 4px color-mix(in oklch, oklch(0.78 0.08 var(--hue)) 16%, transparent);
}
.lp-form :deep(.el-input__inner) {
  color: var(--ink);
  font-family: inherit;
  font-size: 14.5px;
}
.lp-form :deep(.el-input__inner::placeholder) {
  color: oklch(0.66 0.018 var(--hue));
}
.lp-form :deep(.el-input__prefix) {
  color: oklch(0.58 0.06 var(--hue));
  margin: 0 6px 0 4px;
  transition: color 0.2s var(--ease), transform 0.2s var(--ease);
}
.lp-field:focus-within :deep(.el-input__prefix) {
  color: oklch(0.5 0.1 var(--hue));
  transform: scale(1.12);
}
.lp-field:focus-within :deep(.el-form-item__label) {
  color: oklch(0.5 0.1 var(--hue));
}
.lp-form :deep(.el-form-item__error) {
  font-size: 12px;
}

.lp-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 54px;
  margin-top: 4px;
  border: 1px solid color-mix(in oklch, oklch(0.8 0.06 var(--hue)) 50%, white);
  border-radius: 15px;
  color: oklch(0.32 0.07 var(--hue));
  background: linear-gradient(135deg, oklch(0.93 0.055 var(--hue)), oklch(0.91 0.048 calc(var(--hue) + 24)));
  box-shadow: 0 10px 24px color-mix(in oklch, oklch(0.5 0.05 var(--hue)) 14%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.65);
  font-family: inherit;
  font-weight: 800;
  font-size: 15px;
  letter-spacing: 0.16em;
  cursor: pointer;
  transition: transform 0.2s var(--ease), filter 0.2s var(--ease), box-shadow 0.2s var(--ease);
}
.lp-primary::after {
  content: '';
  position: absolute;
  top: 0;
  left: -130%;
  width: 55%;
  height: 100%;
  background: linear-gradient(120deg, transparent, rgba(255, 255, 255, 0.6), transparent);
  transform: skewX(-18deg);
  pointer-events: none;
  transition: left 0.65s var(--ease);
}
.lp-primary:hover {
  transform: translateY(-2px);
  filter: brightness(1.03);
  box-shadow: 0 14px 30px color-mix(in oklch, oklch(0.5 0.06 var(--hue)) 20%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.65);
}
.lp-primary:hover::after {
  left: 130%;
}
.lp-primary:disabled {
  cursor: wait;
  opacity: 0.7;
  transform: none;
}

.lp-foot {
  margin-top: 14px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
.lp-foot a {
  color: oklch(0.42 0.08 var(--hue));
  font-weight: 700;
  text-decoration: none;
}
.lp-foot a:hover {
  text-decoration: underline;
}

/* 入场逐项淡入 */
.lp-head,
.lp-field,
.lp-primary,
.lp-foot {
  animation: lp-up 0.5s var(--ease) backwards;
}
.lp-head {
  animation-delay: 0.06s;
}
.lp-field:nth-of-type(1) {
  animation-delay: 0.14s;
}
.lp-field:nth-of-type(2) {
  animation-delay: 0.22s;
}
.lp-primary {
  animation-delay: 0.3s;
}
.lp-foot {
  animation-delay: 0.38s;
}
@keyframes lp-up {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 860px) {
  .lp {
    grid-template-columns: 1fr;
  }
  .lp::before {
    backdrop-filter: blur(14px) saturate(1.2);
    -webkit-mask-image: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.04) 38%, rgba(0, 0, 0, 0.4) 64%, rgba(0, 0, 0, 0.9) 100%);
    mask-image: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.04) 38%, rgba(0, 0, 0, 0.4) 64%, rgba(0, 0, 0, 0.9) 100%);
  }
  .lp::after {
    background: linear-gradient(180deg, transparent 0%, color-mix(in oklch, var(--tint) 8%, transparent) 40%, color-mix(in oklch, var(--tint) 45%, transparent) 72%, color-mix(in oklch, var(--tint) 92%, white) 100%),
      radial-gradient(circle at 50% 78%, color-mix(in oklch, white 28%, transparent), transparent 40%);
  }
  .lp-brand {
    top: 18px;
    left: 18px;
  }
  .lp-panel {
    grid-column: 1;
    grid-row: 2;
    align-items: stretch;
    min-height: auto;
    padding: 80px 18px 28px;
  }
  .lp-showcase {
    grid-column: 1;
    grid-row: 1;
    min-height: 40vh;
    padding: 80px 18px 18px;
  }
}
</style>
