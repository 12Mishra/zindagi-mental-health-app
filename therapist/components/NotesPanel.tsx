'use client';

import { useState } from 'react';
import { fmtStamp } from '@/lib/format';
import type { SavedNote } from '@/lib/types';
import { IconNote } from './Icons';

export function NotesPanel({ initial }: { initial: SavedNote[] }) {
  const [notes, setNotes] = useState<SavedNote[]>(initial);
  const [draft, setDraft] = useState('');

  function save() {
    const text = draft.trim();
    if (!text) return;
    setNotes((n) => [{ id: `n-${Date.now()}`, createdAt: new Date().toISOString(), text }, ...n]);
    setDraft('');
  }

  return (
    <section className="card" aria-labelledby="notes-h">
      <div className="card-head">
        <h2 className="section-title" id="notes-h">Session notes</h2>
        <span className="sublabel">Private to you</span>
      </div>
      <div className="field">
        <label htmlFor="note">New note</label>
        <textarea id="note" className="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What stood out in this session?" />
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button type="button" className="btn" onClick={save} disabled={!draft.trim()}>Save note</button>
      </div>
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
