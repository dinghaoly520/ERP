# 浅彩磨砂玻璃设计规程

## 理念

以「身体渐变（body gradient）+ 半透白玻璃卡片 + 淡彩光晕漂移」三层叠加，为界面赋予通透、流动、克制的视觉基调。彩色光晕服务于氛围而非内容，不干扰信息可读性。

## 全局地基

### body 渐变

`globals.css` 中的 `body` 使用了四色椭球径向渐变 + 浅白线性底：

```css
body {
  background:
    radial-gradient(ellipse at 12% 0%, rgba(195, 220, 252, 0.56), transparent 44%),
    radial-gradient(ellipse at 88% 18%, rgba(210, 195, 250, 0.42), transparent 44%),
    radial-gradient(ellipse at 42% 94%, rgba(185, 235, 228, 0.44), transparent 46%),
    radial-gradient(ellipse at 94% 74%, rgba(252, 210, 220, 0.30), transparent 40%),
    linear-gradient(180deg,
      rgba(248, 250, 255, 0.90) 0%,
      rgba(246, 249, 253, 0.91) 100%);
}
```

- 左上淡蓝、右上淡紫、中下淡绿、右下淡粉
- 底层叠加浅白线性，避免大面积色块过于突兀

### 玻璃基类：`.glass-card`

```css
.glass-card {
  position: relative;
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(16px) saturate(1.2);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow:
    0 1px 2px rgba(15, 35, 65, 0.02),
    0 4px 16px rgba(91, 155, 213, 0.04);
}
```

> **关键规则：** 

- 不要加 `overflow: hidden` —— 这会裁剪彩光层
- 卡片内容不要用 `z-index: 1` —— 会让内容遮盖光晕

### 彩光层：`.glass-card::before`

一个 `position: absolute; inset: 0` 的伪元素，覆盖在卡片背景之上、内容之下。使用 3 层 `radial-gradient` 构成彩色光晕，以 18s 慢速 `translate` 漂移。opacity 默认 0.48，hover 升至 0.62。

### 光晕动画 keyframe

```css
@keyframes glass-glow-drift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  25%      { transform: translate(1.2%, -0.8%) scale(1.02); }
  50%      { transform: translate(-0.6%, 1%) scale(1.01); }
  75%      { transform: translate(0.4%, -0.4%) scale(1.015); }
}
```

位移不超过 1.2%，scale 不超过 1.02——肉眼几乎不可察觉，但提供了持续的生动感。

### 透明/深度变体

| 类名 | 透度 | 模糊 | 用途 |
|------|------|------|------|
| `glass-card` | 78% | 16px | 主力面板 |
| `glass-card-deeper` | 85% | 20px | 强调面板（如 AI 研判） |
| `glass-card-lighter` | 62% | 12px | 子卡片（如供应商卡片） |

### 色调变体

| 类名 | 主色 | 辅助色 | 适用场景 |
|------|------|--------|----------|
| `glass-card-blue` | 天蓝 `rgba(96,165,250,.38)` | 青/浅蓝 | 表格、清单、数据区 |
| `glass-card-purple` | 淡紫 `rgba(168,139,250,.34)` | 薰衣草/深紫 | 侧栏、导航 |
| `glass-card-emerald` | 淡绿 `rgba(52,211,153,.32)` | 翠绿/墨绿 | 供应商、成功状态 |
| `glass-card-amber` | 琥珀 `rgba(251,191,36,.28)` | 金/橙 | 预算、行动卡片 |
| `glass-card-rose` | 粉红 `rgba(251,113,133,.26)` | 玫瑰/深红 | 预警、待复核 |

### 无障碍

```css
@media (prefers-reduced-motion: reduce) {
  .glass-card::before { animation: none; opacity: 0.22; }
  .glass-card:hover::before { opacity: 0.22; }
}
```

---

## 组件用法

### 示例 1：侧栏（紫靛调）

```html
<aside class="flex flex-col rounded-xl border border-white/40 p-3.5 glass-card glass-card-purple
            [backdrop-filter:blur(16px)_saturate(1.2)] bg-white/78 relative">
  <!-- 如果没有 glass-card 类可用，手动加光晕层 -->
  <div class="absolute inset-0 pointer-events-none opacity-[0.42] 
       animate-[glass-glow-drift_18s_ease-in-out_infinite]" 
       style="background-image: radial-gradient(...), radial-gradient(...);" />
  <!-- 内容 -->
</aside>
```

