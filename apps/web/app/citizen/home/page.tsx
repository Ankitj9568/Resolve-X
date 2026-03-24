'use client';
// apps/web/app/citizen/home/page.tsx
// Citizen home page — landing after OTP login.
// Spec: /citizen/home shows last 3 complaints + prominent Report CTA
// Design: warm civic tone, card-based, mobile-first, staggered load animation

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../../store/auth';
import { addWebSocketListener } from '../../../utils/ws';
import SandboxBanner from '../../../components/SandboxBanner';
import type { Complaint } from '../../../utils/types';

const DEMO_MODE = process.env.NEXT_PUBLIC_MODE === 'demo';
const BASE      = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  pending:     { label: 'Pending',     color: 'text-gray-600',   bg: 'bg-gray-100',   dot: 'bg-gray-400'   },
  assigned:    { label: 'Assigned',    color: 'text-blue-700',   bg: 'bg-blue-50',    dot: 'bg-blue-500'   },
  in_progress: { label: 'In Progress', color: 'text-indigo-700', bg: 'bg-indigo-50',  dot: 'bg-indigo-500' },
  escalated:   { label: 'Escalated',   color: 'text-red-700',    bg: 'bg-red-50',     dot: 'bg-red-500'    },
  resolved:    { label: 'Resolved',    color: 'text-green-700',  bg: 'bg-green-50',   dot: 'bg-green-500'  },
  closed:      { label: 'Closed',      color: 'text-gray-500',   bg: 'bg-gray-100',   dot: 'bg-gray-300'   },
};

const CATEGORY_ICONS: Record<string, string> = {
  'CAT-01': '🛣️', 'CAT-02': '🌊', 'CAT-03': '💡',
  'CAT-04': '🗑️', 'CAT-05': '🚰', 'CAT-06': '🌳',
  'CAT-07': '🚧', 'CAT-08': '📢', 'CAT-09': '🐕', 'CAT-10': '📋',
};

const CATEGORY_LABELS: Record<string, string> = {
  'CAT-01': 'Roads',      'CAT-02': 'Drainage', 'CAT-03': 'Streetlight',
  'CAT-04': 'Waste',      'CAT-05': 'Water',    'CAT-06': 'Parks',
  'CAT-07': 'Encroachment', 'CAT-08': 'Noise',  'CAT-09': 'Stray Animals',
  'CAT-10': 'Other',
};

