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
          {appointment.student && (
            <section className="card" aria-labelledby="stu-h">
              <div className="card-head">
                <h2 className="section-title" id="stu-h">From the request form</h2>
                <span className="sublabel">Entered by the student</span>
              </div>
              <div className="req-ident">
                <div><span className="sublabel">Roll number</span><strong className="mono">{appointment.student.rollNumber}</strong></div>
                <div><span className="sublabel">Branch</span><strong>{appointment.student.branch}</strong></div>
              </div>
            </section>
          )}
          <IdentityCard consent={appointment.consent} identity={identity} />
          <NotesPanel appointmentId={appointment.id} initial={notes} />
        </div>
      </div>
    </>
  );
}
