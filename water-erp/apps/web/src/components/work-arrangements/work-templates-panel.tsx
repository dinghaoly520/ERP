import {
  WORK_ARRANGEMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_URGENCY_LABELS,
  type WorkArrangementTemplate,
} from '@/lib/types/work-arrangements';

type WorkTemplatesPanelProps = {
  templates: WorkArrangementTemplate[];
  selectedTemplateId: string;
  templateName: string;
  templateBusy: boolean;
  open: boolean;
  onToggle: () => void;
  onSelectedTemplateChange: (value: string) => void;
  onTemplateNameChange: (value: string) => void;
  onApplyTemplate: () => void;
  onSaveTemplate: () => void;
  onDeleteTemplate: (templateId: string) => void;
};

export function WorkTemplatesPanel({
  templates,
  selectedTemplateId,
  templateName,
  templateBusy,
  open,
  onToggle,
  onSelectedTemplateChange,
  onTemplateNameChange,
  onApplyTemplate,
  onSaveTemplate,
  onDeleteTemplate,
}: WorkTemplatesPanelProps) {
  return (
    <div className="mt-4 rounded-[22px] border border-white/60 bg-[rgba(248,251,255,0.84)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-[color:var(--foreground)]">模板与复用</div>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex min-h-9 items-center rounded-full border border-white/72 bg-white/82 px-3 py-1.5 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-white"
        >
          {open ? '收起' : '展开'}
        </button>
      </div>

      {!open ? (
        <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">模板属于效率工具，按需展开即可。</div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2">
            <select
              value={selectedTemplateId}
              onChange={(event) => onSelectedTemplateChange(event.target.value)}
              className="rounded-[16px] border border-white/62 bg-white/78 px-3 py-2.5 text-sm outline-none"
            >
              <option value="">选择已有模板</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onApplyTemplate}
              disabled={!selectedTemplateId}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/72 bg-white/82 px-4 py-2 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              应用到当前表单
            </button>
          </div>

          <div className="grid gap-2">
            <input
              value={templateName}
              onChange={(event) => onTemplateNameChange(event.target.value)}
              placeholder="将当前表单保存为模板"
              className="rounded-[16px] border border-white/62 bg-white/78 px-3 py-2.5 text-sm outline-none"
            />
            <button
              type="button"
              onClick={onSaveTemplate}
              disabled={templateBusy}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/72 bg-[rgba(243,248,255,0.96)] px-4 py-2 text-sm font-semibold text-[color:var(--accent)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {templateBusy ? '处理中...' : '保存为模板'}
            </button>
          </div>

          <div className="space-y-2">
            {templates.slice(0, 5).map((template) => (
              <div key={template.id} className="rounded-[18px] bg-white/82 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[color:var(--foreground)]">{template.name}</div>
                    <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                      {WORK_ARRANGEMENT_TYPE_LABELS[template.type]} · {WORK_ARRANGEMENT_URGENCY_LABELS[template.urgency]}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteTemplate(template.id)}
                    disabled={templateBusy}
                    className="text-[color:var(--muted-foreground)] transition hover:text-[color:var(--danger)] disabled:opacity-60"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
