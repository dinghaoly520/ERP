<script setup>
import { ref } from 'vue'
import {
  ShoppingCart,
  Goods,
  UserFilled,
  Present
} from '@element-plus/icons-vue'

const activeTab = ref('central')

const tabs = [
  { key: 'central', title: '集中采购', icon: ShoppingCart },
  { key: 'employee', title: '员工内购', icon: Goods },
  { key: 'join', title: '商家入驻', icon: UserFilled },
  { key: 'welfare', title: '员工福利', icon: Present }
]

// 模拟商品数据
const products = ref([
  { id: 1, name: '办公桌椅套装', price: 2980, image: '', sales: 128 },
  { id: 2, name: '联想ThinkPad笔记本电脑', price: 6999, image: '', sales: 56 },
  { id: 3, name: '文件柜', price: 1580, image: '', sales: 89 },
  { id: 4, name: '办公用品套装', price: 299, image: '', sales: 256 }
])
</script>

<template>
  <div class="mall-page">
    <div class="page-header">
      <h1 class="page-title">电子商城</h1>
      <p class="page-subtitle">集中采购、员工内购、商家入驻、员工福利</p>
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

      <!-- 集中采购 -->
      <div v-show="activeTab === 'central'" class="tab-content">
        <div class="products-grid">
          <div class="product-card" v-for="p in products" :key="p.id">
            <div class="product-image">
              <el-icon :size="60" color="#d8e2f0"><Goods /></el-icon>
            </div>
            <div class="product-info">
              <h4>{{ p.name }}</h4>
              <div class="product-meta">
                <span class="price">¥{{ p.price }}</span>
                <span class="sales">已售{{ p.sales }}件</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 员工内购 -->
      <div v-show="activeTab === 'employee'" class="tab-content">
        <div class="action-card">
          <h3>员工内购专区</h3>
          <p>集团员工专享优惠价格，需要员工账号登录后查看。</p>
          <el-button type="primary">登录查看</el-button>
        </div>
      </div>

      <!-- 商家入驻 -->
      <div v-show="activeTab === 'join'" class="tab-content">
        <div class="action-card">
          <h3>商家入驻</h3>
          <p>诚邀优质供应商入驻电子商城，共享采购资源。</p>
          <el-button type="primary">申请入驻</el-button>
        </div>
      </div>

      <!-- 员工福利 -->
      <div v-show="activeTab === 'welfare'" class="tab-content">
        <div class="action-card">
          <h3>员工福利</h3>
          <p>节日福利、生日礼品等员工专属福利。</p>
          <el-button type="primary">查看福利</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mall-page {
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

.products-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.product-card {
  background: #f8fafd;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e8f0fa;
  transition: all 0.3s;
}

.product-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(6, 78, 162, 0.1);
}

.product-image {
  height: 150px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.product-info {
  padding: 16px;
}

.product-info h4 {
  font-size: 14px;
  font-weight: 600;
  color: #18243a;
  margin-bottom: 8px;
}

.product-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.price {
  font-size: 18px;
  font-weight: 800;
  color: #e74c3c;
}

.sales {
  font-size: 12px;
  color: #8a9aaa;
}

.action-card {
  padding: 40px;
  text-align: center;
  background: #f8fafd;
  border-radius: 8px;
}

.action-card h3 {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 12px;
}

.action-card p {
  color: #5a6d8a;
  margin-bottom: 20px;
}

@media (max-width: 1200px) {
  .products-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .products-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>