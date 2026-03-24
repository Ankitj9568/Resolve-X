'use client';
// apps/web/app/admin/command/page.tsx
// Commissioner landing — /admin/command
// Spec: all-dept + risk alerts, no WHERE filter, PII masked, early warnings

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/auth';
import { addWebSocketListener } from '../../../utils/ws';
import SandboxBanner from '../../../components/SandboxBanner';
import type { Complaint, GeoJsonFeature, RiskFeatureProperties } from '../../../utils/types';

const DEMO_MODE = process.env.NEXT_PUBLIC_MODE === 'demo';
const BASE      = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

const RISK_CONFIG = {
  critical: { color: 'bg-red-100 text-red-700 border-red-200',    dot: 'bg-red-500'    },
  high:     { color: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  medium:   { color: 'bg-amber-100 text-amber-700 border-amber-200',   dot: 'bg-amber-400'  },
  low:      { color: 'bg-green-100 text-green-700 border-green-200',   dot: 'bg-green-400'  },
};

type RiskFeature = GeoJsonFeature<RiskFeatureProperties>;

export default function CityCommand() {
  const router          = useRouter();
  const { token, role } = useAuthStore();

  const [complaints, setComplaints]   = useState<Complaint[]>([]);
  const [riskData, setRiskData]       = useState<RiskFeature[]>([]);
  const [warnings, setWarnings]       = useState<RiskFeature[]>([]);
  const [loading, setLoading]         = useState(true);
  const [resetting, setResetting]     = useState(false);
  const [activeTab, setActiveTab]     = useState<'feed'|'risk'|'dept'>('feed');

  useEffect(() => {
    if (!token) { router.replace('/'); return; }
    if (role && role !== 'commissioner') router.replace('/');
  }, [token, role, router]);

  const fetchAll = useCallback(async () => {
    if (!token) return;
    try {
      const [compRes, riskRes] = await Promise.all([
        fetch(`${BASE}/complaints`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${BASE}/gis/risk-heatmap`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const compData = await compRes.json();
      const riskJson = await riskRes.json();
      setComplaints(compData.complaints ?? []);

      const features: RiskFeature[] = riskJson.features ?? [];
      setRiskData(features);
      setWarnings(features.filter((f) => {
        const tier = f.properties?.risk_tier;
        return tier === 'high' || tier === 'critical';
      }));
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }, [token]);

  const handleDemoReset = useCallback(async () => {
    if (!token) return;
    setResetting(true);
    try {
      await fetch(`${BASE}/admin/demo/reset`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchAll();
    } catch { /* non-fatal */ } finally { setResetting(false); }
  }, [fetchAll, token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const remove = addWebSocketListener((event) => {
      if (event.type === 'complaint.status_updated') {
        const newStatus = event.new_status;
        if (!newStatus) return;
        setComplaints(prev => prev.map(c =>
          c.id === event.complaint_id ? { ...c, status: newStatus } : c
        ));
      }
      if (event.type === 'sla.escalation') fetchAll();
      if (event.type === 'demo.reset') fetchAll();
    });
    return remove;
  }, [fetchAll]);

  // Ctrl+Shift+R demo reset
  useEffect(() => {
    if (!DEMO_MODE) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        if (confirm('Reset demo map? This wipes all visitor complaints and restores seed data.')) {
          handleDemoReset();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleDemoReset]);

  // City-wide KPIs
  const total     = complaints.length;
  const active    = complaints.filter(c => !['resolved','closed'].includes(c.status)).length;
  const escalated = complaints.filter(c => c.status === 'escalated').length;
  const resolved  = complaints.filter(c => c.status === 'resolved').length;
  const slaRate   = total ? Math.round((resolved / total) * 100) : 0;

  // Dept breakdown
  const deptBreakdown: Record<string, number> = {};
  complaints.forEach(c => {
    const d = c.dept_id ?? 'Unassigned';
    deptBreakdown[d] = (deptBreakdown[d] ?? 0) + 1;
  });

  const tabs = ['feed', 'risk', 'dept'] as const;

  return (
    <main className="min-h-screen bg-gray-50">
      <SandboxBanner demoMode={DEMO_MODE} />

      <div className="bg-white border-b border-gray-100 px-4 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400">Commissioner · City command</p>
          <h1 className="text-lg font-semibold text-gray-900">ResolveX Command</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/map" className="text-xs text-indigo-500 hover:underline">Live map →</Link>
          {DEMO_MODE && (
            <button
              onClick={handleDemoReset}
              disabled={resetting}
              className="text-xs px-3 py-1.5 bg-red-500 text-white rounded-lg
                         hover:bg-red-600 disabled:opacity-50 transition-colors"
            >
              {resetting ? 'Resetting…' : 'Reset demo'}
            </button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Early warnings */}
        {warnings.length > 0 && (
          <div className="space-y-2">
            {warnings.map((w, i: number) => {
              const tier = w.properties?.risk_tier ?? 'high';
              const cfg  = RISK_CONFIG[tier as keyof typeof RISK_CONFIG] ?? RISK_CONFIG.high;
              return (
                <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${cfg.color}`}>
                  <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${cfg.dot}`} />
                  <div>
                    <p className="text-sm font-semibold">{w.properties?.name ?? 'Ward'}</p>
                    <p className="text-xs opacity-80">{w.properties?.risk_label ?? `${tier} risk`}</p>
                  </div>
                  <span className="ml-auto text-xs font-semibold uppercase opacity-70">{tier}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* City KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total',       value: total,     color: 'text-gray-700' },
            { label: 'Active',      value: active,    color: 'text-indigo-600' },
            { label: 'Escalated',   value: escalated, color: escalated > 0 ? 'text-red-600' : 'text-gray-400' },
            { label: 'SLA rate',    value: `${slaRate}%`, color: slaRate >= 80 ? 'text-green-600' : 'text-amber-600' },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white rounded-xl p-4 border border-gray-100 text-center">
              <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
              <p className="text-xs text-gray-400 mt-1">{kpi.label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {tabs.map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`flex-1 py-2 text-xs font-medium rounded-lg capitalize transition-colors
                ${activeTab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t === 'feed' ? 'Live feed' : t === 'risk' ? 'Risk zones' : 'Dept breakdown'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'feed' && (
          <div className="space-y-2">
            {loading ? (
              [1,2,3].map(i => <div key={i} className="h-16 bg-white rounded-xl animate-pulse" />)
            ) : complaints.slice(0, 30).map(c => (
              <div key={c.id}
                onClick={() => router.push(`/track/${c.id}`)}
                className="bg-white rounded-xl px-4 py-3 border border-gray-100
                           flex items-center justify-between cursor-pointer
                           hover:border-indigo-200 transition-colors">
                <div>
                  <span className="text-sm font-medium text-gray-800">{c.category}</span>
                  <span className="text-xs text-gray-400 ml-2">{c.ward_id ?? '—'}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                  ${c.status === 'escalated' ? 'bg-red-100 text-red-700' :
                    c.status === 'resolved'  ? 'bg-green-100 text-green-700' :
                    'bg-gray-100 text-gray-600'}`}>
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'risk' && (
          <div className="space-y-2">
            {riskData.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No risk data available</p>
            ) : riskData.map((f, i: number) => {
              const tier  = f.properties?.risk_tier ?? 'low';
              const score = f.properties?.risk_score ?? 0;
              const cfg   = RISK_CONFIG[tier as keyof typeof RISK_CONFIG] ?? RISK_CONFIG.low;
              return (
                <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${cfg.color}`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{f.properties?.name ?? `Zone ${i + 1}`}</p>
                    {f.properties?.risk_label && (
                      <p className="text-xs opacity-70">{f.properties.risk_label}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{Math.round(score * 100)}%</p>
                    <p className="text-xs opacity-60 uppercase">{tier}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'dept' && (
          <div className="space-y-2">
            {Object.entries(deptBreakdown).map(([dept, count]) => {
              const pct = total ? Math.round((count / total) * 100) : 0;
              return (
                <div key={dept} className="bg-white rounded-xl px-4 py-3 border border-gray-100">
                  <div className="flex justify-between mb-1.5">
                    <span className="text-sm font-medium text-gray-800 truncate">{dept}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{count} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {DEMO_MODE && (
          <p className="text-xs text-center text-gray-400">
            Ctrl+Shift+R to reset demo map
          </p>
        )}
      </div>
    </main>
  );
}
