<script setup>
import { ref } from 'vue'
import {
  Bell,
  Document,
  Trophy,
  InfoFilled
} from '@element-plus/icons-vue'

const activeTab = ref('tender')

const tabs = [
  { key: 'tender', title: '招标公告', icon: Document },
  { key: 'result', title: '中标公示', icon: Trophy },
  { key: 'policy', title: '政策法规', icon: InfoFilled },
  { key: 'notify', title: '平台通知', icon: Bell }
]

// 招标公告
const tenderNotices = ref([
  { id: 1, title: '2026年度水利工程物资集中采购招标公告', date: '2026-05-18', tag: '重要' },
  { id: 2, title: '智慧水务信息化系统建设项目招标公告', date: '2026-05-16' },
  { id: 3, title: '升钟水库灌区续建配套与节水改造工程招标', date: '2026-05-12' },
  { id: 4, title: '武都引水工程机电设备维护服务招标公告', date: '2026-05-06' },
  { id: 5, title: '川水大厦电梯设备采购招标公告', date: '2026-05-04' }
])

// 中标公示
const resultNotices = ref([
  { id: 1, title: '亭子口水利枢纽加固工程中标公示', date: '2026-05-17', winner: '四川川水建设工程有限公司' },
  { id: 2, title: '紫坪铺水库大坝安全监测设备采购中标公示', date: '2026-05-13', winner: '成都华西物资供应有限公司' },
  { id: 3, title: '川水大厦电梯设备采购中标公示', date: '2026-05-10', winner: '四川电梯设备有限公司' }
])

// 政策法规
const policies = ref([
  { id: 1, title: '中华人民共和国招标投标法', date: '2026-01-01' },
  { id: 2, title: '中华人民共和国政府采购法', date: '2026-01-01' },
  { id: 3, title: '四川省招标投标管理办法', date: '2026-01-01' }
])
</script>

<template>
  <div class="notice-page">
    <div class="page-header">
      <h1 class="page-title">信息公告</h1>
      <p class="page-subtitle">招标公告、中标公示、政策法规、平台通知</p>
    </div>

    <!-- 功能标签 -->
    <div class="tabs-wrapper">
      <div class="tabs-nav">
        <div
          v-for="tab in tabs"
          :key="tab.key"
          :class="['tab-item', { active: activeTab === tab.key }]"
          @click="activeTab = tab.key"
        >
          <el-icon><component :is="tab.icon" /></el-icon>
          <span>{{ tab.title }}</span>
        </div>
      </div>

      <!-- 招标公告 -->
      <div v-show="activeTab === 'tender'" class="tab-content">
        <div class="notice-list">
          <div class="notice-row" v-for="notice in tenderNotices" :key="notice.id">
            <span class="row-date">{{ notice.date }}</span>
            <span class="row-tag" v-if="notice.tag">{{ notice.tag }}</span>
            <span class="row-title">{{ notice.title }}</span>
            <el-icon><ArrowRight /></el-icon>
          </div>
        </div>
      </div>

      <!-- 中标公示 -->
      <div v-show="activeTab === 'result'" class="tab-content">
        <div class="notice-list">
          <div class="notice-row" v-for="notice in resultNotices" :key="notice.id">
            <span class="row-date">{{ notice.date }}</span>
            <span class="row-title">{{ notice.title }}</span>
            <span class="row-winner">{{ notice.winner }}</span>
          </div>
        </div>
      </div>

      <!-- 政策法规 -->
      <div v-show="activeTab === 'policy'" class="tab-content">
        <div class="notice-list">
          <div class="notice-row" v-for="policy in policies" :key="policy.id">
            <el-icon><Document /></el-icon>
            <span class="row-title">{{ policy.title }}</span>
            <el-button type="primary" link size="small">查看</el-button>
          </div>
        </div>
      </div>

      <!-- 平台通知 -->
      <div v-show="activeTab === 'notify'" class="tab-content">
        <div class="empty-state">
          <el-empty description="暂无平台通知" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notice-page {
  padding: 24px;
  background: #f6f9fd;
  min-height: calc(100vh - 60px);
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 22px;
  font-weight: 800;
  color: #18243a;
  margin-bottom: 8px;
}

.page-subtitle {
  font-size: 14px;
  color: #8a9aaa;
}

.tabs-wrapper {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  border: 1px solid #e8f0fa;
}

.tabs-nav {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  border-bottom: 2px solid #e8f0fa;
  padding-bottom: 12px;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  color: #5a6d8a;
  font-weight: 600;
  transition: all 0.25s;
}

.tab-item:hover {
  color: #064ea2;
}

.tab-item.active {
  color: #064ea2;
  position: relative;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: -14px;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #0e62d0, #39a8ff);
}

.tab-content {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.notice-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.notice-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: #f8fafd;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.notice-row:hover {
  background: #eef5fc;
}

.row-date {
  font-size: 12px;
  color: #064ea2;
  font-weight: 700;
  min-width: 80px;
  padding: 4px 10px;
  background: #f0f6fd;
  border-radius: 4px;
  text-align: center;
}

.row-tag {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 4px;
  background: #fff8e8;
  color: #f5a623;
}

.row-title {
  flex: 1;
  font-size: 14px;
  color: #3a4a5a;
  font-weight: 600;
}

.row-winner {
  font-size: 13px;
  color: #11a874;
  font-weight: 600;
}

.notice-row .el-icon {
  color: #b8d4f5;
}

.notice-row:hover .el-icon {
  color: #064ea2;
}

.empty-state {
  padding: 40px;
}
</style>