import Link from 'next/link';
import { AvailabilityGrid } from '@/components/AvailabilityGrid';
import { IconCalendar, IconChevronLeft, IconChevronRight } from '@/components/Icons';
import { addDays, currentWeekStart, getSlots, mondayOf } from '@/lib/data';
import { fmtShortDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const valid = week && /^\d{4}-\d{2}-\d{2}$/.test(week) && !Number.isNaN(Date.parse(week));
  const weekStart = valid ? mondayOf(week) : currentWeekStart();
  const slots = await getSlots(weekStart);
  const prev = addDays(weekStart, -7);
  const next = addDays(weekStart, 7);
  const label = `${fmtShortDate(`${weekStart}T12:00:00+05:30`)} – ${fmtShortDate(`${addDays(weekStart, 4)}T12:00:00+05:30`)}`;

  return (
    <>
      <div>
        <h1 className="page-title">Availability</h1>
        <p className="subtitle">Tap a slot to open or remove it. Booked slots are locked.</p>
      </div>
      <section className="card" aria-labelledby="week-h">
        <div className="card-head">
          <h2 className="section-title" id="week-h">Week of {label}</h2>
          <nav className="week-nav" aria-label="Week">
            <Link href={`/availability?week=${prev}`} className="btn secondary small" aria-label="Previous week"><IconChevronLeft size={16} /> Prev</Link>
            <Link href="/availability" className="btn ghost small">This week</Link>
            <Link href={`/availability?week=${next}`} className="btn secondary small" aria-label="Next week">Next <IconChevronRight size={16} /></Link>
          </nav>
        </div>
        {slots.length === 0 ? (
          <div className="empty">
            <IconCalendar size={28} />
            <strong>No slots this week</strong>
          </div>
        ) : (
          <AvailabilityGrid key={weekStart} slots={slots} />
        )}
      </section>
    </>
  );
}
