import React from 'react';

interface MarkdownRendererProps {
  content: string;
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

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const html = renderMarkdown(content);

  return (
    <div
      className="markdown-rendered"
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        fontSize: 13,
        lineHeight: 1.6,
        color: 'var(--text-primary)',
      }}
    />
  );
}
