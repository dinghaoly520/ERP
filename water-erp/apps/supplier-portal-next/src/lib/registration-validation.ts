export type TemporaryRegistrationForm = {
  invitationCode: string;
  password: string;
  confirmPassword: string;
  name: string;
  creditCode: string;
  legalPerson: string;
  legalPersonIdCard: string;
  registeredAddress: string;
  region: string;
  displayName: string;
  phone: string;
  email: string;
};

export type TemporaryRegistrationValidationContext = {
  verifying: boolean;
  inviteVerified: boolean;
  inviteError: string;
  agreeAgreement: boolean;
};

export type TemporaryRegistrationValidationResult = {
  step: number;
  errors: Record<string, string>;
};

export function validateLoginCredentials(username: string, password: string): string | null {
  if (!username.trim()) return "请输入用户名";
  if (!password) return "请输入密码";
  // 登录只校验是否填写。密码强度策略仅适用于创建或重置密码，兼容历史账号。
  return null;
}

export function getRegistrationDraftKey(userId: string | null | undefined): string | null {
  return userId ? `register:${userId}` : null;
}

export function validateTemporaryRegistrationStep(
  targetStep: number,
  form: TemporaryRegistrationForm,
  tags: string[],
  context: TemporaryRegistrationValidationContext,
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (targetStep === 0) {
    if (!form.invitationCode) errors.invitationCode = "请输入 8 位邀请码";
    else if (form.invitationCode.length !== 8) errors.invitationCode = "邀请码须为 8 位字母或数字";
    else if (context.verifying) errors.invitationCode = "邀请码正在校验，请稍候";
    else if (!context.inviteVerified) errors.invitationCode = context.inviteError || "邀请码尚未通过校验";

    if (!form.password) errors.password = "请输入登录密码";
    else if (form.password.length < 8 || !/(?=.*[A-Za-z])(?=.*\d)/.test(form.password)) {
      errors.password = "密码须至少 8 位，并同时包含字母和数字";
    }
    if (!form.confirmPassword) errors.confirmPassword = "请再次输入密码";
    else if (form.confirmPassword !== form.password) errors.confirmPassword = "两次输入的密码不一致";
  }

  if (targetStep === 1) {
    if (!form.name.trim()) errors.name = "请输入企业名称";
    if (!form.creditCode.trim()) errors.creditCode = "请输入统一社会信用代码";
    else if (!/^[0-9A-Z]{18}$/.test(form.creditCode.trim())) errors.creditCode = "统一社会信用代码须为 18 位";
    if (!form.legalPerson.trim()) errors.legalPerson = "请输入法定代表人姓名";
    if (!form.legalPersonIdCard.trim()) errors.legalPersonIdCard = "请输入法定代表人身份证号";
    else if (!/^\d{17}[\dX]$/.test(form.legalPersonIdCard.trim())) errors.legalPersonIdCard = "身份证号须为 18 位";
    const normalizedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    if (normalizedTags.length < 2) errors.tags = "请至少选择 2 个业务标签";
    else if (normalizedTags.length > 8) errors.tags = "最多选择 8 个业务标签";
  }

  if (targetStep === 2) {
    if (!form.displayName.trim()) errors.displayName = "请输入联系人姓名";
    if (!form.phone.trim()) errors.phone = "请输入手机号";
    else if (!/^1[3-9]\d{9}$/.test(form.phone.trim())) errors.phone = "手机号格式不正确";
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "邮箱格式不正确";
  }

  if (targetStep === 3 && !context.agreeAgreement) {
    errors.agreement = "请阅读并同意供应商注册入驻协议";
  }

  return errors;
}

export function firstInvalidTemporaryRegistrationStep(
  form: TemporaryRegistrationForm,
  tags: string[],
  context: TemporaryRegistrationValidationContext,
): TemporaryRegistrationValidationResult | null {
  for (let step = 0; step < 4; step += 1) {
    const errors = validateTemporaryRegistrationStep(step, form, tags, context);
    if (Object.keys(errors).length > 0) return { step, errors };
  }
  return null;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    const dataError = (error as { data?: { error?: unknown } }).data?.error;
    if (typeof dataError === "string" && dataError.trim()) return dataError;
  }
  return fallback;
}
