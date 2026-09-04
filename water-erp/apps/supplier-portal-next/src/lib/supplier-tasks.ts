export type SupplierTaskKind =
  | "profile-correction"
  | "bid-draft"
  | "bid-deadline"
  | "opening"
  | "clarification"
  | "round-quote"
  | "award-letter"
  | "fulfillment"
  | "qualification";

export type SupplierTaskUrgency = "overdue" | "critical" | "warning" | "normal";

export interface SupplierTask {
  id: string;
  kind: SupplierTaskKind;
  title: string;
  description: string;
  source: string;
  href: string;
  dueAt: string | null;
  urgency: SupplierTaskUrgency;
}

interface TaskProject {
  id: string;
  name: string;
  stage: string;
  deadline?: string | null;
  mySubmissionStatus?: string | null;
}

interface TaskNotification {
  id: string;
  type: string;
  title: string;
  isRead: boolean;
  resolvedAt?: string | null;
  link?: string | null;
  createdAt: string;
}

interface TaskAward {
  id: string;
  projectId: string;
  supplierName: string;
  signedAt?: string | null;
  letterAssetId?: string | null;
}

interface TaskContract {
  id: string;
  contractCode: string;
  status: string;
  fulfillments: Array<{ id: string; title: string; status: string; dueDate?: string | null }>;
}

export interface BuildSupplierTasksInput {
  nowMs: number;
  stats?: { pendingChanges?: number; expiringQualifications?: number } | null;
  projects?: TaskProject[];
  notifications?: TaskNotification[];
  awards?: TaskAward[];
  contracts?: TaskContract[];
}

function deadlineUrgency(dueAt: string | null, nowMs: number): SupplierTaskUrgency {
  if (!dueAt) return "normal";
  const remaining = new Date(dueAt).getTime() - nowMs;
  if (remaining < 0) return "overdue";
  if (remaining <= 3 * 86_400_000) return "critical";
  if (remaining <= 14 * 86_400_000) return "warning";
  return "normal";
}

const NOTIFICATION_TASKS: Record<string, { kind: SupplierTaskKind; href: string; source: string }> = {
  BID_CLARIFICATION_CREATED: { kind: "clarification", href: "/bids", source: "澄清答复" },
  BID_ROUND_OPEN: { kind: "round-quote", href: "/bids", source: "报价轮次" },
  CLARIFICATION: { kind: "clarification", href: "/bids", source: "澄清文件" },
  BID_OPENING_STARTED: { kind: "opening", href: "/my-bids", source: "在线开标" },
};

function safeInternalHref(link: string | null | undefined, fallback: string): string {
  return link?.startsWith("/") && !link.startsWith("//") ? link : fallback;
}

export function buildSupplierTasks(input: BuildSupplierTasksInput): SupplierTask[] {
  const tasks: SupplierTask[] = [];
  if ((input.stats?.pendingChanges ?? 0) > 0) {
    tasks.push({
      id: "profile-correction", kind: "profile-correction", title: "处理资料补正/变更申请",
      description: `当前有 ${input.stats?.pendingChanges} 项资料变更正在处理，请核对状态或补充材料。`,
      source: "供应商资料", href: "/change-records", dueAt: null, urgency: "warning",
    });
  }
  if ((input.stats?.expiringQualifications ?? 0) > 0) {
    tasks.push({
      id: "qualification-expiring", kind: "qualification", title: "更新即将到期的资质",
      description: `${input.stats?.expiringQualifications} 项资质将在 30 天内到期。`,
      source: "资质管理", href: "/profile", dueAt: null, urgency: "warning",
    });
  }

  for (const project of input.projects ?? []) {
    if (!project.deadline || !["DOWNLOAD", "SUBMIT"].includes(project.stage)) continue;
    const dueAt = project.deadline;
    const urgency = deadlineUrgency(dueAt, input.nowMs);
    if (project.mySubmissionStatus === "draft") {
      tasks.push({
        id: `bid-draft:${project.id}`, kind: "bid-draft", title: `继续完成投标：${project.name}`,
        description: "已有未提交草稿，请在截止前检查文件、签名并正式递交。", source: "投标草稿",
        href: `/bids/${project.id}/submit`, dueAt, urgency,
      });
    } else if (urgency !== "normal") {
      tasks.push({
        id: `bid-deadline:${project.id}`, kind: "bid-deadline", title: `投标即将截止：${project.name}`,
        description: "尚未识别到已递交状态，请核对投标材料。", source: "采购项目",
        href: `/bids/${project.id}`, dueAt, urgency,
      });
    }
  }

  for (const notification of input.notifications ?? []) {
    const config = NOTIFICATION_TASKS[notification.type];
    // 阅读只清除未读提示；只有业务动作落下 resolvedAt 才算待办完成。
    if (!config || notification.resolvedAt) continue;
    tasks.push({
      id: `notification:${notification.id}`, kind: config.kind, title: notification.title,
      description: "有一项新的流程事项等待处理。", source: config.source,
      href: safeInternalHref(notification.link, config.href), dueAt: null, urgency: "critical",
    });
  }

  for (const award of input.awards ?? []) {
    if (award.signedAt || !award.letterAssetId) continue;
    tasks.push({
      id: `award:${award.id}`, kind: "award-letter", title: "查看并签收成交通知书",
      description: "通知书文件已送达，请下载核对后完成签收。", source: "成交结果",
      href: "/award-letters", dueAt: null, urgency: "critical",
    });
  }

  for (const contract of input.contracts ?? []) {
    if (!["signed", "performing"].includes(contract.status)) continue;
    for (const fulfillment of contract.fulfillments.filter((item) => item.status === "pending")) {
      const dueAt = fulfillment.dueDate ?? null;
      tasks.push({
        id: `fulfillment:${fulfillment.id}`, kind: "fulfillment", title: fulfillment.title,
        description: `合同 ${contract.contractCode} 的履约节点待提交或确认。`, source: "合同履约",
        href: "/contracts", dueAt, urgency: deadlineUrgency(dueAt, input.nowMs),
      });
    }
  }

  const rank: Record<SupplierTaskUrgency, number> = { overdue: 0, critical: 1, warning: 2, normal: 3 };
  return tasks.sort((a, b) => {
    const urgencyDiff = rank[a.urgency] - rank[b.urgency];
    if (urgencyDiff) return urgencyDiff;
    if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return a.title.localeCompare(b.title, "zh-CN");
  });
}
