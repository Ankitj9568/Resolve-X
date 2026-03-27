'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/auth';
import { getComplaints, updateStatus, getRiskAlerts } from '../../../utils/api';
import { addWebSocketListener } from '../../../utils/ws';
import SandboxBanner from '../../../components/SandboxBanner';
import type { Complaint, RiskAlert } from '../../../utils/types';

const DEMO_MODE = process.env.NEXT_PUBLIC_MODE === 'demo';

const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-slate-800 text-[var(--grey-text-light)] border border-slate-700',
  assigned:    'bg-blue-950 text-blue-300 border border-blue-800',
  in_progress: 'bg-blue-900/60 text-blue-300 border border-blue-700',
  escalated:   'bg-red-950 text-red-300 border border-red-800',
  resolved:    'bg-emerald-950 text-emerald-300 border border-emerald-800',
  closed:      'bg-slate-800 text-[var(--grey-text-dark)] border border-slate-700',
};

const RISK_LEVEL_STYLES: Record<string, { bar: string; badge: string; icon: string }> = {
  Critical: { bar: 'bg-red-500',    badge: 'bg-red-500/10 text-red-400 border border-red-500/20',    icon: '🔴' },
  High:     { bar: 'bg-orange-400', badge: 'bg-orange-500/10 text-orange-400 border border-orange-500/20', icon: '🟠' },
  Medium:   { bar: 'bg-amber-400',  badge: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',   icon: '🟡' },
  Low:      { bar: 'bg-green-400',  badge: 'bg-green-500/10 text-green-400 border border-green-500/20',   icon: '🟢' },
};


function SLABar({ slaDeadline, createdAt, now }: { slaDeadline: string; createdAt: string; now: number }) {
  const total   = new Date(slaDeadline).getTime() - new Date(createdAt).getTime();
  const elapsed = now - new Date(createdAt).getTime();
  const pct     = Math.min(100, Math.round((elapsed / total) * 100));
  const color   = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-green-400';
  const remaining = new Date(slaDeadline).getTime() - now;
  const h = Math.max(0, Math.floor(remaining / 3600000));
  const m = Math.max(0, Math.floor((remaining % 3600000) / 60000));
  const label = pct >= 100 ? 'Overdue' : `${h}h ${m}m`;

  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-[var(--grey-text-dark)] mb-1">
        <span>SLA</span>
        <span className={pct >= 100 ? 'text-red-600 font-medium' : ''}>{label}</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Integration 5: Intelligence Feed panel ────────────────────────────────────

function IntelligenceFeed() {
  const [alerts, setAlerts]   = useState<RiskAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      setError(false);
      const data = await getRiskAlerts();
      setAlerts(data?.alerts ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    // Refresh every 60s — alerts update with each DBSCAN run
    const interval = window.setInterval(fetchAlerts, 60000);
    return () => window.clearInterval(interval);
  }, [fetchAlerts]);

  if (loading) {
    return (
      <div className="rounded-3xl border border-white/5 bg-[var(--secondary-dark)] shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-6 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-base">🧠</span>
          <h3 className="text-sm font-semibold text-white">Intelligence Feed</h3>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 rounded-xl bg-white/5 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || alerts.length === 0) {
    return (
      <div className="rounded-3xl border border-white/5 bg-[var(--secondary-dark)] shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-6 mb-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">🧠</span>
          <h3 className="text-sm font-semibold text-white">Intelligence Feed</h3>
          <span className="ml-auto text-xs text-[var(--grey-text-dark)] px-2 py-0.5 rounded-full border border-white/5">
            {error ? 'Service offline' : 'All clear'}
          </span>
        </div>
        <p className="text-xs text-[var(--grey-text-dark)]">
          {error
            ? 'Risk service is currently unavailable.'
            : 'No active alerts. City infrastructure is operating normally.'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/5 bg-[var(--secondary-dark)] shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-6 mb-8">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-base">🧠</span>
        <h3 className="text-sm font-semibold text-white">Intelligence Feed</h3>
        <span className="ml-auto text-xs text-[var(--grey-text-dark)]">
          {alerts.length} active alert{alerts.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-3">
        {alerts.map((alert, i) => {
          const style = RISK_LEVEL_STYLES[alert.risk_level] ?? RISK_LEVEL_STYLES.Low;
          return (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/5
                         hover:bg-white/[0.05] transition-colors"
            >
              <span className="text-lg flex-shrink-0 mt-0.5">{style.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-semibold text-white">{alert.ward_id}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${style.badge}`}>
                    {alert.risk_level}
                  </span>
                  <span className="text-[10px] text-[var(--grey-text-dark)] ml-auto">
                    {alert.complaint_count} complaint{alert.complaint_count !== 1 ? 's' : ''}
                  </span>
                </div>
                <p className="text-xs text-[var(--grey-text-light)] leading-relaxed line-clamp-2">
                  {alert.alert_text}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={fetchAlerts}
        className="mt-4 w-full text-xs text-[var(--grey-text-dark)] hover:text-white transition-colors py-1"
      >
        Refresh ↻
      </button>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router              = useRouter();
  const { token, role }     = useAuthStore();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [filter, setFilter]         = useState('all');
  const [loading, setLoading]       = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [now, setNow]               = useState(() => Date.now());

  useEffect(() => {
    if (role && !['officer', 'dept_head', 'commissioner'].includes(role)) {
      router.replace('/');
    }
  }, [role, router]);

  const fetchComplaints = useCallback(async () => {
    if (!token) return;
    try {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const data = await getComplaints(token, params);
      const sorted = (data.complaints ?? []).sort((a, b) => {
        const aTime = new Date(a.sla_deadline ?? 0).getTime();
        const bTime = new Date(b.sla_deadline ?? 0).getTime();
        return aTime - bTime;
      });
      setComplaints(sorted);
    } catch (err) {
      console.error('Failed to fetch complaints', err);
    } finally {
      setLoading(false);
    }
  }, [token, filter]);

  useEffect(() => { fetchComplaints(); }, [fetchComplaints]);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const remove = addWebSocketListener((event) => {
      if (event.type === 'complaint.status_updated') {
        const newStatus = event.new_status;
        if (!newStatus) return;
        setComplaints(prev =>
          prev.map(c => c.id === event.complaint_id ? { ...c, status: newStatus } : c)
        );
      }
      if (event.type === 'sla.escalation') {
        setComplaints(prev =>
          prev.map(c => c.id === event.complaint_id ? { ...c, status: 'escalated' } : c)
        );
      }
      if (event.type === 'demo.reset') {
        fetchComplaints();
      }
    });
    return remove;
  }, [fetchComplaints]);

  const handleAction = async (complaintId: string, status: string) => {
    if (!token) return;
    setActionLoading(complaintId + status);
    try {
      await updateStatus(complaintId, status, token);
      setComplaints(prev =>
        prev.map(c => c.id === complaintId ? { ...c, status } : c)
      );
    } catch { /* non-fatal */ } finally {
      setActionLoading(null);
    }
  };

  const filters = ['all', 'pending', 'assigned', 'in_progress', 'escalated'];

  return (
    <main className="min-h-screen text-white bg-[var(--main-dark-bg)] w-full relative overflow-hidden">
      <SandboxBanner demoMode={DEMO_MODE} />

      {/* Ambient Mesh Gradient */}
      <div className="absolute inset-x-0 top-[-10%] h-[800px] w-full pointer-events-none opacity-40 z-0 flex justify-center">
        <div className="absolute top-0 right-[15%] w-[600px] h-[600px] rounded-full bg-[var(--purple)] blur-[120px] mix-blend-screen opacity-50" />
        <div className="absolute top-[10%] left-[10%] w-[500px] h-[500px] rounded-full bg-[var(--blue)] blur-[100px] mix-blend-screen opacity-40" />
        <div className="absolute top-[30%] left-[40%] w-[400px] h-[400px] rounded-full bg-[var(--pink)] blur-[120px] mix-blend-screen opacity-30" />
        <div className="absolute top-[-5%] left-[30%] w-[400px] h-[400px] rounded-full bg-[var(--orange)] blur-[100px] mix-blend-screen opacity-20" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 pt-10 pb-16 w-full">
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="ResolveX" className="w-10 h-10 object-contain drop-shadow-sm" />
            <div>
              <h2 className="text-2xl font-extrabold text-white tracking-tight" style={{ letterSpacing: '-0.02vw' }}>Live complaint feed</h2>
              <span className="text-sm text-[var(--grey-text-dark)]">{complaints.length} active requests</span>
            </div>
          </div>
        </div>

        {/* ── Integration 5: Intelligence Feed (commissioner only) ────────── */}
        {role === 'commissioner' && <IntelligenceFeed />}

        {/* Filter pills */}
        <div className="flex gap-2 mb-8 flex-wrap">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize transition-all duration-200
                ${filter === f
                  ? 'bg-white/10 text-white border border-white/20 shadow-sm'
                  : 'bg-transparent text-[var(--grey-text-dark)] hover:text-white border border-transparent hover:border-white/5 hover:bg-white/5'
                }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Complaint cards */}
        {loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => (
              <div key={i} className="rounded-3xl border border-white/5 bg-[var(--secondary-dark)] shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-6 animate-pulse h-32" />
            ))}
          </div>
        ) : complaints.length === 0 ? (
          <div className="rounded-3xl border border-white/5 bg-[var(--secondary-dark)] shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-12 text-center text-[var(--grey-text-dark)] text-sm font-medium">
            No complaints require your attention right now.
          </div>
        ) : (
          <div className="space-y-4">
            {complaints.map(c => (
              <div key={c.id} className="rounded-3xl border border-white/5 bg-[var(--secondary-dark)] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.4)] p-6
                hover:shadow-lg hover:-translate-y-1 hover:border-white/10 transition-all duration-300 ease-out">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="font-semibold text-white tracking-tight text-lg">{c.category}</span>
                      {c.ward_id && (
                        <span className="text-xs text-[var(--grey-text-dark)] px-2 py-0.5 rounded border border-white/5">
                          {c.ward_id}
                        </span>
                      )}
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase ${STATUS_COLORS[c.status] ?? ''}`}>
                        {c.status.replace('_', ' ')}
                      </span>
                    </div>
                    {c.description && (
                      <p className="text-sm text-[var(--grey-text-light)] leading-relaxed line-clamp-2">{c.description}</p>
                    )}
                    {c.sla_deadline && c.created_at && (
                      <div className="mt-4">
                        <SLABar slaDeadline={c.sla_deadline} createdAt={c.created_at} now={now} />
                      </div>
                    )}
                  </div>

                  {['officer', 'dept_head'].includes(role ?? '') && (
                    <div className="flex flex-row md:flex-col gap-2 flex-shrink-0 mt-4 md:mt-0">
                      <button
                        onClick={() => handleAction(c.id, 'in_progress')}
                        disabled={!!actionLoading || c.status === 'in_progress'}
                        className="px-4 py-2 text-xs bg-[var(--blue)] text-white rounded-full
                                   hover:bg-[var(--navy)] disabled:opacity-40 transition-colors font-semibold shadow-[0_0_15px_rgba(28,78,255,0.4)]"
                      >
                        Start task
                      </button>
                      <button
                        onClick={() => handleAction(c.id, 'resolved')}
                        disabled={!!actionLoading}
                        className="px-4 py-2 text-xs bg-emerald-950 text-emerald-400 border border-emerald-900/50 rounded-full
                                   hover:bg-emerald-900 disabled:opacity-40 transition-colors font-semibold"
                      >
                        Resolve
                      </button>
                      <Link
                        href="/admin/map"
                        className="px-4 py-2 text-xs bg-white/5 text-[var(--grey-text-light)] border border-white/5 rounded-full
                                   hover:bg-white/10 transition-colors font-semibold text-center"
                      >
                        Map
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}