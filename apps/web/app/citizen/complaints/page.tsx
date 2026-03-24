'use client';
// apps/web/app/citizen/complaints/page.tsx
// Full complaint history for citizen — linked from citizen/home "View all"

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/auth';
import SandboxBanner from '../../../components/SandboxBanner';
import type { Complaint } from '../../../utils/types';

const DEMO_MODE = process.env.NEXT_PUBLIC_MODE === 'demo';
const BASE      = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: 'Pending',     color: 'text-gray-600',   bg: 'bg-gray-100'   },
  assigned:    { label: 'Assigned',    color: 'text-blue-700',   bg: 'bg-blue-50'    },
  in_progress: { label: 'In Progress', color: 'text-indigo-700', bg: 'bg-indigo-50'  },
  escalated:   { label: 'Escalated',   color: 'text-red-700',    bg: 'bg-red-50'     },
  resolved:    { label: 'Resolved',    color: 'text-green-700',  bg: 'bg-green-50'   },
  closed:      { label: 'Closed',      color: 'text-gray-500',   bg: 'bg-gray-100'   },
};

const CATEGORY_ICONS: Record<string, string> = {
  'CAT-01':'🛣️','CAT-02':'🌊','CAT-03':'💡','CAT-04':'🗑️','CAT-05':'🚰',
  'CAT-06':'🌳','CAT-07':'🚧','CAT-08':'📢','CAT-09':'🐕','CAT-10':'📋',
};

export default function CitizenComplaints() {
  const router          = useRouter();
  const { token }       = useAuthStore();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState('all');

  useEffect(() => {
    if (!token) { router.replace('/'); return; }
  }, [token, router]);

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

  const filtered = filter === 'all'
    ? complaints
    : complaints.filter(c => c.status === filter);

  return (
    <main className="min-h-screen bg-gray-50">
      <SandboxBanner demoMode={DEMO_MODE} />
      <div className="bg-white border-b border-gray-100 px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">←</button>
        <h1 className="text-lg font-semibold text-gray-900">My complaints</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4">
        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
          {['all','pending','in_progress','escalated','resolved'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors
                ${filter === f
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-500 border border-gray-200 hover:border-indigo-300'
                }`}>
              {f === 'all' ? 'All' : f.replace('_', ' ')}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-sm text-gray-500">No complaints found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(c => {
              const s = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.pending;
              return (
                <div key={c.id}
                  onClick={() => router.push(`/track/${c.id}`)}
                  className="bg-white rounded-xl p-4 border border-gray-100
                             hover:border-indigo-200 cursor-pointer transition-all">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{CATEGORY_ICONS[c.category] ?? '📋'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-gray-900 text-sm">{c.category}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.bg} ${s.color}`}>
                          {s.label}
                        </span>
                      </div>
                      {c.description && (
                        <p className="text-xs text-gray-400 truncate">{c.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-gray-300">
                          {c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN', {
                            day: 'numeric', month: 'short', year: 'numeric'
                          }) : '—'}
                        </p>
                        {c.ward_id && <p className="text-xs text-gray-300">· {c.ward_id}</p>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
