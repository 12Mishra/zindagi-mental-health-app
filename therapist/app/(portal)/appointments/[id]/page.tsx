import { notFound } from 'next/navigation';
import { BriefCard } from '@/components/BriefCard';
import { IdentityCard } from '@/components/IdentityCard';
import { NotesPanel } from '@/components/NotesPanel';
import { SessionHeader } from '@/components/SessionHeader';
import { getAppointment } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getAppointment(id);
  if (!detail) notFound();
  const { appointment, brief, identity, notes } = detail;

  return (
    <>
      <SessionHeader appt={appointment} />
      <div className="grid-2">
        <BriefCard brief={appointment.consent.brief ? brief : null} />
        <div className="stack">
          <IdentityCard consent={appointment.consent} identity={identity} />
          <NotesPanel initial={notes} />
        </div>
      </div>
    </>
  );
}
