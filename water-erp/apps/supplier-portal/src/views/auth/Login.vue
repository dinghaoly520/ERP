<script setup lang="ts">
import { onMounted, ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api/auth'
import { ElMessage } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()

// 不预填任何演示账号——硬编码真实种子凭证会让访客一键登录他企，属安全事故。
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

onMounted(async () => {
  if (router.currentRoute.value.query.forceLogin !== '1') return
  await authStore.logout()
})

async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    const result = await authStore.login(form.username, form.password)
    if (result === 'ok') {
      router.push('/dashboard')
    } else if (result === 'invalid') {
      ElMessage.error('用户名或密码错误')
    } else if (result === 'expired') {
      ElMessage.error('临时供应商有效期已过，请联系采购中心续期')
    }
    // result === 'pending'：不弹错，登录页凭 pendingInfo 展示「查询审核进度」面板
  } catch {
    ElMessage.error('登录失败，请检查账号密码')
  } finally {
    loading.value = false
  }
}

// 注册审核进度查询（无需登录）——配合后端 ACCOUNT_PENDING 拦截提示，
// 让被供应商在审批前能看到自己的审核状态，而非被无声锁在门外。
const showQuery = ref(false)
const queryCode = ref('')
const querying = ref(false)
const queryResult = ref<{ found: boolean; name?: string | null; status?: string | null; reason?: string | null } | null>(null)
const STATUS_TEXT: Record<string, string> = {
  PENDING: '待审核：您的注册申请正在审核中，请耐心等待。',
  RETURNED: '退回补正：申请被退回，请按原因补充材料后重新提交。',
  APPROVED: '已通过：账号已激活，请使用注册账号登录。',
  DISABLED: '已停用：账号已被停用，如有疑问请联系采购中心。',
  BLACKLIST: '已拉黑：账号已被列入黑名单，如有疑问请联系采购中心。', // 键须与后端枚举 SupplierStatus.BLACKLIST 一致
}
function openQuery() {
  showQuery.value = true
  queryResult.value = null
}
async function handleQueryStatus() {
  const code = queryCode.value.trim()
  if (!code) { ElMessage.warning('请输入统一社会信用代码'); return }
  querying.value = true
  queryResult.value = null
  try {
    const res = await authApi.getRegisterStatusPublic(code) as any
    queryResult.value = res
  } catch {
    ElMessage.error('查询失败，请稍后重试')
  } finally {
    querying.value = false
  }
}
</script>

<template>
  <!-- ━━━ 品牌蓝 · 新拟态登录卡 · 水纹氛围背景 · 禁硬编码凭证 · ACCOUNT_PENDING 闭环 ━━━ -->
  <main class="lp lp--supplier">
    <div class="lp-bg" aria-hidden="true" />

    <div class="lp-brand" aria-label="智慧水发 · 蜀水云采">
      <img src="/logo.png" alt="" class="lp-brand-mark" />
      <span class="lp-brand-name">智慧水发 · 蜀水云采</span>
    </div>

    <section class="lp-panel" aria-label="登录表单">
      <div class="lp-card">
        <div class="lp-head">
          <div class="lp-brand-word">智慧水发<span class="lp-dot">·</span>蜀水云采</div>
          <div class="lp-divider" aria-hidden="true">◆</div>
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

        <!-- 待审核拦截提示 + 审核进度查询（A4 闭环） -->
        <div v-if="authStore.pendingInfo || showQuery" class="lp-pending">
          <p v-if="authStore.pendingInfo" class="lp-pending__hint">
            该账号尚未激活（待审核或已停用）。可凭统一社会信用代码查询审核进度：
          </p>
          <div class="lp-query">
            <el-input v-model="queryCode" placeholder="统一社会信用代码（18 位）" maxlength="18" @keyup.enter="handleQueryStatus" />
            <button type="button" class="lp-secondary" :disabled="querying" @click="handleQueryStatus">
              {{ querying ? '查询中…' : '查询进度' }}
            </button>
          </div>
          <div v-if="queryResult" class="lp-query__result">
            <template v-if="queryResult.found">
              <strong>{{ queryResult.name }}</strong>
              <span>— {{ STATUS_TEXT[queryResult.status as string] || queryResult.status }}</span>
              <span v-if="queryResult.reason" class="lp-query__reason">原因：{{ queryResult.reason }}</span>
            </template>
            <template v-else>未查询到该信用代码对应的注册记录，请核对后重试，或先完成注册。</template>
          </div>
        </div>

        <div class="lp-foot">
          <a href="#" class="lp-foot-link" @click.prevent="openQuery">查询审核进度 / 忘记密码？</a>
        </div>

        <!-- 注册入口：正式 / 临时（凭邀请码） -->
        <div class="lp-register-entry">
          <router-link to="/register" class="lp-reg-btn lp-reg-btn--primary">正式注册供应商</router-link>
          <div class="lp-reg-divider"><span>或</span></div>
          <router-link to="/register-temporary" class="lp-reg-btn lp-reg-btn--temp">凭邀请码 · 临时注册</router-link>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Serif+SC:wght@500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap');

