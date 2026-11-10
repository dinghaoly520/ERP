export type ChannelName = 'inApp' | 'email' | 'sms' | 'phone';

export interface DispatchPayload {
  userId: string;
  email?: string | null;
  phone?: string | null;
  type: string;
  title: string;
  content: string;
  link?: string | null;
}

export interface NotificationChannel {
  name: ChannelName;
  send(payload: DispatchPayload): Promise<ChannelSendResult>;
}

/** 单渠道投递结果，供 NotificationDeliveryLog 记录。 */
export interface ChannelSendResult {
  status: 'sent' | 'skipped' | 'failed';
  error?: string;
  /** 网关回执标识（融易达 taskId）——短信逐条对账用（2026-11-10） */
  providerRef?: string;
  /** 掩码手机号（138****0001）——多联系人投递时定位具体号码；PII 不落明文 */
  phoneMasked?: string;
}

/** 根据用户联系方式判断某渠道是否应分发。 */
export function shouldDispatch(channel: ChannelName, user: { email?: string | null; phone?: string | null }): boolean {
  if (channel === 'inApp') return true;
  if (channel === 'email') return !!user.email;
  if (channel === 'sms') return !!user.phone;
  if (channel === 'phone') return !!user.phone;
  return false;
}
