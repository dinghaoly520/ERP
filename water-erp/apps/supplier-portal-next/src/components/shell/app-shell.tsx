"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import dayjs from "dayjs";
import { Bell, Lock, User, ArrowDown, PanelLeftClose, PanelLeftOpen, Menu as MenuIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notification-context";
import { useSupplierStatus } from "@/lib/supplier-status-context";
import { buildMenuItems, type MenuItem } from "@/components/shell/supplier-menu";
import { ChangePasswordDialog } from "@/components/shell/change-password-dialog";
import { BackToTop } from "@/components/ui";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, displayName, logout } = useAuth();
  const { unreadCount, notifications, fetchNotifications, markAsRead, markAllAsRead, fetchUnreadCount } = useNotifications();
  const { status } = useSupplierStatus();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    const check = () => {
      const m = window.innerWidth < 768;
      setIsMobile(m);
      if (m) setCollapsed(true);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const menuItems = useMemo(() => buildMenuItems(!!status?.isTemporary), [status?.isTemporary]);

  // 菜单高亮：详情/子页按顶级路径前缀匹配（否则进详情页指示会消失）；
  // 取最长前缀——同级子菜单（/profile/ukey）不再误亮父级（/profile）
  const activePath = useMemo(() => {
    return (
      menuItems
        .filter((i): i is Extract<MenuItem, { path: string }> => "path" in i)
        .map((i) => i.path)
        .filter((p) => pathname === p || pathname.startsWith(p + "/"))
        .sort((a, b) => b.length - a.length)[0] ?? null
    );
  }, [menuItems, pathname]);

  const isMenuActive = (path: string) => path === activePath;

  const companyDisplayName = status?.name || displayName || "";
  const userInitial = status?.name?.charAt(0) || displayName?.charAt(0) || "S";
  const recentNotifs = notifications.slice(0, 5);

  const notifAnchorRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

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

  function openNotifPopover() {
    setNotifOpen(true);
    fetchNotifications(1, 5);
  }

  function goToNotif(n: any) {
    setNotifOpen(false);
    if (n.link) {
      // 通知 link 可能是完整 URL（如 http://localhost:3004/rsvp?t=xxx），只取路径部分
      const url = new URL(n.link, window.location.origin);
      router.push(url.pathname + url.search + url.hash);
    }
    if (!n.isRead) markAsRead(n.id).catch(() => {});
  }

  async function handleLogout() {
    if (!window.confirm("确定要退出登录吗？")) return;
    await logout();
  }

  const navItem = (item: Extract<MenuItem, { path: string }>, mobile = false) => {
    const Icon = item.icon;
    const active = isMenuActive(item.path);
    return (
      <button
        key={item.path}
        type="button"
        className={cn("sp-nav-item", active && "active")}
        onClick={() => {
          if (mobile) setMobileDrawer(false);
          router.push(item.path);
        }}
      >
        {active && <span className="sp-nav-active-bar" />}
        <span className="sp-nav-icon"><Icon size={18} /></span>
        <span className={cn("sp-nav-text", collapsed && !mobile && "hidden")}>
          <span className="sp-nav-title">{item.title}</span>
          {item.desc && <span className="sp-nav-desc">{item.desc}</span>}
        </span>
        {item.badge && unreadCount > 0 && collapsed && !mobile && (
          <span className="sp-nav-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>
    );
  };

  const navList = (mobile = false) => (
    <nav className="sp-nav">
      {menuItems.map((item, idx) =>
        "divider" in item ? (
          collapsed && !mobile ? (
            <div key={idx} className="sp-nav-section-dot" />
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
      <header className="sp-header">
        <div className="sp-header-left">
          <button type="button" className="sp-brand" onClick={() => router.push("/dashboard")}>
            <Image src="/logo.png" alt="智慧水发 · 蜀水云采" width={40} height={40} className="sp-brand-logo" priority />
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
              aria-label="消息通知"
            >
              <Bell size={18} />
              {unreadCount > 0 && <span className="sp-header-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
            </button>
            {notifOpen && (
              <div className="sp-notif-popover">
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
                      <div
                        key={n.id}
                        className={cn("sp-notif-item", !n.isRead && "unread")}
                        onClick={() => goToNotif(n)}
                      >
                        {!n.isRead && <div className="sp-notif-dot" />}
                        <div className="sp-notif-content">
                          <div className="sp-notif-item-title">{n.title}</div>
                          <div className="sp-notif-item-desc">{n.content}</div>
                          <div className="sp-notif-item-time">{dayjs(n.createdAt).format("MM-DD HH:mm")}</div>
                        </div>
                      </div>
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
            <button type="button" className="sp-user-pill" onClick={() => setUserMenuOpen((v) => !v)}>
              <span className="sp-user-avatar">{userInitial}</span>
              <span className="sp-user-name">{companyDisplayName}</span>
              <span className={cn("sp-user-arrow", userMenuOpen && "rotate-180")}><ArrowDown size={12} /></span>
            </button>
            {userMenuOpen && (
              <div className="sp-user-menu">
                <button
                  type="button"
                  className="sp-user-menu-item"
                  onClick={() => { setUserMenuOpen(false); router.push("/profile"); }}
                >
                  <User size={15} />企业信息
                </button>
                <button
                  type="button"
                  className="sp-user-menu-item"
                  onClick={() => { setUserMenuOpen(false); setPwdOpen(true); }}
                >
                  <Lock size={15} />修改密码
                </button>
              </div>
            )}
          </div>

          {/* Logout button */}
          <button type="button" className="sp-logout-btn" onClick={handleLogout}>退出登录</button>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="sp-body">
        <aside className={cn("sp-sidebar", collapsed && "collapsed")}>
          {navList()}
          <button type="button" className="sp-collapse-toggle" onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </aside>

        <main className="sp-content">
          <div className="page-container">{children}</div>
        </main>
      </div>

      {/* Mobile fab + drawer */}
      {isMobile && !mobileDrawer && (
        <button type="button" className="mobile-fab" onClick={() => setMobileDrawer(true)}>
          <MenuIcon size={22} />
        </button>
      )}
      {mobileDrawer && (
        <>
          <div className="sp-mobile-drawer-ov" onClick={() => setMobileDrawer(false)} />
          <div className="sp-mobile-drawer">{navList(true)}</div>
        </>
      )}

      <ChangePasswordDialog open={pwdOpen} onClose={() => setPwdOpen(false)} />
      <BackToTop />
    </div>
  );
}