/* Brand-blue theme (was mint hue 155 → glass). Calm navy/ice, neumorphic card. */
.lp {
  --tint: oklch(0.975 0.02 var(--hue));
  --ink: oklch(0.26 0.03 var(--hue));
  --muted: #64748b;
  --line: oklch(0.9 0.02 var(--hue));
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 640px;
  min-height: 100vh;
  isolation: isolate;
  overflow: hidden;
  font-family: 'Manrope', 'Microsoft YaHei', sans-serif;
  color: var(--ink);
  background: var(--tint);
}
.lp--supplier { --hue: 252; }

/* Water-texture atmosphere (kept as hero backdrop; tinted brand-blue via --hue) */
.lp-bg {
  position: absolute; inset: 0; z-index: -3;
  background-image: url('/bg-hydro-hero-7.png');
  background-position: center; background-size: cover;
  filter: saturate(0.7) contrast(0.92) brightness(1.02);
  transform: scale(1.04);
}
.lp::before, .lp::after { position: absolute; inset: 0; content: ''; pointer-events: none; }
.lp::before {
  z-index: -2;
  backdrop-filter: blur(16px) saturate(1.1);
  -webkit-backdrop-filter: blur(16px) saturate(1.1);
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.03) 40%, rgba(0,0,0,0.3) 68%, rgba(0,0,0,0.85) 92%, #000 100%);
  mask-image: linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.03) 40%, rgba(0,0,0,0.3) 68%, rgba(0,0,0,0.85) 92%, #000 100%);
}
.lp::after {
  z-index: -1;
  background:
    linear-gradient(90deg, transparent 0%, color-mix(in oklch, var(--tint) 5%, transparent) 42%, color-mix(in oklch, var(--tint) 40%, transparent) 70%, color-mix(in oklch, var(--tint) 94%, white) 100%),
    radial-gradient(circle at 86% 46%, color-mix(in oklch, white 26%, transparent), transparent 42%);
}

.lp-brand { position: fixed; top: 26px; left: 6vw; z-index: 3; display: inline-flex; align-items: center; gap: 12px; }
.lp-brand-mark {
  width: 54px; height: 54px; border-radius: 15px; object-fit: cover;
  background: #fff; padding: 5px; box-sizing: border-box;
  box-shadow: 4px 4px 12px oklch(0.3 0.05 252 / 0.3), -2px -2px 8px oklch(1 0 0 / 0.4);
}
.lp-brand-name {
  font-family: 'Plus Jakarta Sans', 'Microsoft YaHei', sans-serif;
  font-size: 22px; font-weight: 800; letter-spacing: 0.05em; color: #fff;
  text-shadow: 0 6px 22px rgba(0, 0, 0, 0.32);
}

