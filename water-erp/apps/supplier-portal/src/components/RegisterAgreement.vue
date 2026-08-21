<script setup lang="ts">
import { ref } from 'vue'
import { AGREEMENT_TITLE, AGREEMENT_SECTIONS } from '@/constants/agreement'

// v-model 绑定「是否已同意协议」
const model = defineModel<boolean>({ default: false })

const visible = ref(false)

function openAgreement() {
  visible.value = true
}
</script>

<template>
  <div class="reg-agree">
    <el-checkbox v-model="model" class="reg-agree-check">
      <span class="reg-agree-text">
        我已阅读并同意
        <button type="button" class="reg-agree-link" @click.prevent.stop="openAgreement">《{{ AGREEMENT_TITLE }}》</button>
      </span>
    </el-checkbox>

    <el-dialog
      v-model="visible"
      :title="AGREEMENT_TITLE"
      width="min(680px, 92vw)"
      top="6vh"
      class="reg-agree-dialog"
    >
      <div class="reg-agree-body">
        <p class="reg-agree-lead">欢迎入驻蜀水云采采购平台。在提交注册申请前，请仔细阅读本协议。勾选「我已阅读并同意」即表示您已充分理解并同意本协议全部条款。</p>
        <section v-for="(sec, i) in AGREEMENT_SECTIONS" :key="i" class="reg-agree-sec">
          <h3 class="reg-agree-sec-title">{{ sec.title }}</h3>
          <p v-for="(p, j) in sec.paragraphs" :key="j" class="reg-agree-p">{{ p }}</p>
        </section>
      </div>
      <template #footer>
        <div class="reg-agree-foot">
          <button type="button" class="reg-agree-btn" @click="model = true; visible = false">我已阅读并同意</button>
          <button type="button" class="reg-agree-btn reg-agree-btn--ghost" @click="visible = false">关闭</button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.reg-agree {
  display: flex;
  align-items: flex-start;
  margin: 4px 0 2px;
}
.reg-agree-check {
  align-items: flex-start;
}
.reg-agree-check :deep(.el-checkbox__label) {
  white-space: normal;
  line-height: 1.6;
}
.reg-agree-text {
  font-size: 12.5px;
  color: var(--muted, #64748b);
}
.reg-agree-link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--brand, oklch(0.5 0.16 252));
  font-weight: 700;
  cursor: pointer;
}
.reg-agree-link:hover {
  text-decoration: underline;
}

.reg-agree-body {
  max-height: 56vh;
  overflow-y: auto;
  padding-right: 6px;
  color: oklch(0.3 0.03 252);
}
.reg-agree-lead {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--muted, #64748b);
  padding: 12px 14px;
  border-radius: 10px;
  background: color-mix(in oklab, var(--brand, oklch(0.5 0.16 252)) 6%, transparent);
}
.reg-agree-sec {
  margin-bottom: 18px;
}
.reg-agree-sec-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 800;
  color: oklch(0.32 0.05 252);
}
.reg-agree-p {
  margin: 0 0 6px;
  font-size: 13px;
  line-height: 1.75;
  text-align: justify;
  color: oklch(0.38 0.03 252);
}

.reg-agree-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.reg-agree-btn {
  height: 38px;
  padding: 0 20px;
  border: none;
  border-radius: 12px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  color: #fff;
  background: linear-gradient(180deg, oklch(0.55 0.16 252), oklch(0.45 0.15 252));
  box-shadow: 2px 2px 6px oklch(0.4 0.1 252 / 0.3), -2px -2px 4px oklch(1 0 0 / 0.4), inset 0 1px 0 oklch(1 0 0 / 0.3);
  transition: transform 0.15s ease;
}
.reg-agree-btn:hover { transform: translateY(-1px); }
.reg-agree-btn--ghost {
  color: oklch(0.5 0.06 252);
  background: linear-gradient(180deg, oklch(0.99 0.01 252), oklch(0.96 0.02 252));
  box-shadow: 2px 2px 5px oklch(0.55 0.03 258 / 0.12), -2px -2px 5px oklch(1 0 0 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.7);
}
</style>
