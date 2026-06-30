'use client';

import { useRef, useCallback, useState, useEffect } from 'react';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  className?: string;
  placeholder?: string;
  minHeight?: string;
}

export function RichTextEditor({ value, onChange, className, placeholder, minHeight = '200px' }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [initialized, setInitialized] = useState(false);

  // Set initial content only once
  useEffect(() => {
    if (editorRef.current && !initialized) {
      editorRef.current.innerHTML = value;
      setInitialized(true);
    }
  }, [value, initialized]);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const exec = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    handleInput();
  };

  // Re-sync if value is updated externally (e.g. from parent state reset)
  useEffect(() => {
    if (editorRef.current && initialized && editorRef.current.innerHTML !== value) {
      // Only sync if editor doesn't have focus (external change)
      if (document.activeElement !== editorRef.current) {
        editorRef.current.innerHTML = value;
      }
    }
  }, [value, initialized]);

  const btn = (label: string, command: string, value?: string, icon?: string) => (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); exec(command, value); }}
      className="flex items-center justify-center h-7 w-7 rounded text-sm font-medium text-[#5a6d8a] hover:bg-[#f0f5ff] hover:text-[#064ea2] transition"
      title={label}
    >
      {icon || label}
    </button>
  );

  return (
    <div className={`rounded-lg border border-[#e5ecf4] bg-white overflow-hidden focus-within:border-[#064ea2] focus-within:ring-2 focus-within:ring-[#064ea2]/10 ${className || ''}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[#eef3f8] bg-[#f8fafc] flex-wrap">
        <div className="flex items-center gap-0.5 pr-3 mr-3 border-r border-[#e5ecf4]">
          {btn('标题2', 'formatBlock', 'H2', 'H2')}
          {btn('标题3', 'formatBlock', 'H3', 'H3')}
          {btn('段落', 'formatBlock', 'P', '¶')}
        </div>
        <div className="flex items-center gap-0.5 pr-3 mr-3 border-r border-[#e5ecf4]">
          {btn('粗体', 'bold', undefined, 'B')}
          {btn('斜体', 'italic', undefined, 'I')}
          {btn('下划线', 'underline', undefined, 'U')}
        </div>
        <div className="flex items-center gap-0.5 pr-3 mr-3 border-r border-[#e5ecf4]">
          {btn('居左', 'justifyLeft', undefined, '⫷')}
          {btn('居中', 'justifyCenter', undefined, '⫿')}
          {btn('居右', 'justifyRight', undefined, '⫸')}
        </div>
        <div className="flex items-center gap-0.5 pr-3 mr-3 border-r border-[#e5ecf4]">
          {btn('无序列表', 'insertUnorderedList', undefined, '•')}
          {btn('有序列表', 'insertOrderedList', undefined, '1.')}
        </div>
        <div className="flex items-center gap-0.5">
          {btn('清除格式', 'removeFormat', undefined, 'Tx')}
          {btn('插入表格', 'insertHTML', '<table style="border-collapse:collapse;width:100%"><tbody><tr><td style="border:1px solid #dce6f3;padding:6px 10px">单元格</td><td style="border:1px solid #dce6f3;padding:6px 10px">单元格</td></tr><tr><td style="border:1px solid #dce6f3;padding:6px 10px">单元格</td><td style="border:1px solid #dce6f3;padding:6px 10px">单元格</td></tr></tbody></table>', '▦')}
        </div>
      </div>

      {/* Editor area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleInput}
        className="px-4 py-3 text-sm text-[#18243a] leading-relaxed outline-none"
        style={{ minHeight }}
        data-placeholder={placeholder || '开始输入正文内容...'}
        onKeyDown={e => {
          if (e.key === 'Tab') {
            e.preventDefault();
            exec('indent');
          }
        }}
      />
    </div>
  );
}
