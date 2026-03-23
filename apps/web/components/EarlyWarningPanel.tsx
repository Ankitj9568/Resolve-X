'use client';
// apps/web/components/EarlyWarningPanel.tsx

interface Warning {
  label: string;
  message: string;
}

interface Props {
  warnings?: Warning[];
}

export default function EarlyWarningPanel({ warnings = [] }: Props) {
  if (!warnings.length) return null;
  return (
    <aside className="mb-4 p-3 border-l-4 border-yellow-400 bg-yellow-50 rounded-r-xl">
      <h3 className="font-bold text-yellow-800 mb-2">Early Warnings</h3>
      <ul>
        {warnings.map((w, i) => (
          <li key={i} className="mb-1 text-sm">
            <span className="font-semibold text-yellow-900">{w.label}:</span>{' '}
            <span className="text-yellow-800">{w.message}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}