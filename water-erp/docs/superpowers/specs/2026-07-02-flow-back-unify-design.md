# 返回首页按钮样式统一设计

**日期:** 2026-07-02  
**状态:** 设计中  
**目标:** 将"返回首页"按钮（`.flow-back`）的样式完全统一为"全部公告"按钮（`.announce-view-all`）的 neumorphic 凸起边框设计。

## 动机

当前系统中两个 link-button 存在细微差异：

| 属性 | `.flow-back`（返回首页） | `.announce-view-all`（全部公告） |
|------|--------------------------|----------------------------------|
| 默认背景 | `#fff` | `#f4f7fc` |
| 默认阴影 | 较深（alpha 0.18/0.9） | 较柔和（alpha 0.1/0.85） |
| 悬停背景 | 不变 `#fff` | `#eef2f8` |
| 悬停阴影 | 更深（alpha 0.22/0.95） | 柔和（alpha 0.14/0.9） |
| 箭头动画 | 无 | 右滑 4px + 蓝色圆形背景 |
| 按下态 | ✅ 内凹效果 | 无 |

用户要求统一为全部公告的设计。

## 涉及文件

### CSS（核心改动）
- `apps/public-portal/src/app/globals.css` — 修改 `.flow-back` / `.flow-back:hover` / `.flow-back:active`，新增 `.flow-back-arrow` 及 hover 规则

### TSX 组件（给 SVG 加 className）
- `apps/public-portal/src/app/procurement-portal/page.tsx` — 第 29 行 SVG 加 `className="flow-back-arrow"`
- `apps/public-portal/src/app/bidding-hall/page.tsx` — 第 28 行 SVG 加 `className="flow-back-arrow"`
- `apps/public-portal/src/app/announcements/page.tsx` — SVG 加 `className="flow-back-arrow"`
- `apps/public-portal/src/app/announcements/[id]/page.tsx` — SVG 加 `className="flow-back-arrow"`
- `apps/public-portal/src/components/flow-header.tsx` — 第 16 行的 `←` 字符替换为 SVG 并加 `className="flow-back-arrow"`

## CSS 变更明细

### `.flow-back`（默认态）

```css
.flow-back {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  gap: 6px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  color: #5a6d8a;
  background: #f4f7fc;                    /* was #fff */
  border: none;
  border-radius: 8px;
  text-decoration: none;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.7),     /* was / 0.9 */
    2px 2px 4px oklch(0.55 0.03 258 / 0.1), /* was 5px / 0.18 */
    -1px -1px 3px oklch(1 0 0 / 0.85);     /* was -2px -2px 5px / 0.9 */
  transition: all 0.3s ease;
}
```

### `.flow-back:hover`

```css
.flow-back:hover {
  color: #064ea2;
  background: #eef2f8;                     /* was #fff */
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.8),      /* was / 0.95 */
    3px 3px 6px oklch(0.55 0.03 258 / 0.14), /* was 8px / 0.22 */
    -2px -2px 5px oklch(1 0 0 / 0.9);       /* was 6px / 0.95 */
}
```

### `.flow-back:active`（保留增强）

```css
.flow-back:active {
  box-shadow:
    inset 2px 2px 5px oklch(0.55 0.03 258 / 0.15),
    inset -2px -2px 5px oklch(1 0 0 / 0.5);
}
```

### 新增 `.flow-back-arrow` + hover

```css
.flow-back-arrow {
  width: 18px;
  height: 18px;
  padding: 2px;
  border-radius: 50%;
  background: transparent;
  transition:
    transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.3s ease;
}

.flow-back:hover .flow-back-arrow {
  transform: translateX(-4px);             /* 左滑（镜像全部公告的右滑） */
  background: rgba(6, 78, 162, 0.08);
}
```

## TSX 变更明细

### 所有 `.flow-back` 内的 SVG 图标

变更前（以 procurement-portal 为例）：
```tsx
<a href="/" className="flow-back">
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
  返回首页
</a>
```

变更后：
```tsx
<a href="/" className="flow-back">
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow"><path d="M15 18l-6-6 6-6"/></svg>
  返回首页
</a>
```

### flow-header.tsx 特殊处理

将 `← 返回首页` 改为与其余页面一致的 SVG + 文字形式：
```tsx
<button onClick={() => router.push('/')} className="flow-back">
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow"><path d="M15 18l-6-6 6-6"/></svg>
  返回首页
</button>
```

## 影响范围

- **视觉**：所有"返回首页"按钮外观与"全部公告"按钮完全一致
- **行为**：悬停时箭头左滑（全部公告是右滑），方向语义正确——"返回"向左，"查看更多"向右
- **范围**：5 个 `.flow-back` 使用位置全部统一更新
