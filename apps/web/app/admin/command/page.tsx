'use client';
// apps/web/app/admin/command/page.tsx
// Commissioner landing — /admin/command
// Spec: all-dept + risk alerts, no WHERE filter, PII masked, early warnings

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/auth';
import { getComplaints, getRiskZones, getRiskAlerts } from '../../../utils/api';
import { addWebSocketListener } from '../../../utils/ws';
import SandboxBanner from '../../../components/SandboxBanner';
import type { Complaint, RiskZone, RiskAlert } from '../../../utils/types';

const DEMO_MODE = process.env.NEXT_PUBLIC_MODE === 'demo';
const BASE      = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

const RISK_CONFIG: Record<string, { color: string; dot: string }> = {
  Critical: { color: 'bg-red-100 text-red-700 border-red-200',    dot: 'bg-red-500'    },
  High:     { color: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  Medium:   { color: 'bg-amber-100 text-amber-700 border-amber-200',   dot: 'bg-amber-400'  },
  Low:      { color: 'bg-green-100 text-green-700 border-green-200',   dot: 'bg-green-400'  },
};

export default function CityCommand() {
  const router          = useRouter();
  const { token, role } = useAuthStore();

  const [complaints, setComplaints]   = useState<Complaint[]>([]);
  const [riskZones, setRiskZones]     = useState<RiskZone[]>([]);
  const [alerts, setAlerts]           = useState<RiskAlert[]>([]);
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
      // Fetch complaints from main API + risk data from risk service in parallel
      const [compRes, zonesRes, alertsRes] = await Promise.allSettled([
        fetch(`${BASE}/complaints`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        getRiskZones(),
        getRiskAlerts(),
      ]);

      if (compRes.status === 'fulfilled') {
        setComplaints(compRes.value.complaints ?? []);
      }
      if (zonesRes.status === 'fulfilled') {
        setRiskZones(zonesRes.value.zones ?? []);
      }
      if (alertsRes.status === 'fulfilled') {
        setAlerts(alertsRes.value.alerts ?? []);
      }
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
    <main className="min-h-screen text-white bg-[var(--main-dark-bg)] w-full">
      <SandboxBanner demoMode={DEMO_MODE} />

      <div className="border-b border-white/[0.06] backdrop-blur-md px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="ResolveX" className="drop-shadow-sm" style={{ width: 44, height: 44, objectFit: 'contain' }} />
          <div>
            <p className="text-xs text-[var(--grey-text-dark)]">Commissioner · City command</p>
            <h1 className="text-lg font-semibold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">ResolveX Command</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/map" className="text-xs text-[var(--blue)] hover:text-white hover:underline transition-colors">Live map →</Link>
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

        {/* Early warnings from risk service */}
        {alerts.filter(a => a.risk_level === 'High' || a.risk_level === 'Critical').length > 0 && (
          <div className="space-y-2">
            {alerts
              .filter(a => a.risk_level === 'High' || a.risk_level === 'Critical')
              .map((alert, i: number) => {
                const cfg = RISK_CONFIG[alert.risk_level] ?? RISK_CONFIG.Medium;
                return (
                  <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${cfg.color}`}>
                    <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${cfg.dot}`} />
                    <div>
                      <p className="text-sm font-semibold">{alert.ward_id}</p>
                      <p className="text-xs opacity-80">{alert.alert_text}</p>
                    </div>
                    <span className="ml-auto text-xs font-semibold uppercase opacity-70">{alert.risk_level}</span>
                  </div>
                );
              })}
          </div>
        )}

        {/* City KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total',       value: total,     color: 'text-[var(--grey-text-light)]' },
            { label: 'Active',      value: active,    color: 'text-blue-800' },
            { label: 'Escalated',   value: escalated, color: escalated > 0 ? 'text-red-600' : 'text-[var(--grey-text-dark)]' },
            { label: 'SLA rate',    value: `${slaRate}%`, color: slaRate >= 80 ? 'text-green-600' : 'text-amber-600' },
          ].map(kpi => (
            <div key={kpi.label} className="bg-[#0f1629] rounded-2xl p-5 border border-white/[0.06] shadow-sm text-center">
              <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
              <p className="text-xs text-[var(--grey-text-dark)] mt-1">{kpi.label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {tabs.map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`flex-1 py-2 text-xs font-medium rounded-lg capitalize transition-colors
                ${activeTab === t ? 'bg-[#0f1629] text-white shadow-sm' : 'text-[var(--grey-text-dark)] hover:text-[var(--grey-text-light)]'}`}>
              {t === 'feed' ? 'Live feed' : t === 'risk' ? 'Risk zones' : 'Dept breakdown'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'feed' && (
          <div className="space-y-2">
            {loading ? (
              [1,2,3].map(i => <div key={i} className="h-16 rounded-xl border-white/5 bg-[var(--secondary-dark)] animate-pulse" />)
            ) : complaints.slice(0, 30).map(c => (
              <div key={c.id}
                onClick={() => router.push(`/track/${c.id}`)}
                className="rounded-2xl border border-white/5 bg-[var(--secondary-dark)] shadow-[0_8px_32px_rgba(0,0,0,0.5)]  px-4 py-3 border border-white/[0.06]
                           shadow-sm flex items-center justify-between cursor-pointer
                           hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                <div>
                  <span className="text-sm font-medium text-slate-800">{c.category}</span>
                  <span className="text-xs text-[var(--grey-text-dark)] ml-2">{c.ward_id ?? '—'}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                  ${c.status === 'escalated' ? 'bg-red-100 text-red-700' :
                    c.status === 'resolved'  ? 'bg-green-100 text-green-700' :
                    'bg-slate-800 text-[var(--grey-text-light)] border border-slate-700'}`}>
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'risk' && (
          <div className="space-y-2">
            {riskZones.length === 0 ? (
              <p className="text-sm text-[var(--grey-text-dark)] text-center py-8">No risk data available</p>
            ) : riskZones.map((zone, i: number) => {
              const cfg = RISK_CONFIG[zone.risk_level] ?? RISK_CONFIG.Low;
              return (
                <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${cfg.color}`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{zone.ward_id}</p>
                    <p className="text-xs opacity-70">
                      Radius: {Math.round(zone.radius_m)}m · Risk score: {zone.risk_score}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{zone.risk_score}%</p>
                    <p className="text-xs opacity-60 uppercase">{zone.risk_level}</p>
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
                <div key={dept} className="rounded-2xl border border-white/5 bg-[var(--secondary-dark)] shadow-[0_8px_32px_rgba(0,0,0,0.5)]  px-4 py-3 border border-white/[0.06]">
                  <div className="flex justify-between mb-1.5">
                    <span className="text-sm font-medium text-slate-800 truncate">{dept}</span>
                    <span className="text-xs text-[var(--grey-text-dark)] flex-shrink-0">{count} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {DEMO_MODE && (
          <p className="text-xs text-center text-[var(--grey-text-dark)]">
            Ctrl+Shift+R to reset demo map
          </p>
        )}
      </div>
    </main>
  );
}
