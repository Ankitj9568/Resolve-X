'use client';

 
import { useParams }    from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { getComplaint, submitFeedback } from '../../../utils/api';
import { addWebSocketListener } from '../../../utils/ws';
import { useAuthStore } from '../../../store/auth';
import SandboxBanner from '../../../components/SandboxBanner';
import type { ApiErrorLike, Complaint, ComplaintHistoryEntry } from '../../../utils/types';
 
const DEMO_MODE = process.env.NEXT_PUBLIC_MODE === 'demo';
 
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:     { label: 'Pending',     color: 'bg-gray-100 text-gray-700'   },
  assigned:    { label: 'Assigned',    color: 'bg-blue-100 text-blue-700'   },
  in_progress: { label: 'In Progress', color: 'bg-indigo-100 text-indigo-700'},
  escalated:   { label: 'Escalated',   color: 'bg-red-100 text-red-700'     },
  resolved:    { label: 'Resolved',    color: 'bg-green-100 text-green-700' },
  closed:      { label: 'Closed',      color: 'bg-gray-200 text-gray-600'   },
};
 
export default function TrackComplaint() {
  const params     = useParams();
  const id         = params?.id as string;
  const { token }  = useAuthStore();
 
  const [complaint, setComplaint]   = useState<Complaint | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [csatRating, setCsatRating] = useState<number | null>(null);
  const [csatComment, setCsatComment] = useState('');
  const [csatSubmitted, setCsatSubmitted] = useState(false);
  const [timeLeft, setTimeLeft]     = useState<string | null>(null);
 
  const fetchComplaint = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getComplaint(id, token ?? undefined);
      setComplaint(data);
      setError(null);
    } catch (err) {
      const apiError = err as ApiErrorLike;
      setError(apiError.message ?? 'Complaint not found');
    } finally {
      setLoading(false);
    }
  }, [id, token]);
 
  // Initial load
  useEffect(() => { fetchComplaint(); }, [fetchComplaint]);
 
  // SLA countdown timer
  useEffect(() => {
    if (!complaint?.sla_deadline) return;
    const deadline = complaint.sla_deadline;
    const tick = () => {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft('Overdue'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setTimeLeft(`${h}h ${m}m remaining`);
    };
    tick();
    const interval = setInterval(tick, 60000);
    return () => clearInterval(interval);
  }, [complaint?.sla_deadline]);
 
  // WebSocket — listen for status updates on this complaint
  useEffect(() => {
    const remove = addWebSocketListener((event) => {
      if (
        event.type === 'complaint.status_updated' &&
        event.complaint_id === id
      ) {
        fetchComplaint();
      }
    });
    return remove; // cleanup on unmount
  }, [id, fetchComplaint]);
 
  const handleCsatSubmit = async () => {
    if (!csatRating || !token) return;
    try {
      await submitFeedback(id, csatRating, csatComment, token);
      setCsatSubmitted(true);
    } catch { /* non-fatal */ }
  };
 
  if (loading) return (
    <main className="max-w-lg mx-auto mt-10 px-4">
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-gray-200 rounded w-2/3" />
        <div className="h-4 bg-gray-200 rounded w-1/2" />
        <div className="h-32 bg-gray-200 rounded" />
      </div>
    </main>
  );
 
  if (error) return (
    <main className="max-w-lg mx-auto mt-10 px-4 text-center">
      <p className="text-red-600">{error}</p>
      <Link href="/" className="text-indigo-500 text-sm mt-4 block">← Back to home</Link>
    </main>
  );
 
  const complaintStatus = complaint?.status ?? 'pending';
  const statusInfo = STATUS_LABELS[complaintStatus] ?? STATUS_LABELS.pending;
  const isResolved = ['resolved', 'closed'].includes(complaintStatus);
  const history = complaint?.history ?? [];
 
  return (
    <main className="max-w-lg mx-auto px-4 py-8">
      <SandboxBanner demoMode={DEMO_MODE} />
 
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold text-gray-900">Complaint status</h2>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
        </div>
        <p className="text-xs text-gray-400 font-mono">{id}</p>
      </div>
 
      {/* SLA countdown */}
      {complaint?.sla_deadline && !isResolved && (
        <div className={`rounded-xl px-4 py-3 mb-4 text-sm font-medium
          ${timeLeft === 'Overdue'
            ? 'bg-red-50 text-red-700 border border-red-200'
            : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
          }`}>
          {timeLeft === 'Overdue' ? '⚠ SLA deadline passed' : `⏱ ${timeLeft}`}
        </div>
      )}
 
      {/* Details */}
      <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Category</span>
          <span className="font-medium">{complaint?.category}</span>
        </div>
        {complaint?.ward_id && (
          <div className="flex justify-between">
            <span className="text-gray-500">Ward</span>
            <span className="font-medium">{complaint.ward_id}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-500">Filed</span>
          <span className="font-medium">
            {complaint?.created_at
              ? new Date(complaint.created_at).toLocaleDateString('en-IN', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })
              : '—'}
          </span>
        </div>
      </div>
 
      {/* History timeline */}
      {history.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Timeline</h3>
          <ol className="relative border-l border-gray-200 ml-3 space-y-4">
            {history.map((entry: ComplaintHistoryEntry, i: number) => (
              <li key={i} className="ml-4">
                <div className="absolute -left-1.5 w-3 h-3 bg-indigo-400 rounded-full border-2 border-white" />
                <div className="text-sm">
                  <p className="font-medium text-gray-800 capitalize">
                    {entry.action?.replace(/_/g, ' ')}
                  </p>
                  {entry.note && (
                    <p className="text-gray-500 text-xs mt-0.5">{entry.note}</p>
                  )}
                  <p className="text-gray-400 text-xs mt-0.5">
                    {new Date(entry.created_at).toLocaleString('en-IN')}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
 
      {/* CSAT — only when resolved and not yet submitted */}
      {isResolved && !csatSubmitted && token && (
        <div className="border border-gray-200 rounded-xl p-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">
            How was your experience?
          </h3>
          <div className="flex gap-2 mb-3">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => setCsatRating(n)}
                className={`w-10 h-10 rounded-full text-lg transition-all
                  ${csatRating === n
                    ? 'bg-indigo-500 text-white scale-110'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                  }`}
              >
                {n}
              </button>
            ))}
          </div>
          <textarea
            className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none
                       focus:outline-none focus:ring-2 focus:ring-indigo-300"
            rows={2}
            placeholder="Optional feedback…"
            value={csatComment}
            onChange={e => setCsatComment(e.target.value)}
          />
          <button
            onClick={handleCsatSubmit}
            disabled={!csatRating}
            className="mt-2 w-full py-2 bg-indigo-600 text-white text-sm rounded-lg
                       font-medium disabled:opacity-50 hover:bg-indigo-700 transition-colors"
          >
            Submit feedback
          </button>
        </div>
      )}
 
      {csatSubmitted && (
        <div className="bg-green-50 text-green-700 text-sm text-center py-3 rounded-xl mb-6">
          Thank you for your feedback
        </div>
      )}
 
      <Link href="/" className="text-sm text-indigo-500 hover:underline">← Back to home</Link>
    </main>
  );
}
