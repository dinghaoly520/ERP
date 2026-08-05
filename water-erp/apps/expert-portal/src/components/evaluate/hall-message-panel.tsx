'use client';

import { useEffect, useRef } from 'react';
import type { HallMessagePayload } from '@water-erp/shared';

interface Props {
  messages: HallMessagePayload[];
  onOpen?: () => void;
}

/**
 * 专家端开标大厅消息面板（只读）。
 *
 * 仅显示公聊消息，无输入框、无 tab 切换、无发送按钮。
 * 自动滚到最新消息。
 *
 * 样式对齐 ExchangeDrawer 的消息气泡规范：
 * - SYSTEM 消息：居中半透明 pill banner
 * - HOST 消息：左对齐带头像圆圈 + 名字 + 时间戳 + 玻璃气泡
 */
export function HallMessagePanel({ messages, onOpen }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新消息到达时自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // 打开时回调（外部用于标记已读）
  useEffect(() => {
    onOpen?.();
    // 只在首次挂载时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? d.toLocaleTimeString('zh-CN')
      : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-bold text-[var(--foreground)]">开标大厅消息</span>
        <span className="text-[10px] text-[var(--muted-foreground)]">只读 · 公聊</span>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {messages.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-[var(--muted-foreground)]">
            暂无消息
          </div>
        ) : (
          messages.map((m) =>
            m.senderRole === 'SYSTEM' ? (
              // 系统消息：居中提示条
              <div
                key={m.id}
                className="mx-auto my-2 w-fit max-w-[85%] rounded-full bg-[oklch(0.6_0.04_258_/_0.12)] px-3 py-1 text-center text-[11px] text-[var(--muted-foreground)]"
              >
                {m.content}
              </div>
            ) : (
              // 气泡式：HOST 左对齐（对方），带头像 + 玻璃泡
              <div key={m.id} className="my-3 flex items-start gap-2">
                {/* 发送者头像 */}
                <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--accent-strong)] text-xs font-semibold text-white">
                  {(m.senderName || '?').slice(0, 1)}
                </div>
                {/* 消息列 */}
                <div className="flex max-w-[74%] flex-col items-start">
                  {/* 发送者 + 时间 */}
                  <div className="mb-0.5 text-[11px] text-[var(--muted-foreground)]">
                    {m.senderName} · {fmtTime(m.createdAt)}
                  </div>
                  {/* 气泡 */}
                  <div className="whitespace-pre-wrap break-all rounded-xl rounded-tl-sm bg-[oklch(0.985_0.006_258)] px-3 py-2 text-sm leading-relaxed text-[var(--foreground)]"
                    style={{
                      boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 5px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85)',
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              </div>
            ),
          )
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
