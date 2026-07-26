<script setup lang="ts">
import { reactive, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { authApi } from '@/api/auth'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'

const router = useRouter()
const form = reactive({
  invitationCode: '',
  name: '',
  creditCode: '',
  displayName: '',
  phone: '',
  password: '',
})
const formRef = ref()

// 邀请码校验状态
const verifying = ref(false)
const inviteVerified = ref(false)
const inviteError = ref('')
const validityDays = ref(0)
const expiresAt = ref('')

const submitting = ref(false)

const rules = {
  invitationCode: [{ required: true, message: '请输入邀请码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入企业名称', trigger: 'blur' }],
  creditCode: [
    { required: true, message: '请输入统一社会信用代码', trigger: 'blur' },
    { pattern: /^[0-9A-Z]{18}$/, message: '统一社会信用代码须为 18 位', trigger: 'blur' },
  ],
  displayName: [{ required: true, message: '请输入联系人姓名', trigger: 'blur' }],
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: /^1\d{10}$/, message: '手机号格式不正确', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码不少于 6 位', trigger: 'blur' },
  ],
}

// 邀请码输满 8 位自动校验（用户不必手动点「校验」），避免「填完却点不动提交」
watch(() => form.invitationCode, (val) => {
  inviteVerified.value = false
  inviteError.value = ''
  // 容错：粘贴带空格/换行/小写时清洗为大写字母数字；变化则回写（触发二次 watch 但 cleaned 已稳定不再回写）
  const cleaned = (val || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  if (cleaned !== val) { form.invitationCode = cleaned; return }
  if (cleaned.length === 8) verifyCode()
})

async function verifyCode() {
  const code = form.invitationCode.trim()
  if (!code) { ElMessage.warning('请先输入邀请码'); return }
  verifying.value = true
  inviteError.value = ''
  inviteVerified.value = false
  try {
    const res = await authApi.verifyInvitation(code) as any
    if (res.valid) {
      inviteVerified.value = true
      validityDays.value = res.validityDays
      expiresAt.value = dayjs(res.expiresAt).format('YYYY-MM-DD')
    } else {
      inviteError.value = res.reason || '邀请码无效'
    }
  } catch {
    inviteError.value = '校验失败，请重试'
  } finally {
    verifying.value = false
  }
}

const canSubmit = computed(() => inviteVerified.value && !submitting.value)
const inviteOkText = computed(() => `邀请码有效，有效期 ${validityDays.value} 天，至 ${expiresAt.value} 到期`)

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  if (!inviteVerified.value) { ElMessage.warning('请先校验邀请码'); return }
  submitting.value = true
  try {
    await authApi.registerTemporary({
      invitationCode: form.invitationCode.trim(),
      name: form.name.trim(),
      creditCode: form.creditCode.trim(),
      displayName: form.displayName.trim(),
      phone: form.phone.trim(),
      password: form.password,
    })
    ElMessage.success('注册申请已提交，等待采购中心审核')
    router.push('/login')
  } catch (e: any) {
    const msg = e?.response?.data?.error || '注册失败，请检查信息后重试'
    ElMessage.error(msg)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="lp lp--supplier lp--reg">
    <div class="lp-bg" aria-hidden="true" />

    <div class="lp-brand" aria-label="智慧水发 · 蜀水云采">
      <img src="/logo.png" alt="" class="lp-brand-mark" />
      <span class="lp-brand-name">智慧水发 · 蜀水云采</span>
    </div>

    <section class="lp-panel lp-panel--reg" aria-label="临时供应商注册">
      <div class="lp-card lp-card--reg">
        <div class="lp-head">
          <div class="lp-brand-word">智慧水发<span class="lp-dot">·</span>蜀水云采</div>
          <div class="lp-divider" aria-hidden="true">◆</div>
          <h1 class="lp-title">临时供应商注册</h1>
          <p class="lp-sub">凭邀请码快速注册，审核通过后即可在有效期内使用</p>
        </div>

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-position="top"
          class="lp-form"
        >
          <!-- 邀请码校验 -->
          <el-form-item prop="invitationCode" class="lp-field">
            <template #label>邀请码</template>
            <div class="lp-invite-row">
              <el-input
                v-model="form.invitationCode"
                placeholder="请输入 8 位邀请码（输完自动校验）"
                prefix-icon="Key"
                class="lp-invite-input"
              />
            </div>
            <div v-if="inviteVerified" class="lp-invite-ok">{{ inviteOkText }}</div>
            <div v-else-if="inviteError" class="lp-invite-err">{{ inviteError }}</div>
          </el-form-item>

          <el-form-item prop="name" class="lp-field">
            <template #label>企业名称</template>
            <el-input v-model="form.name" placeholder="营业执照上的企业全称" prefix-icon="OfficeBuilding" />
          </el-form-item>

          <el-form-item prop="creditCode" class="lp-field">
            <template #label>统一社会信用代码</template>
            <el-input v-model="form.creditCode" placeholder="18 位代码（用于查询审核进度）" maxlength="18" prefix-icon="Document" />
          </el-form-item>

          <el-form-item prop="displayName" class="lp-field">
            <template #label>联系人姓名</template>
            <el-input v-model="form.displayName" placeholder="请输入联系人姓名" prefix-icon="UserFilled" />
          </el-form-item>

          <el-form-item prop="phone" class="lp-field">
            <template #label>手机号</template>
            <el-input v-model="form.phone" placeholder="11 位手机号" maxlength="11" prefix-icon="Phone" />
          </el-form-item>

          <el-form-item prop="password" class="lp-field">
            <template #label>登录密码</template>
            <el-input v-model="form.password" type="password" placeholder="不少于 6 位" prefix-icon="Lock" show-password />
          </el-form-item>

          <el-form-item>
            <button type="button" class="lp-primary" :disabled="!canSubmit" @click="submit">
              {{ submitting ? '提交中…' : '提交注册申请' }}
            </button>
          </el-form-item>
        </el-form>

        <div class="lp-foot">
          <router-link to="/register" class="lp-foot-link">改为正式注册供应商</router-link>
          <span class="lp-foot-sep">|</span>
          <router-link to="/login" class="lp-foot-link">已有账号 · 直接登录</router-link>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Serif+SC:wght@500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap');

.lp {
  --tint: oklch(0.975 0.02 var(--hue));
  --ink: oklch(0.26 0.03 var(--hue));
  --muted: #64748b;
  --line: oklch(0.9 0.02 var(--hue));
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 640px;
  min-height: 100vh; isolation: isolate; overflow: hidden;
  font-family: 'Manrope', 'Microsoft YaHei', sans-serif; color: var(--ink); background: var(--tint);
}
.lp--supplier { --hue: 252; }
/* 临时注册：覆盖 .lp 双栏布局，卡片水平居中（对齐正式注册页 .reg）*/
.lp--reg { grid-template-columns: 1fr; }

.lp-bg {
  position: absolute; inset: 0; z-index: -3;
  background-image: url('/bg-hydro-hero-7.png'); background-position: center; background-size: cover;
  filter: saturate(0.7) contrast(0.92) brightness(1.02); transform: scale(1.04);
}
.lp::before, .lp::after { position: absolute; inset: 0; content: ''; pointer-events: none; }
.lp::before {
  z-index: -2; backdrop-filter: blur(16px) saturate(1.1); -webkit-backdrop-filter: blur(16px) saturate(1.1);
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
  font-size: 22px; font-weight: 800; letter-spacing: 0.05em; color: #fff; text-shadow: 0 6px 22px rgba(0, 0, 0, 0.32);
}

.lp-panel {
  grid-column: 2; grid-row: 1; display: flex; min-height: 100vh;
  flex-direction: column; justify-content: center; align-items: flex-end;
  padding: 60px 150px 40px 32px;
}
.lp-panel--reg { grid-column: 1; align-items: center; justify-content: flex-start; padding: 80px 24px 40px; }

.lp-card {
  position: relative; width: 440px; padding: 44px 34px 36px; border-radius: 24px;
  background: linear-gradient(180deg, oklch(0.995 0.01 252), oklch(0.965 0.018 252));
  box-shadow: 12px 12px 30px oklch(0.42 0.05 252 / 0.16), -9px -9px 24px oklch(1 0 0 / 0.92), inset 0 1px 0 oklch(1 0 0 / 0.85);
}
.lp-card--reg { width: 460px; }

.lp-head { margin-bottom: 20px; text-align: center; }
.lp-brand-word {
  display: block; font-family: 'Plus Jakarta Sans', 'Microsoft YaHei', sans-serif;
  font-size: 30px; font-weight: 800; line-height: 1.1; letter-spacing: -0.01em;
  color: var(--brand-deep, oklch(0.42 0.13 252)); text-align: center; margin: 0 -34px; padding: 6px 34px;
}
.lp-brand-word .lp-dot { font-size: 24px; line-height: 1; margin: 0 8px; opacity: 0.5; color: var(--brand, oklch(0.55 0.16 252)); }
.lp-divider {
  display: flex; align-items: center; justify-content: center;
  width: 168px; margin: 14px auto 4px; color: oklch(0.55 0.12 var(--hue)); font-size: 9px; line-height: 1;
}
.lp-divider::before, .lp-divider::after { content: ''; flex: 1; height: 1px; }
.lp-divider::before { background: linear-gradient(90deg, transparent, oklch(0.6 0.1 var(--hue))); margin-right: 10px; }
.lp-divider::after { background: linear-gradient(270deg, transparent, oklch(0.6 0.1 var(--hue))); margin-left: 10px; }
.lp-title {
  margin: 0; font-family: 'Songti SC', 'STSong', 'SimSun', 'Noto Serif SC', serif;
  font-size: 26px; font-weight: 600; line-height: 1.2; color: oklch(0.32 0.05 var(--hue)); letter-spacing: 0.1em;
}
.lp-sub { margin: 8px 0 0; font-size: 13px; color: var(--muted); line-height: 1.5; }

.lp-form :deep(.el-form-item) { margin-bottom: 16px; }
.lp-form :deep(.el-form-item__label) {
  font-size: 13px; font-weight: 800; letter-spacing: 0.06em;
  color: color-mix(in oklch, var(--ink) 82%, #000); padding-bottom: 6px; line-height: 1;
}
.lp-form :deep(.el-input__wrapper) {
  height: 48px; border-radius: 12px;
  background: var(--surface, oklch(0.965 0.012 252));
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.12), inset -3px -3px 7px oklch(1 0 0 / 0.85);
  transition: box-shadow 0.2s var(--ease);
}
.lp-form :deep(.el-input__wrapper.is-focus) {
  background: oklch(0.985 0.01 252);
  box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.14), inset -3px -3px 7px oklch(1 0 0 / 0.9), 0 0 0 3px color-mix(in oklab, var(--brand, oklch(0.55 0.16 252)) 16%, transparent);
}
.lp-form :deep(.el-input__inner) { color: var(--ink); font-family: inherit; font-size: 15px; }
.lp-form :deep(.el-input__inner::placeholder) { color: oklch(0.66 0.02 var(--hue)); }
.lp-form :deep(.el-input__prefix) { color: oklch(0.55 0.1 var(--hue)); margin: 0 6px 0 4px; }
.lp-form :deep(.el-form-item__error) { font-size: 12px; }

/* 邀请码行 */
.lp-invite-row { display: flex; gap: 8px; width: 100%; }
.lp-invite-row .lp-invite-input { flex: 1; }
.lp-secondary {
  flex: none; padding: 0 16px; border: none; border-radius: 12px;
  background: linear-gradient(180deg, oklch(0.99 0.01 252), oklch(0.96 0.02 252));
  color: var(--brand, oklch(0.5 0.15 252)); font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap;
  box-shadow: 2px 2px 5px oklch(0.55 0.03 258 / 0.12), -2px -2px 5px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
  transition: transform .15s var(--ease);
}
.lp-secondary:hover { transform: translateY(-1px); }
.lp-secondary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.lp-invite-ok { margin-top: 6px; font-size: 12px; font-weight: 600; color: oklch(0.5 0.14 152); }
.lp-invite-err { margin-top: 6px; font-size: 12px; font-weight: 600; color: oklch(0.55 0.18 27); }

.lp-primary {
  display: inline-flex; align-items: center; justify-content: center;
  width: 100%; height: 50px; margin-top: 4px; border: none; border-radius: 14px;
  color: #fff; background: linear-gradient(180deg, oklch(0.55 0.16 252), oklch(0.45 0.15 252));
  box-shadow: 4px 4px 12px oklch(0.4 0.1 252 / 0.35), -3px -3px 8px oklch(1 0 0 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.3);
  font-family: inherit; font-weight: 800; font-size: 15px; letter-spacing: 0.1em; cursor: pointer;
  transition: transform 0.2s var(--ease), box-shadow 0.2s var(--ease);
}
.lp-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 6px 6px 18px oklch(0.4 0.1 252 / 0.42), -3px -3px 8px oklch(1 0 0 / 0.55), inset 0 1px 0 oklch(1 0 0 / 0.35); }
.lp-primary:disabled { cursor: not-allowed; opacity: 0.55; transform: none; }

.lp-foot { margin-top: 14px; text-align: center; color: var(--muted); font-size: 13px; }
.lp-foot-link { color: oklch(0.5 0.13 var(--hue)); font-weight: 700; text-decoration: none; cursor: pointer; }
.lp-foot-link:hover { text-decoration: underline; }
.lp-foot-sep { margin: 0 10px; color: oklch(0.8 0.02 var(--hue)); }

@media (max-width: 860px) {
  .lp { grid-template-columns: 1fr; }
  .lp-brand { top: 18px; left: 18px; }
  .lp-panel--reg { grid-column: 1; grid-row: 2; align-items: stretch; min-height: auto; padding: 80px 18px 28px; justify-content: flex-start; }
  .lp-card--reg { width: 100%; max-height: none; }
}
</style>
