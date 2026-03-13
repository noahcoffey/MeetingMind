import React, { useState, useRef, useEffect, useCallback } from 'react';

interface CorrectionData {
  original: string;
  corrected: string;
}

interface MarkdownRendererProps {
  content: string;
  onCorrection?: (data: CorrectionData) => void;
}

function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const htmlLines: string[] = [];
  let inUl = false;
  let inOl = false;
  let inBlockquote = false;

  function closeUl() {
    if (inUl) { htmlLines.push('</ul>'); inUl = false; }
  }
  function closeOl() {
    if (inOl) { htmlLines.push('</ol>'); inOl = false; }
  }
  function closeBq() {
    if (inBlockquote) { htmlLines.push('</blockquote>'); inBlockquote = false; }
  }
  function closeLists() { closeUl(); closeOl(); }

  function inline(text: string): string {
    // Escape HTML entities
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return text;
  }

  for (const line of lines) {
    // Headings
    if (line.startsWith('### ')) {
      closeLists(); closeBq();
      htmlLines.push(`<h3>${inline(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith('## ')) {
      closeLists(); closeBq();
      htmlLines.push(`<h2>${inline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith('# ')) {
      closeLists(); closeBq();
      htmlLines.push(`<h1>${inline(line.slice(2))}</h1>`);
      continue;
    }

    // Checkbox list items
    if (/^- \[x\] /.test(line)) {
      closeBq(); closeOl();
      if (!inUl) { htmlLines.push('<ul class="md-checklist">'); inUl = true; }
      htmlLines.push(`<li class="md-checked">\u2611 ${inline(line.slice(6))}</li>`);
      continue;
    }
    if (/^- \[ \] /.test(line)) {
      closeBq(); closeOl();
      if (!inUl) { htmlLines.push('<ul class="md-checklist">'); inUl = true; }
      htmlLines.push(`<li class="md-unchecked">\u2610 ${inline(line.slice(6))}</li>`);
      continue;
    }

    // Unordered list
    if (/^- /.test(line)) {
      closeBq(); closeOl();
      if (!inUl) { htmlLines.push('<ul>'); inUl = true; }
      htmlLines.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      closeBq(); closeUl();
      if (!inOl) { htmlLines.push('<ol>'); inOl = true; }
      const content = line.replace(/^\d+\.\s/, '');
      htmlLines.push(`<li>${inline(content)}</li>`);
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      closeLists();
      if (!inBlockquote) { htmlLines.push('<blockquote>'); inBlockquote = true; }
      htmlLines.push(`<p>${inline(line.slice(2))}</p>`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      closeLists(); closeBq();
      htmlLines.push('<hr />');
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      closeLists(); closeBq();
      continue;
    }

    // Regular text
    closeLists(); closeBq();
    htmlLines.push(`<p>${inline(line)}</p>`);
  }

  closeLists(); closeBq();
  return htmlLines.join('\n');
}

interface PopoverState {
  x: number;
  y: number;
  selectedText: string;
}

export default function MarkdownRenderer({ content, onCorrection }: MarkdownRendererProps) {
  const html = renderMarkdown(content);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [correctionText, setCorrectionText] = useState('');

  const handleMouseUp = useCallback(() => {
    if (!onCorrection) return;

    // Small delay to let the selection finalize
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      if (!text || text.length === 0) return;

      // Make sure the selection is within our container
      if (!containerRef.current || !selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!containerRef.current.contains(range.commonAncestorContainer)) return;

      const rect = range.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();

      setPopover({
        x: rect.left - containerRect.left + rect.width / 2,
        y: rect.top - containerRect.top - 4,
        selectedText: text,
      });
      setCorrectionText('');
    }, 10);
  }, [onCorrection]);

  // Close popover when clicking outside
  useEffect(() => {
    if (!popover) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [popover]);

  // Focus input when popover opens
  useEffect(() => {
    if (popover) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [popover]);

  function handleSubmitCorrection() {
    if (!popover || !correctionText.trim()) return;
    onCorrection?.({
      original: popover.selectedText,
      corrected: correctionText.trim(),
    });
    setPopover(null);
    setCorrectionText('');
    window.getSelection()?.removeAllRanges();
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }} onMouseUp={handleMouseUp}>
      <div
        className="markdown-rendered"
        dangerouslySetInnerHTML={{ __html: html }}
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--text-primary)',
        }}
      />
      {popover && (
        <div
          ref={popoverRef}
          style={{
            position: 'absolute',
            left: popover.x,
            top: popover.y,
            transform: 'translate(-50%, -100%)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            padding: '8px 10px',
            boxShadow: 'var(--shadow-dropdown)',
            zIndex: 100,
            minWidth: 220,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            Correct "<span style={{ color: 'var(--text-secondary)' }}>{popover.selectedText}</span>"
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={inputRef}
              type="text"
              className="form-input"
              placeholder="Correct spelling..."
              value={correctionText}
              onChange={e => setCorrectionText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); handleSubmitCorrection(); }
                if (e.key === 'Escape') setPopover(null);
              }}
              style={{ fontSize: 12, padding: '4px 8px', flex: 1 }}
            />
            <button
              className="btn btn-primary"
              onClick={handleSubmitCorrection}
              disabled={!correctionText.trim()}
              style={{ fontSize: 11, padding: '4px 10px' }}
            >
              Fix
            </button>
          </div>
          {/* Arrow */}
          <div style={{
            position: 'absolute',
            bottom: -6,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid var(--border-color)',
          }} />
        </div>
      )}
    </div>
  );
}
