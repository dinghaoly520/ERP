// e2e 全局 setup（jest-e2e.json setupFiles）：放宽登录限流。
// 单设备登录套件（auth.e2e-spec.ts「单设备登录」describe）一个测试文件内需连续
// 10+ 次登录（互踢语义=每次登录都打 login 端点），默认 10/min 路由限流会被击穿。
// 仅影响测试进程；生产默认不变（auth.controller.ts 10/min）。
process.env.THROTTLE_LOGIN_LIMIT = '100';

// 注册验证码 bypass（supplier.e2e 依赖 123456 直过）：.env 是本地文件不入库，
// 开发机可能被改为 false（真实短信调试），测试进程显式自洽——不依赖本机 .env 状态。
// 生产不受影响（verification.service 对 NODE_ENV=production 双保险拒绝 bypass）。
process.env.SMS_DEBUG_BYPASS = process.env.SMS_DEBUG_BYPASS ?? 'true';
