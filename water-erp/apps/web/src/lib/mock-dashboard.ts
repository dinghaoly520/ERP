export type DashboardTrendPoint = {
  date: string;
  label: string;
  count: number;
  amount: number;
};

export type DashboardDepartmentStat = {
  name: string;
  amount: number;
  amountLabel: string;
  completedRate: number;
};

export type DashboardMethodStat = {
  name: string;
  count: number;
  amount: number;
  amountLabel: string;
  share: number;
};

export type DashboardAttachmentProgress = {
  label: string;
  rate: number;
};

export type DashboardSupplierProcurementDetail = {
  project: string;
  date: string;
  method: string;
  department: string;
  budgetLabel: string;
  result: string;
};

export type DashboardSupplierWinDetail = {
  project: string;
  date: string;
  method: string;
  department: string;
  awardAmountLabel: string;
};

export type DashboardSupplierAIInsight = {
  summary: string;
  strengths: string[];
  risks: string[];
  recommendation: string;
};

export type DashboardSupplierStat = {
  name: string;
  participatedCount: number;
  winCount: number;
  awardAmount: number;
  awardAmountLabel: string;
  hitRate: number;
  topMethod: string;
  topDepartment: string;
  tags: string[];
  recentProcurements: DashboardSupplierProcurementDetail[];
  winProjects: DashboardSupplierWinDetail[];
};

export type DashboardResultStatus = {
  label: string;
  count: number;
  amount: number;
  amountLabel: string;
  accent: string;
};

export type DashboardNonAwardReason = {
  label: string;
  count: number;
  detail: string;
};

export type DashboardSavingsRankingItem = {
  project: string;
  department: string;
  controlAmount: number;
  awardAmount: number;
  savings: number;
  savingsRate: number;
  controlAmountLabel: string;
  awardAmountLabel: string;
  savingsLabel: string;
  method: string;
  date: string;
};

export type DashboardRiskProject = {
  id?: string;
  project: string;
  department: string;
  reason: string;
  pendingDays: number;
  severity: "高" | "中" | "低";
  detail?: {
    date: string;
    method: string;
    budgetLabel: string;
    result: string;
    suppliers: string[];
    nextAction: string;
    history: Array<{ label: string; value: string }>;
  };
  ai?: {
    summary: string;
    rootCause: string;
    recommendations: string[];
  };
};

export type DashboardProfile = {
  key: string;
  label: string;
  start: string;
  end: string;
  summary: {
    totalCount: number;
    completedCount: number;
    abnormalCount: number;
    totalBudget: number;
    totalBudgetLabel: string;
    awardedBudget: number;
    awardedBudgetLabel: string;
    pendingBudget: number;
    pendingBudgetLabel: string;
    totalAward: number;
    totalAwardLabel: string;
    totalSavings: number;
    totalSavingsLabel: string;
  };
  trendSeries: DashboardTrendPoint[];
  departmentStats: DashboardDepartmentStat[];
  methodStats: DashboardMethodStat[];
  attachmentProgress: DashboardAttachmentProgress[];
  supplierStats: DashboardSupplierStat[];
  resultStats: DashboardResultStatus[];
  nonAwardReasons: DashboardNonAwardReason[];
  savingsRanking: DashboardSavingsRankingItem[];
  riskProjects: DashboardRiskProject[];
};

import dashboardDetailData from "./dashboard-detail-data.json";

const riskDetailMap = new Map(
  dashboardDetailData.riskDetails.map((item) => [item.project, item]),
);

function enrichSupplierStats(items: object[]): DashboardSupplierStat[] {
  return items.map((raw) => {
    const item = raw as Record<string, unknown>;
    const participatedCount = (item.participatedCount as number | undefined) ?? 0;
    const winCount = (item.winCount as number | undefined) ?? 0;
    return {
      name: item.name as string,
      participatedCount,
      winCount,
      awardAmount: (item.awardAmount as number | undefined) ?? 0,
      awardAmountLabel: (item.awardAmountLabel as string | undefined) ?? '0 万',
      hitRate: participatedCount > 0 ? Math.round((winCount / participatedCount) * 100) : 0,
      topMethod: (item.topMethod as string | undefined) ?? '未知',
      topDepartment: (item.topDepartment as string | undefined) ?? '未知部门',
      tags: (item.tags as string[] | undefined) ?? [],
      recentProcurements: (item.recentProcurements as DashboardSupplierProcurementDetail[] | undefined) ?? [],
      winProjects: (item.winProjects as DashboardSupplierWinDetail[] | undefined) ?? [],
    };
  });
}