.lp-panel {
  grid-column: 2; grid-row: 1; display: flex; min-height: 100vh;
  flex-direction: column; justify-content: center; align-items: flex-end;
  padding: 96px 150px 40px 32px;
}

/* Neumorphic raised card (no glass backdrop, no conic edge, no gradient ring border) */
.lp-card {
  position: relative; width: 440px; padding: 52px 34px 44px; border-radius: 24px;
  background: linear-gradient(180deg, oklch(0.995 0.01 252), oklch(0.965 0.018 252));
  box-shadow:
    12px 12px 30px oklch(0.42 0.05 252 / 0.16),
    -9px -9px 24px oklch(1 0 0 / 0.92),
    inset 0 1px 0 oklch(1 0 0 / 0.85);
  animation: lp-rise 0.58s var(--ease) backwards;
  transition: transform 0.35s var(--ease), box-shadow 0.35s var(--ease);
}
@keyframes lp-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
.lp-card:hover {
  transform: translateY(-3px);
  box-shadow:
    16px 16px 38px oklch(0.42 0.05 252 / 0.2),
    -11px -11px 28px oklch(1 0 0 / 0.95),
    inset 0 1px 0 oklch(1 0 0 / 0.9);
}

.lp-head { margin-bottom: 26px; text-align: center; }
.lp-brand-word {
  display: block;
  font-family: 'Plus Jakarta Sans', 'Microsoft YaHei', sans-serif;
  font-size: 34px; font-weight: 800; line-height: 1.1; letter-spacing: -0.01em;
  color: var(--brand-deep, oklch(0.42 0.13 252));
  text-align: center; margin: 0 -34px; padding: 6px 34px;
}
.lp-brand-word .lp-dot { font-size: 26px; line-height: 1; margin: 0 8px; opacity: 0.5; color: var(--brand, oklch(0.55 0.16 252)); }
.lp-divider {
  display: flex; align-items: center; justify-content: center;
  width: 168px; margin: 18px auto 4px; color: oklch(0.55 0.12 var(--hue)); font-size: 9px; line-height: 1;
}
.lp-divider::before, .lp-divider::after { content: ''; flex: 1; height: 1px; }
.lp-divider::before { background: linear-gradient(90deg, transparent, oklch(0.6 0.1 var(--hue))); margin-right: 10px; }
.lp-divider::after { background: linear-gradient(270deg, transparent, oklch(0.6 0.1 var(--hue))); margin-left: 10px; }
.lp-title {
  margin: 0; font-family: 'Songti SC', 'STSong', 'SimSun', 'Noto Serif SC', serif;
  font-size: 28px; font-weight: 600; line-height: 1.2; color: oklch(0.32 0.05 var(--hue));
  letter-spacing: 0.14em; text-align: center;
}

/* Element Plus form — concave neumorphic inputs */
.lp-form :deep(.el-form-item) { margin-bottom: 20px; }
.lp-form :deep(.el-form-item__label) {
  font-size: 13px; font-weight: 800; letter-spacing: 0.06em;
  color: color-mix(in oklch, var(--ink) 82%, #000); padding-bottom: 8px; line-height: 1; transition: color 0.2s var(--ease);
}
.lp-form :deep(.el-input__wrapper) {
  height: 56px; border-radius: 14px;
  background: var(--surface, oklch(0.965 0.012 252));
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.12), inset -3px -3px 7px oklch(1 0 0 / 0.85);
  transition: box-shadow 0.2s var(--ease);
}
.lp-form :deep(.el-input__wrapper:hover) {
  box-shadow: inset 4px 4px 9px oklch(0.55 0.03 258 / 0.14), inset -3px -3px 7px oklch(1 0 0 / 0.9);
}
.lp-form :deep(.el-input__wrapper.is-focus) {
  background: oklch(0.985 0.01 252);
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.14), inset -3px -3px 7px oklch(1 0 0 / 0.9), 0 0 0 3px color-mix(in oklab, var(--brand, oklch(0.55 0.16 252)) 16%, transparent);
}
.lp-form :deep(.el-input__inner) { color: var(--ink); font-family: inherit; font-size: 16px; }
.lp-form :deep(.el-input__inner::placeholder) { color: oklch(0.66 0.02 var(--hue)); }
.lp-form :deep(.el-input__prefix) { color: oklch(0.55 0.1 var(--hue)); margin: 0 6px 0 4px; transition: color 0.2s var(--ease), transform 0.2s var(--ease); }
.lp-field:focus-within :deep(.el-input__prefix) { color: oklch(0.5 0.14 var(--hue)); transform: scale(1.12); }
.lp-field:focus-within :deep(.el-form-item__label) { color: oklch(0.5 0.14 var(--hue)); }
.lp-form :deep(.el-form-item__error) { font-size: 12px; }

