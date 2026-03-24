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
 
// Wrap the entire Leaflet map in a single dynamic import — SSR must be false
const LeafletMap = dynamic(() => import('../../../components/AdminLeafletMap'), {
  ssr:     false,
  loading: () => (
    <div className="h-[500px] bg-gray-100 rounded-xl flex items-center justify-center">
      <span className="text-sm text-gray-400 animate-pulse">Loading map…</span>
    </div>
  ),
});
 
const DEMO_MODE = process.env.NEXT_PUBLIC_MODE === 'demo';
 
export default function AdminMapPage() {
  const { token, role } = useAuthStore();
  const [markers, setMarkers]   = useState<MapMarker[]>([]);
  const [wards, setWards]       = useState<GeoJsonFeatureCollection | null>(null);
  const [riskData, setRiskData] = useState<GeoJsonFeatureCollection<RiskFeatureProperties> | null>(null);
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
 
  const handleDemoReset = useCallback(async () => {
    if (!token) return;
    setResetting(true);
    try {
      await triggerDemoReset(token);
      // Map refresh triggered by demo.reset WebSocket event
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
  }, [fetchMarkers, fetchWards, fetchRisk]);
 
  // WebSocket: refresh markers on verified or reset events
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
      }
    });
    return remove;
  }, [fetchMarkers]);
 
  // Ctrl+Shift+R keyboard shortcut (commissioner + demo mode only)
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
    <main className="min-h-screen bg-gray-50">
      <SandboxBanner demoMode={DEMO_MODE} />
 
      <div className="p-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Live complaint map</h2>
          {DEMO_MODE && role === 'commissioner' && (
            <button
              onClick={handleDemoReset}
              disabled={resetting}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm
                         font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {resetting ? 'Resetting…' : 'Reset demo'}
            </button>
          )}
        </div>
 
        <LeafletMap
          markers={markers}
          wards={wards}
          riskData={riskData}
        />
 
        {DEMO_MODE && role === 'commissioner' && (
          <p className="text-xs text-gray-400 mt-2 text-right">
            Tip: Ctrl+Shift+R to reset demo map
          </p>
        )}
      </div>
    </main>
  );
}