function enrichRiskProjects(items: DashboardRiskProject[]): DashboardRiskProject[] {
  return items.map((item) => {
    const detail = riskDetailMap.get(item.project);

    return {
      ...item,
      ...detail,
      severity: (detail?.severity as DashboardRiskProject["severity"] | undefined) ?? item.severity,
    };
  });
}

export const dashboardProfiles: DashboardProfile[] = [
  {
    key: "all",
    label: "全部",
    start: "2026-02-26",
    end: "2026-04-07",
    summary: {
      totalCount: 46,
      completedCount: 36,
      abnormalCount: 10,
      totalBudget: 3237.7,
      totalBudgetLabel: "3237.7 万",
      awardedBudget: 2684.5,
      awardedBudgetLabel: "2684.5 万",
      pendingBudget: 553.2,
      pendingBudgetLabel: "553.2 万",
      totalAward: 2301.9,
      totalAwardLabel: "2301.9 万",
      totalSavings: 311.6,
      totalSavingsLabel: "311.6 万",
    },
    trendSeries: [
      { date: "2026-02-26", label: "2/26", count: 18, amount: 52 },
      { date: "2026-03-04", label: "3/04", count: 44, amount: 36 },
      { date: "2026-03-13", label: "3/13", count: 56, amount: 50 },
      { date: "2026-03-26", label: "3/26", count: 48, amount: 58 },
      { date: "2026-04-02", label: "4/02", count: 62, amount: 82 },
      { date: "2026-04-07", label: "4/07", count: 40, amount: 68 },
    ],
    departmentStats: [
      { name: "部门1", amount: 889.8, amountLabel: "889.8 万", completedRate: 84 },
      { name: "部门2", amount: 584.4, amountLabel: "584.4 万", completedRate: 80 },
      { name: "部门3", amount: 350.9, amountLabel: "350.9 万", completedRate: 76 },
      { name: "部门4", amount: 313.0, amountLabel: "313.0 万", completedRate: 73 },
      { name: "部门5", amount: 209.8, amountLabel: "209.8 万", completedRate: 71 },
    ],
    methodStats: [
      { name: "竞争性谈判", count: 20, amount: 719.4, amountLabel: "719.4 万", share: 43 },
      { name: "内部竞标", count: 11, amount: 1546.7, amountLabel: "1546.7 万", share: 24 },
      { name: "邀请招标", count: 6, amount: 428.5, amountLabel: "428.5 万", share: 13 },
      { name: "续约", count: 5, amount: 209.8, amountLabel: "209.8 万", share: 11 },
      { name: "询价", count: 4, amount: 33.0, amountLabel: "33.0 万", share: 9 },
    ],
    attachmentProgress: [
      { label: "招标文件", rate: 92 },
      { label: "审查意见", rate: 61 },
      { label: "投标分析", rate: 74 },
      { label: "结果附件", rate: 88 },
    ],
    supplierStats: enrichSupplierStats([
      {
        name: "四川华澜工程咨询有限公司",
        participatedCount: 9,
        winCount: 5,
        awardAmount: 418.6,
        awardAmountLabel: "418.6 万",
        topDepartment: "部门1",
        tags: ["部门1重点参与", "竞争性谈判优势"],
        recentProcurements: [],
        winProjects: [],
      },
      {
        name: "成都智诚招采顾问有限公司",
        participatedCount: 8,
        winCount: 4,
        awardAmount: 302.4,
        awardAmountLabel: "302.4 万",
        topMethod: "竞争性谈判",
        topDepartment: "部门2",
        tags: ["部门2重点参与"],
        recentProcurements: [],
        winProjects: [],
      },
      {
        name: "四川恒誉科技有限公司",
        participatedCount: 6,
        winCount: 3,
        awardAmount: 228.3,
        awardAmountLabel: "228.3 万",
        topMethod: "内部竞标",
        topDepartment: "部门3",
        tags: ["部门3重点参与"],
        recentProcurements: [],
        winProjects: [],
      },
      {
        name: "中水西南数字技术有限公司",
        participatedCount: 5,
        winCount: 2,
        awardAmount: 164.9,
        awardAmountLabel: "164.9 万",
        topMethod: "竞争性谈判",
        topDepartment: "数字信息化院",
        tags: ["数字信息化院参与"],
        recentProcurements: [],
        winProjects: [],
      },
    ]),
    resultStats: [
      { label: "已成交", count: 27, amount: 1842.4, amountLabel: "1842.4 万", accent: "blue" },
      { label: "待定", count: 9, amount: 351.2, amountLabel: "351.2 万", accent: "gold" },
      { label: "未成交", count: 10, amount: 108.7, amountLabel: "108.7 万", accent: "coral" },
    ],
    nonAwardReasons: [
      { label: "资格审查未通过", count: 3, detail: "供应商资质材料缺失或不满足门槛" },
      { label: "采购文件需调整", count: 2, detail: "技术条款与范围需重新确认" },
      { label: "供应商未响应", count: 2, detail: "发出澄清后未在时限内反馈" },
      { label: "报价超预算", count: 2, detail: "供应商报价超出项目预算限额" },
      { label: "流标重采", count: 1, detail: "有效投标人不足三家，需重新组织" },
    ],
    riskProjects: enrichRiskProjects([
      {
        project: "青衣江流域防洪数字孪生平台咨询服务",
        department: "部门4",
        reason: "供应商未按时补充材料，已滞留 6 天",
        pendingDays: 6,
        severity: "高",
      },
      {
        project: "部门1 4 月无人机航测服务",
        department: "部门1",
        reason: "合同已定标未完成盖章流转",
        pendingDays: 4,
        severity: "中",
      },
      {
        project: "东部片区地质勘察外委",
        department: "部门3",
        reason: "采购文件修改后未发起第二轮确认",
        pendingDays: 3,
        severity: "中",
      },
    ]),
    savingsRanking: [
      {
        project: "信息化基础设施运维服务",
        department: "部门4",
        controlAmount: 68.0,
        awardAmount: 60.0,
        savings: 8.0,
        savingsRate: 11.8,
        controlAmountLabel: "68.0 万",
        awardAmountLabel: "60.0 万",
        savingsLabel: "8.0 万",
        method: "询价",
        date: "3月20日",
      },
      {
        project: "大坝自动化监测系统及附属设施建设服务项目",
        department: "部门5",
        controlAmount: 179.1,
        awardAmount: 158.8,
        savings: 20.3,
        savingsRate: 11.3,
        controlAmountLabel: "179.1 万",
        awardAmountLabel: "158.8 万",
        savingsLabel: "20.3 万",
        method: "邀请招标",
        date: "2月26日",
      },
      {
        project: "工程勘察外委服务项目",
        department: "部门3",
        controlAmount: 85.0,
        awardAmount: 78.2,
        savings: 6.8,
        savingsRate: 8.0,
        controlAmountLabel: "85.0 万",
        awardAmountLabel: "78.2 万",
        savingsLabel: "6.8 万",
        method: "竞争性谈判",
        date: "3月15日",
      },
      {
        project: "引大济岷工程隧洞砂砾岩岩溶灾害防控对策研究专题",
        department: "部门1",
        controlAmount: 49.6,
        awardAmount: 48.0,
        savings: 1.6,
        savingsRate: 3.2,
        controlAmountLabel: "49.6 万",
        awardAmountLabel: "48.0 万",
        savingsLabel: "1.6 万",
        method: "竞争性谈判",
        date: "3月5日",
      },
      {
        project: "2026年教育培训服务项目",
        department: "部门2",
        controlAmount: 48.4,
        awardAmount: 48.0,
        savings: 0.4,
        savingsRate: 0.8,
        controlAmountLabel: "48.4 万",
        awardAmountLabel: "48.0 万",
        savingsLabel: "0.4 万",
        method: "续约",
        date: "3月11日",
      },
    ],
  },
  {
    key: "march",
    label: "3 月",
    start: "2026-03-01",
    end: "2026-03-31",
    summary: {
      totalCount: 31,
      completedCount: 24,
      abnormalCount: 7,
      totalBudget: 2178.4,
      totalBudgetLabel: "2178.4 万",
      awardedBudget: 1796.2,
      awardedBudgetLabel: "1796.2 万",
      pendingBudget: 382.2,
      pendingBudgetLabel: "382.2 万",
      totalAward: 1526.2,
      totalAwardLabel: "1526.2 万",
      totalSavings: 219.7,
      totalSavingsLabel: "219.7 万",
    },
    trendSeries: [
      { date: "2026-03-04", label: "3/04", count: 44, amount: 36 },
      { date: "2026-03-13", label: "3/13", count: 56, amount: 50 },
      { date: "2026-03-26", label: "3/26", count: 48, amount: 58 },
    ],
    departmentStats: [
      { name: "部门1", amount: 562.1, amountLabel: "562.1 万", completedRate: 82 },
      { name: "部门2", amount: 433.5, amountLabel: "433.5 万", completedRate: 78 },
      { name: "部门3", amount: 271.4, amountLabel: "271.4 万", completedRate: 74 },
      { name: "部门4", amount: 202.0, amountLabel: "202.0 万", completedRate: 70 },
      { name: "部门5", amount: 118.6, amountLabel: "118.6 万", completedRate: 68 },
    ],
    methodStats: [
      { name: "竞争性谈判", count: 14, amount: 486.2, amountLabel: "486.2 万", share: 45 },
      { name: "内部竞标", count: 8, amount: 812.4, amountLabel: "812.4 万", share: 26 },
      { name: "续约", count: 4, amount: 118.6, amountLabel: "118.6 万", share: 13 },
      { name: "询价", count: 3, amount: 24.7, amountLabel: "24.7 万", share: 10 },
      { name: "邀请招标", count: 2, amount: 156.0, amountLabel: "156.0 万", share: 6 },
    ],
    attachmentProgress: [
      { label: "招标文件", rate: 89 },
      { label: "审查意见", rate: 58 },
      { label: "投标分析", rate: 70 },
      { label: "结果附件", rate: 82 },
    ],
    supplierStats: enrichSupplierStats([
      {
        name: "四川华澜工程咨询有限公司",
        participatedCount: 7,
        winCount: 4,
        awardAmount: 286.4,
        awardAmountLabel: "286.4 万",
        topMethod: "竞争性谈判",
        topDepartment: "部门1",
        tags: ["部门1重点参与"],
        recentProcurements: [],
        winProjects: [],
      },
      {
        name: "成都智诚招采顾问有限公司",
        participatedCount: 6,
        winCount: 3,
        awardAmount: 214.8,
        awardAmountLabel: "214.8 万",
        topMethod: "竞争性谈判",
        topDepartment: "部门2",
        tags: ["部门2重点参与"],
        recentProcurements: [],
        winProjects: [],
      },
      {
        name: "四川恒誉科技有限公司",
        participatedCount: 4,
        winCount: 2,
        awardAmount: 155.6,
        awardAmountLabel: "155.6 万",
        topMethod: "内部竞标",
        topDepartment: "部门4",
        tags: ["部门4参与"],
        recentProcurements: [],
        winProjects: [],
      },
    ]),
    resultStats: [
      { label: "已成交", count: 18, amount: 1214.5, amountLabel: "1214.5 万", accent: "blue" },
      { label: "待定", count: 4, amount: 208.4, amountLabel: "208.4 万", accent: "gold" },
      { label: "未成交", count: 2, amount: 63.3, amountLabel: "63.3 万", accent: "coral" },
    ],
    nonAwardReasons: [
      { label: "资格审查未通过", count: 1, detail: "投标文件关键资质缺页" },
      { label: "采购文件需调整", count: 1, detail: "服务范围和付款节点待重审" },
    ],
    riskProjects: enrichRiskProjects([
      {
        project: "部门2 BIM 复核服务",
        department: "部门2",
        reason: "审查意见未闭环，影响签约",
        pendingDays: 5,
        severity: "高",
      },
      {
        project: "部门3监测平台开发",
        department: "部门3",
        reason: "供应商澄清回复延后",
        pendingDays: 3,
        severity: "中",
      },
    ]),
    savingsRanking: [],
  },
  {
    key: "april",
    label: "4 月",
    start: "2026-04-01",
    end: "2026-04-07",
    summary: {
      totalCount: 12,
      completedCount: 9,
      abnormalCount: 3,
      totalBudget: 804.5,
      totalBudgetLabel: "804.5 万",
      awardedBudget: 680.1,
      awardedBudgetLabel: "680.1 万",
      pendingBudget: 124.4,
      pendingBudgetLabel: "124.4 万",
      totalAward: 612.3,
      totalAwardLabel: "612.3 万",
      totalSavings: 77.8,
      totalSavingsLabel: "77.8 万",
    },
    trendSeries: [
      { date: "2026-04-02", label: "4/02", count: 62, amount: 82 },
      { date: "2026-04-07", label: "4/07", count: 40, amount: 68 },
    ],
    departmentStats: [
      { name: "部门1", amount: 241.6, amountLabel: "241.6 万", completedRate: 85 },
      { name: "部门2", amount: 116.8, amountLabel: "116.8 万", completedRate: 77 },
      { name: "部门3", amount: 89.4, amountLabel: "89.4 万", completedRate: 72 },
      { name: "部门4", amount: 74.2, amountLabel: "74.2 万", completedRate: 70 },
    ],
    methodStats: [
      { name: "内部竞标", count: 4, amount: 392.0, amountLabel: "392.0 万", share: 33 },
      { name: "竞争性谈判", count: 4, amount: 156.7, amountLabel: "156.7 万", share: 33 },
      { name: "询价", count: 2, amount: 8.3, amountLabel: "8.3 万", share: 17 },
      { name: "续约", count: 1, amount: 52.7, amountLabel: "52.7 万", share: 9 },
      { name: "邀请招标", count: 1, amount: 80.0, amountLabel: "80.0 万", share: 8 },
    ],
    attachmentProgress: [
      { label: "招标文件", rate: 95 },
      { label: "审查意见", rate: 68 },
      { label: "投标分析", rate: 79 },
      { label: "结果附件", rate: 91 },
    ],
    supplierStats: enrichSupplierStats([
      {
        name: "四川华澜工程咨询有限公司",
        participatedCount: 3,
        winCount: 1,
        awardAmount: 132.2,
        awardAmountLabel: "132.2 万",
        topMethod: "竞争性谈判",
        topDepartment: "部门1",
        tags: ["部门1参与"],
        recentProcurements: [],
        winProjects: [],
      },
      {
        name: "中水西南数字技术有限公司",
        participatedCount: 2,
        winCount: 1,
        awardAmount: 98.1,
        awardAmountLabel: "98.1 万",
        topMethod: "内部竞标",
        topDepartment: "部门3",
        tags: ["部门3参与"],
        recentProcurements: [],
        winProjects: [],
      },
      {
        name: "四川恒誉科技有限公司",
        participatedCount: 2,
        winCount: 1,
        awardAmount: 72.7,
        awardAmountLabel: "72.7 万",
        topMethod: "内部竞标",
        topDepartment: "部门4",
        tags: ["部门4参与"],
        recentProcurements: [],
        winProjects: [],
      },
    ]),
    resultStats: [
      { label: "已成交", count: 7, amount: 503.6, amountLabel: "503.6 万", accent: "blue" },
      { label: "待定", count: 2, amount: 92.8, amountLabel: "92.8 万", accent: "gold" },
      { label: "未成交", count: 1, amount: 45.4, amountLabel: "45.4 万", accent: "coral" },
    ],
    nonAwardReasons: [
      { label: "供应商未响应", count: 1, detail: "澄清函未在 48 小时内回复" },
    ],
    riskProjects: enrichRiskProjects([
      {
        project: "部门1 4 月无人机航测服务",
        department: "部门1",
        reason: "合同流转待补章",
        pendingDays: 4,
        severity: "中",
      },
    ]),
    savingsRanking: [],
  },
];

export const defaultDashboardProfileKey = "all";

export const dashboardDateBounds = {
  min: "2026-02-26",
  max: "2026-04-07",
};

export function findDashboardProfileByKey(key: string) {
  return (
    dashboardProfiles.find((profile) => profile.key === key) ??
    dashboardProfiles[0]
  );
}

export function resolveDashboardProfileByRange(start: string, end: string) {
  const matched = dashboardProfiles.find(
    (profile) => profile.start === start && profile.end === end,
  );

  if (matched) {
    return matched;
  }

  const startMonth = start.slice(0, 7);
  const endMonth = end.slice(0, 7);

  if (startMonth === "2026-03" && endMonth === "2026-03") {
    return findDashboardProfileByKey("march");
  }

  if (startMonth === "2026-04" && endMonth === "2026-04") {
    return findDashboardProfileByKey("april");
  }

  return findDashboardProfileByKey("all");
}

export const quickActions = [
  { title: "导入采购汇总表", href: "/imports" },
  { title: "新增采购事项", href: "/procurements/new" },
  { title: "查看采购台账", href: "/procurements" },
  { title: "上传过程附件", href: "/files" },
];
