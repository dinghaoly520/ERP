/**
 * TAB-SYNC-01 平板配对受限令牌——写面白名单（spec §6「默认拒绝制」数据面）。
 *
 * 平板持 scoped JWT（scope=tablet-pairing）时，PairingScopeGuard 对所有请求默认拒绝，
 * 仅放行本表逐条列出的端点；新增专家端点若漏配，平板侧自动被拒（镜像 2026-08-26
 * RolesGuard default-deny 教训——不会出现「忘了拦」）。
 *
 * 路径匹配口径：`req.path` 去 `/api` 全局前缀后与本表 RegExp 比对
 * （`req.path` 实含 /api 前缀，见 port-route.guard / operation-log.filter 同口径实证）。
 * 只列 HTTP 面——WS 网关握手/join 不经全局守卫（spec §10 另行约束）。
 */

/** AuthGuard（Task 4）为 scoped token 挂载的配对上下文 */
export interface PairingScope {
  /** 配对绑定的项目（JWT pid） */
  projectId: string;
  /** 配对专家（JWT eid，BidExpert.id） */
  expertId: string;
  /** 配对登记 jti（Redis expert-pairing:{jti} 对应） */
  pairingId: string;
}

export interface PairingAllowEntry {
  /** HTTP 方法（大写） */
  method: string;
  /** 去前缀后的路径模式 */
  path: RegExp;
  /** 仅 POST /upload 用：req.query.category 必须等于该类目（类目级放行，非整端点放行） */
  uploadCategory?: string;
}

export const PAIRING_ALLOWED: ReadonlyArray<PairingAllowEntry> = [
  // 草稿写（核心写面；服务层 saveScoreDraft 对 scoped 请求强制 device='tablet'）
  { method: 'POST', path: /^\/expert\/projects\/[^/]+\/score-draft$/ },
  // 备忘全 CRUD（平板手写备忘是核心价值）；墨迹 PNG 走 memos multipart 本体，不经 /upload
  { method: 'POST', path: /^\/expert\/projects\/[^/]+\/memos/ },
  { method: 'PATCH', path: /^\/expert\/projects\/[^/]+\/memos/ },
  { method: 'DELETE', path: /^\/expert\/projects\/[^/]+\/memos/ },
  { method: 'GET', path: /^\/expert\/projects\/[^/]+\/memos\/[^/]+\/ink$/ },
  // 配对留档照（claim 成功后拍照发生在 scoped 态——漏配会把强制留档照死锁在配对流程内）
  { method: 'GET', path: /^\/expert\/projects\/[^/]+\/pairing-photo-status$/ },
  { method: 'POST', path: /^\/expert\/projects\/[^/]+\/pairing-photo$/ },
  // 留档照上传（类目级放行； multer 走 /upload?category=expert_signin_photo）
  { method: 'POST', path: /^\/upload$/, uploadCategory: 'expert_signin_photo' },
  // 焦点确认（平板侧轮询；读取自带 ACK 副作用）
  { method: 'GET', path: /^\/expert\/projects\/[^/]+\/focus-hint$/ },
  // 评标室口令自验（二轮修正：口令轮换后平板须能自验，否则假死到桌面重验）
  { method: 'POST', path: /^\/expert\/projects\/[^/]+\/room-code\/verify$/ },
  // 澄清文件下载（读形写法：流式直出 + 监督日志副作用）
  { method: 'POST', path: /^\/expert\/projects\/[^/]+\/clarification-docs\/[^/]+\/download$/ },
  // 会话维持（logout 是登出分流前提；heartbeat 供平板 15s 心跳即时感知吊销；me 供 layout 鉴权）
  { method: 'POST', path: /^\/auth\/logout$/ },
  { method: 'GET', path: /^\/auth\/heartbeat$/ },
  { method: 'GET', path: /^\/auth\/me$/ },
  // 只读全集（平板渲染所需；项目类端点另受 pid 绑定约束）
  { method: 'GET', path: /^\/expert\/projects/ },
  { method: 'GET', path: /^\/expert\/profile/ },
  { method: 'GET', path: /^\/expert\/statistics$/ },
  { method: 'GET', path: /^\/expert\/tasks$/ },
];
