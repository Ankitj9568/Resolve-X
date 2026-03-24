'use client';
// apps/web/components/AdminLeafletMap.tsx
// The actual Leaflet map implementation — imported dynamically (ssr:false).
// Separated from the page so dynamic import wraps the entire Leaflet context.

import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polygon, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type {
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  MapMarker,
  RiskFeatureProperties,
} from '../utils/types';

interface WardFeatureProperties {
  id?: string;
  name?: string;
}

// Category colour map for markers
const CATEGORY_COLORS: Record<string, string> = {
  'CAT-01': '#6366f1', // indigo - roads
  'CAT-02': '#3b82f6', // blue - drainage
  'CAT-03': '#f59e0b', // amber - streetlight
  'CAT-04': '#10b981', // green - waste
  'CAT-05': '#06b6d4', // cyan - water
  'CAT-06': '#84cc16', // lime - parks
  'CAT-07': '#f97316', // orange - encroachment
  'CAT-08': '#8b5cf6', // violet - noise
  'CAT-09': '#ec4899', // pink - stray animals
  'CAT-10': '#9ca3af', // gray - other
};

const RISK_COLORS = {
  critical: '#ef444488',
  high:     '#f9731688',
  medium:   '#facc1588',
  low:      '#4ade8044',
};

function toLatLng(point: number[]): [number, number] | null {
  const [lng, lat] = point;
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  return [lat, lng];
}

function markerOptions(marker: MapMarker) {
  const color = CATEGORY_COLORS[marker.category] ?? '#9ca3af';
  const isHollow = marker.marker_type === 'hollow';
  const isResolved = marker.status === 'resolved';

  return {
    radius:      isResolved ? 7 : 8,
    color:       isResolved ? '#22c55e' : color,
    fillColor:   isResolved ? '#22c55e' : color,
    fillOpacity: isHollow ? 0 : 0.85,
    dashArray:   isHollow ? '4 4' : undefined,
    weight:      2,
  };
}

// Adds persistent legend control to the map
function MapLegend() {
  const map = useMap();
  useEffect(() => {
    const legend = new (L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div');
        div.style.cssText = `
          background: white; padding: 10px 14px; border-radius: 8px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.15); font-size: 11px;
          line-height: 1.8; min-width: 160px;
        `;
        div.innerHTML = `
          <strong style="display:block;margin-bottom:4px;font-size:12px">Legend</strong>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#6366f1;margin-right:6px"></span>Verified complaint<br>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;border:2px dashed #6366f1;margin-right:6px"></span>Pending verification<br>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;margin-right:6px"></span>Resolved<br>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;margin-right:6px"></span>Risk cluster<br>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#9ca3af;margin-right:6px"></span>Unclassified
        `;
        return div;
      },
    }))({ position: 'bottomright' });
    legend.addTo(map);
    return () => { legend.remove(); };
  }, [map]);
  return null;
}

interface Props {
  markers:  MapMarker[];
  wards:    GeoJsonFeatureCollection<WardFeatureProperties> | null;
  riskData: GeoJsonFeatureCollection<RiskFeatureProperties> | null;
}

export default function AdminLeafletMap({ markers, wards, riskData }: Props) {
  return (
    <MapContainer
      center={[28.6100, 77.2090]}
      zoom={13}
      style={{ height: '500px', width: '100%', borderRadius: '12px' }}
    >
      <TileLayer
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Risk heatmap — filled polygons per ward */}
      {riskData?.features?.map((feature: GeoJsonFeature<RiskFeatureProperties>) => {
        const coords = feature.geometry?.coordinates?.[0]
          ?.map(toLatLng)
          .filter((point): point is [number, number] => point !== null);
        if (!coords) return null;
        const tier  = feature.properties.risk_tier as keyof typeof RISK_COLORS;
        const color = RISK_COLORS[tier] ?? RISK_COLORS.low;
        return (
          <Polygon
            key={feature.properties.id}
            positions={coords}
            pathOptions={{
              color:       color.slice(0, 7),
              fillColor:   color.slice(0, 7),
              fillOpacity: 0.35,
              weight:      1.5,
            }}
          >
            <Popup>
              <strong>{feature.properties.name}</strong><br />
              Risk: {feature.properties.risk_label ?? tier}
            </Popup>
          </Polygon>
        );
      })}

      {/* Ward boundary outlines */}
      {wards?.features?.map((feature: GeoJsonFeature<WardFeatureProperties>, index: number) => {
        const coords = feature.geometry?.coordinates?.[0]
          ?.map(toLatLng)
          .filter((point): point is [number, number] => point !== null);
        if (!coords) return null;
        return (
          <Polygon
            key={String(feature.properties.id ?? `ward-${index}`)}
            positions={coords}
            pathOptions={{ color: '#6366f1', fillOpacity: 0, weight: 1, dashArray: '6 4' }}
          >
            <Popup>{feature.properties.name ?? `Ward ${index + 1}`}</Popup>
          </Polygon>
        );
      })}

      {/* Complaint markers */}
      {markers.map(marker => (
        <CircleMarker
          key={marker.id}
          center={[marker.lat, marker.lng]}
          {...markerOptions(marker)}
        >
          <Popup>
            <div style={{ fontSize: 13, lineHeight: 1.6, minWidth: 160 }}>
              <strong>{marker.category}</strong><br />
              Status: {marker.status}<br />
              Ward: {marker.ward_id ?? '—'}<br />
              {marker.officer_verified
                ? '✓ Verified on ground'
                : '○ Pending verification'
              }
            </div>
          </Popup>
        </CircleMarker>
      ))}

      <MapLegend />
    </MapContainer>
  );
}
