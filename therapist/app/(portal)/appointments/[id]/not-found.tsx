import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card empty">
      <strong>Appointment not found</strong>
      <Link href="/" className="btn secondary small">Back to Today</Link>
    </div>
  );
}
