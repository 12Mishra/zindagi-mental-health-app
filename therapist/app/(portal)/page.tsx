import { AppointmentCard } from '@/components/AppointmentCard';
import { IconCalendar } from '@/components/Icons';
import Link from 'next/link';
import { getAppointments, getMe, getRequests } from '@/lib/data';
import { dayKey, fmtDate, greeting } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const [appointments, me, requests] = await Promise.all([getAppointments(), getMe(), getRequests('open')]);
  const all = appointments.filter((a) => a.status === 'CONFIRMED');
  const waiting = requests.filter((r) => r.status === 'PENDING').length;
  const today = dayKey(new Date());
  const todays = all.filter((a) => dayKey(a.startsAt) === today);
  const upcoming = all.filter((a) => dayKey(a.startsAt) > today);

  return (
    <>
      <div>
        <h1 className="page-title">{greeting()}, {me.displayName}</h1>
        <p className="date-line" style={{ marginTop: 4 }}>
          {fmtDate(new Date().toISOString())} · {todays.length} {todays.length === 1 ? 'appointment' : 'appointments'} today
        </p>
      </div>

      {waiting > 0 && (
        <Link href="/requests" className="card banner">
          <strong>{waiting} session {waiting === 1 ? 'request is' : 'requests are'} waiting for a time</strong>
          <span className="sublabel">Confirm one of the student&apos;s times or suggest another →</span>
        </Link>
      )}

      <section aria-labelledby="today-h" className="stack">
        <h2 className="section-title" id="today-h">Today</h2>
        {todays.length === 0 ? (
          <div className="card empty">
            <IconCalendar size={28} />
            <strong>No appointments today</strong>
            <p className="sublabel">Your day is clear.</p>
          </div>
        ) : (
          <ul className="appt-list">
            {todays.map((a) => <li key={a.id}><AppointmentCard appt={a} /></li>)}
          </ul>
        )}
      </section>

      <section aria-labelledby="up-h" className="stack">
        <h2 className="section-title" id="up-h">Upcoming</h2>
        {upcoming.length === 0 ? (
          <div className="card empty">
            <IconCalendar size={28} />
            <strong>Nothing upcoming</strong>
            <p className="sublabel">New bookings will appear here.</p>
          </div>
        ) : (
          <ul className="appt-list">
            {upcoming.map((a) => <li key={a.id}><AppointmentCard appt={a} showDate /></li>)}
          </ul>
        )}
      </section>
    </>
  );
}
