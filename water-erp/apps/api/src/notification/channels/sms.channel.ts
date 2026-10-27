import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { NotificationChannel, DispatchPayload, ChannelSendResult } from './notification-channel.interface';

/** 通知轨短信通道（2026-10-27 接融易达现役，替换 skipped 桩）：与验证码轨同账号
 *  （RYD_APPID/RYD_APPKEY/RYD_SIGN_NAME），直发成品全文（如 :3005 邀请固定语句）。
 *  网关要求 msg 含【签名】——正文未带时统一前置 RYD_SIGN_NAME；SMS 无标题概念，title 不参与发送。
 *  无兜底（2026-10-27 用户裁定）：网关失败即 status=failed 透出错误码，NotificationDeliveryLog 留痕。 */
@Injectable()
export class SmsChannel implements NotificationChannel {
  name = 'sms' as const;
  private readonly logger = new Logger(SmsChannel.name);

  async send(p: DispatchPayload): Promise<ChannelSendResult> {
    const appid = process.env.RYD_APPID;
    const appkey = process.env.RYD_APPKEY;
    const signName = process.env.RYD_SIGN_NAME;
    if (!p.phone) return { status: 'skipped', error: '无手机号' };
    if (!appid || !appkey || !signName) {
      return { status: 'failed', error: '融易达短信配置不完整（RYD_APPID/RYD_APPKEY/RYD_SIGN_NAME）' };
    }

    const msg = p.content.startsWith(`【${signName}】`) ? p.content : `【${signName}】${p.content}`;
    // sign 用 msg 原文参与 md5，传输才 urlencode（URLSearchParams 代办）——与验证码轨同铁律
    const sign = createHash('md5').update(`${appid}${p.phone}${msg}${appkey}`).digest('hex');

    try {
      const res = await fetch('https://ryd.189si.com/http/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ appid, mobile: p.phone, msg, sign }),
        signal: AbortSignal.timeout(8_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        resultCode?: number; taskId?: string; restNum?: number; resultMsg?: string;
      };
      // resultCode 防御性归一（与 RongyidaSmsProvider 同口径）
      const resultCode = Number(data.resultCode);
      if (!res.ok || !Number.isFinite(resultCode) || resultCode !== 0) {
        return { status: 'failed', error: `融易达 ${data.resultCode ?? `HTTP ${res.status}`} ${data.resultMsg ?? ''}`.trim() };
      }
      const restHint = typeof data.restNum === 'number' && data.restNum >= 0 ? `，余量 ${data.restNum}` : '';
      this.logger.log(`[SMS] → ${p.phone.slice(0, 3)}****${p.phone.slice(-4)}（taskId ${String(data.taskId ?? '')}${restHint}）`);
      return { status: 'sent' };
    } catch (e: unknown) {
      return { status: 'failed', error: e instanceof Error ? e.message : '网络异常' };
    }
  }
}
