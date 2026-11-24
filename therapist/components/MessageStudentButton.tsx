'use client';

import { useState, useTransition } from 'react';
import { openChat } from '@/lib/actions';

/** Opens (or creates) the chat with the student behind an appointment or request. */
export function MessageStudentButton({ appointmentId, requestId, className = 'btn secondary' }: { appointmentId?: string; requestId?: string; className?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  return (
    <>
      <button type="button" className={className} disabled={pending} onClick={() => start(async () => {
        const res = await openChat(appointmentId ? { appointmentId } : { requestId });
        if (res && !res.ok) setError(res.error);
      })}>
        {pending ? 'Opening…' : 'Message student'}
      </button>
      {error && <span className="form-error" role="alert">{error}</span>}
    </>
  );
}
