'use client';

import { useState, useTransition } from 'react';
import { addNote } from '@/lib/actions';
import { fmtStamp } from '@/lib/format';
import type { SavedNote } from '@/lib/types';
import { IconNote } from './Icons';

export function NotesPanel({ appointmentId, initial }: { appointmentId: string; initial: SavedNote[] }) {
  // Newest first; core returns oldest first.
  const [notes, setNotes] = useState<SavedNote[]>(() => [...initial].reverse());
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  function save() {
    const text = draft.trim();
    if (!text) return;
    setError('');
    start(async () => {
      const res = await addNote(appointmentId, text);
      if (!res.ok) { setError(res.error); return; }
      setNotes((n) => [res.data, ...n]);
      setDraft('');
    });
  }

  return (
    <section className="card" aria-labelledby="notes-h">
      <div className="card-head">
        <h2 className="section-title" id="notes-h">Session notes</h2>
        <span className="sublabel">Private to you · encrypted</span>
      </div>
      <div className="field">
        <label htmlFor="note">New note</label>
        <textarea id="note" className="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What stood out in this session?" />
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button type="button" className="btn" onClick={save} disabled={!draft.trim() || pending}>{pending ? 'Saving…' : 'Save note'}</button>
      </div>
      <p className="form-error" role="alert">{error}</p>
      {notes.length === 0 ? (
        <div className="empty">
          <IconNote size={28} />
          <strong>No notes yet</strong>
          <p className="sublabel">Saved notes appear here.</p>
        </div>
      ) : (
        <ul className="note-list" aria-label="Saved notes">
          {notes.map((n) => (
            <li key={n.id} className="note">
              <time dateTime={n.createdAt}>{fmtStamp(n.createdAt)}</time>
              {n.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
