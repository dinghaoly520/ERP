'use client';

import { AlertTriangle, Loader2, UserRound, Settings, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect, useState } from 'react';
import { fetchCurrentUser, fetchDepartments, logout } from '@/lib/api/auth';
import type { AuthUser, DepartmentItem } from '@/lib/api/auth';
import { clearWorkspaceCache } from '@/components/work-arrangements/work-arrangements-page';
import { PersonalCenterHero } from './personal-center-hero';
import { TabBasicInfo } from './tab-basic-info';
import { TabPreferences } from './tab-preferences';
import { TabWorkPortrait, clearWorkPortraitCache } from './tab-work-portrait';
import { TabWorkBadges } from './tab-work-badges';
import { MemberListDialog } from '../chat/member-list-dialog';
import { ChatDialog } from '../chat/chat-dialog';

type ModalKind = 'closed' | 'basic-info' | 'preferences';

export function PersonalCenterPage() {
  const router = useRouter();
  const [modal, setModal] = useState<ModalKind>('closed');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [loggingOut, setLoggingOut] = useState(false);
  const [dialogState, setDialogState] = useState<{ kind: 'closed' } | { kind: 'members' } | { kind: 'chat'; peerId: string }>({ kind: 'closed' });

  useEffect(() => {
    const load = async () => {
      try {
        const [currentUser, depts] = await Promise.all([
          fetchCurrentUser(),
          fetchDepartments(),
        ]);
        setUser(currentUser);
        setDepartments(depts);
      } catch {
        setUser(null);
      } finally {
        setLoadingUser(false);
      }
    };
    void load();
  }, []);

  const handleUserUpdated = (updated: AuthUser) => {
    setUser((prev) => prev ? { ...prev, ...updated } : prev);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      clearWorkspaceCache();
      clearWorkPortraitCache();
      startTransition(() => { router.replace('/login'); router.refresh(); });
    } finally {
      setLoggingOut(false);
    }
  };

  if (loadingUser) {
    return (
      <div className="wb-panel flex flex-col items-center justify-center gap-4 py-20">
        <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
          <Loader2 size={24} strokeWidth={1.4} className="animate-spin text-[color:var(--accent)]" />
        </div>
        <div className="text-center">
          <div className="text-sm font-medium text-[color:var(--foreground)]">正在加载个人中心</div>
          <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">请稍候...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="wb-panel flex flex-col items-center justify-center gap-4 py-20">
        <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
          <AlertTriangle size={24} strokeWidth={1.4} className="text-[color:var(--danger)]" />
        </div>
        <div className="text-center">
          <div className="text-sm font-medium text-[color:var(--foreground)]">无法加载账号信息</div>
          <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">请检查网络连接后重试</div>
        </div>
        <button type="button" onClick={() => window.location.reload()} className="neu-btn-soft mt-1">
          重试
        </button>
      </div>
    );
  }

  const modalConfig: { kind: ModalKind; title: string; icon: typeof UserRound }[] = [
    { kind: 'basic-info', title: '基本资料与安全', icon: UserRound },
    { kind: 'preferences', title: '偏好设置', icon: Settings },
  ];

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* ═══ 统一 Page Hero ═══ */}
      <PersonalCenterHero
        user={user}
        onOpenBasicInfo={() => setModal('basic-info')}
        onOpenPreferences={() => setModal('preferences')}
        onOpenMemberList={() => setDialogState({ kind: 'members' })}
        onLogout={handleLogout}
        loggingOut={loggingOut}
      />

      {/* ═══ 工作画像 ═══ */}
      <TabWorkPortrait />

      {/* ═══ 工作印记 ═══ */}
      <TabWorkBadges />

      {/* ═══ 弹窗 ═══ */}
      {modal !== 'closed' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={() => setModal('closed')} />
          <div className="relative flex w-full max-w-[min(640px,92vw)] max-h-[88vh] flex-col overflow-hidden rounded-[20px] bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]" role="dialog" aria-modal="true">
            {/* 固定标题区 */}
            <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-6">
              <div className="flex items-center gap-2.5">
                <div className="neu-icon-well flex h-9 w-9 items-center justify-center rounded-[10px]">
                  {modal === 'basic-info' ? <UserRound size={15} className="text-[var(--accent)]" /> : <Settings size={15} className="text-[var(--accent)]" />}
                </div>
                <h2 className="text-sm font-extrabold text-[var(--foreground)]">
                  {modalConfig.find(m => m.kind === modal)?.title}
                </h2>
              </div>
              <button onClick={() => setModal('closed')} className="neu-btn-xs" aria-label="关闭">
                <X size={14} />
              </button>
            </div>
            <hr className="wb-section-rule mx-6 shrink-0" />
            {/* 独立滚动内容区 */}
            <div className="flex-1 overflow-y-auto px-6 pt-5 pb-6">
              {modal === 'basic-info' && <TabBasicInfo user={user} departments={departments} onUserUpdated={handleUserUpdated} />}
              {modal === 'preferences' && <TabPreferences />}
            </div>
          </div>
        </div>
      )}

      {/* 人员列表 / 聊天 弹窗 */}
      {dialogState.kind === 'members' && (
        <MemberListDialog
          onClose={() => setDialogState({ kind: 'closed' })}
          onSelectPeer={(peerId) => setDialogState({ kind: 'chat', peerId })}
        />
      )}
      {dialogState.kind === 'chat' && (
        <ChatDialog
          peerId={dialogState.peerId}
          onClose={() => setDialogState({ kind: 'closed' })}
          onBack={() => setDialogState({ kind: 'members' })}
        />
      )}
    </div>
  );
}
