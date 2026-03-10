import { clipboard, shell, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';
import { getRecording } from './recording-manager';

/**
 * Convert a subset of markdown to HTML for PDF rendering.
 */
function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const htmlLines: string[] = [];
  let inUl = false;
  let inBlockquote = false;

  function closeUl(): void {
    if (inUl) {
      htmlLines.push('</ul>');
      inUl = false;
    }
  }

  function closeBlockquote(): void {
    if (inBlockquote) {
      htmlLines.push('</blockquote>');
      inBlockquote = false;
    }
  }

  function inlineFormat(text: string): string {
    // Code (inline)
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return text;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headings
    if (line.startsWith('### ')) {
      closeUl();
      closeBlockquote();
      htmlLines.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith('## ')) {
      closeUl();
      closeBlockquote();
      htmlLines.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith('# ')) {
      closeUl();
      closeBlockquote();
      htmlLines.push(`<h1>${inlineFormat(line.slice(2))}</h1>`);
      continue;
    }

    // Checkbox list items
    if (/^- \[x\] /.test(line)) {
      closeBlockquote();
      if (!inUl) { htmlLines.push('<ul class="checklist">'); inUl = true; }
      htmlLines.push(`<li class="checked">&#9745; ${inlineFormat(line.slice(6))}</li>`);
      continue;
    }
    if (/^- \[ \] /.test(line)) {
      closeBlockquote();
      if (!inUl) { htmlLines.push('<ul class="checklist">'); inUl = true; }
      htmlLines.push(`<li class="unchecked">&#9744; ${inlineFormat(line.slice(6))}</li>`);
      continue;
    }

    // Unordered list items
    if (/^- /.test(line)) {
      closeBlockquote();
      if (!inUl) { htmlLines.push('<ul>'); inUl = true; }
      htmlLines.push(`<li>${inlineFormat(line.slice(2))}</li>`);
      continue;
    }

    // Numbered list items
    if (/^\d+\.\s/.test(line)) {
      closeBlockquote();
      // Treat numbered lists similarly — wrap in <ol> would be ideal,
      // but for simplicity we output a paragraph with the number preserved.
      closeUl();
      const content = line.replace(/^\d+\.\s/, '');
      htmlLines.push(`<p class="numbered-item">${inlineFormat(line)}</p>`);
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      closeUl();
      if (!inBlockquote) { htmlLines.push('<blockquote>'); inBlockquote = true; }
      htmlLines.push(`<p>${inlineFormat(line.slice(2))}</p>`);
      continue;
    }

    // Empty line — paragraph break
    if (line.trim() === '') {
      closeUl();
      closeBlockquote();
      continue;
    }

    // Regular text
    closeUl();
    closeBlockquote();
    htmlLines.push(`<p>${inlineFormat(line)}</p>`);
  }

  closeUl();
  closeBlockquote();

  return htmlLines.join('\n');
}

function getNotesContent(recordingId: string): { content: string; outputDir: string } | null {
  const recording = getRecording(recordingId);
  if (!recording) return null;

  const outputDir = path.dirname(recording.audioPath);
  const notesPath = path.join(outputDir, 'notes.md');

  if (!fs.existsSync(notesPath)) return null;

  const content = fs.readFileSync(notesPath, 'utf-8');
  return { content, outputDir };
}

// Copy notes to clipboard as plain text
export function copyNotesToClipboard(recordingId: string): { success: boolean; error?: string } {
  try {
    const result = getNotesContent(recordingId);
    if (!result) {
      return { success: false, error: 'Recording or notes not found' };
    }

    clipboard.writeText(result.content);
    log('info', `Notes copied to clipboard for recording ${recordingId}`);
    return { success: true };
  } catch (err) {
    log('error', `Failed to copy notes to clipboard`, err);
    return { success: false, error: `Failed to copy: ${err}` };
  }
}

// Export notes as PDF
export async function exportNotesAsPDF(recordingId: string): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const result = getNotesContent(recordingId);
    if (!result) {
      return { success: false, error: 'Recording or notes not found' };
    }

    const { content, outputDir } = result;
    const htmlBody = markdownToHtml(content);

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #1a1a1a;
    background: #fff;
    line-height: 1.6;
    font-size: 13px;
    max-width: 100%;
    padding: 0;
    margin: 0;
  }
  h1 { font-size: 22px; margin: 0 0 12px 0; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
  h2 { font-size: 18px; margin: 20px 0 8px 0; }
  h3 { font-size: 15px; margin: 16px 0 6px 0; }
  p { margin: 4px 0; }
  ul { margin: 4px 0; padding-left: 24px; }
  ul.checklist { list-style: none; padding-left: 4px; }
  ul.checklist li { margin: 2px 0; }
  li { margin: 2px 0; }
  blockquote {
    border-left: 3px solid #ccc;
    margin: 8px 0;
    padding: 4px 12px;
    color: #555;
  }
  code {
    background: #f0f0f0;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 12px;
  }
  strong { font-weight: 600; }
  .numbered-item { margin: 2px 0; }
</style>
</head>
<body>
${htmlBody}
</body>
</html>`;

    // Create a hidden BrowserWindow for PDF rendering
    const win = new BrowserWindow({
      show: false,
      width: 816,  // Letter width at 96 DPI
      height: 1056,
      webPreferences: {
        offscreen: true,
      },
    });

    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      margins: {
        top: 0.5,
        bottom: 0.5,
        left: 0.5,
        right: 0.5,
      },
    });

    win.close();

    const pdfPath = path.join(outputDir, 'notes.pdf');
    fs.writeFileSync(pdfPath, pdfBuffer);

    log('info', `Notes exported as PDF for recording ${recordingId}`, { path: pdfPath });
    return { success: true, path: pdfPath };
  } catch (err) {
    log('error', `Failed to export notes as PDF`, err);
    return { success: false, error: `Failed to export PDF: ${err}` };
  }
}

// Open email client with notes summary
export function emailNotes(recordingId: string): { success: boolean; error?: string } {
  try {
    const recording = getRecording(recordingId);
    if (!recording) {
      return { success: false, error: 'Recording not found' };
    }

    const result = getNotesContent(recordingId);
    if (!result) {
      return { success: false, error: 'Notes not found' };
    }

    const { content } = result;

    // Take first 1500 chars as summary
    const summary = content.length > 1500 ? content.slice(0, 1500) + '\n\n...' : content;

    // Build attendee list from calendar event if available
    const outputDir = path.dirname(recording.audioPath);
    const manifestPath = path.join(outputDir, 'manifest.json');
    let attendees = '';
    let title = recording.title || 'Meeting Notes';

    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        if (manifest.calendarEvent?.attendees?.length) {
          attendees = manifest.calendarEvent.attendees.join(',');
        }
        if (manifest.calendarEvent?.title) {
          title = manifest.calendarEvent.title;
        }
      } catch {}
    }

    const subject = `Meeting Notes: ${title}`;
    const mailtoUrl = `mailto:${attendees}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(summary)}`;

    shell.openExternal(mailtoUrl);
    log('info', `Email opened for recording ${recordingId}`);
    return { success: true };
  } catch (err) {
    log('error', `Failed to open email for notes`, err);
    return { success: false, error: `Failed to email: ${err}` };
  }
}
