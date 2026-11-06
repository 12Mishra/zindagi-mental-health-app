'use client';

import { useState } from 'react';
import type { Consent, Identity } from '@/lib/types';
import { IconLock } from './Icons';

export function IdentityCard({ consent, identity }: { consent: Consent; identity: Identity | null }) {
  const [revealed, setRevealed] = useState(false);
  const allowed = consent.identity && identity !== null;

  return (
    <section className="card" aria-labelledby="id-h">
      <div className="card-head">
        <h2 className="section-title" id="id-h">Identity</h2>
        <span className="sublabel">Hidden by default</span>
      </div>
      {revealed && identity ? (
        <div className="reveal-box" role="status">
          <span className="sublabel">Name</span>
          <strong>{identity.name}</strong>
          {consent.contact && identity.phone && (
            <>
              <span className="sublabel" style={{ marginTop: 6 }}>Phone</span>
              <strong>{identity.phone}</strong>
            </>
          )}
          <span className="sublabel" style={{ marginTop: 8 }}>
            <IconLock size={11} /> Access is logged
          </span>
        </div>
      ) : (
        <>
          <p className="sublabel" style={{ marginBottom: 12 }}>
            {allowed
              ? 'The student agreed to share their name. Revealing is recorded in the access log.'
              : 'The student has not agreed to share their name'}
          </p>
          <button
            type="button"
            className="btn secondary"
            disabled={!allowed}
            aria-describedby="id-why"
            onClick={() => setRevealed(true)}
          >
            Reveal identity
          </button>
          <span id="id-why" className="sr-only">
            {allowed ? 'Access will be logged.' : 'The student has not agreed to share their name.'}
          </span>
        </>
      )}
    </section>
  );
}
