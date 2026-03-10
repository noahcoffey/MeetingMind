jest.mock('./logger', () => ({
  log: jest.fn(),
}));

jest.mock('./recording-manager', () => ({
  getRecording: jest.fn(),
}));

jest.mock('electron', () => ({
  clipboard: { writeText: jest.fn() },
  shell: { openExternal: jest.fn() },
  BrowserWindow: jest.fn(),
}));

import { markdownToHtml } from './export';

describe('markdownToHtml', () => {
  test('converts h1 headings', () => {
    expect(markdownToHtml('# Title')).toContain('<h1>Title</h1>');
  });

  test('converts h2 headings', () => {
    expect(markdownToHtml('## Section')).toContain('<h2>Section</h2>');
  });

  test('converts h3 headings', () => {
    expect(markdownToHtml('### Subsection')).toContain('<h3>Subsection</h3>');
  });

  test('converts bold text', () => {
    const html = markdownToHtml('This is **bold** text');
    expect(html).toContain('<strong>bold</strong>');
  });

  test('converts italic text', () => {
    const html = markdownToHtml('This is *italic* text');
    expect(html).toContain('<em>italic</em>');
  });

  test('converts inline code', () => {
    const html = markdownToHtml('Use `console.log` here');
    expect(html).toContain('<code>console.log</code>');
  });

  test('converts unordered list items', () => {
    const html = markdownToHtml('- First item\n- Second item');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>First item</li>');
    expect(html).toContain('<li>Second item</li>');
    expect(html).toContain('</ul>');
  });

  test('converts checked checkbox items', () => {
    const html = markdownToHtml('- [x] Done task');
    expect(html).toContain('checklist');
    expect(html).toContain('checked');
    expect(html).toContain('Done task');
  });

  test('converts unchecked checkbox items', () => {
    const html = markdownToHtml('- [ ] Todo task');
    expect(html).toContain('checklist');
    expect(html).toContain('unchecked');
    expect(html).toContain('Todo task');
  });

  test('converts blockquotes', () => {
    const html = markdownToHtml('> This is a quote');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('This is a quote');
    expect(html).toContain('</blockquote>');
  });

  test('converts numbered list items', () => {
    const html = markdownToHtml('1. First\n2. Second');
    expect(html).toContain('First');
    expect(html).toContain('Second');
    expect(html).toContain('numbered-item');
  });

  test('wraps plain text in paragraphs', () => {
    const html = markdownToHtml('Just some text');
    expect(html).toContain('<p>Just some text</p>');
  });

  test('handles empty input', () => {
    expect(markdownToHtml('')).toBe('');
  });

  test('handles mixed content', () => {
    const md = `# Meeting Notes

## Summary

This was a **productive** meeting.

- Action item one
- Action item two

> Important quote here

### Next Steps

1. Follow up with team
2. Send report`;

    const html = markdownToHtml(md);
    expect(html).toContain('<h1>Meeting Notes</h1>');
    expect(html).toContain('<h2>Summary</h2>');
    expect(html).toContain('<strong>productive</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<h3>Next Steps</h3>');
  });

  test('closes open lists before headings', () => {
    const md = `- item 1\n- item 2\n## New Section`;
    const html = markdownToHtml(md);
    expect(html).toContain('</ul>');
    expect(html).toContain('<h2>New Section</h2>');
    // </ul> should come before <h2>
    const ulClose = html.indexOf('</ul>');
    const h2Open = html.indexOf('<h2>');
    expect(ulClose).toBeLessThan(h2Open);
  });

  test('closes open blockquotes before lists', () => {
    const md = `> quote\n- list item`;
    const html = markdownToHtml(md);
    expect(html).toContain('</blockquote>');
    expect(html).toContain('<ul>');
    const bqClose = html.indexOf('</blockquote>');
    const ulOpen = html.indexOf('<ul>');
    expect(bqClose).toBeLessThan(ulOpen);
  });

  test('handles bold inside headings', () => {
    const html = markdownToHtml('## **Important** Section');
    expect(html).toContain('<h2><strong>Important</strong> Section</h2>');
  });

  test('handles bold inside list items', () => {
    const html = markdownToHtml('- **Noah**: Do the thing');
    expect(html).toContain('<strong>Noah</strong>');
    expect(html).toContain('<li>');
  });

  test('multiple inline formats in one line', () => {
    const html = markdownToHtml('Use **bold** and *italic* and `code` together');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
  });
});
