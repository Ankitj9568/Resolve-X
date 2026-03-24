'use client';
// apps/web/app/officer/tasks/page.tsx
// Officer task queue — SLA-sorted, 3 action buttons per card,
// "Verified on ground" button triggers hollow→solid marker transition.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter }            from 'next/navigation';
import { useAuthStore }         from '../../../store/auth';
import { updateStatus, verifyComplaint } from '../../../utils/api';
import { addWebSocketListener } from '../../../utils/ws';
import SandboxBanner            from '../../../components/SandboxBanner';
import type { Complaint } from '../../../utils/types';

const DEMO_MODE = process.env.NEXT_PUBLIC_MODE === 'demo';
const BASE      = process.env.NEXT_PUBLIC_API_URL;

const STATUS_COLORS: Record<string, string> = {
  open:        'bg-gray-100 text-gray-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  escalated:   'bg-red-100 text-red-700',
  resolved:    'bg-green-100 text-green-700',
};

function SLABar({ deadline, createdAt, now }: { deadline: string; createdAt: string; now: number }) {
  const total   = new Date(deadline).getTime() - new Date(createdAt).getTime();
  const elapsed = now - new Date(createdAt).getTime();
  const pct     = Math.min(100, (elapsed / total) * 100);
  const color   = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-green-400';
  const remaining = new Date(deadline).getTime() - now;
  const h       = Math.max(0, Math.floor(remaining / 3600000));
  const m       = Math.max(0, Math.floor((remaining % 3600000) / 60000));
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>SLA</span>
        <span className={pct >= 100 ? 'text-red-600 font-medium' : ''}>
          {pct >= 100 ? 'Overdue' : `${h}h ${m}m`}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function OfficerTasks() {
  const router          = useRouter();
  const { token, role } = useAuthStore();
  const [tasks, setTasks]           = useState<Complaint[]>([]);
  const [loading, setLoading]       = useState(true);
  const [actionId, setActionId]     = useState<string | null>(null);
  const [now, setNow]               = useState(() => Date.now());

  // Redirect if not officer role
  useEffect(() => {
    if (role && !['officer', 'dept_head', 'commissioner'].includes(role)) {
      router.replace('/');
    }
  }, [role, router]);

  const fetchTasks = useCallback(async () => {
    if (!token) return;
    try {
      const res  = await fetch(`${BASE}/complaints?status=assigned,in_progress,open`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      // Sort by SLA urgency — soonest deadline first
      const sorted = (data.complaints ?? []).sort((a: Complaint, b: Complaint) =>
        new Date(a.sla_deadline ?? 0).getTime() - new Date(b.sla_deadline ?? 0).getTime()
      );
      setTasks(sorted);
    } catch (err) {
      console.error('Failed to fetch tasks', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  // Live updates via WebSocket
  useEffect(() => {
    const remove = addWebSocketListener((event) => {
      if (event.type === 'task.assigned' || event.type === 'demo.reset') {
        fetchTasks();
      }
      if (event.type === 'complaint.status_updated') {
        const newStatus = event.new_status;
        if (!newStatus) return;
        setTasks(prev => prev.map(t =>
          t.id === event.complaint_id ? { ...t, status: newStatus } : t
        ));
      }
    });
    return remove;
  }, [fetchTasks]);

  const handleAction = async (task: Complaint, status: string) => {
    if (!token) return;
    setActionId(task.id + status);
    try {
      await updateStatus(task.id, status, token);
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t));
    } catch { /* non-fatal */ } finally {
      setActionId(null);
    }
  };

  const handleVerify = async (task: Complaint) => {
    if (!token) return;
    setActionId(task.id + 'verify');
    try {
      await verifyComplaint(task.id, token);
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, officer_verified: true } : t
      ));
    } catch { /* non-fatal */ } finally {
      setActionId(null);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <SandboxBanner demoMode={DEMO_MODE} />
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">My tasks</h2>
          <span className="text-sm text-gray-400">{tasks.length} open</span>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="bg-white rounded-xl h-32 animate-pulse" />)}
          </div>
        ) : tasks.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center text-gray-400 text-sm">
            No tasks assigned
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map(task => (
              <div key={task.id}
                className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 text-sm">
                        {task.category}
                      </span>
                      {task.ward_id && (
                        <span className="text-xs text-gray-400">{task.ward_id}</span>
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                        ${STATUS_COLORS[task.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {task.status?.replace('_', ' ')}
                      </span>
                      {task.officer_verified && (
                        <span className="text-xs text-green-600 font-medium">✓ Verified</span>
                      )}
                    </div>
                    {task.description && (
                      <p className="text-xs text-gray-500 mt-1 truncate max-w-xs">
                        {task.description}
                      </p>
                    )}
                  </div>
                </div>

                {task.sla_deadline && task.created_at && (
                  <SLABar deadline={task.sla_deadline} createdAt={task.created_at} now={now} />
                )}

                {/* Action buttons */}
                <div className="flex gap-2 mt-3 flex-wrap">
                  {task.status !== 'in_progress' && (
                    <button
                      onClick={() => handleAction(task, 'in_progress')}
                      disabled={!!actionId}
                      className="px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700
                                 rounded-lg hover:bg-indigo-100 disabled:opacity-40
                                 font-medium transition-colors"
                    >
                      Start work
                    </button>
                  )}
                  <button
                    onClick={() => handleAction(task, 'resolved')}
                    disabled={!!actionId}
                    className="px-3 py-1.5 text-xs bg-green-50 text-green-700
                               rounded-lg hover:bg-green-100 disabled:opacity-40
                               font-medium transition-colors"
                  >
                    Mark resolved
                  </button>
                  {!task.officer_verified && (
                    <button
                      onClick={() => handleVerify(task)}
                      disabled={!!actionId}
                      className="px-3 py-1.5 text-xs bg-amber-50 text-amber-700
                                 rounded-lg hover:bg-amber-100 disabled:opacity-40
                                 font-medium transition-colors"
                    >
                      Verified on ground
                    </button>
                  )}
                  <Link href="/admin/map"
                    className="px-3 py-1.5 text-xs bg-gray-50 text-gray-600
                               rounded-lg hover:bg-gray-100 font-medium transition-colors">
                    View on map
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