/* Primary — raised brand neumorphic button (no sweep, no flat border) */
.lp-primary {
  display: inline-flex; align-items: center; justify-content: center;
  width: 100%; height: 56px; margin-top: 4px; border: none; border-radius: 14px;
  color: #fff;
  background: linear-gradient(180deg, oklch(0.55 0.16 252), oklch(0.45 0.15 252));
  box-shadow: 4px 4px 12px oklch(0.4 0.1 252 / 0.35), -3px -3px 8px oklch(1 0 0 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.3);
  font-family: inherit; font-weight: 800; font-size: 16px; letter-spacing: 0.16em; cursor: pointer;
  transition: transform 0.2s var(--ease), box-shadow 0.2s var(--ease);
}
.lp-primary:hover {
  transform: translateY(-2px);
  box-shadow: 6px 6px 18px oklch(0.4 0.1 252 / 0.42), -3px -3px 8px oklch(1 0 0 / 0.55), inset 0 1px 0 oklch(1 0 0 / 0.35);
}
.lp-primary:active { transform: translateY(0); box-shadow: inset 3px 3px 8px oklch(0.3 0.1 252 / 0.5), inset -2px -2px 6px oklch(0.7 0.1 252 / 0.3); }
.lp-primary:disabled { cursor: wait; opacity: 0.7; transform: none; }

.lp-foot { margin-top: 14px; text-align: center; color: var(--muted); font-size: 13px; }
.lp-foot a, .lp-foot-link { color: oklch(0.5 0.13 var(--hue)); font-weight: 700; text-decoration: none; cursor: pointer; }
.lp-foot a:hover, .lp-foot-link:hover { text-decoration: underline; }
.lp-foot-sep { margin: 0 12px; color: oklch(0.8 0.02 var(--hue)); }

/* 注册入口：正式（实心品牌）+ 临时（凸起中性）—— 复用 cgzxui 凸起按钮语言 */
.lp-register-entry { margin-top: 18px; display: flex; flex-direction: column; gap: 10px; }
.lp-reg-btn {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  height: 46px; border: none; border-radius: 12px;
  font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer; text-decoration: none;
  transition: transform .2s var(--ease), box-shadow .2s var(--ease);
}
.lp-reg-btn--primary {
  color: #fff;
  background: linear-gradient(180deg, oklch(0.55 0.16 252), oklch(0.45 0.15 252));
  box-shadow: 3px 3px 8px oklch(0.4 0.1 252 / 0.3), -2px -2px 6px oklch(1 0 0 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.3);
}
.lp-reg-btn--primary:hover { transform: translateY(-1px); box-shadow: 4px 4px 12px oklch(0.4 0.1 252 / 0.38), -2px -2px 6px oklch(1 0 0 / 0.55), inset 0 1px 0 oklch(1 0 0 / 0.35); }
.lp-reg-btn--temp {
  color: oklch(0.45 0.13 252);
  background: linear-gradient(180deg, oklch(0.99 0.01 252), oklch(0.96 0.02 252));
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.12), -2px -2px 6px oklch(1 0 0 / 0.85);
}
.lp-reg-btn--temp:hover { transform: translateY(-1px); color: oklch(0.4 0.15 252); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.8), 3px 3px 8px oklch(0.55 0.03 258 / 0.16), -2px -2px 6px oklch(1 0 0 / 0.9); }
.lp-reg-divider { display: flex; align-items: center; gap: 10px; color: oklch(0.7 0.02 252); font-size: 12px; }
.lp-reg-divider::before, .lp-reg-divider::after { content: ''; flex: 1; height: 1px; background: oklch(0.9 0.02 252); }

