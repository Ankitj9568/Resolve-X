'use client';
// apps/web/app/admin/dept/page.tsx
// Dept Head landing — /admin/dept
// Spec: workload per officer + dept SLA compliance + all dept tasks

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/auth';
import { addWebSocketListener } from '../../../utils/ws';
import SandboxBanner from '../../../components/SandboxBanner';
import type { Complaint } from '../../../utils/types';

const DEMO_MODE = process.env.NEXT_PUBLIC_MODE === 'demo';
const BASE      = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-700',
  assigned:    'bg-blue-100 text-blue-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  escalated:   'bg-red-100 text-red-700',
  resolved:    'bg-green-100 text-green-700',
  closed:      'bg-gray-200 text-gray-500',
};

export default function DeptOverview() {
  const router              = useRouter();
  const { token, role }     = useAuthStore();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading]       = useState(true);
  const [now, setNow]               = useState(() => Date.now());

  useEffect(() => {
    if (!token) { router.replace('/'); return; }
    if (role && !['dept_head', 'commissioner'].includes(role)) router.replace('/');
  }, [token, role, router]);

  const fetchComplaints = useCallback(async () => {
    if (!token) return;
    try {
      const res  = await fetch(`${BASE}/complaints`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setComplaints(data.complaints ?? []);
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchComplaints(); }, [fetchComplaints]);

  useEffect(() => {
    const remove = addWebSocketListener((event) => {
      if (event.type === 'complaint.status_updated') {
        const newStatus = event.new_status;
        if (!newStatus) return;
        setComplaints(prev => prev.map(c =>
          c.id === event.complaint_id ? { ...c, status: newStatus } : c
        ));
      }
    });
    return remove;
  }, []);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  // Derive workload per officer
  const workload: Record<string, { name: string; open: number; resolved: number }> = {};
  complaints.forEach(c => {
    if (!c.assigned_to) return;
    if (!workload[c.assigned_to]) {
      workload[c.assigned_to] = { name: c.officer_name || c.assigned_to.slice(0, 8), open: 0, resolved: 0 };
    }
    if (c.status === 'resolved' || c.status === 'closed') workload[c.assigned_to].resolved++;
    else workload[c.assigned_to].open++;
  });

  // SLA compliance
  const active   = complaints.filter(c => !['resolved','closed'].includes(c.status));
  const overdue  = active.filter(c => c.sla_deadline && new Date(c.sla_deadline).getTime() < now);
  const slaRate  = active.length ? Math.round(((active.length - overdue.length) / active.length) * 100) : 100;
  const slaColor = slaRate >= 80 ? 'text-green-600' : slaRate >= 60 ? 'text-amber-600' : 'text-red-600';

  const escalated = complaints.filter(c => c.status === 'escalated').length;

  return (
    <main className="min-h-screen bg-gray-50">
      <SandboxBanner demoMode={DEMO_MODE} />
      <div className="bg-white border-b border-gray-100 px-4 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400">Department head</p>
          <h1 className="text-lg font-semibold text-gray-900">Dept overview</h1>
        </div>
        <Link href="/admin/map" className="text-xs text-indigo-500 hover:underline">View map →</Link>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'SLA compliance', value: `${slaRate}%`, color: slaColor },
            { label: 'Active',         value: active.length,   color: 'text-indigo-600' },
            { label: 'Escalated',      value: escalated,        color: escalated > 0 ? 'text-red-600' : 'text-gray-600' },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white rounded-xl p-4 border border-gray-100 text-center">
              <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
              <p className="text-xs text-gray-400 mt-1">{kpi.label}</p>
            </div>
          ))}
        </div>

        {/* Officer workload */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Officer workload</h2>
          </div>
          {Object.keys(workload).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No assignments yet</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {Object.entries(workload).map(([id, w]) => {
                const total = w.open + w.resolved;
                const pct   = total ? Math.round((w.resolved / total) * 100) : 0;
                return (
                  <div key={id} className="px-4 py-3 flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center
                                    justify-center text-indigo-700 text-xs font-bold flex-shrink-0">
                      {w.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between mb-1">
                        <span className="text-sm font-medium text-gray-800 truncate">{w.name}</span>
                        <span className="text-xs text-gray-400">{w.open} open · {w.resolved} done</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-green-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Complaint feed */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">All dept complaints</h2>
            <span className="text-xs text-gray-400">{complaints.length} total</span>
          </div>
          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-white rounded-xl animate-pulse" />)}</div>
          ) : (
            <div className="space-y-2">
              {complaints.slice(0, 20).map(c => (
                <div key={c.id}
                  onClick={() => router.push(`/track/${c.id}`)}
                  className="bg-white rounded-xl px-4 py-3 border border-gray-100
                             flex items-center justify-between cursor-pointer
                             hover:border-indigo-200 transition-colors">
                  <div>
                    <span className="text-sm font-medium text-gray-800">{c.category}</span>
                    {c.ward_id && <span className="text-xs text-gray-400 ml-2">{c.ward_id}</span>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[c.status] ?? ''}`}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
