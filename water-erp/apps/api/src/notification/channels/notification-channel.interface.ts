export type ChannelName = 'inApp' | 'email' | 'sms';

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
  send(payload: DispatchPayload): Promise<void>;
}

/** 根据用户联系方式判断某渠道是否应分发。 */
export function shouldDispatch(channel: ChannelName, user: { email?: string | null; phone?: string | null }): boolean {
  if (channel === 'inApp') return true;
  if (channel === 'email') return !!user.email;
  if (channel === 'sms') return !!user.phone;
  return false;
}
