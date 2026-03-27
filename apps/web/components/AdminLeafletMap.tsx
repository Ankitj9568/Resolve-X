'use client';
// apps/web/components/AdminLeafletMap.tsx

import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polygon, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type {
  ClusterFeatureCollection,
  ClusterProperties,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  MapMarker,
  RiskFeatureProperties,
} from '../utils/types';

interface WardFeatureProperties {
  id?: string;
  name?: string;
}


const CATEGORY_COLORS: Record<string, string> = {
  'CAT-01': '#6366f1',
  'CAT-02': '#3b82f6',
  'CAT-03': '#f59e0b',
  'CAT-04': '#10b981',
  'CAT-05': '#06b6d4',
  'CAT-06': '#84cc16',
  'CAT-07': '#f97316',
  'CAT-08': '#8b5cf6',
  'CAT-09': '#ec4899',
  'CAT-10': '#9ca3af',
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
  const isHollow   = marker.marker_type === 'hollow';
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

function MapLegend({ hasClusters }: { hasClusters: boolean }) {
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
          ${hasClusters ? `<span style="display:inline-block;width:10px;height:10px;background:rgba(239,68,68,0.25);border:1.5px solid #ef4444;margin-right:6px"></span>Incident cluster<br>` : ''}
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#9ca3af;margin-right:6px"></span>Unclassified
        `;
        return div;
      },
    }))({ position: 'bottomright' });
    legend.addTo(map);
    return () => { legend.remove(); };
  }, [map, hasClusters]);
  return null;
}

interface Props {
  markers:  MapMarker[];
  wards:    GeoJsonFeatureCollection<WardFeatureProperties> | null;
  riskData: GeoJsonFeatureCollection<RiskFeatureProperties> | null;
  clusters: ClusterFeatureCollection | null;
}

export default function AdminLeafletMap({ markers, wards, riskData, clusters }: Props) {
  const hasClusters = (clusters?.features?.length ?? 0) > 0;

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

      {/* ── Integration 4: DBSCAN cluster polygons ─────────────────────────
          Renders each cluster as a translucent red polygon.
          The DBSCAN service returns either Polygon or MultiPoint geometry.
          We handle both — MultiPoint falls back to individual circle markers. */}
      {clusters?.features?.map((feature) => {
        const props = feature.properties;
        const geom  = feature.geometry;

        if (!geom || !geom.type) return null;

        if (geom.type === 'Polygon') {
          // Defensive: check coordinates structure
          let coords: [number, number][] = [];
          if (Array.isArray(geom.coordinates) && Array.isArray(geom.coordinates[0])) {
            // Only use the first ring (outer boundary)
            const ring = geom.coordinates[0];
            if (Array.isArray(ring)) {
              coords = ring
                .filter((pt): pt is number[] => Array.isArray(pt) && pt.length === 2 && pt.every(n => typeof n === 'number'))
                .map((pt) => toLatLng(pt))
                .filter((p): p is [number, number] => p !== null);
            }
          }
          if (!coords || coords.length < 3) return null;

          return (
            <Polygon
              key={`cluster-${props.cluster_id}`}
              positions={coords}
              pathOptions={{
                color:       '#ef4444',
                fillColor:   '#ef4444',
                fillOpacity: 0.18,
                weight:      2,
                dashArray:   '6 3',
              }}
            >
              <Popup>
                <div style={{ fontSize: 13, lineHeight: 1.6, minWidth: 140 }}>
                  <strong>Incident Cluster #{props.cluster_id}</strong><br />
                  Complaints: {props.complaint_count}<br />
                  Primary: {props.primary_category}
                </div>
              </Popup>
            </Polygon>
          );
        }

        if (geom.type === 'MultiPoint') {
          // Defensive: check coordinates is array of points
          if (!Array.isArray(geom.coordinates)) return null;
          return geom.coordinates.map((point, i) => {
            // Each point should be a number[]
            const latlng = Array.isArray(point) ? toLatLng(point as unknown as [number, number]) : null;
            if (!latlng) return null;
            return (
              <CircleMarker
                key={`cluster-${props.cluster_id}-pt-${i}`}
                center={latlng}
                radius={10}
                pathOptions={{
                  color:       '#ef4444',
                  fillColor:   '#ef4444',
                  fillOpacity: 0.18,
                  weight:      2,
                  dashArray:   '4 3',
                }}
              >
                <Popup>
                  <div style={{ fontSize: 13, lineHeight: 1.6, minWidth: 140 }}>
                    <strong>Cluster #{props.cluster_id}</strong><br />
                    Complaints: {props.complaint_count}<br />
                    Primary: {props.primary_category}
                  </div>
                </Popup>
              </CircleMarker>
            );
          });
        }

        return null;
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

      <MapLegend hasClusters={hasClusters} />
    </MapContainer>
  );
}