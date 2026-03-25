'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useAuthStore }         from '../../../store/auth';
import { getMapMarkers, getWards, triggerDemoReset } from '../../../utils/api';
import { addWebSocketListener } from '../../../utils/ws';
import SandboxBanner            from '../../../components/SandboxBanner';
import type {
  ApiErrorLike,
  GeoJsonFeatureCollection,
  MapMarker,
  RiskFeatureProperties,
} from '../../../utils/types';

const LeafletMap = dynamic(() => import('../../../components/AdminLeafletMap'), {
  ssr:     false,
  loading: () => (
    <div className="h-[500px] bg-slate-100 rounded-xl flex items-center justify-center">
      <span className="text-sm text-[var(--grey-text-dark)] animate-pulse">Loading map…</span>
    </div>
  ),
});

const DEMO_MODE    = process.env.NEXT_PUBLIC_MODE === 'demo';
const DBSCAN_URL   = process.env.NEXT_PUBLIC_DBSCAN_URL || 'http://localhost:8010';

// GeoJSON type for DBSCAN cluster features
interface ClusterProperties {
  cluster_id:       number;
  complaint_count:  number;
  primary_category: string;
}

export default function AdminMapPage() {
  const { token, role } = useAuthStore();
  const [markers, setMarkers]     = useState<MapMarker[]>([]);
  const [wards, setWards]         = useState<GeoJsonFeatureCollection | null>(null);
  const [riskData, setRiskData]   = useState<GeoJsonFeatureCollection<RiskFeatureProperties> | null>(null);
  const [clusters, setClusters]   = useState<GeoJsonFeatureCollection<ClusterProperties> | null>(null);
  const [resetting, setResetting] = useState(false);

  const fetchMarkers = useCallback(async () => {
    try {
      const data = await getMapMarkers(token ?? undefined);
      setMarkers(data.markers ?? []);
    } catch { /* non-fatal */ }
  }, [token]);

  const fetchWards = useCallback(async () => {
    try {
      const data = await getWards();
      setWards(data);
    } catch { /* non-fatal */ }
  }, []);

  const fetchRisk = useCallback(async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/gis/risk-heatmap`,
        token ? { headers: { Authorization: `Bearer ${token}` } } : {}
      );
      const data = await res.json();
      setRiskData(data);
    } catch { /* non-fatal */ }
  }, [token]);

  // ── Integration 4: Fetch DBSCAN clusters from port 8010 ──────────────────
  const fetchClusters = useCallback(async () => {
    try {
      const res  = await fetch(`${DBSCAN_URL}/api/v1/analytics/clusters`);
      const data = await res.json();
      // data is a GeoJSON FeatureCollection with Polygon/MultiPoint geometries
      if (data?.type === 'FeatureCollection') {
        setClusters(data);
      }
    } catch (err) {
      // Non-fatal — clusters are a nice-to-have overlay
      console.warn('DBSCAN clusters unavailable:', err);
    }
  }, []);

  const handleDemoReset = useCallback(async () => {
    if (!token) return;
    setResetting(true);
    try {
      await triggerDemoReset(token);
    } catch (err) {
      const apiError = err as ApiErrorLike;
      console.error('Demo reset failed:', apiError.message);
    } finally {
      setResetting(false);
    }
  }, [token]);

  // Initial data load
  useEffect(() => {
    fetchMarkers();
    fetchWards();
    fetchRisk();
    fetchClusters();
  }, [fetchMarkers, fetchWards, fetchRisk, fetchClusters]);

  // WebSocket: refresh on events
  useEffect(() => {
    const remove = addWebSocketListener((event) => {
      if (
        event.type === 'complaint.verified' ||
        event.type === 'complaint.status_updated'
      ) {
        fetchMarkers();
      }
      if (event.type === 'demo.reset') {
        fetchMarkers();
        fetchClusters(); // refresh clusters on demo reset too
      }
    });
    return remove;
  }, [fetchMarkers, fetchClusters]);

  // Ctrl+Shift+R keyboard shortcut
  useEffect(() => {
    if (!DEMO_MODE || role !== 'commissioner') return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        if (confirm('Reset demo map? This will wipe all visitor complaints and restore the base seed.')) {
          handleDemoReset();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleDemoReset, role]);

  return (
    <main className="min-h-screen text-white bg-[var(--main-dark-bg)] w-full relative overflow-hidden">
      <SandboxBanner demoMode={DEMO_MODE} />

      {/* Background Mesh Gradient */}
      <div className="absolute inset-x-0 top-[-10%] h-[800px] w-full pointer-events-none opacity-50 z-0">
        <div className="absolute top-0 right-[15%] w-[600px] h-[600px] rounded-full bg-[var(--purple)] blur-[120px] mix-blend-screen opacity-50" />
        <div className="absolute top-[10%] left-[10%] w-[500px] h-[500px] rounded-full bg-[var(--blue)] blur-[100px] mix-blend-screen opacity-40" />
        <div className="absolute top-[30%] left-[40%] w-[400px] h-[400px] rounded-full bg-[var(--pink)] blur-[120px] mix-blend-screen opacity-30" />
        <div className="absolute top-[-5%] left-[30%] w-[400px] h-[400px] rounded-full bg-[var(--orange)] blur-[100px] mix-blend-screen opacity-20" />
      </div>

      <div className="relative z-10 p-4 md:p-8 max-w-7xl mx-auto mt-6">
        <div className="bg-[#1a1326]/40 rounded-3xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-6 md:p-8 backdrop-blur-2xl">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <img src="/logo.png" alt="ResolveX" className="w-12 h-12 object-contain drop-shadow-sm" />
              <div>
                <h2 className="text-2xl font-extrabold text-white tracking-tight" style={{ letterSpacing: '-0.02vw' }}>Live GIS Intelligence</h2>
                <span className="text-sm text-[var(--grey-text-dark)]">City-wide incident visualization</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Cluster legend */}
              {(clusters?.features?.length ?? 0)  > 0 && (                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium">
                  <span className="w-2 h-2 rounded-full bg-red-400 opacity-70" />
                  {clusters?.features?.length} incident cluster{clusters?.features?.length !== 1 ? 's' : ''}
                </div>
              )}
              {DEMO_MODE && role === 'commissioner' && (
                <button
                  onClick={handleDemoReset}
                  disabled={resetting}
                  className="px-6 py-2.5 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 text-sm
                             font-semibold rounded-full transition-all disabled:opacity-50 shadow-sm"
                >
                  {resetting ? 'Resetting…' : 'Reset demo'}
                </button>
              )}
            </div>
          </div>

          <div className="rounded-2xl overflow-hidden border border-white/5 shadow-inner bg-[#0a101c]">
            <LeafletMap
              markers={markers}
              wards={wards}
              riskData={riskData}
              clusters={clusters}
            />
          </div>

          {DEMO_MODE && role === 'commissioner' && (
            <p className="text-xs text-[var(--grey-text-dark)] mt-4 text-right font-medium">
              Tip: Ctrl+Shift+R to hard reset demo map sequence
            </p>
          )}
        </div>
      </div>
    </main>
  );
}