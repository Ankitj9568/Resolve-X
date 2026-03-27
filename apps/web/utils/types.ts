export interface ComplaintHistoryEntry {
  action?: string;
  note?: string;
  created_at: string;
}

export interface Complaint {
  id: string;
  category: string;
  subcategory?: string;
  description?: string;
  status: string;
  ward_id?: string;
  dept_id?: string;
  assigned_to?: string;
  officer_name?: string;
  officer_verified?: boolean;
  created_at?: string;
  sla_deadline?: string;
  history?: ComplaintHistoryEntry[];
}

export interface SecondaryIssue {
  category: string;
  label: string;
  confidence: number;
  dept: string;
}

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  category: string;
  status: string;
  ward_id?: string;
  officer_verified?: boolean;
  marker_type?: string;
}

export interface GeoJsonFeature<TProperties = Record<string, unknown>> {
  type?: string;
  geometry?: {
    type?: string;
    coordinates?: number[][][];
  };
  properties: TProperties;
}

export interface GeoJsonFeatureCollection<TProperties = Record<string, unknown>> {
  type?: string;
  features?: Array<GeoJsonFeature<TProperties>>;
}

export interface RiskFeatureProperties {
  id?: string;
  name?: string;
  risk_tier?: 'critical' | 'high' | 'medium' | 'low';
  risk_label?: string;
  risk_score?: number;
}

export interface WebSocketEvent {
  type: string;
  complaint_id?: string;
  new_status?: string;
}

export interface ApiErrorLike {
  message?: string;
}

// ── Classifier Service (POST /api/v1/analyze) ─────────────────────────────────

export interface ClassifierPrimaryIssue {
  category: string;
  subcategory: string;
  priority_score: number; // 1–5
  confidence: number;     // 0.0–1.0
}

export interface ClassifierSecondaryIssue {
  category: string;
  risk_description: string;
  confidence: number;     // 0.0–1.0
}

export interface ClassifierAnalysis {
  complaint_id: string;
  primary_issue: ClassifierPrimaryIssue;
  secondary_issues: ClassifierSecondaryIssue[];
}

export interface ClassifierResponse {
  is_duplicate: boolean;
  parent_id: string | null;
  analysis: ClassifierAnalysis | null;
  vision_validation: {
    enabled: boolean;
    summary: string | null;
    conflict_detected: boolean;
    conflict_reason: string | null;
  } | null;
}

// ── DBSCAN Clustering Service (GET /api/v1/analytics/clusters) ─────────────────

export interface ClusterProperties {
  cluster_id:       number;
  complaint_count:  number;
  primary_category: string;
}

export interface ClusterFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPoint';
    coordinates: number[][][] | number[][];
  };
  properties: ClusterProperties;
}

export interface ClusterFeatureCollection {
  type: 'FeatureCollection';
  features: ClusterFeature[];
}

// ── Risk Scoring & Alerts Service (GET /risk/zones, GET /risk/alerts) ──────────

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export interface RiskZone {
  ward_id:      string;
  centroid_lat: number;
  centroid_lng: number;
  radius_m:     number;
  risk_level:   RiskLevel;
  risk_score:   number; // 0–100
}

export interface RiskZoneResponse {
  zones: RiskZone[];
  total: number;
}

export interface RiskAlert {
  ward_id:         string;
  alert_text:      string;
  risk_level:      RiskLevel;
  complaint_count: number;
}

export interface RiskAlertResponse {
  alerts: RiskAlert[];
  total:  number;
}
