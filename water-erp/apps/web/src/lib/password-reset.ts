export type PasswordResetForm = {
  username: string;
  applicantName: string;
  applicantContact: string;
  verificationCode: string;
  newPassword: string;
  confirmPassword: string;
};

const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export function validatePasswordResetRequest(input: PasswordResetForm): string | null {
  if (!input.username.trim()) return "请输入需要重置的账号。";
  if (!input.applicantName.trim()) return "请输入申请人姓名。";
  if (!input.applicantContact.trim()) return "请输入申请人联系方式。";
  if (!/^\d{11}$/.test(input.applicantContact.trim())) return "联系方式必须是11位手机号。";
  if (!input.verificationCode.trim()) return "请输入短信验证码。";
  if (!/^\d{6}$/.test(input.verificationCode.trim())) return "验证码应为6位数字。";
  if (!input.newPassword) return "请输入新密码。";
  if (!PASSWORD_PATTERN.test(input.newPassword)) return "新密码须至少 8 位且同时包含字母和数字。";
  if (input.confirmPassword !== input.newPassword) return "两次输入不一致。";
  return null;
}

export function normalizePasswordResetRequest(input: PasswordResetForm) {
  return {
    username: input.username.trim(),
    applicantName: input.applicantName.trim(),
    applicantContact: input.applicantContact.trim(),
    verificationCode: input.verificationCode.trim(),
    newPassword: input.newPassword,
  };
}
