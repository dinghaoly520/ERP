<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { UserFilled, Document, EditPen, ChatDotRound, Trophy } from '@element-plus/icons-vue'
import { useBidStore } from '@/stores/bid'

const bidStore = useBidStore()
const activeSupplier = ref(bidStore.suppliers[0].name)
const submitScore = () => ElMessage.success('本人评分已保存，系统已校验漏评、超分和评分理由。')
const confirmReport = () => ElMessage.success('评标报告已完成专家电子确认模拟。')
</script>

<template>
  <div class="page-container evaluate-page">
    <div class="page-header"><h1 class="page-title">专家评标端</h1><p class="page-subtitle">身份核验、保密承诺、回避确认后进入独立评审</p></div>

    <div class="content-card">
      <el-steps :active="4" finish-status="success">
        <el-step title="身份核验" />
        <el-step title="保密承诺" />
        <el-step title="回避确认" />
        <el-step title="评标纪律" />
      </el-steps>
    </div>

    <div class="evaluate-layout">
      <aside class="content-card supplier-panel">
        <div class="card-header"><h2 class="card-title">投标单位</h2></div>
        <button v-for="item in bidStore.suppliers" :key="item.id" :class="['supplier-item', { active: activeSupplier === item.name }]" @click="activeSupplier = item.name">
          <strong>{{ item.name }}</strong><span>{{ item.encrypt }} ｜ {{ item.confirm }}</span>
        </button>
      </aside>

      <main class="content-card file-panel">
        <div class="card-header"><h2 class="card-title">文件与响应摘要</h2><el-tag type="primary">{{ activeSupplier }}</el-tag></div>
        <div class="file-summary">
          <section><el-icon><Document /></el-icon><h3>资格文件</h3><p>营业执照、资质证书、法人授权书、保证金凭证均已提交。</p></section>
          <section><el-icon><EditPen /></el-icon><h3>技术响应</h3><p>施工组织、设备配置、进度计划、质量保障措施完整。</p></section>
          <section><el-icon><Trophy /></el-icon><h3>商务报价</h3><p>报价位于有效区间，系统已完成价格分模拟计算。</p></section>
        </div>
        <div class="clarify-box">
          <h3><el-icon><ChatDotRound /></el-icon>澄清说明</h3>
          <p v-for="item in bidStore.clarifications" :key="item.id">{{ item.question }} —— {{ item.status }}：{{ item.reply }}</p>
        </div>
      </main>

      <section class="content-card score-panel">
        <div class="card-header"><h2 class="card-title">评分表</h2><el-tag type="success">本人独立评分</el-tag></div>
        <div v-for="item in bidStore.scoreItems" :key="item.id" class="score-item">
          <div><strong>{{ item.name }}</strong><span>{{ item.max ? `满分 ${item.max} 分` : item.result }}</span></div>
          <el-input-number v-if="item.max" v-model="item.score" :min="0" :max="item.max" :precision="1" />
          <el-tag v-else type="success">{{ item.result }}</el-tag>
          <el-input v-model="item.reason" type="textarea" :rows="2" placeholder="请输入评分理由" />
        </div>
        <div class="score-total">当前总分：<strong>{{ bidStore.totalScore.toFixed(1) }}</strong></div>
        <el-button type="primary" @click="submitScore">提交本人评分</el-button>
        <el-button type="success" @click="confirmReport"><el-icon><UserFilled /></el-icon>确认评标报告</el-button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page-container { padding: 24px; background: #f6f9fd; min-height: calc(100vh - 60px); }
.page-header { margin-bottom: 24px; }
.page-title { font-size: 22px; font-weight: 800; color: #18243a; margin: 0 0 8px; }
.page-subtitle { font-size: 14px; color: #8a9aaa; margin: 0; }
.content-card { background: #fff; border: 1px solid #e8f0fa; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.card-title { font-size: 17px; font-weight: 800; color: #18243a; margin: 0; }
.evaluate-layout { display: grid; grid-template-columns: 260px 1fr 360px; gap: 16px; align-items: start; }
.supplier-panel { padding: 16px; }
.supplier-item { width: 100%; text-align: left; padding: 12px; border: 1px solid #e8f0fa; border-radius: 8px; background: #fff; margin-bottom: 10px; cursor: pointer; transition: all .2s; }
.supplier-item:hover { border-color: #b8d4f5; }
.supplier-item.active { border-color: #064ea2; background: #eef6ff; }
.supplier-item strong, .supplier-item span { display: block; }
.supplier-item span { color: #8a9aaa; font-size: 12px; margin-top: 4px; }
.file-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.file-summary section { border: 1px solid #e8f0fa; border-radius: 8px; padding: 16px; background: #f8fbff; }
.file-summary .el-icon { color: #064ea2; font-size: 24px; }
.file-summary h3 { margin: 8px 0; font-size: 15px; color: #18243a; }
.file-summary p, .clarify-box p { color: #536078; line-height: 1.8; font-size: 13px; }
.clarify-box { margin-top: 16px; padding: 16px; border-radius: 8px; background: #fff8e8; }
.clarify-box h3 { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 15px; }
.score-item { display: grid; gap: 8px; padding: 12px 0; border-bottom: 1px solid #e8f0fa; }
.score-item > div:first-child { display: flex; justify-content: space-between; color: #536078; }
.score-total { padding: 14px 0; font-size: 16px; color: #536078; }
.score-total strong { font-size: 24px; color: #064ea2; }
@media (max-width: 1300px) { .evaluate-layout { grid-template-columns: 1fr; } .file-summary { grid-template-columns: 1fr; } }
</style>
