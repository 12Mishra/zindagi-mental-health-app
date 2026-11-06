'use client';

import { useEffect, useRef } from 'react';

type Props = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Native <dialog>: focus trap, Esc to close and inert background come from the browser. */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel = 'Keep appointment', onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dlg-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="dlg-title">{title}</h2>
      <p>{body}</p>
      <div className="btn-row">
        <button type="button" className="btn secondary" onClick={onCancel} autoFocus>{cancelLabel}</button>
        <button type="button" className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}
