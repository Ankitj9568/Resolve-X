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
