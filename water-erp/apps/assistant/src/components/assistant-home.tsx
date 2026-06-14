'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './assistant-home.module.css';
import { Sparkles, Send, Loader2, BarChart3, AlertTriangle, Users, ShoppingBag, FileText, Calendar, Search } from 'lucide-react';

const copy = {
  title: '智慧水发 · 蜀水云采',
  placeholder: '输入问题 / 生成分析 / 操作业务，如：汇总本月招采风险并画趋势图',
};

const quickCards = [
  {
    icon: BarChart3,
    title: '董事长驾驶舱',
    desc: '全局经营态势',
    tool: 'global_overview',
    args: { action: 'stats' },
  },
  {
    icon: Search,
    title: '全系统数据问答',
    desc: '自然语言查询',
    tool: 'global_overview',
    args: { action: 'stats' },
  },
  {
    icon: AlertTriangle,
    title: '招采风险扫描',
    desc: '智能风险识别',
    tool: 'bid',
    args: { action: 'risks' },
  },
  {
    icon: Users,
    title: '供应商画像',
    desc: '风险与信用分析',
    tool: 'supplier',
    args: { action: 'stats' },
  },
  {
    icon: ShoppingBag,
    title: '商城经营分析',
    desc: '价格与供货趋势',
    tool: 'mall',
    args: { action: 'stats' },
  },
  {
    icon: Calendar,
    title: '今日重点事项',
    desc: '开评标与审批',
    tool: 'bid',
    args: { action: 'active' },
  },
  {
    icon: FileText,
    title: '汇报材料生成',
    desc: '智能撰稿辅助',
    tool: 'global_overview',
    args: { action: 'stats' },
  },
  {
    icon: Sparkles,
    title: '业务操作助手',
    desc: '审批与变更协同',
    tool: 'supplier',
    args: { action: 'pending' },
  },
];

function useMouseSpotlight() {
  const layerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const targetRef = useRef({ x: 0.5, y: 0.5 });
  const currentRef = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      targetRef.current = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      };
    };

    const animate = () => {
      const t = targetRef.current;
      const c = currentRef.current;
      // 平滑插值
      const speed = 0.08;
      c.x += (t.x - c.x) * speed;
      c.y += (t.y - c.y) * speed;

      const el = layerRef.current;
      if (el) {
        el.style.setProperty('--spotlight-x', `${c.x * 100}%`);
        el.style.setProperty('--spotlight-y', `${c.y * 100}%`);
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    window.addEventListener('mousemove', handleMove, { passive: true });
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return layerRef;
}

export function AssistantHome({
  onSend,
  isLoading,
}: {
  onSend: (msg: string) => void;
  isLoading?: boolean;
}) {
  const [inputValue, setInputValue] = useState('');
  const spotlightRef = useMouseSpotlight();

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setInputValue('');
  }, [inputValue, isLoading, onSend]);

  return (
    <div className={styles.home}>
      {/* 鼠标跟随光影 */}
      <div ref={spotlightRef} className={styles.spotlightLayer} />
      <section className={styles.hero}>
        {/* 品牌区 */}
        <div className={styles.brandRow}>
          <div className={styles.logoShell}>
            <img src="/logo.jpg" alt="Logo" className={styles.logoImage} />
          </div>
          <h1 className={styles.title}>{copy.title}</h1>
        </div>

        {/* 搜索框 */}
        <div className={styles.commandPanel}>
          <div className={styles.commandBox}>
            <textarea
              className={styles.aiInput}
              placeholder={copy.placeholder}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              disabled={isLoading}
            />
            <button
              className={`${styles.sendBtn} ${inputValue.trim() && !isLoading ? styles.active : ''}`}
              onClick={handleSend}
              disabled={!inputValue.trim() || isLoading}
              type="button"
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Send size={18} />
              )}
            </button>
          </div>
        </div>

        {/* 快捷入口 */}
        <div className={styles.quickCards}>
          {quickCards.map((card) => (
            <button
              key={card.title}
              className={styles.quickCard}
              onClick={() => {
                const argsStr = JSON.stringify(card.args);
                onSend(`请调用 ${card.tool} 工具，参数 ${argsStr}，获取最新数据后给我一份针对性的分析与建议。`);
              }}
              type="button"
            >
              <span className={styles.quickIcon}>
                <card.icon size={24} strokeWidth={1.8} />
              </span>
              <span className={styles.quickText}>
                <span className={styles.quickTitle}>{card.title}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
