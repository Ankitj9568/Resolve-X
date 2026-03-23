'use client';
// apps/web/components/SLAComplianceDashboard.tsx

const SLA_HOURS = 72;

interface Complaint {
  id: string;
  category: string;
  status: string;
  created_at: string;
  sla_deadline?: string;
}

interface Props {
  complaints?: Complaint[];
}

export default function SLAComplianceDashboard({ complaints = [] }: Props) {
  const now = new Date();

  const overdue = complaints.filter((c) => {
    if (c.status === 'resolved' || c.status === 'closed') return false;
    const created = new Date(c.created_at);
    const elapsed = (now.getTime() - created.getTime()) / 3_600_000;
    return elapsed > SLA_HOURS;
  });

  const complianceRate = complaints.length
    ? ((complaints.length - overdue.length) / complaints.length) * 100
    : 100;

  return (
    <section className="mb-6 p-4 border rounded-xl bg-blue-50">
      <h3 className="font-bold text-blue-800 mb-2">SLA Compliance</h3>
      <div className="mb-2 text-sm">
        Compliance rate:{' '}
        <span className="font-semibold">{complianceRate.toFixed(1)}%</span>
      </div>
      <div className="mb-2 text-sm">
        Overdue complaints:{' '}
        <span className="font-semibold text-red-600">{overdue.length}</span>
      </div>

      {overdue.length > 0 && (
        <ul className="list-disc ml-6 text-sm">
          {overdue.map((c) => (
            <li key={c.id}>
              {c.category} — {c.status} (Filed:{' '}
              {new Date(c.created_at).toLocaleDateString('en-IN')})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}