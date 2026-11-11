# 公告列表页底部「查看全部」按钮 — 复用首页「全部公告」样式

## 类名

复用首页「全部公告」链接按钮的两个类名（无需新增任何 CSS）：

- 容器：`announce-view-all`
- 箭头 SVG：`announce-view-all-arrow`

这两个类已经定义在 `apps/public-portal/src/app/globals.css`（第 1877–1918 行），是首页公告标题栏右侧「全部公告」按钮所用的类。直接复用即可得到一模一样的凸起拟态样式和箭头朝右滑出的悬停动画。

## JSX 片段

直接复制首页 `home-client.tsx` 第 366–369 行的结构即可（把链接文案改成"查看全部"，`href` 改成你想要的目标地址）：

```tsx
<a href="/announcements" className="announce-view-all">
  查看全部
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="announce-view-all-arrow"
  >
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
</a>
```

注意：
- `<a>` 标签本身不要再加 Tailwind 的 text-color / padding / background 类，否则会覆盖 `.announce-view-all` 的视觉。
- SVG 必须带 `className="announce-view-all-arrow"`，这样箭头才能命中 `:hover` 时 `transform: translateX(4px)` 的滑出动画。
- 文字与 SVG 之间的间距由 `.announce-view-all { gap: 6px }` 控制，不要自己加 margin。

## 对应的 CSS 值（已在 globals.css 中定义，无需改动）

`.announce-view-all`（凸起拟态按钮本体，globals.css 第 1877–1902 行）：

```css
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
    inset 0 1px 0 oklch(1 0 0 / 0.7),
    2px 2px 4px oklch(0.55 0.03 258 / 0.1),
    -1px -1px 3px oklch(1 0 0 / 0.85);
  transition: all 0.3s ease;
}

.announce-view-all:hover {
  color: #064ea2;
  background: #eef2f8;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.8),
    3px 3px 6px oklch(0.55 0.03 258 / 0.14),
    -2px -2px 5px oklch(1 0 0 / 0.9);
}
```

`.announce-view-all-arrow`（右滑箭头动画，globals.css 第 1904–1918 行）：

```css
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

.announce-view-all:hover .announce-view-all-arrow {
  transform: translateX(4px);
  background: rgba(6, 78, 162, 0.08);
}
```

箭头朝向：右（SVG path `M5 12h14` + `m12 5 7 7-7 7` 是 → 形状）；动画方向：悬停时 `translateX(4px)` 向右滑出。

## 出处

- 源 JSX：`apps/public-portal/src/app/home-client.tsx` 第 366–369 行
- 源 CSS：`apps/public-portal/src/app/globals.css` 第 1877–1918 行
