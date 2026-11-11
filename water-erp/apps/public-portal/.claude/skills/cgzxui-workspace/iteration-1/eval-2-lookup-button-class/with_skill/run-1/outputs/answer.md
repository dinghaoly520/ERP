# 公告列表页底部"查看全部"链接按钮 — 类名与代码

## 类名（与首页"全部公告"完全一致）

- 容器：`.announce-view-all`
- 箭头 SVG：`.announce-view-all-arrow`

> 首页"全部公告"按钮用的就是这两个类名（见 `home-client.tsx` 第 366-369 行）。箭头方向是**右滑**（`transform: translateX(4px)`），符合你的需求。

## JSX 片段（直接复制使用）

```tsx
<a href="/announcements" className="announce-view-all">
  查看全部
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
    strokeLinejoin="round" className="announce-view-all-arrow">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
</a>
```

## 精确 CSS 值（已存在于 globals.css，无需新增）

```css
/* ── 默认态：凸起 ── */
.announce-view-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  color: #5a6d8a;
  background: #f4f7fc;
  border-radius: 8px;
  text-decoration: none;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.7),          /* 顶缘内高光 */
    2px 2px 4px oklch(0.55 0.03 258 / 0.1),    /* 右下暗影 */
    -1px -1px 3px oklch(1 0 0 / 0.85);         /* 左上亮光 */
  transition: all 0.3s ease;
}

/* ── 悬停态：抬升 + 文字变蓝 ── */
.announce-view-all:hover {
  color: #064ea2;
  background: #eef2f8;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.8),
    3px 3px 6px oklch(0.55 0.03 258 / 0.14),
    -2px -2px 5px oklch(1 0 0 / 0.9);
}

/* ── 箭头：默认透明圆形 ── */
.announce-view-all-arrow {
  width: 18px;
  height: 18px;
  padding: 2px;
  border-radius: 50%;
  background: transparent;
  transition:
    transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.3s ease;
}

/* ── 悬停时箭头向右滑 4px + 出现淡蓝圆形背景 ── */
.announce-view-all:hover .announce-view-all-arrow {
  transform: translateX(4px);
  background: rgba(6, 78, 162, 0.08);
}
```

## 为什么用这两个类名

1. **单一 CSS 来源**：cgzxui skill 规定所有视觉规则集中在 `globals.css`，不写内联 `style`。`.announce-view-all` 已经定义了完整的三态（默认凸起 / hover 抬升 / 配合箭头动画），直接复用即可保持视觉一致性。
2. **方向性双影 + 内高光线**：`inset 0 1px 0 oklch(1 0 0 / 0.7)` 是 neumorphic 设计的灵魂——模拟顶部边缘光线，没有它按钮只是"有阴影的方块"。
3. **箭头动画方向**：`.announce-view-all-arrow` 在 hover 时 `translateX(4px)`——向右滑，正好符合"查看全部"的语义方向（与首页"全部公告"完全相同）。

## 注意事项

- 首页"全部公告"和"返回首页"（`.flow-back`）是**镜像对称**的两个类：`.flow-back` 的箭头 `translateX(-4px)` 向左滑；`.announce-view-all` 的箭头 `translateX(4px)` 向右滑。你要的是后者。
- 如果公告列表页底部这个按钮要跳转的 URL 不是 `/announcements`，把 `href` 改成实际目标即可，类名保持不变。
- 不要给这个按钮再加 `style={...}` 内联样式，否则会绕过 `:hover` / `:active` 选择器导致三态失效。
