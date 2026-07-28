import { getPlanningData } from '@/lib/actions/planning';
import PlanningClient from './PlanningClient';

function currentMondayISO(): string {
  const now = new Date();
  const dow = now.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(monday.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString();
}

export default async function PlanningPage() {
  const weekISO = currentMondayISO();
  const data = await getPlanningData(weekISO);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 20 }}>Планирование</div>
      <PlanningClient initialData={data as any} initialWeek={weekISO} />
    </div>
  );
}
