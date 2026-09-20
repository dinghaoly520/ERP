// e2e 全局 setup（jest-e2e.json setupFiles）：放宽登录限流。
// 单设备登录套件（auth.e2e-spec.ts「单设备登录」describe）一个测试文件内需连续
// 10+ 次登录（互踢语义=每次登录都打 login 端点），默认 10/min 路由限流会被击穿。
// 仅影响测试进程；生产默认不变（auth.controller.ts 10/min）。
process.env.THROTTLE_LOGIN_LIMIT = '100';