function SLAProgress({ slaDeadline, createdAt, status, now }: {
  slaDeadline: string; createdAt: string; status: string; now: number;
}) {
  if (status === 'resolved' || status === 'closed') return null;
  const total   = new Date(slaDeadline).getTime() - new Date(createdAt).getTime();
  const elapsed = now - new Date(createdAt).getTime();
  const pct     = Math.min(100, Math.round((elapsed / total) * 100));
  const color   = pct >= 100 ? 'bg-red-400' : pct >= 80 ? 'bg-amber-400' : 'bg-green-400';
  const remaining = new Date(slaDeadline).getTime() - now;
  const h       = Math.max(0, Math.floor(remaining / 3600000));
  const label   = pct >= 100 ? 'Overdue' : `${h}h left`;

  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>SLA</span>
        <span className={pct >= 100 ? 'text-red-500 font-medium' : ''}>{label}</span>
      </div>
      <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function CitizenHome() {
  const router          = useRouter();
  const { token, role, clear } = useAuthStore();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading]       = useState(true);
  const [greeting, setGreeting]     = useState('');
  const [visible, setVisible]       = useState(false);
  const [now, setNow]               = useState(() => Date.now());

  // Redirect if not logged in
  useEffect(() => {
    if (!token) { router.replace('/'); return; }
    if (role && role !== 'citizen') {
      router.replace('/officer/tasks');
    }
  }, [token, role, router]);

  // Time-based greeting
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
  }, []);

  const fetchComplaints = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BASE}/complaints?limit=3`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setComplaints(data.complaints?.slice(0, 3) ?? []);
    } catch { /* non-fatal */ } finally {
      setLoading(false);
      setTimeout(() => setVisible(true), 50);
    }
  }, [token]);

  useEffect(() => { fetchComplaints(); }, [fetchComplaints]);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  // Live status updates via WebSocket
  useEffect(() => {
    const remove = addWebSocketListener((event) => {
      if (event.type === 'complaint.status_updated') {
        const newStatus = event.new_status;
        if (!newStatus) return;
        setComplaints(prev =>
          prev.map(c => c.id === event.complaint_id
            ? { ...c, status: newStatus }
            : c
          )
        );
      }
    });
    return remove;
  }, []);

  const handleLogout = () => {
    clear();
    router.replace('/');
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <SandboxBanner demoMode={DEMO_MODE} />

      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400">{greeting}</p>
          <h1 className="text-lg font-semibold text-gray-900">ResolveX</h1>
        </div>
        <button
          onClick={handleLogout}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Sign out
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">

        {/* Hero CTA — Report a complaint */}
        <div
          className="relative overflow-hidden rounded-2xl bg-indigo-600 p-6 text-white"
          style={{
            opacity:    visible ? 1 : 0,
            transform:  visible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 400ms, transform 400ms',
          }}
        >
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: 'radial-gradient(circle at 80% 20%, white 1px, transparent 1px)',
              backgroundSize:  '24px 24px',
            }}
          />
          <div className="relative">
            <p className="text-indigo-200 text-sm mb-1">See something broken?</p>
            <h2 className="text-2xl font-bold mb-4">Report an issue</h2>
            <Link
              href="/file"
              className="inline-flex items-center gap-2 bg-white text-indigo-700
                         font-semibold text-sm px-5 py-2.5 rounded-xl
                         hover:bg-indigo-50 transition-colors active:scale-95"
            >
              <span>📍</span>
              File complaint
            </Link>
          </div>
        </div>

        {/* Quick actions */}
        <div
          className="grid grid-cols-3 gap-3"
          style={{
            opacity:    visible ? 1 : 0,
            transform:  visible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 400ms 100ms, transform 400ms 100ms',
          }}
        >
          {[
            { icon: '📋', label: 'My complaints', href: '/citizen/complaints' },
            { icon: '🗺️', label: 'View map',      href: '/admin/map'          },
            { icon: '🔍', label: 'Track by ID',   href: '#',
              onClick: () => {
                const id = prompt('Enter complaint ID:');
                if (id?.trim()) router.push(`/track/${id.trim()}`);
              }
            },
          ].map(action => (
            <button
              key={action.label}
              onClick={action.onClick ?? (() => router.push(action.href))}
              className="flex flex-col items-center gap-2 bg-white rounded-xl p-4
                         border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50
                         transition-all active:scale-95 text-center"
            >
              <span className="text-2xl">{action.icon}</span>
              <span className="text-xs text-gray-600 font-medium leading-tight">
                {action.label}
              </span>
            </button>
          ))}
        </div>

        {/* Recent complaints */}
        <div
          style={{
            opacity:    visible ? 1 : 0,
            transition: 'opacity 400ms 200ms',
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Recent complaints</h3>
            <Link href="/citizen/complaints"
              className="text-xs text-indigo-500 hover:underline">
              View all →
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-xl p-4 animate-pulse h-24" />
              ))}
            </div>
          ) : complaints.length === 0 ? (
            <div className="bg-white rounded-xl p-8 text-center border border-gray-100">
              <p className="text-3xl mb-2">📭</p>
              <p className="text-sm text-gray-500">No complaints yet</p>
              <p className="text-xs text-gray-400 mt-1">
                File your first complaint using the button above
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {complaints.map((c, i) => {
                const status = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.pending;
                return (
                  <div
                    key={c.id}
                    onClick={() => router.push(`/track/${c.id}`)}
                    className="bg-white rounded-xl p-4 border border-gray-100
                               hover:border-indigo-200 hover:shadow-sm
                               transition-all cursor-pointer active:scale-[0.99]"
                    style={{
                      opacity:    visible ? 1 : 0,
                      transform:  visible ? 'translateY(0)' : 'translateY(8px)',
                      transition: `opacity 300ms ${200 + i * 80}ms, transform 300ms ${200 + i * 80}ms`,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl flex-shrink-0 mt-0.5">
                        {CATEGORY_ICONS[c.category] ?? '📋'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-medium text-gray-900 text-sm">
                            {CATEGORY_LABELS[c.category] ?? c.category}
                          </span>
                          <span className={`flex items-center gap-1.5 px-2 py-0.5
                            rounded-full text-xs font-medium flex-shrink-0
                            ${status.bg} ${status.color}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                            {status.label}
                          </span>
                        </div>
                        {c.description && (
                          <p className="text-xs text-gray-400 truncate">{c.description}</p>
                        )}
                        <p className="text-xs text-gray-300 mt-1">
                          {c.created_at
                            ? new Date(c.created_at).toLocaleDateString('en-IN', {
                                day: 'numeric', month: 'short',
                              })
                            : '—'}
                          {c.ward_id && ` · ${c.ward_id}`}
                        </p>
                        {c.sla_deadline && c.created_at && (
                          <SLAProgress
                            slaDeadline={c.sla_deadline}
                            createdAt={c.created_at}
                            status={c.status}
                            now={now}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Demo mode tip */}
        {DEMO_MODE && (
          <div
            className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3
                       text-xs text-amber-700"
            style={{
              opacity:    visible ? 1 : 0,
              transition: 'opacity 400ms 400ms',
            }}
          >
            <span className="font-semibold">Demo mode</span> — complaints are
            illustrative. Press <kbd className="bg-amber-100 px-1 rounded">Ctrl+Shift+R</kbd> on
            the admin map to reset.
          </div>
        )}
      </div>
    </main>
  );
}
