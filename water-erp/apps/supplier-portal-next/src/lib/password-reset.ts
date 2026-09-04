export interface PasswordResetRequestInput {
  username: string;
  applicantName: string;
  applicantContact: string;
  verificationCode: string;
  newPassword: string;
  confirmPassword: string;
}

const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export function validatePasswordResetRequest(input: PasswordResetRequestInput): string | null {
  if (!input.username.trim()) return "请输入需要重置的账号";
  if (!input.applicantName.trim()) return "请输入申请人姓名";
  if (!input.applicantContact.trim()) return "请输入申请人手机号码";
  if (!/^1\d{10}$/.test(input.applicantContact.trim())) return "联系方式必须是11位大陆手机号";
  if (!input.verificationCode.trim()) return "请输入短信验证码";
  if (!/^\d{6}$/.test(input.verificationCode.trim())) return "验证码应为6位数字";
  if (!input.newPassword.trim()) return "请输入新密码";
  if (!PASSWORD_PATTERN.test(input.newPassword)) return "新密码须至少 8 位且包含字母与数字";
  if (input.confirmPassword !== input.newPassword) return "两次输入的密码不一致";
  return null;
}

export function normalizePasswordResetRequest(input: PasswordResetRequestInput): PasswordResetRequestInput {
  return {
    username: input.username.trim(),
    applicantName: input.applicantName.trim(),
    applicantContact: input.applicantContact.trim(),
    verificationCode: input.verificationCode.trim(),
    newPassword: input.newPassword.trim(),
    confirmPassword: input.confirmPassword.trim(),
  };
}
