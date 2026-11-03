import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  /** Red confirm button, for things that can't be undone. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// One confirmation dialog for the whole app. Escape or a click outside
// cancels, and focus starts on Cancel so a stray Enter never confirms
// something that can't be undone.
export default function ConfirmDialog({ title, children, confirmLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Callers pass inline handlers; read the latest one through a ref so the
  // effect below runs once per opening, not on every parent render (which
  // would keep pulling focus back to Cancel).
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current();
      } else if (e.key === 'Tab' && dialogRef.current) {
        // Keep Tab inside the dialog.
        const buttons = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button'));
        if (buttons.length === 0) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, []);

  // Portalled to <body> so it sits above everything, whatever opened it.
  return createPortal(
    <div className="confirm-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
          <div style={{ color: danger ? 'var(--accent-primary)' : 'var(--accent-yellow)', flexShrink: 0, marginTop: 2 }} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <div id="confirm-dialog-title" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{title}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{children}</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button ref={cancelRef} className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
