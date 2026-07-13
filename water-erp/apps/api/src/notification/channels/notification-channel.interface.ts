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
}

/** 根据用户联系方式判断某渠道是否应分发。 */
export function shouldDispatch(channel: ChannelName, user: { email?: string | null; phone?: string | null }): boolean {
  if (channel === 'inApp') return true;
  if (channel === 'email') return !!user.email;
  if (channel === 'sms') return !!user.phone;
  if (channel === 'phone') return !!user.phone;
  return false;
}
