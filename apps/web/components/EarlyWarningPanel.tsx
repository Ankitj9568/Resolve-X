'use client';
// apps/web/components/EarlyWarningPanel.tsx
// Live early-warning panel — fetches alerts from the Risk Scoring service.
// Auto-refreshes every 60 seconds. Gracefully hides when service is offline.

import { useEffect, useState, useCallback } from 'react';
import { getRiskAlerts } from '../utils/api';
import type { RiskAlert } from '../utils/types';

const RISK_STYLES: Record<string, { bg: string; dot: string; border: string }> = {
  Critical: { bg: 'bg-red-50',    dot: 'bg-red-500',    border: 'border-red-200'    },
  High:     { bg: 'bg-orange-50', dot: 'bg-orange-400', border: 'border-orange-200' },
  Medium:   { bg: 'bg-amber-50',  dot: 'bg-amber-400',  border: 'border-amber-200'  },
  Low:      { bg: 'bg-green-50',  dot: 'bg-green-400',  border: 'border-green-200'  },
};

const REFRESH_MS = 60_000;

export default function EarlyWarningPanel() {
  const [alerts, setAlerts]   = useState<RiskAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      setError(false);
      const data = await getRiskAlerts();
      // Only show High + Critical
      const urgent = (data.alerts ?? []).filter(
        (a) => a.risk_level === 'High' || a.risk_level === 'Critical',
      );
      setAlerts(urgent);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const interval = window.setInterval(fetchAlerts, REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [fetchAlerts]);

  // Don't render if loading, errored, or no alerts
  if (loading || error || alerts.length === 0) return null;

  return (
    <aside className="mb-4 rounded-xl overflow-hidden border border-yellow-200 bg-yellow-50">
      <div className="px-4 py-2.5 bg-yellow-100 border-b border-yellow-200 flex items-center gap-2">
        <span className="text-sm">⚠️</span>
        <h3 className="text-xs font-bold text-yellow-900 uppercase tracking-wider">
          Early Warnings
        </h3>
        <span className="ml-auto text-[10px] text-yellow-700 font-medium">
          {alerts.length} active
        </span>
      </div>
      <ul className="divide-y divide-yellow-100">
        {alerts.map((alert, i) => {
          const style = RISK_STYLES[alert.risk_level] ?? RISK_STYLES.High;
          return (
            <li
              key={i}
              className={`flex items-start gap-3 px-4 py-3 ${style.bg} border-l-4 ${style.border}`}
            >
              <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${style.dot}`} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-yellow-900">{alert.ward_id}</span>
                <p className="text-xs text-yellow-800 mt-0.5 leading-relaxed">{alert.alert_text}</p>
              </div>
              <span className="text-[10px] font-bold text-yellow-700 uppercase flex-shrink-0 mt-1">
                {alert.risk_level}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}