# 个人中心（/profile）全面重新设计

**日期**: 2026-07-06
**范围**: `apps/web` (:3005) 的 `/profile` 路由
**性质**: 完全摒弃现有设计和UI，从零重建

## 背景

- Sidebar 标签"资料修改"名不副实——没有真正的资料编辑功能
- 现有 UI 使用旧的 `interactive-surface` / `bg-white/72` / 自定义渐变，与全站 `neu-*` 新拟态体系完全脱节
- 角色标签映射不完整
- 布局单薄，空间利用率低

## 设计决策

- **页面结构**: 独立全屏页面（路由 `/profile` 不变）
- **内容组织**: 顶部 Tab 标签切换 + 左侧固定用户信息卡 + 右侧 Tab 内容区
- **视觉风格**: 专业稳重，与采购管理工作台一致的玻璃拟态+新拟态设计语言
- **Sidebar**: 文字 `资料修改` → `个人中心`，key `profile-edit` → `personal-center`

## 页面布局

```
┌─────────────────────────────────────────────────────┐
│  [← 返回]   个人中心                                  │  ← UnifiedHeader
├─────────────────────────────────────────────────────┤
│  [👤 基本资料] [🛡 账号安全] [📋 操作日志] [⚙ 偏好设置] │  ← Tab 栏
├──────────────┬──────────────────────────────────────┤
│              │                                       │
│  ┌────────┐ │  Tab 内容区                            │
│  │ 头像     │ │                                       │
│  │          │ │  基本资料: 编辑表单（姓名/邮箱/部门）     │
│  │ 姓名     │ │  账号安全: 密码修改 + 登录记录        │
│  │ 角色标签  │ │  操作日志: 审计时间线 + 筛选          │
│  │ 部门     │ │  偏好设置: 主题/首页/紧凑模式          │
│  │ 邮箱     │ │                                       │
│  │          │ │                                       │
│  │ ──────── │ │                                       │
│  │ 统计数字  │ │                                       │
│  │ ──────── │ │                                       │
│  │          │ │                                       │
│  │ [编辑资料]│ │                                       │
│  │ [修改密码]│ │                                       │
│  └────────┘ │                                       │
│              │                                       │
└──────────────┴──────────────────────────────────────┘
```

## 四个 Tab 功能详述

### Tab 1: 基本资料（默认激活）
- 编辑表单: 姓名 (displayName)、邮箱 (email)、部门 (department 下拉)
- 只读信息: 用户名 (username)、角色、创建时间
- 表单校验: 姓名非空 1-32 字符，邮箱格式校验
- 保存按钮 `neu-btn-primary`，成功后 Hero 信息实时刷新

### Tab 2: 账号安全
- 修改密码: 当前密码 + 新密码 + 确认新密码 → 提交审批
- 登录记录: 最近登录时间、登录 IP/设备（如有）
- 安全提示: 密码强度指示、上次修改时间

### Tab 3: 操作日志
- 审计时间线列表: 操作类型、目标资源、时间、IP
- 筛选: 按操作类型、日期范围
- 分页或"加载更多"
- 空态: 暂无操作记录

### Tab 4: 偏好设置
- 主题切换: 浅色/深色/跟随系统（三选一 pill）
- 默认首页: 下拉选择（工作台/数据库/项目管理/采购台账）
- 紧凑模式: 开关切换

## 左侧用户信息卡（固定 ~280px，所有 Tab 共享）

- 头像区域: `neu-icon-well` + `UserRound` 图标（大尺寸 64px）
- 显示名称 (displayName): 粗体大号字
- 角色徽章: oklch accent pill（完整 AuthRole 映射）
- 部门名称
- 邮箱
- 分隔线
- 统计数据: 操作次数 / 登录次数 / 活跃天数
- 分隔线
- 快捷按钮: [编辑资料] 跳 Tab1 / [修改密码] 跳 Tab2
- 退出登录按钮: `neu-btn-soft is-danger`

## 角色标签修复

替换不完整的 `ROLE_LABELS` 为完整映射:
```ts
const ROLE_LABELS: Record<AuthRole, string> = {
  admin: "管理员",
  leader: "领导",
  staff: "员工",
  procurement_staff: "采购管理岗",
  bid_host: "开标主持",
  bid_expert: "评审专家",
  supplier: "供应商",
  mall: "商城用户",
};
```

## 后端改动

### `PATCH /auth/me` — 更新自己的资料
- 位置: `apps/api/src/auth/auth.controller.ts` + `auth.service.ts`
- 守卫: `AuthGuard`（任意已登录用户）
- DTO: `{ displayName?: string (1-32); email?: string | null; departmentId?: string | null }`
- 返回: 更新后的 AuthUser
- 审计: 写 AuditLog (action: PROFILE_UPDATE)

### `GET /auth/departments` — 部门下拉数据
- 返回: `Array<{ id: string; name: string; code: string | null }>`，按 name 排序

## 前端组件拆分

```
src/components/profile/
  personal-center-page.tsx       # 编排: Tab 状态 + 用户数据 + Hero + TabBar + 内容区
  personal-center-hero.tsx       # 左侧固定用户信息卡
  personal-center-tab-bar.tsx    # 顶部 Tab 导航栏
  tab-basic-info.tsx             # Tab 1: 基本资料编辑表单
  tab-security.tsx               # Tab 2: 账号安全（密码+登录记录）
  tab-activity-log.tsx           # Tab 3: 操作日志时间线
  tab-preferences.tsx            # Tab 4: 偏好设置
```

旧文件删除:
- `src/components/profile-page.tsx`
- `src/components/user-center-panel.tsx`

路由 `src/app/(main)/profile/page.tsx` import 改为新 `PersonalCenterPage`。

## 视觉系统映射

| 元素 | 类 |
|---|---|
| 顶部标题栏 | `UnifiedHeader` |
| 左侧信息卡容器 | `neu-card-static`（fixed ~280px） |
| Tab 栏容器 | glass-panel 或 panel-surface |
| Tab 按钮 | 自定义 pill tab（active 态 accent 底条） |
| 表单输入 | `neu-input` |
| 下拉选择 | `neu-select` |
| 主操作按钮 | `neu-btn-primary` |
| 次要按钮 | `neu-btn-soft` |
| 退出登录 | `neu-btn-soft is-danger` |
| 头像容器 | `neu-icon-well` |
| 角色徽章 | oklch accent pill |
| 日志时间线 | `neu-content-block` 列表项 |

**清除所有内联 `style=` 渐变/阴影覆盖**，全部使用 CSS 类。

## 验证方式

- `pnpm dev:web` :3005，登录 `/profile` 截图验证:
  1. 四个 Tab 切换（默认基本资料 → 安全 → 日志 → 偏好）
  2. 资料编辑保存后左侧信息卡实时刷新
  3. 部门下拉展开
  4. 密码修改提交审批提示
  5. 偏好切换（主题/首页/紧凑）
  6. 操作日志列表 + 筛选
  7. 退出登录流程
