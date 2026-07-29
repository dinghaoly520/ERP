'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Save, MessageSquare } from 'lucide-react';
import { RichTextEditor } from '@/components/rich-text-editor';
import { getClarificationNotice, updateClarificationNotice } from '@/lib/api/system-config';

/**
 * 澄清说明文案编辑发布页。
 * 供应商门户「澄清答疑」区块只读展示这段文案（系统内不接收供应商提交，
 * 仅引导其通过电话/书面来函获取信息），由采购管理人员在此编辑并发布。
 */
export default function ClarificationNoticePage() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await getClarificationNotice();
        setContent(r.value || '');
      } catch (e: any) {
        toast.error(e?.message || '加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const publish = async () => {
    setSaving(true);
    try {
      await updateClarificationNotice(content);
      toast.success('澄清说明已发布，供应商端将展示最新内容');
    } catch (e: any) {
      toast.error(e?.message || '发布失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <MessageSquare size={17} />
            </div>
            <div>
              <div className="page-hero__title">澄清说明</div>
              <div className="page-hero__sub">
                编辑供应商门户「澄清答疑」区块展示的说明文案；保存即发布，供应商端实时展示
              </div>
            </div>
          </div>
          <button
            onClick={publish}
            disabled={saving || loading}
            className="neu-btn-primary disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? '发布中...' : '保存并发布'}
          </button>
        </div>
      </div>

      {/* ══════ 编辑区 ══════ */}
      <div className="neu-card p-5">
        <p className="mb-3 text-xs leading-5 text-[var(--muted-foreground)]">
          此文案展示在供应商投标详情页的「澄清答疑」卡片顶部，用于告知供应商：本系统不接收在线澄清/答疑提交，
          请通过招标文件载明的电话或书面来函方式获取信息。
        </p>
        {loading ? (
          <div className="py-10 text-center text-xs text-[var(--muted-foreground)]">加载中…</div>
        ) : (
          <RichTextEditor
            value={content}
            onChange={setContent}
            placeholder="请输入澄清说明文案，例如：如需就本项目提出疑问，请拨打联系电话或以书面来函方式提交…"
            minHeight="240px"
          />
        )}
      </div>
    </div>
  );
}
