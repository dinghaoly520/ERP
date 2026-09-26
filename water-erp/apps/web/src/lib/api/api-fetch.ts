/**
 * web 门户模块级裸 fetch 统一包装：补齐 tab 级会话头（X-Web-Token）。
 *
 * 背景（2026-09-26 串台修复）：token_web cookie 全浏览器仅一份，两个标签页登录
 * 不同账号时后登录者覆盖 cookie。lib/api/* 此前的裸 fetch 只带 cookie 不带
 * X-Web-Token，先登录的标签页会以他人身份请求——实测 admin 标签页的项目管理
 * 列表退化为另一 staff 账号的可见范围（非 admin 仅本人项目）。
 * 统一经此包装注入 X-Web-Token（sessionStorage，tab 级）+ X-Portal；cookie 仍带
 * （credentials 默认 include），作为无头/SSR 场景的后端回退路径。
 * 签名与原生 fetch 兼容：URL/init 原样透传，仅补头与默认 credentials。
 */
import { getWebToken } from '@/lib/session-store';

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getWebToken();
  const headers = new Headers(init.headers);
  headers.set('X-Portal', 'web');
  if (token) headers.set('X-Web-Token', token);
  return fetch(input, { ...init, credentials: init.credentials ?? 'include', headers });
}
