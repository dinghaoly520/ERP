<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Upload, Lock, CircleCheck, Cpu } from '@element-plus/icons-vue'
import { useBidStore } from '@/stores/bid'

const bidStore = useBidStore()
const progress = ref(72)

const handleSubmit = () => {
  progress.value = 100
  bidStore.markSubmitted()
  ElMessage.success('投标文件已完成签章、哈希校验和密文提交，回执已生成。')
}
</script>

<template>
  <div class="page-container submit-page">
    <div class="page-header"><h1 class="page-title">供应商端</h1><p class="page-subtitle">企业唯一安全组件、招标文件受控下载、投标文件加密上传与回执</p></div>

    <div class="submit-grid">
      <div class="content-card component-card">
        <div class="card-header"><h2 class="card-title">企业唯一安全组件</h2><el-tag type="success">已激活</el-tag></div>
        <div class="component-main"><el-icon><Cpu /></el-icon><div><strong>{{ bidStore.securityComponent.companyName }}</strong><span>{{ bidStore.securityComponent.licenseNo }}</span></div></div>
        <div class="info-grid">
          <span>统一社会信用代码：{{ bidStore.securityComponent.companyCode }}</span>
          <span>插件版本：{{ bidStore.securityComponent.pluginVersion }}</span>
          <span>授权设备：{{ bidStore.securityComponent.authorizedDevices }}/{{ bidStore.securityComponent.maxDevices }}</span>
          <span>证书状态：{{ bidStore.securityComponent.certificateStatus }}，至 {{ bidStore.securityComponent.certificateExpire }}</span>
        </div>
      </div>

      <div class="content-card">
        <div class="card-header"><h2 class="card-title">下载前置条件</h2></div>
        <el-steps direction="vertical" :active="5" finish-status="success">
          <el-step title="企业注册审核通过" />
          <el-step title="项目报名审核通过" />
          <el-step title="安全组件版本校验通过" />
          <el-step title="授权设备和证书校验通过" />
          <el-step title="生成企业水印招标文件" />
        </el-steps>
      </div>
    </div>

    <div class="content-card">
      <div class="card-header"><h2 class="card-title">招标文件受控下载</h2><el-button type="primary"><el-icon><Download /></el-icon>下载水印标书包</el-button></div>
      <el-table :data="[{ file: 'BID-2026-0518 招标文件.ofd', watermark: '四川川水建设工程有限公司 / BID-2026-0518 / 2026-06-05', hash: 'SHA256-A19C8E', time: '2026-06-05 10:12', result: '成功' }]" border>
        <el-table-column prop="file" label="文件" />
        <el-table-column prop="watermark" label="动态水印" min-width="280" />
        <el-table-column prop="hash" label="文件哈希" width="150" />
        <el-table-column prop="time" label="下载时间" width="165" />
        <el-table-column prop="result" label="结果" width="90" />
      </el-table>
    </div>

    <div class="content-card">
      <div class="card-header"><h2 class="card-title">投标文件加密投递</h2><el-tag type="warning">截止前可撤回重传</el-tag></div>
      <el-upload drag action="#" :auto-upload="false" accept=".pdf,.doc,.docx,.ofd">
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">拖拽投标文件到此处，或<em>点击选择</em></div>
        <template #tip><div class="el-upload__tip">演示流程：本地签章 → 哈希计算 → 项目公钥加密 → 密文上传 → 生成回执</div></template>
      </el-upload>
      <div class="encrypt-panel">
        <div><el-icon><Lock /></el-icon><span>加密上传进度</span></div><el-progress :percentage="progress" />
        <el-button type="success" @click="handleSubmit"><el-icon><CircleCheck /></el-icon>生成提交回执</el-button>
      </div>
      <el-table :data="bidStore.suppliers.slice(0, 1)" border>
        <el-table-column prop="name" label="投标单位" />
        <el-table-column prop="submit" label="投递状态" />
        <el-table-column prop="encrypt" label="加密状态" />
        <el-table-column prop="receipt" label="回执编号" />
      </el-table>
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
.submit-grid { display: grid; grid-template-columns: 1.2fr .8fr; gap: 16px; margin-bottom: 16px; }
.component-main { display: flex; align-items: center; gap: 16px; padding: 18px; background: #eef6ff; border-radius: 8px; margin-bottom: 16px; }
.component-main .el-icon { font-size: 36px; color: #064ea2; }
.component-main strong { display: block; font-size: 18px; }
.component-main span { color: #8a9aaa; }
.info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; color: #536078; font-size: 13px; }
.encrypt-panel { margin: 18px 0; padding: 16px; background: #f8fbff; border-radius: 8px; display: grid; gap: 12px; }
.encrypt-panel > div { display: flex; align-items: center; gap: 8px; font-weight: 700; color: #064ea2; }
@media (max-width: 1000px) { .submit-grid, .info-grid { grid-template-columns: 1fr; } }
</style>