/* Staggered entrance (motion only; no glass) */
.lp-head, .lp-field, .lp-primary, .lp-foot { animation: lp-up 0.5s var(--ease) backwards; }
.lp-head { animation-delay: 0.06s; }
.lp-field:nth-of-type(1) { animation-delay: 0.14s; }
.lp-field:nth-of-type(2) { animation-delay: 0.22s; }
.lp-primary { animation-delay: 0.3s; }
.lp-foot { animation-delay: 0.38s; }
@keyframes lp-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

@media (max-width: 860px) {
  .lp { grid-template-columns: 1fr; }
  .lp::before {
    backdrop-filter: blur(12px) saturate(1.1);
    -webkit-mask-image: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.04) 38%, rgba(0,0,0,0.4) 64%, rgba(0,0,0,0.9) 100%);
    mask-image: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.04) 38%, rgba(0,0,0,0.4) 64%, rgba(0,0,0,0.9) 100%);
  }
  .lp::after {
    background: linear-gradient(180deg, transparent 0%, color-mix(in oklch, var(--tint) 8%, transparent) 40%, color-mix(in oklch, var(--tint) 48%, transparent) 72%, color-mix(in oklch, var(--tint) 94%, white) 100%),
      radial-gradient(circle at 50% 78%, color-mix(in oklch, white 24%, transparent), transparent 40%);
  }
  .lp-brand { top: 18px; left: 18px; }
  .lp-panel { grid-column: 1; grid-row: 2; align-items: stretch; min-height: auto; padding: 80px 18px 28px; }
}

/* Pending / register-status callout (semantic warning surface) */
.lp-pending {
  margin-top: 14px; padding: 12px 14px; border-radius: 12px;
  background: color-mix(in oklab, var(--warning, #d97706) 10%, var(--surface, #fff));
  border: 1px solid color-mix(in oklab, var(--warning, #d97706) 32%, transparent);
  font-size: 13px; color: var(--muted);
}
.lp-pending__hint { margin: 0 0 10px; line-height: 1.5; }
.lp-query { display: flex; gap: 8px; }
.lp-query .el-input { flex: 1; }
.lp-secondary {
  flex: none; padding: 0 14px; border: none; border-radius: 12px;
  background: linear-gradient(180deg, oklch(0.99 0.01 252), oklch(0.96 0.02 252));
  color: var(--brand, oklch(0.5 0.15 252)); font-size: 13px; cursor: pointer; white-space: nowrap;
  box-shadow: 2px 2px 5px oklch(0.55 0.03 258 / 0.12), -2px -2px 5px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
  transition: transform .15s var(--ease);
}
.lp-secondary:hover { transform: translateY(-1px); }
.lp-secondary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.lp-query__result { margin-top: 10px; display: flex; flex-direction: column; gap: 2px; font-size: 13px; line-height: 1.5; }
.lp-query__reason { color: var(--muted); }

@media (prefers-reduced-motion: reduce) {
  .lp-card, .lp-head, .lp-field, .lp-primary, .lp-foot { animation: none; }
  .lp-card:hover, .lp-primary:hover, .lp-secondary:hover { transform: none; }
}
</style>
