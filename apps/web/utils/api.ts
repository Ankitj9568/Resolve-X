// apps/web/utils/api.ts
// Central API utility for ResolveX frontend.
// Attaches Authorization header from token argument.
// Throws a typed error with the server's error message on non-2xx responses.
//const BASE = process.env.NEXT_PUBLIC_API_URL;
import type {
  Complaint,
  GeoJsonFeatureCollection,
  MapMarker,
  SecondaryIssue,
} from './types';

const BASE = "http://localhost:4000/api/v1"; 

console.log('API BASE URL:', BASE);

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
