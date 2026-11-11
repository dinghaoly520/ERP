# 诊断：procurement-portal 返回首页按钮内联 style 破坏视觉与交互

## 用户问题

在 `apps/public-portal/src/app/procurement-portal/page.tsx` 给"返回首页"按钮加了：

```tsx
style={{ background: '#ffffff', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
```

结果：和首页风格不搭，且 hover 没反应了。

---

## 根因分析

这是 cgzxui skill 明确列出的两个反模式的叠加，**根因是单一来源原则被破坏**：

### 问题 1：内联 `style` 绕过了 `:hover` / `:active` 选择器（hover 失效的直接原因）

React 的内联 `style` 被编译成元素的 `style` HTML 属性，其 CSS 优先级是 **inline level**。而 `globals.css` 中 `.flow-back:hover { ... }` 是 **selector level**，优先级低于 inline。

所以无论鼠标是否悬停，浏览器都用 `style` 里写死的 `background` / `boxShadow` 覆盖掉 `:hover` 规则——hover 态完全失效，`:active` 内凹态同样失效。**这就是"hover 没反应了"的原因。**

这是 skill 核心原则 1（"单一 CSS 来源，不写内联样式"）警告的过去反复出现的 bug 来源，也是反模式表里"内联 `style` 覆盖类名 → 绕过 `:hover`/`:active` 选择器，三态失效"的精确命中。

### 问题 2：扁平 omnidirectional shadow 破坏 neumorphic 设计语言（风格不搭的原因）

`boxShadow: '0 4px 20px rgba(0,0,0,0.1)'` 有三个问题，每个都命中 skill 反模式表：

- **零方向偏移（`0 0`）**：neumorphic 设计要求光源在左上方——暗影投向右下（`2px 2px`）、亮高光留在左上（`-1px -1px`）。`0 4px` 的偏移只在垂直方向，没有水平方向的亮暗对比，丧失"从页面浮起"的物理感。
- **过大的 blur（`20px`）+ 过高的 alpha（`0.1`）**：skill 规定链接按钮暗影 alpha `0.08–0.18`、blur 上限 `14px`。`20px` 的 blur 会让阴影弥散成"光晕"，视觉噪声压过内容。
- **`rgba(0,0,0,0.1)` 纯黑**：skill 规定阴影色用 `oklch(0.55 0.03 258)`（冷蓝灰），保证阴影在不同亮度下保持一致的"冷蓝灰"基调。纯黑阴影会让按钮看起来发"脏"、发灰，和首页冷调背景脱节。
- **缺失 `inset 0 1px 0 oklch(1 0 0 / 0.7)` 内高光线**：skill 把这条称为"neumorphic 设计的灵魂"——它模拟光线捕获在元素顶部边缘的物理现象。没有它，按钮只是"有阴影的方块"，像贴上去的贴纸。

此外 `background: '#ffffff'` 纯白也偏离 `.flow-back` 规定的 `#f4f7fc`（极淡的冷蓝灰），与首页背景 `oklch(0.975 0.012 258)` 融为一体而非微微浮起。

---

## 修复

**删除内联 `style`，保留类名即可。** `.flow-back` 在 `globals.css` 中已经定义了完整的默认/hover/active 三态。当前页面 `page.tsx` 第 28-31 行的写法本身就是正确的——只要把内联 `style` 移除：

```tsx
<a href="/" className="flow-back">
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow"><path d="M15 18l-6-6 6-6"/></svg>
  返回首页
</a>
```

如果确实需要微调（比如想要更强的凸起感），**改 `globals.css` 中 `.flow-back` 的对应属性，绝不在 TSX 加内联 `style`**。例如想要更明显的阴影，把暗影 alpha 从 `0.1` 提到 `0.14`、blur 从 `4px` 提到 `6px`，仍保持方向性双影结构。

`.flow-back` 的完整三态 CSS（来自 `references/component-specs.md`，同步自 `globals.css`）：

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
  background: #f4f7fc;          /* 不是 #ffffff */
  border: none;
  border-radius: 8px;
  text-decoration: none;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.7),            /* 内高光线（灵魂细节） */
    2px 2px 4px oklch(0.55 0.03 258 / 0.1),      /* 右下暗影 */
    -1px -1px 3px oklch(1 0 0 / 0.85);           /* 左上亮光 */
  transition: all 0.3s ease;
}
.flow-back:hover {
  color: #064ea2;
  background: #eef2f8;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.8),
    3px 3px 6px oklch(0.55 0.03 258 / 0.14),
    -2px -2px 5px oklch(1 0 0 / 0.9);
}
.flow-back:active {
  box-shadow:
    inset 2px 2px 5px oklch(0.55 0.03 258 / 0.15),
    inset -2px -2px 5px oklch(1 0 0 / 0.5);
}
```

---

## 适用的 skill 原则

| 原则 | 如何适用 |
|------|---------|
| **核心原则 1：单一 CSS 来源，不写内联样式** | 内联 `style` 绕过 `:hover`/`:active`，是 hover 失效的根因。修复方式就是删除内联 style。 |
| **核心原则 2：方向性双影，不用扁平 shadow** | `0 4px 20px rgba(0,0,0,0.1)` 是 omnidirectional 扁平 shadow，破坏"浮起"物理感。类名自带 `2px 2px` + `-1px -1px` 双向偏移。 |
| **核心原则 3：oklch() 色彩空间** | 阴影应用 `oklch(0.55 0.03 258)` 冷蓝灰，而非 `rgba(0,0,0)` 纯黑。 |
| **核心原则 4：三态完整（默认/hover/active）** | 内联 style 让三态全失效；类名恢复后 hover 抬升 + active 内凹都回来。 |
| **反模式表** | 命中三条：扁平 shadow、内联 style 覆盖类名、同组件混用非 neumorphic shadow（Material elevation 风格）。 |

---

## 一句话总结

删除 `<a>` 上的内联 `style`，让 `.flow-back` 类名接管——内联 style 是 hover 失效的根因，扁平 `rgba(0,0,0)` shadow 是风格不搭的根因，类名已内置完整的 neumorphic 三态。
