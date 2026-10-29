/* 澄清通知文案（2026-10-29 收口）：评标澄清有两处产生点——专家端（expert.service，
   评标委员会发起）与主持端（bid.service，采购人发起）——此前各自维护近义模板且
   已漂移（专家端无评标截止时间）。统一模板，发起方标签入参；截止时间有则附注。 */
export function buildClarificationNotice(input: {
  projectName: string;
  issuerLabel: string;
  evaluationDeadline?: Date | null;
}): { title: string; content: string } {
  const deadline = input.evaluationDeadline
    ? new Date(input.evaluationDeadline).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  return {
    title: `收到澄清要求：${input.projectName}`,
    content: deadline
      ? `${input.issuerLabel}已发起澄清，请在评标结束前查看并提交答复（评标截止：${deadline}）。`
      : `${input.issuerLabel}已发起澄清，请在规定时间内查看并提交答复。`,
  };
}
