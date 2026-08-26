"use client";

/**
 * 集中供应商菜单权限逻辑 — 移植自 Vue useSupplierMenu（X-1）。
 * 当前基于 isTemporary 布尔分支，后续扩展为权限矩阵时只需改此文件。
 */
import type { ComponentType } from "react";
import {
  Home, Building2, PenLine, FileText, FileCheck, FileSignature, BadgeCheck, Layers,
  Bell, MessageSquare, MessageSquareWarning, Package, Link2, Boxes, KeyRound,
} from "lucide-react";

export interface MenuEntry {
  path: string;
  title: string;
  icon: ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;
  desc: string;
  badge?: boolean;
}
export interface MenuDivider {
  divider: true;
  label: string;
}

export type MenuItem = MenuEntry | MenuDivider;

export function buildMenuItems(isTemporary: boolean | undefined): MenuItem[] {
  const items: MenuItem[] = [
    { path: "/dashboard", title: "业务工作台", icon: Home, desc: "状态与待办总览" },
    { divider: true, label: "投标中心" },
    { path: "/bids", title: "可投标项目", icon: FileText, desc: "发现可参与项目" },
    { path: "/my-bids", title: "投标进展", icon: FileCheck, desc: "跟踪已投项目" },
    { path: "/prequal", title: "资格预审", icon: BadgeCheck, desc: "竞争资格申请" },
  ];
  if (!isTemporary) {
    items.push(
      { divider: true, label: "供货合作" },
      { path: "/catalog", title: "采购目录", icon: Package, desc: "浏览品类并申请供货" },
      { path: "/catalog-applications", title: "供货申请", icon: Link2, desc: "申请进度与议价" },
      { path: "/supply", title: "我的供货", icon: Boxes, desc: "已准入品类与报价" },
      { divider: true, label: "企业档案" },
      { path: "/profile", title: "企业信息", icon: Building2, desc: "主体资料、资质与联系人" },
      { path: "/profile/ukey", title: "U盾管理", icon: KeyRound, desc: "投标加密证书与介质" },
      { path: "/change-records", title: "申请记录", icon: PenLine, desc: "变更审核进度" },
    );
  }
  items.push(
    { divider: true, label: "信息中心" },
    { path: "/announcements", title: "公告公示", icon: Bell, desc: "公告与政策" },
    { path: "/objections", title: "异议与投诉", icon: MessageSquareWarning, desc: "在线提出异议并查看答复" },
    { path: "/contracts", title: "我的合同", icon: FileSignature, desc: "合同签署与履约证明" },
    { path: "/frameworks", title: "框架协议", icon: Layers, desc: "入围协议与订单" },
    { path: "/notifications", title: "消息通知", icon: MessageSquare, badge: true, desc: "平台消息" },
  );
  return items;
}
