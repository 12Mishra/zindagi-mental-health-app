import { getAlerts } from '@/lib/data';
import { AlertsBoard } from '@/components/AlertsBoard';

export const metadata = { title: 'Alerts · Zindagi Admin' };

export default async function AlertsPage() {
  const { alerts, therapists, asOf } = await getAlerts();
  return <AlertsBoard initial={alerts} therapists={therapists} asOf={asOf} />;
}
