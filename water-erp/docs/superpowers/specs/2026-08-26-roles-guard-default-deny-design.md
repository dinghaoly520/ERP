# RolesGuard 默认拒绝 · 设计 Spec

> 日期：2026-08-26
> 状态：待审阅
> 依据：架构审计（2026-08-14）安全 P0 首项「RolesGuard 默认放行」；本次实测 20 controller / ~298 handler 无覆盖
> 用户决策（2026-08-26 确认）：①默认拒 + `@AnyRole()` 显式标记；②角色归类以前端调用面 + e2e 验证为准

---

## 1. 目标

1. **默认拒绝**：无 `@Roles` / `@Public` / `@AnyRole` 三者任一的路由，任何已登录用户一律 403——消除「supplier 角色可读预算/审计/管理端点」的越权面；
2. 每处访问成为**明示决策**（角色集 / 任何已登录 / 公开），不留隐性放行；
3. 全程每步全绿：先标注后翻转，单测 + boot smoke + 双轨 e2e 兜底。

## 2. 现状（实测）

- `RolesGuard`（`common/guards/roles.guard.ts:23-26`）：无 `@Roles` 即放行（"No @Roles decorator means public access"）——审计所指缺陷；
- 扫描（静态近似）：**20 controller / ~298 handler** 无覆盖。敏感面举例：`auth/users/:id/approve`（账号审批）、`operation-log/archive*`（归档验证/清单）、`tender-review/rules*`（规则 CRUD，DTO 层有 `@Roles('leader','admin','staff')` 但部分路由仍裸露）、`catalog/admin/*`（商城管理）、`ai/*`（分析）、`supplier` 60 条、`expert-admin` 48 条；
- 静态 grep 有假阳/假阴（方法级 `@Roles` 已存在但类级扫描误报，如 `verification`）——实施以运行时元数据扫描为准。

## 3. 设计

### 3.1 `@AnyRole()` 装饰器（新）

```ts
// common/decorators/any-role.decorator.ts
export const ANY_ROLE_KEY = 'any_role';
export const AnyRole = () => SetMetadata(ANY_ROLE_KEY, true);
```

语义：**任何已登录用户**可访问（认证边界，非授权）。适用于跨角色通用面。

### 3.2 RolesGuard 翻转

```ts
canActivate(context) {
  // @Public() 覆盖一切 —— AuthGuard 跳过，现状不变
  if (isPublic) return true;

  const hasAnyRole = getAllAndOverride<boolean>(ANY_ROLE_KEY, [handler, class]);
  const requiredRoles = getAllAndOverride<string[]>(ROLES_KEY, [handler, class]);

  if (hasAnyRole) {
    // 任何已登录用户（AuthGuard 已保证 user 存在于非 @Public 路由）
    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException({ error: '未登录', code: 'UNAUTHORIZED' });
    return true;
  }

  if (requiredRoles?.length) {
    // 现状角色匹配逻辑不变
    ...
  }

  // 默认拒绝：三者皆无 → 403（本次修复的核心）
  throw new ForbiddenException({
    error: '该端点未配置访问角色（默认拒绝）——请联系管理员配置 @Roles 或 @AnyRole',
    code: 'NO_ROLE_CONFIGURED',
  });
}
```

- 错误码 `NO_ROLE_CONFIGURED` 便于前端/日志区分「配置缺失」与「角色不符」——**故意暴露配置面信号**，方便发现遗漏标注。

### 3.3 运行时元数据扫描脚本

`scripts/list-uncovered-routes.ts`（tsx 脚本，参照 `clean-legacy-plaintext` 模式）：
- 实例化 `AppModule`（不监听端口），用 `RouterRouteSExplorer`/`MetadataScanner` 遍历所有路由；
- 每条路由输出 `{ method, path, controller, handler, hasPublic, roles, hasAnyRole }`；无覆盖的过滤输出；
- 用于 S2 前的精确清单（替代静态 grep）与 S3 后的清零验证。

### 3.4 298 个 handler 归类规则（实施时逐 controller 执行）

| 类别 | 判定依据 | 标注 |
|---|---|---|
| 敏感管理面 | 前端仅 :3005/:3007 消费（grep 各门户 api 目录）+ 模块语义 | 具体角色集（实际消费者角色，如 `@Roles('staff','leader','admin')`） |
| 跨角色通用面 | 多门户消费或语义通用（通知/搜索/仪表盘/联系人） | `@AnyRole()` |
| 公开面 | 语义公开（公告公开列表、健康检查） | `@Public`（多为补漏） |
| 单角色面 | 仅专家/仅供应商门户消费 | 对应单一角色 |

- **归类依据优先级**：前端调用点 grep > 模块语义 > 存疑时保守（先具体角色集，跑 e2e/页面后再放宽）；
- 每标注 3-5 个 controller：跑全量单测 + 该 controller 的消费前端 grep 复查；
- `app.controller`（`/` + `/health`）→ `@Public`（健康检查被 CI/运维探测依赖）。

### 3.5 e2e 断言新增

CI e2e job 追加一步「guard 抽查」：supplier token 打两个曾裸露的管理端点（`GET /operation-log/archive`、`POST /catalog/admin/items`）→ 断言 403；admin token 打同端点 → 正常。直证放行面封死。

### 3.6 文档

CLAUDE.md 鉴权段补一行：默认拒绝语义 + `@AnyRole` 的定位（认证边界非授权）+ `NO_ROLE_CONFIGURED` 排障提示。

## 4. 测试策略

- **守卫单测**（`roles.guard.spec.ts`）：无元数据 → 403 `NO_ROLE_CONFIGURED`；`@AnyRole` + user → 过；`@AnyRole` 无 user → 403；`@Roles` 匹配/不匹配（回归）；
- **扫描脚本单测/自验**：对 AppModule 跑一遍，S2 前输出基线清单、S3 后输出空；
- **全量回归**：1500+ 单测 + CI validate/e2e 两 job（含 §3.5 抽查）。

## 5. 风险与开放问题

1. **未知消费者封死**：脚本/外部调用（水叮当助手 `assistant` 无登录场景）依赖的具体端点若漏标会 403——靠 grep 全面性 + `NO_ROLE_CONFIGURED` 错误码快速定位；
2. **角色集过窄**：保守归类可能挡住合法组合（如 mall 角色访问 catalog 读）——e2e + 页面冒烟暴露后放宽，放宽比收紧安全；
3. **`getAllAndOverride` 现有语义**：类级 `@Roles` 被方法级覆盖——本设计沿用（override 语义不变），`@AnyRole` 同样可被方法级 `@Roles` 收窄；
4. **范围外**：自定义 Guard（ProcurementGuard/OwnerGuard）与 service 层 ownership 校验不动（memory `authz-model-custom-guards-and-ownership`）；本 spec 只翻转 RolesGuard 默认值并补标注。
