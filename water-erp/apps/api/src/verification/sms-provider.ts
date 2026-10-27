import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';

/** SMS 验证码发送通道抽象——真实网关（泛型 HTTP）与本地控制台（仅非生产 debug）可替换。 */
export interface SmsProvider {
  readonly id: string;
  /** 发送验证码短信；返回网关请求标识（无则 undefined）。失败抛错（调用方决定是否回滚 Redis 记录）。 */
  send(phone: string, code: string, scene: string): Promise<{ requestId?: string } | undefined>;
}

/** 生产形态：泛型 HTTP 网关（阿里云/腾讯云等网关模式通用）。env：
 * SMS_HTTP_ENDPOINT（必填，POST JSON）、SMS_HTTP_API_KEY、SMS_HTTP_TEMPLATE_ID、SMS_HTTP_FROM_SIGN、
 * 请求体 { phone, code, scene, templateId, fromSign, apiKey }（网关侧适配模板）。 */
@Injectable()
export class HttpSmsProvider implements SmsProvider {
  readonly id = 'http';
  private readonly logger = new Logger(HttpSmsProvider.name);

  async send(phone: string, code: string, scene: string): Promise<{ requestId?: string } | undefined> {
    const endpoint = process.env.SMS_HTTP_ENDPOINT;
    if (!endpoint) {
      throw new Error('SMS_HTTP_ENDPOINT 未配置');
    }
    const body = {
      phone,
      code,
      scene,
      templateId: process.env.SMS_HTTP_TEMPLATE_ID ?? '',
      fromSign: process.env.SMS_HTTP_FROM_SIGN ?? '',
      apiKey: process.env.SMS_HTTP_API_KEY ?? '',
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new Error(`SMS 网关响应异常：HTTP ${res.status}`);
    }
    const data = (await res.json().catch(() => ({}))) as { requestId?: string };
    this.logger.log(`SMS 已发送：${scene} → ${this.mask(phone)}${data.requestId ? `（${data.requestId}）` : ''}`);
    return data.requestId ? { requestId: data.requestId } : undefined;
  }

  private mask(phone: string): string {
    return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '***';
  }
}


/** 生产形态：阿里云国内短信（Dysmsapi SendSms，ACS3-HMAC-SHA256 签名直连，无 SDK 依赖）。env：
 * ALIYUN_SMS_ACCESS_KEY_ID / ALIYUN_SMS_ACCESS_KEY_SECRET（RAM 子账号，建议仅授 dysmsapi:SendSms）、
 * ALIYUN_SMS_SIGN_NAME（已审签名）、ALIYUN_SMS_TEMPLATE_CODE（中性验证码模板，变量名须为 ${code}——专家核验等无门户措辞场景用）、
 * ALIYUN_SMS_TEMPLATE_CODE_SUPPLIER（可选：供应商门户 :3004 注册专属模板，缺省回退中性）、
 * ALIYUN_SMS_TEMPLATE_CODE_MANAGEMENT（可选：管理端 :3005 注册专属模板，缺省回退中性）、
 * ALIYUN_SMS_TEMPLATE_CODE_PASSWORD_RESET（可选：两端忘记密码专属模板，缺省回退中性）。 */
@Injectable()
export class AliyunSmsProvider implements SmsProvider {
  readonly id = 'aliyun';
  private readonly logger = new Logger(AliyunSmsProvider.name);

