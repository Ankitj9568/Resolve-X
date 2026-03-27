// apps/web/utils/api.ts
// Central API utility for ResolveX frontend.
// Attaches Authorization header from token argument.
// Throws a typed error with the server's error message on non-2xx responses.
import type {
  Complaint,
  ClassifierResponse,
  ClusterFeatureCollection,
  GeoJsonFeatureCollection,
  MapMarker,
  RiskAlertResponse,
  RiskZoneResponse,
  SecondaryIssue,
} from './types';

// ── Service base URLs ─────────────────────────────────────────────────────────
// Docker Compose injects NEXT_PUBLIC_*_URL via build args / env vars.
// Fallback uses the browser hostname so local dev / VM access both work.

const _host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

const CLASSIFIER_BASE =
  process.env.NEXT_PUBLIC_CLASSIFIER_URL || `http://${_host}:8000`;
const DBSCAN_BASE =
  process.env.NEXT_PUBLIC_DBSCAN_URL || `http://${_host}:8010`;
const RISK_BASE =
  process.env.NEXT_PUBLIC_RISK_URL || `http://${_host}:8020`;

// ── Resilient fetch helper ────────────────────────────────────────────────────
// Shared by all microservice calls. Adds timeout + retry with exponential backoff.

async function resilientFetch(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15_000, retries = 2 } = opts;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on user-initiated abort
      if (init.signal?.aborted) throw lastError;

      // Wait before retry: 500ms, 1500ms
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error('resilientFetch: unknown error');
}

// ── Classifier Service (port 8000) ────────────────────────────────────────────

export async function analyzeComplaint(payload: {
  text_description: string;
  latitude: number;
  longitude: number;
  user_selected_category: string;
  image_url?: string;
}): Promise<ClassifierResponse> {
  const res = await resilientFetch(
    `${CLASSIFIER_BASE}/api/v1/analyze`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 30_000 }, // LLM calls can be slow
  );

  if (!res.ok) {
    let message = `Classifier error ${res.status}`;
    try {
      const body = await res.json();
      if (body.message) message = body.message;
    } catch { /* ignore parse error */ }
    throw new Error(message);
  }

  return res.json() as Promise<ClassifierResponse>;
}

// ── DBSCAN Clustering Service (port 8010) ─────────────────────────────────────

export async function getClusters(
  signal?: AbortSignal,
): Promise<ClusterFeatureCollection> {
  const res = await resilientFetch(
    `${DBSCAN_BASE}/api/v1/analytics/clusters`,
    { signal },
    { timeoutMs: 10_000 },
  );

  if (!res.ok) {
    throw new Error(`DBSCAN error ${res.status}`);
  }

  const data = await res.json();
  // Validate it's actually a FeatureCollection
  if (data?.type !== 'FeatureCollection') {
    throw new Error('DBSCAN returned invalid GeoJSON');
  }

  return data as ClusterFeatureCollection;
}

// ── Risk Scoring & Alerts Service (port 8020) ─────────────────────────────────

export async function getRiskZones(
  signal?: AbortSignal,
): Promise<RiskZoneResponse> {
  const res = await resilientFetch(
    `${RISK_BASE}/risk/zones`,
    { signal },
    { timeoutMs: 10_000 },
  );

  if (!res.ok) {
    throw new Error(`Risk zones error ${res.status}`);
  }

  return res.json() as Promise<RiskZoneResponse>;
}

export async function getRiskAlerts(
  signal?: AbortSignal,
): Promise<RiskAlertResponse> {
  const res = await resilientFetch(
    `${RISK_BASE}/risk/alerts`,
    { signal },
    { timeoutMs: 10_000 },
  );

  if (!res.ok) {
    throw new Error(`Risk alerts error ${res.status}`);
  }

  return res.json() as Promise<RiskAlertResponse>;
}


// ── Main API (Node.js on port 4000) ───────────────────────────────────────────

const BASE = process.env.NEXT_PUBLIC_API_URL || `http://${_host}:4000/api/v1`;

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status  = status;
    this.name    = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string> ?? {}),
  };

  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...fetchOptions, headers });

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch { /* ignore parse error */ }
    throw new ApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const requestOtp = (phone: string) =>
  request('/auth/otp/request', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });

export const verifyOtp = (phone: string, otp: string) =>
  request<{ token: string }>('/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ phone, otp }),
  });

export const demoLogin = () =>
  request<{ token: string }>('/auth/demo/login', { method: 'POST' });

export const refreshToken = () =>
  request<{ token: string }>('/auth/refresh', {
    method: 'POST',
    credentials: 'include', // sends HttpOnly refresh cookie
  });

// ── Complaints ────────────────────────────────────────────────────────────────

interface PostComplaintPayload {
  category:    string;
  subcategory?: string;
  description?: string;
  latitude:    number;
  longitude:   number;
  file_urls?:  string[];
}

interface PostComplaintResponse {
  complaint_id:     string;
  sla_deadline:     string;
  secondary_issues: SecondaryIssue[];
}

export const postComplaint = (
  payload: PostComplaintPayload,
  token: string
): Promise<PostComplaintResponse> =>
  request<PostComplaintResponse>('/complaints', {
    method: 'POST',
    body:   JSON.stringify(payload),
    token,
  });

export const getComplaint = (id: string, token?: string) =>
  request<Complaint>(`/complaints/${id}`, { token });

export const updateStatus = (id: string, status: string, token: string) =>
  request(`/complaints/${id}/status`, {
    method: 'PATCH',
    body:   JSON.stringify({ status }),
    token,
  });

export const verifyComplaint = (id: string, token: string) =>
  request(`/complaints/${id}/verify`, { method: 'POST', token });

// ── GIS ───────────────────────────────────────────────────────────────────────

export const getMapMarkers = (token?: string) =>
  request<{ markers: MapMarker[] }>('/gis/complaints/map', { token });

export const getWards = () =>
  request<GeoJsonFeatureCollection>('/gis/wards');

export const triggerDemoReset = (token: string) =>
  request('/admin/demo/reset', { method: 'DELETE', token });

// ── Feedback ──────────────────────────────────────────────────────────────────

export const submitFeedback = (
  complaintId: string,
  rating: number,
  comment: string,
  token: string
) =>
  request('/feedback', {
    method: 'POST',
    body:   JSON.stringify({ complaint_id: complaintId, rating, comment }),
    token,
  });

export const getComplaints = (token: string, queryString = "") =>
  request<{ complaints: Complaint[] }>(`/complaints${queryString}`, { token });
