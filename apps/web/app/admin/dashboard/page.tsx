'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter }            from 'next/navigation';
import { useAuthStore }         from '../../../store/auth';
import { getComplaints, updateStatus } from '../../../utils/api';
import { addWebSocketListener } from '../../../utils/ws';
import SandboxBanner            from '../../../components/SandboxBanner';
import type { Complaint } from '../../../utils/types';

const DEMO_MODE = process.env.NEXT_PUBLIC_MODE === 'demo';

const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-700',
  assigned:    'bg-blue-100 text-blue-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  escalated:   'bg-red-100 text-red-700',
  resolved:    'bg-green-100 text-green-700',
  closed:      'bg-gray-200 text-gray-600',
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
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>SLA</span>
        <span className={pct >= 100 ? 'text-red-600 font-medium' : ''}>{label}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const router              = useRouter();
  const { token, role }     = useAuthStore();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [filter, setFilter]         = useState('all');
  const [loading, setLoading]       = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [now, setNow]               = useState(() => Date.now());

  // Redirect if not staff
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
      // Sort by SLA urgency — most critical first
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

  // WebSocket — update specific complaint in place on status change
  useEffect(() => {
    const remove = addWebSocketListener((event) => {
      if (event.type === 'complaint.status_updated') {
        const newStatus = event.new_status;
        if (!newStatus) return;
        setComplaints(prev =>
          prev.map(c =>
            c.id === event.complaint_id ? { ...c, status: newStatus } : c
          )
        );
      }
      if (event.type === 'sla.escalation') {
        setComplaints(prev =>
          prev.map(c =>
            c.id === event.complaint_id ? { ...c, status: 'escalated' } : c
          )
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
    <main className="min-h-screen bg-gray-50">
      <SandboxBanner demoMode={DEMO_MODE} />

      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Live complaint feed</h2>
          <span className="text-sm text-gray-400">{complaints.length} active</span>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors
                ${filter === f
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-indigo-300'
                }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Complaint cards */}
        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="bg-white rounded-xl p-4 animate-pulse h-28" />
            ))}
          </div>
        ) : complaints.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center text-gray-400 text-sm">
            No complaints
          </div>
        ) : (
          <div className="space-y-3">
            {complaints.map(c => (
              <div key={c.id} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-medium text-gray-900 text-sm">{c.category}</span>
                      {c.ward_id && (
                        <span className="text-xs text-gray-400">{c.ward_id}</span>
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? ''}`}>
                        {c.status}
                      </span>
                    </div>
                    {c.description && (
                      <p className="text-xs text-gray-500 truncate">{c.description}</p>
                    )}
                    {c.sla_deadline && c.created_at && (
                      <SLABar slaDeadline={c.sla_deadline} createdAt={c.created_at} now={now} />
                    )}
                  </div>

                  {/* Action buttons */}
                  {['officer', 'dept_head'].includes(role ?? '') && (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleAction(c.id, 'in_progress')}
                        disabled={!!actionLoading || c.status === 'in_progress'}
                        className="px-2.5 py-1.5 text-xs bg-indigo-50 text-indigo-700 rounded-lg
                                   hover:bg-indigo-100 disabled:opacity-40 transition-colors font-medium"
                      >
                        Start
                      </button>
                      <button
                        onClick={() => handleAction(c.id, 'resolved')}
                        disabled={!!actionLoading}
                        className="px-2.5 py-1.5 text-xs bg-green-50 text-green-700 rounded-lg
                                   hover:bg-green-100 disabled:opacity-40 transition-colors font-medium"
                      >
                        Resolve
                      </button>
                      <Link
                        href="/admin/map"
                        className="px-2.5 py-1.5 text-xs bg-gray-50 text-gray-600 rounded-lg
                                   hover:bg-gray-100 transition-colors font-medium"
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