  /** RFC3986 percent-encode（encodeURIComponent 漏编 !'()*，签名串里必须补上）。 */
  private static pe(s: string): string {
    return encodeURIComponent(s).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  /** 场景→模板：门户专属措辞按场景分流，各自缺省回退中性模板（专家核验等场景始终走中性）。 */
  private pickTemplate(scene: string): string | undefined {
    const generic = process.env.ALIYUN_SMS_TEMPLATE_CODE;
    if (scene === 'management_registration') {
      return process.env.ALIYUN_SMS_TEMPLATE_CODE_MANAGEMENT || generic;
    }
    if (scene === 'management_password_reset' || scene === 'supplier_password_reset') {
      return process.env.ALIYUN_SMS_TEMPLATE_CODE_PASSWORD_RESET || generic;
    }
    if (scene === 'supplier_registration') {
      return process.env.ALIYUN_SMS_TEMPLATE_CODE_SUPPLIER || generic;
    }
    return generic;
  }

  async send(phone: string, code: string, scene: string): Promise<{ requestId?: string } | undefined> {
    const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
    const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
    const signName = process.env.ALIYUN_SMS_SIGN_NAME;
    const templateCode = this.pickTemplate(scene);
    if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
      throw new Error(
        '阿里云短信配置不完整（需 ALIYUN_SMS_ACCESS_KEY_ID/SECRET、ALIYUN_SMS_SIGN_NAME、ALIYUN_SMS_TEMPLATE_CODE）',
      );
    }

    // 业务参数全量入 query（RPC 风格 API，V3 签名要求 canonical query 按 key 排序；Action/Version 走 header）
    const params: Record<string, string> = {
      PhoneNumbers: phone,
      SignName: signName,
      TemplateCode: templateCode,
      TemplateParam: JSON.stringify({ code }),
    };
    const canonicalQuery = Object.keys(params)
      .sort()
      .map((k) => `${AliyunSmsProvider.pe(k)}=${AliyunSmsProvider.pe(params[k])}`)
      .join('&');

    const host = 'dysmsapi.aliyuncs.com';
    const hashedEmptyBody = createHash('sha256').update('').digest('hex');
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); // ISO8601 UTC，阿里云不带毫秒
    const nonce = randomUUID();
    const signedHeaders = 'host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version';
    const headers: Record<string, string> = {
      'x-acs-action': 'SendSms',
      'x-acs-content-sha256': hashedEmptyBody,
      'x-acs-date': timestamp,
      'x-acs-signature-nonce': nonce,
      'x-acs-version': '2017-05-25',
    };
    // header 行必须按 key 字母序（实测乱序 → SignatureDoesNotMatch，服务端回显 canonical 可对账）
    const canonicalRequest = [
      'POST',
      '/',
      canonicalQuery,
      `host:${host}`,
      ...Object.entries(headers)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`),
      '',
      signedHeaders,
      hashedEmptyBody,
    ].join('\n');
    const stringToSign = `ACS3-HMAC-SHA256\n${createHash('sha256').update(canonicalRequest).digest('hex')}`;
    const signature = createHmac('sha256', accessKeySecret).update(stringToSign).digest('hex');
    const Authorization =
      `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;

    const res = await fetch(`https://${host}/?${canonicalQuery}`, {
      method: 'POST',
      headers: { Authorization, ...headers },
      signal: AbortSignal.timeout(8_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    // 成功体 { Code:'OK', RequestId, BizId }；V3 错误体为小写 { code, message, statusCode }，两态都归一
    const bizCode = (data.Code ?? data.code) as string | undefined;
    const bizMessage = (data.Message ?? data.message) as string | undefined;
    if (!res.ok || (bizCode && bizCode !== 'OK')) {
      throw new Error(`阿里云短信发送失败：${bizCode ?? `HTTP ${res.status}`} ${bizMessage ?? ''}`.trim());
    }
    this.logger.log(`SMS 已发送：${scene} → ${this.mask(phone)}（BizId ${String(data.BizId ?? '')}）`);
    return data.RequestId ? { requestId: String(data.RequestId) } : undefined;
  }

  private mask(phone: string): string {
    return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '***';
  }
}

/** 生产形态：融易达短信平台（接口文档 V2.3，JSON 端点 POST /http/send）。env：
 * RYD_APPID / RYD_APPKEY（融易达 WEB 控制台自助生成）、RYD_SIGN_NAME（平台已报备签名，须与 msg 内【签名】一致）。
 * 与阿里云模板制的关键差异：融易达无模板 API/无占位符——msg 即成品全文（含【签名】），文案在本类按场景拼装；
 * 签名算法 sign = md5(appid+mobile+msg+appkey)（32 位小写，msg 以原文参与运算，仅传输时 urlencode——URLSearchParams 代办）。
 * 应答 JSON：成功 { resultCode:0, taskId, restNum, sumSize }；失败 { resultCode:<非0>, resultMsg }。 */
@Injectable()
export class RongyidaSmsProvider implements SmsProvider {
  readonly id = 'rongyida';
  private readonly logger = new Logger(RongyidaSmsProvider.name);

  /** 已知错误码→排障提示（文档第十八章；未知码原样透出）。 */
  private static readonly ERROR_MEANINGS: Record<number, string> = {
    [-1]: '手机号码不正确',
    [-2]: 'appid 对应商户信息不存在',
    [-3]: '来源 IP 未在平台绑定',
    [-4]: 'sign 校验失败（核对 appkey 与拼接顺序，md5 须用 msg 原文）',
    [-9]: '提交失败',
    [-10]: '手机号码为空',
    [-11]: '未设置短信签名（msg 内【签名】须与平台报备一致）',
    [-12]: '短信内容超长',
    [-13]: '可用条数已用尽',
    [-1000]: '系统异常',
  };

  /** 场景→文案（验证码由本系统生成，融易达只投递成品全文；全部 ≤70 字单条计费；勿写「登录」——系统无短信登录场景）。 */
  private renderMsg(code: string, scene: string): string {
    const prefix = `【${process.env.RYD_SIGN_NAME ?? ''}】`;
    if (scene === 'supplier_registration') {
      return `${prefix}您正在注册蜀水云采供应商门户，验证码${code}，5分钟内有效。`;
    }
    if (scene === 'management_registration') {
      return `${prefix}您正在注册蜀水云采采购管理工作台，验证码${code}，5分钟内有效。`;
    }
    if (scene === 'management_password_reset' || scene === 'supplier_password_reset') {
      return `${prefix}您正在重置登录密码，验证码${code}，5分钟内有效。如非本人操作请忽略。`;
    }
    // 中性兜底（专家核验等无门户措辞场景）
    return `${prefix}您的验证码为${code}，5分钟内有效。请勿告知他人。`;
  }

  async send(phone: string, code: string, scene: string): Promise<{ requestId?: string } | undefined> {
    const appid = process.env.RYD_APPID;
    const appkey = process.env.RYD_APPKEY;
    const signName = process.env.RYD_SIGN_NAME;
    if (!appid || !appkey || !signName) {
      throw new Error('融易达短信配置不完整（需 RYD_APPID/RYD_APPKEY/RYD_SIGN_NAME）');
    }

    const msg = this.renderMsg(code, scene);
    const sign = createHash('md5').update(`${appid}${phone}${msg}${appkey}`).digest('hex');
    const res = await fetch('https://ryd.189si.com/http/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      // URLSearchParams 传输时自动 urlencode（UTF-8）；sign 已按原文算好，不受编码影响
      body: new URLSearchParams({ appid, mobile: phone, msg, sign }),
      signal: AbortSignal.timeout(8_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      resultCode?: number;
      taskId?: string;
      restNum?: number;
      resultMsg?: string;
    };

    if (!res.ok || data.resultCode !== 0) {
      const meaning = RongyidaSmsProvider.ERROR_MEANINGS[Number(data.resultCode)] ?? '';
      throw new Error(`融易达短信发送失败：${data.resultCode ?? `HTTP ${res.status}`} ${data.resultMsg ?? ''} ${meaning}`.trim());
    }
    // restNum=-1 表示不限条数；仅在有限余量时随日志透出（运维信号）
    const restHint =
      typeof data.restNum === 'number' && data.restNum >= 0 ? `，余量 ${data.restNum}` : '';
    this.logger.log(`SMS 已发送：${scene} → ${this.mask(phone)}（taskId ${String(data.taskId ?? '')}${restHint}）`);
    return data.taskId ? { requestId: String(data.taskId) } : undefined;
  }

  private mask(phone: string): string {
    return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '***';
  }
}

/** 本地控制台实现：仅非生产 + SMS_DEBUG_BYPASS=true 可用（把原 console.log stub 收进 provider）。 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  readonly id = 'console';
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  async send(phone: string, code: string, scene: string): Promise<{ requestId?: string } | undefined> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ConsoleSmsProvider 不可在生产环境使用');
    }
    this.logger.warn(`[SMS-STUB] 验证码: ${code} → ${phone}（场景: ${scene}）`);
    return undefined;
  }
}

/** 按 env SMS_PROVIDER 解析 provider：'rongyida' → 融易达（验证码现役）；'aliyun' → 阿里云直连（回退通道）；'http'（默认）→ 泛型网关；'console' → 本地控制台（仅非生产）。 */
export function resolveSmsProvider(): SmsProvider {
  const mode = (process.env.SMS_PROVIDER ?? 'http').toLowerCase();
  if (mode === 'console') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMS_PROVIDER=console 不可在生产环境使用');
    }
    return new ConsoleSmsProvider();
  }
  if (mode === 'http') {
    return new HttpSmsProvider();
  }
  if (mode === 'aliyun') {
    return new AliyunSmsProvider();
  }
  if (mode === 'rongyida') {
    return new RongyidaSmsProvider();
  }
  throw new Error(`未知 SMS_PROVIDER: ${mode}`);
}
