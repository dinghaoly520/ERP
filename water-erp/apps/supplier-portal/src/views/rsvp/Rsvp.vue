<script setup lang="ts">
// 采购邀请回执页（公开、无登录）：供应商从短信/邮件/站内信点开 ?t=<签名token>，
// 页面校验后展示「本回执致：XX 公司」+ 关键信息，供其确认/拒绝参加；结果记入系统。
import { onMounted, ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { verifyRsvp, respondRsvp, type RsvpView } from '@/api/rsvp'

const route = useRoute()
const token = computed(() => String(route.query.t || ''))

type Phase = 'loading' | 'invalid' | 'ready'
const phase = ref<Phase>('loading')
const view = ref<RsvpView | null>(null)
const errMsg = ref('')

const note = ref('')
const submitting = ref(false)
// 提交后的本地回执结果（覆盖 view.status 以即时反馈）
const done = ref<{ status: 'ACCEPTED' | 'DECLINED'; rsvpNo: string; respondedAt: string } | null>(null)

const SUMMARY_LABEL: Record<string, string> = {
  项目名称: '采购项目', 项目编号: '项目编号', 采购方式: '采购方式', 采购类别: '采购类别',
  预算金额: '预算金额', 响应截止: '响应截止', 邀请方: '邀请方',
}

async function load() {
  phase.value = 'loading'
  if (!token.value) { phase.value = 'invalid'; errMsg.value = '缺少回执凭证，请从通知中的链接重新打开。'; return }
  try {
    const v = await verifyRsvp(token.value)
    view.value = v
    // 已回执：直接从 verify 数据初始化 done 状态（含回执号）
    if (v.status !== 'PENDING' && v.respondedAt && v.rsvpNo) {
      done.value = { status: v.status, rsvpNo: v.rsvpNo, respondedAt: v.respondedAt }
    }
    phase.value = 'ready'
  } catch (e: any) {
    phase.value = 'invalid'
    const code = e?.response?.data?.code
    errMsg.value = code === 'RSVP_EXPIRED'
      ? '该回执链接已过期，请联系采购方重新发送邀请。'
      : (e?.response?.data?.error || '回执链接无效或已失效，请从最新通知中的链接打开。')
  }
}

async function submit(status: 'ACCEPTED' | 'DECLINED') {
  if (!view.value || submitting.value) return
  submitting.value = true
  try {
    const r = await respondRsvp(token.value, status, note.value.trim() || undefined)
    done.value = { status: r.status, rsvpNo: r.rsvpNo, respondedAt: r.respondedAt }
    if (view.value) view.value.status = r.status
    ElMessage.success(status === 'ACCEPTED' ? '已确认参加，感谢您的回执' : '已记录您的回执')
  } catch (e: any) {
    const code = e?.response?.data?.code
    ElMessage.error(code === 'RSVP_EXPIRED' ? '回执链接已过期' : (e?.response?.data?.error || '提交失败，请稍后重试'))
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="rv">
    <div class="rv-bg" aria-hidden="true" />
    <div class="rv-brand" aria-label="智慧水发 · 蜀水云采">
      <img src="/logo.png" alt="" class="rv-brand-mark" />
      <span class="rv-brand-name">智慧水发 · 蜀水云采</span>
    </div>

    <section class="rv-panel">
      <div class="rv-card">
        <div class="rv-head">
          <div class="rv-brand-word">智慧水发<span class="rv-dot">·</span>蜀水云采</div>
          <div class="rv-divider" aria-hidden="true">◆</div>
          <h1 class="rv-title">采购邀请回执</h1>
        </div>

        <!-- 加载中 -->
        <div v-if="phase === 'loading'" class="rv-state">
          <div class="rv-spin" />
          <p>正在核验回执链接…</p>
        </div>

        <!-- 无效 / 过期 -->
        <div v-else-if="phase === 'invalid'" class="rv-state rv-state--err">
          <div class="rv-state-ico">!</div>
          <p class="rv-state-msg">{{ errMsg }}</p>
          <p class="rv-hint">如有疑问，请联系邀请方（四川水发集团采购中心）。</p>
        </div>

        <!-- 正常 -->
        <template v-else-if="view">
          <!-- 致：供应商名称（高亮，便于核对是否为本企业） -->
          <div class="rv-to">
            <span class="rv-to-label">本回执致</span>
            <strong class="rv-to-name">{{ view.supplierName || '—' }}</strong>
          </div>

          <h2 class="rv-subject">{{ view.title }}</h2>

          <!-- 关键信息（来自签名 token 解密） -->
          <dl class="rv-info">
            <template v-for="(val, key) in view.summary" :key="String(key)">
              <div v-if="val" class="rv-info-row">
                <dt>{{ SUMMARY_LABEL[String(key)] || String(key) }}</dt>
                <dd>{{ val }}</dd>
              </div>
            </template>
          </dl>

          <p v-if="view.expired" class="rv-warn">该回执链接已超过有效期。</p>

          <!-- 已回执 / 提交后：展示结果 -->
          <div v-if="done || (view.status !== 'PENDING')" class="rv-done" :class="done?.status === 'DECLINED' || view.status === 'DECLINED' ? 'is-declined' : 'is-accepted'">
            <div class="rv-done-badge">{{ (done?.status || view.status) === 'ACCEPTED' ? '✓ 已确认参加' : '✕ 已确认无法参加' }}</div>
            <p class="rv-done-meta">
              回执号 <strong>#{{ done?.rsvpNo || '—' }}</strong>
              · 回执时间 {{ done?.respondedAt ? new Date(done.respondedAt).toLocaleString('zh-CN') : (view.respondedAt ? new Date(view.respondedAt).toLocaleString('zh-CN') : '—') }}
            </p>
            <p v-if="!view.expired" class="rv-hint">如需变更，可于响应截止前再次点击通知中的链接修改。</p>
          </div>

          <!-- 待回执：操作区 -->
          <div v-else class="rv-actions">
            <p class="rv-prompt">请确认贵司是否参加本次采购邀请：</p>
            <div class="rv-btns">
              <button type="button" class="rv-btn rv-btn--accept" :disabled="submitting" @click="submit('ACCEPTED')">确认参加</button>
              <button type="button" class="rv-btn rv-btn--decline" :disabled="submitting" @click="submit('DECLINED')">无法参加</button>
            </div>
            <label class="rv-note-label">备注（选填，如档期冲突、资质说明等）</label>
            <textarea v-model="note" class="rv-note" rows="3" maxlength="500" placeholder="可补充说明，便于采购方了解情况…" />
            <p class="rv-privacy">本链接仅贵司有效，{{ view.expiresAt ? new Date(view.expiresAt).toLocaleDateString('zh-CN') : '' }} 前有效；您的选择将被记录。</p>
          </div>
        </template>
      </div>
    </section>
  </main>
</template>

<style scoped>
.rv {
  --hue: 252;
  --brand: oklch(0.55 0.16 252);
  --brand-deep: oklch(0.42 0.13 252);
  --tint: oklch(0.975 0.02 var(--hue));
  --ink: oklch(0.26 0.03 var(--hue));
  --muted: #64748b;
  --line: oklch(0.9 0.02 var(--hue));
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  position: relative; min-height: 100vh; isolation: isolate; overflow: hidden;
  font-family: 'Manrope', 'Microsoft YaHei', sans-serif; color: var(--ink); background: var(--tint);
  display: flex; align-items: center; justify-content: center; padding: 40px 18px;
}
.rv-bg {
  position: absolute; inset: 0; z-index: -3;
  background-image: url('/bg-hydro-hero-7.png'); background-position: center; background-size: cover;
  filter: saturate(0.7) contrast(0.92) brightness(1.02); transform: scale(1.04);
}
.rv::after {
  position: absolute; inset: 0; z-index: -1; content: ''; pointer-events: none;
  background:
    linear-gradient(180deg, color-mix(in oklch, var(--tint) 30%, transparent), color-mix(in oklch, var(--tint) 78%, white)),
    radial-gradient(circle at 50% 30%, color-mix(in oklch, white 22%, transparent), transparent 50%);
}
.rv-brand { position: fixed; top: 26px; left: 6vw; z-index: 3; display: inline-flex; align-items: center; gap: 12px; }
.rv-brand-mark { width: 50px; height: 50px; border-radius: 14px; object-fit: cover; background: #fff; padding: 5px; box-sizing: border-box; box-shadow: 4px 4px 12px oklch(0.3 0.05 252 / 0.3), -2px -2px 8px oklch(1 0 0 / 0.4); }
.rv-brand-name { font-family: 'Plus Jakarta Sans', 'Microsoft YaHei', sans-serif; font-size: 20px; font-weight: 800; letter-spacing: 0.05em; color: #fff; text-shadow: 0 6px 22px rgba(0,0,0,0.32); }
.rv-panel { width: 100%; max-width: 520px; }
.rv-card {
  position: relative; width: 100%; padding: 44px 34px 38px; border-radius: 24px;
  background: linear-gradient(180deg, oklch(0.995 0.01 252), oklch(0.965 0.018 252));
  box-shadow: 12px 12px 30px oklch(0.42 0.05 252 / 0.16), -9px -9px 24px oklch(1 0 0 / 0.92), inset 0 1px 0 oklch(1 0 0 / 0.85);
  animation: rv-rise 0.5s var(--ease) backwards;
}
@keyframes rv-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
.rv-head { margin-bottom: 22px; text-align: center; }
.rv-brand-word { display: block; font-family: 'Plus Jakarta Sans', 'Microsoft YaHei', sans-serif; font-size: 26px; font-weight: 800; letter-spacing: -0.01em; color: var(--brand-deep); }
.rv-brand-word .rv-dot { font-size: 20px; margin: 0 6px; opacity: 0.5; color: var(--brand); }
.rv-divider { display: flex; align-items: center; justify-content: center; width: 150px; margin: 14px auto 4px; color: oklch(0.55 0.12 var(--hue)); font-size: 9px; }
.rv-divider::before, .rv-divider::after { content: ''; flex: 1; height: 1px; }
.rv-divider::before { background: linear-gradient(90deg, transparent, oklch(0.6 0.1 var(--hue))); margin-right: 10px; }
.rv-divider::after { background: linear-gradient(270deg, transparent, oklch(0.6 0.1 var(--hue))); margin-left: 10px; }
.rv-title { margin: 0; font-family: 'Songti SC', 'STSong', 'SimSun', 'Noto Serif SC', serif; font-size: 24px; font-weight: 600; letter-spacing: 0.12em; color: oklch(0.32 0.05 var(--hue)); }

.rv-to { display: flex; align-items: baseline; gap: 10px; padding: 14px 16px; border-radius: 14px; margin-bottom: 14px;
  background: color-mix(in oklab, var(--brand) 8%, #fff); border: 1px solid color-mix(in oklab, var(--brand) 22%, transparent); }
.rv-to-label { font-size: 12px; color: var(--muted); white-space: nowrap; }
.rv-to-name { font-size: 17px; font-weight: 800; color: var(--brand-deep); letter-spacing: 0.01em; }
.rv-subject { margin: 0 0 14px; font-size: 15px; font-weight: 700; line-height: 1.5; color: var(--ink); }

.rv-info { margin: 0 0 16px; display: grid; gap: 8px; }
.rv-info-row { display: flex; gap: 10px; font-size: 13px; line-height: 1.5; padding-bottom: 8px; border-bottom: 1px dashed var(--line); }
.rv-info-row dt { flex: none; width: 72px; color: var(--muted); font-weight: 600; }
.rv-info-row dd { margin: 0; color: var(--ink); font-weight: 600; }

.rv-warn { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; font-size: 13px; color: #b45309; background: color-mix(in oklab, #d97706 10%, #fff); border: 1px solid color-mix(in oklab, #d97706 30%, transparent); }

.rv-actions { margin-top: 4px; }
.rv-prompt { margin: 0 0 12px; font-size: 13px; font-weight: 700; color: var(--ink); }
.rv-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.rv-btn { height: 52px; border: none; border-radius: 14px; font-family: inherit; font-weight: 800; font-size: 15px; letter-spacing: 0.08em; cursor: pointer; transition: transform .2s var(--ease), box-shadow .2s var(--ease); }
.rv-btn:disabled { opacity: 0.6; cursor: wait; transform: none; }
.rv-btn--accept { color: #fff; background: linear-gradient(180deg, oklch(0.62 0.16 150), oklch(0.5 0.15 150)); box-shadow: 4px 4px 12px oklch(0.4 0.12 150 / 0.32), -3px -3px 8px oklch(1 0 0 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.3); }
.rv-btn--accept:hover { transform: translateY(-2px); box-shadow: 6px 6px 18px oklch(0.4 0.12 150 / 0.4), -3px -3px 8px oklch(1 0 0 / 0.55), inset 0 1px 0 oklch(1 0 0 / 0.35); }
.rv-btn--decline { color: oklch(0.5 0.16 25); background: linear-gradient(180deg, oklch(0.99 0.01 25), oklch(0.95 0.02 25)); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.12), -2px -2px 6px oklch(1 0 0 / 0.85); }
.rv-btn--decline:hover { transform: translateY(-1px); color: oklch(0.45 0.18 25); }
.rv-note-label { display: block; margin: 16px 0 6px; font-size: 12px; color: var(--muted); font-weight: 600; }
.rv-note { width: 100%; box-sizing: border-box; resize: vertical; padding: 12px 14px; border-radius: 12px; border: none; font-family: inherit; font-size: 14px; color: var(--ink);
  background: oklch(0.965 0.012 252); box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.12), inset -3px -3px 7px oklch(1 0 0 / 0.85); }
.rv-note:focus { outline: none; box-shadow: inset 3px 3px 7px oklch(0.55 0.03 258 / 0.14), inset -3px -3px 7px oklch(1 0 0 / 0.9), 0 0 0 3px color-mix(in oklab, var(--brand) 16%, transparent); }
.rv-privacy { margin: 12px 0 0; font-size: 11px; line-height: 1.5; color: var(--muted); text-align: center; }

.rv-done { margin-top: 4px; padding: 18px 16px; border-radius: 16px; text-align: center; }
.rv-done.is-accepted { background: color-mix(in oklab, oklch(0.6 0.16 150) 12%, #fff); border: 1px solid color-mix(in oklab, oklch(0.6 0.16 150) 34%, transparent); }
.rv-done.is-declined { background: color-mix(in oklab, oklch(0.6 0.16 25) 10%, #fff); border: 1px solid color-mix(in oklab, oklch(0.6 0.16 25) 30%, transparent); }
.rv-done-badge { font-size: 18px; font-weight: 800; letter-spacing: 0.04em; }
.rv-done.is-accepted .rv-done-badge { color: oklch(0.45 0.15 150); }
.rv-done.is-declined .rv-done-badge { color: oklch(0.5 0.16 25); }
.rv-done-meta { margin: 10px 0 0; font-size: 12px; color: var(--muted); }
.rv-done-meta strong { color: var(--ink); }
.rv-hint { margin: 8px 0 0; font-size: 12px; color: var(--muted); line-height: 1.5; }

.rv-state { text-align: center; padding: 24px 0; }
.rv-state p { margin: 8px 0 0; font-size: 14px; color: var(--muted); }
.rv-state-ico { width: 52px; height: 52px; margin: 0 auto; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: 800; color: #b45309; background: color-mix(in oklab, #d97706 14%, #fff); }
.rv-state--err .rv-state-msg { color: oklch(0.4 0.1 25); font-weight: 700; font-size: 15px; }
.rv-spin { width: 34px; height: 34px; margin: 0 auto; border-radius: 50%; border: 3px solid color-mix(in oklab, var(--brand) 22%, #fff); border-top-color: var(--brand); animation: rv-spin 0.8s linear infinite; }
@keyframes rv-spin { to { transform: rotate(360deg); } }

@media (max-width: 560px) { .rv-card { padding: 34px 22px 30px; } .rv-btns { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .rv-card, .rv-spin { animation: none; } .rv-btn:hover { transform: none; } }
</style>
