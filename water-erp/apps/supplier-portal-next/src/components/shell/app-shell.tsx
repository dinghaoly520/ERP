"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import dayjs from "dayjs";
import {
  ArrowDown,
  Bell,
  Lock,
  LogOut,
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notification-context";
import { useSupplierStatus } from "@/lib/supplier-status-context";
import type { SupplierNotification } from "@/lib/api/notification";
import { resolveNotificationLink, summarizeNotification } from "@/lib/notification-meta";
import {
  buildMenuItems,
  findWorkspaceForPath,
  type MenuEntry,
  type MenuItem,
} from "@/components/shell/supplier-menu";
import { ChangePasswordDialog } from "@/components/shell/change-password-dialog";
import { BackToTop } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface SupplierSidebarNavItemProps {
  item: MenuEntry;
  pathname: string;
  active: boolean;
  collapsed: boolean;
  mobile?: boolean;
  unreadCount: number;
  onNavigate: (path: string) => void;
}

export interface SupplierNavTooltipPosition {
  top: number;
  left: number;
}

const SUPPLIER_NAV_TOOLTIP_GAP = 10;
const SUPPLIER_NAV_TOOLTIP_VIEWPORT_PADDING = 16;

export function getSupplierNavTooltipPosition(
  rect: Pick<DOMRect, "top" | "right" | "height">,
  viewportHeight: number,
): SupplierNavTooltipPosition {
  const maximumTop = Math.max(
    SUPPLIER_NAV_TOOLTIP_VIEWPORT_PADDING,
    viewportHeight - SUPPLIER_NAV_TOOLTIP_VIEWPORT_PADDING,
  );

  return {
    top: Math.min(
      Math.max(
        rect.top + rect.height / 2,
        SUPPLIER_NAV_TOOLTIP_VIEWPORT_PADDING,
      ),
      maximumTop,
    ),
    left: rect.right + SUPPLIER_NAV_TOOLTIP_GAP,
  };
}

export function SupplierSidebarNavItem({
  item,
  pathname,
  active,
  collapsed,
  mobile = false,
  unreadCount,
  onNavigate,
}: SupplierSidebarNavItemProps) {
  const Icon = item.icon;
  const showTooltip = collapsed && !mobile;
  const ownsCurrentPage = pathname === item.path && (!item.tabs || item.tabs.length < 2);
  const tooltipId = `supplier-nav-tooltip-${item.path
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")}`;
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState<SupplierNavTooltipPosition | null>(null);
  const tooltipOpen = tooltipPosition !== null;

  const openTooltip = useCallback(() => {
    if (!showTooltip || typeof window === "undefined") return;
    const rect = linkRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPosition(getSupplierNavTooltipPosition(rect, window.innerHeight));
  }, [showTooltip]);

  const closeTooltip = useCallback(() => {
    setTooltipPosition(null);
  }, []);

  useEffect(() => {
    if (!showTooltip || !tooltipOpen) return;
    window.addEventListener("resize", openTooltip);
    window.addEventListener("scroll", openTooltip, true);
    return () => {
      window.removeEventListener("resize", openTooltip);
      window.removeEventListener("scroll", openTooltip, true);
    };
  }, [openTooltip, showTooltip, tooltipOpen]);

  const tooltip = showTooltip && tooltipPosition && typeof document !== "undefined"
    ? createPortal(
        <span
          id={tooltipId}
          className="sp-nav-tooltip"
          role="tooltip"
          style={{ top: tooltipPosition.top, left: tooltipPosition.left }}
        >
          {item.title}
        </span>,
        document.body,
      )
    : null;

  return (
    <>
      <div className="sp-nav-item-shell">
        <Link
          ref={linkRef}
          href={item.path}
          className={cn("sp-nav-item", active && "active")}
          aria-current={ownsCurrentPage ? "page" : undefined}
          aria-label={item.badge && unreadCount > 0 ? `${item.title}，${unreadCount} 条未读` : item.title}
          aria-describedby={showTooltip ? tooltipId : undefined}
          onMouseEnter={openTooltip}
          onMouseLeave={closeTooltip}
          onFocus={openTooltip}
          onBlur={closeTooltip}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeTooltip();
            }
          }}
          onClick={() => {
            closeTooltip();
            onNavigate(item.path);
          }}
        >
          {active && <span className="sp-nav-active-bar" aria-hidden="true" />}
          <span className="sp-nav-icon" aria-hidden="true"><Icon size={18} /></span>
          <span className={cn("sp-nav-text", showTooltip && "hidden")}>
            <span className="sp-nav-title">{item.title}</span>
          </span>
          {item.badge && unreadCount > 0 && showTooltip && (
            <span className="sp-nav-badge" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span>
          )}
        </Link>
      </div>
      {tooltip}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { displayName, logout } = useAuth();
  const { unreadCount, notifications, fetchNotifications, markAsRead, markAllAsRead, fetchUnreadCount } = useNotifications();
  const { status, statusError, fetchStatus } = useSupplierStatus();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    const check = () => {
      const m = window.innerWidth <= 768;
      setIsMobile(m);
      if (m) setCollapsed(true);
      if (!m) setMobileDrawer(false);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const menuItems = useMemo(() => buildMenuItems(status?.isTemporary), [status?.isTemporary]);

  const activeWorkspace = useMemo(
    () => findWorkspaceForPath(pathname, menuItems),
    [menuItems, pathname],
  );

  const isMenuActive = (path: string) => path === activeWorkspace?.path;

  const companyDisplayName = status?.name || displayName || "";
  const userInitial = status?.name?.charAt(0) || displayName?.charAt(0) || "S";
  const recentNotifs = notifications.slice(0, 5);

  const notifAnchorRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const mobileDrawerTriggerRef = useRef<HTMLButtonElement | null>(null);

  // 点击外部关闭浮层
  useEffect(() => {
    if (!notifOpen && !userMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (notifOpen && notifAnchorRef.current && !notifAnchorRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [notifOpen, userMenuOpen]);

  useEffect(() => {
    if (!mobileDrawer) return;

    const drawerTrigger = mobileDrawerTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      const closeButton = drawerRef.current?.querySelector<HTMLElement>("[data-mobile-drawer-close]");
      if (closeButton) closeButton.focus();
      else drawerRef.current?.focus();
    });

    const onDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileDrawer(false);
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");

      if (focusable.length === 0) {
        event.preventDefault();
        drawerRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !drawerRef.current.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !drawerRef.current.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onDrawerKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onDrawerKeyDown);
      document.body.style.overflow = previousOverflow;
      drawerTrigger?.focus();
    };
  }, [mobileDrawer]);

  function openNotifPopover() {
    setUserMenuOpen(false);
    setNotifOpen(true);
    fetchNotifications(1, 5);
  }

  function goToNotif(n: SupplierNotification) {
    setNotifOpen(false);
    const destination = resolveNotificationLink(n.link, window.location.origin);
    if (destination?.kind === "internal") {
      router.push(destination.href);
    } else if (destination?.kind === "external") {
      if (window.confirm("该消息将打开外部网站，是否继续？")) {
        window.open(destination.href, "_blank", "noopener,noreferrer");
      }
    } else {
      router.push("/notifications");
    }
    if (!n.isRead) markAsRead(n.id).catch(() => {});
  }

  async function handleLogout() {
    if (!window.confirm("确定要退出登录吗？")) return;
    await logout();
  }

  const navItem = (item: Extract<MenuItem, { path: string }>, mobile = false) => {
    return (
      <SupplierSidebarNavItem
        key={item.path}
        item={item}
        pathname={pathname}
        active={isMenuActive(item.path)}
        collapsed={collapsed}
        mobile={mobile}
        unreadCount={unreadCount}
        onNavigate={() => {
          if (mobile) setMobileDrawer(false);
        }}
      />
    );
  };

  const navList = (mobile = false) => (
    <nav
      id={mobile ? "supplier-mobile-navigation" : "supplier-desktop-navigation"}
      className="sp-nav"
      aria-label={mobile ? "移动端主导航" : "供应商主导航"}
    >
      {menuItems.map((item, idx) =>
        "divider" in item ? (
          collapsed && !mobile ? (
            <div key={idx} className="sp-nav-section-dot" aria-hidden="true" />
          ) : (
            <div key={idx} className="sp-nav-section"><span>{item.label}</span></div>
          )
        ) : (
          navItem(item, mobile)
        ),
      )}
    </nav>
  );

  return (
    <div className="sp-layout">
      {/* Header */}
      <header className="sp-header" inert={mobileDrawer || undefined}>
        <div className="sp-header-left">
          <button type="button" className="sp-brand" aria-label="返回业务工作台" onClick={() => router.push("/dashboard")}>
            <Image src="/logo.png" alt="" width={40} height={40} className="sp-brand-logo" priority />
            <strong className="sp-brand-title">智慧水发 · 蜀水云采</strong>
          </button>
        </div>

        <div className="sp-header-right">
          {/* Notification bell */}
          <div className="sp-notif-anchor" ref={notifAnchorRef}>
            <button
              type="button"
              className="sp-header-icon"
              onClick={() => (notifOpen ? setNotifOpen(false) : openNotifPopover())}
              aria-label={unreadCount > 0 ? `消息通知，${unreadCount} 条未读` : "消息通知"}
              aria-controls="supplier-notification-popover"
              aria-expanded={notifOpen}
            >
              <Bell size={18} aria-hidden="true" />
              {unreadCount > 0 && <span className="sp-header-badge" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span>}
            </button>
            {notifOpen && (
              <div
                id="supplier-notification-popover"
                className="sp-notif-popover"
                role="region"
                aria-label="最近消息"
              >
                <div className="sp-notif-header">
                  <span className="sp-notif-title">消息通知</span>
                  <button
                    type="button"
                    className="sp-notif-mark-all"
                    onClick={() => { markAllAsRead().then(fetchUnreadCount).catch(() => {}); }}
                  >
                    全部已读
                  </button>
                </div>
                {recentNotifs.length === 0 ? (
                  <div className="sp-notif-empty">暂无消息</div>
                ) : (
                  <div className="sp-notif-list">
                    {recentNotifs.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        className={cn("sp-notif-item", !n.isRead && "unread")}
                        onClick={() => goToNotif(n)}
                      >
                        {!n.isRead && <span className="sp-notif-dot" aria-hidden="true" />}
                        <div className="sp-notif-content">
                          <div className="sp-notif-item-title">{n.title}</div>
                          <div className="sp-notif-item-desc">{summarizeNotification(n.content, 72)}</div>
                          <div className="sp-notif-item-time">{dayjs(n.createdAt).format("MM-DD HH:mm")}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="sp-notif-footer"
                  onClick={() => { router.push("/notifications"); setNotifOpen(false); }}
                >
                  查看全部消息
                </button>
              </div>
            )}
          </div>

          {/* User pill with dropdown */}
          <div className="sp-notif-anchor" ref={userMenuRef}>
            <button
              type="button"
              className="sp-user-pill"
              aria-label={`${companyDisplayName || "供应商"}账户菜单`}
              aria-controls="supplier-user-menu"
              aria-expanded={userMenuOpen}
              onClick={() => {
                setNotifOpen(false);
                setUserMenuOpen((value) => !value);
              }}
            >
              <span className="sp-user-avatar">{userInitial}</span>
              <span className="sp-user-name">{companyDisplayName}</span>
              <span className={cn("sp-user-arrow", userMenuOpen && "rotate-180")}><ArrowDown size={12} /></span>
            </button>
            {userMenuOpen && (
              <div id="supplier-user-menu" className="sp-user-menu">
                <button
                  type="button"
                  className="sp-user-menu-item"
                  onClick={() => { setUserMenuOpen(false); setPwdOpen(true); }}
                >
                  <Lock size={15} aria-hidden="true" />修改密码
                </button>
                <button
                  type="button"
                  className="sp-user-menu-item"
                  onClick={handleLogout}
                >
                  <LogOut size={15} aria-hidden="true" />退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="sp-body" inert={mobileDrawer || undefined}>
        <aside className={cn("sp-sidebar", collapsed && "collapsed")} aria-label="侧栏导航">
          {navList()}
          <button
            type="button"
            className="sp-collapse-toggle"
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-controls="supplier-desktop-navigation"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </aside>

        <main id="supplier-main-content" className="sp-content">
          <div className="page-container">
            {statusError && pathname !== "/dashboard" && (
              <div className="sp-shell-status-alert" role="alert">
                <span>供应商身份信息加载失败，部分入口暂时隐藏。</span>
                <button
                  type="button"
                  className="sp-shell-status-retry"
                  onClick={() => { void fetchStatus().catch(() => {}); }}
                >
                  重新加载
                </button>
              </div>
            )}
            {children}
          </div>
        </main>
      </div>

      {/* Mobile fab + drawer */}
      {isMobile && (
        <button
          ref={mobileDrawerTriggerRef}
          type="button"
          className="mobile-fab"
          aria-label="打开主导航"
          aria-controls="supplier-mobile-navigation"
          aria-expanded={mobileDrawer}
          hidden={mobileDrawer}
          onClick={() => {
            setNotifOpen(false);
            setUserMenuOpen(false);
            setMobileDrawer(true);
          }}
        >
          <MenuIcon size={22} aria-hidden="true" />
        </button>
      )}
      {mobileDrawer && (
        <>
          <button
            type="button"
            className="sp-mobile-drawer-ov"
            aria-label="关闭移动导航"
            tabIndex={-1}
            onClick={() => setMobileDrawer(false)}
          />
          <div
            ref={drawerRef}
            className="sp-mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="供应商主导航"
            tabIndex={-1}
          >
            <div className="sp-mobile-drawer-header">
              <strong>供应商主导航</strong>
              <button
                type="button"
                className="sp-mobile-drawer-close"
                aria-label="关闭主导航"
                data-mobile-drawer-close
                onClick={() => setMobileDrawer(false)}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            {navList(true)}
          </div>
        </>
      )}

      <div inert={mobileDrawer || undefined}>
        <ChangePasswordDialog open={pwdOpen} onClose={() => setPwdOpen(false)} />
        <BackToTop />
      </div>
    </div>
  );
}