### 示例 2：表格面板（冰蓝调）

```html
<section class="rounded-2xl border border-white/40 glass-card glass-card-blue">
  <div class="border-b border-[#e8eef6] px-5 py-3.5 rounded-t-2xl">
    <!-- 表头区域 -->
  </div>
  <table>
    <thead class="bg-white/40 backdrop-blur-sm">
      <!-- 表头行 -->
    </thead>
    <tbody>
      <!-- 行底色透明，让玻璃光晕透过 -->
      <tr class="bg-transparent hover:bg-[#f8fbff]/70">
        ...
      </tr>
    </tbody>
  </table>
</section>
```

### 示例 3：供应商卡片（轻琥珀调）

```html
<div class="group rounded-xl border border-white/40 glass-card-lighter glass-card-amber p-4">
  <!-- 卡片内容 -->
</div>
```

### 示例 4：AI 研判面板（深蓝强调）

```html
<div class="rounded-2xl border border-[#bfd4f4] glass-card-deeper glass-card-blue p-5">
  <!-- AI 面板内容 -->
</div>
```

---

## 表内透明化

玻璃卡片内的表格需要让光晕透过：

| 元素 | 样式 | 说明 |
|------|------|------|
| `thead` | `bg-white/40 backdrop-blur-sm` | 半透明表头 |
| `tbody tr` | `bg-transparent` | 完全透明行 |
| `tbody tr:hover` | `hover:bg-[#f8fbff]/70` | 半透明悬停 |
| 状态 Badge | 保持原有颜色 | 不受玻璃化影响 |

---

## Hero/标题栏独立方案

标题栏不使用 `.glass-card` 类——它有自己的渐变底色 + 两个大尺寸运动光晕球（`blur-[120px]`/`blur-[100px]`）+ 附加的磨砂玻璃彩光层：

```html
<section class="rounded-[28px]" style="
  background: linear-gradient(135deg, rgba(248,250,255,.9), ...);
  backdrop-filter: blur(24px);
">
  <!-- 大光晕球 -->
  <motion.div class="absolute h-[420px] w-[420px] blur-[140px]" 
       style="background: radial-gradient(circle, rgba(147,197,253,.14), ...);" />
  <!-- 彩光磨砂层 -->
  <div class="absolute inset-0 overflow-hidden rounded-[28px]" style="z-index: 1">
    <div class="absolute inset-0 opacity-[0.50] animate-[hero-glow-drift_20s_ease-in-out_infinite]" 
         style="background-image: radial-gradient(...)" />
  </div>
  <!-- 主内容 z-10 -->
</section>
```

---

## 迁移清单

| 页面区域 | 组件角色 | 玻璃类 | 色调变体 | 注意事项 |
|----------|---------|--------|----------|----------|
| 侧栏 | 目录面板 | `glass-card` | `glass-card-purple` | 使用内联光晕层，避免 `overflow-hidden` 裁剪 |
| 主内容 | 表格面板 | `glass-card` | `glass-card-blue` | `rounded-2xl`，标题栏 `rounded-t-2xl` |
| 供应商视图 | 视图容器 | `glass-card` | `glass-card-emerald` | 移除 `overflow-hidden` |
| 供应商卡片 | 子卡片 | `glass-card-lighter` | `glass-card-amber` | `p-4` 内边距 |
| AI 研判 | 分析面板 | `glass-card-deeper` | `glass-card-blue` | `border-[#bfd4f4]` |
| 标题栏 | Hero 区域 | 独立渐变方案 | 内联彩光层 | `z-index: 1` 光晕层，`backdrop-filter: blur(24px)` |

---

## 调试检查

1. **卡片是否可见彩光？** → 检查标签内是否有 `overflow-hidden` 或 `z-index: 1` 遮盖
2. **滚动颜色是否随位置变化？** → 确认没有 `background-attachment: fixed`
3. **光晕是否卡顿？** → 检查 `prefers-reduced-motion` 降级规则是否已应用
4. **文字是否可读？** → 确保 `backdrop-filter` 不透明度 ≥ 78%
5. **卡片内容是否覆盖了光晕？** → 移除 `.glass-card > * { z-index: 1 }` 样式
