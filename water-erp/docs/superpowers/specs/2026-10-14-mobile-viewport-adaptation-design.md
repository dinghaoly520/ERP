# 移动驾驶舱 :3011 屏幕尺寸适配设计

- **日期**：2026-10-14
- **状态**：已获用户批准（四项全做）
- **基线**：`docs/superpowers/specs/2026-10-13-mobile-portal-3011-design.md` 及打磨/规范两轮

## 决策记录（审计驱动，纯 CSS/类名级，零依赖）

| # | 问题 | 修复 |
|---|------|------|
| 1 | 输入字号 13–15px < 16px → iOS Safari 聚焦强制缩放页面 | `.m-input` 基础字号 **16px**；删除 m-input 实例上全部 `<16px` 字号覆写（登录/搜索/日期/公司下拉） |
| 2 | 平板/折叠屏单列内容拉满 768px+ 难读 | `(main)` 内容容器 `mx-auto w-full max-w-lg`（512px 舒适宽；手机全宽不受影响；顶栏/Tab 栏保持全宽应用外框） |
| 3 | `viewport-fit=cover` 下横屏刘海裁切 | header / main / `.m-tabbar` / `.m-sheet-panel` 补 `env(safe-area-inset-left/right)` 内边距（`max()` 与既有 padding 取大者） |
| 4 | 320–359px 多列网格挤压 | 台账汇总 `grid-cols-2 min-[360px]:grid-cols-4`；数据库结果构成 gap 收紧 `gap-1.5 min-[360px]:gap-2`（truncate 已有） |

## 验证

- `tsc` / `next build` / 红牌扫描保持零硬性
- 编译 CSS 中 `.m-input` font-size=16px、`max-w-lg` 工具类存在
- DevTools 设备档抽查：iPhone SE(375/320)、iPhone 14 Pro Max(430)、iPad Mini(768) 无横向滚动、内容列居中

## 范围外（YAGNI）

横屏专属布局（Tab 栏侧移）、PWA manifest、深色模式。
